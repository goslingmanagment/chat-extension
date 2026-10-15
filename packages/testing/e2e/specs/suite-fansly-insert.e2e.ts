// Our writes on Fansly's stand (R20 P7e; docs/project-unite/architecture.md
// §7.5, §7.6; FS-INS-1…4; plan.md §3 `suite-fansly-insert`), in Firefox, next
// to the FBuddy-like neighbour in its default modes `off` and `after` (X34):
// Fansly's own start in a sandbox of the page (support/fansly-tap.ts, the
// `port` consumer — the start the extension makes, its token stood in for)
// over the test build's MAIN, the way the dock's insert service and the
// boards' «Открыть и вставить» call the port.
// - The insert: Firefox's own `insertText` into the open chat's field — the
//   page's model, its draft cache and its typing announcement get it as from
//   a person; the field focused, the caret at the end; our own insert.
// - The person's draft (Б2): consent for one revision; typing between the read
//   and the write; a draft the page restores with no event; an IME
//   composition; the neighbour's writes before ours, inside our check and
//   after it.
// - The field the port owns: an intent of another chat or generation writes
//   nothing; 200 switches with inserts in flight — every value the page's
//   model took is the one aimed at its own group.
// - Opening a chat: the inbox row's link, else the address and `popstate`;
//   no load of the page. «Открыть и вставить»: once the target's own field is
//   there; never over the person's draft; its deadline; given up by the
//   person's navigation or by the extension.
// No request of ours reaches the fake Fansly (checked at the end).

import type { InsertReceipt, NavigationReceipt, RouteState } from '@cg/contracts/host';
import type { DraftSnapshot, HostIdentity } from '@cg/contracts/ids';
import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import type { ComposerView } from '../../fixture-fansly/src/protocol';
import { EMOJI_TEXT, TEMPLATE_TEXT } from '../../src/fake-fansly/neighbor/composer';
import { NEIGHBOR_TAGS } from '../../src/fake-fansly/neighbor/dom';
import { openWithNeighbor, setFanslyNeighbor, waitForNeighborComposer } from '../support/fansly-neighbor';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyIds } from '../support/fansly-stand';
import { installFanslyTapHarness, tap, waitForFanslyTap, waitForTap, type FanslyTapHarness } from '../support/fansly-tap';
import { useNetworkTrap } from '../support/network-trap';

type Ids = Awaited<ReturnType<typeof fanslyIds>>;
type Mode = 'off' | 'after';

interface PortView {
  readonly route: RouteState;
  readonly identity: HostIdentity | null;
  readonly composer: { readonly instanceId: string; readonly ready: boolean; readonly hidden: boolean } | null;
}
interface Insertion {
  readonly record: { readonly intentId: string; readonly composerInstanceId: string; readonly chat: { readonly platformFanId: string }; readonly digest: string } | null;
  readonly sent: { readonly provenance: string; readonly insertIntentId: string | null; readonly editedSinceInsert: boolean | null } | null;
}
interface RaceResult {
  readonly group: string;
  readonly text: string;
  readonly receipt: InsertReceipt | { readonly state: 'error'; readonly code: string };
}

const portView = (): Promise<PortView> => tap<PortView>('port');
const waitFor = (check: () => Promise<boolean>, what: string, timeout = 10_000): Promise<true> => browser.waitUntil(check, { timeout, interval: 50, timeoutMsg: what });

/** The port on `group`: MAIN named its fan, the field the port owns is ready. */
const atGroup = (ids: Ids, group: string, what: string): Promise<PortView> =>
  waitForTap(portView, (view) => view.route.conversationRef === group && view.route.chat?.platformFanId === ids.fans[group] && view.composer?.ready === true, what, 15_000);

/** A fresh page on `group` next to the neighbour in `mode`, Fansly's start up, the chat named. */
async function openChat(ids: Ids, group: string, mode: Mode): Promise<void> {
  await openWithNeighbor(`/messages/${group}`, { mode });
  await waitForFanslyTap();
  await atGroup(ids, group, `the chat ${group}`);
  if (mode === 'after') await waitForNeighborComposer();
}

/** The main conversation's composer as the page holds it: its field, its model, its draft cache. */
async function mainComposer(): Promise<ComposerView> {
  const found = (await callFansly('composers')).find((composer) => composer.place === 'main' && composer.connected);
  if (found === undefined) throw new Error('no main composer');
  return found;
}
const fieldValue = async (): Promise<string | null> => (await mainComposer()).value;

