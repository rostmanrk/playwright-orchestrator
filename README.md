# Playwright Orchestrator

A CLI tool for orchestrating and managing Playwright test execution.

## Overview

The project provides tooling to analyze and orchestrate Playwright tests with features like:

- Test run planning and execution
- AST analysis of test files
- Timeout and configuration management
- Test result reporting

## Installation

npm install @playwright-orchestrator/core

## Project Structure

The project uses a monorepo structure with npm workspaces:

### Core Package

packages/core/ - Main implementation:

create - CLI command to create new test runs
program - Command line program configuration
reporter-tools - Test result reporting utilities

### Storage Package

packages/file/ - File-based storage implementation:

Handles persisting test run data
Uses file locking via proper-lockfile

## Usage

Run the CLI tool:
playwright-orchestrator <command> [options]

Available commands:

create - Create and configure a new test run
Additional commands for test orchestration

## Development

npm run watch # Watch mode for development
npm test # Run tests
npm run test-update # Update test snapshots

## License

Licensed under MIT License + "Commons Clause" License Condition v1.0. See LICENSE.md for details.
