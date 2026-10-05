// `pnpm dev` on macOS. A windowed Firefox is not made a child of this process
// there — a caution, not a proven mechanism: twice after an agent's shell
// started one directly the machine lost its Orca Computer Use accessibility
// permission, and later it dropped with no such launch at all (AGENTS.md
// «Commands»). So Firefox is started by LaunchServices (`open -n -a Firefox
// --args …`) with its debugger server on a loopback port, and the test build
// is installed as a temporary add-on over that port (rdp.ts) — and installed
// again after every rebuild, which reloads it. No `web-ext run`, no child
// Firefox, and nothing to kill on exit: Firefox outlives the watcher.
//
// One profile — one port (profile.ts), and a port is never trusted by itself.
// A port that already answers is asked which profile its Firefox runs BEFORE
// anything is built or installed: the dev Firefox of this profile, left by an
// earlier `pnpm dev`, is reused and never doubled; a Firefox of another
// profile — a person's signed-in one, another worktree's — is refused by name,
// and so is a listener that is not a Firefox debugger at all. The install
// itself asks again, in its own connection. Both refusals end the run: a
// watcher never keeps failing against a port that is not ours.
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

/**
 * Why a debugger port did not take a request (rdp.ts `RdpFailure`): nothing listens; something listens that is
 * not a Firefox debugger; a Firefox of another profile; a Firefox debugger that failed.
 */
export type PortFailure = 'no-listener' | 'not-a-debugger' | 'other-profile' | 'failed';

/** What a running Firefox says about its profile (profile.ts `RunningProfile`). */
export interface RunningProfile {
  readonly marker: string | null;
  readonly name: string | null;
}

/** `same: false` — `running` names the other profile as far as it could be told. */
export type ProfileCheck = { readonly same: true; readonly exact: boolean } | { readonly same: false; readonly running: string };

export interface MacosDevDeps {
  /** Builds the test flavor; false — the build failed. */
  readonly build: () => boolean;
  /** Creates the profile directory and puts the dev prefs and the profile's marker into its user.js (prefs.ts). */
  readonly prepareProfile: (profileDir: string) => void;
  /** Runs `open` with these arguments; rejects when it fails. */
  readonly open: (args: readonly string[]) => Promise<void>;
  /** True when the debugger port accepts a TCP connection. */
  readonly probe: (port: number) => Promise<boolean>;
  /** Asks the Firefox behind the port which profile it runs; rejects with an error whose `kind` is a PortFailure. */
  readonly identify: (port: number) => Promise<RunningProfile>;
  /** Whether that is the profile of this run (profile.ts `checkRunningProfile`). */
  readonly check: (running: RunningProfile, profileDir: string) => ProfileCheck;
  /**
   * Installs — or, when it is installed already, reloads — the temporary add-on, after asking the Firefox in
   * the same connection that it runs `profileDir`. Rejects with an error whose `kind` is a PortFailure.
   */
  readonly install: (port: number, addonPath: string, profileDir: string) => Promise<{ readonly addonId: string | null }>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly log: (line: string) => void;
}

/** `port-lost` — the port is no longer (or never was) the dev Firefox of this profile: the run ends. */
export type DevOutcome = 'installed' | 'build-failed' | 'install-failed' | 'port-lost';

