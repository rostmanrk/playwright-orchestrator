#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * Checks that the Playwright internal APIs used by playwright-orchestrator still exist.
 * Run from a directory where @playwright/test and playwright are installed.
 *
 * Exit 0: all checks passed
 * Exit 1: one or more checks failed
 */

const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');

const req = createRequire(path.join(process.cwd(), 'package.json'));

const version = req('@playwright/test/package.json').version;
/** @type {string[]} */
const passed = [];
/** @type {{ name: string; error: string }[]} */
const failed = [];

/**
 * @param {string} name
 * @param {() => void} fn
 */
function check(name, fn) {
    try {
        fn();
        passed.push(name);
    } catch (e) {
        failed.push({ name, error: /** @type {Error} */ (e).message });
    }
}

/**
 * @param {boolean} condition
 * @param {string} detail
 */
function assert(condition, detail) {
    if (!condition) throw new Error(detail);
}

const pwDir = path.dirname(req.resolve('playwright/package.json'));

/**
 * Loads the configLoader module from old (lib/common/configLoader.js) or new
 * (lib/common/index.js .configLoader namespace) Playwright layouts.
 * Result is cached — Node module cache handles re-require, but the namespace
 * lookup only runs once so a missing namespace isn't reported twice.
 */
/** @type {any} */
let _configLoaderModule;
function loadConfigLoaderModule() {
    if (_configLoaderModule) return _configLoaderModule;
    const oldPath = path.join(pwDir, 'lib/common/configLoader.js');
    if (fs.existsSync(oldPath)) return (_configLoaderModule = require(oldPath));
    const m = require(path.join(pwDir, 'lib/common/index.js')).configLoader;
    assert(m != null, 'configLoader namespace not found in lib/common/index.js');
    return (_configLoaderModule = m);
}

// ── Check 1: playwright/lib/common/configLoader.loadConfig ───────────────────
// Old Playwright: lib/common/configLoader.js  New 1.60+: lib/common/index.js configLoader namespace
check('playwright/lib/common/configLoader.loadConfig', () => {
    const m = loadConfigLoaderModule();
    assert(typeof m.loadConfig === 'function', `loadConfig is ${typeof m?.loadConfig} (expected function)`);
});

// ── Check 2: playwright/lib/common/configLoader.resolveConfigLocation ────────
check('playwright/lib/common/configLoader.resolveConfigLocation', () => {
    const m = loadConfigLoaderModule();
    assert(
        typeof m.resolveConfigLocation === 'function',
        `resolveConfigLocation is ${typeof m?.resolveConfigLocation} (expected function)`,
    );
});

// ── Check 3: playwright/lib/plugins.webServer ─────────────────────────────────
// Old Playwright:   lib/plugins.js (single file)
// Mid Playwright:   lib/plugins/index.js (directory)
// New 1.60+:        lib/runner/index.js (consolidated)
check('playwright/lib/plugins.webServer', () => {
    let m;
    // require(lib/plugins) resolves both lib/plugins.js and lib/plugins/index.js
    const pluginsPath = path.join(pwDir, 'lib/plugins');
    if (fs.existsSync(pluginsPath + '.js') || fs.existsSync(pluginsPath)) {
        m = require(pluginsPath);
    } else {
        m = require(path.join(pwDir, 'lib/runner/index.js'));
    }
    assert(typeof m.webServer === 'function', `webServer is ${typeof m?.webServer} (expected function)`);
});

// ── Check 4: global hook loading mechanism ────────────────────────────────────
// Old Playwright: lib/runner/loadUtils.js exports loadGlobalHook
// Mid Playwright: loadGlobalHook moved to lib/runner/index.js
// New 1.60+: loadGlobalHook removed; use transform.requireOrImport from lib/common/index.js
check('global hook loading mechanism (loadGlobalHook or transform.requireOrImport)', () => {
    // Old path: loadUtils.js exports loadGlobalHook directly
    const loadUtilsPath = path.join(pwDir, 'lib/runner/loadUtils.js');
    if (fs.existsSync(loadUtilsPath)) {
        const m = require(loadUtilsPath);
        assert(
            typeof m.loadGlobalHook === 'function',
            `loadGlobalHook is ${typeof m?.loadGlobalHook} in lib/runner/loadUtils.js`,
        );
        return;
    }
    // Mid path: loadGlobalHook consolidated into lib/runner/index.js
    const runnerIndexPath = path.join(pwDir, 'lib/runner/index.js');
    if (fs.existsSync(runnerIndexPath)) {
        const m = require(runnerIndexPath);
        if (typeof m.loadGlobalHook === 'function') return;
    }
    // New 1.60+ path: use transform.requireOrImport from lib/common/index.js
    const commonPath = path.join(pwDir, 'lib/common/index.js');
    assert(fs.existsSync(commonPath), `No loadGlobalHook found and lib/common/index.js missing in playwright package`);
    const m = require(commonPath);
    assert(
        typeof m.transform?.requireOrImport === 'function',
        `loadGlobalHook absent from loadUtils.js/runner/index.js and transform.requireOrImport not found in lib/common/index.js`,
    );
});

// ── Check 5: Suite._parallelMode ─────────────────────────────────────────────
// _parallelMode is an instance property set in the Suite constructor.
// Old Playwright: lib/common/test.js  New 1.60+: lib/common/index.js under test namespace
// Mirrors how run-builder.ts uses it: `(suite as SuiteInternal)._parallelMode`.
check('Suite._parallelMode', () => {
    let Suite;
    const oldPath = path.join(pwDir, 'lib/common/test.js');
    if (fs.existsSync(oldPath)) {
        ({ Suite } = require(oldPath));
        assert(typeof Suite === 'function', `Suite is not a class in lib/common/test.js`);
    } else {
        const newPath = path.join(pwDir, 'lib/common/index.js');
        assert(fs.existsSync(newPath), `playwright/lib/common/index.js not found at ${newPath}`);
        const m = require(newPath);
        assert(m.test && typeof m.test.Suite === 'function', `Suite not found in lib/common/index.js test namespace`);
        ({ Suite } = m.test);
    }
    const instance = new Suite('', 'suite');
    assert('_parallelMode' in instance, `Suite instance has no _parallelMode property`);
});

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`PLAYWRIGHT VERSION: ${version}\n`);

if (failed.length > 0) {
    console.log('FAILED CHECKS:');
    for (const { name, error } of failed) {
        console.log(`  ❌ ${name}`);
        console.log(`     ${error}`);
    }
    console.log('');
}

if (passed.length > 0) {
    console.log('PASSED CHECKS:');
    for (const name of passed) {
        console.log(`  ✅ ${name}`);
    }
}

if (failed.length > 0) {
    process.exit(1);
}
