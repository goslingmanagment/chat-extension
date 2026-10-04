// The browser and OS the extension runs on (`client_health.client`, the
// diagnostics header; §5.7, LG-016; EX-018): Firefox's own
// `runtime.getBrowserInfo`, with the user agent as a fallback.

import { defaultBrowser, type BrowserApi } from './browser-api';

export type ClientOs = 'windows' | 'macos' | 'linux' | 'other';

export interface ClientEnv {
  readonly extensionVersion: string;
  readonly browser: 'firefox';
  /** null — not known. */
  readonly browserMajor: number | null;
  readonly os: ClientOs;
}

/** The version of the manifest, read at once (an extension page prints it before anything answered); `0.0.0` — unreadable. */
export function extensionVersionOf(api: BrowserApi = defaultBrowser()): string {
  try {
    return api.runtime.getManifest().version;
  } catch {
    return '0.0.0';
  }
}

/** `runtime.getPlatformInfo().os` → our four values. */
export function clientOsOf(os: string | undefined): ClientOs {
  switch (os ?? '') {
    case 'win':
      return 'windows';
    case 'mac':
      return 'macos';
    case 'linux':
      return 'linux';
    default:
      return 'other';
  }
}

/** Major version from `142.0.1` or from a user agent's `Firefox/142.0`. */
export function majorVersionOf(text: string | undefined): number | null {
  if (typeof text !== 'string') return null;
  const match = /(?:^|Firefox\/)(\d{1,4})(?:\.|$)/.exec(text);
  const major = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  return Number.isInteger(major) && major > 0 ? major : null;
}

export async function readClientEnv(api: BrowserApi = defaultBrowser(), userAgent: string | undefined = globalThis.navigator?.userAgent): Promise<ClientEnv> {
  const extensionVersion = extensionVersionOf(api);
  let browserMajor: number | null = null;
  try {
    const info = await api.runtime.getBrowserInfo?.();
    browserMajor = majorVersionOf(info?.version);
  } catch {
    // fall back to the user agent
  }
  browserMajor ??= majorVersionOf(userAgent);
  let os: ClientOs = 'other';
  try {
    os = clientOsOf((await api.runtime.getPlatformInfo()).os);
  } catch {
    // unknown
  }
  return { extensionVersion, browser: 'firefox', browserMajor, os };
}
