import { TestDetailsAnnotation } from '@playwright/test';

export const ID_TYPE = '@playwright-orchestrator/id';

export function id(value: string): TestDetailsAnnotation {
    return { type: ID_TYPE, description: value };
}
