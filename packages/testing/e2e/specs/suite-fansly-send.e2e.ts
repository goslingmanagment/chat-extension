// R20 P9d: the greeting's HTTP send with the hub's custody on the stand (spec FS-NEW-3; architecture.md §8.6;
// NF-020…022, NF-035, RB-007). Until «Новые» clicks it (P10c) the test build's probe (apps/extension/bg/fansly/
// send-probe.ts) starts the attempts through the module's one send service — the real lock, lease, route, journal,
// custody of the fake hub, final check and `POST /message` to the fake Fansly — and holds them at the boundaries:
// - one click → one POST; the receipt and its echo (also an echo before the receipt) → `sent`, the custody `sent`;
//   two clicks at once → one POST; the journal holds ids, never the text;
// - `200 {success:false}` and a lost answer without proof → `uncertain`, never repeated, the fan held;
//   X41: a browser resend may store TWO messages; only its own receipt+echo proves `sent`;
// - the custody's answer delayed, the intent's write itself delayed: the history, the tab's document (the relay
//   frame's too) or the ticket's end changing in that pause → `refused` with no POST, the custody told «not enqueued»;
// - the background gone at each boundary: before the intent → refused and told; after it → uncertain with no POST;
//   after the POST → uncertain; after the receipt → its late echo still proves it, the custody hears `sent`;
// - another install holding the fan's lease: our click routes nothing.
// The account changing in the pause is a unit test (core send.test.ts): the stand holds one account.

import { randomUUID } from 'node:crypto';

import { browser, expect } from '@wdio/globals';
import { WORLD } from '../../src/scenarios/hub/world';
import { pageRpc, readLocalStorage, waitForReport, writeLocalStorage } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { startFanslyShift } from '../support/fansly-shift';
import { fakeFansly, fanslyIds, waitForFanslyStandIdle } from '../support/fansly-stand';
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

  async function live(change: { readonly historyRevision?: string }): Promise<void> {
    await pages();
    await writeLocalStorage({ [SEND.live]: change });
  }

  async function view(attemptId: string): Promise<View | undefined> {
    return (await read<Record<string, View>>(SEND.views))?.[attemptId];
  }

  /**
   * The click answers at Fansly's receipt (the card already shows it sent, restrictions item 21); the echo proves it
   * a moment later. An answer that is still `receipted` is followed to where the attempt settles.
   */
  async function settled(answer: View | undefined): Promise<View | undefined> {
    if (answer?.state !== 'receipted') return answer;
    return waitFor(`${answer.attemptId} stayed «receipted»`, async () => {
      const now = await view(answer.attemptId);
      return now !== undefined && now.state !== 'receipted' ? now : undefined;
    }, 20_000);
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

  async function moduleStarted(): Promise<void> {
    await pages();
    await waitFor('Fansly’s background module did not start', async () => {
      const diagnostic = await pageRpc<{ hostModules: Array<{ host: string; state: string }> }>('diagnostics.get');
      return diagnostic.ok && diagnostic.payload.hostModules.some((entry) => entry.host === 'fansly-web' && entry.state === 'started');
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
    expect(await settled(views[0])).toMatchObject({ attemptId: first, state: 'sent', proof: 'echo' });
    expect(views[1]).toMatchObject({ attemptId: second, state: 'refused', proof: 'before-dispatch', code: 'CG-SEND-BUSY' });
    expect(await posts(mark)).toBe(1);
    await custodyIs(0, first, 'sent');
    expect((await custody(0)).map(([id]) => id)).toEqual([first]);
    const entry = await waitFor('the journal did not settle the report', async () => {
      const found = await journal(first);
      return found?.state === 'sent' && found.reportPending === false ? found : undefined;
    });
    expect(entry.platformMessageId).toBe((await settled(views[0]))?.platformMessageId);
    expect(JSON.stringify(await read(JOURNAL))).not.toContain(TEXT);
  });

  it('[NF-020] the echo before the receipt proves it the moment the receipt comes', async () => {
    await fakeFansly().command({ op: 'send', echo: 'before', receiptDelayMs: 300, echoDelayMs: 0 });
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    expect(await settled((await answered(await click(1, [attempt])))[0])).toMatchObject({ state: 'sent', proof: 'echo' });
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

  it('[NF-022] [RB-007] the lost answer: one fetch/requestId, never asked again; X41 browser resend may store TWO messages — sent only by its receipt+echo, otherwise uncertain', async () => {
    await fakeFansly().command({ op: 'api', rules: [{ route: 'message.send', caller: 'ours', times: 1, outcome: { kind: 'drop' }, effect: true }] });
    const mark = await fakeFansly().mark();
    const attempt = randomUUID();
    const result = await settled((await answered(await click(3, [attempt])))[0]);
    const requestId = (await journal(attempt))?.requestId;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    // A reset before response bytes can make Firefox resend the SAME fetch. Raw hits are transport evidence,
    // not extension attempts. A second extension fetch has a NEW id and must still fail NF-022.
    const seen = (await fakeFansly().calls('ours', mark)).filter((entry) => entry.route === 'message.send');
    expect([...new Set(seen.map((entry) => entry.detail?.['requestId']))]).toEqual([requestId]);
    expect(seen[0]).toMatchObject({ status: 0, detail: { outcome: 'drop', effect: true } });
    const messageIds = seen.flatMap((entry) => typeof entry.detail?.['messageId'] === 'string' ? [entry.detail['messageId']] : []);
    if (seen.length === 2) {
      // The accepted X41 duplicate window: both POSTs took effect, not merely two HTTP hits.
      expect(messageIds).toHaveLength(2);
      expect(new Set(messageIds).size).toBe(2);
      expect(seen[1]).toMatchObject({ status: 200, detail: { requestId, groupId: fanOf(3).group, senderId: creator } });
    } else {
      expect(seen).toHaveLength(1);
      expect(messageIds).toHaveLength(1);
    }
    const sent = result?.state === 'sent';
    if (sent) expect(messageIds).toHaveLength(2);
    // A late status alone is insufficient: `sent` must name the receipt/echo id of THIS requestId's replay,
    // not the first (lost) message, another request or a message with the same text.
    const expected = sent
      ? { state: 'sent', proof: 'echo', platformMessageId: messageIds[1] }
      : { state: 'uncertain', cause: 'network', code: 'CG-SEND-UNCERTAIN' };
    expect(result).toMatchObject(expected);
    if (sent) await custodyIs(3, attempt, 'sent');
    console.info('NF-022 X41', { requestId, recordedMessages: messageIds.length, messageIds, result });
    const oneRequest = async (): Promise<void> => {
      expect((await fakeFansly().calls('ours', mark)).filter((entry) => entry.route === 'message.send')).toEqual(seen);
      expect(await journal(attempt)).toMatchObject({ ...expected, requestId });
    };
    await oneRequest();
    await browser.pause(3_000);
    await oneRequest();
    expect((await answered(await click(3, [randomUUID()])))[0]).toMatchObject({ state: 'refused', code: sent ? 'CG-SEND-PART' : 'CG-SEND-UNCERTAIN' });
    await oneRequest();
    expect(await view(attempt)).toMatchObject(expected);
    expect((await custody(3)).map(([id]) => id)).toEqual([attempt]);
  });
});
