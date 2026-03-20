import chalk from 'chalk';
import boxen from 'boxen';
import logUpdate from 'log-update';
import { TestItem } from '../types/adapters.js';
import { formatElapsed } from '../reporters/helpers.js';
import { injectable } from 'inversify';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const IS_TTY = process.stdout.isTTY === true;

interface SubTestState {
    startTime: number;
    endTime?: number;
    ok?: boolean;
}

interface GroupState {
    test: TestItem;
    subTests: Map<string, SubTestState>;
    accumulatedMs: number;
    resumedAt: number | null;
    endTime?: number;
    ok?: boolean;
}

interface BatchState {
    startTime: number;
    groups: Map<string, GroupState>; // testId -> state
}

@injectable()
export class TestExecutionReporter {
    private readonly failedTests: TestItem[] = [];
    private readonly succeedTests: TestItem[] = [];
    private readonly runningBatches = new Map<string, BatchState>(); // batchName -> state
    private readonly testBatchMap = new Map<string, string>(); // testId -> batchName
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

    addBatch(name: string, run: Promise<any>) {
        if (this.runningBatches.has(name)) return;
        this.runningBatches.set(name, { startTime: Date.now(), groups: new Map() });
        run.then(() => this.finishBatch(name)).catch(() => this.failBatch(name));
        if (IS_TTY) logUpdate(this.renderLines());
    }

    addGroup(batchName: string, test: TestItem, run: Promise<any>) {
        const batch = this.runningBatches.get(batchName);
        if (!batch) throw new Error(`Unknown batch: ${batchName}`);
        if (batch.groups.has(test.testId)) return;
        batch.groups.set(test.testId, {
            test,
            subTests: new Map(),
            accumulatedMs: 0,
            resumedAt: null,
        });
        this.testBatchMap.set(test.testId, batchName);
        run.then(() => this.finishGroup(batchName, test)).catch(() => this.failGroup(batchName, test));
        if (IS_TTY) logUpdate(this.renderLines());
    }

    addTest(test: TestItem, subId: string, run: Promise<any>) {
        const batchName = this.testBatchMap.get(test.testId);
        if (!batchName) throw new Error(`Unknown group: ${test.testId}`);
        const group = this.runningBatches.get(batchName)!.groups.get(test.testId)!;
        run.then(() => this.updateSubTestState(test.testId, subId, true)).catch(() =>
            this.updateSubTestState(test.testId, subId, false),
        );
        if (this.countRunning(group) === 0) {
            group.resumedAt = Date.now();
        }
        group.subTests.set(subId, { startTime: Date.now() });
        if (IS_TTY) logUpdate(this.renderLines());
    }

    addLoading(message: string, run: Promise<any>) {
        run.then(() => this.finishLoading(message)).catch(() => this.failLoading(message));
        this.loadingTasks.add(message);
        if (IS_TTY) logUpdate(this.renderLines());
    }

    private updateSubTestState(testId: string, subId: string, ok: boolean) {
        const batchName = this.testBatchMap.get(testId);
        if (!batchName) return;
        const group = this.runningBatches.get(batchName)?.groups.get(testId);
        if (!group) return;
        const sub = group.subTests.get(subId);
        if (sub) {
            sub.endTime = Date.now();
            sub.ok = ok;
        }
        if (this.countRunning(group) === 0 && group.resumedAt !== null) {
            group.accumulatedMs += Date.now() - group.resumedAt;
            group.resumedAt = null;
        }
        if (IS_TTY) logUpdate(this.renderLines());
    }

    private countRunning(group: GroupState): number {
        let n = 0;
        for (const sub of group.subTests.values()) {
            if (sub.endTime === undefined) n++;
        }
        return n;
    }

    private finishGroup(batchName: string, test: TestItem) {
        this.succeedTests.push(test);
        const group = this.runningBatches.get(batchName)?.groups.get(test.testId);
        if (group) {
            group.endTime = Date.now();
            group.ok = true;
        }
        if (IS_TTY) logUpdate(this.renderLines());
    }

    private failGroup(batchName: string, test: TestItem) {
        this.failedTests.push(test);
        const group = this.runningBatches.get(batchName)?.groups.get(test.testId);
        if (group) {
            group.endTime = Date.now();
            group.ok = false;
        }
        if (IS_TTY) logUpdate(this.renderLines());
    }

    private finishBatch(name: string) {
        this.persistAndRemoveBatch(name, chalk.green('✓'));
    }

    private failBatch(name: string) {
        this.persistAndRemoveBatch(name, chalk.red('✗'));
    }

    private persistAndRemoveBatch(name: string, batchIcon: string) {
        const batch = this.runningBatches.get(name)!;
        const elapsed = formatElapsed(Date.now() - batch.startTime);
        this.runningBatches.delete(name);
        const lines = [`${batchIcon} ${name} — ${elapsed}`];
        for (const [groupId, group] of batch.groups) {
            const groupIcon = group.ok ? chalk.green('✓') : chalk.red('✗');
            lines.push(`  └─ ${groupIcon} ${groupId} — ${formatElapsed(this.getGroupElapsed(group))}`);
            for (const [subId, sub] of group.subTests) {
                const subIcon = sub.ok ? chalk.green('✓') : chalk.red('✗');
                const subElapsed = sub.endTime !== undefined ? formatElapsed(sub.endTime - sub.startTime) : '?';
                lines.push(`       └─ ${subIcon} ${subId} — ${subElapsed}`);
            }
        }
        this.persistLine(lines.join('\n'));
    }

    private getGroupElapsed(group: GroupState): number {
        return group.accumulatedMs + (group.resumedAt !== null ? Date.now() - group.resumedAt : 0);
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
            ...this.failedTests.map((test) => chalk.red(`  - ${test.testId}`)),
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
        const lines: string[] = [];

        for (const message of this.loadingTasks) {
            lines.push(`${tick} ${message}`);
        }

        for (const [batchName, batch] of this.runningBatches) {
            const batchElapsed = formatElapsed(Date.now() - batch.startTime);
            lines.push(`${tick} ${batchName} — ${batchElapsed}`);

            for (const [groupId, group] of batch.groups) {
                const groupElapsed = formatElapsed(this.getGroupElapsed(group));
                if (group.endTime !== undefined) {
                    const groupIcon = group.ok ? chalk.green('✓') : chalk.red('✗');
                    lines.push(`  └─ ${groupIcon} ${groupId} — ${groupElapsed}`);
                } else {
                    lines.push(`  └─ ${tick} ${groupId} — ${groupElapsed}`);
                }
                for (const [subId, sub] of group.subTests) {
                    if (sub.endTime !== undefined) {
                        const icon = sub.ok ? chalk.green('✓') : chalk.red('✗');
                        lines.push(`       └─ ${icon} ${subId} — ${formatElapsed(sub.endTime - sub.startTime)}`);
                    } else {
                        lines.push(`       └─ ${tick} ${subId} — ${formatElapsed(Date.now() - sub.startTime)}`);
                    }
                }
            }
        }

        return lines.join('\n');
    }
}
