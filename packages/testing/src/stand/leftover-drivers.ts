// The geckodriver of a spec whose session was never created, ended with the
// worker that started it.
//
// WebdriverIO starts one geckodriver per session, as a child of the spec's
// worker process, and remembers its pid only in the capabilities of the session
// it creates (`wdio:driverPID`); the driver is killed when that session is
// deleted. A `POST /session` that fails — Firefox could not start — leaves no
// session and so nobody to kill the driver (webdriver 9.32.0,
// `WebDriver.newSession`: `startWebDriver`, then `startWebDriverSession`
// throws, and the handle of the process is dropped). The worker exits, the
// driver is handed to launchd (init) and stays for good, listening on every
// interface (`--host=0.0.0.0`): 35 failed specs are 35 of them.
//
// So each worker ends what it leaves, when it exits. What is «its own» is told
// by the parent pid alone: a geckodriver whose parent is this very process,
// with everything below it (a Firefox it still holds). That is exact only while
// the worker lives — an orphan belongs to launchd, and nothing tells the
// orphans of one run from another's — which is why this runs in the worker
// (wdio.conf.ts `beforeSession` puts it on the process's exit) and not in the
// launcher's onWorkerEnd or onComplete. The driver of another worker, another
// run or another worktree is never a child of this process and is never
// touched. After a session that was created and deleted nothing is left to
// find: wdio has killed the driver itself.
//
// Not covered: a worker killed with SIGKILL runs no exit handler.
//
// Beside the stand because it is part of the e2e harness: like the rest of it,
// it stays out of the AMO sources archive.

import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  /** The state letters of `ps`; the first is Z for a process that has ended and waits for its parent. */
  readonly state: string;
  /** macOS: the path the executable was started by. Linux: its file name, cut to 15 characters. */
  readonly command: string;
}

/** What to ask `ps` for: one row per process, no header, the command last (it may hold spaces). */
export const PROCESS_TABLE_ARGS: readonly string[] = ['-A', '-o', 'pid=,ppid=,stat=,comm='];

/** The rows of `ps -A -o pid=,ppid=,stat=,comm=`; a line that is not a row is skipped. */
export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S.*)$/.exec(line);
    if (match === null) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), state: match[3] ?? '', command: (match[4] ?? '').trimEnd() });
  }
  return rows;
}

const running = (row: ProcessRow): boolean => !row.state.startsWith('Z');
/** `geckodriver`, or `geckodriver-<version>` as WebdriverIO names the binary it downloads. */
const isDriver = (row: ProcessRow): boolean => basename(row.command).startsWith('geckodriver');

/** The geckodrivers `parent` started that still run, each followed by everything below it, a parent before its children. */
export function leftoverDrivers(rows: readonly ProcessRow[], parent: number): ProcessRow[] {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    if (running(row)) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  }
  const found: ProcessRow[] = [];
  const seen = new Set<number>([parent]);
  const take = (row: ProcessRow): void => {
    if (seen.has(row.pid)) return;
    seen.add(row.pid);
    found.push(row);
    for (const child of children.get(row.pid) ?? []) take(child);
  };
  for (const row of children.get(parent) ?? []) {
    if (isDriver(row)) take(row);
  }
  return found;
}

export interface DriverWorld {
  /** The process whose drivers these are. */
  readonly pid: number;
  /** What `ps` prints for PROCESS_TABLE_ARGS; throws where there is no such `ps`. */
  readonly processTable: () => string;
  /** SIGKILL, as WebdriverIO ends a driver; throws when the process is gone. */
  readonly kill: (pid: number) => void;
  readonly log: (line: string) => void;
}

/** This process and the machine it runs on. */
export const THIS_PROCESS: DriverWorld = {
  pid: process.pid,
  processTable: () => execFileSync('ps', [...PROCESS_TABLE_ARGS], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000, maxBuffer: 16 * 1024 * 1024 }),
  kill: (pid) => {
    process.kill(pid, 'SIGKILL');
  },
  // The worker's stderr: the launcher prints it under the worker's id.
  log: (line) => {
    process.stderr.write(`${line}\n`);
  },
};

/**
 * Ends the geckodrivers this process started and left running, with what they hold; returns the pids it
 * signalled. Synchronous and never throws: it runs while the process exits. Where the process table cannot be
 * read nothing is known, and nothing is touched.
 */
export function endLeftoverDrivers(world: DriverWorld = THIS_PROCESS): number[] {
  let rows: ProcessRow[];
  try {
    rows = parseProcessTable(world.processTable());
  } catch {
    return [];
  }
  const ended: number[] = [];
  for (const row of leftoverDrivers(rows, world.pid)) {
    try {
      world.kill(row.pid);
      ended.push(row.pid);
    } catch {
      // Gone between the table and the signal.
    }
  }
  if (ended.length > 0) world.log(`e2e: ended the geckodriver this worker left behind, with what it had started (pid ${ended.join(', ')})`);
  return ended;
}
