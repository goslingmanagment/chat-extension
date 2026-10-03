// What the tab keeps and how it follows the background, under the things
// that go wrong in a long shift: starts that race, events that arrive before
// their answer, a missing batch, a run taken over mid-stream, a port that
// came back with a read that failed, answers that arrive after the sign-in
// they belonged to is gone — and the caps of everything the tab holds.

import { describe, expect, it } from 'vitest';

import { OP_LIMITS, STORAGE_LIMITS, chatKeyOf, type AiQuotaSnapshot, type CoachVM, type OpView, type RecapBody } from '@cg/contracts';
import { CHAT_UI_MAX, RECAP_UI_CHATS_MAX, RESYNC_RETRY_MS, WATCHED_CHATS_MAX, sameView } from '@cg/core/application/ai';
import { RECAP_SLOT_LIMITS } from '@cg/core/domain/recap';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, HOST_IDS, hostAccount, memory, openChat, previewChat, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_ON, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { OTHER_TAB, TAB, settingsWithPersona } from './support/ai-background';
import { delta, doneStep, readyHarness, type Harness, type HarnessOptions, type HarnessParts } from './support/ai-harness';
import { NOW_MS, WORLD, session, uuid } from './support/world';

function parts(): HarnessParts & { readonly fake: FakeHostPort } {
  const fake = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] });
  return {
    fake,
    baseHost: fake,
    memory,
    catalog: createFakeCatalog(ctxOf({ now: NOW_MS })),
    bootstrap: BOOTSTRAP_PILOT_ON,
    resolve: resolveHubErrorReference,
    meta: (feature) => meta(feature as Parameters<typeof meta>[0]),
  };
}

const start = (options: HarnessOptions = {}): Promise<Harness> => readyHarness(parts(), options);

const windowOf = (chat: typeof openChat): (typeof memory.chatWindows)[number] => ({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), chat });

/** Opens a chat the stand has no window for yet. */
async function visit(h: Harness, chat: typeof openChat): Promise<void> {
  h.host.setWindow(windowOf(chat), chat);
  h.host.openChat(chat);
  await h.settle();
}

/** The private collections of the tab, by name: only their sizes are looked at. */
const sizeOf = (owner: object, field: string): number => (owner as unknown as Record<string, { readonly size: number }>)[field]?.size ?? -1;

