import { describe, it, expect } from 'vitest';
import { getTestId } from '../packages/core/src/helpers/get-test-id.js';

const ID_TYPE = '@playwright-orchestrator/id';

describe('getTestId', () => {
    it('custom annotation with project', () => {
        expect(
            getTestId({
                project: 'chrome',
                file: 'foo.spec.ts',
                title: 'some test',
                annotations: [{ type: ID_TYPE, description: 'my-id' }],
            }),
        ).toBe('[chrome] my-id');
    });

    it('custom annotation without project', () => {
        expect(
            getTestId({
                file: 'foo.spec.ts',
                title: 'some test',
                annotations: [{ type: ID_TYPE, description: 'my-id' }],
            }),
        ).toBe('my-id');
    });

    it('file-level serial (file === title) with project', () => {
        expect(
            getTestId({
                project: 'chrome',
                file: 'foo.spec.ts',
                title: 'foo.spec.ts',
                annotations: [],
            }),
        ).toBe('[chrome] foo.spec.ts');
    });

    it('file-level serial (file === title) without project', () => {
        expect(
            getTestId({
                file: 'foo.spec.ts',
                title: 'foo.spec.ts',
                annotations: [],
            }),
        ).toBe('foo.spec.ts');
    });

    it('regular test with project', () => {
        expect(
            getTestId({
                project: 'chrome',
                file: 'foo.spec.ts',
                title: 'my test',
                annotations: [],
            }),
        ).toBe('[chrome] foo.spec.ts > my test');
    });

    it('regular test without project', () => {
        expect(
            getTestId({
                file: 'foo.spec.ts',
                title: 'my test',
                annotations: [],
            }),
        ).toBe('foo.spec.ts > my test');
    });
});
