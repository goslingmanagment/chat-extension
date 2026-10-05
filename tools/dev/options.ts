// Command line and environment of `pnpm dev`, and which runner a platform
// gets. Pure: index.ts passes argv and env in and prints what is thrown here.

import { parseArgs } from 'node:util';

/**
 * The port every profile shared before each got its own (profile.ts `devDebuggerPort`). It stays the fixed port
 * of the owner's durable profile, passed explicitly (README «Живые проверки»); nothing defaults to it any more.
 */
export const OWNER_PROFILE_DEBUGGER_PORT = 6111;
export const DEBUGGER_PORT_ENV = 'CG_DEV_DEBUGGER_PORT';
/** What `open -a` gets: an application name or a path to an .app. */
export const DEFAULT_FIREFOX_APP = 'Firefox';

export interface DevOptions {
  /** Rebuild on change (default); `--no-watch` builds once. */
  readonly watch: boolean;
  /** `--firefox <binary>`: for `web-ext run` only (there FIREFOX_BIN is the fallback); never used on macOS. */
  readonly firefoxBinary: string | undefined;
  /** macOS: `--firefox-app <name-or-path>`. */
  readonly firefoxApp: string;
  /** macOS: `--debugger-port <n>`, else CG_DEV_DEBUGGER_PORT; undefined — the port derived from the profile (profile.ts). */
  readonly debuggerPort: number | undefined;
  /** macOS: `--url <url>`, the page to open on start. None by default: the launcher never opens the live site itself. */
  readonly url: string | undefined;
}

export type DevRunner = 'launch-services' | 'web-ext';

/** macOS never gets a child Firefox (launch-macos.ts; AGENTS.md «Commands»). */
export const devRunner = (platform: string): DevRunner => (platform === 'darwin' ? 'launch-services' : 'web-ext');

export function parseDebuggerPort(raw: string, source: string): number {
  const text = raw.trim();
  const port = /^\d{1,5}$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`${source}: "${raw}" is not a TCP port (1–65535).`);
  return port;
}

export function parseDevOptions(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): DevOptions {
  // `pnpm dev -- --no-watch` hands the `--` over as well.
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const { values } = parseArgs({
    args,
    options: {
      watch: { type: 'boolean', default: true },
      'no-watch': { type: 'boolean', default: false },
      firefox: { type: 'string' },
      'firefox-app': { type: 'string' },
      'debugger-port': { type: 'string' },
      url: { type: 'string' },
    },
  });

  const portFlag = values['debugger-port'];
  const portEnv = env[DEBUGGER_PORT_ENV]?.trim();
  let debuggerPort: number | undefined;
  if (portFlag !== undefined) debuggerPort = parseDebuggerPort(portFlag, '--debugger-port');
  else if (portEnv !== undefined && portEnv !== '') debuggerPort = parseDebuggerPort(portEnv, DEBUGGER_PORT_ENV);

  const firefoxApp = values['firefox-app'] ?? DEFAULT_FIREFOX_APP;
  if (firefoxApp.trim() === '') throw new Error('--firefox-app: an application name or a path to an .app is expected.');

  // An absolute URL also cannot be mistaken by Firefox for one of its flags.
  const url = values.url;
  if (url !== undefined && !URL.canParse(url)) throw new Error(`--url: "${url}" is not an absolute URL.`);

  return {
    watch: values.watch && !values['no-watch'],
    firefoxBinary: values.firefox,
    firefoxApp,
    debuggerPort,
    url,
  };
}
