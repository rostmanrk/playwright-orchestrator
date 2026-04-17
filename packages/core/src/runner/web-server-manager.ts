import { inject, injectable, preDestroy } from 'inversify';
import type { TestRunConfig } from '../types/adapters.js';
import { SYMBOLS } from '../symbols.js';
import { TestExecutionReporter } from './test-execution-reporter.js';
import { loadPlaywrightModule, PlaywrightConfigLoader } from '../helpers/playwright-config.js';

@injectable()
export class WebServerManager {
    private plugins: any[] = [];

    constructor(
        @inject(SYMBOLS.TestExecutionReporter) private readonly reporter: TestExecutionReporter,
        @inject(SYMBOLS.PlaywrightConfigLoader) private readonly configLoader: PlaywrightConfigLoader,
    ) {}

    async startServers(): Promise<void> {
        const playwrightConfig = this.configLoader.getConfig();
        if (!playwrightConfig?.webServers?.length) return;

        const { webServer } = loadPlaywrightModule('playwright/lib/plugins');

        const minimalReporter = {
            onStdOut: (text: string) => this.reporter.info(text),
            onStdErr: (text: string) => this.reporter.error(text),
        };

        this.plugins = playwrightConfig.webServers.map((s: any) =>
            webServer({ ...s, url: s.url || `http://localhost:${s.port}` }),
        );

        const promise = Promise.all(
            this.plugins.map((p: any) => p.setup(null, playwrightConfig.configDir, minimalReporter)),
        );
        this.reporter.addLoading('[ Starting web servers ]', promise);
        await promise;
    }

    @preDestroy()
    async stopServers(): Promise<void> {
        await Promise.all(this.plugins.map((p: any) => p.teardown()));
        this.plugins = [];
    }
}
