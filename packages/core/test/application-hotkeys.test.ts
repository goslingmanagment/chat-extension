// The early dispatcher and the hotkey runner (architecture.md §9.1): what the
// tab does with a key before ChatSpace sees it, and which UiAction a command
// becomes. The DOM is faked here (core has none); the same dispatcher runs
// against a real document and closed shadow roots in
// packages/testing/src/input/dispatcher.dom.test.ts and in Firefox in
// packages/testing/e2e/specs/hotkeys.e2e.ts. Test titles carry the parity rows.

import { type UiAction, type UiActionType } from '@cg/contracts';
import { KEPT_KEY_TTL_MS, createEarlyKeyDispatcher, createHotkeyRunner, type EarlyNotice } from '@cg/core/application/hotkeys';
import { createCauseHint, createOverlayState } from '@cg/core/application/navigation';
import { DISPATCHER_COMMAND_IDS, createActionCatalog, type FixKeyState, type HotkeyPlatform, type KeyCommand, type OverlayKind, type RouteKind } from '@cg/core/domain/hotkeys';
import { createI18n } from '@cg/core/domain/i18n';
import { FakeToasts, coach, ctxOf, dock, handles, FANS, preview, recapPicker, recapView, result, review, uuid, views } from '@cg/testing/app-client';
import { describe, expect, it } from 'vitest';

import { FakeClock, settle } from './support/clock';
import { FakeKey, FakeOwnership, FakeWindow, RecordingSink, StubClient } from './support/keys';

const NOW = Date.parse('2026-10-03T10:00:00.000Z');
const CHAT = '/accounts/1001/chats/2002';

interface Rig {
  readonly win: FakeWindow;
  readonly doc: FakeWindow;
  readonly own: FakeOwnership;
  readonly clock: FakeClock;
  readonly sink: RecordingSink;
  readonly notices: EarlyNotice[];
  /** Keys that reached ChatSpace's own capture listener on `window` (registered after ours). */
  readonly native: FakeKey[];
  /** `focused` — `document.hasFocus()`: false while the focus is in another window, another app or the browser's own UI. */
  readonly page: { route: RouteKind; epoch: string; overlays: OverlayKind[]; sheet: boolean; hidden: boolean; focused: boolean; fix: FixKeyState };
  readonly dispatcher: ReturnType<typeof createEarlyKeyDispatcher>;
  readonly platform: HotkeyPlatform;
  readonly handlerMs: number[];
}

function rig(platform: HotkeyPlatform = 'mac', connect = true, onEarly?: (notice: EarlyNotice) => void): Rig {
  const win = new FakeWindow();
  const doc = new FakeWindow();
  const own = new FakeOwnership();
  const clock = new FakeClock(NOW);
  const sink = new RecordingSink();
  const notices: EarlyNotice[] = [];
  const native: FakeKey[] = [];
  const handlerMs: number[] = [];
  const page = { route: 'chat' as RouteKind, epoch: CHAT, overlays: [] as OverlayKind[], sheet: false, hidden: false, focused: true, fix: null as FixKeyState };
  let tick = 0;
  const dispatcher = createEarlyKeyDispatcher({
    platform,
    client: 'extension',
    window: win,
    document: { source: doc, hidden: () => page.hidden, focused: () => page.focused },
    ownership: own,
    state: { route: () => ({ kind: page.route, epoch: page.epoch }), overlays: () => page.overlays, dockSheet: () => page.sheet, fix: () => page.fix },
    timers: clock,
    now: () => clock.now(),
    perfNow: () => (tick += 0.25),
    onHandlerMs: (ms) => handlerMs.push(ms),
    sampleEvery: 2,
    onEarly: (notice) => {
      notices.push(notice);
      onEarly?.(notice);
    },
  });
  // ChatSpace registers its global listener when its layout mounts: after ours, on the same `window`, in capture.
  win.addEventListener('keydown', (event) => native.push(event as FakeKey), { capture: true });
  if (connect) dispatcher.connect(sink);
  return { win, doc, own, clock, sink, notices, native, page, dispatcher, platform, handlerMs };
}

