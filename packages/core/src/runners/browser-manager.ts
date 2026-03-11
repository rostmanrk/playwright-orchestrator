import { injectable, preDestroy } from 'inversify';
import playwright, { BrowserServer } from 'playwright';
import { Project } from '../types/test-info.js';

@injectable()
export class BrowserManager {
    private browsers: Map<string, BrowserServer> = new Map();
    private readonly locks = new Set<string>();

    public async getBrowserLink(project: Project): Promise<string> {
        if (project.use?.connectOptions?.wsEndpoint) return project.use.connectOptions.wsEndpoint;
        if (this.locks.has(project.name)) {
            // Wait until the browser is set up by another process
            while (this.locks.has(project.name)) {
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        }
        if (!this.browsers.has(project.name)) {
            this.locks.add(project.name);
            await this.setupBrowser(project);
            this.locks.delete(project.name);
        }
        const browser = this.browsers.get(project.name)!;
        return browser.wsEndpoint();
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
