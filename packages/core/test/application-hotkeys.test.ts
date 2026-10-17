// The early dispatcher and the hotkey runner (architecture.md §9.1): what the
// tab does with a key before ChatSpace sees it, and which UiAction a command
// becomes. The DOM is faked here (core has none); the same dispatcher runs
// against a real document and closed shadow roots in
// packages/testing/src/input/dispatcher.dom.test.ts and in Firefox in
// packages/testing/e2e/specs/hotkeys.e2e.ts. Test titles carry the parity rows.

import { type UiAction, type UiActionType } from '@cg/contracts';
import { KEPT_KEY_TTL_MS, QUICK_JUMP_HOLD_MS, createEarlyKeyDispatcher, createEarlyNotices, createHotkeyRunner, createTabKeyState, nextTone, type EarlyNotice } from '@cg/core/application/hotkeys';
import { chatHandle, createCauseHint, createOverlayState, mirrorDismissible } from '@cg/core/application/navigation';
import { DISPATCHER_COMMAND_IDS, createActionCatalog, createKeyResolver, type HotkeyPlatform, type KeyCommand, type OverlayKind, type RouteKind } from '@cg/core/domain/hotkeys';
import { createI18n } from '@cg/core/domain/i18n';
import { FakeToasts, coach, coachTurn, ctxOf, dock, handles, FANS, preview, quickJump, reason, recapPicker, recapView, result, review, uuid, views } from '@cg/testing/app-client';
import { describe, expect, it, vi } from 'vitest';

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
  readonly page: { route: RouteKind; epoch: string; overlays: OverlayKind[]; sheet: boolean; hidden: boolean; focused: boolean };
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
  const page = { route: 'chat' as RouteKind, epoch: CHAT, overlays: [] as OverlayKind[], sheet: false, hidden: false, focused: true };
  let tick = 0;
  const dispatcher = createEarlyKeyDispatcher({
    platform,
    client: 'extension',
    window: win,
    document: { source: doc, hidden: () => page.hidden, focused: () => page.focused },
    ownership: own,
    state: { route: () => ({ kind: page.route, epoch: page.epoch }), overlays: () => page.overlays, dockSheet: () => page.sheet },
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
/** Alt (⌥) by itself: the modifier of the chat slots, whose lone hold opens the quick jump (X45). */
const jumpKey = (down: boolean, mods: Mods = {}): FakeKey => new FakeKey('AltLeft', { key: 'Alt', altKey: down, ...mods });

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

  it.each(['mac', 'win'] as const)('[HK-026] %s: in a chat ⌘U / Ctrl+U pressed while typing never reaches the browser — no page source — and says why; ⌘1–9 / Ctrl+1–9 are the browser’s tab keys, never ours (X45)', (platform) => {
    const r = rig(platform);
    for (const focus of ['composer', 'field', 'ours-field'] as const) {
      r.own.kind = focus;
      const unread = chord(r, 'KeyU');
      expect([focus, unread.defaultPrevented, unread.stopped]).toEqual([focus, true, true]);
      expect(r.native).not.toContain(unread);
      // The browser gets it (no preventDefault); in our own field it is kept from ChatSpace only, as any combination.
      const digit = chord(r, 'Digit3');
      expect([focus, digit.defaultPrevented, digit.stopped]).toEqual([focus, false, focus === 'ours-field']);
    }
    expect(r.sink.ran).toEqual([]);
    expect(r.sink.refused).toEqual(['composer', 'field', 'ours-field'].map(() => ({ command: 'next-unread', refusal: 'in-field' })));
    // Off any field too: ⌘3 / Ctrl+3 is Firefox's third tab, the chat list's third chat is Alt+3.
    r.own.kind = 'page';
    const tab = chord(r, 'Digit3');
    expect([tab.defaultPrevented, tab.stopped]).toEqual([false, false]);
    expect(r.native).toContain(tab);
    const slot = tap(r, 'Digit3', { altKey: true });
    expect([slot.defaultPrevented, slot.stopped]).toEqual([true, true]);
    expect(r.sink.ids[r.sink.ids.length - 1]).toBe('quick-jump:3@global');
    // An AI key in a field that is not the message field: ours, with the same reason.
    r.own.kind = 'field';
    const reply = chord(r, 'KeyE');
    expect([reply.defaultPrevented, reply.stopped]).toEqual([true, true]);
    expect(r.sink.refused[r.sink.refused.length - 1]).toEqual({ command: 'reply', refusal: 'in-field' });
    // Outside a chat the browser keeps them.
    r.page.route = 'account';
    const outside = chord(r, 'KeyU');
    expect([outside.defaultPrevented, outside.stopped]).toEqual([false, false]);
  });

  it('[HK-026] under a modal window of ChatSpace itself our combinations stay ours and run nothing — ⌘⇧M and ⌘K alike; its Esc and its letters are not touched', () => {
    const r = rig('mac');
    r.own.modal = true;
    for (const event of [chord(r, 'KeyE'), chord(r, 'KeyM', { shiftKey: true }), chord(r, 'KeyK'), chord(r, 'Comma'), chord(r, 'KeyU')]) expect([event.code, event.defaultPrevented, event.stopped]).toEqual([event.code, true, true]);
    expect(r.sink.ran).toEqual([]);
    expect(r.sink.refused.map((item) => `${item.command}:${item.refusal}`)).toEqual(['reply:overlay-open', 'spenders:overlay-open', 'palette:overlay-open', 'settings:overlay-open', 'next-unread:overlay-open']);
    for (const event of [tap(r, 'Escape'), tap(r, 'KeyJ'), tap(r, 'Slash', { shiftKey: true, key: '?' })]) expect([event.code, event.defaultPrevented, event.stopped]).toEqual([event.code, false, false]);
  });

  it('[HK-023] one engine per tab: every trusted keydown and keyup goes through the single resolver, the lazy part gets commands, never keys', () => {
    const resolver = createKeyResolver('mac', 'extension');
    const keydown = vi.spyOn(resolver, 'keydown');
    const keyup = vi.spyOn(resolver, 'keyup');
    const win = new FakeWindow();
    const own = new FakeOwnership();
    const clock = new FakeClock(NOW);
    const sink = new RecordingSink();
    const dispatcher = createEarlyKeyDispatcher({ platform: 'mac', client: 'extension', window: win, ownership: own, state: { route: () => ({ kind: 'chat', epoch: CHAT }), overlays: () => [], dockSheet: () => false }, timers: clock, now: () => clock.now(), resolver });
    dispatcher.connect(sink);
    // One listener of each kind on `window`, in capture: nothing else of ours listens for keys there. The pointer
    // is not listened to at all while no hold is armed and no popup is open.
    expect([win.count('keydown'), win.count('keyup'), win.count('blur'), win.count('focus'), win.count('pagehide'), win.count('mousemove')]).toEqual([1, 1, 1, 1, 1, 0]);
    win.fire('keydown', new FakeKey('MetaLeft', { key: 'Meta', metaKey: true }));
    win.fire('keydown', new FakeKey('KeyE', { metaKey: true }));
    win.fire('keydown', new FakeKey('KeyA'));
    win.fire('keyup', new FakeKey('KeyE', { metaKey: true }));
    expect(keydown).toHaveBeenCalledTimes(3);
    expect(keyup).toHaveBeenCalledTimes(1);
    expect(sink.ran).toEqual([{ id: 'reply', slot: null, target: 'dock' }]);
    dispatcher.dispose();
    expect([win.count('keydown'), win.count('keyup'), win.count('blur'), win.count('focus'), win.count('pagehide'), win.count('mousemove')]).toEqual([0, 0, 0, 0, 0, 0]);
    win.fire('keydown', new FakeKey('KeyA'));
    expect(keydown).toHaveBeenCalledTimes(3);
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

  it('[HK-024] a key pressed before the lazy part loaded is taken at once, kept, announced, and runs when the part arrives', () => {
    const r = rig('mac', false);
    const event = chord(r, 'KeyE');
    // The browser's and TipTap's own action is already off, although nothing of ours can run yet.
    expect([event.defaultPrevented, event.stopped]).toEqual([true, true]);
    expect(r.notices).toEqual([{ kind: 'queued', command: 'reply' }]);
    expect(r.sink.ran).toEqual([]);
    r.dispatcher.connect(r.sink);
    expect(r.sink.ids).toEqual(['reply@dock']);
    expect(r.notices).toEqual([{ kind: 'queued', command: 'reply' }, { kind: 'ran', command: 'reply' }]);
    expect(r.dispatcher.stats()).toMatchObject({ queued: 1, dropped: 0 });
    // A refusal before the lazy part has nobody to show it yet: it is reported the same early way.
    const early = rig('mac', false);
    chord(early, 'KeyH', { shiftKey: true });
    expect(early.notices).toEqual([{ kind: 'refused', command: 'help', refusal: 'help-removed' }]);
  });

  it('[HK-024] what was pressed before anything could draw is shown the moment the toasts exist: «загрузка» for a kept key until it runs or is dropped, the reason for a refused one', () => {
    const toasts = new FakeToasts();
    const refusedLater: string[] = [];
    const waiting: boolean[] = [];
    const presenter = { toasts, refuse: (command: string, refusal: string) => refusedLater.push(`${command}:${refusal}`) };
    const early = createEarlyNotices({ onWaiting: (on) => waiting.push(on) });
    early.onEarly({ kind: 'queued', command: 'reply' });
    early.onEarly({ kind: 'refused', command: 'help', refusal: 'help-removed' });
    // Nothing can draw yet; the bootstrap is told at once (it marks the dock host).
    expect([toasts.shown, waiting]).toEqual([[], [true]]);
    early.attach(presenter);
    expect(toasts.shown.map((item) => item.toast)).toEqual([{ kind: 'info', code: null, scope: 'hotkey.early', title: { key: 'common.loading' }, body: null }]);
    expect(refusedLater).toEqual(['help:help-removed']);
    // A newer key waits in its place: still waiting, the same one toast. It runs: the toast goes.
    early.onEarly({ kind: 'dropped', command: 'reply', why: 'replaced' });
    early.onEarly({ kind: 'queued', command: 'ping' });
    expect([toasts.shown.length, waiting]).toEqual([1, [true]]);
    early.onEarly({ kind: 'ran', command: 'ping' });
    expect([toasts.shown, waiting]).toEqual([[], [true, false]]);
    // After the toasts exist notices show at once; a dropped key takes its «загрузка» away, whatever dropped it.
    for (const why of ['route-changed', 'expired', 'superseded'] as const) {
      early.onEarly({ kind: 'queued', command: 'fix' });
      expect(toasts.shown).toHaveLength(1);
      early.onEarly({ kind: 'dropped', command: 'fix', why });
      expect(toasts.shown).toEqual([]);
    }
    expect(waiting).toEqual([true, false, true, false, true, false, true, false]);
    early.onEarly({ kind: 'refused', command: 'reply', refusal: 'overlay-open' });
    expect(refusedLater).toEqual(['help:help-removed', 'reply:overlay-open']);

    // The key was dropped before anything could draw: nothing to show any more; only the newest refusals are kept.
    const quiet = createEarlyNotices();
    const laterToasts = new FakeToasts();
    const reasons: string[] = [];
    quiet.onEarly({ kind: 'queued', command: 'reply' });
    quiet.onEarly({ kind: 'dropped', command: 'reply', why: 'expired' });
    for (const command of ['reply', 'fix', 'hi', 'ping'] as const) quiet.onEarly({ kind: 'refused', command, refusal: 'overlay-open' });
    quiet.attach({ toasts: laterToasts, refuse: (command) => reasons.push(command) });
    expect([laterToasts.shown, reasons]).toEqual([[], ['fix', 'hi', 'ping']]);
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

  it('[HK-025] a cold-start key waits for the chat\'s first state: the lazy part arrives while the dock still loads, the dock settles, the key runs as pressed', async () => {
    const r = rig('mac', false);
    r.sink.dockReady = false;
    chord(r, 'KeyE');
    await r.clock.advance(1000);
    r.dispatcher.connect(r.sink);
    // Not judged against «чат загружается»: neither run nor refused, still announced as waiting.
    expect([r.sink.ran, r.sink.refused, r.notices]).toEqual([[], [], [{ kind: 'queued', command: 'reply' }]]);
    await r.clock.advance(2000);
    r.sink.settle();
    expect(r.sink.ids).toEqual(['reply@dock']);
    expect(r.notices).toEqual([{ kind: 'queued', command: 'reply' }, { kind: 'ran', command: 'reply' }]);
    // Nothing is left behind: no subscription, no timer; a later «ready» runs nothing twice.
    expect([r.sink.readySubscribers, r.clock.pending]).toEqual([0, 0]);
    r.sink.settle();
    await r.clock.advance(KEPT_KEY_TTL_MS);
    expect(r.sink.ids).toEqual(['reply@dock']);
  });

  it('[HK-025] a key of the dock pressed after the lazy part arrived but before the first state waits the same way; a key that needs no dock runs at once', () => {
    const r = rig('mac');
    r.sink.dockReady = false;
    const reply = chord(r, 'KeyE');
    expect([reply.defaultPrevented, reply.stopped]).toEqual([true, true]);
    expect([r.sink.ran, r.notices]).toEqual([[], [{ kind: 'queued', command: 'reply' }]]);
    // The newest key only: ⌘P takes ⌘E's place and waits; then ⌘K, which needs no dock, runs at once and nothing waits any more.
    chord(r, 'KeyP');
    expect(r.notices.slice(1)).toEqual([{ kind: 'dropped', command: 'reply', why: 'replaced' }, { kind: 'queued', command: 'ping' }]);
    chord(r, 'KeyK');
    expect(r.sink.ids).toEqual(['palette@global']);
    expect(r.notices[r.notices.length - 1]).toEqual({ kind: 'dropped', command: 'ping', why: 'superseded' });
    r.sink.settle();
    expect(r.sink.ids).toEqual(['palette@global']);
    expect([r.sink.readySubscribers, r.clock.pending]).toEqual([0, 0]);
    // Once the first state is there keys run at once.
    chord(r, 'KeyE');
    expect(r.sink.ids).toEqual(['palette@global', 'reply@dock']);
    expect(r.dispatcher.stats()).toMatchObject({ queued: 2, dropped: 2 });
  });

  it('[HK-025] the wait is bounded and checks the chat again: another chat — dropped; five seconds without a state — the reason, not silence', async () => {
    const moved = rig('mac', false);
    moved.sink.dockReady = false;
    chord(moved, 'KeyE');
    moved.dispatcher.connect(moved.sink);
    moved.page.epoch = '/accounts/1001/chats/2003';
    moved.sink.settle();
    expect([moved.sink.ran, moved.sink.refused]).toEqual([[], []]);
    expect(moved.notices[moved.notices.length - 1]).toEqual({ kind: 'dropped', command: 'reply', why: 'route-changed' });

    const slow = rig('mac', false);
    slow.sink.dockReady = false;
    chord(slow, 'KeyE');
    await slow.clock.advance(2000);
    slow.dispatcher.connect(slow.sink);
    // What is left of the key's five seconds, counted from the press.
    await slow.clock.advance(KEPT_KEY_TTL_MS - 2000 - 1);
    expect([slow.sink.ran, slow.sink.refused]).toEqual([[], []]);
    await slow.clock.advance(1);
    expect(slow.sink.ran).toEqual([]);
    expect(slow.sink.refused).toEqual([{ command: 'reply', refusal: 'chat-loading' }]);
    expect(slow.notices[slow.notices.length - 1]).toEqual({ kind: 'dropped', command: 'reply', why: 'expired' });
    expect(slow.sink.readySubscribers).toBe(0);
    slow.sink.settle();
    expect(slow.sink.ran).toEqual([]);

    // The state came with the last tick (no notification reached us): the key still runs.
    const last = rig('mac', false);
    last.sink.dockReady = false;
    chord(last, 'KeyE');
    last.dispatcher.connect(last.sink);
    last.sink.dockReady = true;
    await last.clock.advance(KEPT_KEY_TTL_MS);
    expect([last.sink.ids, last.sink.refused]).toEqual([['reply@dock'], []]);

    // The chat changed while the key waited, and nothing told us: at its deadline it is dropped, not refused in another chat.
    const gone = rig('mac', false);
    gone.sink.dockReady = false;
    chord(gone, 'KeyE');
    gone.dispatcher.connect(gone.sink);
    gone.page.epoch = '/accounts/1001/chats/2003';
    await gone.clock.advance(KEPT_KEY_TTL_MS);
    expect([gone.sink.ran, gone.sink.refused]).toEqual([[], []]);
    expect(gone.notices[gone.notices.length - 1]).toEqual({ kind: 'dropped', command: 'reply', why: 'route-changed' });

    // The lazy part goes away while the key waits (the extension reloads): the key is kept for the next one and judged again there.
    const again = rig('mac', false);
    again.sink.dockReady = false;
    chord(again, 'KeyE');
    again.dispatcher.connect(again.sink);
    again.dispatcher.disconnect();
    expect([again.sink.readySubscribers, again.clock.pending]).toEqual([0, 0]);
    again.sink.settle();
    expect(again.sink.ran).toEqual([]);
    again.dispatcher.connect(again.sink);
    expect(again.sink.ids).toEqual(['reply@dock']);
  });

  it('[HK-022] window blur and a hidden tab reset the engine: a modifier held across them fires nothing', () => {
    const r = rig('mac');
    r.win.fire('keydown', primaryKey('mac', true));
    r.win.fire('blur');
    const afterBlur = new FakeKey('KeyE', { metaKey: true });
    r.win.fire('keydown', afterBlur);
    // Still ours in a chat (no find-in-page), but it runs nothing.
    expect(afterBlur.stopped).toBe(true);
    expect(r.sink.ran).toEqual([]);
    r.win.fire('keyup', primaryKey('mac', false));
    r.win.fire('keydown', primaryKey('mac', true));
    r.page.hidden = true;
    r.doc.fire('visibilitychange');
    r.win.fire('keydown', new FakeKey('KeyP', { metaKey: true }));
    expect(r.sink.ran).toEqual([]);
    // A visibility change that leaves the tab visible resets nothing.
    r.win.fire('keyup', primaryKey('mac', false));
    r.page.hidden = false;
    r.win.fire('keydown', primaryKey('mac', true));
    r.doc.fire('visibilitychange');
    r.win.fire('keydown', new FakeKey('KeyP', { metaKey: true }));
    expect(r.sink.ids).toEqual(['ping@dock']);
  });

  it('[HK-019] a held key repeats: still ours, the action does not run again', () => {
    const r = rig('win');
    r.win.fire('keydown', primaryKey('win', true));
    r.win.fire('keydown', new FakeKey('KeyE', { ctrlKey: true }));
    const repeats = [1, 2, 3].map(() => new FakeKey('KeyE', { ctrlKey: true, repeat: true }));
    for (const event of repeats) r.win.fire('keydown', event);
    expect(repeats.map((event) => event.defaultPrevented && event.stopped)).toEqual([true, true, true]);
    expect(r.sink.ids).toEqual(['reply@dock']);
  });

  it('[HK-020] IME: a composing key is left alone everywhere, in our own fields too', () => {
    const r = rig('mac');
    for (const focus of ['composer', 'ours-field', 'ours', 'page'] as const) {
      r.own.kind = focus;
      const keys = [tap(r, 'KeyJ', { isComposing: true }), tap(r, 'Enter', { isComposing: true }), tap(r, 'Escape', { keyCode: 229 }), tap(r, 'KeyE', { metaKey: true, isComposing: true })];
      for (const event of keys) expect([focus, event.code, event.defaultPrevented, event.stopped]).toEqual([focus, event.code, false, false]);
    }
    expect(r.sink.ran).toEqual([]);
    expect(r.own.delivered).toEqual([]);
  });

  it('[HK-028] J, K, ] and ? work on the page and on our cards, never while a person types; AI keys work from the message field', () => {
    const r = rig('win');
    for (const focus of ['composer', 'field', 'ours-field'] as const) {
      r.own.kind = focus;
      for (const event of [tap(r, 'KeyJ'), tap(r, 'KeyK'), tap(r, 'BracketRight', { key: ']' }), tap(r, 'Slash', { shiftKey: true, key: '?' })]) {
        expect([focus, event.code, event.defaultPrevented, event.stopped]).toEqual([focus, event.code, false, false]);
      }
    }
    expect(r.sink.ran).toEqual([]);
    r.own.kind = 'page';
    for (const event of [tap(r, 'KeyJ'), tap(r, 'KeyK'), tap(r, 'BracketRight', { key: ']' }), tap(r, 'Slash', { shiftKey: true, key: '?' })]) expect(event.stopped).toBe(true);
    expect(r.sink.ids).toEqual(['chat-next@global', 'chat-previous@global', 'fan-panel@dock', 'cheatsheet@global']);
    r.own.kind = 'composer';
    chord(r, 'KeyE');
    chord(r, 'KeyS', { altKey: true });
    expect(r.sink.ids.slice(4)).toEqual(['reply@dock', 'recap@dock']);
  });

  it('[HK-027] under the cheatsheet or a board a paid generation is refused with the reason; the windows\' own keys and Cancel work', () => {
    const r = rig('mac');
    r.page.overlays = ['cheatsheet'];
    const reply = chord(r, 'KeyE');
    expect([reply.defaultPrevented, reply.stopped]).toEqual([true, true]);
    expect(r.sink.refused).toEqual([{ command: 'reply', refusal: 'overlay-open' }]);
    chord(r, 'Period');
    tap(r, 'Slash', { shiftKey: true, key: '?' });
    chord(r, 'KeyM', { shiftKey: true });
    expect(r.sink.ids).toEqual(['cancel@dock', 'cheatsheet@global', 'spenders@global']);
    chord(r, 'KeyH', { shiftKey: true });
    expect(r.sink.refused[1]).toEqual({ command: 'help', refusal: 'help-removed' });
  });

  it('[HK-029] Esc: nothing of ours open — ChatSpace\'s; ours open — the top of ours closes and ChatSpace does not see the key', () => {
    const r = rig('mac');
    r.own.kind = 'composer';
    const theirs = tap(r, 'Escape');
    expect([theirs.defaultPrevented, theirs.stopped]).toEqual([false, false]);
    expect(r.native).toContain(theirs);
    r.page.overlays = ['spenders', 'preview'];
    const ours = tap(r, 'Escape');
    expect([ours.defaultPrevented, ours.stopped]).toEqual([true, true]);
    expect(r.native).not.toContain(ours);
    expect(r.sink.ids).toEqual(['close@global']);
    // Only the dock's sheet is open, the cursor is in the message field: the sheet closes, the chat tab stays.
    r.page.overlays = [];
    r.page.sheet = true;
    const sheet = tap(r, 'Escape');
    expect(sheet.stopped).toBe(true);
    expect(r.sink.ids).toEqual(['close@global', 'close@global']);
    // A modal window of ChatSpace itself comes first.
    r.own.modal = true;
    const modal = tap(r, 'Escape');
    expect([modal.defaultPrevented, modal.stopped]).toEqual([false, false]);
  });

  it('[HK-029] [HK-030] focus inside our UI: the key is kept from ChatSpace and handed to our element; Esc falls back to closing the window', () => {
    const r = rig('mac');
    r.own.kind = 'ours-field';
    r.page.overlays = ['palette'];
    // Our field took Esc (a menu closed, a search cleared): the window stays.
    r.own.takes = true;
    const taken = tap(r, 'Escape');
    expect([taken.stopped, taken.defaultPrevented]).toEqual([true, true]);
    expect(r.own.delivered).toEqual([taken]);
    expect(r.sink.ran).toEqual([]);
    // Nothing inside took it: the window closes.
    r.own.takes = false;
    const fallback = tap(r, 'Escape');
    expect([fallback.stopped, fallback.defaultPrevented]).toEqual([true, true]);
    expect(r.sink.ids).toEqual(['close@global']);
    // Esc held down in our UI: the repeats are still kept from ChatSpace and handed to our element, and close no second window.
    const held = [1, 2].map(() => new FakeKey('Escape', { repeat: true }));
    for (const event of held) r.win.fire('keydown', event);
    expect(held.map((event) => [event.stopped, r.native.includes(event)])).toEqual([[true, false], [true, false]]);
    expect(r.sink.ids).toEqual(['close@global']);
    // Enter in the Coach question or on a card, Shift+Enter, arrows, Tab, ⌘C: ours to handle, never ChatSpace's.
    r.own.kind = 'ours';
    const keys = [tap(r, 'Enter'), tap(r, 'Enter', { shiftKey: true }), tap(r, 'ArrowDown'), tap(r, 'Tab'), chord(r, 'KeyC'), chord(r, 'Enter')];
    for (const event of keys) {
      // Stopped for ChatSpace, not prevented: the browser's own action (a new line, the caret, the copy) still happens.
      expect([event.code, event.stopped, event.defaultPrevented]).toEqual([event.code, true, false]);
      expect(r.native).not.toContain(event);
      expect(r.own.delivered).toContain(event);
    }
    // Plain typing in our field passes untouched and is not even looked at.
    r.own.kind = 'ours-field';
    const reads = r.own.focusReads;
    const typed = tap(r, 'KeyA');
    expect([typed.stopped, typed.defaultPrevented, r.own.focusReads]).toEqual([false, false, reads]);
    expect(r.dispatcher.stats().isolated).toBe(10);
  });

  it('[SP-033] under a board its own keys stay its own: J/K, arrows, Enter, / and Esc go to the board, chat navigation does not run', () => {
    const r = rig('mac');
    r.page.route = 'account';
    r.page.overlays = ['spenders'];
    r.own.kind = 'ours';
    r.own.takes = true;
    const letters = [tap(r, 'KeyJ'), tap(r, 'KeyK'), tap(r, 'KeyO'), tap(r, 'KeyS'), tap(r, 'Slash', { key: '/' })];
    // Letters reach the board natively (plain keys are not taken from anybody).
    for (const event of letters) expect([event.code, event.stopped, event.defaultPrevented]).toEqual([event.code, false, false]);
    for (const event of [tap(r, 'ArrowDown'), tap(r, 'Enter'), tap(r, 'Escape')]) expect(r.own.delivered).toContain(event);
    expect(r.sink.ran).toEqual([]);
  });

  it('[NEW-07] Alt (⌥) held alone for 400 ms opens the quick jump (X45); a digit under it jumps; letting go closes it, and that keyup is ours — no menu bar of Firefox', async () => {
    const r = rig('win');
    r.win.fire('keydown', jumpKey(true));
    await r.clock.advance(QUICK_JUMP_HOLD_MS - 1);
    expect(r.sink.quick).toEqual([]);
    await r.clock.advance(1);
    expect(r.sink.quick).toEqual([true]);
    // The popup is an overlay of ours from now on (the real OverlayState lists it): it takes no key from anything.
    r.page.overlays = ['quick-jump'];
    const digit = new FakeKey('Digit3', { altKey: true });
    r.win.fire('keydown', digit);
    expect([digit.defaultPrevented, digit.stopped]).toEqual([true, true]);
    expect(r.sink.quick).toEqual([true, false]);
    expect(r.sink.ids).toEqual(['quick-jump:3@global']);
    expect(r.sink.refused).toEqual([]);
    // The digit runs against the popup as the person saw it; only then the popup goes.
    expect(r.sink.order).toEqual(['popup:open', 'run:quick-jump', 'popup:close']);
    r.page.overlays = [];
    const afterDigit = jumpKey(false);
    r.win.fire('keyup', afterDigit);
    expect(r.sink.quick).toEqual([true, false]);
    // The popup had already closed with the digit: this keyup is Firefox's, as any Alt keyup.
    expect(afterDigit.defaultPrevented).toBe(false);

    // Released before 400 ms, or another key under it: no popup.
    r.win.fire('keydown', jumpKey(true));
    await r.clock.advance(200);
    r.win.fire('keyup', jumpKey(false));
    await r.clock.advance(1000);
    r.win.fire('keydown', jumpKey(true));
    r.win.fire('keydown', new FakeKey('KeyC', { altKey: true }));
    await r.clock.advance(1000);
    expect(r.sink.quick).toEqual([true, false]);
    r.win.fire('keyup', jumpKey(false));

    // Open, then let go: it closes, and the lone Alt's keyup is ours (Firefox on Windows would focus its menu bar).
    r.win.fire('keydown', jumpKey(true));
    await r.clock.advance(QUICK_JUMP_HOLD_MS);
    const letGo = jumpKey(false);
    r.win.fire('keyup', letGo);
    expect(r.sink.quick).toEqual([true, false, true, false]);
    expect(letGo.defaultPrevented).toBe(true);
    // Open, then the window loses focus: it closes too.
    r.win.fire('keydown', jumpKey(true));
    await r.clock.advance(QUICK_JUMP_HOLD_MS);
    r.win.fire('blur');
    expect(r.sink.quick).toEqual([true, false, true, false, true, false]);
  });

  it('[NEW-07] win: a held Alt that auto-repeats (keyboard delay under 400 ms) still opens the quick jump at 400 ms, once', async () => {
    const r = rig('win');
    r.win.fire('keydown', jumpKey(true));
    // Windows' shortest repeat delay is 250 ms, then about 30 keys a second.
    await r.clock.advance(250);
    r.win.fire('keydown', new FakeKey('AltLeft', { key: 'Alt', altKey: true, repeat: true }));
    await r.clock.advance(33);
    r.win.fire('keydown', new FakeKey('AltLeft', { key: 'Alt', altKey: true, repeat: true }));
    await r.clock.advance(116);
    expect(r.sink.quick).toEqual([]);
    await r.clock.advance(1);
    expect(r.sink.quick).toEqual([true]);
    // The repeats go on while the popup is open: it neither closes nor opens again.
    for (let i = 0; i < 5; i += 1) {
      await r.clock.advance(33);
      r.win.fire('keydown', new FakeKey('AltLeft', { key: 'Alt', altKey: true, repeat: true }));
    }
    await r.clock.advance(1000);
    expect(r.sink.quick).toEqual([true]);
    r.win.fire('keyup', jumpKey(false));
    expect(r.sink.quick).toEqual([true, false]);
    // A repeat alone never arms a hold: Ctrl was down before the page had the focus (the engine was reset).
    r.win.fire('blur');
    r.win.fire('keydown', new FakeKey('AltLeft', { key: 'Alt', altKey: true, repeat: true }));
    await r.clock.advance(1000);
    expect(r.sink.quick).toEqual([true, false]);
  });

  it('[NEW-07] the open popup closes when the hold is no longer a lone Alt: Shift or ⌘ goes down, the lazy part goes away; the hold is judged again when its time comes', async () => {
    for (const end of [
      (r: Rig) => r.win.fire('keydown', new FakeKey('ShiftLeft', { key: 'Shift', shiftKey: true, altKey: true })),
      (r: Rig) => r.win.fire('keydown', new FakeKey('MetaLeft', { key: 'Meta', metaKey: true, altKey: true })),
      (r: Rig) => r.dispatcher.disconnect(),
    ]) {
      const r = rig('mac');
      r.win.fire('keydown', jumpKey(true));
      await r.clock.advance(QUICK_JUMP_HOLD_MS);
      expect(r.sink.quick).toEqual([true]);
      end(r);
      expect(r.sink.quick).toEqual([true, false]);
    }
    // Shift before the 400 ms are over: the hold is off, no popup later.
    const early = rig('mac');
    early.win.fire('keydown', jumpKey(true));
    await early.clock.advance(200);
    early.win.fire('keydown', new FakeKey('ShiftLeft', { key: 'Shift', shiftKey: true, altKey: true }));
    await early.clock.advance(1000);
    expect(early.sink.quick).toEqual([]);

    // The engine no longer sees a lone Alt when the 400 ms are over (whatever ended it without a keydown of ours): no popup.
    const resolver = createKeyResolver('mac', 'extension');
    let alone = true;
    const win = new FakeWindow();
    const clock = new FakeClock(NOW);
    const sink = new RecordingSink();
    const dispatcher = createEarlyKeyDispatcher({
      platform: 'mac',
      client: 'extension',
      window: win,
      ownership: new FakeOwnership(),
      state: { route: () => ({ kind: 'chat', epoch: CHAT }), overlays: () => [], dockSheet: () => false },
      timers: clock,
      now: () => clock.now(),
      resolver: { ...resolver, jumpHeldAlone: () => alone && resolver.jumpHeldAlone() },
    });
    dispatcher.connect(sink);
    win.fire('keydown', jumpKey(true));
    await clock.advance(QUICK_JUMP_HOLD_MS - 1);
    alone = false;
    await clock.advance(1000);
    expect(sink.quick).toEqual([]);
  });

  it('[HK-022] [NEW-07] the open popup closes on every way the focus can leave — window blur, a hidden tab, pagehide — and when the focus comes back; an armed hold ends the same way', async () => {
    const leave: Readonly<Record<string, (r: Rig) => void>> = {
      'window blur (⌘-Tab, another window, the browser’s own panels)': (r) => r.win.fire('blur'),
      'the tab is hidden': (r) => {
        r.page.hidden = true;
        r.doc.fire('visibilitychange');
      },
      pagehide: (r) => r.win.fire('pagehide'),
      // No blur was heard (the keyup and the blur both went to the system): the focus coming back is the first word.
      'the focus comes back': (r) => r.win.fire('focus'),
    };
    for (const [name, go] of Object.entries(leave)) {
      // The popup is open: it closes, and the keyup that never comes is not waited for.
      const open = rig('mac');
      open.win.fire('keydown', jumpKey(true));
      await open.clock.advance(QUICK_JUMP_HOLD_MS);
      expect([name, open.sink.quick]).toEqual([name, [true]]);
      go(open);
      expect([name, open.sink.quick]).toEqual([name, [true, false]]);
      expect([name, open.win.count('mousemove')]).toEqual([name, 0]);
      // The hold is armed and not over yet: it ends, nothing opens later.
      const armed = rig('mac');
      armed.win.fire('keydown', jumpKey(true));
      await armed.clock.advance(QUICK_JUMP_HOLD_MS / 2);
      go(armed);
      await armed.clock.advance(5000);
      expect([name, armed.sink.quick]).toEqual([name, []]);
      expect([name, armed.clock.pending]).toEqual([name, 0]);
    }
  });

  it('[HK-022] [NEW-07] an Alt that was «held» before the focus came back opens nothing: only a fresh, trusted, non-repeated keydown arms the hold', async () => {
    for (const platform of ['mac', 'win'] as const) {
      const r = rig(platform);
      // Alt goes down, the person switches apps: the keyup goes to the system, the window loses the focus.
      r.win.fire('keydown', jumpKey(true));
      r.page.focused = false;
      r.win.fire('blur');
      await r.clock.advance(5000);
      // Back in the window. Nothing was pressed here: no hold, however long nothing happens.
      r.page.focused = true;
      r.win.fire('focus');
      await r.clock.advance(5000);
      expect(r.sink.quick).toEqual([]);
      // A key that was down all along repeats (Windows): a repeat is not a press.
      r.win.fire('keydown', platform === 'mac' ? new FakeKey('MetaLeft', { key: 'Meta', metaKey: true, repeat: true }) : new FakeKey('AltLeft', { key: 'Alt', altKey: true, repeat: true }));
      await r.clock.advance(5000);
      expect(r.sink.quick).toEqual([]);
      // A forged keydown of the page is not one either (§14).
      r.win.fire('keydown', new FakeKey('AltLeft', { key: 'Alt', altKey: true, isTrusted: false }));
      await r.clock.advance(5000);
      expect(r.sink.quick).toEqual([]);
      // The person lets go and presses it anew: that is a hold.
      r.win.fire('keyup', jumpKey(false));
      r.win.fire('keydown', jumpKey(true));
      await r.clock.advance(QUICK_JUMP_HOLD_MS);
      expect(r.sink.quick).toEqual([true]);
      r.win.fire('keyup', jumpKey(false));
      expect(r.sink.quick).toEqual([true, false]);
    }
  });

  it('[HK-022] [NEW-07] a keydown that reaches a page without the focus, or a hidden one, arms nothing; a focus that left without a blur is seen when the hold’s time comes', async () => {
    // The live case (2026-10-07, then on ⌘): the modifier came down as the window was losing the focus — the blur was already heard, no
    // keyup would ever come, and 400 ms later the popup opened in a window nobody was typing in, and stayed.
    const unfocused = rig('mac');
    unfocused.page.focused = false;
    unfocused.win.fire('blur');
    unfocused.win.fire('keydown', jumpKey(true));
    await unfocused.clock.advance(5000);
    expect(unfocused.sink.quick).toEqual([]);
    expect([unfocused.clock.pending, unfocused.win.count('mousemove')]).toEqual([0, 0]);

    const hidden = rig('mac');
    hidden.page.hidden = true;
    hidden.win.fire('keydown', jumpKey(true));
    await hidden.clock.advance(5000);
    expect(hidden.sink.quick).toEqual([]);

    // The focus was there at the keydown and is gone when the 400 ms are over — and no blur said so.
    const silent = rig('mac');
    silent.win.fire('keydown', jumpKey(true));
    await silent.clock.advance(QUICK_JUMP_HOLD_MS - 1);
    silent.page.focused = false;
    await silent.clock.advance(5000);
    expect(silent.sink.quick).toEqual([]);
    expect(silent.win.count('mousemove')).toEqual(0);
    // Nothing is left armed: with the focus back, the stale Alt still opens nothing.
    silent.page.focused = true;
    await silent.clock.advance(5000);
    expect(silent.sink.quick).toEqual([]);

    // A dispatcher that is told nothing of the focus (no probe) works as before.
    const win = new FakeWindow();
    const clock = new FakeClock(NOW);
    const sink = new RecordingSink();
    const plain = createEarlyKeyDispatcher({ platform: 'mac', client: 'extension', window: win, ownership: new FakeOwnership(), state: { route: () => ({ kind: 'chat', epoch: CHAT }), overlays: () => [], dockSheet: () => false }, timers: clock, now: () => clock.now() });
    plain.connect(sink);
    win.fire('keydown', jumpKey(true));
    await clock.advance(QUICK_JUMP_HOLD_MS);
    expect(sink.quick).toEqual([true]);
  });

  it('[NEW-07] a keyup the system took is told by the pointer: a trusted mouse move without Alt ends the hold and closes the popup; one with it, or a forged one, changes nothing', async () => {
    for (const platform of ['mac', 'win'] as const) {
      const held = { isTrusted: true, altKey: true };
      const up = { isTrusted: true, altKey: false };
      const r = rig(platform);
      // Nothing armed: the pointer is not listened to.
      expect(r.win.count('mousemove')).toBe(0);
      r.win.fire('keydown', jumpKey(true));
      // Armed: listened to. The person moves the mouse with the modifier down — towards a row, say: the hold goes on.
      expect(r.win.count('mousemove')).toBe(1);
      r.win.fire('mousemove', held);
      await r.clock.advance(QUICK_JUMP_HOLD_MS);
      expect(r.sink.quick).toEqual([true]);
      r.win.fire('mousemove', held);
      // A synthetic move of the page says nothing (§14).
      r.win.fire('mousemove', { ...up, isTrusted: false });
      expect(r.sink.quick).toEqual([true]);
      // The keyup never came (the app switcher took it and was cancelled: the window kept the focus, no blur).
      // The next real move of the mouse carries no modifier: the popup closes, and nothing listens any more.
      r.win.fire('mousemove', up);
      expect(r.sink.quick).toEqual([true, false]);
      expect(r.win.count('mousemove')).toBe(0);

      // The same while the hold is only armed: it ends before the popup ever opens.
      const armed = rig(platform);
      armed.win.fire('keydown', jumpKey(true));
      await armed.clock.advance(QUICK_JUMP_HOLD_MS / 2);
      armed.win.fire('mousemove', up);
      await armed.clock.advance(5000);
      expect(armed.sink.quick).toEqual([]);
      expect([armed.clock.pending, armed.win.count('mousemove')]).toEqual([0, 0]);

      // Every way the popup ends stops the listening: the keyup, a digit, another key.
      for (const end of [
        (x: Rig) => x.win.fire('keyup', jumpKey(false)),
        (x: Rig) => x.win.fire('keydown', new FakeKey('Digit2', { altKey: true })),
        (x: Rig) => x.win.fire('keydown', new FakeKey('KeyC', { altKey: true })),
        (x: Rig) => x.dispatcher.disconnect(),
        (x: Rig) => x.dispatcher.dispose(),
      ]) {
        const x = rig(platform);
        x.win.fire('keydown', jumpKey(true));
        await x.clock.advance(QUICK_JUMP_HOLD_MS);
        expect(x.win.count('mousemove')).toBe(1);
        end(x);
        expect(x.win.count('mousemove')).toBe(0);
      }
    }
  });

  it('a forged keyup never moves the engine either: the page cannot end a real Alt hold or close the popup (§14)', async () => {
    const r = rig('mac');
    r.win.fire('keydown', jumpKey(true));
    r.win.fire('keyup', new FakeKey('AltLeft', { key: 'Alt', isTrusted: false }));
    // Alt is still down for the engine: the hold goes on and opens the popup…
    await r.clock.advance(QUICK_JUMP_HOLD_MS);
    expect(r.sink.quick).toEqual([true]);
    // …which a forged keyup does not close; the real one does.
    r.win.fire('keyup', new FakeKey('AltLeft', { key: 'Alt', isTrusted: false }));
    expect(r.sink.quick).toEqual([true]);
    r.win.fire('keyup', jumpKey(false));
    expect(r.sink.quick).toEqual([true, false]);
  });

  it('[NEW-07] no quick jump while typing, without a chat list, under a window, or before the lazy part', async () => {
    for (const arrange of [
      (r: Rig) => (r.own.kind = 'composer'),
      (r: Rig) => (r.own.kind = 'ours-field'),
      (r: Rig) => (r.page.route = 'other'),
      (r: Rig) => (r.page.overlays = ['spenders']),
      (r: Rig) => (r.own.modal = true),
      (r: Rig) => r.dispatcher.disconnect(),
    ]) {
      const r = rig('mac');
      arrange(r);
      r.win.fire('keydown', jumpKey(true));
      await r.clock.advance(1000);
      expect(r.sink.quick).toEqual([]);
    }
    // Alt pressed with Shift already down (Alt+Shift switches the input language on Windows) is not a lone hold.
    const r = rig('mac');
    r.win.fire('keydown', new FakeKey('ShiftLeft', { key: 'Shift', shiftKey: true }));
    r.win.fire('keydown', new FakeKey('AltLeft', { key: 'Alt', altKey: true, shiftKey: true }));
    await r.clock.advance(1000);
    expect(r.sink.quick).toEqual([]);
  });

  it('the handler does no page work for plain typing and reports one handler time in N (§11: ≤ 2 ms)', () => {
    const r = rig('mac');
    r.own.kind = 'composer';
    for (const code of ['KeyH', 'KeyE', 'KeyL', 'KeyL', 'KeyO', 'Space']) tap(r, code, code === 'Space' ? { key: ' ' } : {});
    expect([r.own.focusReads, r.own.modalReads]).toEqual([0, 0]);
    // A named key in ChatSpace's field costs one focus read and nothing else.
    tap(r, 'Backspace');
    tap(r, 'ArrowLeft');
    expect([r.own.focusReads, r.own.modalReads]).toEqual([2, 0]);
    expect(r.handlerMs).toHaveLength(4);
    expect(r.dispatcher.stats().maxHandlerMs).toBeCloseTo(0.25, 5);
    expect(r.dispatcher.stats().keydowns).toBe(8);
  });

  it('the tab key state reads the route and the overlays synchronously and carries the dock sheet flag', () => {
    const overlays = createOverlayState();
    const state = createTabKeyState({ overlays, route: () => ({ kind: 'chat', epoch: CHAT }) });
    expect([state.route(), state.overlays(), state.dockSheet()]).toEqual([{ kind: 'chat', epoch: CHAT }, [], false]);
    overlays.set('spenders', true);
    overlays.setPreview('spenders');
    state.setDockSheet(true);
    expect([state.overlays(), state.dockSheet(), overlays.top(), overlays.previewFrom()]).toEqual([['spenders', 'preview'], true, 'preview', 'spenders']);
    overlays.setPreview(null);
    expect(state.overlays()).toEqual(['spenders']);
  });

  it('[CS-030] the preview moving from a board to the palette is heard though the open overlays stay the same: the palette’s preview is a window of its own (X24)', () => {
    const overlays = createOverlayState();
    const heard: string[] = [];
    overlays.subscribe(() => heard.push(`${overlays.list().join('+')}:${String(overlays.previewFrom())}`));
    overlays.setPreview('spenders');
    overlays.setPreview('palette');
    // Nothing moved: nobody is told.
    overlays.setPreview('palette');
    overlays.setPreview(null);
    expect(heard).toEqual(['preview:spenders', 'preview:palette', ':null']);
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
  const i18n = createI18n({ language: 'ru', now: () => CTX.now });
  const runner = createHotkeyRunner({ client, catalog: createActionCatalog('mac'), i18n, toasts, overlays, cause, onDockSheet: (open) => sheet.push(open) });
  const run = async (id: KeyCommand['id'], target: KeyCommand['target'] = 'dock', slot: number | null = null): Promise<UiAction | undefined> => {
    const before = client.dispatched.length;
    runner.run({ id, slot, target });
    await settle();
    return client.dispatched[before];
  };
  return { client, toasts, overlays, cause, sheet, runner, run, i18n };
}

const DOCK_HANDLE = handles.dock(FANS.hubert);
const toastTitles = (toasts: FakeToasts, i18n: { text(msg: { key: never }): string }): string[] => toasts.shown.map((item) => i18n.text(item.toast.title as { key: never }));

describe('the hotkey runner', () => {
  it.each([
    ['[HK-002] Reply', 'reply'],
    ['[HK-003] Fix', 'fix'],
    ['[HK-004] Hi', 'hi'],
    ['[HK-005] Ping', 'ping'],
    ['[HK-010] Review', 'review'],
  ] as const)('%s: the key is the button — a Generate for the open chat, with no options of its own', async (_title, id) => {
    const r = runnerRig();
    expect(await r.run(id)).toEqual({ type: 'Generate', targetHandle: DOCK_HANDLE, feature: id, options: {} });
    expect(r.toasts.shown).toEqual([]);
  });

  it('[HK-026] the key of an action that cannot run toasts the reason of its button; a busy action\'s own key does nothing', async () => {
    const gated = runnerRig({ actionsOptions: { gates: { fix: reason('needs-draft') } } });
    expect(await gated.run('fix')).toBeUndefined();
    expect(gated.toasts.shown[0]?.toast).toMatchObject({ kind: 'warning', code: 'CG-GATE-DRAFT', scope: 'hotkey.fix' });
    expect(toastTitles(gated.toasts, gated.i18n)).toEqual(['Fix недоступен: сначала напишите черновик в поле ввода']);

    const signedOut = runnerRig({}, 'not-signed-in');
    expect(await signedOut.run('reply')).toBeUndefined();
    expect(signedOut.toasts.shown[0]?.toast.code).toBe('CG-AUTH-REQUIRED');

    const loading = runnerRig({}, 'loading-chat');
    expect(await loading.run('ping')).toBeUndefined();
    expect(loading.toasts.shown[0]?.toast.code).toBe('CG-GATE-CHAT-LOADING');

    const busy = runnerRig({ actionsOptions: { busy: 'reply' } });
    expect(await busy.run('reply')).toBeUndefined();
    expect(busy.toasts.shown).toEqual([]);
    // The other six say «в этом чате уже идёт генерация».
    expect(await busy.run('ping')).toBeUndefined();
    expect(busy.toasts.shown[0]?.toast.code).toBe('CG-OP-CHAT-BUSY');
  });

  it('[HK-025] cold start: ⌘E pressed before the lazy part, the dock still «чат загружается» when it arrives — «Загрузка…» stays until the dock\'s first state, then Reply starts; no «чат ещё загружается» toast', async () => {
    const waiting: boolean[] = [];
    const early = createEarlyNotices({ onWaiting: (on) => waiting.push(on) });
    const r = rig('mac', false, early.onEarly);
    chord(r, 'KeyE');
    expect(waiting).toEqual([true]);
    // The lazy part arrives: the runner over a dock that is still loading its chat.
    const lazy = runnerRig({}, 'loading-chat');
    early.attach({ toasts: lazy.toasts, refuse: (command, refusal) => lazy.runner.refuse(command, refusal) });
    r.dispatcher.connect(lazy.runner);
    await settle();
    expect(lazy.client.dispatched).toEqual([]);
    expect(lazy.toasts.shown.map((item) => item.toast.title)).toEqual([{ key: 'common.loading' }]);
    // The chat's first authoritative state.
    lazy.client.set({ of: 'dock' }, dock(CTX, 'ready'));
    await settle();
    expect(lazy.client.dispatched).toEqual([{ type: 'Generate', targetHandle: DOCK_HANDLE, feature: 'reply', options: {} }]);
    expect([lazy.toasts.shown, waiting]).toEqual([[], [true, false]]);

    // The first state says the chat cannot generate: the key says that reason — the real one, not «загружается».
    const signedOut = runnerRig({}, 'loading-chat');
    const cold = rig('mac', false);
    chord(cold, 'KeyE');
    cold.dispatcher.connect(signedOut.runner);
    signedOut.client.set({ of: 'dock' }, dock(CTX, 'not-signed-in'));
    await settle();
    expect(signedOut.client.dispatched).toEqual([]);
    expect(signedOut.toasts.shown.map((item) => item.toast.code)).toEqual(['CG-AUTH-REQUIRED']);

    // Five seconds and the chat still loads: «Reply недоступен: чат ещё загружается», «Загрузка…» gone.
    const stuckEarly = createEarlyNotices();
    const stuck = rig('mac', false, stuckEarly.onEarly);
    const never = runnerRig({}, 'loading-chat');
    chord(stuck, 'KeyE');
    stuckEarly.attach({ toasts: never.toasts, refuse: (command, refusal) => never.runner.refuse(command, refusal) });
    stuck.dispatcher.connect(never.runner);
    await stuck.clock.advance(KEPT_KEY_TTL_MS);
    expect(never.client.dispatched).toEqual([]);
    expect(toastTitles(never.toasts, never.i18n)).toEqual(['Reply недоступен: чат ещё загружается']);
    expect(never.toasts.shown[0]?.toast.code).toBe('CG-GATE-CHAT-LOADING');
  });

  it('[HK-025] the runner is ready for a key of the dock only after the dock\'s first authoritative state; that latches, and keys that read no dock never wait', () => {
    const r = runnerRig({}, 'loading-chat');
    const command = (id: KeyCommand['id'], target: KeyCommand['target'] = 'dock'): KeyCommand => ({ id, slot: null, target });
    for (const id of ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'coach', 'tone', 'split'] as const) expect([id, r.runner.ready?.(command(id))]).toEqual([id, false]);
    for (const key of [command('cancel'), command('fan-panel'), command('reply', 'preview'), command('palette', 'global'), command('spenders', 'global'), command('chat-next', 'global'), command('close', 'global')]) {
      expect([key.id, r.runner.ready?.(key)]).toEqual([key.id, true]);
    }
    let fired = 0;
    const stop = r.runner.onReady?.(() => (fired += 1));
    // A dock whose view is still «loading» is not a first state, whatever its status says.
    r.client.set({ of: 'dock' }, { ...dock(CTX, 'ready'), view: views.loading() });
    expect([fired, r.runner.ready?.(command('reply'))]).toEqual([0, false]);
    r.client.set({ of: 'dock' }, dock(CTX, 'no-persona'));
    expect([fired, r.runner.ready?.(command('reply'))]).toEqual([1, true]);
    // Another chat loads later: its «чат загружается» is said at once, nothing waits and nothing fires again.
    r.client.set({ of: 'dock' }, dock(CTX, 'loading-chat'));
    r.client.set({ of: 'dock' }, dock(CTX, 'ready'));
    expect([fired, r.runner.ready?.(command('reply'))]).toEqual([1, true]);
    stop?.();
    // A dock that was ready when the lazy part arrived never makes a key wait.
    expect(runnerRig().runner.ready?.(command('reply'))).toBe(true);
    // A disposed runner tells nobody.
    const gone = runnerRig({}, 'loading-chat');
    gone.runner.onReady?.(() => (fired += 1));
    gone.runner.dispose();
    gone.client.set({ of: 'dock' }, dock(CTX, 'ready'));
    expect(fired).toBe(1);
  });

  it('[HK-027] a refused key says «сначала закройте открытое окно»; ⌘⇧H says «пока убран»; [HK-026] a key in a field where it does not work says so', () => {
    const r = runnerRig();
    r.runner.refuse('reply', 'overlay-open');
    r.runner.refuse('help', 'help-removed');
    r.runner.refuse('next-unread', 'in-field');
    r.runner.refuse('reply', 'in-field');
    expect(r.toasts.shown[0]?.toast).toMatchObject({ kind: 'warning', code: 'CG-GATE-OVERLAY', scope: 'hotkey.reply' });
    expect(r.toasts.shown[2]?.toast).toMatchObject({ kind: 'warning', code: null, scope: 'hotkey.next-unread', body: null });
    expect(toastTitles(r.toasts, r.i18n)).toEqual([
      'Reply недоступен: сначала закройте открытое окно',
      'Help пока убран',
      'Следующий непрочитанный чат недоступен: курсор в поле, где это сочетание не работает',
      'Reply недоступен: курсор в поле, где это сочетание не работает',
    ]);
    expect(r.client.dispatched).toEqual([]);
  });

  it('[HK-008] Recap opens the saved Recap (full first); with the Recap sheet open the key is its «Обновить»', async () => {
    const r = runnerRig();
    expect(await r.run('recap')).toEqual({ type: 'ShowRecap', length: 'full' });
    r.client.set({ of: 'recap.picker' }, recapPicker(CTX, views.partial()));
    expect(await r.run('recap')).toEqual({ type: 'ShowRecap', length: 'short' });
    r.client.set({ of: 'dock' }, dock(CTX, 'ready', { analysis: 'recap' }));
    expect(await r.run('recap')).toEqual({ type: 'RefreshRecap', length: 'short' });
  });

  it('[HK-009] Tone walks the tones round and starts nothing; while a generation runs it says why not', async () => {
    const r = runnerRig();
    expect(await r.run('tone')).toEqual({ type: 'SetTone', targetHandle: DOCK_HANDLE, tone: 'casual' });
    expect(nextTone('casual', ['casual', 'flirty', 'upsell', 'spicy'])).toBe('flirty');
    expect(nextTone('spicy', ['casual', 'flirty', 'upsell', 'spicy'])).toBeNull();
    expect(r.client.dispatched.map((action) => action.type)).toEqual(['SetTone']);
    const locked = runnerRig({ actionsOptions: { busy: 'reply' } });
    expect(await locked.run('tone')).toBeUndefined();
    expect(toastTitles(locked.toasts, locked.i18n)).toEqual(['Тон на один ответ недоступен: нельзя менять, пока идёт генерация']);
  });

  it('[RB-010] [HK-026] the port to the background is lost: every key of the strip — Tone and Split too — says «нет связи с расширением», not «хаб недоступен»', async () => {
    const unreachable = reason('runtime-unreachable');
    const base = dock(CTX, 'hub-down', { code: 'CG-RUNTIME-UNREACHABLE' });
    // The dock as its controller builds it over a lost port (application-dock.test.ts [RB-010]): the status is
    // `hub-down` with the code of the lost port, there is no target while the strip is off, and every action and
    // both options carry the reason.
    const lost = {
      ...base,
      targetHandle: null,
      actions: Object.fromEntries(Object.entries(base.actions).map(([id, action]) => [id, { ...action, enabled: false, reason: unreachable }])) as typeof base.actions,
      options: { ...base.options, toneReason: unreachable, splitReason: unreachable },
    };
    const r = runnerRig();
    r.client.set({ of: 'dock' }, lost);
    for (const id of ['tone', 'split', 'reply', 'recap'] as const) expect([id, await r.run(id)]).toEqual([id, undefined]);
    expect(r.toasts.shown.map((item) => item.toast.code)).toEqual(['CG-RUNTIME-UNREACHABLE', 'CG-RUNTIME-UNREACHABLE', 'CG-RUNTIME-UNREACHABLE', 'CG-RUNTIME-UNREACHABLE']);
    expect(toastTitles(r.toasts, r.i18n)).toEqual([
      'Тон на один ответ недоступен: нет связи с расширением, переподключаюсь',
      'Split: ответ частями недоступен: нет связи с расширением, переподключаюсь',
      'Reply недоступен: нет связи с расширением, переподключаюсь',
      'Recap недоступен: нет связи с расширением, переподключаюсь',
    ]);
    expect(r.client.dispatched).toEqual([]);
    // A view that carries no reason of its own: the status' code alone still tells a lost port from a hub that is down.
    const bare = runnerRig();
    bare.client.set({ of: 'dock' }, { ...lost, actions: Object.fromEntries(Object.entries(lost.actions).map(([id, action]) => [id, { ...action, reason: null }])) as typeof base.actions, options: { ...lost.options, toneReason: null, splitReason: null } });
    for (const id of ['tone', 'reply'] as const) await bare.run(id);
    expect(bare.toasts.shown.map((item) => item.toast.code)).toEqual(['CG-RUNTIME-UNREACHABLE', 'CG-RUNTIME-UNREACHABLE']);
    // The hub that really does not answer is still «хаб недоступен».
    const down = runnerRig({ targetHandle: null }, 'hub-down');
    await down.run('tone');
    expect(toastTitles(down.toasts, down.i18n)).toEqual(['Тон на один ответ недоступен: хаб недоступен, AI вернётся, когда он ответит']);
  });

  it('[HK-011] Split is a switch with a toast', async () => {
    const r = runnerRig();
    expect(await r.run('split')).toEqual({ type: 'SetPreference', key: 'generation.split', value: true });
    expect(toastTitles(r.toasts, r.i18n)).toEqual(['Split включён: ответ придёт частями']);
    const on = dock(CTX, 'ready');
    r.client.set({ of: 'dock' }, { ...on, options: { ...on.options, split: true } });
    expect(await r.run('split')).toEqual({ type: 'SetPreference', key: 'generation.split', value: false });
    expect(toastTitles(r.toasts, r.i18n)[1]).toBe('Split выключен: ответ одним сообщением');
    // The write failed: the reason, not «включён».
    r.client.answer = (action) => ({ ok: false, type: action.type, code: 'CG-STORAGE-WRITE', error: { code: 'CG-STORAGE-WRITE', title: 't', body: 'b' } });
    await r.run('split');
    expect(r.toasts.shown[2]?.toast).toMatchObject({ kind: 'warning', code: 'CG-STORAGE-WRITE' });
  });

  it('[HK-012] [SP-001] Spenders opens and closes the board from anywhere; [HK-013] Coach, [HK-036] the palette and [HK-034] the cheatsheet toggle too', async () => {
    const r = runnerRig();
    for (const [id, surface] of [['spenders', 'spenders'], ['palette', 'palette'], ['cheatsheet', 'cheatsheet'], ['fan-panel', 'fan-panel'], ['coach', 'coach']] as const) {
      expect(await r.run(id, 'global')).toEqual({ type: 'Navigate', to: { kind: 'surface', surface, open: true } });
      r.overlays.set(surface, true);
      expect(await r.run(id, 'global')).toEqual({ type: 'Navigate', to: { kind: 'surface', surface, open: false } });
      r.overlays.set(surface, false);
    }
    // Coach that cannot open says why; a Coach already open still closes.
    const off = runnerRig({ actionsOptions: { gates: { coach: reason('feature-disabled') } } });
    expect(await off.run('coach')).toBeUndefined();
    expect(off.toasts.shown[0]?.toast.code).toBe('CG-FEATURE-DISABLED');
    off.overlays.set('coach', true);
    expect(await off.run('coach')).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: false } });
  });

  it('[HK-041] ⌘, opens the settings; [HK-037] [HK-039] navigation keys become Navigate with a key as the cause', async () => {
    const r = runnerRig();
    expect(await r.run('settings', 'global')).toEqual({ type: 'OpenSettings', route: { section: 'status' } });
    expect(r.cause.take()).toBe('click');
    expect(await r.run('chat-next', 'global')).toEqual({ type: 'Navigate', to: { kind: 'chat-step', direction: 'next' } });
    expect(r.cause.take()).toBe('key');
    expect(await r.run('chat-previous', 'global')).toEqual({ type: 'Navigate', to: { kind: 'chat-step', direction: 'previous' } });
    expect(await r.run('next-unread', 'global')).toEqual({ type: 'Navigate', to: { kind: 'next-unread' } });
    expect(await r.run('quick-jump', 'global', 4)).toEqual({ type: 'Navigate', to: { kind: 'chat-slot', slot: 4 } });
    expect(r.cause.take()).toBe('key');
    expect(await r.run('quick-jump', 'global', null)).toBeUndefined();
    expect(r.cause.take()).toBe('click');
    r.runner.quickJump(true);
    r.runner.quickJump(false);
    await settle();
    expect(r.client.dispatched.slice(-2)).toEqual([
      { type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open: true } },
      { type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open: false } },
    ]);
    // A failed navigation is said in a toast (a refused generation shows in the dock itself).
    r.client.answer = (action) => ({ ok: false, type: action.type, code: 'CG-NAV-FAILED', error: { code: 'CG-NAV-FAILED', title: 't', body: 'b' } });
    await r.run('chat-next', 'global');
    await r.run('reply');
    expect(r.toasts.shown.map((item) => item.toast.code)).toEqual(['CG-NAV-FAILED']);
  });

  it('[NEW-07] under the open popup a digit is the row the person sees there — the row\'s own action, which names its chat; with the popup closed it is the N-th row of ChatSpace\'s list', async () => {
    const r = runnerRig();
    const rowAction = (fan: string): UiAction => ({ type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle({ hostAccountId: '1001', platformFanId: fan }) } });
    const shown = quickJump(CTX, views.ready());
    r.client.set({ of: 'quick-jump' }, { ...shown, items: shown.items.map((row, index) => ({ ...row, action: rowAction(String(2003 + index)) })) });
    // ⌘2 pressed at once, before the popup: the second row of the list as it is.
    expect(await r.run('quick-jump', 'global', 2)).toEqual({ type: 'Navigate', to: { kind: 'chat-slot', slot: 2 } });
    expect(r.cause.take()).toBe('key');
    r.overlays.set('quick-jump', true);
    expect(await r.run('quick-jump', 'global', 2)).toEqual(rowAction('2004'));
    // Still a key, for the navigation's cause.
    expect(r.cause.take()).toBe('key');
    // A digit with no row under it opens nothing — never «whatever is seventh in ChatSpace by now».
    expect(await r.run('quick-jump', 'global', 7)).toBeUndefined();
    expect(r.cause.take()).toBe('click');
    // A popup that could not read the list has no rows: the digit does nothing, the popup itself says why.
    r.client.set({ of: 'quick-jump' }, quickJump(CTX, views.empty({ key: 'quickJump.empty' })));
    expect(await r.run('quick-jump', 'global', 1)).toBeUndefined();
    expect(r.toasts.shown).toEqual([]);
  });

  it('[HK-006] Cancel stops the generation that runs where the person looks', async () => {
    const opId = uuid(0x51);
    const streaming = runnerRig({ result: result(CTX, { opId, feature: 'reply', state: 'streaming' }) });
    expect(await streaming.run('cancel')).toEqual({ type: 'CancelGeneration', operationId: opId });
    const done = runnerRig({ result: result(CTX, { opId, feature: 'reply', state: 'done' }) });
    expect(await done.run('cancel')).toBeUndefined();
    const recap = runnerRig({ analysis: 'recap' });
    recap.client.set({ of: 'recap.view' }, recapView(CTX, views.loading(), 'full', { opId, state: 'streaming' }));
    expect(await recap.run('cancel')).toEqual({ type: 'CancelGeneration', operationId: opId });
    const coaching = runnerRig();
    coaching.overlays.set('coach', true);
    coaching.client.set({ of: 'coach' }, coach(CTX, views.ready(), [coachTurn(CTX, 1), coachTurn(CTX, 2, { opId, state: 'streaming', answer: null })]));
    expect(await coaching.run('cancel')).toEqual({ type: 'CancelGeneration', operationId: opId });
    expect(await runnerRig().run('cancel')).toBeUndefined();
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

  it('[HK-042] [HK-026] in a preview a busy action\'s key does nothing, a gated one says why; Tone and Split without a target say why too', async () => {
    const r = runnerRig();
    r.overlays.setPreview('spenders');
    const busy = { enabled: false, busy: true, active: true, reason: null, hotkey: null, badge: null } as const;
    const gated = { enabled: false, busy: false, active: false, reason: reason('ping-gate'), hotkey: null, badge: null } as const;
    const locked = preview(CTX, 'spenders', views.ready(), { barPatch: { reply: busy, ping: gated } });
    r.client.set({ of: 'preview', from: 'spenders' }, { ...locked, bar: { ...locked.bar, locked: true, splitReason: reason('locked-during-generation') } });
    expect(await r.run('reply', 'preview')).toBeUndefined();
    expect(r.toasts.shown).toEqual([]);
    expect(await r.run('ping', 'preview')).toBeUndefined();
    expect(await r.run('split', 'preview')).toBeUndefined();
    expect(r.toasts.shown.map((item) => item.toast.code)).toEqual(['CG-GATE-PING', null]);
    expect(toastTitles(r.toasts, r.i18n)[1]).toBe('Split: ответ частями недоступен: нельзя менять, пока идёт генерация');
    // The preview closed in between: its keys have nothing to act on.
    r.overlays.setPreview(null);
    for (const id of ['tone', 'split', 'reply'] as const) expect(await r.run(id, 'preview')).toBeUndefined();
    expect(r.toasts.shown.slice(2).map((item) => item.toast.code)).toEqual(['CG-FEATURE-DISABLED', 'CG-FEATURE-DISABLED', 'CG-FEATURE-DISABLED']);
    // In a chat that is still loading Tone says «чат ещё загружается».
    const loading = runnerRig({}, 'loading-chat');
    expect(await loading.run('tone')).toBeUndefined();
    expect(loading.toasts.shown[0]?.toast.code).toBe('CG-GATE-CHAT-LOADING');
    // A dispatch that throws is a failed surface, said once, never a silent key.
    const broken = runnerRig();
    broken.client.dispatch = () => Promise.reject(new Error('controller crashed'));
    broken.runner.run({ id: 'reply', slot: null, target: 'dock' });
    broken.runner.run({ id: 'split', slot: null, target: 'dock' });
    await settle();
    expect(broken.toasts.shown.map((item) => item.toast.code)).toEqual(['CG-UI-FAILED']);
  });

  it('[CS-030] the palette’s preview window (X24): ⌘E generates for its fan, Esc closes it', async () => {
    const r = runnerRig();
    r.overlays.setPreview('palette');
    r.client.set({ of: 'preview', from: 'palette' }, preview(CTX, 'palette', views.ready()));
    expect(await r.run('reply', 'preview')).toEqual({ type: 'Generate', targetHandle: handles.palette(FANS.hubert), feature: 'reply', options: {} });
    expect(await r.run('close', 'global')).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } });
  });

  it('[HK-029] Esc closes in turn: the newest window of ours first, the dock\'s sheet last', async () => {
    const opId = uuid(0x71);
    const r = runnerRig({ result: result(CTX, { opId, feature: 'reply', state: 'done' }) });
    r.overlays.set('spenders', true);
    r.overlays.setPreview('spenders');
    r.overlays.set('cheatsheet', true);
    r.client.set({ of: 'preview', from: 'spenders' }, preview(CTX, 'spenders', views.ready()));
    expect(await r.run('close', 'global')).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'cheatsheet', open: false } });
    r.overlays.set('cheatsheet', false);
    expect(await r.run('close', 'global')).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } });
    r.overlays.setPreview(null);
    expect(await r.run('close', 'global')).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: false } });
    r.overlays.set('spenders', false);
    expect(await r.run('close', 'global')).toEqual({ type: 'HideResult', operationId: opId });
    r.overlays.set('result-expanded', true);
    expect(await r.run('close', 'global')).toEqual({ type: 'ExpandResult', operationId: opId, expanded: false });
    // X55: in the window its own analysis answers its key («Обновить ⌘⇧S», «Ещё раз ⌘⇧B»); the other one stands behind it.
    const shown = runnerRig({ analysis: 'recap' });
    shown.overlays.set('result-expanded', true);
    shown.client.set({ of: 'recap.view' }, recapView(CTX, views.ready(), 'full'));
    expect(await shown.run('recap')).toEqual({ type: 'RefreshRecap', length: 'full' });
    expect(await shown.run('review')).toBeUndefined();
    expect(shown.toasts.shown.at(-1)?.toast.title).toMatchObject({ key: 'dock.action.unavailable', params: { action: 'Review' } });
    // X55: a Review or a full Recap opens in that window; Esc from anywhere folds it into its sheet, as «Свернуть».
    for (const view of ['review', 'recap'] as const) {
      const rig = runnerRig({ result: result(CTX, { opId, feature: 'reply', state: 'done' }), analysis: view });
      rig.overlays.set('result-expanded', true);
      expect(await rig.run('close', 'global')).toEqual({ type: 'ShowAnalysis', view, mode: 'sheet' });
    }
  });

  it('[HK-029] Esc with a confirmation of ours on top and the focus outside it is its «Отмена» (ui-design §6.3, Б2) — never «Заменить» or «Добавить»', async () => {
    const opId = uuid(0x72);
    const confirmationId = uuid(0x73);
    const asking = result(CTX, { opId, feature: 'reply', state: 'done', confirm: { confirmationId, kind: 'human-draft', part: { index: 0 }, formatLoss: false } });
    const r = runnerRig({ result: asking });
    r.overlays.set('dialog', true);
    expect(await r.run('close', 'global')).toEqual({ type: 'AnswerConfirm', confirmationId, choice: 'cancel' });
    // The confirmation of a preview's result, when a preview is what is open.
    const previewConfirm = uuid(0x74);
    r.overlays.set('dialog', false);
    r.overlays.setPreview('spenders');
    r.client.set({ of: 'preview', from: 'spenders' }, preview(CTX, 'spenders', views.ready(), { result: result(CTX, { opId, feature: 'reply', state: 'done', surface: 'preview', confirm: { confirmationId: previewConfirm, kind: 'draft-changed', part: { index: 1 }, formatLoss: true } }) }));
    r.overlays.set('dialog', true);
    expect(await r.run('close', 'global')).toEqual({ type: 'AnswerConfirm', confirmationId: previewConfirm, choice: 'cancel' });
    // Another dialog of ours: its owner registers what Esc does; the registration goes with the dialog.
    const own = runnerRig();
    own.overlays.set('dialog', true, { type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: false } });
    expect(own.overlays.closeAction('dialog')).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: false } });
    expect(await own.run('close', 'global')).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: false } });
    own.overlays.set('dialog', false);
    expect(own.overlays.closeAction('dialog')).toBeNull();
    // A registration that would insert, replace or send is not Esc's to run; a dialog nobody knows about is left alone.
    for (const action of [{ type: 'AnswerConfirm', confirmationId, choice: 'replace' }, { type: 'AnswerConfirm', confirmationId, choice: 'append' }, { type: 'SendPart', operationId: opId, variant: 0, part: { index: 0 } }] as const) {
      own.overlays.set('dialog', true, action as UiAction);
      expect(await own.run('close', 'global')).toBeUndefined();
      own.overlays.set('dialog', false);
    }
    own.overlays.set('dialog', true);
    expect(await own.run('close', 'global')).toBeUndefined();
    expect(own.toasts.shown).toEqual([]);
  });

  it('the dock\'s sheet is reported as it opens and closes; open overlays are mirrored as data-dismissible-open', () => {
    const r = runnerRig();
    expect(r.runner.dockSheet()).toBe(false);
    r.client.set({ of: 'dock' }, dock(CTX, 'ready', { result: result(CTX, { opId: uuid(1), feature: 'reply', state: 'done' }) }));
    r.client.set({ of: 'dock' }, dock(CTX, 'ready', { analysis: 'review' }));
    r.client.set({ of: 'dock' }, dock(CTX, 'ready'));
    expect(r.sheet).toEqual([true, false]);
    const calls: string[] = [];
    const mirror = mirrorDismissible(r.overlays, (target, owner, open) => calls.push(`${target}:${owner}:${String(open)}`));
    r.overlays.set('spenders', true);
    r.overlays.set('fan-panel', true);
    r.overlays.set('spenders', false);
    mirror.dockSheet(true);
    mirror.dispose();
    expect(calls).toEqual(['modal:spenders:true', 'panel:fan-panel:true', 'modal:spenders:false', 'dock:sheet:true', 'panel:fan-panel:false']);
    r.runner.dispose();
    r.client.set({ of: 'dock' }, dock(CTX, 'ready', { analysis: 'recap' }));
    expect(r.sheet).toEqual([true, false]);
  });
});
