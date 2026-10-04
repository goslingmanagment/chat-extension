// §12 п. 4 on the wired extension, part 8 — «отправка из composer» (architecture.md
// §6.6, §9.6): a part of ours is in ChatSpace's message field and the PERSON
// presses ChatSpace's own Send. The extension sends nothing; it only learns
// whether that send was the insert's — by ids, never by time or by text —
// and tells the hub's acceptance telemetry (`ai_acceptance`, with the
// person's consent, which this spec gives on the settings page).
// - our unchanged insert, the echo arriving BEFORE the HTTP response: `sent`
//   with `via: composer`, `edited: false` and the platform's own message id;
// - an insert the person edited first: `sent` with `edited: true`;
// - a text of the person's own: nothing to attribute, no `sent`;
// - two queue records with the same `createdAt` (the page's clock stands
//   still): exactly one `sent`, with the id of the insert's own send;
// - a send that waited in a busy queue: its request was made outside the
//   observed step — attribution unknown, no `sent`, though the text did go.
// The observation itself — the receipt of exactly that request, the echo with
// the same id — has its spec on the adapter (x8-send.e2e.ts, §6.6).

import { browser, expect } from '@wdio/globals';

import { callsTo } from '../../src/fake-hub/journal';
import { setOptionalPermissionPrompts } from '../support/background';
import { composerText, EDITOR, pageJournal, pageJournalMark, pressSend, queueAdds, sendsOf, serverSince, typeDraft, waitForComposerText } from '../support/chat';
import { QUIET_PAGE, testBuildPage, useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { pressOurs } from '../support/ours';
import { openOptions, press, waitForOptions } from '../support/pages';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, foreignCalls, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a2, a4, a5, a6 } = STAND_IDS.fans;
/** The fake hub's model, with `aiNameFan` and Split off: one part, signed with its chat. */
const reply = (fan: string): string => `Hey you, thanks for writing! How was your day? @${fan}`;

interface Acceptance {
  readonly lifecycle: string;
  readonly opId: string;
  readonly part?: number;
  readonly via?: string;
  readonly edited?: boolean;
  readonly platformMessageId?: string;
}

