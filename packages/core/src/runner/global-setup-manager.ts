import { inject, injectable } from 'inversify';
import type { TestRunConfig } from '../types/adapters.js';
import type { Project } from '../types/test-info.js';
import { SYMBOLS } from '../symbols.js';
import { TestExecutionReporter } from './test-execution-reporter.js';
import { loadPlaywrightModule, PlaywrightConfigLoader, type PlaywrightConfig } from '../helpers/playwright-config.js';
import { runPlaywright } from '../helpers/run-playwright.js';

@injectable()
export class GlobalSetupManager {
    private loadGlobalHook: any;
    private globalSetupTeardowns: Array<() => Promise<void> | void> = [];

    constructor(
        @inject(SYMBOLS.TestExecutionReporter) private readonly reporter: TestExecutionReporter,
        @inject(SYMBOLS.PlaywrightConfigLoader) private readonly configLoader: PlaywrightConfigLoader,
    ) {}

    async runSetup(config: TestRunConfig): Promise<void> {
        ({ loadGlobalHook: this.loadGlobalHook } = loadPlaywrightModule('playwright/lib/runner/loadUtils'));
        await this.runGlobalSetup(config);
        await this.runSetupProjects(config);
    }

    async runTeardown(config: TestRunConfig): Promise<void> {
        await this.runTeardownProjects(config);
        await this.runGlobalTeardown(config);
    }

    private async runGlobalSetup(config: TestRunConfig): Promise<void> {
        const playwrightConfig = this.configLoader.getConfig();
        if (!playwrightConfig?.globalSetups?.length) return;

        const promise = this.executeSetups(playwrightConfig);
        this.reporter.addLoading(`[ Running global setup ]`, promise);
        await promise;
    }

    private async executeSetups(playwrightConfig: PlaywrightConfig): Promise<void> {
        for (const file of playwrightConfig.globalSetups) {
            const setupHook = await this.loadGlobalHook(playwrightConfig, file);
            const teardown = await setupHook(playwrightConfig.config);
            if (typeof teardown === 'function') {
                this.globalSetupTeardowns.push(teardown);
            }
        }
    }

    private async runSetupProjects(config: TestRunConfig): Promise<void> {
        const setupOrder = this.topologicalSort(config.projects);
        if (setupOrder.length === 0) return;

        for (const projectName of setupOrder) {
            const promise = this.runDependencyProject(projectName, config);
            this.reporter.addLoading(`[ Running dependency project "${projectName}" ]`, promise);
            await promise;
        }
    }

    private async runTeardownProjects(config: TestRunConfig): Promise<void> {
        const projects = this.collectTeardownProjects(config.projects);
        if (!projects || projects.length === 0) return;

        for (const projectName of projects.reverse()) {
            const promise = this.runDependencyProject(projectName, config);
            this.reporter.addLoading(`[ Running teardown project "${projectName}" ]`, promise);
            await promise;
        }
    }

    private async runDependencyProject(projectName: string, config: TestRunConfig): Promise<void> {
        const args = ['--project', projectName, '--reporter', 'list', ...this.cleanArgs(config.args)];
        if (config.configFile) {
            args.push('--config', config.configFile);
        }
        await runPlaywright(args).then((code) => {
            if (code !== 0) throw new Error(`Project "${projectName}" failed with exit code ${code}`);
        });
    }

    private cleanArgs(args: string[]): string[] {
        const filtered: string[] = [];
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg === '--project' && i + 1 < args.length) {
                i++;
                continue;
            }
            filtered.push(arg);
        }
        return filtered;
    }

    private collectTeardownProjects(projects: Project[]): string[] {
        const teardownNames = new Set<string>();
        for (const project of projects) {
            if (project.teardown) {
                teardownNames.add(project.teardown);
            }
        }
        return [...teardownNames];
    }

    private topologicalSort(projects: Project[]): string[] {
        const dependencyNames = new Set<string>();
        for (const project of projects) {
            for (const dep of project.dependencies) {
                dependencyNames.add(dep);
            }
        }
        if (dependencyNames.size === 0) return [];

        const projectMap = new Map(projects.map((p) => [p.name, p]));
        const inDegree = new Map<string, number>();
        const edges = new Map<string, string[]>();

        for (const name of dependencyNames) {
            inDegree.set(name, 0);
            edges.set(name, []);
        }

        for (const name of dependencyNames) {
            const project = projectMap.get(name);
            if (!project) continue;
            for (const dep of project.dependencies) {
                if (dependencyNames.has(dep)) {
                    edges.get(dep)!.push(name);
                    inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
                }
            }
        }

        const queue = [...dependencyNames].filter((n) => inDegree.get(n) === 0);
        const result: string[] = [];

        while (queue.length > 0) {
            const node = queue.shift()!;
            result.push(node);
            for (const neighbor of edges.get(node) ?? []) {
                const newDegree = inDegree.get(neighbor)! - 1;
                inDegree.set(neighbor, newDegree);
                if (newDegree === 0) queue.push(neighbor);
            }
        }

        if (result.length !== dependencyNames.size) {
            throw new Error('Circular dependency detected among setup projects');
        }
        return result;
    }

    private async runGlobalTeardown(config: TestRunConfig): Promise<void> {
        const playwrightConfig = this.configLoader.getConfig();
        if (!playwrightConfig?.globalTeardowns?.length && !this.globalSetupTeardowns.length) return;
        const promise = this.executeTeardowns(playwrightConfig);
        this.reporter.addLoading(`[ Running global teardown ]`, promise);
        await promise;
    }

    private async executeTeardowns(playwrightConfig: PlaywrightConfig): Promise<void> {
        for (const teardown of this.globalSetupTeardowns.reverse()) {
            await teardown();
        }
        for (const file of playwrightConfig.globalTeardowns ?? []) {
            const teardownHook = await this.loadGlobalHook(playwrightConfig, file);
            await teardownHook(playwrightConfig.config);
        }
    }
}
