// What a worker ends when it exits (wdio.conf.ts `beforeSession`): its own
// geckodriver, when a session that was never created left one, and nothing
// else. The choice is made on the process table of `ps` — tables as macOS and
// the pinned Linux image print them — and once on real processes: a stand-in
// driver with a child of its own, started by this very process.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { endLeftoverDrivers, leftoverDrivers, parseProcessTable, PROCESS_TABLE_ARGS, THIS_PROCESS, type DriverWorld, type ProcessRow } from './leftover-drivers';

// A worker (700) of a run on a Mac: its geckodriver (710) still holds a Firefox (720) with two processes of its
// own. Beside it: the driver another worker of the same run started (810 under 800), the orphans of an earlier
// run (40130, 40176 under launchd), the person's own Firefox (14062), and a driver of this worker that has
// ended already and only waits to be collected (730, Z).
const MAC_TABLE = `
    1     0 Ss   /sbin/launchd
  344     1 Ss   /usr/libexec/logd
  600   599 S    node
  700   600 S    /Users/u/.nvm/versions/node/v26.7.0/bin/node
  710   700 S    /var/folders/7y/abc/T/geckodriver-0.37.1
  720   710 S    /Applications/Firefox.app/Contents/MacOS/firefox
  721   720 S    /Applications/Firefox.app/Contents/MacOS/plugin-container.app/Contents/MacOS/plugin-container
  722   720 S    /Applications/Firefox.app/Contents/MacOS/gpu-helper.app/Contents/MacOS/Firefox GPU Helper
  730   700 Z    (geckodriver-0.37)
  740   700 S    /bin/ps
  800   600 S    /Users/u/.nvm/versions/node/v26.7.0/bin/node
  810   800 S    /var/folders/7y/abc/T/geckodriver-0.37.1
14062     1 S    /Applications/Firefox.app/Contents/MacOS/firefox
14259 14062 S    /Applications/Firefox.app/Contents/MacOS/gpu-helper.app/Contents/MacOS/Firefox GPU Helper
40130     1 S    /var/folders/7y/abc/T/geckodriver-0.37.1
40176     1 S    /Users/u/code/chat-extension/.cache/tmp/geckodriver-0.37.1
`;

// The same in the pinned image: `comm` is the file name there (of a Node — the name it gives its main thread), a
// zombie is «<defunct>».
const LINUX_TABLE = `
      1       0 Ss   bash
     40       1 Sl   node-MainThread
     55      40 Sl   node-MainThread
     70      55 Sl   geckodriver
     82      70 Sl   firefox
    120      82 Sl   Web Content
    121      82 Sl   Socket Process
     90      55 Z    geckodriver <defunct>
     95      55 R    ps
`;

const pids = (rows: readonly ProcessRow[]): number[] => rows.map((row) => row.pid);

describe('parseProcessTable', () => {
  it('reads pid, parent, state and the command — a path with spaces whole', () => {
    const rows = parseProcessTable(MAC_TABLE);
    expect(rows).toHaveLength(16);
    expect(rows[0]).toEqual({ pid: 1, ppid: 0, state: 'Ss', command: '/sbin/launchd' });
    expect(rows.find((row) => row.pid === 722)).toEqual({ pid: 722, ppid: 720, state: 'S', command: '/Applications/Firefox.app/Contents/MacOS/gpu-helper.app/Contents/MacOS/Firefox GPU Helper' });
    expect(parseProcessTable(LINUX_TABLE).find((row) => row.pid === 90)).toEqual({ pid: 90, ppid: 55, state: 'Z', command: 'geckodriver <defunct>' });
  });

  it('skips what is not a row: an empty line, a header, a cut line', () => {
    expect(parseProcessTable('')).toEqual([]);
    expect(parseProcessTable('  PID  PPID STAT COMM\n\n   12     1 S    \n   13\n   14     1 S    sleep  \n')).toEqual([{ pid: 14, ppid: 1, state: 'S', command: 'sleep' }]);
  });

  it('asks ps for exactly these columns, the command last', () => {
    expect(PROCESS_TABLE_ARGS).toEqual(['-A', '-o', 'pid=,ppid=,stat=,comm=']);
  });
});

