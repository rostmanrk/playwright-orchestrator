import { TestCase } from 'playwright/types/testReporter';
import { ID_TYPE } from '../playwright-tools/annotations.cjs';
import type { GetTestIdParams } from '../types/adapters.js';

export function getTestId({ project, file, title, annotations }: GetTestIdParams): string {
    const idAnnotation = annotations.find((a) => a.type === ID_TYPE);
    if (idAnnotation) return `[${project}] ${idAnnotation.description!}`;
    if (file === title) return `[${project}] ${file}`;
    return `[${project}] ${file} > ${title}`;
}

export function getTestIdByTestCase(test: TestCase): string {
    const [_, project, file] = test.titlePath();
    return getTestId({
        project,
        file: file,
        title: test.title,
        annotations: test.annotations,
    });
}
