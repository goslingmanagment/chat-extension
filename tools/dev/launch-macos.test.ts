// The macOS flow on fakes: no Firefox, no `open`, no sockets, no real clock.

import { describe, expect, it } from 'vitest';

import { createMacosDev, OPEN_BIN, openArgs, runOpen, waitForPort, type MacosDevDeps, type MacosDevOptions, type SpawnedOpen } from './launch-macos.ts';

const PROFILE = '/profiles/cg-dev';
const ADDON = '/builds/firefox-mv3-test';
const OPTIONS: MacosDevOptions = { profileDir: PROFILE, addonPath: ADDON, port: 6111, firefoxApp: 'Firefox' };
const OPEN_ARGS = ['-n', '-a', 'Firefox', '--args', '-profile', PROFILE, '-no-remote', '-start-debugger-server', '6111'];

interface World {
  readonly deps: MacosDevDeps;
  /** What happened, in order: build, profile, probe, open, install. */
  readonly calls: string[];
  readonly opens: string[][];
  readonly installs: Array<{ port: number; addonPath: string }>;
  readonly logs: string[];
  /** Fake clock, advanced only by `sleep`. */
  readonly clock: { now: number };
  /** Knobs a test turns. */
  readonly state: {
    buildOk: boolean;
    /** The port answers from this moment of the fake clock on; null — never. */
    portOpensAt: number | null;
    /** How long after `open` a started Firefox opens its port; null — it never does. */
    startupMs: number | null;
    openError: Error | null;
    installError: Error | null;
    /** When set, an install waits for the gate before it answers. */
    installGate: Promise<void> | null;
  };
}

function world(portAnswers: boolean): World {
  const calls: string[] = [];
  const opens: string[][] = [];
  const installs: Array<{ port: number; addonPath: string }> = [];
  const logs: string[] = [];
  const clock = { now: 1_000 };
  const state: World['state'] = { buildOk: true, portOpensAt: portAnswers ? 0 : null, startupMs: 700, openError: null, installError: null, installGate: null };
  const deps: MacosDevDeps = {
    build: () => {
      calls.push('build');
      return state.buildOk;
    },
    prepareProfile: (dir) => {
      calls.push(`profile ${dir}`);
    },
    open: (args) => {
      calls.push('open');
      opens.push([...args]);
      if (state.openError !== null) return Promise.reject(state.openError);
      if (state.startupMs !== null) state.portOpensAt = clock.now + state.startupMs;
      return Promise.resolve();
    },
    probe: (port) => {
      calls.push(`probe ${port}`);
      return Promise.resolve(state.portOpensAt !== null && clock.now >= state.portOpensAt);
    },
    install: async (port, addonPath) => {
      calls.push('install');
      installs.push({ port, addonPath });
      if (state.installGate !== null) await state.installGate;
      if (state.installError !== null) throw state.installError;
      return { addonId: 'addon-under-test@example.test' };
    },
    sleep: (ms) => {
      clock.now += ms;
      return Promise.resolve();
    },
    now: () => clock.now,
    log: (line) => {
      logs.push(line);
    },
  };
  return { deps, calls, opens, installs, logs, clock, state };
}

describe('openArgs', () => {
  it('starts a new instance on the profile with the debugger server, and no page', () => {
    expect(openArgs(OPTIONS)).toEqual(OPEN_ARGS);
  });

  it('adds the page only when one is given, and takes another app', () => {
    expect(openArgs({ ...OPTIONS, firefoxApp: '/Applications/Firefox Nightly.app', port: 6222, url: 'https://example.test/chat' })).toEqual([
      '-n',
      '-a',
      '/Applications/Firefox Nightly.app',
      '--args',
      '-profile',
      PROFILE,
      '-no-remote',
      '-start-debugger-server',
      '6222',
      'https://example.test/chat',
    ]);
  });

  it('refuses a relative profile path: LaunchServices starts the app elsewhere', () => {
    expect(() => openArgs({ ...OPTIONS, profileDir: '.dev-profile' })).toThrow(/must be absolute/);
  });
});

