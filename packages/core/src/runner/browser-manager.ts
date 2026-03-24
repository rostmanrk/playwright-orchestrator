import { inject, injectable, preDestroy } from 'inversify';
import playwright, { BrowserServer } from 'playwright';
import { Project } from '../types/test-info.js';
import { TestExecutionReporter } from './test-execution-reporter.js';
import { SYMBOLS } from '../symbols.js';
import { TestRunConfig } from '../types/adapters.js';

@injectable()
export class BrowserManager {
    private browsers: Map<string, BrowserServer> = new Map();

    constructor(@inject(SYMBOLS.TestExecutionReporter) private readonly reporter: TestExecutionReporter) {}

    public getBrowserLinks(): Record<string, string> {
        const links: Record<string, string> = {};
        for (const [name, browser] of this.browsers.entries()) {
            links[name] = browser.wsEndpoint();
        }
        return links;
    }

    public async runBrowsers(config: TestRunConfig): Promise<Record<string, string>> {
        await Promise.all(config.projects.map((p) => this.setupBrowser(p)));
        return this.getBrowserLinks();
    }

    @preDestroy()
    public async closeBrowsers(): Promise<void> {
        await Promise.all(Array.from(this.browsers.keys()).map((projectName) => this.teardownBrowser(projectName)));
    }

    private async setupBrowser(project: Project): Promise<void> {
        if (!project.use?.defaultBrowserType) {
            return;
        }
        try {
            const browserLauncher = playwright[project.use.defaultBrowserType];
            const message = `[ Setting up browser for project "${project.name}" with type: ${project.use.defaultBrowserType} ]`;
            const setup = browserLauncher.launchServer(project?.use?.launchOptions).then((browser) => {
                this.browsers.set(project.name, browser);
            });
            this.reporter.addLoading(message, setup);
            await setup;
        } catch (e) {
            this.reporter.error(
                `Failed to launch browser for project "${project.name}": ${e instanceof Error ? e.message : String(e)}`,
            );
            throw e;
        }
    }

    private async teardownBrowser(projectName: string): Promise<void> {
        const browser = this.browsers.get(projectName);
        if (browser) {
            await browser.close();
            this.browsers.delete(projectName);
        }
    }
}
