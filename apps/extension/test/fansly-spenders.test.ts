// Test-build services never fall back to Fansly's live API when the stand's
// origin is not configured (P9e). A client created before the spec sets the
// origin reads it at the click; the production branch drops this module.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFanslyApi, type FanslyNetworkSession } from '@cg/fansly-api';
import { FANSLY_API_PROBE_KEYS, fanslyStandClient } from '../bg/fansly/api-probe';
import type { BackgroundKit } from '../src/composition/background/host-module';

const ACCOUNT = '700000000000000017';
afterEach(() => vi.restoreAllMocks());
function world() {
  const values: Record<string, unknown> = {};
  const store = {
    get: () => Promise.resolve({ ok: true as const, value: values }),
    set: (items: Readonly<Record<string, unknown>>) => { Object.assign(values, items); return Promise.resolve({ ok: true as const }); },
  };
  const session: FanslyNetworkSession = {
    ready: Promise.resolve(), idle: () => Promise.resolve(), rateLimits: () => [],
    forAccount: () => ({ legacyId: ACCOUNT, canonicalId: null, headers: {}, checks: {}, connected: true, observedAt: 1000 }),
    disconnect: () => Promise.resolve(),
  };
  const kit = { storage: { local: store }, clock: { now: () => 1000 } } as unknown as BackgroundKit;
  const api = createFanslyApi({ session, storage: store, now: () => 1000, random: () => 0 });
  return { values, client: fanslyStandClient(kit, session, api) };
}
const request = { purpose: 'spenders', route: 'account.byIds', account: ACCOUNT, query: { ids: '123' } } as const;

describe('Fansly Spenders on the loopback stand', () => {
  it('missing, malformed, or a live origin is refused before fetch', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network request'));
    const w = world();
    for (const origin of [undefined, null, 'https://apiv3.fansly.com', 'http://localhost.evil:123', 'http://127.0.0.1:123']) {
      w.values[FANSLY_API_PROBE_KEYS.origin] = origin;
      await expect(w.client.call(request)).rejects.toMatchObject({ kind: 'not-admitted', sent: false });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('an origin set after the background starts is used by the real client at the click', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, response: [] }), { status: 200 }));
    const w = world();
    w.values[FANSLY_API_PROBE_KEYS.origin] = 'http://localhost:45678';
    expect(await w.client.call(request)).toEqual({ status: 200, response: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost:45678/api/v1/account?ids=123&ngsw-bypass=true');
  });
});
