import type { FullConfig, Suite, TestCase } from '@playwright/test/reporter';
import { TestASTAnalyzer } from './test-ats-analyzer.js';
import type { TestConfig, TestRun, TestRunInfo } from '../types/test-info.js';

export class RunBuilder {
    private readonly testRun: TestRun = {};
    private config: TestConfig | undefined = undefined;

    parseEntry(entry: TestCase | Suite) {
        this.parseSuitesHelper(entry);
        return this;
    }

    parseConfig(config: FullConfig) {
        this.config = {
            workers: config.workers,
            configFile: config.configFile,
            projects: config.projects.map((project) => ({
                name: project.name,
                outputDir: project.outputDir,
                use: project.use,
            })),
        };
        return this;
    }

    build(): TestRunInfo {
        return structuredClone({
            config: this.config!,
            testRun: this.testRun,
        });
    }

    private parseSuitesHelper(entry: TestCase | Suite, analyzer?: TestASTAnalyzer) {
        const currentAnalyzer = (entry.type === 'file' ? TestASTAnalyzer.create(entry.location?.file) : analyzer)!;
        if (this.tryParseEntry(entry, currentAnalyzer)) {
            return;
        }
        for (const item of (entry as Suite).entries()) {
            this.parseSuitesHelper(item, currentAnalyzer);
        }
    }

    private tryParseEntry(entry: TestCase | Suite, analyzer: TestASTAnalyzer) {
        const [_, project, file] = entry.titlePath();
        if (!file) return false;
        const fileTests = this.getFileTests(file);
        const position = `${entry.location?.line}:${entry.location?.column}`;
        if (fileTests[position]) {
            fileTests[position].projects.push(project);
            return true;
        }
        if (entry.type === 'test' || analyzer.suiteIsSerial(entry)) {
            const children = entry.type === 'test' ? undefined : entry.allTests().map((test) => test.title);
            fileTests[position] = {
                timeout: analyzer.getTimeout(entry),
                projects: [project],
                annotations: this.getAnnotations(entry),
                title: entry.title,
                children: children,
            };
            return true;
        }
        return false;
    }

    private getAnnotations(entry: TestCase | Suite) {
        const annotations = entry.type === 'test' ? entry.annotations : entry.allTests()[0]?.annotations;
        return annotations?.map(({ type, description }) => ({ type, description }));
    }

    private getFileTests(file: string) {
        if (!this.testRun[file]) this.testRun[file] = {};
        return this.testRun[file];
    }
}
