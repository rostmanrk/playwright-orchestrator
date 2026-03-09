import { injectable, preDestroy } from 'inversify';
import playwright, { BrowserServer } from 'playwright';
import { Project, TestRunConfig } from './types/test-info.js';

@injectable()
export class BrowserManager {
    private browsers: Map<string, BrowserServer> = new Map();

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
        // Placeholder for browser setup logic, e.g., downloading or verifying browser binaries
        console.log(`Setting up browser: ${project.use.defaultBrowserType}`);
        const browserLauncher = playwright[project.use.defaultBrowserType];
        const browser = await browserLauncher.launchServer(project?.use?.launchOptions);
        this.browsers.set(project.name, browser);
    }

    private async teardownBrowser(projectName: string): Promise<void> {
        const browser = this.browsers.get(projectName);
        if (browser) {
            await browser.close();
            this.browsers.delete(projectName);
        }
    }
}
