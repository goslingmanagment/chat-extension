// `pnpm dev` on macOS. Firefox must never be a child of this process there:
// starting the Firefox binary from an agent's shell breaks the machine's Orca
// Computer Use accessibility permission system-wide. So Firefox is started by
// LaunchServices (`open -n -a Firefox --args …`) with its debugger server on a
// loopback port, and the test build is installed as a temporary add-on over
// that port (rdp.ts) — and installed again after every rebuild, which reloads
// it. No `web-ext run`, no child Firefox, and nothing to kill on exit: Firefox
// outlives the watcher.
//
// A port that already answers is the dev Firefox of an earlier `pnpm dev`: it
// is reused, never doubled (one profile — one running Firefox).
//
// Every effect is injected (MacosDevDeps): the flow is tested without Firefox,
// `open` or the network, and index.ts wires the real ones.

import { isAbsolute } from 'node:path';

export const OPEN_BIN = '/usr/bin/open';
/** How long a freshly started Firefox gets to open its debugger port. */
export const PORT_WAIT_MS = 60_000;
export const PORT_POLL_MS = 250;

export interface MacosDevOptions {
  /** Absolute: LaunchServices starts the app with another working directory. */
  readonly profileDir: string;
  /** Absolute directory of the built test extension. */
  readonly addonPath: string;
  readonly port: number;
  /** For `open -a`: an application name or a path to an .app. */
  readonly firefoxApp: string;
  /** The page to open on start. None by default: the launcher never opens the live site itself. */
  readonly url?: string | undefined;
  readonly portWaitMs?: number;
  readonly portPollMs?: number;
}

export interface MacosDevDeps {
  /** Builds the test flavor; false — the build failed. */
  readonly build: () => boolean;
  /** Creates the profile directory and puts the dev prefs into its user.js (prefs.ts). */
  readonly prepareProfile: (profileDir: string) => void;
  /** Runs `open` with these arguments; rejects when it fails. */
  readonly open: (args: readonly string[]) => Promise<void>;
  /** True when the debugger port accepts a TCP connection. */
  readonly probe: (port: number) => Promise<boolean>;
  /** Installs — or, when it is installed already, reloads — the temporary add-on. */
  readonly install: (port: number, addonPath: string) => Promise<{ readonly addonId: string | null }>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly log: (line: string) => void;
}

export type DevOutcome = 'installed' | 'build-failed' | 'install-failed';

export interface MacosDev {
  /**
   * Build, prepare the profile, start Firefox (or reuse the running one),
   * install. Rejects when Firefox cannot be started or never opens the port;
   * a failed build or install is an outcome, already reported.
   */
  start(): Promise<DevOutcome>;
  /**
   * Build again and, when the build is good, install again (= reload). Never
   * starts Firefox and never rejects: a closed Firefox is one reported line,
   * and the next rebuild tries again. Calls run one after another.
   */
  rebuild(): Promise<DevOutcome>;
}

/** The arguments of `open`: a new Firefox instance on this profile with the debugger server on. */
export function openArgs(options: Pick<MacosDevOptions, 'profileDir' | 'port' | 'firefoxApp' | 'url'>): string[] {
  if (!isAbsolute(options.profileDir)) throw new Error(`the Firefox profile path must be absolute, got "${options.profileDir}".`);
  const args = ['-n', '-a', options.firefoxApp, '--args', '-profile', options.profileDir, '-no-remote', '-start-debugger-server', String(options.port)];
  return options.url === undefined ? args : [...args, options.url];
}

/** What `runOpen` needs of a spawned `open`. */
export interface SpawnedOpen {
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
}
export type SpawnOpen = (command: string, args: readonly string[]) => SpawnedOpen;

/**
 * Runs `open` and waits for it to exit: it returns once LaunchServices has
 * taken the request, Firefox itself is not its child and not ours. The spawn
 * function is always passed in, so a test cannot start anything.
 */
export function runOpen(args: readonly string[], spawnOpen: SpawnOpen): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnOpen(OPEN_BIN, args);
    child.on('error', (error) => reject(new Error(`could not run ${OPEN_BIN}: ${error.message}`)));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`\`open\` failed (exit code ${code ?? 'none'}) — is the application installed? Another name or path: --firefox-app.`));
    });
  });
}

/** Polls the debugger port until it answers; rejects after the timeout. */
export async function waitForPort(
  port: number,
  deps: Pick<MacosDevDeps, 'probe' | 'sleep' | 'now'>,
  timeoutMs: number = PORT_WAIT_MS,
  pollMs: number = PORT_POLL_MS,
): Promise<void> {
  const deadline = deps.now() + timeoutMs;
  for (;;) {
    if (await deps.probe(port)) return;
    if (deps.now() >= deadline) {
      throw new Error(
        `Firefox did not open its debugger port ${port} within ${Math.round(timeoutMs / 1000)} s. ` +
          'If a Firefox with this profile was already running without that port, close it and run `pnpm dev` again; ' +
          'another port: --debugger-port or CG_DEV_DEBUGGER_PORT.',
      );
    }
    await deps.sleep(pollMs);
  }
}

const oneLine = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();

export function createMacosDev(options: MacosDevOptions, deps: MacosDevDeps): MacosDev {
  const { port } = options;
  /** The rebuild in flight: the next one starts after it, so a build never stalls an install half-way. */
  let last: Promise<unknown> = Promise.resolve();

  async function deliver(done: string): Promise<DevOutcome> {
    try {
      const { addonId } = await deps.install(port, options.addonPath);
      deps.log(`dev: add-on ${done} (${addonId ?? 'no id reported'})`);
      return 'installed';
    } catch (error) {
      deps.log(`dev: add-on NOT installed — ${oneLine(error)} Is that Firefox still open? The next rebuild tries again; to start Firefox again, restart pnpm dev.`);
      return 'install-failed';
    }
  }

  async function start(): Promise<DevOutcome> {
    if (!deps.build()) return 'build-failed';
    deps.prepareProfile(options.profileDir);
    deps.log(`dev: Firefox profile ${options.profileDir}`);
    if (await deps.probe(port)) {
      deps.log(`dev: a Firefox debugger already answers on port ${port} — using that Firefox, not starting another`);
    } else {
      await deps.open(openArgs(options));
      deps.log(`dev: Firefox started through LaunchServices; waiting for its debugger on port ${port}`);
      await waitForPort(port, deps, options.portWaitMs, options.portPollMs);
    }
    return deliver('installed');
  }

  async function rebuildOnce(): Promise<DevOutcome> {
    try {
      if (deps.build()) return await deliver('reloaded');
      deps.log('dev: build failed — the add-on in Firefox is left as it is');
    } catch (error) {
      deps.log(`dev: build failed — ${oneLine(error)}`);
    }
    return 'build-failed';
  }

  return {
    start,
    rebuild() {
      const run = last.then(rebuildOnce);
      last = run;
      return run;
    },
  };
}