describe('leftoverDrivers', () => {
  it('the worker’s own geckodriver with everything below it, a parent before its children', () => {
    expect(pids(leftoverDrivers(parseProcessTable(MAC_TABLE), 700))).toEqual([710, 720, 721, 722]);
    expect(pids(leftoverDrivers(parseProcessTable(LINUX_TABLE), 55))).toEqual([70, 82, 120, 121]);
  });

  it('never a driver of another worker, the orphans of another run, the person’s Firefox, or its own other children', () => {
    const rows = parseProcessTable(MAC_TABLE);
    const taken = pids(leftoverDrivers(rows, 700));
    for (const other of [740, 800, 810, 14062, 14259, 40130, 40176, 600, 1]) expect(taken, String(other)).not.toContain(other);
    // The other worker finds its own, and only that.
    expect(pids(leftoverDrivers(rows, 800))).toEqual([810]);
    // The launcher has no driver: a grandchild is not a child.
    expect(leftoverDrivers(rows, 600)).toEqual([]);
    // And launchd's orphans are nobody's to end from here.
    expect(leftoverDrivers(rows, 4242)).toEqual([]);
  });

  it('a driver that has ended and waits to be collected is not one to end', () => {
    expect(pids(leftoverDrivers(parseProcessTable(MAC_TABLE), 700))).not.toContain(730);
    expect(pids(leftoverDrivers(parseProcessTable(LINUX_TABLE), 55))).not.toContain(90);
    expect(leftoverDrivers(parseProcessTable('  90  55 Z    geckodriver <defunct>\n'), 55)).toEqual([]);
  });

  it('tells a driver by the name of its file: `geckodriver` or `geckodriver-<version>`, wherever it lies', () => {
    const table = (command: string): ProcessRow[] => [{ pid: 2, ppid: 1, state: 'S', command }];
    for (const command of ['geckodriver', 'geckodriver-0.37.1', 'geckodriver-0.3', '/usr/bin/geckodriver', '/tmp/a b/geckodriver-0.37.1', '/opt/geckodriver-v0.37.1']) {
      expect(pids(leftoverDrivers(table(command), 1)), command).toEqual([2]);
    }
    for (const command of ['firefox', 'node', '/tmp/geckodriver-0.37.1/node', 'my-geckodriver', '(geckodriver-0.37)']) {
      expect(leftoverDrivers(table(command), 1), command).toEqual([]);
    }
  });

  it('a table that loops does not hang it', () => {
    const rows: ProcessRow[] = [
      { pid: 0, ppid: 0, state: 'S', command: 'kernel_task' },
      { pid: 5, ppid: 1, state: 'S', command: 'geckodriver' },
      { pid: 6, ppid: 5, state: 'S', command: 'firefox' },
      { pid: 5, ppid: 6, state: 'S', command: 'geckodriver' },
      { pid: 1, ppid: 6, state: 'S', command: 'node' },
    ];
    expect(pids(leftoverDrivers(rows, 1))).toEqual([5, 6]);
    expect(leftoverDrivers(rows, 0)).toEqual([]);
  });
});

function scripted(over: Partial<DriverWorld> = {}): DriverWorld & { readonly killed: number[]; readonly lines: string[] } {
  const killed: number[] = [];
  const lines: string[] = [];
  return { pid: 700, processTable: () => MAC_TABLE, kill: (pid) => void killed.push(pid), log: (line) => void lines.push(line), killed, lines, ...over };
}

describe('endLeftoverDrivers', () => {
  it('signals the driver and what it holds, says so in one line, and returns the pids', () => {
    const w = scripted();
    expect(endLeftoverDrivers(w)).toEqual([710, 720, 721, 722]);
    expect(w.killed).toEqual([710, 720, 721, 722]);
    expect(w.lines).toEqual(['e2e: ended the geckodriver this worker left behind, with what it had started (pid 710, 720, 721, 722)']);
  });

  it('after a session that was created and deleted there is nothing to end, and nothing is said', () => {
    const w = scripted({ pid: 600 });
    expect(endLeftoverDrivers(w)).toEqual([]);
    expect(w.killed).toEqual([]);
    expect(w.lines).toEqual([]);
  });

  it('where the process table cannot be read nothing is touched', () => {
    const w = scripted({
      processTable: () => {
        throw Object.assign(new Error('spawnSync ps ENOENT'), { code: 'ENOENT' });
      },
    });
    expect(endLeftoverDrivers(w)).toEqual([]);
    expect(w.killed).toEqual([]);
    expect(w.lines).toEqual([]);
  });

  it('a process that went away between the table and the signal is passed over; the rest still end', () => {
    const killed: number[] = [];
    const w = scripted({
      kill: (pid) => {
        if (pid === 720) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
        killed.push(pid);
      },
    });
    expect(endLeftoverDrivers(w)).toEqual([710, 721, 722]);
    expect(killed).toEqual([710, 721, 722]);
    expect(w.lines).toEqual(['e2e: ended the geckodriver this worker left behind, with what it had started (pid 710, 721, 722)']);
  });
});

