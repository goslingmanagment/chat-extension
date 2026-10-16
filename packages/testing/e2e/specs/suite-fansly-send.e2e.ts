// R20 P9d: the greeting's HTTP send with the hub's custody on the stand (spec FS-NEW-3; architecture.md §8.6;
// NF-020…022, NF-035, RB-007). Until «Новые» clicks it (P10c) the test build's probe (apps/extension/bg/fansly/
// send-probe.ts) starts the attempts through the module's one send service — the real lock, lease, route, journal,
// custody of the fake hub, final check and `POST /message` to the fake Fansly — and holds them at the boundaries:
// - one click → one POST; the receipt and its echo (also an echo before the receipt) → `sent`, the custody `sent`;
//   two clicks at once → one POST; the journal holds ids, never the text;
// - `200 {success:false}` and a lost answer → `uncertain`, never repeated, the fan held;
// - the custody's answer delayed, the intent's write itself delayed: the history, the tab's document (the relay
//   frame's too) or the ticket's end changing in that pause → `refused` with no POST, the custody told «not enqueued»;
// - the background gone at each boundary: before the intent → refused and told; after it → uncertain with no POST;
//   after the POST → uncertain; after the receipt → its late echo still proves it, the custody hears `sent`;
// - another install holding the fan's lease: our click routes nothing.
// The account changing in the pause is a unit test (core send.test.ts): the stand holds one account.

import { randomUUID } from 'node:crypto';

import { browser, expect } from '@wdio/globals';

import { BOOTSTRAP_PILOT_PAGES } from '../../src/scenarios/hub/http';
import { WORLD } from '../../src/scenarios/hub/world';
import { suspendBackground } from '../support/background';
import { pageRpc, readLocalStorage, waitForReport, writeLocalStorage } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { startFanslyShift } from '../support/fansly-shift';
import { fakeFansly, fanslyIds, waitForFanslyStandIdle, waitForFanslyStandReady } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';

/** bg/fansly/api-probe.ts and bg/fansly/send-probe.ts. */
const API = { origin: 'dev.fanslyApi.origin', call: 'dev.fanslyApi.call', result: 'dev.fanslyApi.result' } as const;
const SEND = {
  request: 'dev.fanslySend.request',
  live: 'dev.fanslySend.live',
  go: 'dev.fanslySend.go',
  rival: 'dev.fanslySend.rival',
  views: 'dev.fanslySend.views',
  held: 'dev.fanslySend.held',
  result: 'dev.fanslySend.result',
  rivalResult: 'dev.fanslySend.rivalResult',
} as const;
const JOURNAL = 'fansly.send.journal';
const SETTINGS_EXT = 'settings.ext';
const PAGE = WORLD.pages.fansly;
const TEXT = 'Привет! Рада видеть тебя здесь';
const HISTORY = '5a1d0000-0000-4000-8000-000000000001';

interface View {
  readonly attemptId: string;
  readonly state: string;
  readonly proof?: string;
  readonly code?: string;
  readonly cause?: string;
  readonly platformMessageId?: string;
}

interface JournalEntry extends View {
  readonly reportPending?: boolean;
  readonly requestId?: string;
  readonly browserResend?: true;
}

