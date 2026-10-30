import type { TestItem } from '../types/adapters.js';

/** Playwright splits each line on this, so titles containing `>` stay intact */
const SEPARATOR = ' › ';

/**
 * Builds a Playwright `--test-list` file: one line per test and project. Playwright matches every segment
 * exactly, so unlike `--grep` a test is never selected because its title ends with another test's title.
 */
export function buildTestList(tests: TestItem[]): string {
    return tests
        .flatMap(({ meta: { projects, file, titlePath } }) =>
            projects.map((project) => [`[${project}]`, file, ...titlePath].join(SEPARATOR)),
        )
        .join('\n');
}
