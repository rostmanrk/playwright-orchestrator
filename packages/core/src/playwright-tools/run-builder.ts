import type { FullConfig, Suite, TestCase } from '@playwright/test/reporter';
import type { TestConfig, ReporterTestRun, ReporterTestRunInfo } from '../types/test-info.js';
import path from 'node:path';

interface SuiteInternal extends Suite {
    _parallelMode?: 'none' | 'default' | 'serial' | 'parallel';
}

function isSuiteSerial(suite: Suite): boolean {
    return (suite as SuiteInternal)._parallelMode === 'serial';
}

function getEntryTimeout(entry: TestCase | Suite): number {
    if (entry.type === 'test') return entry.timeout;
    return (entry as Suite).allTests().reduce((sum, test) => sum + test.timeout, 0);
}

export class RunBuilder {
    private readonly testRun: ReporterTestRun = {};
    private config: TestConfig | undefined = undefined;

    parseEntry(entry: TestCase | Suite) {
        if (this.tryParseEntry(entry)) return this;
        for (const item of (entry as Suite).entries()) {
            this.parseEntry(item);
        }
        return this;
    }

    parseConfig({ workers, configFile, projects }: FullConfig) {
        this.config = {
            workers: workers,
            configFile: configFile ? path.relative(process.cwd(), configFile) : undefined,
            projects: projects.map((project) => ({
                name: project.name,
                use: project.use,
                repeatEach: project.repeatEach,
                dependencies: project.dependencies,
                teardown: project.teardown,
            })),
        };
        return this;
    }

    build(): ReporterTestRunInfo {
        return structuredClone({
            config: this.config!,
            testRun: this.testRun,
        });
    }

    private tryParseEntry(entry: TestCase | Suite) {
        const [_, project, file] = entry.titlePath();
        if (!file) return false;
        const position = entry.location ? `${entry.location.line}:${entry.location.column}` : '0:0';

        if (entry.type === 'test') {
            const positionMap = this.getPositionMap(file, position);
            if (positionMap[entry.title]) {
                if (!positionMap[entry.title].projects.includes(project)) {
                    positionMap[entry.title].projects.push(project);
                }
            } else {
                positionMap[entry.title] = {
                    timeout: getEntryTimeout(entry),
                    projects: [project],
                    annotations: this.getAnnotations(entry),
                };
            }
            return true;
        }

        if (isSuiteSerial(entry as Suite)) {
            const positionMap = this.getPositionMap(file, position);
            if (positionMap[entry.title]) {
                if (!positionMap[entry.title].projects.includes(project)) {
                    positionMap[entry.title].projects.push(project);
                }
            } else {
                positionMap[entry.title] = {
                    timeout: getEntryTimeout(entry),
                    projects: [project],
                    annotations: this.getAnnotations(entry),
                    children: (entry as Suite).allTests().map((test) => test.title),
                };
            }
            return true;
        }

        return false;
    }

    private getAnnotations(entry: TestCase | Suite) {
        const annotations = entry.type === 'test' ? entry.annotations : (entry as Suite).allTests()[0]?.annotations;
        return annotations?.map(({ type, description }) => ({ type, description }));
    }

    private getPositionMap(file: string, position: string) {
        if (!this.testRun[file]) this.testRun[file] = {};
        if (!this.testRun[file][position]) this.testRun[file][position] = {};
        return this.testRun[file][position];
    }
}