describe('op store: starts that race', () => {
  it('[AI-127] a double click on Generate is one generation: one «started», one «noop», and the preview keeps streaming', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, delta('one ', 100), delta('two ', 100), delta('three', 100), doneStep] });
    const handle = h.dock().targetHandle as string;
    const click = { type: 'Generate', targetHandle: handle, feature: 'reply', options: {} } as const;
    const receipts = await Promise.all([h.dispatch(click), h.dispatch(click)]);
    const opId = (receipts[0] as { opId: string }).opId;
    expect(receipts).toEqual([
      { ok: true, type: 'Generate', outcome: 'started', opId },
      { ok: true, type: 'Generate', outcome: 'noop', opId },
    ]);
    expect(h.bg.hub.streams).toHaveLength(1);
    expect(h.bg.scheduler.active()).toHaveLength(1);
    await h.clock.advance(200 + OP_LIMITS.updateBatchMs);
    // No batch was taken for a gap: the mirror is whole and the preview moves.
    expect(h.ai.workspace.ops.get(opId)).toMatchObject({ own: true, desynced: false });
    expect(h.dock().result).toMatchObject({ state: 'streaming', streamText: 'one two' });
    await h.finish();
    expect(h.dock().result?.parts?.map((part) => part.text)).toEqual(['one two three']);
    expect(h.ai.workspace.ops.all()).toHaveLength(1);
  });

  it('events that arrive before the answer to `op.start` — the terminal view included — are replayed', async () => {
    const h = await start();
    h.script(h.streamOf('fast-reply', ['came ', 'early']));
    h.bg.slow.add('op.start');
    const handle = h.dock().targetHandle as string;
    const pending = h.dispatch({ type: 'Generate', targetHandle: handle, feature: 'reply', options: {} });
    // The whole stream — batches and `op.done` — reaches the tab while the answer is still on its way.
    await h.finish();
    expect(h.bg.scheduler.active()).toHaveLength(0);
    expect(h.ai.workspace.ops.all()).toEqual([]);
    h.bg.slow.clear();
    h.bg.release();
    const receipt = await pending;
    expect(receipt).toMatchObject({ ok: true, outcome: 'started' });
    expect(h.dock().result).toMatchObject({ state: 'done', opId: (receipt as { opId: string }).opId });
    expect(h.dock().result?.parts?.map((part) => part.text)).toEqual(['came early']);
  });

  it('a missing batch freezes the preview until the terminal view; the result is whole', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, delta('first ', 100), delta('second', 1_000), doneStep] });
    const receipt = await h.generate('reply');
    const opId = (receipt as { opId: string }).opId;
    await h.clock.advance(100);
    expect(h.dock().result?.streamText).toBe('first');
    const view = h.ai.workspace.ops.get(opId)?.view as OpView;
    // A batch far ahead of the next one: some were lost on the way.
    h.bg.emit(TAB, 'op.update', { opId, seq: 99, append: 'TEXT OF AN UNKNOWN PLACE', state: 'streaming', phase: view.phase });
    await h.settle();
    expect(h.ai.workspace.ops.get(opId)?.desynced).toBe(true);
    expect(h.dock().result?.streamText).toBe('first');
    await h.finish();
    expect(h.ai.workspace.ops.get(opId)).toMatchObject({ desynced: false, view: { state: 'done' } });
    expect(h.dock().result?.parts?.map((part) => part.text)).toEqual(['first second']);
  });

  it('a run that outlived its tab, taken over while the reads of it are still on their way: no gap, the preview goes on', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, delta('a ', 100), delta('b ', 100), delta('c ', 100), delta('d', 100), doneStep] });
    const first = await h.generate('reply');
    const opId = (first as { opId: string }).opId;
    await h.clock.advance(100);
    // The tab that started it is gone (a reload): the run goes on without an owner.
    h.bg.scheduler.detachTab(TAB);
    // The new tab's reads of the chat are slow: it does not know of the run when the person clicks.
    h.bg.held.add('op.list');
    const later = await readyHarness(parts(), { shared: { bg: h.bg, clock: h.clock, tab: OTHER_TAB } });
    expect(later.ai.workspace.ops.get(opId)).toBeNull();
    // The same click is the same request: the background attaches this tab to the run, and its batches come here
    // while the reads are still on their way.
    const pending = later.generate('reply');
    await later.clock.advance(100 + OP_LIMITS.updateBatchMs);
    expect(later.ai.workspace.ops.get(opId)).toBeNull();
    later.bg.held.clear();
    later.bg.release();
    expect(await pending).toMatchObject({ ok: true, outcome: 'noop', opId });
    expect(later.ai.workspace.ops.get(opId)).toMatchObject({ own: true, desynced: false });
    await later.clock.advance(100);
    // The next batch continued the count instead of being taken for a gap.
    expect(later.ai.workspace.ops.get(opId)).toMatchObject({ own: true, desynced: false, view: { state: 'streaming' } });
    expect(later.dock().result).toMatchObject({ state: 'streaming', streamText: 'a b c' });
    await later.finish();
    expect(later.dock().result?.parts?.map((part) => part.text)).toEqual(['a b c d']);
    expect(h.bg.hub.streams).toHaveLength(1);
  });
});

