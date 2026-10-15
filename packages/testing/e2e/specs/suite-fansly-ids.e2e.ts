// `groupId` on every Fansly surface (R20 P8a; FS-IDN-6; docs/project-unite/
// architecture.md §7.23, plan.md §3 `suite-fansly-ids`): the extension's test
// build on the Fansly stand against the fake hub, a chatter signed in, the
// Fansly page's persona chosen and its own switches on. On Fansly a chat is a
// group whose id is never its fan's (FS-ACC-1), and the fake hub refuses a
// pair whose group the page's capture holds as another fan's (HF-9, 409) and
// a read by conversation that names none (HF-10, 400) — so every request
// below is checked twice: by the journal and by the hub's own rules.
// - the dock: Reply in two chats names each chat's own group beside its fan;
// - the fan panel: the card and the dossier are the fan's (`pageFanProfile`,
//   never a conversation's profile by the fan's id), the archive and the
//   Recap are the group's — read, generated and saved by the group (CS-031);
// - the toast: a Reply that ends while the person is in another chat is
//   toasted with «Открыть чат» naming that operation's group;
// - the preview: a Spenders row whose chat the hub knows previews that
//   group — its archive and its «Открыть чат» (the address is the group's);
//   a row whose chat no one knows asks nothing of it — no archive, no
//   generation, nothing by the fan's id in the group's place.
// P9e also resolves Spenders' missing groups on an explicit click; «Новые» is P10c.
// And the start of the dock's Reply (R20 P8b1; FS-TAIL-1, FS-TAIL-6): MAIN's
// snapshot of the open chat is the start's proof, and the hub is asked about
// it — the window the page holds, the fan's newest ids first, what the page
// deleted, the texts, a count no smaller than the window. The verdict over
// that Reply (R20 P8b2; spec §3.5, FS-TAIL-8): the mark the hub's answers
// call for, in both of Fansly's themes; inserting never held by it.
// The passive cases ask the fake Fansly nothing; P9e's explicit lookups use its paced allowlist.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import type { HubRouteKey } from '@cg/contracts';

import type { FakeHubControlClient } from '../../src/fake-hub/control-client';
import type { FakeHubJournalEntry } from '../../src/fake-hub/types';
import { WORLD } from '../../src/scenarios/hub';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { PANEL } from '../support/chat';
import { readReport, waitForReport } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift } from '../support/fansly-shift';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyStandServer } from '../support/fansly-stand';
import { focusTab } from '../support/focus';
import { useNetworkTrap } from '../support/network-trap';
import { ours, oursByText, oursExists, oursText, pressOurs, readOurs, waitOursText } from '../support/ours';
import { dockIs } from '../support/shift';

/** The stand's first two chats as the hub's capture knows them: groups and fans, every id apart. */
const A = WORLD.fansly.chats.a;
const B = WORLD.fansly.chats.b;
const CREATOR = WORLD.pages.fansly.platformAccountId;
/** A fan of the page's board whose chat the hub's capture does not know (and the stand has no chat with). */
const STRANGER = '920000000000000077';
const NAMES: Readonly<Record<string, string>> = { [A.fan]: 'Fan Aspen', [B.fan]: 'Fan Birch', [STRANGER]: 'Fan Stranger' };
const nameOf = (fan: string): string => NAMES[fan] ?? fan;

