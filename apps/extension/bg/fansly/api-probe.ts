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
//   (`http://localhost:<port>`): the client's base for the probe's calls (and,
//   R20 P9c, the stand the relay frame of a test build serves Fansly's
//   addresses from);
// - `dev.fanslyApi.call` — `{id, purpose, route, account, path?, query?, body?,
//   hold?}`; R20 P9c: `hold: true` — prepared (admitted, paced, ROUTED: through
//   the tab, its frame up) and held until `dev.fanslyApi.go` names its id, so a
//   spec can change the document or the account between the route and the
//   request;
// - `dev.fanslyApi.result` — written back: `{id, ok, …}`, the creator's lane
//   and the relay frames up; a held call first `{id, prepared: true, transport}`.
// A call written while the module was not running is made when it starts. The
// calls go through the module's own transport (the relay of «Fansly через
// вкладку» when the person's switch is on).

import { createFanslyClient, FanslyApiError, type FanslyApi, type FanslyCall, type FanslyClient, type FanslyNetworkSession, type PreparedFanslyCall, type RelayHub } from '@cg/fansly-api';

import type { BackgroundKit } from '../../src/composition/background/host-module';

export const FANSLY_API_PROBE_KEYS = { origin: 'dev.fanslyApi.origin', call: 'dev.fanslyApi.call', result: 'dev.fanslyApi.result', go: 'dev.fanslyApi.go' } as const;

/** The stand's API is on the loopback name `localhost` (hosts/runtime FANSLY_STAND_NETWORK), on a port of its own. */
const STAND_ORIGIN = /^http:\/\/localhost:[0-9]{2,5}$/;

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): Record<string, string> | undefined =>
  record(value) && Object.values(value).every((item) => typeof item === 'string') ? (value as Record<string, string>) : undefined;

const failureOf = (error: unknown): Record<string, unknown> =>
  error instanceof FanslyApiError
    ? { ok: false, kind: error.kind, code: error.code, sent: error.sent, httpStatus: error.httpStatus ?? null, retryAt: error.retryAt ?? null, fanslyCode: error.fanslyCode ?? null }
    : { ok: false, kind: 'thrown' };

/** Real feature handlers in the test build use the same client and pacer, only on loopback. */
export async function standFanslyClient(kit: BackgroundKit, session: FanslyNetworkSession, api: FanslyApi) {
  const stored = await kit.storage.local.get([FANSLY_API_PROBE_KEYS.origin]);
  const origin = stored.ok ? stored.value[FANSLY_API_PROBE_KEYS.origin] : null;
  return typeof origin === 'string' && STAND_ORIGIN.test(origin) ? createFanslyClient({ session, pacer: api.pacer, base: `${origin}/api/v1/`, transport: api.client.transport, now: () => kit.clock.now() }) : null;
}

export function startFanslyApiProbe(kit: BackgroundKit, session: FanslyNetworkSession, api: FanslyApi, relay: RelayHub): () => void {
  const keys = FANSLY_API_PROBE_KEYS;
  let base: string | null = null;
  let last: string | null = null;
  /** A held call: its id and what `go` starts. */
  let held: { readonly id: string; readonly prepared: PreparedFanslyCall } | null = null;
  const relayFacts = (): Record<string, unknown> => ({ frames: relay.frames().length, relayPending: relay.pending() });
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
      const client = createFanslyClient({ session, pacer: api.pacer, base, transport: api.client.transport, now: () => kit.clock.now() });
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
      if (raw['hold'] === true) {
        // Prepared and routed; the request waits for `go` (R20 P9c: the route before the custody, the last check at the send).
        try {
          const prepared = await client.prepare(call);
          held?.prepared.cancel();
          held = { id, prepared };
          await kit.storage.local.set({ [keys.result]: { id, prepared: true, transport: prepared.transport, ...relayFacts(), at: kit.clock.now() } });
          return;
        } catch (error) {
          outcome = { ...failureOf(error), stage: 'prepare' };
        }
      } else {
        try {
          const answer = await client.call(call);
          outcome = { ok: true, status: answer.status };
        } catch (error) {
          outcome = failureOf(error);
        }
      }
    }
    const template = session.forAccount(account);
    const lane = template === null ? null : api.pacer.view({ legacyId: template.legacyId, canonicalId: template.canonicalId });
    await kit.storage.local.set({ [keys.result]: { id, ...outcome, lane, ...relayFacts(), at: kit.clock.now() } });
  }

  /** `go` of the held call: its request now (the route's last check first), its outcome as any call's. */
  async function go(raw: unknown): Promise<void> {
    if (!record(raw) || held === null || raw['id'] !== held.id) return;
    const { id, prepared } = held;
    held = null;
    let outcome: Record<string, unknown>;
    try {
      const answer = await prepared.start();
      outcome = { ok: true, status: answer.status };
    } catch (error) {
      outcome = failureOf(error);
    }
    await kit.storage.local.set({ [keys.result]: { id, ...outcome, transport: prepared.transport, ...relayFacts(), at: kit.clock.now() } });
  }

  const off = kit.storage.local.onChanged((changes) => {
    if (changes[keys.origin] !== undefined) readOrigin(changes[keys.origin]?.newValue);
    const call = changes[keys.call]?.newValue;
    if (call !== undefined) void run(call).catch(() => undefined);
    const started = changes[keys.go]?.newValue;
    if (started !== undefined) void go(started).catch(() => undefined);
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
  return () => {
    off();
    held?.prepared.cancel();
    held = null;
  };
}

/** TEST services use the stand origin too, read at the call (a background may start before the spec sets it).
 * Missing/invalid stand configuration refuses before any network; a test never falls back to the live API. */
export function fanslyStandClient(kit: BackgroundKit, session: FanslyNetworkSession, api: FanslyApi): Pick<FanslyClient, 'call'> {
  return {
    async call(request) {
      const stored = await kit.storage.local.get([FANSLY_API_PROBE_KEYS.origin]);
      const origin = stored.ok ? stored.value[FANSLY_API_PROBE_KEYS.origin] : null;
      if (typeof origin !== 'string' || !STAND_ORIGIN.test(origin)) throw new FanslyApiError('not-admitted', { sent: false });
      return createFanslyClient({ session, pacer: api.pacer, base: `${origin}/api/v1/`, transport: api.client.transport, now: () => kit.clock.now() }).call(request);
    },
  };
}
