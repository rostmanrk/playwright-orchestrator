# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Clean build (no source maps)
pnpm watch            # Watch mode compilation
pnpm typecheck        # tsc -b over packages/* (also emits dist)
pnpm lint             # ESLint with type-aware rules
pnpm format:check     # Prettier check (pnpm format to fix)

pnpm test:unit        # Unit tests only (excludes e2e/)
pnpm test:e2e         # E2E tests only (max 2 threads)

# Run a single test file (prefer this over running the full suite)
npx vitest run tests/test-ema.test.ts

# E2E tests auto-setup their own database — no manual DB startup needed
# For core changes, running one storage adapter's e2e test is sufficient.
# E2E tests need the web server on port 4321 (pnpm test:e2e starts it): when two shards
# start their own, one fails to bind or stops the server while the other still uses it.
npx --yes http-server ./e2e/web-server-simulation -p 4321 --silent & SERVER_PID=$!
npx vitest run tests/e2e/pg.test.ts; kill $SERVER_PID
```

Integration and e2e tests spawn the built CLI from `packages/core/dist`, so rebuild (or keep `pnpm watch` running) before running them.

## Architecture

**Playwright Orchestrator** is a CLI tool that intelligently schedules and distributes Playwright tests across workers using Exponential Moving Average (EMA) of historical test durations and failure rates.

### Monorepo (pnpm workspaces)

`packages/core` is the main package containing the CLI, runner, and adapter interfaces. The other packages (`file`, `pg`, `mysql`, `mongo`, `dynamo-db`, `redis`) are pluggable storage adapters.

### Dependency Injection (Inversify)

Each command gets its own container from `handle()` in `packages/core/src/commands/command-hoc.ts`, which unbinds it (running `@preDestroy` hooks such as closing browsers) when the command ends. Injection tokens are in `packages/core/src/symbols.ts` (`SYMBOLS`). The `run` command binds its services in `registerServices()` in `commands/run.ts`. Storage adapters bind their classes via the `register(container, options)` function exported from each adapter package.

### Plugin System

Storage adapters are loaded dynamically at runtime. Each adapter package exports:

- `register(container, options)` — binds adapter classes into the DI container
- `createOptions(command)` — adds CLI options for that storage

The list of known adapters is in `packages/core/src/plugins-list.ts`. Loading logic is in `packages/core/src/helpers/plugin.ts`.

### Execution Flow

**`create` command** → `PlaywrightRunInfoLoader` runs `playwright test --list` with `run-info-reporter`, where `RunBuilder` collects each test (or serial group) with its projects, timeout, annotations and title path → `BaseTestRunCreator` sorts by failure-adjusted EMA → saves the ordered queue to storage → outputs `runId`.

**`run` command** (`runner/test-runner.ts`) → `startShard` loads the run config → starts browser servers (`BrowserManager`) and web servers → runs global setup and setup projects → loops: the batch handler for `--batch-mode` claims the next batch, a `playwright test` process (`helpers/run-playwright.ts`) runs it, `test-result-reporter` streams JSON lines that `TestEventHandler` turns into results saved with updated EMA → teardown → `finishShard`.

- Tests are selected with `--test-list` (`helpers/test-list.ts`) on Playwright ≥ 1.56, and with exact `--grep` patterns (`helpers/regex.ts`) on older versions or when a title contains `›`.
- A test's status is decided when its Playwright process exits; tests that never reported a result are saved as failed.
- The first SIGINT/SIGTERM stops batches gracefully (`helpers/register-on-exit.ts`); a second one exits immediately.
- A `run` on a finished run starts a repeat run that re-queues failed tests.

### EMA Scheduling

`calculateEMA` in `packages/core/src/adapters/base-adapter.ts`:

```
EMA = current * k + prev_ema * (1 - k)   where k = 2 / (window + 1)
```

`BaseTestRunCreator` (`adapters/base-test-run-creator.ts`) sorts by the failure-adjusted value, longest first:

```
adjusted = EMA * (failure_count / history_window + 1)
```

Long and frequently failing tests start first, reducing total wall-clock time.

### Test ID Format

Tests are identified by composite IDs (`packages/core/src/helpers/get-test-id.ts`). The `[project] ` prefix is only added with `--grouping project`:

1. Custom annotation: `[project] {custom_id}`
2. Serial group: `[project] {file} > {group_title}`
3. File-level serial: `[project] {file}`
4. Regular test: `[project] {file} > {title}`

Custom IDs are set via the `id()` annotation from `@playwright-orchestrator/core/annotations`.

### Key Files

| File                                                  | Purpose                                      |
| ----------------------------------------------------- | -------------------------------------------- |
| `packages/core/src/commands/command-hoc.ts`           | Per-command DI container and error logging   |
| `packages/core/src/symbols.ts`                        | DI tokens (`SYMBOLS`)                        |
| `packages/core/src/helpers/plugin.ts`                 | Dynamic adapter loading                      |
| `packages/core/src/runner/test-runner.ts`             | Shard lifecycle and batch loop               |
| `packages/core/src/runner/test-event-handler.ts`      | Parses Playwright results, decides status    |
| `packages/core/src/adapters/base-adapter.ts`          | EMA logic, base adapter                      |
| `packages/core/src/adapters/base-test-run-creator.ts` | Test sorting and run creation                |
| `packages/core/src/runner/browser-manager.ts`         | Browser server lifecycle                     |
| `packages/core/src/playwright-tools/run-builder.ts`   | Test discovery from `playwright test --list` |
| `packages/core/src/commands/run.ts`                   | `run` command handler                        |
| `packages/core/src/commands/create.ts`                | `create` command handler                     |

### Adding a Storage Adapter

1. Create `packages/{name}/` with its own `package.json` (see `packages/file` as simplest example)
2. Implement interfaces: `Adapter`, `Initializer`, `ShardHandler`, `TestRunCreator` (extend `BaseAdapter` and `BaseTestRunCreator`)
3. Export `register(container, options)` and `createOptions(command)`
4. Add the package name to `packages/core/src/plugins-list.ts`
