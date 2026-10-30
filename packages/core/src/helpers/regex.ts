import type { TestItem } from '../types/adapters.js';

export function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TAGS = '(?: @\\S+)*$';

/**
 * Fallback for Playwright < 1.56, which has no `--test-list`. Playwright matches `--grep` against
 * `project file describe… title @tags`, so each pattern pins the project and the test's full title path.
 * A serial group gets one pattern per child; tests nested in describes inside the group may sit in between.
 */
export function makeGrepPatterns({ file, projects, titlePath, children }: TestItem['meta']): string[] {
    return projects.flatMap((project) => {
        const prefix = `(?:^| )${escapeRegex(project)} (?:\\S*/)?${[file, ...titlePath].map(escapeRegex).join(' ')}`;
        if (!children) return [`${prefix}${TAGS}`];
        return children.map((child) => `${prefix} (?:.+ )?${escapeRegex(child)}${TAGS}`);
    });
}