/** The ids a hub call named: the fan and the conversation, from its query, path or body. */
interface Named {
  readonly route: string;
  readonly status: number;
  readonly fan: string | null;
  readonly conversation: string | null;
}
function namedOf(entry: FakeHubJournalEntry): Named {
  const request = (entry.request ?? {}) as Record<string, unknown>;
  const body = (request['body'] ?? {}) as Record<string, unknown>;
  const pick = (key: string): string | null => {
    const value = request[key] ?? body[key];
    return typeof value === 'string' ? value : null;
  };
  return { route: entry.route ?? '', status: entry.status, fan: pick('fanRef') ?? pick('platformUserId'), conversation: pick('conversationRef') };
}
const callsOf = async (hub: FakeHubControlClient, since: number, routes: readonly HubRouteKey[]): Promise<Named[]> => {
  const { entries } = await hub.journal(since);
  return entries.filter((entry) => entry.route !== null && (routes as readonly string[]).includes(entry.route)).map(namedOf);
};
/** Nothing of these routes was refused: a wrong pair is 409 and a read by no conversation 400 on the fake hub, as on the hub. */
const allServed = (named: readonly Named[]): readonly Named[] => named.filter((call) => call.status >= 400);

const route = (): Promise<{ readonly groupId: string | null }> => callFansly('route');
async function openChat(group: string, fan: string): Promise<void> {
  await callFansly('open', group, 'router');
  await browser.waitUntil(async () => (await route()).groupId === group, { timeout: 10_000, timeoutMsg: `the chat ${group} did not open` });
  await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true && d.target?.endsWith(`:${fan}`) === true, `the dock of the chat of ${fan}, ready`, 20_000);
}
const replyDone = (fan: string) => (d: { readonly target: string | null; readonly result: { readonly feature: string; readonly state: string } | null }): boolean =>
  d.target?.endsWith(`:${fan}`) === true && d.result?.feature === 'reply' && d.result.state === 'done';