type Mods = ConstructorParameters<typeof FakeKey>[1];
const primaryMods = (platform: HotkeyPlatform): Mods => (platform === 'mac' ? { metaKey: true } : { ctrlKey: true });
const primaryKey = (platform: HotkeyPlatform, down: boolean): FakeKey =>
  platform === 'mac' ? new FakeKey('MetaLeft', { key: 'Meta', metaKey: down }) : new FakeKey('ControlLeft', { key: 'Control', ctrlKey: down });

/** A key by itself. */
function tap(r: Rig, code: string, mods: Mods = {}): FakeKey {
  const event = new FakeKey(code, mods);
  r.win.fire('keydown', event);
  r.win.fire('keyup', new FakeKey(code, { ...mods, isTrusted: mods?.isTrusted ?? true }));
  return event;
}

/** ⌘/Ctrl pressed freshly, the key under it, both released: what a person does. */
function chord(r: Rig, code: string, mods: Mods = {}): FakeKey {
  r.win.fire('keydown', primaryKey(r.platform, true));
  const event = new FakeKey(code, { ...primaryMods(r.platform), ...mods });
  r.win.fire('keydown', event);
  r.win.fire('keyup', new FakeKey(code, { ...primaryMods(r.platform), ...mods }));
  r.win.fire('keyup', primaryKey(r.platform, false));
  return event;
}

const panel = (platform: HotkeyPlatform): Mods => (platform === 'mac' ? { shiftKey: true } : { altKey: true });

