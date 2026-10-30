import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { spawnAsync } from '../packages/core/src/helpers/spawn.js';
import { buildTestList, canSelectWithTestList } from '../packages/core/src/helpers/test-list.js';
import { makeGrepPatterns } from '../packages/core/src/helpers/regex.js';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestItem } from '../packages/core/src/types/adapters.js';

const req = createRequire(join(process.cwd(), 'package.json'));
const orchestratorCli = req.resolve('@playwright-orchestrator/core/cli');
const playwrightCli = join(dirname(req.resolve('@playwright/test/package.json')), 'cli.js');
const config = 'e2e/test-list/playwright.config.ts';

const storageDir = 'test-list-integration-runs';
let listDir: string;
let queue: TestItem[];

/** Selects tests the way a batch does: with --test-list, or with the --grep fallback for Playwright < 1.56 */
const selectors = {
    'test-list': async (tests: TestItem[]) => {
        const listFile = join(listDir, 'list.txt');
        await writeFile(listFile, buildTestList(tests));
        return ['--test-list', listFile];
    },
    grep: (tests: TestItem[]) => {
        const projects = [...new Set(tests.flatMap((test) => test.meta.projects))];
        const grep = tests.flatMap((test) => makeGrepPatterns(test.meta)).join('|');
        return Promise.resolve(['--grep', grep, ...projects.flatMap((project) => ['--project', project])]);
    },
};

/** Tests Playwright selects, as `[project] › describe › title` */
async function listSelected(selector: keyof typeof selectors, tests: TestItem[]): Promise<string[]> {
    const { stdout, stderr } = await spawnAsync(process.execPath, [
        playwrightCli,
        'test',
        '--config',
        config,
        '--list',
        ...(await selectors[selector](tests)),
    ]);
    const lines = stdout.split('\n').filter((line) => line.includes(' › '));
    expect(lines.length, `playwright --list failed: ${stderr}`).toBeGreaterThan(0);
    // "  [chromium] › title-overlap.spec.ts:4:5 › admin can login" -> "[chromium] › admin can login"
    return lines.map((line) => line.trim().replace(/ › [^ ]+:\d+:\d+/, '')).sort();
}

beforeAll(async () => {
    listDir = await mkdtemp(join(tmpdir(), 'test-list-'));
    const create = await spawnAsync(process.execPath, [
        orchestratorCli,
        'create',
        'file',
        '--directory',
        storageDir,
        '--config',
        config,
        '--grouping',
        'project',
    ]);
    const runId = create.stdout.trim();
    expect(runId, `create failed: ${create.stderr}`).toBeTruthy();
    queue = JSON.parse(await readFile(join(storageDir, `${runId}.queue.json`), 'utf-8')) as TestItem[];
}, 60_000);

afterAll(async () => {
    await rm(storageDir, { recursive: true, force: true });
    await rm(listDir, { recursive: true, force: true });
});

function findTest(title: string): TestItem {
    const test = queue.find((t) => t.meta.titlePath.at(-1) === title && t.meta.projects[0] === 'chromium');
    expect(test, `test "${title}" not in queue`).toBeDefined();
    return test!;
}

describe.each(['test-list', 'grep'] as const)('%s selection', (selector) => {
    it('selects a test without others whose title ends with the same words', async () => {
        expect(await listSelected(selector, [findTest('admin can login')])).toEqual(['[chromium] › admin can login']);
    });

    it('selects a test inside a describe without a top-level test ending with its title', async () => {
        expect(await listSelected(selector, [findTest('export')])).toEqual(['[chromium] › reports › export']);
    });

    it('selects every test of a serial group', async () => {
        expect(await listSelected(selector, [findTest('checkout')])).toEqual([
            '[chromium] › checkout › add to cart',
            '[chromium] › checkout › pay',
        ]);
    });

    it('selects titles containing ">"', async () => {
        expect(await listSelected(selector, [findTest('title with > in it')])).toEqual([
            '[chromium] › title with > in it',
        ]);
    });

    it('selects exactly the batch, per project', async () => {
        const batch = [findTest('super admin can login'), findTest('csv export')];
        const firefox = queue.find((t) => t.meta.titlePath.at(-1) === 'export' && t.meta.projects[0] === 'firefox')!;
        expect(await listSelected(selector, [...batch, firefox])).toEqual([
            '[chromium] › csv export',
            '[chromium] › super admin can login',
            '[firefox] › reports › export',
        ]);
    });
});

describe('titles containing "›"', () => {
    it('can not be written as a test list, so the batch falls back to --grep', async () => {
        const batch = [findTest('title with › in it'), findTest('admin can login')];
        expect(canSelectWithTestList(batch)).toBe(false);
        expect(canSelectWithTestList([findTest('admin can login')])).toBe(true);
        expect(await listSelected('grep', batch)).toEqual([
            '[chromium] › admin can login',
            '[chromium] › title with › in it',
        ]);
    });
});