describe('op store: a port that came back', () => {
  it('a read of the background that failed is made once more after a moment, so a lost run does not keep spinning', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'stall' }] });
    const receipt = await h.generate('reply');
    const opId = (receipt as { opId: string }).opId;
    h.bg.setConnection('reconnecting');
    // The run ended while the port was down: its `op.done` reached nobody.
    h.bg.scheduler.cancel(opId);
    await h.settle();
    h.bg.opListErrors.push({ code: 'CG-RUNTIME-UNREACHABLE' });
    const lists = h.bg.callsOf('op.list').length;
    h.bg.setConnection('ready');
    await h.settle();
    expect(h.bg.callsOf('op.list')).toHaveLength(lists + 1);
    expect(h.dock().actions.reply.busy).toBe(true);
    await h.clock.advance(RESYNC_RETRY_MS);
    expect(h.bg.callsOf('op.list')).toHaveLength(lists + 2);
    expect(h.dock().actions.reply).toMatchObject({ busy: false, enabled: true });
    expect(h.ai.workspace.ops.get(opId)?.view.state).toBe('canceled');
    // Once: a second failure is not chased; nothing is started by any of this.
    await h.clock.advance(60_000);
    expect(h.bg.callsOf('op.list')).toHaveLength(lists + 2);
    expect(h.bg.callsOf('op.start')).toHaveLength(1);

    const twice = await start();
    twice.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'stall' }] });
    await twice.generate('reply');
    twice.bg.setConnection('lost');
    twice.bg.opListErrors.push({ code: 'CG-RUNTIME-UNREACHABLE' }, { code: 'CG-RUNTIME-UNREACHABLE' });
    const before = twice.bg.callsOf('op.list').length;
    twice.bg.setConnection('ready');
    await twice.clock.advance(60_000);
    expect(twice.bg.callsOf('op.list')).toHaveLength(before + 2);
  });
});

