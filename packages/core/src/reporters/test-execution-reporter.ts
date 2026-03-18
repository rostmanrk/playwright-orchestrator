import chalk from 'chalk';
import boxen from 'boxen';
import logUpdate from 'log-update';
import { TestItem } from '../types/adapters.js';
import { formatElapsed } from './helpers.js';
import { injectable } from 'inversify';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const IS_TTY = process.stdout.isTTY === true;

@injectable()
export class TestExecutionReporter {
    private readonly failedTests: TestItem[] = [];
    private readonly succeedTests: TestItem[] = [];
    private readonly runningTests = new Map<TestItem, number>(); // test -> start timestamp
    private readonly loadingTasks = new Set<string>();
    private spinnerIndex = 0;
    private spinnerInterval?: NodeJS.Timeout;

    constructor() {
        if (!IS_TTY) return;
        this.spinnerInterval = setInterval(() => {
            this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER.length;
            logUpdate(this.renderLines());
        }, 80);
    }

    addTest(test: TestItem, run: Promise<any>) {
        run.then(() => this.finishTest(test)).catch(() => this.failTest(test));
        this.runningTests.set(test, Date.now());
        if (IS_TTY) logUpdate(this.renderLines());
    }

    addLoading(message: string, run: Promise<any>) {
        run.then(() => this.finishLoading(message)).catch(() => this.failLoading(message));
        this.loadingTasks.add(message);
        if (IS_TTY) logUpdate(this.renderLines());
    }

    finishTest(test: TestItem) {
        this.succeedTests.push(test);
        const elapsed = formatElapsed(Date.now() - this.runningTests.get(test)!);
        this.runningTests.delete(test);
        this.persistLine(`${chalk.green('✓')} ${this.getKey(test)} — ${elapsed}`);
    }

    failTest(test: TestItem) {
        this.failedTests.push(test);
        const elapsed = formatElapsed(Date.now() - this.runningTests.get(test)!);
        this.runningTests.delete(test);
        this.persistLine(`${chalk.red('✗')} ${this.getKey(test)} — ${elapsed}`);
    }

    private finishLoading(message: string) {
        this.loadingTasks.delete(message);
        this.persistLine(`${chalk.green('✓')} ${message}`);
    }

    private failLoading(message: string) {
        this.loadingTasks.delete(message);
        this.persistLine(`${chalk.red('✗')} ${message}`);
    }

    info(message: string) {
        this.persistLine(`${chalk.blue('ℹ')} ${message}`);
    }

    error(message: string) {
        if (IS_TTY) {
            this.persistLine(`${chalk.red('✗')} ${message}`);
        } else {
            console.error(`${chalk.red('✗')} ${message}`);
        }
    }

    printSummary() {
        clearInterval(this.spinnerInterval);
        if (IS_TTY) logUpdate.clear();
        const lines = [
            chalk.green(`Succeed: ${this.succeedTests.length}`),
            chalk.red(`Failed: ${this.failedTests.length}:`),
            ...this.failedTests.map((test) => chalk.red(`  - ${this.getKey(test)}`)),
        ];
        console.log(
            boxen(lines.join('\n'), {
                title: 'Test shard results',
                titleAlignment: 'left',
                borderColor: 'yellow',
                padding: 1,
            }),
        );
    }

    private persistLine(message: string) {
        if (IS_TTY) {
            logUpdate.clear();
            console.log(message);
            logUpdate(this.renderLines());
        } else {
            console.log(message);
        }
    }

    private renderLines(): string {
        const tick = chalk.yellow(SPINNER[this.spinnerIndex]);
        return [
            ...[...this.runningTests.entries()].map(
                ([test, startTime]) => `${tick} ${this.getKey(test)} — ${formatElapsed(Date.now() - startTime)}`,
            ),
            ...[...this.loadingTasks].map((message) => `${tick} ${message}`),
        ].join('\n');
    }

    private getKey(test: TestItem) {
        const project = test.projects.join('|');
        return `[${project}] ${test.file}${test.position === '0:0' ? '' : `:${test.position}`}`;
    }
}
