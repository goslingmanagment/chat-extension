// TEST BUILDS ONLY (`__CG_TEST_HOSTS__`; bg/fansly.ts calls it under the
// constant, so a release chunk drops this file — tools/gates `release-bundle`
// checks its keys are not in one). The e2e's handle on the greeting send
// (R20 P9d, `suite-fansly-send`) until «Новые» clicks it (P10c): a spec
// starts attempts through the module's one send service — the real lock,
// lease, route, journal, custody, final check and `POST /message` — and holds
// it at the boundaries the failure matrix needs. Nothing is answered but ids
// and states: no text, no header.
//
// storage.local, written by an extension page of the test build:
// - `dev.fanslySend.request` — `{id, account, pageId, fanRef, groupId, text,
//   historyRevision, draftRevision, attempts: [attemptId…], hold?, lose?}`: the
//   attempts start at once (two clicks of one card); `hold`: `custody` — the
//   custody's answer waits for `go`; `intent` — the intent's write itself waits
//   for `go`, then lands; `written` — the intent is written, then the send
//   waits for `go` before its final check; `lose: 'custody'` — the custody's
//   answer is lost (a transport failure after the hub took it);
// - `dev.fanslySend.live` — `{historyRevision?, draftRevision?}`: the
//   revisions the pass and the window would hold NOW (the final check reads
//   them); the tab document and its account are the core's registry's;
// - `dev.fanslySend.go` — `{id}`: a held step goes on;
// - `dev.fanslySend.rival` — `{id, pageId, fanRef}`: another install of the
//   same person takes the fan's lease (two clients on one hub page);
// written back:
// - `dev.fanslySend.views` — every attempt's view as it changes, by attemptId;
// - `dev.fanslySend.held` — `{id, stage}` when a step waits for `go`;
// - `dev.fanslySend.result` — `{id, views}` once every attempt answered;
//   `dev.fanslySend.rivalResult` — `{id, ok, code?}`.
// The probe's requests go to the stand (`dev.fanslyApi.origin`, as the API
// probe's) through the module's own transport.

import type { FanslyGreetingRequest, FanslySendView } from '@cg/contracts/send-fansly';
import type { FanslySend, FanslySendDeps, FanslySendStart } from '@cg/core/services/hosts/fansly/send';
import { createFanslyClient, type FanslyApi, type FanslyNetworkSession, type RelayHub } from '@cg/fansly-api';

import type { BackgroundKit } from '../../src/composition/background/host-module';
import { FANSLY_API_PROBE_KEYS } from './api-probe';

export const FANSLY_SEND_PROBE_KEYS = {
  request: 'dev.fanslySend.request',
  live: 'dev.fanslySend.live',
  go: 'dev.fanslySend.go',
  rival: 'dev.fanslySend.rival',
  views: 'dev.fanslySend.views',
  held: 'dev.fanslySend.held',
  result: 'dev.fanslySend.result',
  rivalResult: 'dev.fanslySend.rivalResult',
} as const;

const STAND_ORIGIN = /^http:\/\/localhost:[0-9]{2,5}$/;

type Hold = 'custody' | 'intent' | 'written';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export interface FanslySendProbe {
  /** The send's deps as the probe drives them: its live tuple, the stand's API, the holds at the boundaries. */
  wrap(deps: FanslySendDeps): FanslySendDeps;
  /** Starts listening for the spec's requests; the answer stops it. */
  start(send: FanslySend): () => void;
}

