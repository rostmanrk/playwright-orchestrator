import { ID_TYPE } from '../playwright-tools/annotations.cjs';
import type { GetTestIdParams } from '../types/adapters.js';

export function getTestId({ project, file, title, annotations }: GetTestIdParams): string {
    const idAnnotation = annotations.find((a) => a.type === ID_TYPE);
    const projectPart = project ? `[${project}] ` : '';
    if (idAnnotation) return `${projectPart}${idAnnotation.description!}`;
    if (file === title) return `${projectPart}${file}`;
    return `${projectPart}${file} > ${title}`;
}
