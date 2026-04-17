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

// ── Check 1: playwright/lib/common/configLoader.loadConfig ───────────────────
check('playwright/lib/common/configLoader.loadConfig', () => {
    const m = req('playwright/lib/common/configLoader');
    assert(typeof m.loadConfig === 'function', `loadConfig is ${typeof m.loadConfig} (expected function)`);
});

// ── Check 2: playwright/lib/common/configLoader.resolveConfigLocation ────────
check('playwright/lib/common/configLoader.resolveConfigLocation', () => {
    const m = req('playwright/lib/common/configLoader');
    assert(
        typeof m.resolveConfigLocation === 'function',
        `resolveConfigLocation is ${typeof m.resolveConfigLocation} (expected function)`,
    );
});

// ── Check 3: playwright/lib/plugins.webServer ─────────────────────────────────
check('playwright/lib/plugins.webServer', () => {
    const m = req('playwright/lib/plugins');
    assert(typeof m.webServer === 'function', `webServer is ${typeof m.webServer} (expected function)`);
});

// ── Check 4: playwright/lib/runner/loadUtils.loadGlobalHook ──────────────────
check('playwright/lib/runner/loadUtils.loadGlobalHook', () => {
    const pwDir = path.dirname(req.resolve('playwright/package.json'));
    const m = require(path.join(pwDir, 'lib/runner/loadUtils.js'));
    assert(typeof m.loadGlobalHook === 'function', `loadGlobalHook is ${typeof m.loadGlobalHook} (expected function)`);
});

// ── Check 5: Suite._parallelMode ─────────────────────────────────────────────
// _parallelMode is an instance property set in the Suite constructor.
// We load the Suite class by its absolute path to bypass package exports restrictions,
// then instantiate it and verify the property is present on the instance — exactly
// mirroring how run-builder.ts uses it: `(suite as SuiteInternal)._parallelMode`.
check('Suite._parallelMode', () => {
    const pwDir = path.dirname(req.resolve('playwright/package.json'));
    const testJsPath = path.join(pwDir, 'lib/common/test.js');
    assert(fs.existsSync(testJsPath), `playwright/lib/common/test.js not found at ${testJsPath}`);
    const { Suite } = req(testJsPath);
    assert(typeof Suite === 'function', `Suite is not a class in playwright/lib/common/test.js`);
    const instance = new Suite('', 'suite');
    assert('_parallelMode' in instance, `Suite instance has no _parallelMode property`);
});

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`PLAYWRIGHT VERSION: ${version}\n`);

if (failed.length > 0) {
    console.log('FAILED CHECKS:');
    for (const { name, error } of failed) {
        console.log(`  \u274c ${name}`);
        console.log(`     ${error}`);
    }
    console.log('');
}

if (passed.length > 0) {
    console.log('PASSED CHECKS:');
    for (const name of passed) {
        console.log(`  \u2705 ${name}`);
    }
}

if (failed.length > 0) {
    process.exit(1);
}