describe('createMacosDev: start', () => {
  it('reuses a Firefox whose debugger already answers: no `open`, one install', async () => {
    const w = world(true);
    await expect(createMacosDev(OPTIONS, w.deps).start()).resolves.toBe('installed');
    expect(w.opens).toEqual([]);
    expect(w.calls).toEqual(['build', `profile ${PROFILE}`, 'probe 6111', 'install']);
    expect(w.installs).toEqual([{ port: 6111, addonPath: ADDON }]);
    expect(w.logs.join('\n')).toMatch(/already answers on port 6111/);
  });

  it('starts Firefox once with the exact arguments, waits for the port, then installs', async () => {
    const w = world(false);
    await expect(createMacosDev(OPTIONS, w.deps).start()).resolves.toBe('installed');
    expect(w.opens).toEqual([OPEN_ARGS]);
    // Closed before `open`; 700 ms of startup at a 250 ms poll: closed, closed, closed, open.
    expect(w.calls).toEqual(['build', `profile ${PROFILE}`, 'probe 6111', 'open', 'probe 6111', 'probe 6111', 'probe 6111', 'probe 6111', 'install']);
    expect(w.clock.now).toBe(1_750);
    expect(w.installs).toEqual([{ port: 6111, addonPath: ADDON }]);
  });

  it('passes the page to `open` only when it is given', async () => {
    const w = world(false);
    await createMacosDev({ ...OPTIONS, url: 'https://example.test/chat' }, w.deps).start();
    expect(w.opens).toEqual([[...OPEN_ARGS, 'https://example.test/chat']]);
  });

  it('does nothing after a failed build', async () => {
    const w = world(false);
    w.state.buildOk = false;
    await expect(createMacosDev(OPTIONS, w.deps).start()).resolves.toBe('build-failed');
    expect(w.calls).toEqual(['build']);
  });

  it('rejects with a clear message when the port never opens, and installs nothing', async () => {
    const w = world(false);
    w.state.startupMs = null;
    await expect(createMacosDev(OPTIONS, w.deps).start()).rejects.toThrow(/did not open its debugger port 6111 within 60 s/);
    expect(w.opens).toHaveLength(1);
    expect(w.installs).toEqual([]);
    expect(w.clock.now).toBe(61_000);
  });

  it('rejects when `open` fails, and installs nothing', async () => {
    const w = world(false);
    w.state.openError = new Error('`open` failed (exit code 1)');
    await expect(createMacosDev(OPTIONS, w.deps).start()).rejects.toThrow(/`open` failed/);
    expect(w.calls).toEqual(['build', `profile ${PROFILE}`, 'probe 6111', 'open']);
  });

  it('reports a failed first install as an outcome, in one line', async () => {
    const w = world(true);
    w.state.installError = new Error('Firefox debugger at 127.0.0.1:6111: install failed — unknownError:\n  manifest.json not found');
    await expect(createMacosDev(OPTIONS, w.deps).start()).resolves.toBe('install-failed');
    const report = w.logs.filter((line) => line.includes('NOT installed'));
    expect(report).toHaveLength(1);
    expect(report[0]).toMatch(/unknownError: manifest\.json not found/);
    expect(report[0]).not.toContain('\n');
  });
});

