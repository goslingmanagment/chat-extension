// R09 part B on the R02 stand (architecture.md §6.6–§6.8, §6.7.13, §12 п. 4):
// the X8 preview send through the stand's own send queue, the receipt
// observer, the observation of human sends and the WS tap — in headless
// Firefox, without the extension (the integrator wires it next). Three
// scripts go in as WebDriver BiDi preload scripts, before any page script: the
// tap script and the bridge with its runtime into the page's own realm, the
// isolated side into a sandbox realm (support/host-harness.ts).
//
// What the stand is: its own Pinia send queue, a Ky-like HTTP client that
// takes `fetch` when a request object is created, a loopback native endpoint
// scripted by the test, a WebSocket server, and a journal that labels every
// call by who made it. What it proves here: the rows of the §6.7.13 matrix
// that can run without the hub (the hub's custody, lease and served-context
// rows are R05/R10's) — each test title names its row — and that nothing but
// the page's own client ever talks to the stand.

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ADAPTER_VERSION, receiptModules } from '@cg/host-chatspace/isolated';
import { browser, expect } from '@wdio/globals';

import type { PageJournalEntry, SendOutcome, ServerJournalEntry } from '../../fixture-chatspace/src/protocol';
import { FIXTURE_BUILD_DIR } from '../../src/stand/paths';
import { harness, installHostHarness, waitForHarness, waitForHarnessState, type InstalledHarness } from '../support/host-harness';
import { useNetworkTrap } from '../support/network-trap';
import { callStand, chatPath, foreignCalls, openStand, STAND_IDS, standOrigin, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const ACC_B = STAND_IDS.accounts.b;
const ACC_C = STAND_IDS.accounts.c;
const CREATOR = STAND_IDS.platformAccounts.a;
const { a1, a2, a3, a4, a5, a6, a7, a8, b1, c1 } = STAND_IDS.fans;
/** Fans of account a the dataset has beyond the named ones (ids follow its pattern). */
const a9 = '74001009';
const a10 = '74001010';
const a11 = '74001011';
const a12 = '74001012';

interface View {
  attemptId: string;
  state: string;
  code?: string;
  platformMessageId?: string;
  httpStatus?: number;
  detail?: { guardTopics?: string[]; upstream?: string };
}
interface Checkpoint {
  documentEpoch: string;
  socketEpoch: number;
  subscriptionEpoch: number;
  hostAccountId: string;
  platformFanId: string;
  fanSequence: number;
  lastFanMessageId: string | null;
  knownFanMessageIds: string[];
  observedAt: number;
  coverage: 'ok' | 'unknown';
}
interface SendResult {
  attemptId: string | null;
  preflight: { ok: boolean; code?: string } | null;
  commit: { state: string; code?: string; pendingId?: string } | null;
  reason?: string;
}
interface SendOptions {
  acc?: string;
  fan: string;
  text?: string;
  attemptId?: string;
  checkpoint?: Checkpoint;
  original?: string;
  part?: number;
  ticketMs?: number;
  skipPreflight?: boolean;
  platformAccountId?: string;
}
interface Report {
  capabilities: Record<string, { state: string; reason?: string; code?: string }>;
  anchors: Record<string, string>;
  adapterVersion: string;
}
type LiveEvent =
  | { type: 'incoming'; fact: { hostAccountId: string; platformFanId: string; platformMessageId: string; fromFan: boolean; fanSequence: number; source: string } }
  | { type: 'coverage'; coverage: { hostAccountId: string; state: string; reason: string } }
  | { type: 'humanSend'; fact: { chat: { platformFanId: string }; pendingId: string; platformMessageId: string | null; textDigest: string; draft: { revision: number; provenance: string; insertIntentId: string | null; editedSinceInsert: boolean | null } } };

const evidence: Record<string, unknown> = {};
const evidenceDir = fileURLToPath(new URL('../../../../.cache/e2e/', import.meta.url));

/** The approved receipt profile of this stand build: the role modules as the build wrote them to disk (not as the page reports them). */
const standProfile = () => ({ id: 'stand-build', adapterVersion: ADAPTER_VERSION, modules: receiptModules(readdirSync(`${FIXTURE_BUILD_DIR}assets`).map((name) => `/assets/${name}`), standOrigin()) });
const liveConfig = (over: Record<string, unknown> = {}) => ({ wsTap: true, previewSend: true, markAiGenerated: true, receiptProfiles: [standProfile()], ...over });

const sendOptions = (options: SendOptions) => ({ acc: ACC, platformAccountId: CREATOR, text: 'Synthetic preview reply', ...options });
const send = (options: SendOptions): Promise<SendResult> => harness<SendResult>('send', sendOptions(options));
const preflight = (options: SendOptions): Promise<{ ok: boolean; code?: string }> => harness('preflight', sendOptions(options));
const checkpoint = (fan: string, acc: string = ACC): Promise<Checkpoint | null> => harness<Checkpoint | null>('checkpoint', acc, fan);
const statesOf = async (attemptId: string | null): Promise<View[]> => (attemptId === null ? [] : harness<View[]>('sendStates', attemptId));
const liveEvents = <T extends LiveEvent['type']>(type: T): Promise<Array<Extract<LiveEvent, { type: T }>>> => harness('liveEvents', type);

/** Waits until the attempt reached `state` (or any of them); returns every state MAIN reported, in order. */
async function settled(attemptId: string | null, ...states: string[]): Promise<View[]> {
  return waitForHarnessState(
    () => statesOf(attemptId),
    (views) => views.some((view) => states.includes(view.state)),
    `attempt ${String(attemptId)} → ${states.join(' | ')}`,
    8000,
  );
}

const serverSince = async (mark: number): Promise<ServerJournalEntry[]> => [...(await standServer.journal(mark)).entries];
const sendsOf = (entries: readonly ServerJournalEntry[], fan?: string): ServerJournalEntry[] => entries.filter((entry) => entry.kind === 'send' && (fan === undefined || entry.chatId === fan));
const historyLoads = (entries: readonly ServerJournalEntry[], fan: string): ServerJournalEntry[] => entries.filter((entry) => entry.kind === 'history-load' && entry.chatId === fan);
const pageMark = async (): Promise<number> => (await callStand('journal')).at(-1)?.seq ?? 0;
const pageSince = (mark: number): Promise<readonly PageJournalEntry[]> => callStand('journal', mark);
const queueAdds = (entries: readonly PageJournalEntry[]): PageJournalEntry[] => entries.filter((entry) => entry.type === 'queue-added');

/** What a message's HTML shows: line breaks as \n, tags gone, entities decoded — the «displayed text» of §6.7.13. */
function shown(html: unknown): string {
  return String(html)
    .replace(/<br\s*\/?>|<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The entries of ChatSpace's own queue for the account, as the page holds them. */
async function queueEntries(acc: string = ACC): Promise<Array<{ id: string; chatId: string; status: string; error: { kind: string } | null }>> {
  const all = (await callStand('pendingMessages')) as Record<string, Array<{ id: string; chatId: string; status: string; error: { kind: string } | null }>>;
  return all[acc] ?? [];
}

/** The person uses a button of ChatSpace's own queue (Resend, Cancel): the stand has no such buttons, so its store's action is called the way the button would. */
const nativeQueueAction = (action: 'resend' | 'cancel', acc: string, id: string): Promise<void> =>
  browser.execute(
    (name: string, account: string, entry: string) => {
      const app = document.querySelector<Element & { __vue_app__?: { config: { globalProperties: Record<string, unknown> } } }>('#app')?.__vue_app__;
      const pinia = app?.config.globalProperties['$pinia'] as { _s: Map<string, Record<string, (acc: string, id: string) => void>> } | undefined;
      pinia?._s.get('pendingMessages')?.[name]?.(account, entry);
    },
    action,
    acc,
    id,
  );

/** The account is armed: ChatSpace's socket is authenticated, the account is subscribed, a frame of it came (§6.8 п. 6). */
async function armed(acc: string = ACC, fan: string = a5): Promise<Checkpoint> {
  const point = await waitForHarnessState(
    () => checkpoint(fan, acc),
    (value) => value?.coverage === 'ok',
    `account ${acc} armed`,
    15_000,
  );
  return point as Checkpoint;
}

async function open(path: string, config: Record<string, unknown> | null = liveConfig()): Promise<Report | null> {
  await browser.execute(() => {
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('chat-space:')) localStorage.removeItem(key);
    } catch {
      // about:blank before the first stand page
    }
  });
  await openStand(path);
  await waitForHarness();
  await waitForHarnessState(
    () => harness<{ contract: { anchors: Record<string, string> } }>('state'),
    (s) => s.contract.anchors['app'] === 'ok' && s.contract.anchors['mimic'] === 'ok',
    'adapter sees the app',
  );
  return config === null ? null : harness<Report>('configure', config);
}

describe('R09 part B — X8, the receipt, human sends and the WS tap on the stand', () => {
  const { trap } = useNetworkTrap();
  let journalStart = 0;
  let installed: InstalledHarness | null = null;

  before(async () => {
    await standServer.reset();
    // The first frame of an account (a summary) comes soon after its subscription, so an account arms quickly.
    await standServer.traffic({ firstSummaryMs: 150 });
    journalStart = await standServer.mark();
    installed = await installHostHarness({ tap: 'first' });
  });

  after(async () => {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(`${evidenceDir}x8-send.json`, `${JSON.stringify({ ...evidence, harnessBytes: { main: installed?.mainBytes, tap: installed?.tapBytes, isolated: installed?.isolatedBytes } }, null, 2)}\n`);
    await installed?.remove();
    // §12 «Гейт безопасности», §6.7.13 «изоляция трафика»: nothing but the page's own client and the harness talked to the stand.
    const entries = await serverSince(journalStart);
    expect(foreignCalls(entries)).toEqual([]);
    expect(sendsOf(entries).filter((entry) => entry.origin !== 'native')).toEqual([]);
    void trap;
  });

  describe('the tap, the flags and the receipt profile', () => {
    let report: Report | null = null;

    before(async () => {
      report = await open(chatPath(ACC, a1));
      await waitForChatReady(ACC, a1);
    });

    it('[X8-04] [SN-001] the tap wraps only the constructor: ChatSpace’s socket works as before, and its frames arm the subscribed accounts', async () => {
      const page = await browser.execute(() => {
        const handle = (window as unknown as Record<symbol, { version?: number; socketCount?: () => number } | undefined>)[Symbol.for('wsTap')];
        return {
          version: handle?.version ?? null,
          sockets: handle?.socketCount?.() ?? -1,
          enumerable: Object.keys(window).includes('wsTap'),
          statics: [WebSocket.CONNECTING, WebSocket.OPEN, WebSocket.CLOSING, WebSocket.CLOSED],
          prototypeNative: String(Object.getOwnPropertyDescriptor(WebSocket.prototype, 'send')?.value).includes('[native code]'),
        };
      });
      expect(page).toEqual({ version: 1, sockets: 1, enumerable: false, statics: [0, 1, 2, 3], prototypeNative: true });
      expect(await callStand('wsStatus')).toMatchObject({ status: 'OPEN', authenticated: true, sockets: 1 });
      const point = await armed();
      expect(point).toMatchObject({ socketEpoch: 1, hostAccountId: ACC, platformFanId: a5, fanSequence: 0, lastFanMessageId: null, knownFanMessageIds: [] });
      // Another subscribed account arms on its own frames; an account ChatSpace did not subscribe never does (§6.8 п. 9).
      expect((await armed(ACC_B, b1)).coverage).toBe('ok');
      expect((await checkpoint(c1, ACC_C))?.coverage).toBe('unknown');
      const coverage = await liveEvents('coverage');
      expect(coverage.filter((event) => event.coverage.state === 'ok').map((event) => event.coverage.hostAccountId).sort()).toEqual([ACC, ACC_B].sort());
    });

    it('[X8-06] the receipt profile is read from the modules the page already loaded, and only an approved one turns X8 on', async () => {
      const loaded = await harness<{ modules: Record<string, string> }>('receiptProfile');
      // What the page's DOM and resource timing show is what the build wrote to disk.
      expect(loaded.modules).toEqual(standProfile().modules);
      expect(Object.keys(loaded.modules).sort()).toEqual(['accounts', 'composables', 'inbox', 'notificationEntry', 'onlyfans']);
      // Laid out like ChatSpace 0.195.0: no `messages` module; two `onlyfans` modules, one fingerprint of both hashes, sorted.
      expect(readdirSync(`${FIXTURE_BUILD_DIR}assets`).filter((name) => name.startsWith('messages-'))).toEqual([]);
      const onlyfans = (loaded.modules['onlyfans'] ?? '').split('+');
      expect(onlyfans).toHaveLength(2);
      expect(onlyfans).toEqual([...onlyfans].sort());
      evidence['receiptProfile'] = loaded;
      expect(report?.adapterVersion).toBe(ADAPTER_VERSION);
      for (const name of ['previewSend', 'receipt', 'sendObserve', 'incoming']) expect([name, report?.capabilities[name]]).toEqual([name, { state: 'on' }]);
      expect(report?.anchors['wsFrames']).toBe('ok');
      expect(report?.anchors['receiptProfile']).toBe('ok');
      expect(await harness<boolean>('previewSendAvailable')).toBe(true);

      // Another build's modules, or another adapter version: no profile, no X8 — the insert path is untouched.
      const other = await harness<Report>('configure', liveConfig({ receiptProfiles: [{ ...standProfile(), modules: { ...standProfile().modules, notificationEntry: 'AAAAAAAA' } }, { ...standProfile(), adapterVersion: '0.0.1' }] }));
      expect(other.capabilities['previewSend']).toEqual({ state: 'off', reason: 'receiptProfile', code: 'CG-SEND-RECEIPT' });
      expect(other.capabilities['insert']).toEqual({ state: 'on' });
      expect(await harness<boolean>('previewSendAvailable')).toBe(false);
      expect(await send({ fan: a5 })).toMatchObject({ attemptId: null, reason: 'no-port' });
      const back = await harness<Report>('configure', liveConfig());
      expect(back.capabilities['previewSend']).toEqual({ state: 'on' });
    });

    it('reading the fingerprint downloads nothing: every module of the page was requested once, by the page', async () => {
      const entries = await serverSince(journalStart);
      expect(foreignCalls(entries)).toEqual([]);
      const scripts = entries.filter((entry) => entry.kind === 'http' && /\/assets\/[^/]+\.js$/.test(entry.path ?? ''));
      expect(scripts.every((entry) => entry.origin === 'asset')).toBe(true);
      const perPath = new Map<string, number>();
      for (const entry of scripts) perPath.set(entry.path ?? '', (perPath.get(entry.path ?? '') ?? 0) + 1);
      expect([...perPath.values()].every((count) => count === 1)).toBe(true);
    });
  });

  describe('§6.7.13: the one queue call', () => {
    before(async () => {
      await open(chatPath(ACC, a1));
      await waitForChatReady(ACC, a1);
      await armed();
    });

    it('[X8-05] [SP-054] a cold target (no composer, no chat tab, no cache): exactly one queue call; no tab opens, no history loads, nothing is marked read, both drafts stay', async () => {
      // The person has a draft in the open chat.
      await $(`[data-stand-composer$=":${a1}"] .ProseMirror`).click();
      await browser.keys('my own draft');
      const draftBefore = await callStand('draft', ACC, a1);
      expect(await callStand('queryState', ['chatMessages', ACC, a5])).toMatchObject({ exists: false });
      const server = await standServer.mark();
      const page = await pageMark();

      const result = await send({ fan: a5, text: 'Hello from the preview' });
      expect(result.preflight).toEqual({ ok: true });
      expect(result.commit).toMatchObject({ state: 'nativeEnqueued' });
      const states = await settled(result.attemptId, 'sentObserved');
      expect(states.map((view) => view.state)).toEqual(['nativeAccepted', 'sentObserved']);
      expect(states[0]?.platformMessageId).toMatch(/^\d+$/);
      expect(states[1]?.platformMessageId).toBe(states[0]?.platformMessageId);

      const entries = await serverSince(server);
      const sends = sendsOf(entries);
      expect(sends).toHaveLength(1);
      // §6.7.2: what ChatSpace's own client put on the wire.
      expect(sends[0]).toMatchObject({ origin: 'native', accountId: ACC, chatId: a5 });
      expect(sends[0]?.detail).toMatchObject({ text: '<p>Hello from the preview</p>', isCopied: false, isAiGenerated: true, internalTemplateId: null, replyTime: null, previousMessage: null, platformMetadata: {} });
      expect(historyLoads(entries, a5)).toEqual([]);
      expect(foreignCalls(entries)).toEqual([]);

      const journal = await pageSince(page);
      expect(queueAdds(journal)).toHaveLength(1);
      expect(queueAdds(journal)[0]).toMatchObject({ accountId: ACC, chatId: a5, busy: false });
      // The native request took our observer as its fetch (the capture works) and was the only one that did.
      const requests = journal.filter((entry) => entry.type === 'http-request');
      expect(requests.filter((entry) => entry['fetchCapture'] === 'substituted').map((entry) => [entry['method'], entry['path']])).toEqual([['POST', `/api/v0/accounts/${ACC}/chats/${a5}/messages`]]);
      expect(journal.filter((entry) => entry.type === 'query-fetch' && JSON.stringify(entry['key']).includes(a5))).toEqual([]);
      expect(journal.filter((entry) => entry.type === 'chat-marked-read-locally')).toEqual([]);

      // No route change, no chat tab, no composer for the target; the person's draft and the target's (none) are as they were.
      expect(await callStand('route')).toMatchObject({ accountId: ACC, chatId: a1 });
      expect((await callStand('composers')).map((composer) => composer.chatId)).toEqual([a1]);
      expect((await callStand('composerState', ACC, a1))?.text).toBe('my own draft');
      expect(await callStand('draft', ACC, a1)).toEqual(draftBefore);
      expect(await callStand('draft', ACC, a5)).toBeNull();
      expect(await callStand('queryState', ['chatMessages', ACC, a5])).toMatchObject({ hasData: false, active: false });
      // ChatSpace's own queue is empty again; the page's fetch is the page's.
      expect(await queueEntries()).toEqual([]);
      expect(await browser.execute(() => window.fetch.toString().includes('[native code]'))).toBe(true);
    });

    it('[X8-05] an idle unobserved cache is updated without a load; an observed history query refuses the send before the queue', async () => {
      // The person had the chat open and left it: its cache stays, nobody observes it.
      await callStand('openChat', ACC, a2);
      await waitForChatReady(ACC, a2);
      await callStand('openChat', ACC, a1);
      await waitForChatReady(ACC, a1);
      await browser.waitUntil(async () => (await callStand('queryState', ['chatMessages', ACC, a2])).active === false, { timeout: 5000, timeoutMsg: 'the left chat is still observed' });
      expect(await callStand('queryState', ['chatMessages', ACC, a2])).toMatchObject({ exists: true, hasData: true, active: false, loading: false });
      const server = await standServer.mark();
      const result = await send({ fan: a2, text: 'Into the idle cache' });
      const states = await settled(result.attemptId, 'sentObserved');
      const id = states[0]?.platformMessageId;
      const entries = await serverSince(server);
      expect(sendsOf(entries, a2)).toHaveLength(1);
      // With a cache the queue itself names the previous message.
      expect(sendsOf(entries, a2)[0]?.detail?.['previousMessage']).toMatchObject({ is_fan_message: expect.any(Boolean) as unknown });
      expect(historyLoads(entries, a2)).toEqual([]);
      const cached = (await callStand('queryData', ['chatMessages', ACC, a2])) as { pages: Array<{ items: Array<{ id: string }> }> };
      expect(cached.pages.flatMap((page) => page.items).some((item) => String(item.id) === id)).toBe(true);

      // An observed query would refetch the history after the send (and that marks the chat read): refused, nothing queued.
      const hold = await callStand('holdQueryObserver', ['chatMessages', ACC, a4]);
      expect(await callStand('queryState', ['chatMessages', ACC, a4])).toMatchObject({ exists: true, active: true });
      const mark = await standServer.mark();
      expect(await preflight({ fan: a4 })).toEqual({ ok: false, code: 'CG-SEND-HISTORY' });
      expect((await send({ fan: a4, skipPreflight: true })).commit).toEqual({ state: 'held', code: 'CG-SEND-HISTORY' });
      expect(sendsOf(await serverSince(mark))).toEqual([]);
      await callStand('releaseQueryObserver', hold);
    });

    it('[RB-022] looking and generating leave the chat unread; the outgoing echo clears it the native way', async () => {
      const unread = async (fan: string): Promise<number | null> => {
        const list = (await callStand('queryData', ['chatList', ACC, 'all'])) as { pages: Array<{ items: Array<{ id: string; unreadMessagesCount: number }> }> } | null;
        return list?.pages.flatMap((page) => page.items).find((chat) => chat.id === fan)?.unreadMessagesCount ?? null;
      };
      const before = await unread(a6);
      expect(before).toBeGreaterThan(0);
      // Generate (the checkpoint) and the button's preflight: reads only.
      const point = await checkpoint(a6);
      expect(await preflight({ fan: a6, ...(point ? { checkpoint: point } : {}) })).toEqual({ ok: true });
      expect(await unread(a6)).toBe(before);
      const result = await send({ fan: a6, ...(point ? { checkpoint: point } : {}) });
      await settled(result.attemptId, 'sentObserved');
      await browser.waitUntil(async () => (await unread(a6)) === 0, { timeout: 5000, timeoutMsg: 'the outgoing echo did not clear the unread count' });
    });

    it('[X8-02] HTML and flags: the shown text and its line breaks are the same as through «Открыть и вставить» + Send; AI mark by ChatSpace’s own rule; never «copied»', async () => {
      const texts = ['Tom & Jerry', 'a literal &lt;3 stays five characters', '<b>not bold</b> and 1 > 0', `"double" and 'single' quotes`, 'first line\r\nsecond line', 'top\n\nafter an empty line'];
      const server = await standServer.mark();
      const viaQueue: string[] = [];
      for (const text of texts) {
        const result = await send({ fan: a7, text });
        expect(result.commit?.state).toBe('nativeEnqueued');
        await settled(result.attemptId, 'sentObserved');
      }
      const x8 = sendsOf(await serverSince(server), a7);
      expect(x8).toHaveLength(texts.length);
      for (const entry of x8) {
        viaQueue.push(shown(entry.detail?.['text']));
        expect(entry.detail).toMatchObject({ isCopied: false, isAiGenerated: true, platformMetadata: {}, internalTemplateId: null, replyTime: null });
      }
      expect(viaQueue).toEqual(texts.map((text) => text.replace(/\r\n/g, '\n')));
      expect(x8.map((entry) => entry.detail?.['text'])).toEqual([
        '<p>Tom &amp; Jerry</p>',
        '<p>a literal &amp;lt;3 stays five characters</p>',
        '<p>&lt;b&gt;not bold&lt;/b&gt; and 1 &gt; 0</p>',
        `<p>"double" and 'single' quotes</p>`,
        '<p>first line<br>second line</p>',
        '<p>top<br><br>after an empty line</p>',
      ]);

      // The same texts through the composer: inserted by the adapter, sent by the person with ChatSpace's own Send.
      const composerMark = await standServer.mark();
      await $(`[data-stand-composer$=":${a1}"] .ProseMirror`).click();
      await browser.keys([process.platform === 'darwin' ? 'Meta' : 'Control', 'a']);
      await browser.keys('Backspace');
      for (const text of texts) {
        await waitForHarnessState(
          () => harness<{ composer: { ready: boolean } | null; identity: { composerInstanceId: string | null } | null }>('state'),
          (state) => state.composer?.ready === true && state.identity?.composerInstanceId !== null,
          'composer ready',
        );
        expect(await harness<{ state: string }>('insert', { text })).toMatchObject({ state: 'applied' });
        const before = sendsOf(await serverSince(composerMark), a1).length;
        await $(`[data-stand-composer$=":${a1}"] [data-stand-send]`).click();
        await browser.waitUntil(async () => sendsOf(await serverSince(composerMark), a1).length === before + 1 && (await queueEntries()).length === 0, { timeout: 5000, timeoutMsg: 'the composer send did not finish' });
      }
      const viaComposer = sendsOf(await serverSince(composerMark), a1).map((entry) => shown(entry.detail?.['text']));
      expect(viaComposer).toEqual(viaQueue);

      // A rewritten part is not the AI's any more; a small edit still is (ChatSpace's own rule against the original part).
      const original = 'Hey love, I was just thinking about you — how was your day at work?';
      const marks = await standServer.mark();
      for (const text of [original.replace('love', 'dear'), 'Tell me what you did today, I missed you so much']) {
        const result = await send({ fan: a7, text, original });
        await settled(result.attemptId, 'sentObserved');
      }
      expect(sendsOf(await serverSince(marks), a7).map((entry) => entry.detail?.['isAiGenerated'])).toEqual([true, false]);
      // The owner turned the mark off: `is_ai_generated` is false whatever the text.
      await harness('configure', liveConfig({ markAiGenerated: false }));
      const off = await standServer.mark();
      await settled((await send({ fan: a7, text: 'unmarked' })).attemptId, 'sentObserved');
      expect(sendsOf(await serverSince(off), a7).map((entry) => entry.detail?.['isAiGenerated'])).toEqual([false]);
      await harness('configure', liveConfig());
    });
  });

  describe('§6.7.13: conditions — zero queue calls, a reason, and nothing of ChatSpace is touched', () => {
    before(async () => {
      await open(chatPath(ACC, a1));
      await waitForChatReady(ACC, a1);
      // The person looked at these two chats earlier: ChatSpace holds their fans (it loads a fan with its chat).
      for (const fan of [a3, a8]) await callStand('openChat', ACC, fan);
      await browser.waitUntil(async () => Object.keys(((await callStand('queryData', ['fansMap', ACC])) as Record<string, unknown> | null) ?? {}).includes(a8), { timeout: 5000, timeoutMsg: 'fansMap has no a8' });
      await callStand('openChat', ACC, a1);
      await waitForChatReady(ACC, a1);
      await armed();
    });

    /** Both the button's answer and the click refuse with the code, and nothing reaches the queue or the server. */
    async function refused(options: SendOptions, code: string): Promise<void> {
      const server = await standServer.mark();
      const page = await pageMark();
      expect(await preflight(options)).toEqual({ ok: false, code });
      const click = await send({ ...options, skipPreflight: true });
      expect(click.commit).toEqual({ state: 'held', code });
      expect(await statesOf(click.attemptId)).toEqual([]);
      expect(sendsOf(await serverSince(server))).toEqual([]);
      expect(queueAdds(await pageSince(page))).toEqual([]);
    }

    it('[X8-03] the open chat is not a preview target', async () => {
      await refused({ fan: a1 }, 'CG-SEND-ACTIVE-CHAT');
    });

    it('[X8-03] a blocked fan, and one that cannot receive messages (the page’s own knowledge wins)', async () => {
      // a3 is blocked on the platform, and the page knows it.
      expect(((await callStand('queryData', ['fansMap', ACC])) as Record<string, { isBlocked?: boolean }>)[a3]).toMatchObject({ isBlocked: true });
      await refused({ fan: a3 }, 'CG-SEND-FAN');
      await callStand('setFan', ACC, a8, { canReceiveChatMessage: false });
      await refused({ fan: a8 }, 'CG-SEND-FAN');
      await callStand('setFan', ACC, a8, { canReceiveChatMessage: true, isRestricted: true });
      await refused({ fan: a8 }, 'CG-SEND-FAN');
      await callStand('setFan', ACC, a8, { isRestricted: false });
      expect(await preflight({ fan: a8 })).toEqual({ ok: true });
    });

    it('[X8-03] the role cannot send: refused, and the permissions stay as they are', async () => {
      await callStand('setPermissions', ['of_block_message_sending']);
      await refused({ fan: a8 }, 'CG-SEND-PERMISSION');
      expect(await callStand('queryData', ['userPermissions'])).toEqual(['of_block_message_sending']);
      await callStand('setPermissions', []);
      // Another creator's page than the hub binding names: not this account's send.
      await refused({ fan: a8, platformAccountId: STAND_IDS.platformAccounts.b }, 'CG-SEND-PERMISSION');
      expect(await preflight({ fan: a8 })).toEqual({ ok: true });
    });

    it('[X8-03] Mimic runs the chat: refused, and Mimic is not stopped', async () => {
      await callStand('setMimic', { isActive: true, chats: { [`${ACC}:${a8}`]: 'enabled' } });
      await refused({ fan: a8 }, 'CG-SEND-MIMIC');
      expect(await callStand('queryData', ['mimicChats'])).toMatchObject({ [`${ACC}:${a8}`]: { status: 'enabled' } });
      // Mimic on another chat of the account does not hold this one.
      expect(await preflight({ fan: a9 })).toEqual({ ok: true });
      await callStand('setMimic', { isActive: false, chats: {} });
      expect(await preflight({ fan: a8 })).toEqual({ ok: true });
    });

    it('[X8-03] the translator would translate on send: refused — the queue would bypass it; it is not switched off and nothing is translated', async () => {
      await callStand('setTranslator', ACC, { enabled: true, autoTranslate: true });
      await refused({ fan: a8 }, 'CG-SEND-TRANSLATOR');
      const settings = await browser.execute((acc: string) => {
        const raw = Object.keys(localStorage).find((key) => key.startsWith('chat-space:composer-translator:accounts:'));
        return raw ? (JSON.parse(localStorage.getItem(raw) ?? '{}') as Record<string, unknown>)[acc] : null;
      }, ACC);
      expect(settings).toMatchObject({ enabled: true, autoTranslate: true });
      // A manual translator (no auto-translate on send) does not hold the send.
      await callStand('setTranslator', ACC, { enabled: true, autoTranslate: false });
      expect(await preflight({ fan: a8 })).toEqual({ ok: true });
      await callStand('setTranslator', ACC, { enabled: false, autoTranslate: true });
    });

    it('[X8-03] a busy account queue: «дождитесь текущей отправки» — never behind another send; the native timeout of that send is uncertain', async () => {
      await callStand('setQueueTimeoutMs', 1200);
      await standServer.script(ACC, a9, [{ kind: 'hang' }]);
      const server = await standServer.mark();
      const first = await send({ fan: a9, text: 'will hang' });
      expect(first.commit?.state).toBe('nativeEnqueued');
      // The first is on the wire: ChatSpace's queue for the account is busy.
      await browser.waitUntil(async () => sendsOf(await serverSince(server), a9).length === 1, { timeout: 5000 });
      const page = await pageMark();
      expect(await preflight({ fan: a8 })).toEqual({ ok: false, code: 'CG-SEND-BUSY' });
      expect((await send({ fan: a8, skipPreflight: true })).commit).toEqual({ state: 'held', code: 'CG-SEND-BUSY' });
      expect(queueAdds(await pageSince(page))).toEqual([]);
      // Another account's queue is its own.
      expect(await preflight({ acc: ACC_B, fan: b1, platformAccountId: STAND_IDS.platformAccounts.b })).toEqual({ ok: true });

      // ChatSpace's own timeout ends the request that really went out: we cannot know what the server did.
      const states = await settled(first.attemptId, 'uncertain');
      expect(states).toEqual([{ attemptId: first.attemptId, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', detail: { upstream: 'no receipt' } }]);
      const entries = await serverSince(server);
      expect(sendsOf(entries)).toHaveLength(1);
      expect(entries.some((entry) => entry.kind === 'send-aborted' && entry.chatId === a9)).toBe(true);
      // The failed entry is ChatSpace's, with its own buttons; nothing of ours repeats it.
      expect(await queueEntries()).toMatchObject([{ chatId: a9, status: 'failed', error: { kind: 'timeout' } }]);
      await browser.pause(400);
      expect(sendsOf(await serverSince(server))).toHaveLength(1);
      await nativeQueueAction('cancel', ACC, (await queueEntries())[0]?.id ?? '');
      await callStand('setQueueTimeoutMs', 30_000);
    });

    it('[X8-04] an account ChatSpace did not subscribe on its socket has no freshness: its sends are held, and no hidden tab or subscription is made', async () => {
      const sockets = (await standServer.state()).sockets;
      await refused({ acc: ACC_C, fan: c1, platformAccountId: STAND_IDS.platformAccounts.c }, 'CG-SEND-FRESHNESS');
      expect((await standServer.state()).sockets).toEqual(sockets);
      // Frames for it that reach every socket (not a subscription) do not arm it either.
      await standServer.wsFrame({ event: 'account_notifications_summary', account: { account_id: ACC_C, platform: 'onlyfans' }, notifications_count: 1 });
      await browser.pause(150);
      await refused({ acc: ACC_C, fan: c1, platformAccountId: STAND_IDS.platformAccounts.c }, 'CG-SEND-FRESHNESS');
    });
  });

  describe('§6.7.13: freshness — «фан написал что-то новое»', () => {
    before(async () => {
      await open(chatPath(ACC, a1));
      await waitForChatReady(ACC, a1);
      await armed();
    });

    it('[X8-04] a fan message after Generate holds the send; a new click or an edited text does not lift it; a new Generate does', async () => {
      const point = await armed(ACC, a10);
      expect(await preflight({ fan: a10, checkpoint: point })).toEqual({ ok: true });
      const server = await standServer.mark();
      const id = await standServer.fanMessage(ACC, a10, 'Synthetic fan line after Generate');
      await waitForHarnessState(
        () => liveEvents('incoming'),
        (events) => events.some((event) => event.fact.platformMessageId === id),
        'the fan message as an incoming fact',
      );
      expect(await preflight({ fan: a10, checkpoint: point })).toEqual({ ok: false, code: 'CG-SEND-STALE' });
      expect((await send({ fan: a10, checkpoint: point, skipPreflight: true })).commit).toEqual({ state: 'held', code: 'CG-SEND-STALE' });
      expect((await send({ fan: a10, checkpoint: point, text: 'edited text', skipPreflight: true })).commit).toEqual({ state: 'held', code: 'CG-SEND-STALE' });
      expect(sendsOf(await serverSince(server))).toEqual([]);
      // The fact that went to the isolated side carries no text, and the new checkpoint knows the message.
      const fact = (await liveEvents('incoming')).find((event) => event.fact.platformMessageId === id);
      expect(fact?.fact).toMatchObject({ hostAccountId: ACC, platformFanId: a10, fromFan: true, fanSequence: 1, source: 'ws-tap' });
      expect(JSON.stringify(fact)).not.toContain('Synthetic fan line');
      const again = (await checkpoint(a10)) as Checkpoint;
      expect(again).toMatchObject({ fanSequence: 1, lastFanMessageId: id, knownFanMessageIds: [id], coverage: 'ok' });
      expect(await preflight({ fan: a10, checkpoint: again })).toEqual({ ok: true });
      // Another fan's chat is not held by it.
      expect(await preflight({ fan: a11 })).toEqual({ ok: true });
    });

    it('[X8-04] a fan message in the pause between the ready button and the click holds the send in MAIN', async () => {
      const point = (await checkpoint(a11)) as Checkpoint;
      expect(await preflight({ fan: a11, checkpoint: point })).toEqual({ ok: true });
      const server = await standServer.mark();
      await standServer.fanMessage(ACC, a11);
      // No wait for the fact to reach the isolated side: MAIN's counters are updated when the frame arrives.
      await browser.waitUntil(async () => (await checkpoint(a11))?.fanSequence === 1, { timeout: 5000 });
      expect((await send({ fan: a11, checkpoint: point, skipPreflight: true })).commit).toEqual({ state: 'held', code: 'CG-SEND-STALE' });
      expect(sendsOf(await serverSince(server))).toEqual([]);
    });

    it('[X8-04] a reconnect is a gap: coverage is unknown until the new socket is armed, and a checkpoint from before cannot be used', async () => {
      const before = await armed(ACC, a12);
      const server = await standServer.mark();
      await standServer.wsClose();
      await waitForHarnessState(
        () => liveEvents('coverage'),
        (events) => events.some((event) => event.coverage.hostAccountId === ACC && event.coverage.state === 'unknown'),
        'coverage unknown after the socket closed',
      );
      // ChatSpace opens a new socket by itself and subscribes again; our part is only to notice.
      const after = await armed(ACC, a12);
      expect(after.socketEpoch).toBeGreaterThan(before.socketEpoch);
      expect(await preflight({ fan: a12, checkpoint: before })).toEqual({ ok: false, code: 'CG-SEND-FRESHNESS' });
      expect((await send({ fan: a12, checkpoint: before, skipPreflight: true })).commit).toEqual({ state: 'held', code: 'CG-SEND-FRESHNESS' });
      expect(await preflight({ fan: a12, checkpoint: after })).toEqual({ ok: true });
      const entries = await serverSince(server);
      expect(sendsOf(entries)).toEqual([]);
      // The reconnect was ChatSpace's own: every socket action carried its session token.
      expect(foreignCalls(entries)).toEqual([]);
    });
  });

  describe('§6.7.13: one attempt, one queue call; the receipt and the echo', () => {
    before(async () => {
      await open(chatPath(ACC, a1));
      await waitForChatReady(ACC, a1);
      await armed();
    });

    const one = async (fan: string, outcomes: readonly SendOutcome[], text = 'Synthetic preview reply') => {
      await standServer.script(ACC, fan, outcomes);
      const server = await standServer.mark();
      const result = await send({ fan, text });
      expect(result.commit?.state).toBe('nativeEnqueued');
      return { ...result, server };
    };

    it('[X8-03] twenty fast clicks — of one attempt, and of twenty fans — make one queue call', async () => {
      const server = await standServer.mark();
      const same = await harness<Array<{ state: string; code?: string }>>('burst', { ...sendOptions({ fan: a5 }), n: 20 });
      expect(same).toHaveLength(20);
      expect(new Set(same.map((answer) => JSON.stringify(answer))).size).toBe(1);
      expect(same[0]?.state).toBe('nativeEnqueued');
      await browser.waitUntil(async () => (await queueEntries()).length === 0, { timeout: 5000 });
      expect(sendsOf(await serverSince(server))).toHaveLength(1);

      // The account stays busy for the whole burst: the one send that goes out is answered a second after its
      // echo. With an instant answer the queue could be free again before the last of the twenty commands
      // arrived, and a second fan's click would rightly be let through — a click on a free account.
      await standServer.script(ACC, '*', [{ kind: 'ok', echo: 'before', gapMs: 1000 }]);
      const many = await standServer.mark();
      const fans = Array.from({ length: 20 }, (_, n) => [a5, a6, a7, a8, a9, a10, a11, a12][n % 8] ?? a5);
      const answers = await harness<Array<{ state: string; code?: string }>>('burst', { ...sendOptions({ fan: a5 }), n: 20, fans });
      expect(answers.filter((answer) => answer.state === 'nativeEnqueued')).toHaveLength(1);
      expect(answers.filter((answer) => answer.state === 'held' && answer.code === 'CG-SEND-BUSY')).toHaveLength(19);
      await browser.waitUntil(async () => (await queueEntries()).length === 0, { timeout: 5000 });
      expect(sendsOf(await serverSince(many))).toHaveLength(1);
    });

    it('[X8-06] [TL-004] the echo before the response; a numeric id in the response: the pair is made by id', async () => {
      const early = await one(a5, [{ kind: 'ok', echo: 'before', gapMs: 300 }]);
      const states = await settled(early.attemptId, 'sentObserved');
      expect(states.map((view) => view.state)).toEqual(['nativeAccepted', 'sentObserved']);
      const id = states[0]?.platformMessageId;
      // The echo was there before the receipt: it is an incoming fact older than the first state.
      expect((await liveEvents('incoming')).some((event) => !event.fact.fromFan && event.fact.platformMessageId === id && event.fact.platformFanId === a5)).toBe(true);

      const numeric = await one(a6, [{ kind: 'ok', id: '9000000001', responseId: 9000000001 }]);
      expect(await settled(numeric.attemptId, 'sentObserved')).toMatchObject([{ state: 'nativeAccepted', platformMessageId: '9000000001' }, { state: 'sentObserved', platformMessageId: '9000000001' }]);
    });

    it('[X8-06] two sends with the same text, and an echo with another id: only the receipt’s own id makes «sent»', async () => {
      // The same words to two fans; the first one's echo never comes.
      const quiet = await one(a7, [{ kind: 'ok', echo: 'none' }], 'the very same words');
      await settled(quiet.attemptId, 'nativeAccepted');
      const loud = await one(a8, [{ kind: 'ok', echo: 'after' }], 'the very same words');
      expect((await settled(loud.attemptId, 'sentObserved')).map((view) => view.state)).toEqual(['nativeAccepted', 'sentObserved']);
      // An echo for the right chat with the same text and another id is someone else's message.
      const foreign = await one(a9, [{ kind: 'ok', id: '9000000101', echoId: '9000000102' }], 'the very same words');
      await settled(foreign.attemptId, 'nativeAccepted');
      await waitForHarnessState(
        () => liveEvents('incoming'),
        (events) => events.some((event) => event.fact.platformMessageId === '9000000102'),
        'the foreign echo',
      );
      await browser.pause(200);
      expect((await statesOf(quiet.attemptId)).map((view) => view.state)).toEqual(['nativeAccepted']);
      expect((await statesOf(foreign.attemptId)).map((view) => view.state)).toEqual(['nativeAccepted']);
    });

    it('[X8-06] Message Guard is a proven refusal with its topics; the entry stays ChatSpace’s, its Resend the person’s', async () => {
      const guard = await one(a10, [{ kind: 'guard', topics: ['direct_contact'], words: ['stand-word'] }]);
      expect(await settled(guard.attemptId, 'rejected')).toEqual([
        { attemptId: guard.attemptId, state: 'rejected', code: 'CG-SEND-GUARD', httpStatus: 422, detail: { guardTopics: ['direct_contact'], upstream: 'HTTP 422 MESSAGE_GUARD_VIOLATION' } },
      ]);
      const failed = await queueEntries();
      expect(failed).toMatchObject([{ chatId: a10, status: 'failed', error: { kind: 'blocked' } }]);
      expect(sendsOf(await serverSince(guard.server))).toHaveLength(1);

      // The person presses ChatSpace's own Resend: a native request with the page's own fetch, and no state of ours changes.
      const page = await pageMark();
      await standServer.script(ACC, a10, [{ kind: 'ok' }]);
      await nativeQueueAction('resend', ACC, failed[0]?.id ?? '');
      await browser.waitUntil(async () => (await queueEntries()).length === 0, { timeout: 5000 });
      expect(sendsOf(await serverSince(guard.server))).toHaveLength(2);
      expect((await pageSince(page)).filter((entry) => entry.type === 'http-request' && entry['method'] === 'POST').map((entry) => entry['fetchCapture'])).toEqual(['native']);
      expect(queueAdds(await pageSince(page))).toEqual([]);
      await browser.pause(200);
      expect((await statesOf(guard.attemptId)).map((view) => view.state)).toEqual(['rejected']);
    });

    it('[X8-06] 403 is a refusal; a 5xx is uncertain — never «not sent», and never sent again', async () => {
      const forbidden = await one(a11, [{ kind: 'status', status: 403 }]);
      expect(await settled(forbidden.attemptId, 'rejected')).toEqual([{ attemptId: forbidden.attemptId, state: 'rejected', code: 'CG-SEND-REJECTED', httpStatus: 403, detail: { upstream: 'HTTP 403 FORBIDDEN' } }]);
      const unavailable = await one(a12, [{ kind: 'status', status: 503 }]);
      expect(await settled(unavailable.attemptId, 'uncertain')).toEqual([{ attemptId: unavailable.attemptId, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', detail: { upstream: 'HTTP 503' } }]);
      await browser.pause(300);
      expect(sendsOf(await serverSince(forbidden.server))).toHaveLength(2);
      // Their failed entries are ChatSpace's own; the person clears them.
      for (const entry of await queueEntries()) await nativeQueueAction('cancel', ACC, entry.id);
    });

    it('[X8-06] the first POST gets 401, the native client re-runs it and gets 200: the 401 says nothing, and without a linked receipt the end is uncertain', async () => {
      const chain = await one(a6, [{ kind: 'status', status: 401 }, { kind: 'ok', id: '9000000201' }]);
      const states = await settled(chain.attemptId, 'uncertain');
      expect(states).toEqual([{ attemptId: chain.attemptId, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', detail: { upstream: 'HTTP 401' } }]);
      // Two native requests: the first, and ChatSpace's own re-run with a fresh token. The message was delivered…
      const entries = await serverSince(chain.server);
      expect(sendsOf(entries, a6).map((entry) => [entry.origin, entry.detail?.['outcome']])).toEqual([
        ['native', 'status'],
        ['native', 'ok'],
      ]);
      // …its echo comes, and still nothing claims «sent»: the receipt was never ours to read.
      await waitForHarnessState(
        () => liveEvents('incoming'),
        (events) => events.some((event) => event.fact.platformMessageId === '9000000201'),
        'the echo of the re-run',
      );
      await browser.pause(200);
      expect((await statesOf(chain.attemptId)).map((view) => view.state)).toEqual(['uncertain']);
    });

    it('[X8-06] the entry is cancelled while its request is out (the native Cancel): uncertain, not «not sent»', async () => {
      const hung = await one(a7, [{ kind: 'hang' }]);
      await browser.waitUntil(async () => sendsOf(await serverSince(hung.server), a7).length === 1, { timeout: 5000 });
      await nativeQueueAction('cancel', ACC, hung.commit?.pendingId ?? '');
      expect(await settled(hung.attemptId, 'uncertain')).toMatchObject([{ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }]);
      expect(await queueEntries()).toEqual([]);
      await browser.pause(300);
      expect(sendsOf(await serverSince(hung.server))).toHaveLength(1);
    });

    it('[X8-03] [NF-019] three parts of one greeting: a click each; the fan’s reply blocks the rest', async () => {
      const point = (await checkpoint(a8)) as Checkpoint;
      const server = await standServer.mark();
      const parts = ['Part one', 'Part two', 'Part three'];
      const first = await send({ fan: a8, text: parts[0] ?? '', checkpoint: point, part: 0 });
      await settled(first.attemptId, 'sentObserved');
      // Our own messages do not make the result stale: the second part goes with the same checkpoint.
      const second = await send({ fan: a8, text: parts[1] ?? '', checkpoint: point, part: 1 });
      await settled(second.attemptId, 'sentObserved');
      await standServer.fanMessage(ACC, a8);
      await browser.waitUntil(async () => (await checkpoint(a8))?.fanSequence === 1, { timeout: 5000 });
      const third = await send({ fan: a8, text: parts[2] ?? '', checkpoint: point, part: 2 });
      expect(third.preflight).toEqual({ ok: false, code: 'CG-SEND-STALE' });
      expect(sendsOf(await serverSince(server), a8).map((entry) => shown(entry.detail?.['text']))).toEqual(['Part one', 'Part two']);
    });

    it('[X8-04] the tap measures the time its listener takes per frame (§6.8 п. 3, §11 `handlerMs`)', async () => {
      const [frames, totalMs, maxMs] = await browser.execute(() => {
        const handle = (window as unknown as Record<symbol, { frameTime?: () => [number, number, number] } | undefined>)[Symbol.for('wsTap')];
        return handle?.frameTime?.() ?? [0, 0, 0];
      });
      evidence['tapFrameTime'] = { frames, totalMs, maxMs, averageMs: frames > 0 ? totalMs / frames : null };
      expect(frames).toBeGreaterThan(0);
      // The browser's clock is coarse (1 ms and more): this only trips on a gross regression. The 0.1 ms budget itself
      // is asserted on a fine clock in ws-tap.test.ts.
      expect(totalMs / frames).toBeLessThan(1);
    });
  });

  describe('§6.6: a human send from the composer', () => {
    before(async () => {
      // X8 is off for this page; the tap is on: «Открыть и вставить» + the person's own Send is still observed.
      await open(chatPath(ACC, a1), liveConfig({ previewSend: false }));
      await waitForChatReady(ACC, a1);
      await armed();
    });

    const editor = (): ReturnType<typeof $> => $(`[data-stand-composer$=":${a1}"] .ProseMirror`);
    const pressSend = async (): Promise<void> => $(`[data-stand-composer$=":${a1}"] [data-stand-send]`).click();
    const humanSends = async () => (await liveEvents('humanSend')).map((event) => event.fact);
    const insertText = async (text: string): Promise<void> => {
      await waitForHarnessState(
        () => harness<{ composer: { ready: boolean } | null; identity: { composerInstanceId: string | null } | null }>('state'),
        (state) => state.composer?.ready === true && state.identity?.composerInstanceId !== null,
        'composer ready',
      );
      expect(await harness<{ state: string }>('insert', { text })).toMatchObject({ state: 'applied' });
    };

    it('[TL-004] our unchanged insert, sent by the person: the receipt of exactly that send, and the echo with the same id', async () => {
      expect(await harness<boolean>('previewSendAvailable')).toBe(false);
      const server = await standServer.mark();
      const page = await pageMark();
      await insertText('Inserted by the adapter');
      await pressSend();
      const facts = await waitForHarnessState(humanSends, (list) => list.length === 1, 'the human send fact');
      const fact = facts[0];
      expect(fact).toMatchObject({ chat: { platformFanId: a1 }, draft: { provenance: 'our-insert', editedSinceInsert: false } });
      expect(fact?.draft.insertIntentId).toMatch(/^[0-9a-f-]{36}$/);
      expect(fact?.platformMessageId).toMatch(/^\d+$/);
      // The server's own id of that send, and the outgoing echo with the same id: the pair a `sent` needs. A fact with
      // an id IS that pair (§6.6 п. 4): it went out only after the echo of the same id, account and fan was heard.
      const sends = sendsOf(await serverSince(server), a1);
      expect(sends).toHaveLength(1);
      expect(sends[0]?.origin).toBe('native');
      const all = await harness<LiveEvent[]>('liveEvents');
      const echoAt = all.findIndex((event) => event.type === 'incoming' && !event.fact.fromFan && event.fact.platformFanId === a1 && event.fact.platformMessageId === fact?.platformMessageId);
      const factAt = all.findIndex((event) => event.type === 'humanSend' && event.fact.pendingId === fact?.pendingId);
      expect(echoAt).toBeGreaterThanOrEqual(0);
      expect(factAt).toBeGreaterThan(echoAt);
      // The person's own request took our observer for that one send (and it was the only request that did).
      expect((await pageSince(page)).filter((entry) => entry.type === 'http-request' && entry['fetchCapture'] === 'substituted').map((entry) => entry['method'])).toEqual(['POST']);
      // What the composer queued is its own: the adapter added nothing to the request.
      expect(sends[0]?.detail).toMatchObject({ isAiGenerated: false, platformMetadata: {} });
    });

    it('[TL-004] an insert the person edited is «edited» by the revision chain; a text of their own has nothing to attribute and is not watched', async () => {
      await insertText('Second insert');
      await editor().click();
      await browser.keys(' and my words');
      await pressSend();
      let facts = await waitForHarnessState(humanSends, (list) => list.length === 2, 'the edited send');
      expect(facts[1]).toMatchObject({ draft: { provenance: 'human-or-unknown', editedSinceInsert: true } });
      expect(facts[1]?.draft.insertIntentId).not.toBeNull();
      expect(facts[1]?.platformMessageId).toMatch(/^\d+$/);
      await browser.waitUntil(async () => (await queueEntries()).length === 0, { timeout: 5000 });

      const page = await pageMark();
      await editor().click();
      await browser.keys('typed by the person');
      await pressSend();
      facts = await waitForHarnessState(humanSends, (list) => list.length === 3, 'the person’s own send');
      expect(facts[2]).toEqual({ chat: { host: 'chatspace', hostAccountId: ACC, platformFanId: a1 }, pendingId: facts[2]?.pendingId, platformMessageId: null, textDigest: facts[2]?.textDigest, draft: { revision: facts[2]?.draft.revision, provenance: 'human-or-unknown', insertIntentId: null, editedSinceInsert: null } });
      await browser.waitUntil(async () => (await queueEntries()).length === 0, { timeout: 5000 });
      // Its request went out through the page's own fetch.
      expect((await pageSince(page)).filter((entry) => entry.type === 'http-request' && entry['method'] === 'POST' && String(entry['path']).endsWith('/messages')).map((entry) => entry['fetchCapture'])).toEqual(['native']);
    });

    it('[TL-004] a send that waits in a busy queue has no receipt: attribution unknown, no `sent`', async () => {
      // Another chat tab of the account is sending: the account's queue is busy.
      const before = (await humanSends()).length;
      await callStand('setQueueTimeoutMs', 1500);
      await standServer.script(ACC, a1, [{ kind: 'hang' }, { kind: 'ok' }]);
      await editor().click();
      await browser.keys('holds the queue');
      await pressSend();
      await insertText('Waits behind another send');
      const page = await pageMark();
      await pressSend();
      const facts = await waitForHarnessState(humanSends, (list) => list.length === before + 2, 'the waiting send');
      expect(facts.at(-1)).toMatchObject({ platformMessageId: null, draft: { provenance: 'our-insert', editedSinceInsert: false } });
      expect(queueAdds(await pageSince(page))).toMatchObject([{ busy: true }]);
      // It goes out when the first one timed out — through the page's own fetch; its id is never claimed.
      await browser.waitUntil(async () => (await queueEntries()).every((entry) => entry.status === 'failed'), { timeout: 8000, timeoutMsg: 'the queue did not drain' });
      expect((await pageSince(page)).filter((entry) => entry.type === 'http-request' && entry['method'] === 'POST' && String(entry['path']).endsWith('/messages')).map((entry) => entry['fetchCapture'])).toEqual(['native']);
      expect((await humanSends()).length).toBe(before + 2);
      for (const entry of await queueEntries()) await nativeQueueAction('cancel', ACC, entry.id);
      await callStand('setQueueTimeoutMs', 30_000);
    });
  });

  describe('§6.7.11, §6.8: the switches', () => {
    before(async () => {
      await open(chatPath(ACC, a1));
      await waitForChatReady(ACC, a1);
      await armed();
    });

    it('[AI-120] the flag goes off between the ready button and the click: zero queue calls; a send already on its way is followed to its end, not cancelled', async () => {
      await standServer.script(ACC, a5, [{ kind: 'ok', echo: 'before', gapMs: 700 }]);
      const server = await standServer.mark();
      const started = await send({ fan: a5 });
      expect(started.commit?.state).toBe('nativeEnqueued');
      const ready = await preflight({ acc: ACC_B, fan: b1, platformAccountId: STAND_IDS.platformAccounts.b });
      expect(ready).toEqual({ ok: true });

      const off = await harness<Report>('configure', liveConfig({ previewSend: false }));
      expect(off.capabilities['previewSend']).toEqual({ state: 'off', reason: 'flag', code: 'CG-SEND-OFF' });
      expect(await send({ acc: ACC_B, fan: b1, platformAccountId: STAND_IDS.platformAccounts.b, skipPreflight: true })).toMatchObject({ attemptId: null, reason: 'no-port' });
      // The first send was not «cancelled» by the switch: its receipt and echo still make it sent.
      expect((await settled(started.attemptId, 'sentObserved')).map((view) => view.state)).toEqual(['nativeAccepted', 'sentObserved']);
      expect(sendsOf(await serverSince(server))).toHaveLength(1);
      await harness('configure', liveConfig());
      expect(await harness<boolean>('previewSendAvailable')).toBe(true);
    });

    it('[AI-120] the page reloads while the native send is out: the new document has no record of the attempt, and its command replayed there sends nothing', async () => {
      const point = (await checkpoint(a9)) as Checkpoint;
      const attemptId = '00000000-0000-4000-8000-0000000000a9';
      await standServer.script(ACC, a9, [{ kind: 'hang' }]);
      const server = await standServer.mark();
      expect((await send({ fan: a9, attemptId, checkpoint: point })).commit?.state).toBe('nativeEnqueued');
      await browser.waitUntil(async () => sendsOf(await serverSince(server), a9).length === 1, { timeout: 5000 });
      await browser.refresh();
      await waitForHarness();
      await waitForChatReady(ACC, a1);
      await waitForHarnessState(
        () => harness<{ contract: { anchors: Record<string, string> } }>('state'),
        (state) => state.contract.anchors['mimic'] === 'ok',
        'adapter sees the app again',
      );
      await harness('configure', liveConfig());
      const after = await armed(ACC, a9);
      expect(after.documentEpoch).not.toBe(point.documentEpoch);
      // The same command again — a retry from another tab, a restored background, a CLI: the checkpoint is another document's.
      expect((await send({ fan: a9, attemptId, checkpoint: point, skipPreflight: true })).commit).toEqual({ state: 'held', code: 'CG-SEND-FRESHNESS' });
      const entries = await serverSince(server);
      expect(sendsOf(entries, a9)).toHaveLength(1);
      expect(entries.some((entry) => entry.kind === 'send-aborted' && entry.chatId === a9)).toBe(true);
      expect(await queueEntries()).toEqual([]);
    });

    it('[NEW-08] `wsTap` off: the tap leaves the page’s constructor as it found it, facts stop, and nothing can be sent', async () => {
      const facts = (await liveEvents('incoming')).length;
      const off = await harness<Report>('configure', liveConfig({ wsTap: false }));
      expect(off.capabilities['previewSend']).toEqual({ state: 'off', reason: 'wsTap', code: 'CG-SEND-FRESHNESS' });
      expect(off.capabilities['incoming']).toEqual({ state: 'off', reason: 'wsTap', code: 'CG-SEND-FRESHNESS' });
      expect(off.capabilities['insert']).toEqual({ state: 'on' });
      const page = await browser.execute(() => ({
        handle: (window as unknown as Record<symbol, unknown>)[Symbol.for('wsTap')] === undefined,
        // A Proxy has no own `prototype` descriptor to compare; the native constructor names itself.
        native: WebSocket.name === 'WebSocket' && Object.prototype.hasOwnProperty.call(WebSocket, 'prototype') && WebSocket.prototype.constructor === WebSocket,
      }));
      expect(page).toEqual({ handle: true, native: true });
      expect(await checkpoint(a5)).toBeNull();
      await standServer.fanMessage(ACC, a5);
      await browser.pause(300);
      expect((await liveEvents('incoming')).length).toBe(facts);
      // ChatSpace's socket was never touched: it is still the same open, authenticated socket.
      expect(await callStand('wsStatus')).toMatchObject({ status: 'OPEN', authenticated: true });
    });
  });

  describe('the two document_start scripts in the other order', () => {
    before(async () => {
      // The background's registered script may run before or after the manifest's: both orders must work.
      await installed?.remove();
      installed = await installHostHarness({ tap: 'last' });
      await open(chatPath(ACC, a1));
      await waitForChatReady(ACC, a1);
    });

    it('[X8-04] the bridge’s runtime finds the tap that came after it: the account arms, a preview send goes through to «sent»', async () => {
      expect(await harness<boolean>('previewSendAvailable')).toBe(true);
      await armed();
      const server = await standServer.mark();
      const result = await send({ fan: a12, text: 'Other order' });
      expect((await settled(result.attemptId, 'sentObserved')).map((view) => view.state)).toEqual(['nativeAccepted', 'sentObserved']);
      expect(sendsOf(await serverSince(server))).toHaveLength(1);
    });
  });
});
