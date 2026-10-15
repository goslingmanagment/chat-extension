// The relay frame's page (`fansly-relay.html`, R20 P9c; architecture.md §8.5):
// only as a frame of a tab — opened by itself it has no tab to lend, and the
// background takes its port from a subframe of a registered Fansly tab alone.
// Its address names the account its tab mounted it for (`#a=<id>`); without
// one it serves nothing. The frame's logic: ./relay.ts.
//
// A TEST build serves Fansly's address from the stand its e2e pointed it at
// (`dev.fanslyApi.origin`, as the background's probe reads it); a release
// build has none of it (`__CG_TEST_HOSTS__`; tools/gates `release-bundle`).

import { createKeyValueStore, createRelayRpcClient, defaultBrowser, type BrowserApi, type TabPayloadValidator } from '@cg/platform';

import { accountOfAddress, readRelayFetch, serveFrom, startFanslyRelay } from './relay';

/** The frame's own check of what reaches it: the background's two events, and the acknowledgements of its requests. */
const validate: TabPayloadValidator = (kind, type, payload) => {
  if (kind === 'evt' && type === 'fansly.relay.fetch') return readRelayFetch(payload) === null ? { ok: false } : { ok: true, payload };
  if (kind === 'evt' && type === 'fansly.relay.abort') return typeof (payload as { requestId?: unknown } | null)?.requestId === 'string' ? { ok: true, payload } : { ok: false };
  if (kind === 'res' && type.startsWith('fansly.relay.')) return typeof (payload as { recorded?: unknown } | null)?.recorded === 'boolean' ? { ok: true, payload } : { ok: false };
  return { ok: false };
};

/** A test build's stand (`http://localhost:<port>/api/v1/`), from the e2e; null — Fansly itself. */
async function standBase(api: BrowserApi): Promise<string | null> {
  if (!__CG_TEST_HOSTS__) return null;
  const key = 'dev.fanslyApi.origin';
  const stored = await createKeyValueStore('local', { api }).get([key]);
  const origin = stored.ok ? stored.value[key] : undefined;
  return typeof origin === 'string' && /^http:\/\/localhost:[0-9]{2,5}$/.test(origin) ? `${origin}/api/v1/` : null;
}

async function start(): Promise<void> {
  const hostAccountId = accountOfAddress(window.location.hash);
  if (hostAccountId === null) return;
  const api = defaultBrowser();
  const base = await standBase(api);
  const channel = createRelayRpcClient({ api, validate });
  startFanslyRelay({
    channel,
    fetch: (url, init) => fetch(url, init),
    hostAccountId,
    relayId: crypto.randomUUID(),
    serve: serveFrom(base),
  });
}

if (window.top !== window) void start();