export interface MacosDev {
  /**
   * Prepare the profile, check the port, build, start Firefox (or reuse the
   * running one of this profile), install. Rejects when the port is answered
   * by anything but the dev Firefox of this profile, when Firefox cannot be
   * started or never opens the port; a failed build or install is an outcome,
   * already reported.
   */
  start(): Promise<DevOutcome>;
  /**
   * Build again and, when the build is good, install again (= reload). Never
   * starts Firefox and never rejects: a closed Firefox is one reported line,
   * and the next rebuild tries again. `port-lost` — the port now belongs to
   * something else: reported once, and the caller stops. Calls run one after
   * another.
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
          'If a Firefox with this profile is already running — without a debugger port, or with another one ' +
          '(a Firefox started by an older `pnpm dev` listens on 6111) — close it and run `pnpm dev` again, or name its port: ' +
          '--debugger-port or CG_DEV_DEBUGGER_PORT.',
      );
    }
    await deps.sleep(pollMs);
  }
}

const oneLine = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();

const PORT_FAILURES: readonly PortFailure[] = ['no-listener', 'not-a-debugger', 'other-profile', 'failed'];

/** The PortFailure an error of `identify` or `install` carries; `failed` when it names none. */
export function portFailureOf(error: unknown): PortFailure {
  const kind = typeof error === 'object' && error !== null ? (error as { readonly kind?: unknown }).kind : undefined;
  return PORT_FAILURES.find((known) => known === kind) ?? 'failed';
}

const OTHER_PORT = 'another port: --debugger-port <n> or CG_DEV_DEBUGGER_PORT';

/** Port N is answered by something that is not a Firefox debugger. */
export const notOurFirefox = (port: number, detail: string): string =>
  `port ${port} is answered by something that is not our dev Firefox (${detail}) — free the port or pass ${OTHER_PORT}. Nothing was installed.`;

/** Port N is the debugger of a Firefox that runs another profile. */
export const otherProfile = (port: number, running: string, profileDir: string): string =>
  `port ${port} is the debugger of a Firefox that runs ANOTHER profile: ${running} — not the dev profile ${profileDir}. Nothing was installed there. ` +
  `Each profile has a debugger port of its own; for this profile pass ${OTHER_PORT}, or close that Firefox.`;

export function createMacosDev(options: MacosDevOptions, deps: MacosDevDeps): MacosDev {
  const { port, profileDir } = options;
  /** The rebuild in flight: the next one starts after it, so a build never stalls an install half-way. */
  let last: Promise<unknown> = Promise.resolve();
  /** The port stopped being ours: nothing more is built or installed. */
  let lost = false;

  /**
   * The Firefox behind the port runs this profile, or this throws with the reason: not a Firefox debugger,
   * or a Firefox of another profile — both named, with the way out.
   */
  async function verify(): Promise<void> {
    let running: RunningProfile;
    try {
      running = await deps.identify(port);
    } catch (error) {
      const kind = portFailureOf(error);
      if (kind === 'no-listener') throw new Error(`nothing answers on port ${port} any more (${oneLine(error)}).`, { cause: error });
      throw new Error(kind === 'not-a-debugger' ? notOurFirefox(port, oneLine(error)) : `the Firefox debugger on port ${port} did not say which profile it runs — ${oneLine(error)}`, { cause: error });
    }
    const check = deps.check(running, profileDir);
    if (!check.same) throw new Error(otherProfile(port, check.running, profileDir));
    if (!check.exact) deps.log(`dev: the Firefox on port ${port} was started before the profile marker existed — matched by the name of its profile directory only; after its next restart the match is exact`);
  }

  async function deliver(done: string): Promise<DevOutcome> {
    try {
      const { addonId } = await deps.install(port, options.addonPath, profileDir);
      deps.log(`dev: add-on ${done} (${addonId ?? 'no id reported'})`);
      return 'installed';
    } catch (error) {
      const kind = portFailureOf(error);
      if (kind === 'not-a-debugger' || kind === 'other-profile') {
        lost = true;
        deps.log(`dev: add-on NOT installed — ${kind === 'not-a-debugger' ? notOurFirefox(port, oneLine(error)) : `${oneLine(error)} Pass ${OTHER_PORT}, or close that Firefox.`}`);
        return 'port-lost';
      }
      if (kind === 'no-listener') {
        deps.log(`dev: add-on NOT installed — nothing answers on port ${port}: the dev Firefox was closed. The next rebuild tries again; to start Firefox again, restart pnpm dev.`);
        return 'install-failed';
      }
      deps.log(`dev: add-on NOT installed — ${oneLine(error)} The next rebuild tries again.`);
      return 'install-failed';
    }
  }

  async function start(): Promise<DevOutcome> {
    deps.prepareProfile(profileDir);
    deps.log(`dev: Firefox profile ${profileDir}, debugger port ${port}`);
    // Whose port it is comes first: nothing is built for, started next to or installed into a Firefox that is not ours.
    const running = await deps.probe(port);
    if (running) {
      await verify();
      deps.log(`dev: the dev Firefox of this profile already runs with its debugger on port ${port} — using it, not starting another`);
    }
    if (!deps.build()) return 'build-failed';
    if (!running) {
      await deps.open(openArgs(options));
      deps.log(`dev: Firefox started through LaunchServices; waiting for its debugger on port ${port}`);
      await waitForPort(port, deps, options.portWaitMs, options.portPollMs);
      await verify();
    }
    return deliver('installed');
  }

  async function rebuildOnce(): Promise<DevOutcome> {
    if (lost) return 'port-lost';
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
