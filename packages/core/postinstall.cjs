#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { applyPatch } = require('diff');

const PATCH_MARKER = 'params.normalMode';
const PATCH_FILE = path.join(__dirname, 'patches', 'playwright.patch');

function findTestRunner() {
  try {
    return require.resolve('playwright/lib/runner/testRunner');
  } catch {
    let dir = __dirname;
    while (true) {
      const candidate = path.join(dir, 'node_modules', 'playwright', 'lib', 'runner', 'testRunner.js');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }
}

const targetPath = findTestRunner();

if (!targetPath) {
  console.log('[playwright-orchestrator] playwright not found, skipping patch.');
  process.exit(0);
}

const content = fs.readFileSync(targetPath, 'utf8');

if (content.includes(PATCH_MARKER)) {
  console.log('[playwright-orchestrator] playwright already patched.');
  process.exit(0);
}

const patchContent = fs.readFileSync(PATCH_FILE, 'utf8');
const patched = applyPatch(content, patchContent, { fuzzFactor: 2 });

if (!patched) {
  console.warn('[playwright-orchestrator] Cannot apply patch: your playwright version may be incompatible.');
  process.exit(0);
}

fs.writeFileSync(targetPath, patched, 'utf8');
console.log(`[playwright-orchestrator] Patched playwright testRunner.js at ${targetPath}`);
