import { describe, it, expect } from 'vitest';
import { escapeRegex, makeGrepPattern } from '../packages/core/src/helpers/regex.js';

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

describe('makeGrepPattern', () => {
    it('builds the expected regex source', () => {
        expect(makeGrepPattern('foo.spec.ts', 'my test')).toBe(
            '(?:^| )(?:\\S*/)?foo\\.spec\\.ts (?:.*\\s)?my test(?: @\\S+)*$',
        );
    });

    it('escapes special characters in file and title', () => {
        const pattern = new RegExp(makeGrepPattern('foo (1).spec.ts', 'test [a]'));
        expect(pattern.test('foo (1).spec.ts > test [a]')).toBe(true);
        expect(pattern.test('foo (1)Xspec.ts > test [a]')).toBe(false);
    });

    it('matches file directly followed by title', () => {
        const pattern = new RegExp(makeGrepPattern('foo.spec.ts', 'my test'));
        expect(pattern.test('foo.spec.ts my test')).toBe(true);
    });

    it('matches with a path prefix before the file', () => {
        const pattern = new RegExp(makeGrepPattern('foo.spec.ts', 'my test'));
        expect(pattern.test('some/nested/path/foo.spec.ts my test')).toBe(true);
    });

    it('matches with describe blocks between file and title', () => {
        const pattern = new RegExp(makeGrepPattern('foo.spec.ts', 'my test'));
        expect(pattern.test('foo.spec.ts my group my test')).toBe(true);
    });

    it('matches with trailing tags', () => {
        const pattern = new RegExp(makeGrepPattern('foo.spec.ts', 'my test'));
        expect(pattern.test('foo.spec.ts my test @smoke @slow')).toBe(true);
    });

    it('does not match a different title', () => {
        const pattern = new RegExp(makeGrepPattern('foo.spec.ts', 'my test'));
        expect(pattern.test('foo.spec.ts other test')).toBe(false);
    });

    it('does not match a different file', () => {
        const pattern = new RegExp(makeGrepPattern('foo.spec.ts', 'my test'));
        expect(pattern.test('bar.spec.ts my test')).toBe(false);
    });

    it('does not match when title is only a prefix of the actual title', () => {
        const pattern = new RegExp(makeGrepPattern('foo.spec.ts', 'my test'));
        expect(pattern.test('foo.spec.ts my test extra')).toBe(false);
    });
});