describe('the early dispatcher', () => {
  it.each(['mac', 'win'] as const)('[HK-026] %s: a key of ours is taken synchronously — preventDefault and stopImmediatePropagation before ChatSpace\'s listener', (platform) => {
    const r = rig(platform);
    // ⌘E / Ctrl+E is TipTap's inline code, ⌘I its italic, ⌘P the browser's print, Ctrl+Alt+S OnlyMonster's translator.
    for (const [code, mods, id] of [
      ['KeyE', {}, 'reply@dock'],
      ['KeyI', {}, 'fix@dock'],
      ['KeyG', {}, 'hi@dock'],
      ['KeyP', {}, 'ping@dock'],
      ['KeyS', panel(platform), 'recap@dock'],
      ['KeyK', {}, 'palette@global'],
    ] as const) {
      const event = chord(r, code, mods);
      expect([code, event.defaultPrevented, event.stopped]).toEqual([code, true, true]);
      expect(r.sink.ids[r.sink.ids.length - 1]).toBe(id);
    }
    // ChatSpace's listener saw the modifiers go down and nothing else.
    expect(r.native.filter((event) => event.key !== 'Meta' && event.key !== 'Control')).toEqual([]);
    expect(r.dispatcher.stats()).toMatchObject({ claimed: 6, isolated: 0, untrusted: 0 });
  });

  it('[HK-026] negative: a key that is not ours is never touched — not prevented, not stopped, ChatSpace gets it', () => {
    const r = rig('mac');
    r.own.kind = 'composer';
    const foreign = [
      tap(r, 'KeyA'),
      tap(r, 'Enter'),
      tap(r, 'Escape'),
      tap(r, 'KeyS', { altKey: true }),
      tap(r, 'Tab', { ctrlKey: true }),
      chord(r, 'KeyB'),
      chord(r, 'KeyC'),
      chord(r, 'KeyV'),
      chord(r, 'KeyZ'),
      chord(r, 'Enter'),
      tap(r, 'KeyJ'),
      tap(r, 'KeyK'),
      tap(r, 'BracketRight', { key: ']' }),
      tap(r, 'Slash', { shiftKey: true, key: '?' }),
      // ⌥U is a dead key and ⌥3 a character on macOS: in a field the fallbacks are typing.
      tap(r, 'KeyU', { altKey: true }),
      tap(r, 'Digit3', { altKey: true }),
    ];
    for (const event of foreign) expect([event.code, event.defaultPrevented, event.stopped]).toEqual([event.code, false, false]);
    for (const event of foreign) expect(r.native).toContain(event);
    expect(r.sink.ran).toEqual([]);
    expect(r.sink.refused).toEqual([]);
    expect(r.own.delivered).toEqual([]);
    // Outside a chat the scheme's combinations are the browser's again.
    r.page.route = 'other';
    r.own.kind = 'page';
    const outside = chord(r, 'KeyP');
    expect([outside.defaultPrevented, outside.stopped]).toEqual([false, false]);
    expect(r.sink.ran).toEqual([]);
  });

  it('a synthetic event of the page never starts anything and never moves the engine (§14)', () => {
    const r = rig('mac');
    r.win.fire('keydown', new FakeKey('MetaLeft', { key: 'Meta', metaKey: true, isTrusted: false }));
    const forged = new FakeKey('KeyE', { metaKey: true, isTrusted: false });
    r.win.fire('keydown', forged);
    const esc = new FakeKey('Escape', { isTrusted: false });
    r.page.overlays = ['palette'];
    r.win.fire('keydown', esc);
    expect([forged.defaultPrevented, forged.stopped, esc.stopped]).toEqual([false, false, false]);
    expect(r.sink.ran).toEqual([]);
    expect(r.dispatcher.stats().untrusted).toBe(3);
    // A forged ⌘ did not arm the fresh-press guard: a real E under no real ⌘ press is a roll-over, swallowed.
    r.page.overlays = [];
    const real = new FakeKey('KeyE', { metaKey: true });
    r.win.fire('keydown', real);
    expect(real.stopped).toBe(true);
    expect(r.sink.ran).toEqual([]);
  });

  it('[HK-025] the kept key runs only in the chat it was pressed in, only the newest one, and only while fresh', () => {
    const moved = rig('mac', false);
    chord(moved, 'KeyE');
    moved.page.epoch = '/accounts/1001/chats/2003';
    moved.dispatcher.connect(moved.sink);
    expect(moved.sink.ran).toEqual([]);
    expect(moved.notices[moved.notices.length - 1]).toEqual({ kind: 'dropped', command: 'reply', why: 'route-changed' });

    const newest = rig('mac', false);
    chord(newest, 'KeyE');
    chord(newest, 'KeyP');
    newest.dispatcher.connect(newest.sink);
    expect(newest.sink.ids).toEqual(['ping@dock']);
    expect(newest.notices).toContainEqual({ kind: 'dropped', command: 'reply', why: 'replaced' });

    const late = rig('mac', false);
    chord(late, 'KeyE');
    late.clock.t += KEPT_KEY_TTL_MS + 1;
    late.dispatcher.connect(late.sink);
    expect(late.sink.ran).toEqual([]);
    expect(late.notices[late.notices.length - 1]).toEqual({ kind: 'dropped', command: 'reply', why: 'expired' });
    expect(late.dispatcher.stats()).toMatchObject({ queued: 1, dropped: 1 });
  });

  it.each(['mac', 'win'] as const)('[X58] %s: ⌘↵ / Ctrl+Enter in the message field is the site\'s while no Fix waits; ours while one does — it puts the Fix in, or, while the Fix is written, keeps the draft from the site', (platform) => {
    const r = rig(platform);
    r.own.kind = 'composer';
    // No Fix: ChatSpace sends (or breaks the line), Fansly sends — not touched.
    const site = chord(r, 'Enter');
    expect([site.defaultPrevented, site.stopped, r.native.includes(site)]).toEqual([false, false, true]);
    // The Fix is on screen: the key puts it into the field, and the site never sees the key.
    r.page.fix = 'ready';
    const apply = chord(r, 'Enter');
    expect([apply.defaultPrevented, apply.stopped, r.native.includes(apply)]).toEqual([true, true, false]);
    expect(r.sink.ids).toEqual(['apply-fix@dock']);
    // The keypad's Enter is the same key.
    chord(r, 'NumpadEnter');
    expect(r.sink.ids).toEqual(['apply-fix@dock', 'apply-fix@dock']);
    // Being written: the draft under it does not go to the fan by this key — taken, and the reason said.
    r.page.fix = 'running';
    const early = chord(r, 'Enter');
    expect([early.defaultPrevented, r.native.includes(early)]).toEqual([true, false]);
    expect(r.sink.refused).toEqual([{ command: 'apply-fix', refusal: 'fix-running' }]);
    // Plain Enter and Shift+Enter stay the site's whatever waits.
    r.page.fix = 'ready';
    const plain = tap(r, 'Enter');
    const shifted = chord(r, 'Enter', { shiftKey: true });
    expect([plain.defaultPrevented, shifted.defaultPrevented]).toEqual([false, false]);
    // Another field of the site, a window of ours, no chat: not ours.
    r.own.kind = 'field';
    expect(chord(r, 'Enter').defaultPrevented).toBe(false);
    r.own.kind = 'composer';
    r.page.overlays = ['spenders'];
    expect(chord(r, 'Enter').defaultPrevented).toBe(false);
    r.page.overlays = [];
    r.page.route = 'account';
    expect(chord(r, 'Enter').defaultPrevented).toBe(false);
    expect(r.sink.ids).toEqual(['apply-fix@dock', 'apply-fix@dock']);
  });

  it('[X58] [HK-019] a held key we took stays ours until it goes up: the Fix went into the field, and the repeats of ⌘↵ never reach the site, which would send it', () => {
    const r = rig('mac');
    r.own.kind = 'composer';
    r.page.fix = 'ready';
    r.win.fire('keydown', primaryKey('mac', true));
    r.win.fire('keydown', new FakeKey('Enter', { metaKey: true }));
    // The replacement landed: no Fix waits any more, and the key is still down.
    r.page.fix = null;
    const repeats = [1, 2, 3].map(() => new FakeKey('Enter', { metaKey: true, repeat: true }));
    for (const event of repeats) r.win.fire('keydown', event);
    expect(repeats.map((event) => [event.defaultPrevented, event.stopped, r.native.includes(event)])).toEqual([
      [true, true, false],
      [true, true, false],
      [true, true, false],
    ]);
    expect(r.sink.ids).toEqual(['apply-fix@dock']);
    // It went up: the next press is the person's own, and it is the site's (send the fixed text).
    r.win.fire('keyup', new FakeKey('Enter', { metaKey: true }));
    const next = new FakeKey('Enter', { metaKey: true });
    r.win.fire('keydown', next);
    expect([next.defaultPrevented, r.native.includes(next)]).toEqual([false, true]);
    // A blur forgets what was held: a repeat after it is nobody's of ours.
    r.page.fix = 'ready';
    r.win.fire('keydown', new FakeKey('Enter', { metaKey: true }));
    r.win.fire('blur');
    r.page.fix = null;
    const after = new FakeKey('Enter', { metaKey: true, repeat: true });
    r.win.fire('keydown', after);
    expect(after.defaultPrevented).toBe(false);
  });
});