describe('createMacosDev: rebuild', () => {
  it('installs again after a rebuild and never calls `open` again', async () => {
    const w = world(false);
    const dev = createMacosDev(OPTIONS, w.deps);
    await dev.start();
    w.calls.length = 0;
    await expect(dev.rebuild()).resolves.toBe('installed');
    await expect(dev.rebuild()).resolves.toBe('installed');
    expect(w.calls).toEqual(['build', 'install', 'build', 'install']);
    expect(w.opens).toHaveLength(1);
    expect(w.installs).toHaveLength(3);
    expect(w.logs.filter((line) => line.includes('reloaded'))).toHaveLength(2);
  });

  it('installs nothing after a failed build', async () => {
    const w = world(true);
    const dev = createMacosDev(OPTIONS, w.deps);
    await dev.start();
    w.calls.length = 0;
    w.state.buildOk = false;
    await expect(dev.rebuild()).resolves.toBe('build-failed');
    expect(w.calls).toEqual(['build']);
  });

  it('reports a failed install in one line, does not throw, does not restart Firefox, and tries again next time', async () => {
    const w = world(true);
    const dev = createMacosDev(OPTIONS, w.deps);
    await dev.start();
    w.logs.length = 0;

    // Firefox was closed: the port is dead and the install is refused.
    w.state.portOpensAt = null;
    w.state.installError = new Error('cannot connect to the Firefox debugger at 127.0.0.1:6111 (connect ECONNREFUSED 127.0.0.1:6111).');
    await expect(dev.rebuild()).resolves.toBe('install-failed');
    expect(w.logs).toHaveLength(1);
    expect(w.logs[0]).toMatch(/NOT installed — cannot connect to the Firefox debugger at 127\.0\.0\.1:6111/);
    expect(w.logs[0]).not.toContain('\n');
    expect(w.opens).toEqual([]);

    w.state.installError = null;
    await expect(dev.rebuild()).resolves.toBe('installed');
    expect(w.opens).toEqual([]);
  });

  it('survives a build that throws', async () => {
    const w = world(true);
    const dev = createMacosDev(OPTIONS, {
      ...w.deps,
      build: () => {
        throw new Error('spawn wxt ENOENT');
      },
    });
    await expect(dev.rebuild()).resolves.toBe('build-failed');
    expect(w.logs.join('\n')).toMatch(/build failed — spawn wxt ENOENT/);
    expect(w.installs).toEqual([]);
  });

  it('runs rebuilds one after another: a build never starts while an install is in flight', async () => {
    const w = world(true);
    const dev = createMacosDev(OPTIONS, w.deps);
    await dev.start();
    w.calls.length = 0;

    let release: () => void = () => undefined;
    w.state.installGate = new Promise((resolve) => {
      release = resolve;
    });
    const first = dev.rebuild();
    const second = dev.rebuild();
    await Promise.resolve();
    await Promise.resolve();
    expect(w.calls).toEqual(['build', 'install']);

    release();
    await expect(first).resolves.toBe('installed');
    await expect(second).resolves.toBe('installed');
    expect(w.calls).toEqual(['build', 'install', 'build', 'install']);
  });
});

describe('waitForPort', () => {
  it('returns at once when the port answers', async () => {
    const w = world(true);
    await waitForPort(6111, w.deps);
    expect(w.calls).toEqual(['probe 6111']);
    expect(w.clock.now).toBe(1_000);
  });

  it('polls at the given interval and gives up at the given timeout', async () => {
    const w = world(false);
    await expect(waitForPort(6222, w.deps, 2_000, 500)).rejects.toThrow(/debugger port 6222 within 2 s.*--debugger-port or CG_DEV_DEBUGGER_PORT/);
    expect(w.calls).toEqual(Array.from({ length: 5 }, () => 'probe 6222'));
    expect(w.clock.now).toBe(3_000);
  });
});

describe('runOpen', () => {
  type Listener = (value: never) => void;

  /** A spawn that starts nothing: records the call and lets the test fire `exit` or `error`. */
  function fakeSpawn(): { spawned: Array<{ command: string; args: string[] }>; emit: (event: 'exit' | 'error', value: number | null | Error) => void; spawn: (command: string, args: readonly string[]) => SpawnedOpen } {
    const spawned: Array<{ command: string; args: string[] }> = [];
    const listeners = new Map<string, Listener>();
    return {
      spawned,
      emit: (event, value) => listeners.get(event)?.(value as never),
      spawn: (command, args) => {
        spawned.push({ command, args: [...args] });
        return {
          on(event: string, listener: Listener) {
            listeners.set(event, listener);
            return this;
          },
        };
      },
    };
  }

  it('runs /usr/bin/open with the arguments and resolves on exit 0', async () => {
    const fake = fakeSpawn();
    const done = runOpen(OPEN_ARGS, fake.spawn);
    expect(fake.spawned).toEqual([{ command: OPEN_BIN, args: OPEN_ARGS }]);
    expect(OPEN_BIN).toBe('/usr/bin/open');
    fake.emit('exit', 0);
    await expect(done).resolves.toBeUndefined();
  });

  it('rejects when `open` exits with an error', async () => {
    const fake = fakeSpawn();
    const done = runOpen(OPEN_ARGS, fake.spawn);
    fake.emit('exit', 1);
    await expect(done).rejects.toThrow(/`open` failed \(exit code 1\).*--firefox-app/);
  });

  it('rejects when `open` cannot be run', async () => {
    const fake = fakeSpawn();
    const done = runOpen(OPEN_ARGS, fake.spawn);
    fake.emit('error', new Error('spawn /usr/bin/open ENOENT'));
    await expect(done).rejects.toThrow(/could not run \/usr\/bin\/open: spawn \/usr\/bin\/open ENOENT/);
  });
});
