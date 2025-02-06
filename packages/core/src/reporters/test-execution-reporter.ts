import chalk from 'chalk';
import boxen from 'boxen';
import { TestItem } from '../types/adapters.js';
import { cursorSavePosition, cursorRestorePosition, cursorLeft, cursorDown, eraseDown } from 'ansi-escapes';

export class TestExecutionReporter {
    private readonly failedTests: TestItem[] = [];
    private readonly succeedTests: TestItem[] = [];
    private readonly runningTests: TestItem[] = [];
    private readonly spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    private spinnerIndex = 0;
    private spinnerInterval?: NodeJS.Timeout;

    constructor() {
        // disable spinner in CI
        if (process.env.CI) return;
        process.stdout.write(cursorSavePosition);
        this.spinnerInterval = setInterval(() => {
            this.spinnerIndex = (this.spinnerIndex + 1) % this.spinner.length;
            this.redrawRunning();
        }, 80);
    }
    addTest(test: TestItem, run: Promise<any>) {
        run.then(() => this.finishTest(test)).catch(() => this.failTest(test));
        this.runningTests.push(test);
        this.redrawRunning(true);
    }

    finishTest(test: TestItem) {
        this.succeedTests.push(test);
        const message = `${chalk.green('✓')} ${this.getKey(test)}`;
        this.printTestResult(test, message);
    }

    failTest(test: TestItem) {
        this.failedTests.push(test);
        const message = `${chalk.red('✗')} ${this.getKey(test)}`;
        this.printTestResult(test, message);
    }

    private printTestResult(test: TestItem, message: string) {
        this.runningTests.splice(this.runningTests.indexOf(test), 1);
        if (process.env.CI) {
            console.log(message);
        } else {
            process.stdout.write(cursorRestorePosition);
            process.stdout.write(eraseDown);
            process.stdout.write(message);
            process.stdout.write('\n');
            process.stdout.write(cursorSavePosition);
            this.redrawRunning(true);
        }
    }

    printSummary() {
        clearTimeout(this.spinnerInterval);
        process.stdout.write(cursorRestorePosition);
        process.stdout.write(eraseDown);

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

    private redrawRunning(full = false) {
        if (process.env.CI) return;
        process.stdout.write(cursorRestorePosition);
        for (let i = 0; i < this.runningTests.length; i++) {
            const spinner = chalk.yellow(process.env.CI ? '*' : this.spinner[this.spinnerIndex]);
            if (full) {
                process.stdout.write(`${spinner} ${this.getKey(this.runningTests[i])}\n`);
            } else {
                process.stdout.write(spinner);
                process.stdout.write(cursorLeft);
                process.stdout.write(cursorDown());
            }
        }
    }

    private getKey(test: TestItem) {
        return `[${test.project}] ${test.file}:${test.position}`;
    }
}
