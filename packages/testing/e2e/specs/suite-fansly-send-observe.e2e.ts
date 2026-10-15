// The person's send on Fansly's stand and its `sent` (R20 P7f; docs/project-unite/architecture.md §5.9, §9.3;
// FS-SEND-1, FS-SEND-2; plan.md §3 `suite-fansly-send-observe`), in Firefox driven by geckodriver — the person's
// Enter and click are trusted events —, next to the FBuddy-like neighbour in its default modes `off` and `after` (X34):
// the test build's MAIN at the page's first moment and Fansly's own start in a sandbox of the page
// (support/fansly-tap.ts, the `port` consumer). We never send: the page sends its own model inside the person's
// keydown or click, and MAIN marks the request whose native `loadstart` comes while that event is still delivered.
// - Our insert, the person's trusted Enter, or a click on Fansly's own Send: the receipt of exactly
//   `POST /api/v1/message` and its socket echo, in either order — the port says `humanSend` for the server's message
//   id with our insert's intent (what the tab reports, `op.reportSent` → `ai_acceptance · sent`); an edit after the
//   insert is `edited`. No echo — nothing. The link is by the gesture's own name, its event's `timeStamp`, which
//   MAIN and the isolated side read from the same event: Firefox shows here that both read the same value.
// - Two `POST /message` in one gesture — not attributed; a request from a timer beside the page's own send is no
//   candidate.
// - A send the neighbour's word filter swallowed (`after,guard`) — no request, no `sent`; the person's fixed text,
//   sent next, is attributed.
// - A send with media waits for its upload and is not attributed (the rule).
// - Our text sent with no gesture of the person (a script's click on Send) — no `sent`, no `humanSend`.
// - Two quick gestures, both in flight: each attributed to its own message.
// No request of ours reaches the fake Fansly (checked at the end).

import type { FanslyHealth } from '@cg/contracts/bridge-messages-fansly';
import type { HumanSendFact, InsertReceipt, RouteState } from '@cg/contracts/host';
import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import type { ComposerView } from '../../fixture-fansly/src/protocol';
import { neighborState, openWithNeighbor, setFanslyNeighbor, waitForNeighborComposer } from '../support/fansly-neighbor';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyIds, waitForFanslyStandIdle } from '../support/fansly-stand';
import { installFanslyTapHarness, tap, waitForFanslyTap, waitForTap, type FanslyTapHarness } from '../support/fansly-tap';
import { useNetworkTrap } from '../support/network-trap';

type Ids = Awaited<ReturnType<typeof fanslyIds>>;
type Mode = 'off' | 'after';

interface PortView {
  readonly route: RouteState;
  readonly composer: { readonly instanceId: string; readonly ready: boolean } | null;
}
interface Insertion {
  readonly record: { readonly intentId: string; readonly contentDigest: string } | null;
}
interface PortHealth {
  readonly isolated: { readonly sends: { readonly gestures: number; readonly linked: number; readonly unmatched: number; readonly mismatched: number; readonly ambiguous: number } };
  readonly main: FanslyHealth | null;
}

const waitFor = (check: () => Promise<boolean>, what: string, timeout = 10_000): Promise<true> => browser.waitUntil(check, { timeout, interval: 50, timeoutMsg: what });
const portView = (): Promise<PortView> => tap<PortView>('port');
const humanSends = (from = 0): Promise<HumanSendFact[]> => tap<HumanSendFact[]>('humanSends', from);
const portHealth = (): Promise<PortHealth> => tap<PortHealth>('portHealth');
const mainSends = async (): Promise<FanslyHealth['sends']> => {
  const main = (await portHealth()).main;
  if (main === null) throw new Error('MAIN did not answer fx.health');
  return main.sends;
};
const insert = (text: string): Promise<InsertReceipt> => tap<InsertReceipt>('insert', { text });
const recordOf = async (): Promise<NonNullable<Insertion['record']>> => {
  const { record } = await tap<Insertion>('insertion');
  if (record === null) throw new Error('no insertion record');
  return record;
};

/** The port on `group`: MAIN named its fan, the field the port owns is ready. */
const atGroup = (ids: Ids, group: string, what: string): Promise<PortView> =>
  waitForTap(portView, (view) => view.route.conversationRef === group && view.route.chat?.platformFanId === ids.fans[group] && view.composer?.ready === true, what, 15_000);

