import { describe, it, expect } from 'vitest';
import { escapeRegex, makeGrepPatterns } from '../packages/core/src/helpers/regex.js';
import type { TestItem } from '../packages/core/src/types/adapters.js';

function meta(file: string, titlePath: string[], children?: string[]): TestItem['meta'] {
    return {
        file,
        position: '1:1',
        projects: ['chromium'],
        annotations: [],
        children,
        titlePath,
    };
}

/** Whether Playwright's --grep would select a test whose grep title is `title` */
function selects(patterns: string[], title: string): boolean {
    return new RegExp(patterns.join('|')).test(title);
}

describe('escapeRegex', () => {
    it('escapes regex special characters', () => {
        expect(escapeRegex('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(
            'a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o',
        );
    });

    it('leaves plain strings unchanged', () => {
        expect(escapeRegex('foo bar baz')).toBe('foo bar baz');
    });
});

describe('makeGrepPatterns', () => {
    it('matches the test by project, file and title', () => {
        expect(selects(makeGrepPatterns(meta('foo.spec.ts', ['my test'])), 'chromium foo.spec.ts my test')).toBe(true);
    });

    it('matches the test inside its describe blocks', () => {
        const patterns = makeGrepPatterns(meta('foo.spec.ts', ['group', 'my test']));
        expect(selects(patterns, 'chromium foo.spec.ts group my test')).toBe(true);
    });

    it('matches with a path prefix before the file and trailing tags', () => {
        const patterns = makeGrepPatterns(meta('foo.spec.ts', ['my test']));
        expect(selects(patterns, 'chromium nested/path/foo.spec.ts my test @smoke @slow')).toBe(true);
    });

    it('escapes special characters in file and title', () => {
        const patterns = makeGrepPatterns(meta('foo (1).spec.ts', ['test [a]']));
        expect(selects(patterns, 'chromium foo (1).spec.ts test [a]')).toBe(true);
        expect(selects(patterns, 'chromium foo (1)Xspec.ts test [a]')).toBe(false);
    });

    it('does not match a test whose title ends with this title', () => {
        const patterns = makeGrepPatterns(meta('roles.spec.ts', ['admin can login']));
        expect(selects(patterns, 'chromium roles.spec.ts super admin can login')).toBe(false);
    });

    it('does not match a top-level test ending with the title of a test in a describe', () => {
        const patterns = makeGrepPatterns(meta('roles.spec.ts', ['reports', 'export']));
        expect(selects(patterns, 'chromium roles.spec.ts csv export')).toBe(false);
    });

    it('only matches the projects the test is scheduled for', () => {
        const patterns = makeGrepPatterns(meta('foo.spec.ts', ['my test']));
        expect(selects(patterns, 'firefox foo.spec.ts my test')).toBe(false);
    });

    it('does not match a longer title or a different file', () => {
        const patterns = makeGrepPatterns(meta('foo.spec.ts', ['my test']));
        expect(selects(patterns, 'chromium foo.spec.ts my test extra')).toBe(false);
        expect(selects(patterns, 'chromium bar.spec.ts my test')).toBe(false);
    });

    it('matches every child of a serial group, including ones in nested describes', () => {
        const patterns = makeGrepPatterns(meta('foo.spec.ts', ['checkout'], ['add to cart', 'pay']));
        expect(selects(patterns, 'chromium foo.spec.ts checkout add to cart')).toBe(true);
        expect(selects(patterns, 'chromium foo.spec.ts checkout nested pay')).toBe(true);
        expect(selects(patterns, 'chromium foo.spec.ts pay')).toBe(false);
    });

    it('matches children of a file-level serial group', () => {
        const patterns = makeGrepPatterns(meta('foo.spec.ts', [], ['first', 'second']));
        expect(selects(patterns, 'chromium foo.spec.ts first')).toBe(true);
        expect(selects(patterns, 'chromium foo.spec.ts second @tag')).toBe(true);
    });
});