describe('§12 п. 4 on the wired extension — the person’s own Send: `sent` only by the receipt and the echo with one id', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;

  /** `ai_acceptance` events the hub ingested since `mark`, in order. */
  const acceptance = async (mark: number): Promise<Acceptance[]> =>
    callsTo((await hub().journal(mark)).entries, 'ingestObservations')
      .filter((call) => call.status === 200)
      .flatMap((call) => (call.request as { events: Array<{ kind: string; payload: Acceptance }> }).events)
      .filter((event) => event.kind === 'ai_acceptance')
      .map((event) => event.payload);
  const lifecycles = (events: readonly Acceptance[], opId: string): string[] => events.filter((event) => event.opId === opId).map((event) => event.lifecycle);
  const waitAcceptance = async (mark: number, opId: string, lifecycle: string): Promise<Acceptance[]> => {
    let events: Acceptance[] = [];
    await browser.waitUntil(
      async () => {
        events = await acceptance(mark);
        return lifecycles(events, opId).includes(lifecycle);
      },
      { timeout: 15_000, interval: 250, timeoutMsg: `the hub was not told «${lifecycle}» of ${opId}` },
    );
    return events.filter((event) => event.opId === opId);
  };
  /** The telemetry queue leaves a second after its first event: by then whatever was to be told has been told. */
  const settled = (): Promise<void> => browser.pause(2500);
  const open = async (fan: string): Promise<void> => {
    await callStand('openChat', ACC, fan);
    await waitForChatReady(ACC, fan);
    await dockIs((d) => d.status === 'ready' && d.target?.endsWith(`:${fan}`) === true && d.actions['reply'] === true, `the dock of chat ${fan}`);
  };
  /** Reply by a click, then «Вставить» of its one part: the field of the chat holds our text. Resolves with the operation. */
  const insertReply = async (fan: string): Promise<string> => {
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    const done = await dockIs((d) => d.target?.endsWith(`:${fan}`) === true && d.result?.state === 'done', 'the Reply result', 20_000);
    await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/);
    await waitForComposerText(ACC, fan, reply(fan), 'the part is in the field');
    return done.result?.opId ?? '';
  };
  /** The platform's ids of the messages ChatSpace sent to a chat since `mark`, with their texts. */
  const sent = async (mark: number, fan: string): Promise<Array<{ readonly id: string; readonly plain: string }>> => {
    const entries = await serverSince(mark);
    const ids = entries.filter((entry) => entry.kind === 'http' && entry.method === 'POST' && entry.chatId === fan && entry.status === 200).map((entry) => String(entry.detail?.['id']));
    return sendsOf(entries, fan).map((entry, index) => ({ id: ids[index] ?? '', plain: String(entry.detail?.['plain']) }));
  };

  before(async () => {
    await standServer.reset();
    // The stand's socket names its accounts soon after their subscription: ChatSpace's sends are observed from then on.
    await standServer.traffic({ firstSummaryMs: 150 });
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiNameFan: true } });
    shift = await startShift(hub(), { viewport: { width: 1440, height: 900 } });
    // The person allows the technical measurements on the settings page (ST-034): acceptance events leave the browser only then.
    await shift.toPages();
    await setOptionalPermissionPrompts(false);
    await openOptions('status');
    await waitForOptions((state) => state.rows['consent']?.level === 'warn', 'the consent row asks');
    await press('Разрешить замеры', '[data-pg-row="consent"]');
    await waitForOptions((state) => state.rows['consent']?.level === 'ok', 'the consent is on');
    await browser.url(testBuildPage(QUIET_PAGE));
    await shift.toStand();
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock of the open chat is ready');
  });

  after(async () => {
    await setOptionalPermissionPrompts(null);
    const entries = await serverSince(journalStart);
    // Every message here was sent by ChatSpace's own client on the person's own Send; nothing of ours talked to the stand.
    expect(sendsOf(entries).filter((entry) => entry.origin !== 'native')).toEqual([]);
    expect(foreignCalls(entries)).toEqual([]);
  });

  it('[TL-001] [TL-003] [TL-004] our unchanged insert, the echo before the response: `shown`, `inserted`, then `sent` — via the composer, not edited, with the platform’s own id', async () => {
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    // The platform's echo of the message comes BEFORE the HTTP response of its send.
    await standServer.script(ACC, a1, [{ kind: 'ok', echo: 'before', gapMs: 300 }]);
    const opId = await insertReply(a1);
    const page = await pageJournalMark();
    await pressSend();
    const events = await waitAcceptance(hubMark, opId, 'sent');
    expect(events.map((event) => event.lifecycle)).toEqual(['shown', 'inserted', 'sent']);
    const messages = await sent(standMark, a1);
    expect(messages).toEqual([{ id: messages[0]?.id, plain: reply(a1) }]);
    expect(events.at(-1)).toMatchObject({ part: 0, via: 'composer', edited: false, platformMessageId: messages[0]?.id });
    // The send was ChatSpace's: one entry of its queue, by the person's click; the field is empty again.
    expect(queueAdds(await pageJournal(page))).toHaveLength(1);
    await waitForComposerText(ACC, a1, '', 'ChatSpace cleared its field');
    // And it is told once.
    await settled();
    expect(lifecycles(await acceptance(hubMark), opId)).toEqual(['shown', 'inserted', 'sent']);
  });

  it('[TL-004] an insert the person edited before sending is `sent` with `edited: true`', async () => {
    await open(a2);
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    const opId = await insertReply(a2);
    await $(EDITOR).click();
    await browser.keys(['End', ' ', 'x', 'o']);
    await waitForComposerText(ACC, a2, `${reply(a2)} xo`, 'the person added words of their own');
    await pressSend();
    const events = await waitAcceptance(hubMark, opId, 'sent');
    const messages = await sent(standMark, a2);
    expect(messages.map((message) => message.plain)).toEqual([`${reply(a2)} xo`]);
    expect(events.at(-1)).toMatchObject({ lifecycle: 'sent', via: 'composer', edited: true, platformMessageId: messages[0]?.id });
  });

  it('[TL-004] a text of the person’s own has nothing to attribute: the hub hears no `sent`', async () => {
    await open(a4);
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    await typeDraft('typed by the person');
    await pressSend();
    await browser.waitUntil(async () => (await sent(standMark, a4)).length === 1, { timeout: 10_000, timeoutMsg: 'ChatSpace did not send the person’s text' });
    await settled();
    expect((await acceptance(hubMark)).filter((event) => event.lifecycle === 'sent')).toEqual([]);
  });

  it('[TL-004] two queue records with the same `createdAt` (the page’s clock stands still): one `sent`, with the id of the insert’s own send', async () => {
    await open(a5);
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    // The page's clock stops: every record ChatSpace's queue makes from now on has the same `createdAt`.
    await browser.execute(() => {
      const Real = Date;
      const at = Real.now();
      Reflect.set(window, '__standRealDate', Real);
      class Frozen extends Real {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(at);
          else super(...(args as [number]));
        }
        static override now(): number {
          return at;
        }
      }
      Reflect.set(window, 'Date', Frozen);
    });
    try {
      const stamps = await browser.execute(async () => {
        const first = new Date().toISOString();
        await new Promise((resolve) => setTimeout(resolve, 30));
        return [first, new Date().toISOString()];
      });
      expect(stamps[0]).toBe(stamps[1]);
      // The person's own line first, then our part: two records of the queue, one moment on the page's clock.
      await typeDraft('the person’s own line');
      await pressSend();
      await browser.waitUntil(async () => (await sent(standMark, a5)).length === 1, { timeout: 10_000, timeoutMsg: 'the person’s own line was not sent' });
      const opId = await insertReply(a5);
      await pressSend();
      const events = await waitAcceptance(hubMark, opId, 'sent');
      const messages = await sent(standMark, a5);
      expect(messages.map((message) => message.plain)).toEqual(['the person’s own line', reply(a5)]);
      expect(events.at(-1)).toMatchObject({ lifecycle: 'sent', via: 'composer', edited: false, platformMessageId: messages[1]?.id });
      await settled();
      // One `sent` in all — the insert's, by its own id; the person's line, made at the «same» moment, is not taken for it.
      const told = (await acceptance(hubMark)).filter((event) => event.lifecycle === 'sent');
      expect(told.map((event) => [event.opId, event.platformMessageId])).toEqual([[opId, messages[1]?.id]]);
      expect(messages[0]?.id).not.toBe(messages[1]?.id);
    } finally {
      await browser.execute(() => Reflect.set(window, 'Date', Reflect.get(window, '__standRealDate')));
    }
  });

  it('[TL-004] a send that waited in a busy queue has no receipt of its own step: attribution unknown — no `sent`, though the text did go', async () => {
    await open(a6);
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    // The account's queue is busy: the person's previous message hangs at the platform, and ChatSpace gives up on it in 1.5 s.
    await callStand('setQueueTimeoutMs', 1500);
    await standServer.script(ACC, a6, [{ kind: 'hang' }, { kind: 'ok' }]);
    try {
      await typeDraft('holds the queue');
      await pressSend();
      await waitForComposerText(ACC, a6, '', 'ChatSpace took the first message into its queue');
      const opId = await insertReply(a6);
      const page = await pageJournalMark();
      await pressSend();
      // Our part entered ChatSpace's queue behind the hanging send…
      await browser.waitUntil(async () => queueAdds(await pageJournal(page)).length === 1, { timeout: 5000, timeoutMsg: 'the part did not enter ChatSpace’s queue' });
      expect(queueAdds(await pageJournal(page))[0]).toMatchObject({ busy: true });
      // …and went out when that one timed out: the platform has it.
      await browser.waitUntil(async () => (await sent(standMark, a6)).some((message) => message.plain === reply(a6)), { timeout: 15_000, timeoutMsg: 'the waiting part was never sent by ChatSpace' });
      await waitAcceptance(hubMark, opId, 'inserted');
      await settled();
      // Its request was created later, outside the step we observe: whose send it was is not known, and nothing is guessed from its text or its time.
      expect(lifecycles(await acceptance(hubMark), opId)).toEqual(['shown', 'inserted']);
      expect(await composerText(ACC, a6)).toBe('');
    } finally {
      await callStand('setQueueTimeoutMs', 30_000);
    }
  });
});
