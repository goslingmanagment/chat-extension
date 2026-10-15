// TEST BUILDS ONLY (`__CG_TEST_HOSTS__`; bg/fansly.ts calls it under the
// constant, so a release chunk drops this file — tools/gates `release-bundle`
// checks its keys are not in one). The e2e's handle on Fansly's API in the
// background (R20 P9b, `suite-fansly-network`): until the services that ask
// Fansly arrive (P9c–P9e, P10*, P11*), a spec makes ONE call through the real
// client — FS-NET-1's admission, the session the core captured, the pacer and
// its cooldowns — and reads how it ended. Nothing is answered but the outcome:
// no body, no header.
//
// storage.local, written by an extension page of the test build:
// - `dev.fanslyApi.origin` — the fake Fansly's API origin on the stand
//   (`http://localhost:<port>`): the client's base for the probe's calls;
// - `dev.fanslyApi.call` — `{id, purpose, route, account, path?, query?, body?}`;
// - `dev.fanslyApi.result` — written back: `{id, ok, …}` and the creator's lane.
// A call written while the module was not running is made when it starts.

import { createFanslyClient, FanslyApiError, type FanslyApi, type FanslyCall, type FanslyNetworkSession } from '@cg/fansly-api';

import type { BackgroundKit } from '../../src/composition/background/host-module';

export const FANSLY_API_PROBE_KEYS = { origin: 'dev.fanslyApi.origin', call: 'dev.fanslyApi.call', result: 'dev.fanslyApi.result' } as const;

/** The stand's API is on the loopback name `localhost` (hosts/runtime FANSLY_STAND_NETWORK), on a port of its own. */
const STAND_ORIGIN = /^http:\/\/localhost:[0-9]{2,5}$/;

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): Record<string, string> | undefined =>
  record(value) && Object.values(value).every((item) => typeof item === 'string') ? (value as Record<string, string>) : undefined;

export function startFanslyApiProbe(kit: BackgroundKit, session: FanslyNetworkSession, api: FanslyApi): () => void {
  const keys = FANSLY_API_PROBE_KEYS;
  let base: string | null = null;
  let last: string | null = null;
  const readOrigin = (value: unknown): void => {
    base = typeof value === 'string' && STAND_ORIGIN.test(value) ? `${value}/api/v1/` : null;
  };

  async function run(raw: unknown): Promise<void> {
    if (!record(raw) || typeof raw['id'] !== 'string' || raw['id'] === last) return;
    const id = raw['id'];
    last = id;
    const account = typeof raw['account'] === 'string' ? raw['account'] : '';
    let outcome: Record<string, unknown>;
    if (base === null) outcome = { ok: false, kind: 'no-stand-origin' };
    else {
      const client = createFanslyClient({ session, pacer: api.pacer, base, now: () => kit.clock.now() });
      const path = strings(raw['path']);
      const query = strings(raw['query']);
      // Purpose and route go as they came: the client's admission is what the spec checks.
      const call = {
        purpose: raw['purpose'],
        route: raw['route'],
        account,
        ...(path === undefined ? {} : { path }),
        ...(query === undefined ? {} : { query }),
        ...(raw['body'] === undefined ? {} : { body: raw['body'] }),
      } as FanslyCall;
      try {
        const answer = await client.call(call);
        outcome = { ok: true, status: answer.status };
      } catch (error) {
        outcome =
          error instanceof FanslyApiError
            ? { ok: false, kind: error.kind, code: error.code, sent: error.sent, httpStatus: error.httpStatus ?? null, retryAt: error.retryAt ?? null, fanslyCode: error.fanslyCode ?? null }
            : { ok: false, kind: 'thrown' };
      }
    }
    const template = session.forAccount(account);
    const lane = template === null ? null : api.pacer.view({ legacyId: template.legacyId, canonicalId: template.canonicalId });
    await kit.storage.local.set({ [keys.result]: { id, ...outcome, lane, at: kit.clock.now() } });
  }

  const off = kit.storage.local.onChanged((changes) => {
    if (changes[keys.origin] !== undefined) readOrigin(changes[keys.origin]?.newValue);
    const call = changes[keys.call]?.newValue;
    if (call !== undefined) void run(call).catch(() => undefined);
  });
  void kit.storage.local
    .get([keys.origin, keys.call, keys.result])
    .then((stored) => {
      if (!stored.ok) return;
      readOrigin(stored.value[keys.origin]);
      const call = stored.value[keys.call];
      const done = stored.value[keys.result];
      if (record(call) && !(record(done) && done['id'] === call['id'])) return run(call);
      return undefined;
    })
    .catch(() => undefined);
  return off;
}
