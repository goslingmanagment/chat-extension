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
// Spenders' own group resolution beyond the hub's rows is P9e, «Новые» P10c.
// And the start of the dock's Reply (R20 P8b1; FS-TAIL-1, FS-TAIL-6): MAIN's
// snapshot of the open chat is the start's proof, and the hub is asked about
// it — the window the page holds, the fan's newest ids first, what the page
// deleted, the texts, a count no smaller than the window.
// Nothing of ours asks the Fansly stand for anything.

import { $, browser, expect } from '@wdio/globals';

import type { HubRouteKey } from '@cg/contracts';

import type { FakeHubControlClient } from '../../src/fake-hub/control-client';
import type { FakeHubJournalEntry } from '../../src/fake-hub/types';
import { WORLD } from '../../src/scenarios/hub';
import { PANEL } from '../support/chat';
import { readReport, waitForReport } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift } from '../support/fansly-shift';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyStandServer } from '../support/fansly-stand';
import { focusTab } from '../support/focus';
import { useNetworkTrap } from '../support/network-trap';
import { ours, oursByText, oursExists, oursText, pressOurs, waitOursText } from '../support/ours';
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
});
