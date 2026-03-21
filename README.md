# Playwright Orchestrator

Smart Playwright test orchestration — distributes tests by predicted duration, not test count.

[![npm version](https://img.shields.io/npm/v/@playwright-orchestrator/core)](https://www.npmjs.com/package/@playwright-orchestrator/core)
[![License](https://img.shields.io/npm/l/@playwright-orchestrator/core)](LICENSE.md)
[![CI](https://github.com/rostmanrk/playwright-orchestrator/actions/workflows/pr.yml/badge.svg)](https://github.com/rostmanrk/playwright-orchestrator/actions/workflows/test.yml)
[![Node.js](https://img.shields.io/node/v/@playwright-orchestrator/core)](https://nodejs.org)

## The Problem

Playwright's built-in `--shard` flag splits tests evenly by count. If one shard gets the slow tests, it blocks everything while the others sit idle. Playwright Orchestrator tracks historical run durations and uses an Exponential Moving Average (EMA) to distribute tests by predicted time — so all shards finish approximately together.

## Quick Start

Links to full CI workflow examples: [MongoDB](.github/workflows/mongo.yml) · [DynamoDB](.github/workflows/dynamo-db.yml) · [PostgreSQL](.github/workflows/pg.yml)

**1. Initialize storage** (one-time, requires write table permissions):

```bash
npx playwright-orchestrator init pg --connection-string "postgres://username:password@localhost:5432/postgres"
```

**2. Create a run** (once per CI run, outputs a `runId`):

```bash
npx playwright-orchestrator create pg --connection-string "postgres://username:password@localhost:5432/postgres" --workers 2
> 019464f7-1488-75d1-b5c0-5e7d3dde9195
```

**3. Start shards** (run in parallel across N machines):

```bash
npx playwright-orchestrator run pg --connection-string "postgres://username:password@localhost:5432/postgres" --run-id 019464f7-1488-75d1-b5c0-5e7d3dde9195
```

**4. Re-run failed tests** — repeat step 3 using the same `runId` (rerun any shard). The tool automatically picks up only failed tests from the previous run.

**5. Merge reports** using [Playwright's merge-reports CLI](https://playwright.dev/docs/test-sharding#merge-reports-cli):

```bash
npx playwright merge-reports ./blob-reports --reporter html
```

## How It Works

[View diagram](https://mermaid.ai/live/edit#pako:eNpVkMtqwzAQRX9FzLZ2sCQ_Ii0KTbIplC66bNSFiCaOIZaMLNFHyL9XsROazmru3DN3YE6wcwZBwv7oPncH7QN5eVOWpHraKuhsF5SyzmIeuh7JiCEOCj5Inj-SVQJ2HnXACxLDEMNIfLTPJhFzxmoC13SbxmRM8YbQ_xa7s9h_i99Zr1drTSdvs-3Rt5h7HJxPVx_I3KG_cWzmrorPCjJofWdABh8xg5TR64uE04VTEA7YowKZWoN7HY9BgbLntDZo--5cf9v0LrYHkHt9HJOKg0lP2HS69foPQWvQr120AWQ1JYA8wRdIShdUUN40VdMsOStEBt9pWpcLITirWEVFUfB6ec7gZ7pZLOqmEqKmrGzKsqQVP_8Cv7ODNQ)

```mermaid
flowchart LR
    A["init\none-time setup"] --> B["create\noutputs runId"]
    B --> C1[run shard 1]
    B --> C2[run shard 2]
    B --> C3[run shard N]
    C1 --> D[merge-reports + reporter]
    C2 --> D
    C3 --> D
```

### EMA Scheduling

**Tests are ordered as follows:**

1. If there are no previous test runs, use the default timeout.
2. Take the [EMA (Exponential Moving Average)](https://en.wikipedia.org/wiki/Moving_average#Exponential_moving_average) of the test duration. The window size can be changed in [`create`](#create) command, default value is 10. **Smaller value strips previous history.**
3. If there was a failed test in the chosen window, it is more likely to fail again. Therefore, the formula is adjusted as follows:

    - Calculate the EMA of the test duration.
    - Adjust the EMA by adding a factor based on the percentage of failed tests in the window.
    - The final formula is: `EMA + EMA * (% of failed tests in window)`

    **Example:**

    - If the EMA of the test duration is 2 minutes and 4 of 10 tests in the window failed, the adjusted duration would be:
      `2 + 2 * 0.4 = 2.8 minutes`

**Serial tests duration is a sum of all included tests.**

### Test identifiers

In order to keep history of tests, they need to be identified. There are multiple possible cases:

1. Default id: `{file} > {title of the test}`.
2. Serial test id: `{file} > {title of the parent group}`.
3. Serial test defined at the file level: `{file}`.
4. Custom Id: `{custom id}`.
5. `[{project}] ` added to beginning if `--grouping project`

In case some of these attributes changed, test history would be recreated. To preserve test history between changes, you can add a **static** attribute. Adding an id to an existing test would recreate the history as well.

**✅ Examples**

```
import { id } from '@playwright-orchestrator/core/annotations';
test('test', { annotation: id('#custom_id') }, () => {
    // test code
}
```

```
import { id } from '@playwright-orchestrator/core/annotations';
test.describe('serial tests', { annotation: id('#custom_id') }, () => {
    // test code
}
```

**❌ This won't work**

```
import { id } from '@playwright-orchestrator/core/annotations';
test.describe('test', () => {
    test.info().annotations.push(id('#custom_id'));
    // test code
}
```

## Storage Adapters

- file: Basic storage that uses a local file as storage.
- dynamo-db: Amazon's DynamoDB adapter.
- pg: PostgreSQL adapter.
- mysql: MySQL adapter.
- mongo: MongoDB adapter.
- redis: Redis adapter.

Each adapter is an optional peer dependency — install only what you need.

## 📦 Installation

Make sure Playwright is installed by following [Playwright's installation guide](https://playwright.dev/docs/intro#installation).

```bash
npm install @playwright-orchestrator/core --save-dev

npm install @playwright-orchestrator/<storage_plugin_name> --save-dev
```

## Why Not Native Sharding?

Playwright's `--shard` distributes tests by count. Playwright Orchestrator distributes by predicted duration:

![Timeline](https://github.com/rostmanrk/playwright-orchestrator/raw/main/assets/timeline.png)

| Feature            | Playwright `--shard` | Playwright Orchestrator                           |
| ------------------ | -------------------- | ------------------------------------------------- |
| Split method       | By test count        | By predicted duration (EMA)                       |
| Rerun strategy     | Re-run entire shard  | Start a new shard for failed tests only           |
| Persistent history | No                   | Yes — ordering improves over time                 |
| Storage            | None                 | File, PostgreSQL, MySQL, MongoDB, DynamoDB, Redis |

## Batching and Grouping

### Batching

Batching groups multiple tests into a single Playwright process invocation. This reduces per-test overhead and is most effective when individual tests are short and launch time dominates runtime.

**`--batch-mode off` (default):** Each test runs in its own process. Safe for all workloads.

**`--batch-mode time`:** Groups tests until their predicted total duration approximately reaches `--batch-target` seconds. Produces batches of roughly equal wall-clock length — best for even distribution across shards.

**`--batch-mode count`:** Groups exactly `--batch-target` tests per batch. Predictable batch sizes regardless of individual test duration.

### Grouping

**`--grouping test` (default):** Each test is a separate scheduling unit \* each project. Most granular control; recommended for most setups.

**`--grouping project`:** Tests are grouped by Playwright project before scheduling. Uses a less optimized query. Only consider this if your workload has a specific reason to prefer project-level grouping — the default (`test`) is recommended.

## ⚙️ Commands and Options

### `init`

Seeds data storage with necessary tables and initial configuration.
No additional options.

### `create`

Creates and configures a new test run. Outputs created run ID. Supports most of [playwright's options](https://playwright.dev/docs/test-cli#reference).

| Option             | Description                                                                                                                          | Type                   | Default | Required?                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ------- | ------------------------------------ |
| `--history-window` | Count of runs history kept and window for average duration. More [here](#how-it-works)                                               | `number`               | `10`    | no                                   |
| `--batch-mode`     | Batch grouping mode. `off` uses current single-test behaviour                                                                        | `off \| time \| count` | `off`   | no                                   |
| `--batch-target`   | Batch size: seconds (time mode) or test count (count mode)                                                                           | `number`               | -       | yes when `--batch-mode` is not `off` |
| `--grouping`       | How tests are grouped. Experiment on your workload, but per project query is less optimized, using default behaviour is recommended. | `test \| project`      | `test`  | no                                   |

### `run`

Starts a test shard for the provided test run. If used with a finished run, it will only start failed tests.

Command generate blob reports into `--output` directory. To merge it use [Playwright's Merge-reports CLI](https://playwright.dev/docs/test-sharding#merge-reports-cli)

**`webServer` property is not supported and is ignored; make sure the app run beforehand.**

| Option         | Description                               | Type     | Default        | Required? |
| -------------- | ----------------------------------------- | -------- | -------------- | --------- |
| `--run-id`     | Run ID generated by `create` command      | `string` | -              | yes       |
| `-o, --output` | Directory for artifacts produced by tests | `string` | `blob_reports` | no        |

### `create-report`

Generates report for provided test run id.

| Option       | Description                          | Type              | Default | Required? |
| ------------ | ------------------------------------ | ----------------- | ------- | --------- |
| `--run-id`   | Run ID generated by `create` command | `string`          | -       | yes       |
| `--reporter` | Type of reporter                     | `'json' \| 'gha'` | `json`  | no        |

<details>
<summary>GHA Report Example</summary>

![Example](https://github.com/rostmanrk/playwright-orchestrator/raw/main/assets/report-example.png)

</details>

## ⚙️ Subcommands and Options

Each command has corresponding subcommands for installed storages.

**Each storage option can be parsed from env variable**. For example, `table-name-prefix` -> TABLE_NAME_PREFIX.

### `file`

Use as a storage locally created file

| Option        | Description                      | Type     | Default   | Required? |
| ------------- | -------------------------------- | -------- | --------- | --------- |
| `--directory` | Directory to store test run data | `string` | test-runs | no        |

### `dynamo-db`

Use Amazon's DynamoDB as storage. Credentials are taken from AWS profile

| Option                | Description           | Type     | Default                   | Required? |
| --------------------- | --------------------- | -------- | ------------------------- | --------- |
| `--table-name-prefix` | Table(s) name prefix  | `string` | 'playwright-orchestrator' | no        |
| `--ttl`               | TTL in days           | `number` | 30                        | no        |
| `--endpoint-url`      | DynamoDB endpoint URL | `string` | -                         | no        |

### `pg`

Use PostgreSQL as storage.

| Option                | Description          | Type     | Default                   | Required? |
| --------------------- | -------------------- | -------- | ------------------------- | --------- |
| `--connection-string` | Connection string    | `string` | -                         | yes       |
| `--table-name-prefix` | Table(s) name prefix | `string` | 'playwright-orchestrator' | no        |
| `--ssl-ca `           | SSL CA               | `string` | -                         | no        |
| `--ssl-cert `         | SSL certificate      | `string` | -                         | no        |
| `--ssl-key `          | SSL key              | `string` | -                         | no        |

### `mysql`

Use MySQL as storage.

| Option                            | Description                                  | Type     | Default                   | Required? |
| --------------------------------- | -------------------------------------------- | -------- | ------------------------- | --------- |
| `--connection-string`             | Connection string                            | `string` | -                         | yes       |
| `--table-name-prefix`             | Table(s) name prefix                         | `string` | 'playwright-orchestrator' | no        |
| `--ssl-profile `                  | The SSL profile overrides other SSL options. | `string` | -                         | no        |
| `--ssl-ca`                        | SSL CA                                       | `string` | -                         | no        |
| `--ssl-cert`                      | SSL certificate                              | `string` | -                         | no        |
| `--ssl-key`                       | SSL key                                      | `string` | -                         | no        |
| `--ssl-passphrase`                | SSL passphrase                               | `string` | -                         | no        |
| `--ssl-reject-unauthorized`       | SSL reject unauthorized                      | -        | -                         | no        |
| `--ssl-verify-server-certificate` | SSL verify server certificate                | -        | -                         | no        |

### `redis`

Use Redis as storage.

| Option                | Description         | Type     | Default | Required? |
| --------------------- | ------------------- | -------- | ------- | --------- |
| `--connection-string` | Connection string   | `string` | -       | yes       |
| `--name-prefix`       | Records name prefix | `string` | `'pw'`  | no        |
| `--ttl`               | TTL in days         | `number` | 30      | no        |

### `mongo`

Use MongoDB as storage.

| Option                             | Description                           | Type     | Default                   | Required? |
| ---------------------------------- | ------------------------------------- | -------- | ------------------------- | --------- |
| `--connection-string`              | Connection string                     | `string` | -                         | yes       |
| `--db`                             | Database name                         | `string` | -                         | yes       |
| `--collection-name-prefix`         | Table(s) name prefix                  | `string` | 'playwright-orchestrator' | no        |
| `--tls`                            | Enable TLS                            | -        | -                         | no        |
| `--tls-ca`                         | SSL CA                                | `string` | -                         | no        |
| `--tls-key`                        | SSL key                               | `string` | -                         | no        |
| `--tls-key-password`               | SSL key password                      | `string` | -                         | no        |
| `--tls-passphrase`                 | SSL passphrase                        | `string` | -                         | no        |
| `--tls-allow-invalid-certificates` | Allow invalid certificates            | -        | -                         | no        |
| `--tls-allow-invalid-hostnames`    | Allow invalid hostnames               | -        | -                         | no        |
| `--tls-insecure`                   | Allow insecure                        | -        | -                         | no        |
| `--debug`                          | Add extra fields for some collections | `string` | -                         | no        |

## 🔄 Migration Guide

### Upgrading to v1.3

**SQL storage adapters (`pg`, `mysql`) require re-running `init` to apply schema updates.**

## 💻 Development

Make sure podman and compose is installed. They used for tests and local development.

Build with `pnpm build` or use `pnpm watch`.

See packages.json .scripts section for more commands.

## Contributing

Issues and pull requests are welcome. If something doesn't work as expected, please [open an issue](https://github.com/rostmanrk/playwright-orchestrator/issues).

The best way to support this project is to star it on GitHub and share it with your colleagues or the community.

## 🔮 Future plans/ideas

- ✅ Tests
- ✅ Better Error Handling
- ✅ MySQL adapter
- ✅ MongoDB adapter
- ✅ Tests improvements
- ✅ Better Logging
- ✅ Test History statistics (test duration trends, count of test failures for past n days, etc.)
- ✅ Smarter test ordering based on previous execution duration
- ✅ GHA reporter
- ✅ Redis adapter
- ✅ Browser reuse (performance improvement)
- ✅ Test batching and grouping (performance improvement)
- ⬜ More examples
- ⬜ Create Documentation site.
- ❓ Even more adapters (by request)
- ❓ Restore unfinished tests in case shard terminated (Can be simply fixed by creating new run)

## ⚖️ License

Licensed under the Apache License 2.0. See LICENSE.md for details.