describe('Fansly greeting send: FS-NEW-3 — one click, the hub’s custody, the final check, at most one extension fetch', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let standTab = '';
  let pagesTab = '';
  let creator = '';
  let groups: string[] = [];
  let fans: Record<string, string> = {};
  let seq = 0;
  const pages = (): Promise<void> => browser.switchToWindow(pagesTab);
  const stand = (): Promise<void> => browser.switchToWindow(standTab);
  const fanOf = (index: number): { readonly group: string; readonly fan: string } => {
    const group = groups[index] ?? '';
    return { group, fan: fans[group] ?? '' };
  };

  async function read<T>(key: string): Promise<T | undefined> {
    await pages();
    return (await readLocalStorage([key]))[key] as T | undefined;
  }

  async function waitFor<T>(what: string, probe: () => Promise<T | undefined | null | false>, timeout = 20_000): Promise<T> {
    let found: T | undefined | null | false;
    await browser.waitUntil(
      async () => {
        found = await probe();
        return found !== undefined && found !== null && found !== false;
      },
      { timeout, interval: 150, timeoutMsg: what },
    );
    return found as T;
  }

  /** Clicks of one card, at once; `hold` / `lose` — where the probe stops it. Returns the request id. */
  async function click(index: number, attempts: readonly string[], options: { readonly hold?: 'custody' | 'intent' | 'written'; readonly lose?: 'custody' } = {}): Promise<string> {
    seq += 1;
    const id = `p9d-${seq}-${Date.now()}`;
    const { group, fan } = fanOf(index);
    await pages();
    await writeLocalStorage({ [SEND.request]: { id, account: creator, pageId: PAGE.pageId, fanRef: fan, groupId: group, text: TEXT, historyRevision: HISTORY, draftRevision: 1, attempts, ...options } });
    return id;
  }

  async function answered(id: string, timeout = 30_000): Promise<View[]> {
    const result = await waitFor(`the probe did not answer ${id}`, async () => {
      const found = await read<{ id: string; views?: View[]; error?: string }>(SEND.result);
      return found?.id === id ? found : undefined;
    }, timeout);
    if (result.views === undefined) throw new Error(`the probe refused ${id}: ${result.error ?? '?'}`);
    return result.views;
  }

  async function heldAt(id: string, stage: string): Promise<void> {
    await waitFor(`the attempt ${id} did not stop at ${stage}`, async () => {
      const held = await read<{ id: string; stage: string }>(SEND.held);
      return held?.id === id && held.stage === stage;
    });
  }

  async function go(id: string): Promise<void> {
    await pages();
    await writeLocalStorage({ [SEND.go]: { id, at: Date.now() } });
  }

  async function live(change: { readonly historyRevision?: string }): Promise<void> {
    await pages();
    await writeLocalStorage({ [SEND.live]: change });
  }

  async function view(attemptId: string): Promise<View | undefined> {
    return (await read<Record<string, View>>(SEND.views))?.[attemptId];
  }

  async function journal(attemptId: string): Promise<JournalEntry | undefined> {
    return (await read<{ entries: JournalEntry[] }>(JOURNAL))?.entries.find((entry) => entry.attemptId === attemptId);
  }

  /** Our `POST /message` since `mark`, as the fake Fansly journaled them. */
  async function posts(mark: number): Promise<number> {
    return (await fakeFansly().calls('ours', mark)).filter((entry) => entry.route === 'message.send').length;
  }

  /** The hub's custody of the fan, by attempt: `[attemptId, state]`. */
  async function custody(index: number): Promise<Array<[string, string]>> {
    const { fan } = fanOf(index);
    const claim = (await hub().status()).claims.find((entry) => entry.pageLabel === PAGE.pageLabel && entry.fanRef === fan);
    return (claim?.attempts ?? []).map((attempt) => [attempt.attemptId, attempt.state]);
  }

  async function custodyIs(index: number, attemptId: string, state: string): Promise<void> {
    await waitFor(`the custody of ${attemptId} is not «${state}»`, async () => (await custody(index)).some(([id, at]) => id === attemptId && at === state));
  }

  /**
   * A custody the hub holds `uncertain-held` — its ticket ran out before our «not enqueued» (the hub takes `failed`
   * only while the ticket lives, architecture §8.6) — is resolved «not sent» by the owner, so the fan is free again.
   */
  async function releaseHeld(index: number, attemptId: string): Promise<string> {
    const state = (await custody(index)).find(([id]) => id === attemptId)?.[1] ?? 'none';
    if (state === 'uncertain-held') await hub().command({ op: 'resolveCustody', pageLabel: PAGE.pageLabel, fanRef: fanOf(index).fan, attemptId, outcome: 'not_sent' });
    return state;
  }

  async function moduleStarted(): Promise<void> {
    await pages();
    await waitFor('Fansly’s background module did not start', async () => {
      const diagnostic = await pageRpc<{ hostModules: Array<{ host: string; state: string }> }>('diagnostics.get');
      return diagnostic.ok && diagnostic.payload.hostModules.some((entry) => entry.host === 'fansly-web' && entry.state === 'started');
    });
  }

  /** The event page goes as an idle timeout takes it; the next request wakes it and the module restores its journal. */
  async function restart(): Promise<void> {
    expect(await suspendBackground()).toBe('stopped');
    await moduleStarted();
  }

  async function reloadStand(): Promise<void> {
    await stand();
    await browser.refresh();
    await waitForFanslyStandReady();
    await waitForReport((report) => report.rpc?.registered === true, 'the Fansly tab registered again');
    await waitForFanslyStandIdle();
  }

  async function viaTab(on: boolean): Promise<void> {
    await pages();
    const stored = ((await readLocalStorage([SETTINGS_EXT]))[SETTINGS_EXT] ?? { v: 1, hosts: {} }) as { hosts?: Record<string, Record<string, unknown>> } & Record<string, unknown>;
    const fansly = { ...(stored.hosts?.['fansly-web'] ?? {}), viaTab: on };
    await writeLocalStorage({ [SETTINGS_EXT]: { ...stored, hosts: { ...(stored.hosts ?? {}), 'fansly-web': fansly } } });
    const mode = on ? 'relay' : 'background';
    await waitFor(`the background did not take «Fansly через вкладку» ${mode}`, async () => {
      const diagnostic = await pageRpc<{ requestModes?: Array<{ host: string; mode: string }> }>('diagnostics.get');
      return diagnostic.ok && diagnostic.payload.requestModes?.some((entry) => entry.host === 'fansly-web' && entry.mode === mode) === true;
    });
  }

  before(async () => {
    await fakeFansly().command({ op: 'reset' });
    const shift = await startFanslyShift(hub(), { path: '/messages', neighbor: { mode: 'off' } });
    pagesTab = shift.pagesTab;
    standTab = shift.fanslyTab;
    await pages();
    await writeLocalStorage({ [API.origin]: fakeFansly().apiOrigin, [SEND.live]: {} });
    await stand();
    await waitForReport((report) => report.rpc?.registered === true, 'the Fansly tab registered');
    await waitForFanslyStandIdle();
    const ids = await fanslyIds();
    creator = ids.creator;
    groups = [...ids.groups];
    fans = { ...ids.fans };
    expect(groups.length).toBeGreaterThanOrEqual(8);
    await moduleStarted();
    // The core holds the page's session: a call of ours can carry it.
    await waitFor('no call of ours went through (no captured session?)', async () => {
      seq += 1;
      const id = `p9d-session-${seq}`;
      await pages();
      await writeLocalStorage({ [API.call]: { id, account: creator, purpose: 'registration', route: 'group.detail', path: { group: groups[0] } } });
      const result = await waitFor(`the API probe did not answer ${id}`, async () => {
        const found = await read<{ id: string; ok?: boolean }>(API.result);
        return found?.id === id ? found : undefined;
      });
      return result.ok === true;
    }, 30_000);
  });

  beforeEach(async () => {
    await fakeFansly().command({ op: 'send', echo: 'after', receiptDelayMs: 0, echoDelayMs: 0 });
    await live({});
  });

  it('[NF-020] [NF-021] [NF-035] one click through the custody: ONE POST, the receipt and its echo → sent, the custody sent; two clicks at once — one POST; the journal keeps ids, never the text', async () => {
    const mark = await fakeFansly().mark();
    const [first, second] = [randomUUID(), randomUUID()];
    const views = await answered(await click(0, [first, second]));
    expect(views[0]).toMatchObject({ attemptId: first, state: 'sent', proof: 'echo' });
    expect(views[1]).toMatchObject({ attemptId: second, state: 'refused', proof: 'before-dispatch', code: 'CG-SEND-BUSY' });
    expect(await posts(mark)).toBe(1);
    await custodyIs(0, first, 'sent');
    expect((await custody(0)).map(([id]) => id)).toEqual([first]);
    const entry = await waitFor('the journal did not settle the report', async () => {
      const found = await journal(first);
      return found?.state === 'sent' && found.reportPending === false ? found : undefined;
    });
    expect(entry.platformMessageId).toBe(views[0]?.platformMessageId);
    expect(JSON.stringify(await read(JOURNAL))).not.toContain(TEXT);
  });

  it('[NF-020] the echo before the receipt proves it the moment the receipt comes', async () => {
    await fakeFansly().command({ op: 'send', echo: 'before', receiptDelayMs: 300, echoDelayMs: 0 });
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    expect((await answered(await click(1, [attempt])))[0]).toMatchObject({ state: 'sent', proof: 'echo' });
    expect(await posts(mark)).toBe(1);
    await custodyIs(1, attempt, 'sent');
  });

  it('[NF-022] [RB-007] `200 {success:false}` is uncertain: never repeated, the fan held — the next click asks Fansly nothing', async () => {
    await fakeFansly().command({ op: 'api', rules: [{ route: 'message.send', caller: 'ours', times: 1, outcome: { kind: 'refuse', code: 10 } }] });
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    expect((await answered(await click(2, [attempt])))[0]).toMatchObject({ state: 'uncertain', cause: 'rejected-200', code: 'CG-SEND-UNCERTAIN' });
    await browser.pause(2_000);
    expect(await posts(mark)).toBe(1);
    const again = randomUUID();
    expect((await answered(await click(2, [again])))[0]).toMatchObject({ state: 'refused', code: 'CG-SEND-UNCERTAIN' });
    expect(await posts(mark)).toBe(1);
    expect((await custody(2)).map(([id]) => id)).toEqual([attempt]);
    expect(await journal(attempt)).toMatchObject({ state: 'uncertain', cause: 'rejected-200' });
  });

  it('[NF-022] [RB-007] the lost answer: one extension fetch/requestId, uncertain, never asked again; a browser resend keeps that id (X41)', async () => {
    await fakeFansly().command({ op: 'api', rules: [{ route: 'message.send', caller: 'ours', times: 1, outcome: { kind: 'drop' }, effect: true }] });
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    const result = (await answered(await click(3, [attempt])))[0];
    const requestId = (await journal(attempt))?.requestId;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    // A reset before response bytes can make Firefox resend the SAME fetch. Raw hits are transport evidence,
    // not extension attempts. A second extension fetch has a NEW id and must still fail NF-022.
    const oneRequest = async (): Promise<void> => {
      const seen = (await fakeFansly().calls('ours', mark)).filter((entry) => entry.route === 'message.send');
      expect([...new Set(seen.map((entry) => entry.detail?.['requestId']))]).toEqual([requestId]);
      expect(seen.some((entry) => entry.status === 0 && entry.detail?.['outcome'] === 'drop')).toBe(true);
      expect(await journal(attempt)).toMatchObject({ state: 'uncertain', cause: 'network', requestId });
    };
    await oneRequest();
    expect(result).toMatchObject({ state: 'uncertain', cause: 'network', code: 'CG-SEND-UNCERTAIN' });
    await browser.pause(3_000);
    await oneRequest();
    expect((await answered(await click(3, [randomUUID()])))[0]).toMatchObject({ state: 'refused', code: 'CG-SEND-UNCERTAIN' });
    await oneRequest();
    expect(await view(attempt)).toMatchObject({ state: 'uncertain', cause: 'network' });
    expect((await custody(3)).map(([id]) => id)).toEqual([attempt]);
    expect(await journal(attempt)).toMatchObject({ state: 'uncertain', cause: 'network' });
  });

  it('[NF-021] the custody’s answer delayed: the history changes meanwhile → refused, NO POST; the custody hears «not enqueued»', async () => {
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    const id = await click(4, [attempt], { hold: 'custody' });
    await heldAt(id, 'custody');
    await live({ historyRevision: '5a1d0000-0000-4000-8000-000000000002' });
    await go(id);
    expect((await answered(id))[0]).toMatchObject({ state: 'refused', proof: 'not-enqueued', code: 'CG-FNEW-HISTORY' });
    expect(await posts(mark)).toBe(0);
    await custodyIs(4, attempt, 'failed');
  });

  it('[NF-021] the custody’s answer lost: no ticket, no request — refused, and the custody it may have opened hears «not enqueued»', async () => {
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    expect((await answered(await click(4, [attempt], { lose: 'custody' })))[0]).toMatchObject({ state: 'refused', proof: 'not-enqueued' });
    expect(await posts(mark)).toBe(0);
    await custodyIs(4, attempt, 'failed');
  });

  it('[NF-021] the intent’s write itself delayed: a history change, the tab’s new document, the ticket’s end — each refused with NO POST', async () => {
    const mark = await fakeFansly().mark();
    // The history.
    const history = randomUUID();
    let id = await click(4, [history], { hold: 'intent' });
    await heldAt(id, 'intent');
    await live({ historyRevision: '5a1d0000-0000-4000-8000-000000000003' });
    await go(id);
    expect((await answered(id))[0]).toMatchObject({ state: 'refused', proof: 'not-enqueued', code: 'CG-FNEW-HISTORY' });
    await custodyIs(4, history, 'failed');
    await live({});
    // The document the person clicked in.
    const document = randomUUID();
    id = await click(4, [document], { hold: 'intent' });
    await heldAt(id, 'intent');
    await reloadStand();
    await go(id);
    expect((await answered(id))[0]).toMatchObject({ state: 'refused', proof: 'not-enqueued', code: 'CG-FAN-TAB' });
    // Told «not enqueued»; a reload slower than the ticket leaves it held at the hub instead.
    await waitFor('the custody of the document case did not end', async () => ['failed', 'uncertain-held'].includes(await releaseHeld(4, document)));
    // The ticket's end (10 s at the hub, a second of margin on our clock): the hub then holds the fan itself.
    const ticket = randomUUID();
    id = await click(4, [ticket], { hold: 'intent' });
    await heldAt(id, 'intent');
    await browser.pause(10_500);
    await go(id);
    expect((await answered(id))[0]).toMatchObject({ state: 'refused', proof: 'not-enqueued', code: 'CG-TIMEOUT' });
    await waitFor('the custody did not turn uncertain-held', async () => (await custody(4)).some(([at, state]) => at === ticket && state === 'uncertain-held'));
    await waitFor('the journal did not settle', async () => (await journal(ticket))?.reportPending === false);
    expect(await releaseHeld(4, ticket)).toBe('uncertain-held');
    expect(await posts(mark)).toBe(0);
  });

  it('[NF-021] [FS-NET-4] through the tab: the relay frame’s document changes in the intent’s pause → refused, nothing sent, neither by the frame nor direct', async () => {
    await viaTab(true);
    try {
      const mark = await fakeFansly().mark();
      const attempt = randomUUID();
      const id = await click(4, [attempt], { hold: 'intent' });
      await heldAt(id, 'intent');
      await reloadStand();
      await go(id);
      expect((await answered(id))[0]).toMatchObject({ state: 'refused', proof: 'not-enqueued', code: 'CG-FAN-TAB' });
      expect(await posts(mark)).toBe(0);
      await waitFor('the custody did not end', async () => ['failed', 'uncertain-held'].includes(await releaseHeld(4, attempt)));
    } finally {
      await viaTab(false);
    }
  });

  it('[NF-035] the background gone before the intent: refused on the wake, the custody told «not enqueued», nothing sent', async () => {
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    const id = await click(4, [attempt], { hold: 'custody' });
    await heldAt(id, 'custody');
    await restart();
    await waitFor('the journal did not end the interrupted attempt', async () => {
      const entry = await journal(attempt);
      return entry?.state === 'refused' && entry.proof === 'not-enqueued' && entry.code === 'CG-OP-INTERRUPTED' && entry.reportPending === false;
    });
    await waitFor('the custody did not end', async () => ['failed', 'uncertain-held'].includes(await releaseHeld(4, attempt)));
    expect(await posts(mark)).toBe(0);
  });

  it('[NF-022] [NF-035] [RB-007] the background gone after the intent, before the POST: uncertain on the wake, NO request, never repeated', async () => {
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    const id = await click(5, [attempt], { hold: 'written' });
    await heldAt(id, 'written');
    await restart();
    await waitFor('the journal did not keep the attempt uncertain', async () => {
      const entry = await journal(attempt);
      return entry?.state === 'uncertain' && entry.cause === 'restart';
    });
    await browser.pause(2_000);
    expect(await posts(mark)).toBe(0);
    // The fan stays held: a new click asks nothing.
    expect((await answered(await click(5, [randomUUID()])))[0]).toMatchObject({ state: 'refused', code: 'CG-SEND-UNCERTAIN' });
    expect(await posts(mark)).toBe(0);
  });

  it('[NF-022] [NF-035] the background gone after the POST, before the receipt: uncertain on the wake, the one request never repeated', async () => {
    await fakeFansly().command({ op: 'send', echo: 'none', receiptDelayMs: 8_000, echoDelayMs: 0 });
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    await click(6, [attempt]);
    await waitFor('the request did not start', async () => (await view(attempt))?.state === 'requestStarted');
    await restart();
    await waitFor('the journal did not keep the attempt uncertain', async () => {
      const entry = await journal(attempt);
      return entry?.state === 'uncertain' && entry.cause === 'restart';
    });
    await waitFor('the POST did not reach the server', async () => (await posts(mark)) === 1);
    await browser.pause(9_000);
    expect(await posts(mark)).toBe(1);
  });

  it('[NF-020] [NF-035] the background gone after the receipt: its late echo after the wake proves it — sent, the custody hears `sent`', async () => {
    await fakeFansly().command({ op: 'send', echo: 'after', receiptDelayMs: 0, echoDelayMs: 8_000 });
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    await click(7, [attempt]);
    await waitFor('the receipt was not journaled', async () => (await journal(attempt))?.state === 'receipted');
    await restart();
    const entry = await waitFor('the late echo did not prove the receipt', async () => {
      const found = await journal(attempt);
      return found?.state === 'sent' && found.reportPending === false ? found : undefined;
    }, 30_000);
    expect(entry).toMatchObject({ proof: 'echo' });
    await custodyIs(7, attempt, 'sent');
    expect(await posts(mark)).toBe(1);
  });

  it('[NF-021] two clients on one hub page: another install holds the fan’s lease — our click routes nothing, no POST', async () => {
    // The earlier background-restart case cannot release its in-memory lease token. Resolving its custody
    // frees the send, not that 120 s lease: let it expire at the fake hub before the rival takes its own.
    await hub().command({ op: 'clock', advanceMs: BOOTSTRAP_PILOT_PAGES.limits.claimLeaseSec * 1000 + 1 });
    seq += 1;
    const rivalId = `p9d-rival-${seq}`;
    await pages();
    await writeLocalStorage({ [SEND.rival]: { id: rivalId, pageId: PAGE.pageId, fanRef: fanOf(4).fan } });
    const rival = await waitFor('the rival did not take the lease', async () => {
      const found = await read<{ id: string; ok: boolean }>(SEND.rivalResult);
      return found?.id === rivalId ? found : undefined;
    });
    expect(rival).toMatchObject({ ok: true });
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    expect((await answered(await click(4, [attempt])))[0]).toMatchObject({ state: 'refused', proof: 'before-dispatch', code: 'CG-CLAIM-BUSY' });
    expect(await posts(mark)).toBe(0);
    expect((await custody(4)).some(([id]) => id === attempt)).toBe(false);
  });
});
