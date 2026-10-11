// Whether the Firefox of a native macOS e2e run can start at all — asked once,
// before the run, by e2e/wdio.conf.ts.
//
// Firefox opens its application-data folder (~/Library/Application
// Support/Firefox: profiles.ini, installs.ini) on every start, also with the
// throwaway `-profile` geckodriver gives it. A process that is denied that
// folder gets a Firefox that prints «Could not find profile folder.» and exits
// with status 1 before the first session, so every spec of the run fails the
// same way. The Claude desktop agent shell is such a process: its harness keeps
// browser profile folders away from the agent (2026-10-11: 35 specs of 35
// failed in about 70 seconds). That guardrail is not ours to work around — no
// redirected home, no switched-off sandbox; the run that works there is the one
// in the pinned image, tools/ci/e2e-docker-local.sh.
//
// Only the stock application on macOS is judged: another build (FIREFOX_BIN)
// may keep its data elsewhere, and off macOS the folder is another one. The
// check is access(2) on the folder for reading: nothing in it is listed or
// opened, and no Firefox is started to find out (AGENTS.md «Commands»).
//
// Beside the stand because it is part of the e2e harness: like the rest of it,
// it stays out of the AMO sources archive.

import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The stock Firefox of a Mac: what the e2e run starts there unless FIREFOX_BIN names another binary. */
export const MAC_FIREFOX_BINARY = '/Applications/Firefox.app/Contents/MacOS/firefox';
/** Where that Firefox keeps profiles.ini, under the home directory. */
const MAC_FIREFOX_DATA = ['Library', 'Application Support', 'Firefox'] as const;

export interface FirefoxAccessWorld {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  /** access(2) for reading; throws what `fs.accessSync` throws. */
  readonly canRead: (path: string) => void;
}

const real: FirefoxAccessWorld = { platform: process.platform, home: homedir(), canRead: (path) => accessSync(path, constants.R_OK) };

/**
 * Why the Firefox at `binary` cannot start from this process, or null: it can, or it is not for this check to
 * say. A folder that is not there is no refusal — Firefox makes it on its first start.
 */
export function firefoxStartRefusal(binary: string | undefined, world: FirefoxAccessWorld = real): string | null {
  if (world.platform !== 'darwin' || binary !== MAC_FIREFOX_BINARY) return null;
  const folder = join(world.home, ...MAC_FIREFOX_DATA);
  try {
    world.canRead(folder);
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EACCES') return null;
    return [
      `Firefox cannot start from this shell, so no spec can run: this process may not read "${folder}" (${code}).`,
      'Firefox opens that folder on every start, also with the throwaway profile of a test run, and exits with «Could not find profile folder.» before the first session.',
      'A sandboxed agent shell (the Claude desktop one) is set up this way on purpose: do not work around it.',
      'Run the suite in the pinned image instead: tools/ci/e2e-docker-local.sh (CG_E2E_VOLUME=<a name of your own> when another session may be using the default volume).',
    ].join('\n');
  }
}
