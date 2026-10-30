import type { TestItem } from '../types/adapters.js';

/** Playwright splits each line on this, so titles containing `>` stay intact */
const SEPARATOR = ' › ';

/**
 * Playwright splits a test-list line on `›` whenever the line contains one, so a test whose file or
 * titles contain `›` can't be written as a line and must be selected with `--grep` instead.
 */
export function canSelectWithTestList(tests: TestItem[]): boolean {
    return tests.every(({ meta: { file, titlePath } }) => ![file, ...titlePath].some((part) => part.includes('›')));
}

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
