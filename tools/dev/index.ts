// `pnpm dev`: TEST build (CG_TEST_HOSTS=1) in a dedicated, persistent Firefox
// profile: .dev-profile/ in the repo (gitignored), or the directory named by
// CG_DEV_PROFILE (tools/dev/profile.ts). The owner signs in to ChatSpace in
// that profile once (X9); live checks only in the test chat.
//
// macOS: Firefox is started by LaunchServices (`open`) with its debugger
// server on a loopback port, and the build is installed — and after every
// rebuild installed again, which reloads it — as a temporary add-on over that
// port (launch-macos.ts, rdp.ts). Never a child Firefox, never `web-ext run`:
// starting the Firefox binary from an agent's shell breaks the machine's Orca
// Computer Use accessibility permission system-wide. Ctrl+C stops the watcher
// only; Firefox keeps running and the next `pnpm dev` picks it up by its port.
// Other platforms: `web-ext run`, which reloads the add-on on a rebuild itself.
//
// Flags: --no-watch (build and install once). macOS: --url <url> (the page to
// open on start, none by default), --debugger-port <n> (or
// CG_DEV_DEBUGGER_PORT), --firefox-app <name-or-path> (default Firefox).
// Other platforms: --firefox <binary> (default FIREFOX_BIN, else `firefox`).
//
// This file only wires the real effects; the logic and its tests are in the
// modules next to it.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, watch } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import { EXTENSION_ROOT, fail, REPO_ROOT, TEST_DIR } from '../lib/paths.ts';
import { createMacosDev, runOpen, type DevOutcome } from './launch-macos.ts';
import { devRunner, parseDevOptions, type DevOptions } from './options.ts';
import { ensureDevPrefs } from './prefs.ts';
import { devProfileDir } from './profile.ts';
import { installTemporaryAddon, probePort } from './rdp.ts';

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function readOptions(): DevOptions {
  try {
    return parseDevOptions(process.argv.slice(2));
  } catch (error) {
    fail(`dev: ${reason(error)}`);
  }
}

const options = readOptions();
const profileDir = devProfileDir(REPO_ROOT);
const wxt = `${EXTENSION_ROOT}node_modules/.bin/wxt`;
const webExt = `${REPO_ROOT}node_modules/.bin/web-ext`;

function buildTest(): boolean {
  const result = spawnSync(wxt, ['build', '-b', 'firefox', '--mv3'], {
    cwd: EXTENSION_ROOT,
    env: { ...process.env, CG_TEST_HOSTS: '1' },
    stdio: 'inherit',
  });
  return result.status === 0;
}

/** Calls back (debounced) on a change under packages/ or apps/extension/. */
function watchSources(onChange: (file: string) => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ignored = /(^|\/)(node_modules|\.output|\.wxt|\.tsbuild)(\/|$)|\.test\.tsx?$/;
  const listener = (_event: string, file: string | null): void => {
    if (file && ignored.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => onChange(file ?? '?'), 300);
  };
  watch(`${REPO_ROOT}packages`, { recursive: true }, listener);
  for (const dir of ['src', 'lazy', 'build', 'public']) watch(`${EXTENSION_ROOT}${dir}`, { recursive: true }, listener);
}

async function devMacos(): Promise<void> {
  if (options.firefoxBinary !== undefined) console.log('dev: --firefox is not used on macOS (Firefox starts through LaunchServices; the application is --firefox-app)');
  const dev = createMacosDev(
    { profileDir, addonPath: TEST_DIR, port: options.debuggerPort, firefoxApp: options.firefoxApp, url: options.url },
    {
      build: buildTest,
      prepareProfile: (dir) => {
        const outcome = ensureDevPrefs(dir);
        if (outcome !== 'unchanged') console.log(`dev: user.js ${outcome} with the dev prefs (Firefox reads it on its next start)`);
      },
      open: (args) => runOpen(args, (command, openArgs) => spawn(command, [...openArgs], { stdio: 'inherit' })),
      probe: (port) => probePort(port),
      install: (port, addonPath) => installTemporaryAddon({ port, addonPath }),
      sleep: (ms) => sleep(ms),
      now: () => Date.now(),
      log: (line) => console.log(line),
    },
  );

  let outcome: DevOutcome;
  try {
    outcome = await dev.start();
  } catch (error) {
    fail(`dev: ${reason(error)}`);
  }
  if (outcome === 'build-failed') process.exit(1);
  if (!options.watch) process.exit(outcome === 'installed' ? 0 : 1);

  console.log('dev: watching packages/ and apps/extension/ — Ctrl+C stops the watcher, Firefox keeps running');
  watchSources((file) => {
    console.log(`dev: change in ${file} → rebuilding the test build`);
    void dev.rebuild();
  });
}

function devWebExt(): void {
  // Belt and braces: this path makes Firefox a child process.
  if (devRunner(process.platform) !== 'web-ext') fail('dev: `web-ext run` is not used on macOS.');
  if (!buildTest()) process.exit(1);
  mkdirSync(profileDir, { recursive: true });
  console.log(`dev: Firefox profile ${profileDir}`);

  const firefox = options.firefoxBinary ?? process.env['FIREFOX_BIN'] ?? 'firefox';
  const runner = spawn(
    webExt,
    ['run', '--target', 'firefox-desktop', '--source-dir', TEST_DIR, '--firefox', firefox, '--firefox-profile', profileDir, '--profile-create-if-missing', '--keep-profile-changes'],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  runner.on('exit', (code) => process.exit(code ?? 0));

  if (options.watch) {
    watchSources((file) => {
      console.log(`dev: change in ${file} → rebuilding the test build`);
      buildTest();
    });
  }
}

if (devRunner(process.platform) === 'launch-services') await devMacos();
else devWebExt();