describe('what the tab keeps is bounded', () => {
  it('a result older than half an hour leaves the store, and what was kept for it goes along', async () => {
    const h = await start();
    h.script(h.streamOf('fast-reply', ['one [NEXT] two']));
    const receipt = await h.generate('reply', { split: true });
    await h.finish();
    const opId = (receipt as { opId: string }).opId;
    await h.dispatch({ type: 'InsertPart', operationId: opId, part: 0 });
    await h.dispatch({ type: 'ExpandResult', operationId: opId, expanded: true });
    h.ai.resultShown(opId);
    h.clipboard.fail = true;
    await h.dispatch({ type: 'Copy', artifactHandle: h.dock().result?.parts?.[1]?.copyHandle as string });
    const ws = h.ai.workspace;
    expect(ws.inserts.partState(opId, { index: 0 }).insert).toBe('done');
    expect(sizeOf(ws, 'copies')).toBe(1);
    await h.clock.advance(OP_LIMITS.resultTtlMs + 1);
    // The next read of a chat prunes.
    await visit(h, previewChat);
    expect(ws.ops.get(opId)).toBeNull();
    expect(ws.inserts.partState(opId, { index: 0 }).insert).toBe('idle');
    expect(ws.isExpanded(opId)).toBe(false);
    expect(sizeOf(ws, 'copies')).toBe(0);
    expect(sizeOf(ws, 'shown')).toBe(0);
    expect(sizeOf(ws.inserts, 'parts')).toBe(0);
    expect(sizeOf(ws.inserts, 'intents')).toBe(0);
    h.host.openChat(openChat);
    await h.settle();
    expect(h.dock().result).toBeNull();
  });

  it('a tab keeps at most its share of finished results: the oldest go first', async () => {
    const h = await start();
    h.script(h.streamOf('fast-reply', ['seed']));
    await h.generate('reply');
    await h.finish();
    const seed = h.ai.workspace.ops.all()[0]?.view as OpView;
    const many = Array.from({ length: STORAGE_LIMITS.resultsPerTab + 6 }, (_, n): OpView => ({ ...seed, opId: uuid(0x9000 + n), startedAt: seed.startedAt + 1 + n, endedAt: (seed.endedAt ?? seed.startedAt) + 1 + n }));
    h.bg.opList = { ops: many, truncated: false };
    await visit(h, previewChat);
    h.host.openChat(openChat);
    await h.settle();
    const kept = h.ai.workspace.ops.all();
    expect(kept).toHaveLength(STORAGE_LIMITS.resultsPerTab);
    // Newest first; the seed and the oldest of the many are gone.
    expect(kept[0]?.view.opId).toBe(uuid(0x9000 + STORAGE_LIMITS.resultsPerTab + 5));
    expect(h.ai.workspace.ops.get(seed.opId)).toBeNull();
    expect(h.ai.workspace.ops.get(uuid(0x9000))).toBeNull();
  });

  it('events of operations nobody claims do not pile up; neither do followed chats', async () => {
    const h = await start();
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, { kind: 'stall' }] });
    await h.generate('reply');
    const phase = (h.ai.workspace.ops.all()[0]?.view as OpView).phase;
    for (let n = 0; n < 40; n += 1) for (let seq = 1; seq <= 3; seq += 1) h.bg.emit(TAB, 'op.update', { opId: uuid(0x7000 + n), seq, append: 'x', state: 'streaming', phase });
    for (let seq = 1; seq <= 600; seq += 1) h.bg.emit(TAB, 'op.update', { opId: uuid(0x7fff), seq, append: 'x', state: 'streaming', phase });
    const early = (h.ai.workspace.ops as unknown as { early: Map<string, unknown[]> }).early;
    expect(early.size).toBeLessThanOrEqual(16);
    expect(Math.max(...[...early.values()].map((events) => events.length))).toBeLessThanOrEqual(400);

    await h.ai.command('cancel');
    await h.settle();
    for (let n = 0; n < WATCHED_CHATS_MAX + 10; n += 1) {
      await visit(h, { ...openChat, platformFanId: String(3000 + n) });
      // A tone chosen and taken back: the chat keeps nothing once it is left.
      const handle = h.dock().targetHandle as string;
      await h.dispatch({ type: 'SetTone', targetHandle: handle, tone: 'flirty' });
      await h.dispatch({ type: 'SetTone', targetHandle: handle, tone: 'flirty' });
    }
    expect(sizeOf(h.ai.workspace.ops, 'watched')).toBe(WATCHED_CHATS_MAX);
    // The page tail is kept for the open chat only; the per-chat state for the open chat and chats with a tone or a sheet.
    expect(sizeOf(h.ai.workspace, 'tails')).toBeLessThanOrEqual(1);
    expect(sizeOf(h.ai.workspace, 'chats')).toBe(1);
  });

  it('the page tail is text of the conversation: it is kept only while its chat is open, and a sign-out leaves none', async () => {
    const h = await start();
    // The fan's script (the language gate of a Coach draft) is read from the page of the open chat.
    h.ai.workspace.fanScript(chatKeyOf(openChat));
    await h.settle();
    expect(h.host.reads.tail).toBe(1);
    expect(sizeOf(h.ai.workspace, 'tails')).toBe(1);
    // A chat that is not open has no page to read: nothing is read and nothing is kept for it.
    expect(h.ai.workspace.fanScript(chatKeyOf(previewChat))).toBe('unknown');
    expect(h.host.reads.tail).toBe(1);
    expect(sizeOf(h.ai.workspace, 'tails')).toBe(1);
    await visit(h, previewChat);
    const tails = (h.ai.workspace as unknown as { tails: Map<string, unknown> }).tails;
    expect(tails.size).toBe(0);
    h.ai.workspace.fanScript(chatKeyOf(previewChat));
    await h.settle();
    expect([...tails.keys()]).toEqual([chatKeyOf(previewChat)]);
    h.bg.changeSession(null, 'sign-out');
    await h.settle();
    expect(tails.size).toBe(0);
  });

  it('recap copies, their dossier saves and the sheet state of old chats do not outlive their caps', async () => {
    const body = (n: number): RecapBody => ({
      generationRef: uuid(0xa000 + n),
      generatedAt: '2026-10-03T09:59:20.000Z',
      personaDefinitionId: WORLD.persona.definitionId,
      coverage: { transcriptCoverage: 'full-history', requestedCount: 3000, keptCount: 800 },
      text: `Recap ${n}`,
    });
    const h = await start();
    // The sheet of the first chat shows the short length; a visit elsewhere and back keeps that.
    await h.dispatch({ type: 'ShowRecap', length: 'short' });
    expect((h.ai.recap.getSnapshot({ of: 'recap.view' }) as { length: string }).length).toBe('short');
    await visit(h, previewChat);
    h.host.openChat(openChat);
    await h.settle();
    expect((h.ai.recap.getSnapshot({ of: 'recap.view' }) as { length: string }).length).toBe('short');
    const total = RECAP_SLOT_LIMITS.maxEntries + 15;
    for (let n = 0; n < total; n += 1) {
      h.bg.sharedRecaps = { full: body(n), short: null, fullSavedToProfile: false };
      h.bg.saveAnswers.push({ state: 'rejected', savedAt: null });
      await visit(h, { ...openChat, platformFanId: String(4000 + n) });
      await h.generate('recap');
      await h.settle();
    }
    const book = h.ai.workspace.recaps;
    // A sheet left open in each of them: the tab remembers a bounded number of chats.
    expect(total).toBeGreaterThan(CHAT_UI_MAX);
    expect(sizeOf(h.ai.workspace, 'chats')).toBe(CHAT_UI_MAX);
    expect(book.slots.size).toBeLessThanOrEqual(RECAP_SLOT_LIMITS.maxEntries);
    expect(sizeOf(book, 'owners')).toBe(book.slots.size);
    expect(sizeOf(book, 'saves')).toBeLessThanOrEqual(book.slots.size);
    expect(h.bg.callsOf('recap.save')).toHaveLength(total);
    // The Recap controller remembers the sheet of a bounded number of chats: the first one's is long forgotten.
    expect(total).toBeGreaterThan(RECAP_UI_CHATS_MAX);
    h.bg.sharedRecaps = { full: null, short: null, fullSavedToProfile: false };
    h.host.openChat(openChat);
    await h.settle();
    expect((h.ai.recap.getSnapshot({ of: 'recap.view' }) as { length: string }).length).toBe('full');
  });
});