/** A fresh page on `group` next to the neighbour, Fansly's start up, the chat named, the page settled — its socket verified for the echo. */
async function openChat(ids: Ids, group: string, mode: Mode, guard: readonly string[] = []): Promise<void> {
  await openWithNeighbor(`/messages/${group}`, { mode, ...(guard.length === 0 ? {} : { guard }) });
  await waitForFanslyTap();
  await atGroup(ids, group, `the chat ${group}`);
  if (mode === 'after') await waitForNeighborComposer();
  if (guard.length > 0) await waitFor(async () => (await neighborState()).guard.active, 'the neighbour’s guard');
  await waitForFanslyStandIdle();
}

async function mainComposer(): Promise<ComposerView> {
  const found = (await callFansly('composers')).find((composer) => composer.place === 'main' && composer.connected);
  if (found === undefined) throw new Error('no main composer');
  return found;
}

/** The page's sends the server answered since `since` (the page's own `POST /message`). */
const pageSends = async (since: number): Promise<number> => (await fakeFansly().calls('page', since)).filter((entry) => entry.route === 'message.send' && entry.status === 200).length;
/** The newest message of the open chat the page holds that is not a queued one: the server's id of the last send. */
const newestId = async (): Promise<string | undefined> => (await callFansly('list'))?.ids.filter((id) => !id.startsWith('queued-')).at(-1);

/** The person presses Enter in the main field (the focus there, the caret at the end). */
async function pressEnter(): Promise<void> {
  await $(FANSLY_MAIN.field).click();
  await browser.keys([Key.End]);
  await browser.keys(Key.Enter);
}

/** Waits for `n` page sends since `since` and their echoes in the page's list, then a moment for MAIN and the port. */
async function sendsLanded(since: number, n: number): Promise<void> {
  await waitFor(async () => (await pageSends(since)) >= n, `${n} send(s) of the page answered`);
  await browser.pause(400);
}

/** The fake Fansly's journal is the run's: an earlier spec of the same part may have asked it things of its own. */
let oursSince = 0;

