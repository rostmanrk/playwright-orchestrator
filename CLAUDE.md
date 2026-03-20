# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Clean build (no source maps)
pnpm watch            # Watch mode compilation

pnpm test:unit        # Unit tests only (excludes e2e/)
pnpm test:e2e         # E2E tests only (max 2 threads)

# Run a single test file (prefer this over running the full suite)
npx vitest run tests/test-ast-analyzer.test.ts

# E2E tests auto-setup their own database — no manual DB startup needed
# For core changes, running one storage adapter's e2e test is sufficient
npx vitest run tests/e2e/pg.test.ts
```

## Architecture

**Playwright Orchestrator** is a CLI tool that intelligently schedules and distributes Playwright tests across workers using Exponential Moving Average (EMA) of historical test durations and failure rates.

### Monorepo (pnpm workspaces)

`packages/core` is the main package containing the CLI, DI container, runner, and adapter interfaces. The other packages (`file`, `pg`, `mysql`, `mongo`, `dynamo-db`, `redis`) are pluggable storage adapters.

### Dependency Injection (Inversify)

All major services are wired through `packages/core/src/container.ts`. The `SYMBOLS` object contains the injection tokens. Storage adapters register themselves into the container via a `register(container, options)` function exported from each adapter package.

### Plugin System

Storage adapters are loaded dynamically at runtime. Each adapter package exports:

- `register(container, options)` — binds adapter classes into the DI container
- `createOptions(command)` — adds CLI options for that storage

The list of known adapters is in `packages/core/src/plugins-list.ts`. Loading logic is in `packages/core/src/helpers/plugin.ts`.

### Execution Flow

**`create` command** → Loads test list via AST parsing (`test-ast-analyzer.ts`) → sorts by EMA + failure-adjusted duration → saves ordered run config to storage → outputs `runId`.

**`run` command** → Loads run config by `runId` → starts browser servers (BrowserManager) → loops: pops next test from queue, spawns subprocess (`spawn.ts`), parses results, updates EMA/failure stats in storage.

### EMA Scheduling

`packages/core/src/adapters/base-adapter.ts` implements the EMA formula:

```
EMA = current * k + prev_ema * (1 - k)   where k = 2 / (window + 1)
adjusted = EMA + EMA * (failure_count / window_size)
```

Failure-adjusted duration causes failing tests to sort earlier (run first), reducing total wall-clock time.

### Test ID Format

Tests are identified by composite IDs (resolved in `test-ast-analyzer.ts`):

1. Custom annotation: `[project] {custom_id}`
2. Serial group: `[project] {file} > {group_title}`
3. File-level serial: `[project] {file}`
4. Regular test: `[project] {file} > {title}`

Custom IDs are set via the `id()` annotation from `@playwright-orchestrator/core/annotations`.

### Key Files

| File                                                      | Purpose                       |
| --------------------------------------------------------- | ----------------------------- |
| `packages/core/src/container.ts`                          | DI container and SYMBOLS      |
| `packages/core/src/helpers/plugin.ts`                     | Dynamic adapter loading       |
| `packages/core/src/runner/test-runner.ts`                 | Core test execution loop      |
| `packages/core/src/adapters/base-adapter.ts`              | EMA logic, base adapter       |
| `packages/core/src/adapters/base-test-run-creator.ts`     | Test sorting and run creation |
| `packages/core/src/runner/browser-manager.ts`             | Browser server lifecycle      |
| `packages/core/src/playwright-tools/test-ast-analyzer.ts` | AST-based test discovery      |
| `packages/core/src/commands/run.ts`                       | `run` command handler         |
| `packages/core/src/commands/create.ts`                    | `create` command handler      |

### Adding a Storage Adapter

1. Create `packages/{name}/` with its own `package.json` (see `packages/file` as simplest example)
2. Implement interfaces: `Adapter`, `Initializer`, `ShardHandler`, `TestRunCreator` (extend `BaseAdapter` and `BaseTestRunCreator`)
3. Export `register(container, options)` and `createOptions(command)`
4. Add the package name to `packages/core/src/plugins-list.ts`