describe('answers that arrive after their sign-in or their revision is gone', () => {
  it('a bootstrap of the old sign-in that arrives after a sign-out is dropped', async () => {
    const h = await start({ background: (bg) => bg.slow.add('bootstrap.get') });
    expect(h.ai.workspace.env.bootstrap.s).toBe('loading');
    h.bg.changeSession(null, 'sign-out');
    await h.settle();
    h.bg.slow.clear();
    h.bg.release();
    await h.settle();
    expect(h.ai.workspace.env.bootstrap.s).toBe('idle');
    expect(h.dock().status).toBe('not-signed-in');
  });

  it('a binding of the old sign-in that arrives after a new one is dropped', async () => {
    const h = await start();
    const env = h.ai.workspace.env;
    expect(env.binding(hostAccount).s).toBe('ready');
    let bindingChanges = 0;
    env.subscribe((change) => {
      if (change === 'binding') bindingChanges += 1;
    });
    // «Повторить» drops nothing that is ready; a new owner config resolves again — slowly.
    h.bg.slow.add('binding.resolve');
    h.bg.bootstrap = { ...BOOTSTRAP_PILOT_ON, configRevision: BOOTSTRAP_PILOT_ON.configRevision + 1 };
    h.bg.emit(null, 'bootstrap.changed', { configRevision: BOOTSTRAP_PILOT_ON.configRevision + 1, issuedAt: new Date(NOW_MS).toISOString() });
    await h.settle();
    expect(env.binding(hostAccount).s).toBe('loading');
    // The sign-in changes while that answer is on its way: it belongs to nobody now.
    h.bg.changeSession({ ...session, epoch: session.epoch + 2 }, 'sign-in');
    await h.settle();
    h.bg.slow.clear();
    h.bg.release();
    await h.settle();
    const binding = env.binding(hostAccount);
    expect(binding).toMatchObject({ s: 'ready', value: { loginEpoch: session.epoch + 2 } });
    // Only the answer asked under the new sign-in was taken.
    expect(bindingChanges).toBe(1);
    expect(h.dock().status).toBe('ready');
  });

  it('a quota of the old sign-in that arrives after a sign-out is dropped', async () => {
    const quota: AiQuotaSnapshot = { pageId: WORLD.pages.one.pageId, remainingRequestsToday: 3, remainingMicroUsdToday: null, resetsAt: '2026-10-04T00:00:00.000Z', observedAt: '2026-10-03T10:00:00.000Z' };
    const h = await start({
      background: (bg) => {
        bg.scheduler.quota = () => quota;
        bg.slow.add('quota.get');
      },
    });
    expect(h.bg.callsOf('quota.get')).toHaveLength(1);
    expect(h.dock().quota).toBeNull();
    h.bg.changeSession(null, 'sign-out');
    await h.settle();
    h.bg.slow.clear();
    h.bg.release();
    await h.settle();
    expect(h.ai.workspace.env.quota(WORLD.pages.one.pageId)).toBeNull();

    // In time it is taken.
    const inTime = await start({ background: (bg) => (bg.scheduler.quota = () => quota) });
    await inTime.settle();
    expect(inTime.dock().quota).toEqual({ remaining: 3, low: true, resetsAt: '2026-10-04T00:00:00.000Z' });
  });

  it('shared recaps read for the old sign-in that arrive after a sign-out are dropped', async () => {
    const full: RecapBody = { generationRef: uuid(0x700), generatedAt: '2026-10-03T09:59:20.000Z', personaDefinitionId: WORLD.persona.definitionId, coverage: { transcriptCoverage: 'full-history', requestedCount: 3000, keptCount: 800 }, text: 'Рекап прежнего входа.' };
    const h = await start({ background: (bg) => (bg.sharedRecaps = { full, short: null, fullSavedToProfile: true }) });
    h.bg.slow.add('recap.read');
    await h.generate('recap');
    await h.settle();
    expect(h.bg.callsOf('recap.read')).toHaveLength(1);
    h.bg.changeSession(null, 'sign-out');
    await h.settle();
    h.bg.slow.clear();
    h.bg.release();
    await h.settle();
    expect(h.ai.workspace.recaps.slots.size).toBe(0);
    expect(h.bg.callsOf('recap.save')).toEqual([]);
  });

  it('owner switches of an older config revision do not undo a newer one', async () => {
    const h = await start();
    const revision = BOOTSTRAP_PILOT_ON.configRevision;
    const flags = { ...BOOTSTRAP_PILOT_ON.flags };
    h.bg.emit(null, 'flags.changed', { flags: { ...flags, review: false }, configRevision: revision + 2 });
    await h.settle();
    expect(h.dock().actions.review.reason?.id).toBe('feature-disabled');
    // A late event of the revision before: ignored.
    h.bg.emit(null, 'flags.changed', { flags, configRevision: revision + 1 });
    await h.settle();
    expect(h.dock().actions.review.reason?.id).toBe('feature-disabled');
    h.bg.emit(null, 'flags.changed', { flags, configRevision: revision + 3 });
    await h.settle();
    expect(h.dock().actions.review.enabled).toBe(true);
  });

  it('settings read before a change do not overwrite the change that arrived as an event', async () => {
    const h = await start();
    expect(h.dock().hints).toBe(true);
    h.bg.slow.add('settings.get');
    await h.dispatch({ type: 'ReloadView', selector: { of: 'dock' } });
    h.bg.changeSettings({ ui: { hints: false } });
    await h.settle();
    expect(h.dock().hints).toBe(false);
    h.bg.slow.clear();
    h.bg.release();
    await h.settle();
    expect(h.dock().hints).toBe(false);
    expect(h.ai.workspace.env.settings?.revision).toBe(2);
  });

  it('a chat switch while the page is read for a start: the click was for the chat that is gone', async () => {
    const h = await start({ settings: settingsWithPersona() });
    h.bg.held.add('token.issue');
    const handle = h.dock().targetHandle as string;
    const pending = h.dispatch({ type: 'Generate', targetHandle: handle, feature: 'reply', options: {} });
    await h.settle();
    h.host.setWindow(windowOf(previewChat), previewChat);
    h.host.openChat(previewChat);
    h.bg.held.clear();
    h.bg.release();
    expect(await pending).toMatchObject({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(h.bg.callsOf('op.start')).toEqual([]);
    expect(HOST_IDS.fan).not.toBe(previewChat.platformFanId);
  });
});

describe('the cost of a change (§11)', () => {
  it('a keystroke that changes nothing a view reads rebuilds no view; the first and the last one do', async () => {
    const h = await start();
    h.mount({ of: 'coach' });
    await h.settle();
    const ws = h.ai.workspace;
    const empty = ws.version;
    h.host.type('h');
    // Empty → the person's draft: Fix and «приложить мой ответ» depend on it.
    expect(ws.version).toBe(empty + 1);
    await h.settle();
    expect(h.dock().actions.fix.enabled).toBe(true);
    const typing = ws.version;
    for (const text of ['he', 'hey', 'hey ', 'hey y', 'hey yo', 'hey you']) h.host.type(text);
    await h.settle();
    expect(ws.version).toBe(typing);
    // What a click reads is still the field as it is now.
    h.script(h.streamOf('improve-draft', ['Hey you']));
    await h.generate('fix');
    expect((h.bg.callsOf('op.start')[0] as { draft: { text: string } }).draft.text).toBe('hey you');
    await h.finish();
    const before = ws.version;
    h.host.type('');
    expect(ws.version).toBe(before + 1);
    await h.settle();
    expect(h.dock().actions.fix.enabled).toBe(false);
  });

  it('views are compared as data, and the same object is equal without a walk', () => {
    const part = { text: 'hey', insert: 'idle', error: null };
    expect(sameView({ a: 1, parts: [part], when: null }, { a: 1, parts: [{ ...part }], when: null })).toBe(true);
    expect(sameView({ a: 1, parts: [part] }, { a: 1, parts: [{ ...part, insert: 'done' }] })).toBe(false);
    expect(sameView({ a: 1, parts: [part] }, { a: 1, parts: [part, part] })).toBe(false);
    expect(sameView({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameView({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    // A key holding `undefined` is absent, as it is on the wire.
    expect(sameView({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameView({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(sameView({ a: null }, { a: undefined })).toBe(false);
    expect(sameView([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(sameView('a', 'a')).toBe(true);
    expect(sameView(0, false)).toBe(false);
    expect(sameView(null, {})).toBe(false);
    // A getter that would throw is never read when both sides are the very same object.
    const trap = Object.defineProperty({}, 'x', { enumerable: true, get: () => { throw new Error('walked'); } });
    expect(sameView({ big: trap }, { big: trap })).toBe(true);
  });

  it('a finished Coach exchange is built once: an unrelated change hands the same object out, a change of its own parts a new one', async () => {
    const h = await start();
    h.mount({ of: 'coach' });
    const fence = (body: string): string => ['```draft', body, '```'].join('\n');
    const coach = (): CoachVM => h.ai.coach.getSnapshot({ of: 'coach' }) as CoachVM;
    for (const question of ['first', 'second']) {
      h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat') }, delta(['Совет.', fence('hey you [NEXT] how are you')].join('\n')), doneStep] });
      await h.generate('coach', { question });
      await h.finish();
    }
    const [first, second] = coach().turns;
    // A stream in the dock, a redraw, typing: the dialog is not rebuilt.
    h.script({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply') }, delta('a', 100), delta('b', 100), doneStep] });
    await h.generate('reply');
    await h.clock.advance(100);
    h.host.type('typing');
    await h.settle();
    expect(coach().turns[0]).toBe(first);
    expect(coach().turns[1]).toBe(second);
    await h.finish();
    // A part of the second answer is copied: that exchange reads differently, the first is the same object.
    await h.dispatch({ type: 'Copy', artifactHandle: second?.answer?.drafts[0]?.parts[1]?.copyHandle as string });
    expect(coach().turns[0]).toBe(first);
    expect(coach().turns[1]).not.toBe(second);
    expect(coach().turns[1]?.answer?.drafts[0]?.parts[1]?.copy).toBe('done');
    // Copy-only mode changes every part.
    h.host.setComposer({ hidden: true });
    await h.settle();
    expect(coach().turns[0]).not.toBe(first);
    expect(coach().turns[0]?.answer?.drafts[0]?.parts[0]?.insertBlocked?.id).toBe('fan-blocked');
  });
});