// ── real processes ──────────────────────────────────────────────────────────

const table = (): ProcessRow[] => parseProcessTable(THIS_PROCESS.processTable());
/** A Mac and the pinned Firefox image have the `ps` the check reads; a bare Node image has none, and there it ends nothing. */
const hasPs = ((): boolean => {
  try {
    return table().some((row) => row.pid === process.pid);
  } catch {
    return false;
  }
})();
const runs = (pid: number): boolean => table().some((row) => row.pid === pid && !row.state.startsWith('Z'));

async function until(what: string, condition: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${what} — not within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe.skipIf(!hasPs)('endLeftoverDrivers on real processes', () => {
  let dir = '';
  let groups: number[] = [];
  afterEach(() => {
    // Every stand-in leads a process group of its own: whatever the test left of it goes at once.
    for (const pid of groups) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Ended by the test itself.
      }
    }
    groups = [];
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  /** Starts a shell under the name `binary` with `script`; resolves with the process and the pid its first line holds. */
  async function start(binary: string, script: string, ...args: string[]): Promise<{ child: ChildProcess; pid: number; said: number }> {
    const child = spawn(binary, ['-c', script, ...args], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
    const pid = child.pid ?? 0;
    groups.push(pid);
    const said = await new Promise<number>((resolve, reject) => {
      let text = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        text += chunk.toString();
        if (text.includes('\n')) resolve(Number(text.split('\n')[0]));
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => reject(new Error(`the stand-in ended before it said anything (${code ?? signal})`)));
    });
    return { child, pid, said };
  }

  it('ends the driver this process started and the child it holds; the driver of another process stays', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cg-drivers-'));
    // A shell under the name WebdriverIO gives the driver it downloads: `ps` tells a process by the file it was
    // started as. (Not a Node: on Linux a Node is `node-MainThread` whatever its file is called.)
    const geckodriver = join(dir, 'geckodriver-0.0.0');
    symlinkSync('/bin/sh', geckodriver);
    // The stand-in driver starts a child of its own (its «Firefox»), says the child's pid and stays.
    const holdsChild = 'sleep 600 & echo $!; wait';
    // Another worker: a plain shell that starts a driver of its own, says the driver's pid and stays.
    const otherWorker = '"$0" -c "sleep 600 & wait" & echo $!; wait';

    const mine = await start(geckodriver, holdsChild);
    const other = await start('/bin/sh', otherWorker, geckodriver);
    await until('all four stand-ins run', () => [mine.pid, mine.said, other.pid, other.said].every(runs));
    expect(pids(leftoverDrivers(table(), process.pid))).toEqual([mine.pid, mine.said]);
    // The other worker's driver is one by every sign — for the other worker.
    await until('the other driver is seen under its worker', () => pids(leftoverDrivers(table(), other.pid)).includes(other.said));

    const lines: string[] = [];
    const ended = new Promise<NodeJS.Signals | null>((resolve) => mine.child.on('exit', (_code, signal) => resolve(signal)));
    expect(endLeftoverDrivers({ ...THIS_PROCESS, log: (line) => void lines.push(line) })).toEqual([mine.pid, mine.said]);
    expect(lines).toEqual([`e2e: ended the geckodriver this worker left behind, with what it had started (pid ${mine.pid}, ${mine.said})`]);
    expect(await ended).toBe('SIGKILL');
    await until('the child the driver held ends too', () => !runs(mine.said));

    // The other worker and its driver were never this process's to end.
    expect(runs(other.pid)).toBe(true);
    expect(runs(other.said)).toBe(true);
    expect(table().find((row) => row.pid === other.said)?.ppid).toBe(other.pid);
    // And a second look finds nothing.
    expect(endLeftoverDrivers({ ...THIS_PROCESS, log: (line) => void lines.push(line) })).toEqual([]);
    expect(lines).toHaveLength(1);
  });
});
