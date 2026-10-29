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

const req = createRequire(join(process.cwd(), 'package.json'));

function isModuleResolutionError(e: any): boolean {
    return (
        e.code === 'MODULE_NOT_FOUND' ||
        e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
        e.code === 'ERR_UNSUPPORTED_DIR_IMPORT'
    );
}

function loadPwAbsolute(relPath: string): any {
    return req(join(dirname(req.resolve('playwright/package.json')), relPath));
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
        const { loadConfig, resolveConfigLocation } = loadConfigFunctions();
        const location = resolveConfigLocation(resolve(configFile));
        this.cached = await loadConfig(location, {});
    }
}

function loadConfigFunctions(): {
    loadConfig: (...args: any[]) => any;
    resolveConfigLocation: (...args: any[]) => any;
} {
    // Old Playwright: direct subpath require (pre-1.50)
    try {
        const m = req('playwright/lib/common/configLoader');
        if (typeof m.loadConfig === 'function') return m;
    } catch (e: any) {
        if (!isModuleResolutionError(e)) throw e;
    }
    // Old Playwright: absolute path (exports map restriction but file exists)
    try {
        const m = loadPwAbsolute('lib/common/configLoader.js');
        if (typeof m.loadConfig === 'function') return m;
    } catch (e: any) {
        if (!isModuleResolutionError(e)) throw e;
    }
    // Playwright 1.60+: consolidated into lib/common/index.js under configLoader namespace
    const m = loadPwAbsolute('lib/common/index.js');
    const loader = m.configLoader;
    if (!loader || typeof loader.loadConfig !== 'function') {
        throw new Error(
            'Cannot find loadConfig in Playwright internals (checked configLoader.js and index.js#configLoader)',
        );
    }
    return loader;
}

// Maps old subpaths to their new consolidated locations in Playwright 1.60+
const CONSOLIDATED_MODULES: Record<string, { file: string; namespace?: string }> = {
    'lib/plugins': { file: 'lib/runner/index.js' },
    'lib/runner/loadUtils': { file: 'lib/runner/index.js' },
    'lib/common/configLoader': { file: 'lib/common/index.js', namespace: 'configLoader' },
    'lib/common/test': { file: 'lib/common/index.js', namespace: 'test' },
};

export function loadPlaywrightModule(subpath: string): any {
    // Try package subpath first (works in old Playwright without exports restrictions)
    try {
        return req(subpath);
    } catch (e: any) {
        if (!isModuleResolutionError(e)) throw e;
    }
    const relPath = subpath.replace('playwright/', '');
    // Try absolute path (handles exports map restrictions in some older versions)
    try {
        return loadPwAbsolute(`${relPath}.js`);
    } catch (e: any) {
        if (!isModuleResolutionError(e)) throw e;
    }
    // Playwright 1.60+: modules consolidated into index.js files
    const mapping = CONSOLIDATED_MODULES[relPath];
    if (!mapping) throw new Error(`Cannot load Playwright module: ${subpath}`);
    const m = loadPwAbsolute(mapping.file);
    const result = mapping.namespace ? m[mapping.namespace] : m;
    if (result == null)
        throw new Error(
            `Cannot load Playwright module: ${subpath} (namespace '${mapping.namespace}' not found in ${mapping.file})`,
        );
    return result;
}

export function loadGlobalHookFn(): (config: PlaywrightConfig, file: string) => Promise<(...args: any[]) => any> {
    // Old Playwright: loadGlobalHook exported from loadUtils
    try {
        const m = loadPlaywrightModule('playwright/lib/runner/loadUtils');
        if (typeof m.loadGlobalHook === 'function') return m.loadGlobalHook;
    } catch (e: any) {
        if (!isModuleResolutionError(e)) throw e;
    }
    // Playwright 1.60+: loadGlobalHook removed from exports, use transform.requireOrImport
    const common = loadPwAbsolute('lib/common/index.js');
    const requireOrImport: ((file: string) => Promise<unknown>) | undefined = common.transform?.requireOrImport;
    if (typeof requireOrImport !== 'function') {
        throw new Error('Cannot find loadGlobalHook or transform.requireOrImport in Playwright internals');
    }
    return async (config: PlaywrightConfig, file: string) => {
        const resolvedPath = resolve(config.config.rootDir, file);
        let fn = await requireOrImport(resolvedPath);
        if (fn && typeof fn === 'object' && 'default' in fn) fn = (fn as any).default;
        if (typeof fn !== 'function') throw new Error(`${file} must export a single function`);
        return fn;
    };
}
