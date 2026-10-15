// What the old Fansly extension's TEST build changes in its source text, at
// build time (R20 P3d): every address of fansly.com, apiv3, wsv3 and the
// production hub that its code compiles in, pointed at the Fansly perf stand
// (ports.ts) — nothing else. Its sources stay as released: build.ts loads these
// rules into esbuild through a plugin, never into a file.
//
// A rule names its file, the exact text and how many times that text stands in
// the file of the release this was written for (fansly-chat 2.12.0). build.ts
// refuses a source where a count differs — a later release that moved or added
// an address must be read again, not built half-pointed at the live site.
//
// What stays: the fan-avatar check of «Новые» (`shared/followers.ts`, `https:`
// on `*.fansly.com`) — it only decides whether an `<img>` is drawn, and the
// perf scenario never opens «Новые»; words in texts («Открой fansly.com…»); comments.

import type { FanslyPerfPorts } from '../ports.ts';

export interface SourceRule {
  /** Path inside the old extension's checkout. */
  readonly file: string;
  readonly from: string;
  readonly to: string;
  /** Occurrences of `from` in the file of the release the rules were written for. */
  readonly count: number;
}

/** The release these rules were read against (its git tag in fansly-chat). */
export const RULES_RELEASE = '2.12.0';

export function standRules(ports: FanslyPerfPorts): readonly SourceRule[] {
  const page = `http://localhost:${String(ports.fansly)}`;
  const api = `http://localhost:${String(ports.fanslyApi)}/api/v1`;
  const hub = `http://127.0.0.1:${String(ports.hub)}`;
  return [
    // The hub: the default address (the setting is seeded with the fake hub anyway) and the extension's own pages on
    // ext.gosling-agency.ru (start page, changelog) — the fake hub answers them 404 and journals them.
    { file: 'src/shared/constants.ts', from: `'https://gosling-agency.ru'`, to: `'${hub}'`, count: 1 },
    { file: 'src/shared/constants.ts', from: `'https://ext.gosling-agency.ru/`, to: `'${hub}/__old-extension/`, count: 3 },
    // The hint in the settings' hub field (a text, but an address all the same: no live address stays in the build).
    { file: 'src/options/copy.ts', from: `baseUrlPlaceholder: 'https://gosling-agency.ru'`, to: `baseUrlPlaceholder: '${hub}'`, count: 1 },
    // Fansly's API: the base the shared code reads, the relay frame's target, and the background client's own URLs.
    { file: 'src/shared/constants.ts', from: `'https://apiv3.fansly.com/api/v1'`, to: `'${api}'`, count: 1 },
    { file: 'src/shared/fansly-relay-protocol.ts', from: `'https://apiv3.fansly.com/api/v1/'`, to: `'${api}/'`, count: 1 },
    { file: 'src/background/fansly-client.ts', from: 'https://apiv3.fansly.com/api/v1/', to: `${api}/`, count: 15 },
    // The session capture's webRequest filter: a match pattern has no port.
    { file: 'src/background/session-capture.ts', from: `'https://apiv3.fansly.com/*'`, to: `'http://localhost/*'`, count: 1 },
    // The MAIN socket tap: which socket is Fansly's.
    { file: 'src/content/page-socket-tap.ts', from: `'wsv3.fansly.com'`, to: `'localhost'`, count: 1 },
    { file: 'src/content/page-socket-tap.ts', from: `parsed.protocol === 'wss:'`, to: `parsed.protocol === 'ws:'`, count: 1 },
    // Which tab is a Fansly tab, and which sender is the Fansly page.
    { file: 'src/background/runtime-api.ts', from: `'*://fansly.com/*'`, to: `'*://localhost/*'`, count: 1 },
    {
      file: 'src/background/runtime-api.ts',
      from: `url.protocol !== 'https:' || url.hostname !== 'fansly.com'`,
      to: `url.protocol !== 'http:' || url.hostname !== 'localhost'`,
      count: 1,
    },
    { file: 'src/background/message-sound-runtime.ts', from: `'https://fansly.com/'`, to: `'${page}/'`, count: 1 },
    {
      file: 'src/background/message-sound-runtime.ts',
      from: `url.protocol === 'https:' && url.hostname === 'fansly.com'`,
      to: `url.protocol === 'http:' && url.hostname === 'localhost'`,
      count: 1,
    },
    { file: 'src/background/followers-runtime.ts', from: `'https://fansly.com/'`, to: `'${page}/'`, count: 1 },
    { file: 'src/background/index.ts', from: `'*://fansly.com/*'`, to: `'*://localhost/*'`, count: 1 },
    { file: 'src/background/compare-operations.ts', from: `includes('fansly.com')`, to: `includes('localhost:${String(ports.fansly)}')`, count: 1 },
    { file: 'src/background/operations.ts', from: `includes('fansly.com')`, to: `includes('localhost:${String(ports.fansly)}')`, count: 1 },
    // «Открыть в Fansly» of the «Новые» board.
    { file: 'src/content/followers/index.ts', from: '`https://fansly.com/messages/', to: `\`${page}/messages/`, count: 1 },
  ];
}

/** The manifest of the test build: the same extension, its sites and hub on the stand, no update URL. */
export function standManifest(released: Record<string, unknown>): Record<string, unknown> {
  const site = (pattern: string): string => (pattern === '*://fansly.com/*' ? '*://localhost/*' : pattern);
  const manifest = structuredClone(released) as {
    host_permissions?: string[];
    content_scripts?: Array<{ matches: string[] }>;
    web_accessible_resources?: Array<{ matches: string[] }>;
    browser_specific_settings?: { gecko?: Record<string, unknown> };
  } & Record<string, unknown>;
  manifest.host_permissions = ['*://localhost/*', 'http://127.0.0.1/*'];
  for (const script of manifest.content_scripts ?? []) script.matches = script.matches.map(site);
  for (const resource of manifest.web_accessible_resources ?? []) resource.matches = resource.matches.map(site);
  if (manifest.browser_specific_settings?.gecko !== undefined) delete manifest.browser_specific_settings.gecko['update_url'];
  return manifest;
}

/**
 * Addresses no file of the test build may hold any more in code that runs (texts and comments aside): what build.ts
 * looks for in the built bundles after the rules ran.
 */
export const LIVE_ADDRESS_PATTERNS: readonly RegExp[] = [/apiv3\.fansly\.com/, /wsv3\.fansly\.com/, /["'`]https:\/\/gosling-agency\.ru/, /["'`]https:\/\/fansly\.com/];