export function fanslySendProbe(kit: BackgroundKit, session: FanslyNetworkSession, api: FanslyApi, relay: RelayHub): FanslySendProbe {
  const keys = FANSLY_SEND_PROBE_KEYS;
  let base: string | null = null;
  let live: { historyRevision?: string; draftRevision?: number } = {};
  /** The attempts of the running request and how each is held. */
  const holds = new Map<string, { readonly id: string; readonly hold: Hold | null; readonly lose: boolean }>();
  const waiting = new Map<string, () => void>();
  const views: Record<string, FanslySendView> = {};
  let viewsWrite: Promise<unknown> = Promise.resolve();

  /** Waits for `go` of this request id; the spec hears where. */
  const held = (id: string, stage: string): Promise<void> =>
    new Promise<void>((resolve) => {
      waiting.set(id, resolve);
      void kit.storage.local.set({ [keys.held]: { id, stage, at: kit.clock.now() } });
    });

  /** The registered tab of the creator (its account listed, or not said yet). */
  const tabOf = (account: string) => {
    const tabs = kit.siteTabs?.registered() ?? [];
    return tabs.find((tab) => tab.accounts.includes(account)) ?? tabs.find((tab) => tab.accounts.length === 0) ?? null;
  };

  const journaledAs = (value: unknown, attemptId: string): string | null => {
    const entries = record(value) && Array.isArray(value['entries']) ? (value['entries'] as unknown[]) : [];
    const entry = entries.find((row) => record(row) && row['attemptId'] === attemptId);
    return record(entry) ? text(entry['state']) : null;
  };

  function wrap(deps: FanslySendDeps): FanslySendDeps {
    return {
      ...deps,
      local: {
        ...deps.local,
        async set(items) {
          const journal = items['fansly.send.journal'];
          for (const [attemptId, how] of holds) {
            if (how.hold !== 'intent' && how.hold !== 'written') continue;
            if (journaledAs(journal, attemptId) !== 'intentWritten') continue;
            holds.set(attemptId, { ...how, hold: null });
            if (how.hold === 'intent') await held(how.id, 'intent');
            const written = await deps.local.set(items);
            if (how.hold === 'written') await held(how.id, 'written');
            return written;
          }
          return deps.local.set(items);
        },
      },
      hub: {
        ...deps.hub,
        async claim(op) {
          const state = await deps.hub.claim(op);
          const how = op.body.action === 'dispatch' ? holds.get(op.body.attemptId) : undefined;
          if (how?.lose === true) throw Object.assign(new Error('clientFanClaim: the answer was lost'), { name: 'HubCallError', failure: { kind: 'transport', failure: 'network' }, epoch: 0 });
          if (how?.hold === 'custody') await held(how.id, 'custody');
          return state;
        },
      },
      prepare(call) {
        if (base === null) return Promise.reject(Object.assign(new Error('no stand origin'), { name: 'FanslyApiError', kind: 'not-admitted', code: 'CG-FAN-REQUEST', sent: false }));
        const client = createFanslyClient({ session, pacer: api.pacer, base, transport: relay, now: () => kit.clock.now() });
        return client.prepare({ purpose: 'greeting', route: 'message.send', account: call.account, body: { type: 1, content: call.text, groupId: call.groupId, attachments: [], likes: [], scheduledFor: 0, inReplyTo: null } });
      },
      live(start: FanslySendStart) {
        const tab = tabOf(start.request.hostAccountId);
        if (tab === null) return null;
        return {
          hostAccountId: tab.accounts.length === 0 || tab.accounts.includes(start.request.hostAccountId) ? start.request.hostAccountId : (tab.accounts[0] ?? ''),
          groupId: start.request.groupId,
          fanRef: start.request.fanRef,
          tabSessionId: tab.tabSessionId,
          historyRevision: live.historyRevision ?? start.request.historyRevision,
          draftRevision: live.draftRevision ?? start.request.draftRevision,
        };
      },
    };
  }

  function start(send: FanslySend): () => void {
    let last: string | null = null;
    const offViews = send.onChange((view) => {
      views[view.attemptId] = view;
      const snapshot = { ...views };
      viewsWrite = viewsWrite.then(() => kit.storage.local.set({ [keys.views]: snapshot })).catch(() => undefined);
    });

    async function run(raw: unknown): Promise<void> {
      if (!record(raw) || typeof raw['id'] !== 'string' || raw['id'] === last) return;
      const id = raw['id'];
      last = id;
      const account = text(raw['account']);
      const pageId = typeof raw['pageId'] === 'number' ? raw['pageId'] : 0;
      const attemptIds = Array.isArray(raw['attempts']) ? raw['attempts'].filter((item): item is string => typeof item === 'string') : [];
      const hold = raw['hold'] === 'custody' || raw['hold'] === 'intent' || raw['hold'] === 'written' ? raw['hold'] : null;
      const tab = tabOf(account);
      const answered: FanslySendView[] = [];
      if (tab === null) {
        await kit.storage.local.set({ [keys.result]: { id, error: 'no-tab', at: kit.clock.now() } });
        return;
      }
      // The page granted to the person (P10c's window checks the tab's own binding too).
      const page = await kit.hub.page(pageId, { kind: 'page' });
      const flagRevision = kit.hub.bootstrap()?.configRevision ?? 0;
      if (!page.ok) {
        await kit.storage.local.set({ [keys.result]: { id, error: page.code, at: kit.clock.now() } });
        return;
      }
      for (const attemptId of attemptIds) holds.set(attemptId, { id, hold, lose: raw['lose'] === 'custody' });
      const starts = attemptIds.map((attemptId) => {
        const request: FanslyGreetingRequest = {
          attemptId,
          passId: attemptId,
          hostAccountId: account,
          fanRef: text(raw['fanRef']),
          groupId: text(raw['groupId']),
          text: text(raw['text']),
          draftRevision: typeof raw['draftRevision'] === 'number' ? raw['draftRevision'] : 0,
          historyRevision: text(raw['historyRevision']),
          admission: { kind: 'own' },
          cause: { kind: 'click', actionToken: kit.ids.token() },
        };
        return send.send({ request, tabSessionId: tab.tabSessionId, page: { pageId, pageLabel: page.page.pageLabel, flagRevision } });
      });
      for (const view of await Promise.all(starts)) answered.push(view);
      for (const attemptId of attemptIds) holds.delete(attemptId);
      await viewsWrite;
      await kit.storage.local.set({ [keys.result]: { id, views: answered, at: kit.clock.now() } });
    }

    async function rival(raw: unknown): Promise<void> {
      if (!record(raw) || typeof raw['id'] !== 'string') return;
      const pageId = typeof raw['pageId'] === 'number' ? raw['pageId'] : 0;
      const pageLabel = kit.hub.bootstrap()?.pages.find((page) => page.pageId === pageId)?.pageLabel ?? '';
      let outcome: Record<string, unknown>;
      try {
        await kit.hub.facade.claim({ pageLabel, fanRef: text(raw['fanRef']), body: { action: 'claim', leaseToken: kit.ids.uuid(), instanceId: kit.ids.uuid() } });
        outcome = { ok: true };
      } catch (error) {
        outcome = { ok: false, code: kit.hub.errorWire(error).code };
      }
      await kit.storage.local.set({ [keys.rivalResult]: { id: raw['id'], ...outcome, at: kit.clock.now() } });
    }

    const off = kit.storage.local.onChanged((changes) => {
      if (changes[FANSLY_API_PROBE_KEYS.origin] !== undefined) readOrigin(changes[FANSLY_API_PROBE_KEYS.origin]?.newValue);
      const nextLive = changes[keys.live]?.newValue;
      if (changes[keys.live] !== undefined) live = record(nextLive) ? nextLive : {};
      const go = changes[keys.go]?.newValue;
      if (record(go) && typeof go['id'] === 'string') {
        const resume = waiting.get(go['id']);
        waiting.delete(go['id']);
        resume?.();
      }
      const rivalAsk = changes[keys.rival]?.newValue;
      if (rivalAsk !== undefined) void rival(rivalAsk).catch(() => undefined);
      const request = changes[keys.request]?.newValue;
      if (request !== undefined) void run(request).catch(() => undefined);
    });
    void kit.storage.local
      .get([FANSLY_API_PROBE_KEYS.origin, keys.live])
      .then((stored) => {
        if (!stored.ok) return;
        readOrigin(stored.value[FANSLY_API_PROBE_KEYS.origin]);
        const stored$ = stored.value[keys.live];
        live = record(stored$) ? stored$ : {};
      })
      .catch(() => undefined);
    return () => {
      off();
      offViews();
      for (const resume of waiting.values()) resume();
      waiting.clear();
    };
  }

  function readOrigin(value: unknown): void {
    base = typeof value === 'string' && STAND_ORIGIN.test(value) ? `${value}/api/v1/` : null;
  }

  return { wrap, start };
}