// ── the runner ──

const CTX = ctxOf({ platform: 'mac' });

function runnerRig(dockPatch: Parameters<typeof dock>[2] = {}, status: Parameters<typeof dock>[1] = 'ready') {
  const client = new StubClient();
  client.set({ of: 'dock' }, dock(CTX, status, dockPatch));
  client.set({ of: 'recap.picker' }, recapPicker(CTX, views.ready()));
  client.set({ of: 'recap.view' }, recapView(CTX, views.ready(), 'short'));
  client.set({ of: 'review' }, review(CTX, views.ready()));
  client.set({ of: 'coach' }, coach(CTX, views.ready(), []));
  const toasts = new FakeToasts();
  const overlays = createOverlayState();
  const cause = createCauseHint();
  const sheet: boolean[] = [];
  const fixes: FixKeyState[] = [];
  const i18n = createI18n({ language: 'ru', now: () => CTX.now });
  /** The operation that runs in the open chat, shown or not. */
  const here = { opId: null as string | null };
  const runner = createHotkeyRunner({ client, catalog: createActionCatalog('mac'), i18n, toasts, overlays, cause, onDockSheet: (open) => sheet.push(open), onFix: (fix) => fixes.push(fix), runningHere: () => here.opId });
  const run = async (id: KeyCommand['id'], target: KeyCommand['target'] = 'dock', slot: number | null = null): Promise<UiAction | undefined> => {
    const before = client.dispatched.length;
    runner.run({ id, slot, target });
    await settle();
    return client.dispatched[before];
  };
  return { client, toasts, overlays, cause, sheet, fixes, runner, run, i18n, here };
}

