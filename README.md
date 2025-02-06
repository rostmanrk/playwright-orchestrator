# Playwright Orchestrator

A CLI tool for orchestrating and managing Playwright test execution.

Helps to orchestrate Playwright test execution through smart sharding using existing database.

![Timeline](https://github.com/rostmanrk/playwright-orchestrator/raw/main/assets/timeline.png)

## 🎯 Overview

The project provides tooling to analyze and orchestrate Playwright tests using available storage plugin options. Currently available plugin options:

- file: Basic storage that uses a local file as storage.
- dynamo-db: Amazon's DynamoDB adapter.
- pg: PostgreSQL adapter.
- mysql: MySQL adapter.
- mongo: MongoDB adapter.

**Tests are ordered as follows:**

1. If there are no previous test runs, use the default timeout.
2. Take the [EMA (Exponential Moving Average)](https://en.wikipedia.org/wiki/Moving_average#Exponential_moving_average) of the test duration. The window size can be changed in [`create`](#create) command, default value is 10.
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

1. Default id: `[{project}] {file} > {title of the test}`.
2. Serial test id: `[{project}] {file} > {title of the parent group}`.
3. Serial test defined at the file level: `[{project}] {file}`.
4. Custom Id: `[{project}] {custom id}`.

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

## 📦 Installation

Make sure Playwright is installed by following [Playwright's installation guide](https://playwright.dev/docs/intro#installation).

```bash
npm install @playwright-orchestrator/core --save-dev

npm install @playwright-orchestrator/<storage_plugin_name> --save-dev
```

## 🚀 Usage

Run the CLI tool:

```bash
npx playwright-orchestrator <command> <storage_type> [options]
```

## 📝 Example

[Mongo](/.github/workflows/mongo.yml)

[DynamoDB](/.github/workflows/dynamo-db.yml)

1. Run the `init` command. Required to run once to set up storage. Make sure that executing credentials have all permissions.

```bash
npx playwright-orchestrator init pg --connection-string "postgres://username:password@localhost:5432/postgres"
```

2. Run the `create` command. Required to run once per run.

```bash
npx playwright-orchestrator create pg --connection-string "postgres://username:password@localhost:5432/postgres" --workers 2
> 019464f7-1488-75d1-b5c0-5e7d3dde9195
```

3. Start the desired count of shards using the `run` command. Run ID is generated in the previous step. All Playwright options are already saved in the previous step.

```bash
npx playwright-orchestrator run pg --connection-string "postgres://username:password@localhost:5432/postgres" --run-id 019464f7-1488-75d1-b5c0-5e7d3dde9195
```

4. Failed tests can be started again using step 3.

5. Merge report using [Playwright's Merge-reports CLI](https://playwright.dev/docs/test-sharding#merge-reports-cli)

```bash
npx playwright merge-reports ./blob-reports --reporter html
```

## ⚙️ Commands and Options

### `init`

Seeds data storage with necessary tables and initial configuration.
No additional options.

### `create`

Creates and configures a new test run. Outputs created run ID. Supports most of [playwright's options](https://playwright.dev/docs/test-cli#reference).

| Option             | Description                                                                         | Type     | Default | Required? |
| ------------------ | ----------------------------------------------------------------------------------- | -------- | ------- | --------- |
| `--history-window` | Count of runs history kept and window for average duration. More [here](#-overview) | `number` | 10      | no        |

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
| `--tls-allow-invalid-certificates` | Allow invalid certificates            | -        | -                         | no        |
| `--tls-insecure`                   | Allow insecure                        | -        | -                         | no        |
| `--debug`                          | Add extra fields for some collections | `string` | -                         | no        |

## 💻 Development

Make sure podman and compose is installed. They used for tests and local development.

Build or use `npm run watch`.

Make sure you run `npm run cli-permissions` and `npm run link-packages`

See packages.json .scripts section for more commands.

## ⚖️ License

Licensed under the Apache License 2.0. See LICENSE.md for details.

## 🔮 Future plans/ideas

- ✅ ~~Tests~~
- ✅ ~~Better Error Handling~~
- ✅ ~~MySQL adapter~~
- ✅ ~~MongoDB adapter~~
- ✅ ~~Tests improvements~~
- ✅ ~~Better Logging~~
- ✅ ~~Test History statistics (test duration trends, count of test failures for past n days, etc.)~~
- ✅ ~~Smarter test ordering based on previous execution duration~~
- ✅ ~~GHA reporter~~
- ⬜ Redis adapter
- ⬜ Even more adapters (by request)
- ⬜ More examples
- ⬜ Create Documentation site.
- ? Restore unfinished tests in case shard terminated (Can be simply fixed by creating new run)

## ⚠️ Disclaimer

This library was created in a couple weeks of free time, so issues may occur, but I try to address them as quickly as I can. Don't hesitate to create an issue report or contribute.

## 🤝 Support

For now, the best way to support this project is to star it on GitHub and share it with your colleagues or the community.
