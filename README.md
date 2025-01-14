# Playwright Orchestrator

A CLI tool for orchestrating and managing Playwright test execution.

## 🎯 Overview

The project provides tooling to analyze and orchestrate Playwright tests using available storage plugins options. Currently available plugins options:

- file . Basic storage that use local file as storage.
- dynamo-db . Amazons DynamoDB wrapper.
- pg . PostgreSQL wrapper.

## 📦 Installation

Make sure playwright is installed.

```bash
npm install @playwright-orchestrator/core --save-dev

npm install @playwright-orchestrator/<storage_plugin_name> --save-dev
```

## 🚀 Usage

Run the CLI tool:

```bash
playwright-orchestrator <command> <storage_type> [options]
```

## 📝 Example

1. Run `init` command. Required to run once to setup storage. Make sure that execution credentials has all permissions.

```bash
playwright-orchestrator init pg --connection-string "postgres://username:password@localhost:5432/postgres"
```

2. Run `create` command. Required to run once per run.

```bash
playwright-orchestrator init pg --connection-string "postgres://username:password@localhost:5432/postgres" --workers 2
> 019464f7-1488-75d1-b5c0-5e7d3dde9195
```

3. Start desirable count of shard using `run` command. Run id generate in previous step. All playwright options already saved in previous step.

```bash
playwright-orchestrator init pg --connection-string "postgres://username:password@localhost:5432/postgres" --run-id 019464f7-1488-75d1-b5c0-5e7d3dde9195
```

4. Failed test can be started again using step 3.

## ⚙️ Commands and options

### `init`

Seeds data storage with necessary tables and initial configuration.
No additional options.

### `create`

Create and configure a new test run. Outputs created run id. Supports most of [playwright's options](https://playwright.dev/docs/test-cli#reference).

### `run`

Starts test shard for provided test run.

**`webServer` property are not supported and ignored, make sure app run beforehand.**

| Option         | Description                                | Type     | Default        | Required? |
| -------------- | ------------------------------------------ | -------- | -------------- | --------- |
| `--run-id`     | Run id generated by `create` command       | `string` | -              | yes       |
| `-o, --output` | Directory for artifacts produced by tests, | `string` | `blob_reports` | no        |

## ⚙️ Subcommands and options

Each command has corresponding subcommand to installed storages

### `file`

Use as a storage locally created file

| Option        | Description                      | Type     | Default   | Required? |
| ------------- | -------------------------------- | -------- | --------- | --------- |
| `--directory` | Directory to store test run data | `string` | test-runs | no        |

### `dynamo-db`

Use as a storage Amazon's DynamoDB. Credentials are taken from local aws profile

| Option                | Description          | Type     | Default                   | Required? |
| --------------------- | -------------------- | -------- | ------------------------- | --------- |
| `--table-name-prefix` | Table(s) name prefix | `string` | 'playwright-orchestrator' | no        |
| `--ttl`               | TTL in days          | `number` | 30                        | no        |
| `--endpoint-url`      | DynamoDB endpoint UR | `string` | -                         | no        |

### `pg`

Use as a storage PostgreSQL.

| Option                | Description          | Type     | Default                   | Required? |
| --------------------- | -------------------- | -------- | ------------------------- | --------- |
| `--connection-string` | Connection string    | `string` | -                         | yes       |
| `--table-name-prefix` | Table(s) name prefix | `string` | 'playwright-orchestrator' | no        |

## 💻 Development

```bash
npm run watch # Watch mode for development
npm test # Run tests
npm run test-update # Update test snapshots
npm run link-packages # Link packages for development
```

## License

Licensed under the Apache License 2.0. See LICENSE.md for details.