/** A picture of the stand's page as it is now, in .cache/e2e/ (compared by eye with ui-design.md). */
async function shootStand(name: string): Promise<void> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  await browser.execute(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}${name}.png`);
}

/** Leaves Fansly's field: a key of ours outside it is a command, not text. */
const leaveField = (): Promise<unknown> => browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());

describe('groupId on every Fansly surface: the dock, the fan panel, the toast, the preview (R20 P8a)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  const calls = (since: number, routes: readonly HubRouteKey[]): Promise<Named[]> => callsOf(hub(), since, routes);
  let journalStart = 0;
  /** The first chat's Reply of the first test: the toast's Reply is another one. */
  let firstReply: string | null = null;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    journalStart = await fanslyStandServer.mark();
    // The page's board: the stand's two fans, whose chats the hub's capture knows, and a stranger whose chat it does not.
    await hub().command({ op: 'spenderFans', fans: [A.fan, B.fan, STRANGER].map((fanRef, rank) => ({ fanRef, displayName: nameOf(fanRef), lifetimeUsd: 900 - rank * 100 })) });
    await hub().command({ op: 'config', patch: { spendersTotal: 3 } });
    await startFanslyShift(hub(), { path: `/messages/${A.group}`, settings: { generation: { split: true } }, viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true && d.target?.endsWith(`:${A.fan}`) === true, 'the dock of the first Fansly chat, ready', 20_000);
  });

  after(async () => {
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    // Nothing of the extension asked the Fansly stand for anything (the page's own calls go to the fake Fansly).
    expect((await fanslyStandServer.journal(journalStart)).filter((entry) => entry.origin !== 'asset')).toEqual([]);
  });

  it('the dock: Reply in two chats names each chat’s own group beside its own fan, and the hub serves both pairs', async () => {
    const mark = await hub().mark();
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    firstReply = (await dockIs(replyDone(A.fan), 'the Reply of the first chat', 30_000)).result?.opId ?? null;
    await openChat(B.group, B.fan);
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    await dockIs(replyDone(B.fan), 'the Reply of the second chat', 30_000);
    const streams = await calls(mark, ['aiFeatureStream']);
    expect(streams.map(({ fan, conversation }) => ({ fan, conversation }))).toEqual([
      { fan: A.fan, conversation: A.group },
      { fan: B.fan, conversation: B.group },
    ]);
    expect(allServed(streams)).toEqual([]);
    await openChat(A.group, A.fan);
  });

  it('[CS-031] the fan panel: the card and the dossier are the fan’s, the archive and the Recap are the group’s — read, made and saved by the group', async function () {
    this.timeout(120_000);
    const mark = await hub().mark();
    await leaveField();
    await browser.keys([']']);
    await browser.waitUntil(() => oursExists('panel', '.cg-fp'), { timeout: 10_000, timeoutMsg: 'the fan panel did not open' });
    await browser.waitUntil(async () => (await calls(mark, ['clientConversationFeed', 'pageFanProfile'])).length >= 2, { timeout: 15_000, timeoutMsg: 'the fan panel did not read its fan' });
    const reads = await calls(mark, ['spenderDetail', 'pageFanProfile', 'pageConversationProfile', 'clientConversationFeed']);
    // The money of both periods and the dossier name the fan alone; the archive's coverage is the group's.
    expect(reads.filter((call) => call.route === 'spenderDetail').map((call) => [call.fan, call.conversation])).toEqual([
      [A.fan, null],
      [A.fan, null],
    ]);
    expect(reads.filter((call) => call.route === 'pageFanProfile').map((call) => [call.fan, call.conversation])).toEqual([[A.fan, null]]);
    expect(reads.filter((call) => call.route === 'pageConversationProfile')).toEqual([]);
    expect(reads.filter((call) => call.route === 'clientConversationFeed').map((call) => [call.fan, call.conversation])).toEqual([[A.fan, A.group]]);

    // The Recap tab: the group's Recap, made in full and saved to the hub as the group's — the pair the hub checks.
    await ours('panel', '.cg-fp__tabs [role="tab"]:last-child').click();
    await pressOurs('panel', '.cg-fp button', /^Полностью$/);
    await pressOurs('panel', '.cg-fp button', /^Обновить Recap/);
    await browser.waitUntil(async () => (await calls(mark, ['clientFanProfileFromGeneration'])).some((call) => call.status === 200), {
      timeout: 30_000,
      timeoutMsg: 'the full Recap of the group was not saved to the hub',
    });
    const recap = await calls(mark, ['clientConversationRecaps', 'aiFeatureStream', 'clientFanProfileFromGeneration']);
    expect(recap.map((call) => call.route)).toEqual(expect.arrayContaining(['clientConversationRecaps', 'aiFeatureStream', 'clientFanProfileFromGeneration']));
    for (const call of recap) expect([call.route, call.fan, call.conversation]).toEqual([call.route, A.fan, A.group]);
    expect(allServed([...reads, ...recap])).toEqual([]);
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('panel', '.cg-fp')), { timeout: 5000, timeoutMsg: 'the fan panel did not close' });
  });

  it('the toast: a Reply that ends while the person is in another chat is toasted, and its «Открыть чат» names that operation’s group', async function () {
    this.timeout(120_000);
    // Chunks slow enough to leave the chat before the answer ends.
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 1000 } });
    try {
      // The chat's Reply of the first test is kept: the strip shows it again, and «Ещё раз» starts a new one.
      await pressOurs('dock', '.cg-strip button', /^Reply/);
      const shown = await dockIs((d) => d.target?.endsWith(`:${A.fan}`) === true && d.result?.feature === 'reply', 'the first chat’s Reply in the dock');
      if (shown.result?.opId === firstReply) await pressOurs('dock', '.cg-sheet button', /^Ещё раз/);
      await dockIs((d) => d.target?.endsWith(`:${A.fan}`) === true && d.result !== null && d.result.opId !== firstReply && d.result.state !== 'done', 'a new Reply of the first chat started');
      await openChat(B.group, B.fan);
      await waitOursText('toast', 'AI готово', 'the toast of the Reply that ended in the other chat', { timeout: 30_000 });
      const report = await waitForReport((now) => (now.toasts ?? []).some((toast) => toast.chats.length > 0), 'the toast with «Открыть чат» in the report');
      expect((report.toasts ?? []).filter((toast) => toast.chats.length > 0).map((toast) => ({ kind: toast.kind, chats: toast.chats }))).toEqual([
        { kind: 'success', chats: [`nav.chat.${CREATOR}.${A.fan}.${A.group}`] },
      ]);
    } finally {
      await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    }
    await browser.waitUntil(async () => !(await oursExists('toast', '.cg-toast')), { timeout: 20_000, timeoutMsg: 'the toasts did not go' });
  });

  it('the preview: a Spenders row whose chat the hub knows previews that group — its archive, its «Открыть чат»; a row whose chat no one knows asks nothing of it', async function () {
    this.timeout(180_000);
    // The person is in the second chat; the preview is of the first fan.
    if ((await route()).groupId !== B.group) await openChat(B.group, B.fan);
    const mark = await hub().mark();
    await focusTab();
    await leaveField();
    await browser.keys([...PANEL, 'm']);
    await waitOursText('modal', nameOf(A.fan), 'the board lists the first fan', { timeout: 20_000, selector: '[aria-label="Доска Spenders"]' });
    await pressOurs('modal', '[data-cg-key^="fan:"]', new RegExp(`^${nameOf(A.fan)}`));
    await waitOursText('modal', nameOf(A.fan), 'the preview of the first fan', { selector: '.cg-pv' });
    // The archive of the group: what the stand's chat holds, read from the hub (the preview's generation on Fansly waits
    // for the site's own send journal, P9d/P9e — its target's group is the unit tests').
    await browser.waitUntil(async () => (await calls(mark, ['clientConversationFeed'])).length > 0, { timeout: 15_000, timeoutMsg: 'the preview did not read the archive' });
    const preview = await calls(mark, ['clientConversationFeed', 'spenderDetail']);
    expect(preview.filter((call) => call.route === 'clientConversationFeed').map((call) => [call.fan, call.conversation])).toEqual([[A.fan, A.group]]);
    expect(preview.filter((call) => call.route === 'spenderDetail').every((call) => call.fan === A.fan && call.conversation === null)).toBe(true);
    expect(allServed(preview)).toEqual([]);
    // Nothing of that chat was asked of Fansly, and the chat on screen is still the second one.
    expect((await route()).groupId).toBe(B.group);

    // The stranger: the card says the chat is not known yet; nothing of it is read or generated, by the fan's id or otherwise.
    const strangerMark = await hub().mark();
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('modal', '.cg-pv')), { timeout: 5000, timeoutMsg: 'Esc did not close the preview' });
    await waitOursText('modal', nameOf(STRANGER), 'the board lists the stranger', { timeout: 20_000, selector: '[aria-label="Доска Spenders"]' });
    await pressOurs('modal', '[data-cg-key^="fan:"]', new RegExp(`^${nameOf(STRANGER)}`));
    await waitOursText('modal', 'Данные ещё собираются', 'the stranger’s preview says its chat is not known yet', { selector: '.cg-pv' });
    // Nothing generates there: the card's error stands in place of its strip, or the strip's Reply is off with its reason.
    const reply = await oursByText('modal', '.cg-pv button', /^Reply/);
    if (reply !== null) {
      expect(await reply.getAttribute('aria-disabled')).toBe('true');
      await reply.click().catch(() => undefined);
    }
    await browser.pause(500);
    const stranger = await calls(strangerMark, ['clientConversationFeed', 'aiFeatureStream', 'clientConversationRecaps']);
    expect(stranger).toEqual([]);
    expect(await oursText('modal', '.cg-pv')).toContain(nameOf(STRANGER));

    // Back to the first fan: «Открыть чат» opens its group — the address is the group's, never the fan's.
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('modal', '.cg-pv')), { timeout: 5000, timeoutMsg: 'Esc did not close the preview' });
    await waitOursText('modal', nameOf(A.fan), 'the board again', { timeout: 20_000, selector: '[aria-label="Доска Spenders"]' });
    await pressOurs('modal', '[data-cg-key^="fan:"]', new RegExp(`^${nameOf(A.fan)}`));
    await waitOursText('modal', nameOf(A.fan), 'the preview of the first fan again', { selector: '.cg-pv' });
    await pressOurs('modal', '.cg-pv button', /^Открыть чат$/);
    await browser.waitUntil(async () => (await route()).groupId === A.group, { timeout: 10_000, timeoutMsg: 'the preview’s «Открыть чат» did not open the first fan’s group' });
    await browser.waitUntil(async () => !(await oursExists('modal', '[aria-label="Spenders"]')), { timeout: 5000, timeoutMsg: 'the board did not close' });
    await dockIs((d) => d.target?.endsWith(`:${A.fan}`) === true, 'the dock of the first fan’s chat');
    expect(await $(FANSLY_MAIN.field).isExisting()).toBe(true);
    expect((await readReport())?.dock?.target?.endsWith(`:${A.fan}`)).toBe(true);
  });

  it('[FS-TAIL-1] [FS-TAIL-6] the dock’s Reply carries its chat’s snapshot (R20 P8b1): the window the page holds, the fan’s newest ids first, what the page deleted, the texts — no `clientContext`, a count no smaller than the window — and the hub takes it', async function () {
    this.timeout(120_000);
    if ((await route()).groupId !== A.group) await openChat(A.group, A.fan);
    const held = async (): Promise<string[]> => (await callFansly('list'))?.ids.slice() ?? [];
    // The fan writes; a message of the window is deleted: the page follows both before the click.
    const fake = fakeFansly();
    const deleted = (await held()).at(-3) ?? '';
    const written = (await fake.command({ op: 'message', groupId: A.group, text: 'one more line' })).message?.id ?? '';
    await fake.command({ op: 'delete', messageId: deleted });
    await browser.waitUntil(async () => (await held()).includes(written) && !(await held()).includes(deleted), { timeout: 10_000, timeoutMsg: 'the page did not show the new message and drop the deleted one' });
    const page = await held();

    const mark = await hub().mark();
    const streamsSince = async (): Promise<FakeHubJournalEntry[]> => (await hub().journal(mark)).entries.filter((entry) => entry.route === 'aiFeatureStream');
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    const shown = await dockIs(replyDone(A.fan), 'the chat’s Reply in the dock', 30_000);
    // A Reply that ran has streamed by its end; none — the chat's last Reply is kept and shown again, and «Ещё раз»
    // starts a new one, with a new snapshot.
    if ((await streamsSince()).length === 0) {
      await pressOurs('dock', '.cg-sheet button', /^Ещё раз/);
      await dockIs((d) => replyDone(A.fan)(d) && d.result?.opId !== shown.result?.opId, 'a new Reply of the chat', 30_000);
    }

    const streams = await streamsSince();
    expect(streams.map((entry) => entry.status)).toEqual([200]);
    const request = streams[0]?.request as {
      readonly capabilities: readonly string[];
      readonly body: {
        readonly conversationRef: string;
        readonly fanRef: string;
        readonly messageCount: number;
        readonly coverageCheck?: { readonly window: readonly { readonly id: string; readonly dir: string }[]; readonly deletedIds: readonly string[] };
        readonly knownFanMessageIds?: readonly string[];
        readonly liveTextContext?: { readonly items: readonly { readonly platformMessageId: string; readonly direction: string; readonly text: string }[] };
      };
    };
    const { body } = request;
    expect(request.capabilities).toEqual(expect.arrayContaining(['context-v1', 'coverage-check-v1']));
    expect([body.conversationRef, body.fanRef, 'clientContext' in body]).toEqual([A.group, A.fan, false]);
    expect(body.coverageCheck?.window.map((entry) => entry.id)).toEqual(page.slice(-60));
    expect(body.coverageCheck?.window.at(-1)).toEqual({ id: written, dir: 'fan' });
    expect(body.coverageCheck?.deletedIds).toEqual([deleted]);
    expect(body.knownFanMessageIds?.[0]).toBe(written);
    // The texts: ids and sides as sent; the journal keeps a text's length only.
    expect(body.liveTextContext?.items.at(-1)).toEqual({ platformMessageId: written, direction: 'fan', occurredAt: expect.any(String) as unknown, text: `‹${'one more line'.length} chars›` });
    expect(body.liveTextContext?.items.every((item) => page.includes(item.platformMessageId))).toBe(true);
    expect(body.messageCount).toBeGreaterThanOrEqual(body.coverageCheck?.window.length ?? Infinity);
  });

  it('[R20-P8b2] [FS-TAIL-8] the verdict over the dock’s Reply on the stand: what the hub has not got is marked «Ответ мог не учесть…»; the page’s messages in the hub — no mark; a message the page deleted, still served — «Контекст устарел»; the mark in both of Fansly’s themes, the part still inserted', async function () {
    this.timeout(180_000);
    if ((await route()).groupId !== A.group) await openChat(A.group, A.fan);
    const held = async (): Promise<string[]> => (await callFansly('list'))?.ids.slice() ?? [];
    // A message of the window is deleted on the page: the snapshot names it, the window does not hold it.
    const fake = fakeFansly();
    const deleted = (await held()).at(-2) ?? '';
    await fake.command({ op: 'delete', messageId: deleted });
    await browser.waitUntil(async () => !(await held()).includes(deleted), { timeout: 10_000, timeoutMsg: 'the page did not drop the deleted message' });

    /** A new Reply of the chat — «Ещё раз» over the one shown (Reply again would show the kept one) —, and the window check it asked. */
    const regenerate = async (): Promise<{ readonly window: readonly { readonly id: string; readonly dir: 'fan' | 'model' }[]; readonly deletedIds: readonly string[] }> => {
      const now = (await readReport())?.dock ?? null;
      if (now === null || !replyDone(A.fan)(now)) await pressOurs('dock', '.cg-strip button', /^Reply/);
      const shown = await dockIs(replyDone(A.fan), 'the chat’s Reply in the dock', 30_000);
      const mark = await hub().mark();
      await pressOurs('dock', '.cg-sheet button', /^Ещё раз/);
      await dockIs((d) => replyDone(A.fan)(d) && d.result?.opId !== shown.result?.opId, 'a new Reply of the chat', 30_000);
      const streams = (await hub().journal(mark)).entries.filter((entry) => entry.route === 'aiFeatureStream');
      expect(streams.map((entry) => entry.status)).toEqual([200]);
      const check = (streams[0]?.request as { readonly body: { readonly coverageCheck?: { readonly window: readonly { readonly id: string; readonly dir: 'fan' | 'model' }[]; readonly deletedIds: readonly string[] } } }).body.coverageCheck;
      if (check === undefined) throw new Error('the Reply asked no window check');
      return check;
    };
    const markText = (): Promise<string> => oursText('dock', '.cg-stale__t');
    const seed = (messages: readonly { readonly id: string; readonly sender: 'fan' | 'model' }[]): Promise<unknown> =>
      hub().command({ op: 'archiveConversation', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: A.group, messages });

    // As the stand is: the hub's archive of the group holds none of the page's ids — every one of them `absent`.
    const asked = await regenerate();
    expect(asked.deletedIds).toContain(deleted);
    await waitOursText('dock', 'Ответ мог не учесть последние сообщения чата.', 'the mark of a miss of the window', { selector: '.cg-stale__t' });
    expect(await oursText('dock', '.cg-stale button')).toBe('Ещё раз');
    for (const theme of ['bright', 'dark'] as const) {
      await callFansly('setTheme', theme);
      await waitForReport((now) => now.dock?.scheme === (theme === 'bright' ? 'light' : 'dark'), `the dock in the ${theme} theme`);
      await shootStand(`suite-fansly-ids-mark-window-miss-${theme}`);
    }
    await callFansly('setTheme', 'bright');
    // The mark holds nothing in the dock: the part inserts into Fansly's field as ever (FS-TAIL-8).
    expect(await readOurs('dock', '[data-cg-part="0"]', (node) => (node.focus(), true))).toBe(true);
    await browser.keys(Key.Enter);
    await dockIs((d) => (d.result?.inserted ?? 0) >= 1, 'the first part inserted under the mark');
    await browser.waitUntil(async () => ((await browser.execute((field: string) => document.querySelector<HTMLTextAreaElement>(field)?.value ?? '', FANSLY_MAIN.field)) ?? '').length > 0, {
      timeout: 5_000,
      timeoutMsg: 'the part did not reach Fansly’s field',
    });

    // The hub holds the page's window as the page has it: every id counted, the deletion unknown to it — no mark.
    await seed(asked.window.map((entry) => ({ id: entry.id, sender: entry.dir })));
    await regenerate();
    await browser.waitUntil(async () => !(await oursExists('dock', '.cg-stale')), { timeout: 10_000, timeoutMsg: `a fresh Reply still marked: «${await markText()}»` });

    // The message the page deleted is still in what the hub serves: the context is stale.
    const withDeleted = [...asked.window.map((entry) => ({ id: entry.id, sender: entry.dir })), { id: deleted, sender: 'fan' as const }].sort((a, b) => (a.id.length - b.id.length) || a.id.localeCompare(b.id));
    await seed(withDeleted);
    await regenerate();
    await waitOursText('dock', 'Контекст устарел: ответ учитывает сообщение, удалённое из чата.', 'the mark of a stale context', { selector: '.cg-stale__t' });
    await callFansly('setTheme', 'dark');
    await waitForReport((now) => now.dock?.scheme === 'dark', 'the dock in the dark theme');
    await shootStand('suite-fansly-ids-mark-deleted-served-dark');
    await callFansly('setTheme', 'bright');
  });
});


// P9e uses only the stand's loopback API, never a live site. The first row's group is deliberately absent from
// the hub's ranking: the archive still knows the pair, as happens while one projection catches up with another.
describe('Spenders on Fansly (R20 P9e)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  const C = { group: String(810000000000000000n + 40n * 13n + 1n), fan: String(920000000000000000n + 40n * 29n + 3n) };
  const seeds = [
    { fanRef: B.fan, displayName: 'Hub Birch', conversationRef: null, lifetimeUsd: 900, windowUsd: 100 },
    { fanRef: C.fan, displayName: 'Stand Fan 41', conversationRef: null, lifetimeUsd: 800, windowUsd: 80 },
    { fanRef: STRANGER, displayName: 'Unknown fan', conversationRef: null, lifetimeUsd: 700, windowUsd: 70 },
  ];
  const show = async (name: string): Promise<void> => {
    await leaveField();
    await browser.keys([...PANEL, 'm']);
    await waitOursText('modal', name, 'the Spenders ranking from the hub', { timeout: 20_000, selector: '[aria-label="Доска Spenders"]' });
    await pressOurs('modal', '[data-cg-key^="fan:"]', new RegExp(`^${name}`));
    await waitOursText('modal', name, 'the selected preview', { selector: '.cg-pv' });
  };
  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    await hub().command({ op: 'spenderFans', fans: seeds });
    await hub().command({ op: 'config', patch: { spendersTotal: 3 } });
    await startFanslyShift(hub(), { path: `/messages/${A.group}`, viewport: { width: 1440, height: 900 } });
    await openChat(B.group, B.fan); // The person's earlier visit puts Birch in the page's passive cache.
    await openChat(A.group, A.fan);
  });

  it('[SP-037] [SP-035] [FS-SPD-2] [SP-055] the passive cache supplies the group; Reply opens and inserts into that group, never sends; both themes without statistics', async function () {
    this.timeout(120_000);
    const mark = await fakeFansly().mark();
    const hubMark = await hub().mark();
    await show('Hub Birch');
    await browser.waitUntil(async () => (await callsOf(hub(), hubMark, ['clientConversationFeed'])).some((call) => call.fan === B.fan && call.conversation === B.group), { timeout: 15_000, timeoutMsg: 'the preview did not read Birch’s group from the hub archive' });
    await pressOurs('modal', '.cg-pv button', /^Reply/);
    await browser.waitUntil(() => oursExists('modal', '.cg-pvp'), { timeout: 30_000, timeoutMsg: 'Reply in the Spenders preview did not finish' });
    expect(await oursByText('modal', '.cg-pv button', /^Отправить$/)).toBeNull();
    expect(await oursExists('modal', '[data-cg-stats]')).toBe(false);
    expect((await callsOf(hub(), hubMark, ['clientSpenderStats', 'clientSpenderAwaitingReply']))).toEqual([]);
    const streams = await callsOf(hub(), hubMark, ['aiFeatureStream']);
    expect(streams.map(({ fan, conversation }) => [fan, conversation])).toEqual([[B.fan, B.group]]);
    expect(allServed(streams)).toEqual([]);
    mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
    for (const theme of ['bright', 'dark'] as const) {
      await callFansly('setTheme', theme);
      await waitForReport((report) => report.dock?.scheme === (theme === 'bright' ? 'light' : 'dark'), `the ${theme} theme`);
      await browser.pause(100);
      writeFileSync(join(E2E_EVIDENCE_DIR, `spenders-fansly-p9e-${theme}.png`), Buffer.from(await browser.takeScreenshot(), 'base64'));
    }
    expect(await fakeFansly().calls('ours', mark)).toEqual([]);
    await ours('modal', '.cg-pvp').click();
    await browser.keys(['Enter']);
    await browser.waitUntil(async () => (await route()).groupId === B.group && (await $(FANSLY_MAIN.field).getValue()).length > 0, { timeout: 25_000, timeoutMsg: '«Открыть и вставить» did not put the preview’s part into Birch’s composer' });
    expect(await oursExists('modal', '.cg-spw')).toBe(false);
    expect(await fakeFansly().calls('ours', mark)).toEqual([]);
  });

  it('[SP-041] one search on «Открыть чат», by displayName, opens the exact fan’s group; preview alone stays quiet', async () => {
    await openChat(A.group, A.fan);
    const mark = await fakeFansly().mark();
    await show('Stand Fan 41');
    expect(await fakeFansly().calls('ours', mark)).toEqual([]);
    await pressOurs('modal', '.cg-pv button', /^Открыть чат$/);
    await browser.waitUntil(async () => (await route()).groupId === C.group, { timeout: 20_000, timeoutMsg: 'the inbox search did not open the found group' });
    expect((await fakeFansly().calls('ours', mark)).map((entry) => [entry.method, entry.route, entry.status])).toEqual([['GET', 'messaging.groups', 200]]);
  });

  it('[SP-041] a successful empty search gets-or-creates once; no message or ack from us', async () => {
    await openChat(A.group, A.fan);
    const mark = await fakeFansly().mark();
    await show('Unknown fan');
    await pressOurs('modal', '.cg-pv button', /^Открыть чат$/);
    await browser.waitUntil(async () => (await route()).groupId !== A.group, { timeout: 20_000, timeoutMsg: 'the one get-or-create did not open a group' });
    expect((await route()).groupId).not.toBe(STRANGER);
    expect((await fakeFansly().calls('ours', mark)).map((entry) => [entry.method, entry.route, entry.status])).toEqual([['GET', 'messaging.groups', 200], ['POST', 'group.create', 200]]);
  });
});