/** The person types into the main field: a click into it, the end of the text, real keys. */
async function typeIntoField(text: string): Promise<void> {
  await $(FANSLY_MAIN.field).click();
  await browser.keys([Key.End, ...text.split('')]);
  await waitFor(async () => (await mainComposer()).model.endsWith(text), `typed «${text}»`);
}

/** The field emptied the way a page script does it (the value and an `input`). */
const clearField = (): Promise<void> =>
  browser.execute((selector: string) => {
    const field = document.querySelector<HTMLTextAreaElement>(selector);
    if (field === null) throw new Error('no field');
    field.value = '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, FANSLY_MAIN.field);

/** A real click on the neighbour's own widget on the main composer (inside its open shadow root). */
async function clickNeighbour(tag: string): Promise<void> {
  await $(`${FANSLY_MAIN.composer} ${tag}`).shadow$('button').click();
}

const insert = (options: { readonly text: string; readonly mode?: 'replace' | 'append'; readonly confirm?: boolean; readonly from?: DraftSnapshot; readonly ttlMs?: number; readonly holdMs?: number; readonly follower?: 'templates' | 'emoji' }): Promise<InsertReceipt> =>
  tap<InsertReceipt>('insert', options);
const snapshot = (): Promise<DraftSnapshot> => tap<DraftSnapshot>('snapshotDraft');
const lastInsertLog = async (): Promise<Record<string, unknown> | undefined> =>
  (await tap<Array<{ event: string; detail?: Record<string, unknown> }>>('diagnostics')).filter((entry) => entry.event === 'insert').at(-1)?.detail;
const navigationWays = async (): Promise<unknown[]> => (await tap<Array<{ event: string; detail?: Record<string, unknown> }>>('diagnostics')).filter((entry) => entry.event === 'navigate').map((entry) => entry.detail?.['way']);

/** «Открыть и вставить» (with a text) or a plain opening of the group's fan; resolves with its receipt. */
async function navigate(ids: Ids, group: string, options: { readonly text?: string; readonly ttlMs?: number; readonly abortAfterMs?: number; readonly fan?: string } = {}, timeout = 15_000): Promise<NavigationReceipt> {
  const id = await tap<string>('navigate', { group, fan: options.fan ?? ids.fans[group], ...options });
  const receipt = await waitForTap(() => tap<NavigationReceipt | 'pending'>('navigation', id), (value) => value !== 'pending', `the navigation to ${group}`, timeout);
  return receipt as NavigationReceipt;
}

describe('Fansly’s writes on its stand: the insert and «Открыть и вставить» (R20 P7e)', () => {
  useNetworkTrap();
  let harness: FanslyTapHarness | null = null;
  let ids: Ids;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    await browser.setWindowSize(1440, 900);
    harness = await installFanslyTapHarness({ main: 'start', consumer: 'port' });
    await openWithNeighbor('/messages', { mode: 'off' });
    ids = await fanslyIds();
  });

  after(async () => {
    await harness?.remove();
    // Nothing of ours ever reached Fansly: the page loaded what it loads for a person.
    expect(await fakeFansly().calls('ours', 0)).toEqual([]);
    await setFanslyNeighbor(null);
    await browser.url('about:blank');
    await fakeFansly().command({ op: 'reset' });
  });

  for (const mode of ['off', 'after'] as const) {
    describe(`next to the neighbour (${mode})`, () => {
      it(`[UI-019] [UI-021] [RB-009] [NEW-06] into an empty field (${mode}): Firefox’s own insertText — the page’s model, its draft cache and its typing announcement got it; the field focused, the caret at the end; our own insert, its record`, async () => {
        const group = ids.groups[1] as string;
        await openChat(ids, group, mode);
        const mark = await fakeFansly().mark();
        const text = 'Привет! Как прошёл день?';
        const receipt = await insert({ text });
        expect(receipt).toMatchObject({ state: 'applied' });
        // The editor's way, not the fallback: Firefox took it for input.
        expect(await lastInsertLog()).toMatchObject({ state: 'applied', path: 'exec', mode: 'replace' });
        expect(await mainComposer()).toMatchObject({ groupId: group, value: text, model: text, cached: text, canSend: true });
        const caret = await browser.execute((selector: string) => {
          const field = document.querySelector<HTMLTextAreaElement>(selector);
          return { focused: document.activeElement === field, start: field?.selectionStart ?? -1, end: field?.selectionEnd ?? -1, length: field?.value.length ?? -1 };
        }, FANSLY_MAIN.field);
        expect(caret).toEqual({ focused: true, start: text.length, end: text.length, length: text.length });
        // As from a person, the page tells the fan «печатает»: the model was updated by the input.
        await waitFor(async () => (await fakeFansly().calls('page', mark)).some((entry) => entry.route === 'message.typing'), 'the page’s typing announcement');
        // NEW-06: the receipt names the field as it is now; the draft is our own, its record the intent's.
        const draft = await snapshot();
        expect(receipt.state === 'applied' && [receipt.draftRevision, receipt.draftDigest]).toEqual([draft.revision, draft.digest]);
        expect(draft.provenance).toBe('our-insert');
        const { record, sent } = await tap<Insertion>('insertion');
        expect(record).toMatchObject({ composerInstanceId: draft.identity.composerInstanceId, chat: { platformFanId: ids.fans[group] }, digest: draft.digest });
        expect(sent).toEqual({ revision: draft.revision, provenance: 'our-insert', insertIntentId: record?.intentId, editedSinceInsert: false });
        expect(await tap('redeemed')).toEqual(['insert']);
      });

      it(`[NEW-05] [UI-020] [AI-022] the person’s draft (${mode}): consent for its revision — append keeps it, replace replaces it —, and typing between the read and the write is refused`, async () => {
        const group = ids.groups[2] as string;
        await openChat(ids, group, mode);
        await typeIntoField('my words');
        expect(await insert({ text: 'AI text' })).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' });
        expect(await fieldValue()).toBe('my words');
        expect(await insert({ text: 'appended', mode: 'append', confirm: true })).toMatchObject({ state: 'applied' });
        expect(await mainComposer()).toMatchObject({ value: 'my words\nappended', model: 'my words\nappended' });
        // The person's words are still in the field: a plain «Вставить» asks again.
        expect(await insert({ text: 'replaced' })).toMatchObject({ state: 'rejected', needs: 'confirm-human-draft' });
        expect(await insert({ text: 'replaced', confirm: true })).toMatchObject({ state: 'applied' });
        expect(await fieldValue()).toBe('replaced');
        // Typing between the read and the write: the old revision is no consent.
        const stale = await snapshot();
        await typeIntoField('!');
        expect(await insert({ text: 'x', confirm: true, from: stale })).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-changed-draft' });
        expect(await mainComposer()).toMatchObject({ value: 'replaced!', model: 'replaced!' });
      });

      it(`a restored draft (${mode}): the page writes the person’s cached text into the chat’s new field with no event — an intent of the old field is refused, the text is the person’s`, async () => {
        const [, , , group, other] = ids.groups as [string, string, string, string, string];
        await openChat(ids, group, mode);
        const old = await snapshot();
        await typeIntoField('typed by hand');
        await callFansly('open', other, 'link');
        await atGroup(ids, other, 'the other chat');
        await callFansly('open', group, 'link');
        await atGroup(ids, group, 'back to the chat');
        await waitFor(async () => (await fieldValue()) === 'typed by hand', 'the page’s restored draft');
        const restored = await snapshot();
        expect(restored).toMatchObject({ plainText: 'typed by hand', provenance: 'human-or-unknown' });
        expect(restored.identity.composerInstanceId).not.toBe(old.identity.composerInstanceId);
        expect(await insert({ text: 'x', from: old })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
        expect(await insert({ text: 'x' })).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' });
        expect(await mainComposer()).toMatchObject({ value: 'typed by hand', model: 'typed by hand' });
      });

      it(`IME (${mode}): while a composition runs nothing is written — Angular’s model waits for its end —; after it, the insert goes`, async () => {
        const group = ids.groups[5] as string;
        await openChat(ids, group, mode);
        await browser.execute((selector: string) => {
          const field = document.querySelector<HTMLTextAreaElement>(selector);
          if (field === null) throw new Error('no field');
          field.focus();
          field.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
          field.value = 'に';
          field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: 'に' }));
        }, FANSLY_MAIN.field);
        expect(await insert({ text: 'AI', confirm: true })).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-changed-draft' });
        expect(await mainComposer()).toMatchObject({ value: 'に', model: '' });
        await browser.execute((selector: string) => {
          const field = document.querySelector<HTMLTextAreaElement>(selector);
          field?.dispatchEvent(new CompositionEvent('compositionend', { data: 'に' }));
        }, FANSLY_MAIN.field);
        await waitFor(async () => (await mainComposer()).model === 'に', 'the composition ended');
        expect(await insert({ text: 'AI', confirm: true })).toMatchObject({ state: 'applied' });
        expect(await mainComposer()).toMatchObject({ value: 'AI', model: 'AI' });
      });

      it(`[AI-125] [UI-026] the field the port owns (${mode}): an intent for the chat that was open writes nothing after a switch; expired and unredeemed intents write nothing, a stale one spends no token`, async () => {
        const [, , , , , , group, other] = ids.groups as [string, string, string, string, string, string, string, string];
        await openChat(ids, group, mode);
        const prepared = await snapshot();
        await callFansly('open', other, 'link');
        await atGroup(ids, other, 'the other chat');
        const spent = (await tap<string[]>('redeemed')).length;
        expect(await insert({ text: 'meant for the first', from: prepared })).toEqual({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
        expect((await tap<string[]>('redeemed')).length).toBe(spent);
        expect(await fieldValue()).toBe('');
        expect(await insert({ text: 'late', ttlMs: 5, holdMs: 30 })).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
        await tap('setRedeem', false);
        expect(await insert({ text: 'no token' })).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
        await tap('setRedeem', true);
        expect(await fieldValue()).toBe('');
        // The first chat's field never got any of it: its draft cache is empty.
        await callFansly('open', group, 'link');
        await atGroup(ids, group, 'the first chat again');
        expect((await mainComposer()).cached).toBe('');
      });

      it(`[RB-014] 200 switches with inserts in flight (${mode}): every value the page’s model took is the one aimed at its own group`, async () => {
        const groups = ids.groups.slice(0, 3);
        const group = groups[0] as string;
        await openChat(ids, group, mode);
        const since = (await callFansly('journal')).at(-1)?.seq ?? 0;
        const results = await tap<RaceResult[]>('race', { n: 200, groups });
        await browser.pause(300);
        const outcomes: Record<string, number> = {};
        for (const result of results) {
          const key = `${result.receipt.state} ${'code' in result.receipt ? result.receipt.code : ''}`.trim();
          outcomes[key] = (outcomes[key] ?? 0) + 1;
        }
        expect(results.length).toBeGreaterThan(150);
        expect(results.filter((result) => result.receipt.state === 'applied').length).toBeGreaterThan(30);
        expect(results.filter((result) => result.receipt.state === 'rejected').length).toBeGreaterThan(20);
        expect(results.filter((result) => result.receipt.state === 'error' || ('code' in result.receipt && result.receipt.code === 'CG-INSERT-MISPLACED'))).toEqual([]);
        // What the page's models took from their fields: each text of ours in the composer of the group it was aimed at.
        const taken = (await callFansly('journal', since)).filter((entry) => entry.type === 'composer-model' && /^R\d+@\d+$/.test(String(entry['value'])));
        expect(taken.length).toBeGreaterThan(30);
        for (const entry of taken) expect([entry['place'], String(entry['value']).split('@')[1]]).toEqual(['main', entry['groupId']]);
        // And every applied one was taken by the model.
        const values = new Set(taken.map((entry) => String(entry['value'])));
        expect(results.filter((result) => result.receipt.state === 'applied' && !values.has(result.text))).toEqual([]);
        expect(outcomes).toBeDefined();
      });

      it(`[SP-036] opening a chat (${mode}): by the inbox row’s own link when it is rendered, else by the address and a \`popstate\` Angular reads; the page is never loaded again`, async () => {
        const [group, linked] = ids.groups as [string, string];
        await openChat(ids, group, mode);
        await browser.execute(() => void Reflect.set(window, '__p7eSameDocument', true));
        const far = (await callFansly('groups'))[60];
        if (far === undefined) throw new Error('no 61st group');
        expect((await callFansly('inbox')).rendered).not.toContain(far.id);
        expect(await navigate(ids, linked)).toMatchObject({ state: 'navigated', insert: null });
        await atGroup(ids, linked, 'the linked chat');
        expect(await navigate(ids, far.id, { fan: far.fanId })).toMatchObject({ state: 'navigated', insert: null });
        await waitForTap(portView, (view) => view.route.conversationRef === far.id && view.route.chat?.platformFanId === far.fanId && view.composer?.ready === true, 'the chat far down the inbox', 15_000);
        expect(await navigationWays()).toEqual(['link', 'popstate']);
        expect(await callFansly('route')).toMatchObject({ path: `/messages/${far.id}`, groupId: far.id });
        // Past the 2-second check: the same document — nothing was loaded by its address.
        await browser.pause(2300);
        expect(await browser.execute(() => Reflect.get(window, '__p7eSameDocument') === true)).toBe(true);
      });

      it(`[NEW-01] «Открыть и вставить» (${mode}): once the target’s own field is there, one write into it; never over the person’s draft there`, async () => {
        const [group, target, drafted] = ids.groups as [string, string, string];
        await openChat(ids, drafted, mode);
        await typeIntoField('my draft for them');
        await callFansly('open', group, 'link');
        await atGroup(ids, group, 'the first chat');
        expect(await navigate(ids, target, { text: 'Opened and inserted' })).toMatchObject({ state: 'navigated', insert: { state: 'applied' } });
        expect(await mainComposer()).toMatchObject({ groupId: target, value: 'Opened and inserted', model: 'Opened and inserted' });
        expect((await tap<Insertion>('insertion')).record?.chat.platformFanId).toBe(ids.fans[target]);
        expect(await navigate(ids, drafted, { text: 'AI over it' })).toMatchObject({ state: 'navigated', insert: { state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' } });
        expect(await mainComposer()).toMatchObject({ groupId: drafted, value: 'my draft for them' });
      });

      it(`[NEW-01] the deadline and giving up (${mode}): the field not there in time — CG-NAV-TIMEOUT; the person opens another chat, or the extension gives it up — CG-INSERT-CANCELED; nothing written later`, async () => {
        const [group, slow, left, given] = [ids.groups[0], ids.groups[3], ids.groups[4], ids.groups[6]] as [string, string, string, string];
        await openChat(ids, group, mode);
        const delayed = async (target: string, ms: number): Promise<void> => {
          await callFansly('forget', target);
          await fakeFansly().command({ op: 'api', rules: [{ route: 'group.detail', times: 1, outcome: { kind: 'delay', ms } }] });
        };
        await delayed(slow, 3000);
        expect(await navigate(ids, slow, { text: 'too late', ttlMs: 1200 })).toEqual({ state: 'failed', code: 'CG-NAV-TIMEOUT', insert: { state: 'rejected', code: 'CG-NAV-TIMEOUT' } });
        await atGroup(ids, slow, 'the slow chat at last');
        await browser.pause(300);
        expect(await mainComposer()).toMatchObject({ groupId: slow, value: '', model: '' });

        await delayed(left, 2500);
        const id = await tap<string>('navigate', { group: left, fan: ids.fans[left], text: 'left behind' });
        await waitFor(async () => (await callFansly('route')).path === `/messages/${left}`, 'the address on the slow chat');
        await callFansly('open', group, 'link');
        const canceled = await waitForTap(() => tap<NavigationReceipt | 'pending'>('navigation', id), (value) => value !== 'pending', 'the insert given up');
        expect(canceled).toMatchObject({ state: 'navigated', insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });

        await delayed(given, 1500);
        expect(await navigate(ids, given, { text: 'given up', abortAfterMs: 300 })).toMatchObject({ state: 'navigated', insert: { state: 'rejected', code: 'CG-INSERT-CANCELED' } });
        await atGroup(ids, given, 'the chat given up');
        await browser.pause(300);
        expect(await mainComposer()).toMatchObject({ groupId: given, value: '' });
        await callFansly('open', left, 'link');
        await atGroup(ids, left, 'the chat left');
        expect(await mainComposer()).toMatchObject({ value: '', cached: '' });
      });
    });
  }

  it('the neighbour’s writes before ours, inside our check and after it (after): the person’s text; `uncertain` without a second write; ours stands, edited since', async () => {
    const group = ids.groups[7] as string;
    await openChat(ids, group, 'after');
    // Before ours: its template — the field holds text that is not ours.
    await clickNeighbour(NEIGHBOR_TAGS.templates);
    await waitFor(async () => (await mainComposer()).model === TEMPLATE_TEXT, 'its template');
    expect(await insert({ text: 'AI' })).toEqual({ state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' });
    // Between the read and the write: its emoji moves the revision.
    const read = await snapshot();
    await clickNeighbour(NEIGHBOR_TAGS.emoji);
    await waitFor(async () => (await mainComposer()).model.endsWith(EMOJI_TEXT), 'its emoji');
    expect(await insert({ text: 'x', confirm: true, from: read })).toMatchObject({ state: 'rejected', needs: 'confirm-changed-draft' });
    // Inside our check: its write in the microtask right after ours — not confirmed, not written again.
    await clearField();
    expect(await insert({ text: 'first', follower: 'emoji' })).toEqual({ state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' });
    expect(await mainComposer()).toMatchObject({ value: `first${EMOJI_TEXT}`, model: `first${EMOJI_TEXT}` });
    // After the receipt: ours stands; the draft descends from it, edited since.
    await clearField();
    expect(await insert({ text: 'second' })).toMatchObject({ state: 'applied' });
    await clickNeighbour(NEIGHBOR_TAGS.emoji);
    await waitFor(async () => (await mainComposer()).model === `second${EMOJI_TEXT}`, 'its emoji after ours');
    const { record, sent } = await tap<Insertion>('insertion');
    expect(sent).toMatchObject({ provenance: 'human-or-unknown', insertIntentId: record?.intentId, editedSinceInsert: true });
  });
});
