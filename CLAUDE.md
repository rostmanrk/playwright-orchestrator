# CLAUDE.md

Playwright Orchestrator is a CLI that splits Playwright tests across shards and workers, ordering them by an Exponential Moving Average (EMA) of past durations and failures. `packages/core` holds the CLI, runner and adapter interfaces; `file`, `pg`, `mysql`, `mongo`, `dynamo-db` and `redis` are storage adapters.

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
pnpm test-update      # Update vitest snapshots in tests/__snapshots__

# Run a single test file (prefer this over running the full suite)
npx vitest run tests/test-ema.test.ts

# E2E tests auto-setup their own database — no manual DB startup needed
# For core changes, running one storage adapter's e2e test is sufficient.
# E2E tests need the web server on port 4321 (pnpm test:e2e starts it): when two shards
# start their own, one fails to bind or stops the server while the other still uses it.
npx --yes http-server ./e2e/web-server-simulation -p 4321 --silent & SERVER_PID=$!
npx vitest run tests/e2e/pg.test.ts --maxWorkers=1; kill $SERVER_PID
```

### Before calling a change done

1. `pnpm typecheck`, which also rebuilds `packages/core/dist`. Integration and e2e tests spawn the built CLI, so a stale `dist` gives misleading results.
2. `pnpm lint` and `pnpm format:check`
3. The unit tests that cover the change, or `pnpm test:unit`
4. One adapter's e2e test for changes to core or adapter behavior. CI runs each adapter separately with `--maxWorkers=1`.

### E2E environment

- Databases run in containers through testcontainers, so Docker or Podman must be running. `vitest.config.ts` finds the Podman socket itself.
- Run e2e with `--maxWorkers=1`. Two workers can run out of memory (exit 137).
- Shard start and finish times are checked against the host clock, so a drifting Podman VM clock fails those checks.

## Rules that are easy to break

### Adapters must behave the same

- A change to `ShardHandler`, `Adapter` or `TestRunCreator` behavior must be made in all six adapters. The e2e snapshots in `tests/__snapshots__` are shared, so every adapter has to produce the same reports.
- `TestItem.meta` is stored as JSON in every backend. SQL queries filter on `meta->projects`. Changing its shape is fine: runs can only be resumed by the CLI version that created them.
- A SQL schema change needs a migration in the `pg`/`mysql` initializer and an "Upgrading to vX" entry in the README Migration Guide telling users to re-run `init`.
- The file adapter takes locks in the order queue file, then config file. Never take the queue lock while holding the config lock.

### Playwright behavior the runner depends on

- `test.ok()` is `true` for interrupted tests and for serial-group tests skipped after a failure. Status is decided from every child's last result when the Playwright process exits (`TestEventHandler`), and interrupted results are reported as not ok.
- `--test-list` (Playwright ≥ 1.56) matches the project, file and title path exactly. It splits each line on `›` if the line contains one, so batches with `›` in a title fall back to `--grep`. When nothing matches, Playwright exits successfully, so tests that never report a result are saved as failed.
- Playwright stops gracefully on SIGINT and dies on SIGTERM. The runner forwards SIGINT to its Playwright processes.

### Code conventions

- ESM throughout: relative imports use `.js` extensions. `playwright-tools/annotations.cts` is CommonJS on purpose (it is imported by user test files as `@playwright-orchestrator/core/annotations`); keep it `.cts`.
- Commits follow Conventional Commits with an optional adapter scope, e.g. `fix(redis): …`.

## Architecture

### Execution flow

**`create`** → `PlaywrightRunInfoLoader` runs `playwright test --list` with `run-info-reporter`, where `RunBuilder` collects each test (or serial group) with its projects, timeout, annotations and title path → `BaseTestRunCreator` sorts by failure-adjusted EMA → saves the ordered queue → prints `runId`.

**`run`** (`runner/test-runner.ts`) → `startShard` → browser servers and web servers → global setup and setup projects → loop: the batch handler for `--batch-mode` claims a batch, a `playwright test` process (`helpers/run-playwright.ts`) runs it, `test-result-reporter` streams JSON lines that `TestEventHandler` turns into saved results → teardown → `finishShard`.

- Tests are selected with `--test-list` (`helpers/test-list.ts`), or with exact `--grep` patterns (`helpers/regex.ts`) on older Playwright.
- The first SIGINT/SIGTERM stops batches gracefully (`helpers/register-on-exit.ts`); a second one exits immediately.
- Running a finished run starts a repeat run that re-queues failed tests.

### Dependency injection and plugins

- Each command gets its own Inversify container from `handle()` in `commands/command-hoc.ts`. When the command ends, the container is unbound and `@preDestroy` hooks run, closing browsers and web servers.
- Tokens are in `symbols.ts` (`SYMBOLS`), and `run` binds its services in `registerServices()` in `commands/run.ts`.
- Adapters are loaded at runtime from the list in `plugins-list.ts` (`helpers/plugin.ts`). Each one exports `register(container, options)` to bind its classes and `createOptions(command)` to add its CLI options.

### EMA scheduling

`calculateEMA` in `adapters/base-adapter.ts`, and the failure adjustment in `adapters/base-test-run-creator.ts`, which sorts longest first:

```
EMA = current * k + prev_ema * (1 - k)   where k = 2 / (window + 1)
adjusted = EMA * (failure_count / history_window + 1)
```

### Test ID format

Built in `helpers/get-test-id.ts`. The `[project] ` prefix is only added with `--grouping project`:

1. Custom annotation: `[project] {custom_id}`, set with `id()` from `@playwright-orchestrator/core/annotations`
2. Serial group: `[project] {file} > {group_title}`
3. File-level serial: `[project] {file}`
4. Regular test: `[project] {file} > {title}`

### Adding a storage adapter

1. Create `packages/{name}/` with its own `package.json` (`packages/file` is the simplest example)
2. Implement `Adapter`, `Initializer`, `ShardHandler` and `TestRunCreator` (extend `BaseAdapter` and `BaseTestRunCreator`)
3. Export `register(container, options)` and `createOptions(command)`
4. Add the package name to `packages/core/src/plugins-list.ts`, and an e2e test in `tests/e2e/` plus a job in `.github/workflows/pr.yml`
