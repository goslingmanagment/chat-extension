// The real ui/kit components under the early dispatcher (architecture.md
// §9.1, ui-design §6.4): a key pressed inside our closed root is kept from
// the page and handed to the focused element as a `keydown` copy — the kit's
// own handlers (a part's Enter and ⌘C, a dialog's Esc and Tab trap) must work
// on that copy exactly as on a native key. happy-dom; the browser run is
// e2e/specs/hotkeys.e2e.ts.

import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEarlyKeyDispatcher, createTabKeyState, type EarlyKeyDispatcher } from '@cg/core/application/hotkeys';
import { createOverlayState, type OverlayState } from '@cg/core/application/navigation';
import { type KeyCommand } from '@cg/core/domain/hotkeys';
import { createKeyboardProbe, createShadowRootRegistry } from '@cg/host-chatspace/isolated';
import { Button, Dialog, PartRow } from '@cg/ui/kit';

import { part, uuid } from '../scenarios/app-client';
import { flush, mountKitSettled, type MountedKit } from '../kit/harness';

const OP = uuid(0x91);
let kit: MountedKit | null = null;
let dispatcher: EarlyKeyDispatcher | null = null;
let overlays: OverlayState;
let ran: string[] = [];
let page: string[] = [];
const pageListener = (event: Event): void => {
  page.push((event as KeyboardEvent).key);
};

/** The dispatcher first (document_start), then the page's own capture listener on `window`. */
function wire(mounted: MountedKit): void {
  const registry = createShadowRootRegistry();
  registry.register(mounted.host, mounted.root);
  overlays = createOverlayState();
  ran = [];
  page = [];
  dispatcher = createEarlyKeyDispatcher({
    platform: 'mac',
    client: 'extension',
    window,
    ownership: createKeyboardProbe(document, registry),
    state: createTabKeyState({ overlays, route: () => ({ kind: 'chat', epoch: '/accounts/1001/chats/2002' }) }),
    timers: { setTimer: (ms, fn) => setTimeout(fn, ms), clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    now: () => Date.now(),
  });
  dispatcher.connect({ run: (command: KeyCommand) => ran.push(command.id), refuse: () => undefined, quickJump: () => undefined });
  window.addEventListener('keydown', pageListener, true);
}

afterEach(() => {
  window.removeEventListener('keydown', pageListener, true);
  dispatcher?.dispose();
  dispatcher = null;
  kit?.unmount();
  kit = null;
});

/** A key as the browser dispatches it to the focused element (happy-dom marks scripted events untrusted). */
async function press(target: EventTarget, init: KeyboardEventInit & { key: string; code: string }): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
  Object.defineProperty(event, 'isTrusted', { value: true });
  await flush(() => target.dispatchEvent(event));
  return event;
}

describe('ui/kit under the early dispatcher', () => {
  it('[UI-023] [HK-030] Enter on a focused part inserts THIS part and ⌘C copies it — through the hand-over, with nothing reaching the page', async () => {
    const onInsert = vi.fn();
    const onCopy = vi.fn();
    kit = await mountKitSettled(() => <PartRow part={part(2, 'Third', { opId: OP })} mode="insert" onInsert={onInsert} onCopy={onCopy} tabIndex={0} />);
    wire(kit);
    const row = kit.$('.cg-part') as HTMLElement;
    row.focus();
    // What the part's handler is given: the copy, never the real key. A surface that gates a write on the person's
    // own action (§14) reads it as one by the rule of ui-contract.md, decision 12 — `isTrusted` alone would refuse it.
    const seen: { trusted: boolean; person: boolean }[] = [];
    row.addEventListener('keydown', (event) => seen.push({ trusted: event.isTrusted === true, person: event.isTrusted === true || (event as unknown as Record<symbol, unknown>)[Symbol.for('cg.key.delivered')] === true }));
    const enter = await press(row, { key: 'Enter', code: 'Enter' });
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0]?.[0]).toMatchObject({ index: 2 });
    expect(seen).toEqual([{ trusted: false, person: true }]);
    // A key the page scripts at our host never becomes one: it is not copied, and the part hears nothing.
    kit.host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true }));
    expect([onInsert.mock.calls.length, seen.length]).toEqual([1, 1]);
    // (The page hears its own scripted key, as it always could.)
    expect(page).toEqual(['Enter']);
    page = [];
    // The part took the key: the browser's own action on the real key is cancelled too.
    expect(enter.defaultPrevented).toBe(true);
    await press(row, { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(onInsert).toHaveBeenCalledTimes(1);
    await press(row, { key: 'Meta', code: 'MetaLeft', metaKey: true });
    const copy = await press(row, { key: 'c', code: 'KeyC', metaKey: true });
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(copy.defaultPrevented).toBe(true);
    // The page saw the lone modifier only; none of the part's keys.
    expect(page).toEqual(['Meta']);
    expect(dispatcher?.stats()).toMatchObject({ isolated: 3, claimed: 0 });
    expect(ran).toEqual([]);
  });

  it('[HK-029] a dialog of ours takes its own Esc from the hand-over; the dispatcher\'s fallback does not close anything twice; Tab stays inside', async () => {
    const closed = vi.fn();
    function Window() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog
          open={open}
          label="Палитра команд"
          onClose={() => {
            closed();
            setOpen(false);
          }}
        >
          <Button label="Первая" class="cg-first" />
          <Button label="Последняя" class="cg-last" />
        </Dialog>
      );
    }
    kit = await mountKitSettled(Window, { kind: 'palette' });
    wire(kit);
    overlays.set('palette', true);
    const first = kit.$('.cg-first') as HTMLElement;
    const last = kit.$('.cg-last') as HTMLElement;
    expect(kit.root.activeElement).toBe(first);
    // Tab on the last control goes round to the first: the kit's trap works on the copy, and cancels the real Tab.
    last.focus();
    const tab = await press(last, { key: 'Tab', code: 'Tab' });
    expect(kit.root.activeElement).toBe(first);
    expect(tab.defaultPrevented).toBe(true);
    const esc = await press(first, { key: 'Escape', code: 'Escape' });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(esc.defaultPrevented).toBe(true);
    // The dialog handled it: the dispatcher did not run its own «close» on top.
    expect(ran).toEqual([]);
    expect(page).toEqual([]);
    expect(kit.$('[role="dialog"]')).toBeNull();
  });

  it('[HK-029] Esc on an element of ours that has no Esc of its own closes our top window through the dispatcher', async () => {
    kit = await mountKitSettled(() => <Button label="Просто кнопка" class="cg-plain" />, { kind: 'spenders' });
    wire(kit);
    overlays.set('spenders', true);
    const button = kit.$('.cg-plain') as HTMLElement;
    button.focus();
    const esc = await press(button, { key: 'Escape', code: 'Escape' });
    expect(ran).toEqual(['close']);
    expect(esc.defaultPrevented).toBe(true);
    expect(page).toEqual([]);
  });
});
