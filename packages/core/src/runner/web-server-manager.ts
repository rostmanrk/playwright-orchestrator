import { inject, injectable, preDestroy } from 'inversify';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { TestRunConfig } from '../types/adapters.js';
import { SYMBOLS } from '../symbols.js';
import { TestExecutionReporter } from './test-execution-reporter.js';

@injectable()
export class WebServerManager {
    private plugins: any[] = [];

    constructor(@inject(SYMBOLS.TestExecutionReporter) private readonly reporter: TestExecutionReporter) {}

    async startServers(config: TestRunConfig): Promise<void> {
        if (!config.configFile) return;

        const req = createRequire(join(process.cwd(), 'package.json'));
        let loadConfig: any, resolveConfigLocation: any, webServer: any;
        try {
            ({ loadConfig, resolveConfigLocation } = req('playwright/lib/common/configLoader'));
            ({ webServer } = req('playwright/lib/plugins'));
        } catch (e) {
            this.reporter.error(`Failed to load Playwright's webServer plugin.`);
            throw e;
        }
        const location = resolveConfigLocation(resolve(config.configFile));
        const fullConfig = await loadConfig(location, {});

        if (!fullConfig.webServers?.length) return;

        const minimalReporter = {
            onStdOut: (text: string) => this.reporter.info(text),
            onStdErr: (text: string) => this.reporter.error(text),
        };

        this.plugins = fullConfig.webServers.map((s: any) =>
            webServer({ ...s, url: s.url || `http://localhost:${s.port}` }),
        );

        const promise = Promise.all(this.plugins.map((p: any) => p.setup(null, fullConfig.configDir, minimalReporter)));
        this.reporter.addLoading('[ Starting web servers ]', promise);
        await promise;
    }

    @preDestroy()
    async stopServers(): Promise<void> {
        await Promise.all(this.plugins.map((p: any) => p.teardown()));
        this.plugins = [];
    }
}