describe('the hotkey runner', () => {
  it('[X68] ⌘. stops a Fix that runs with no sheet; over a finished answer its own key is its «Ещё раз» — a new answer, not the cached one', async () => {
    const r = runnerRig();
    expect(await r.run('cancel')).toBeUndefined();
    r.here.opId = uuid(0x71);
    expect(await r.run('cancel')).toEqual({ type: 'CancelGeneration', operationId: uuid(0x71) });

    const opId = uuid(0x72);
    const shown = runnerRig({ result: result(CTX, { opId, feature: 'reply', state: 'done' }) });
    expect(await shown.run('reply')).toEqual({ type: 'Regenerate', operationId: opId });
    // Another button's key starts its own feature.
    expect((await shown.run('ping'))?.type).toBe('Generate');
    // Where the sheet has no «Ещё раз» (a board's result, a Fix already in the field), the key starts as the button does.
    const replaced = runnerRig({ result: result(CTX, { opId, feature: 'reply', state: 'done', canRegenerate: false }) });
    expect((await replaced.run('reply'))?.type).toBe('Generate');
  });


  it('[HK-042] in a preview the same keys generate for the preview\'s fan and ⌘. cancels there; no key ever sends or inserts', async () => {
    const r = runnerRig();
    r.overlays.set('spenders', true);
    r.overlays.setPreview('spenders');
    const opId = uuid(0x61);
    r.client.set({ of: 'preview', from: 'spenders' }, preview(CTX, 'spenders', views.ready()));
    const handle = handles.spenders(FANS.hubert);
    for (const id of ['reply', 'fix', 'hi', 'ping'] as const) expect(await r.run(id, 'preview')).toEqual({ type: 'Generate', targetHandle: handle, feature: id, options: {} });
    expect(await r.run('tone', 'preview')).toEqual({ type: 'SetTone', targetHandle: handle, tone: 'casual' });
    r.client.set({ of: 'preview', from: 'spenders' }, preview(CTX, 'spenders', views.ready(), { result: result(CTX, { opId, feature: 'reply', state: 'streaming', surface: 'preview' }) }));
    expect(await r.run('cancel', 'preview')).toEqual({ type: 'CancelGeneration', operationId: opId });
    // «Новые» has only Hi: Reply there says why not.
    r.overlays.setPreview('newcomers');
    r.client.set({ of: 'preview', from: 'newcomers' }, preview(CTX, 'newcomers', views.ready()));
    expect(await r.run('reply', 'preview')).toBeUndefined();
    expect(r.toasts.shown[0]?.toast.code).toBe('CG-FEATURE-DISABLED');

    // Every command the dispatcher can hand over, on every target, with results on screen: never a send, never an insert.
    const forbidden: readonly UiActionType[] = ['SendPart', 'InsertPart', 'OpenAndInsertPart', 'ReplaceMyDraft', 'AnswerConfirm'];
    const all = runnerRig({ result: result(CTX, { opId, feature: 'reply', state: 'done' }) });
    all.overlays.setPreview('spenders');
    all.client.set({ of: 'preview', from: 'spenders' }, preview(CTX, 'spenders', views.ready(), { result: result(CTX, { opId, feature: 'reply', state: 'done', surface: 'preview' }) }));
    for (const id of DISPATCHER_COMMAND_IDS) for (const target of ['dock', 'preview', 'global'] as const) all.runner.run({ id, slot: id === 'quick-jump' ? 1 : null, target });
    all.runner.quickJump(true);
    await settle();
    expect(all.client.dispatched.length).toBeGreaterThan(20);
    for (const action of all.client.dispatched) expect(forbidden).not.toContain(action.type);
    // With a confirmation on screen too: the only answer a key ever gives it is «Отмена».
    const asking = runnerRig({ result: result(CTX, { opId, feature: 'reply', state: 'done', confirm: { confirmationId: uuid(0x62), kind: 'human-draft', part: { index: 0 }, formatLoss: false } }) });
    asking.overlays.set('dialog', true);
    for (const id of DISPATCHER_COMMAND_IDS) for (const target of ['dock', 'preview', 'global'] as const) asking.runner.run({ id, slot: id === 'quick-jump' ? 1 : null, target });
    await settle();
    for (const action of asking.client.dispatched) expect(action.type !== 'AnswerConfirm' || action.choice === 'cancel').toBe(true);
    expect(asking.client.dispatched.filter((action) => action.type === 'AnswerConfirm')).not.toEqual([]);
    for (const type of ['SendPart', 'InsertPart', 'OpenAndInsertPart', 'ReplaceMyDraft'] as const) expect(asking.client.dispatched.map((action) => action.type)).not.toContain(type);
  });
});
