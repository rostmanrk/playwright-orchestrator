import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { injectable } from 'inversify';

export interface PlaywrightConfig {
    config: any;
    configDir: string;
    globalSetups: string[];
    globalTeardowns: string[];
    webServers: any[];
}

@injectable()
export class PlaywrightConfigLoader {
    private cached: PlaywrightConfig | undefined;

    getConfig(): PlaywrightConfig {
        if (!this.cached) {
            throw new Error('PlaywrightConfigLoader.load() must be called at least once before accessing the config');
        }
        return this.cached;
    }

    async loadPlaywrightConfig(configFile: string | undefined): Promise<void> {
        if (!configFile) {
            throw new Error('No config file provided');
        }
        const req = createRequire(join(process.cwd(), 'package.json'));
        const { loadConfig, resolveConfigLocation } = req('playwright/lib/common/configLoader');
        const location = resolveConfigLocation(resolve(configFile));
        this.cached = await loadConfig(location, {});
    }
}

export function loadPlaywrightModule(subpath: string): any {
    const req = createRequire(join(process.cwd(), 'package.json'));
    try {
        return req(subpath);
    } catch {
        // Fallback to absolute path for modules not in Playwright's exports map
        const pwDir = dirname(req.resolve('playwright/package.json'));
        return req(join(pwDir, `${subpath.replace('playwright/', '')}.js`));
    }
}