describe('Fansly’s human send on its stand and its `sent` (R20 P7f)', () => {
  useNetworkTrap();
  let harness: FanslyTapHarness | null = null;
  let ids: Ids;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    oursSince = await fakeFansly().mark();
    await browser.setWindowSize(1440, 900);
    harness = await installFanslyTapHarness({ main: 'start', consumer: 'port' });
    await openWithNeighbor('/messages', { mode: 'off' });
    ids = await fanslyIds();
  });

  afterEach(async () => {
    await fakeFansly().command({ op: 'send', echo: 'after', receiptDelayMs: 0, echoDelayMs: 0 });
  });

  after(async () => {
    await harness?.remove();
    // Nothing of ours ever reached Fansly: every send was the page's own.
    expect(await fakeFansly().calls('ours', oursSince)).toEqual([]);
    await setFanslyNeighbor(null);
    await browser.url('about:blank');
    await fakeFansly().command({ op: 'reset' });
  });

  for (const mode of ['off', 'after'] as const) {
    describe(`next to the neighbour (${mode})`, () => {
      it(`[FS-SEND-1] [FS-SEND-2] [UI-033] [TL-004] our insert, the person’s trusted Enter (${mode}): the page sends its model inside the keydown; its receipt and its echo — the port says the send for the server’s message, our intent, not edited`, async () => {
        const group = ids.groups[1] as string;
        await openChat(ids, group, mode);
        const since = await fakeFansly().mark();
        const text = 'Привет! Как прошёл день?';
        expect(await insert(text)).toMatchObject({ state: 'applied' });
        const record = await recordOf();
        await pressEnter();
        const [fact] = await waitForTap(humanSends, (list) => list.length > 0, 'the port’s humanSend');
        expect(await pageSends(since)).toBe(1);
        expect(fact).toEqual({
          chat: { host: 'fansly-web', hostAccountId: ids.creator, platformFanId: ids.fans[group] },
          pendingId: expect.stringMatching(/^g\d+$/) as unknown,
          platformMessageId: await newestId(),
          textDigest: record.contentDigest,
          draft: { revision: expect.any(Number) as unknown, provenance: 'our-insert', insertIntentId: record.intentId, editedSinceInsert: false },
        });
        // The page sent its model, and cleared its field — no text of ours went anywhere but into the field.
        expect(await mainComposer()).toMatchObject({ value: '', model: '' });
        // The server writes the echo right after its answer, but on the client the socket's frame and the HTTP answer
        // race: either may come first — the very order MAIN counts for the real Fansly (spike P3a §3).
        const counted = await mainSends();
        expect(counted).toMatchObject({ gestures: 1, receipts: 1, ambiguous: 0, media: 0, sent: 1 });
        expect(counted.echoFirst + counted.receiptFirst).toBe(1);
        // The link is the gesture's own: the event's timeStamp MAIN carried is the one this side read in Firefox.
        expect((await portHealth()).isolated.sends).toEqual({ gestures: 1, linked: 1, unmatched: 0, mismatched: 0, ambiguous: 0 });
      });

      it(`[FS-SEND-1] [FS-SEND-2] [TL-004] a trusted click on Fansly’s own Send (${mode}), the echo before the receipt: attributed; an edit after our insert — \`edited\`; no echo — nothing`, async () => {
        const group = ids.groups[2] as string;
        await openChat(ids, group, mode);
        await fakeFansly().command({ op: 'send', echo: 'before', receiptDelayMs: 300 });
        expect(await insert('AI words')).toMatchObject({ state: 'applied' });
        const record = await recordOf();
        await $(FANSLY_MAIN.field).click();
        await browser.keys([Key.End, ...' and mine'.split('')]);
        await waitFor(async () => (await mainComposer()).model === 'AI words and mine', 'the person’s edit');
        await $(FANSLY_MAIN.send).click();
        const [fact] = await waitForTap(humanSends, (list) => list.length > 0, 'the port’s humanSend');
        expect(fact).toMatchObject({ platformMessageId: await newestId(), draft: { provenance: 'human-or-unknown', insertIntentId: record.intentId, editedSinceInsert: true } });
        expect(fact?.textDigest).not.toBe(record.contentDigest);
        expect(await mainSends()).toMatchObject({ sent: 1, echoFirst: 1, receiptFirst: 0 });
        // No echo: the receipt alone proves nothing.
        await fakeFansly().command({ op: 'send', echo: 'none' });
        const since = await fakeFansly().mark();
        expect(await insert('never echoed')).toMatchObject({ state: 'applied' });
        await $(FANSLY_MAIN.send).click();
        await sendsLanded(since, 1);
        expect(await humanSends(1)).toEqual([]);
        expect(await mainSends()).toMatchObject({ gestures: 2, receipts: 2, sent: 1 });
      });

      it(`[FS-SEND-2] two POST /message in one gesture (${mode}) — not attributed; a request from a timer beside the page’s own send is no candidate — attributed`, async () => {
        const group = ids.groups[3] as string;
        await openChat(ids, group, mode);
        const { token } = await fakeFansly().status();
        /** A script of the page that sends one more message on the next Enter — in the same keydown, or from a timer. */
        const alsoSends = (later: boolean): Promise<void> =>
          browser.execute(
            (field: string, api: string, auth: string, groupId: string, deferred: boolean) => {
              const element = document.querySelector(field);
              if (element === null) throw new Error('no field');
              const onKey = (event: Event): void => {
                if ((event as KeyboardEvent).key !== 'Enter') return;
                element.removeEventListener('keydown', onKey);
                const go = (): void => {
                  const xhr = new XMLHttpRequest();
                  xhr.open('POST', `${api}/api/v1/message?ngsw-bypass=true`);
                  xhr.withCredentials = true;
                  xhr.setRequestHeader('authorization', auth);
                  xhr.setRequestHeader('Content-Type', 'application/json');
                  xhr.send(JSON.stringify({ groupId, content: 'the script’s own', type: 1 }));
                };
                if (deferred) setTimeout(go, 0);
                else go();
              };
              element.addEventListener('keydown', onKey);
            },
            FANSLY_MAIN.field,
            fakeFansly().apiOrigin,
            token,
            group,
            later,
          );
        let since = await fakeFansly().mark();
        expect(await insert('one of two')).toMatchObject({ state: 'applied' });
        await alsoSends(false);
        await pressEnter();
        await sendsLanded(since, 2);
        expect(await humanSends()).toEqual([]);
        expect(await mainSends()).toMatchObject({ gestures: 1, ambiguous: 1, sent: 0 });
        since = await fakeFansly().mark();
        expect(await insert('mine alone')).toMatchObject({ state: 'applied' });
        const record = await recordOf();
        await alsoSends(true);
        await pressEnter();
        await sendsLanded(since, 2);
        const sends = await waitForTap(humanSends, (list) => list.length > 0, 'the port’s humanSend');
        expect(sends).toHaveLength(1);
        expect(sends[0]).toMatchObject({ textDigest: record.contentDigest, draft: { insertIntentId: record.intentId, editedSinceInsert: false } });
        expect(await mainSends()).toMatchObject({ gestures: 2, ambiguous: 1, sent: 1 });
      });

      it(`[FS-SEND-2] a send with media (${mode}) waits for its upload: the message’s request comes after the gesture — not attributed, by rule`, async () => {
        const group = ids.groups[4] as string;
        await openChat(ids, group, mode);
        await browser.execute((selector: string) => {
          const input = document.querySelector<HTMLInputElement>(selector);
          if (input === null) throw new Error('no file input');
          const transfer = new DataTransfer();
          transfer.items.add(new File([new Uint8Array(32)], 'photo.jpg', { type: 'image/jpeg' }));
          input.files = transfer.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, `${FANSLY_MAIN.composer} .collapsable-actions > input[type=file]`);
        await $('app-account-media-upload .btn.solid-blue:not(.disabled)').click();
        await waitFor(async () => (await mainComposer()).canSend, 'the upload done');
        expect(await insert('with a photo')).toMatchObject({ state: 'applied' });
        const since = await fakeFansly().mark();
        await $(FANSLY_MAIN.send).click();
        await sendsLanded(since, 1);
        expect(await humanSends()).toEqual([]);
        // The upload was the gesture's request; the message's came in its answer, with the delivery long over.
        expect(await mainSends()).toMatchObject({ gestures: 1, receipts: 0, sent: 0 });
        expect((await portHealth()).isolated.sends).toMatchObject({ gestures: 1, linked: 0 });
      });

      it(`[FS-SEND-1] [UI-033] our text sent with no gesture of the person (${mode}) — a script’s click on Send: the page sends it, its echo comes, and no \`sent\`, no \`humanSend\``, async () => {
        const group = ids.groups[5] as string;
        await openChat(ids, group, mode);
        expect(await insert('Same words')).toMatchObject({ state: 'applied' });
        const since = await fakeFansly().mark();
        await browser.execute((selector: string) => document.querySelector<HTMLElement>(selector)?.click(), FANSLY_MAIN.send);
        await sendsLanded(since, 1);
        expect(await newestId()).toMatch(/^\d+$/);
        expect(await humanSends()).toEqual([]);
        expect(await mainSends()).toMatchObject({ gestures: 0, receipts: 0, sent: 0 });
      });
    });
  }

  it('[FS-SEND-2] a send the neighbour’s word filter swallowed (after, guard): no request, no `sent`; the person takes the word out and sends — attributed to our insert, edited', async () => {
    const group = ids.groups[6] as string;
    await openChat(ids, group, 'after', ['forbidden']);
    const since = await fakeFansly().mark();
    expect(await insert('this is forbidden')).toMatchObject({ state: 'applied' });
    const record = await recordOf();
    await pressEnter();
    await waitFor(async () => (await neighborState()).guard.restored === 1, 'the text written back');
    await browser.pause(300);
    expect(await pageSends(since)).toBe(0);
    expect(await humanSends()).toEqual([]);
    expect(await $(FANSLY_MAIN.field).getValue()).toBe('this is forbidden');
    // The person deletes the word and writes another: the draft still descends from our insert.
    await $(FANSLY_MAIN.field).click();
    await browser.keys([Key.End, ...Array.from({ length: 'forbidden'.length }, () => Key.Backspace), ...'fine'.split('')]);
    await waitFor(async () => (await mainComposer()).model === 'this is fine', 'the person’s fix');
    await browser.keys(Key.Enter);
    const [fact] = await waitForTap(humanSends, (list) => list.length > 0, 'the port’s humanSend');
    expect(await pageSends(since)).toBe(1);
    expect(fact).toMatchObject({ platformMessageId: await newestId(), draft: { insertIntentId: record.intentId, editedSinceInsert: true } });
    expect(await mainSends()).toMatchObject({ gestures: 2, receipts: 1, sent: 1 });
  });

  it('[FS-SEND-2] two quick gestures, both sends in flight: each attributed to its own message — ours with our intent, the person’s own with none', async () => {
    const group = ids.groups[7] as string;
    await openChat(ids, group, 'off');
    await fakeFansly().command({ op: 'send', echo: 'after', receiptDelayMs: 800 });
    const since = await fakeFansly().mark();
    expect(await insert('first, ours')).toMatchObject({ state: 'applied' });
    const record = await recordOf();
    await pressEnter();
    await waitFor(async () => (await mainComposer()).model === '', 'the field cleared after the first send');
    await browser.keys('second, mine'.split(''));
    await waitFor(async () => (await mainComposer()).model === 'second, mine', 'the person’s second text');
    await $(FANSLY_MAIN.send).click();
    const sends = await waitForTap(humanSends, (list) => list.length >= 2, 'both sends', 15_000);
    expect(await pageSends(since)).toBe(2);
    const list = (await callFansly('list'))?.ids.filter((id) => !id.startsWith('queued-')).slice(-2) ?? [];
    expect(sends.map((fact) => [fact.platformMessageId, fact.draft.insertIntentId])).toEqual([
      [list[0], record.intentId],
      [list[1], null],
    ]);
  });
});
