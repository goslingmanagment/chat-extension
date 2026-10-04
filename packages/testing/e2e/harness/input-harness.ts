// Isolated half of the R17 e2e harness, injected by a WebDriver BiDi preload
// script into a SANDBOX realm of the page — before any page script, the way
// the isolated content script starts at document_start. It wires the early
// key dispatcher exactly as the tab's composition root does: `window`, R09's
// mount manager with its closed shadow roots and registry, the keyboard
// probe, the overlay state mirrored as `data-dismissible-open`. Instead of
// the real controllers a recording sink runs the commands; a minimal UI of
// ours lives in the closed roots — a card, a field, a list — so the spec can
// put the focus there and see which keys it got.
//
// `?cg-keys=mac|win` picks the key scheme (default: the browser's own
// platform); `?cg-lazy=manual` leaves the lazy part unconnected until the
// spec calls `connect` (HK-024); `?cg-dock=loading` makes the lazy part
// arrive without the chat's first state until the spec calls `dockReady`
// (HK-025). The spec drives it through
// `globalThis.__cgInput.call(method, argsJson)`. No network, ever.

import { createEarlyKeyDispatcher, createEarlyNotices, createTabKeyState, type EarlyNotice, type HotkeySink } from '@cg/core/application/hotkeys';
import { createOverlayState, mirrorDismissible } from '@cg/core/application/navigation';
import { hotkeyPlatformOf, type DispatcherCommandId, type HotkeyPlatform, type KeyCommand, type KeyRefusal, type OverlayKind } from '@cg/core/domain/hotkeys';
import { KEY_PENDING_ATTRIBUTE, createKeyPendingMark, createKeyboardProbe, loadValidation, routeOfLocation, startChatSpaceHost } from '@cg/host-chatspace/isolated';

const readyStateAtStart = document.readyState;
const params = new URLSearchParams(window.location.search);
const requested = params.get('cg-keys');
const platform: HotkeyPlatform = requested === 'mac' || requested === 'win' ? requested : hotkeyPlatformOf(navigator.platform);

const started = startChatSpaceHost({
  win: window,
  validation: loadValidation,
  redeem: () => Promise.resolve(true),
  drafts: null,
});

const overlays = createOverlayState();
const keyState = createTabKeyState({ overlays, route: () => routeOfLocation(window.location) });
const probe = createKeyboardProbe(document, started.mounts.registry);

const ran: string[] = [];
const refused: string[] = [];
const quick: boolean[] = [];
const notices: EarlyNotice[] = [];
/** What our own elements in the closed roots received: `<where>:<key>:<delivered copy?>`. */
const ui: string[] = [];
/** Every trusted keydown as a capture listener on `window` saw it, before any decision: the delivery probe. */
const reached: KeyboardEvent[] = [];

// Registered before the dispatcher: it sees every key the browser hands to the page.
window.addEventListener(
  'keydown',
  (event) => {
    if (event.isTrusted) reached.push(event);
  },
  { capture: true },
);

// The one sign of a waiting key before our UI exists: the dock host's attribute.
const early = createEarlyNotices({ onWaiting: createKeyPendingMark(started.mounts.dock.host) });

const dispatcher = createEarlyKeyDispatcher({
  platform,
  window,
  document: { source: document, hidden: () => document.hidden },
  ownership: probe,
  state: keyState,
  timers: { setTimer: (ms, fn) => setTimeout(fn, ms), clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  now: () => Date.now(),
  perfNow: () => performance.now(),
  onEarly: (notice) => {
    notices.push(notice);
    early.onEarly(notice);
  },
});
mirrorDismissible(overlays, (target, owner, open) => started.mounts.setDismissibleOpen(target, owner, open));

// ── a minimal UI of ours inside the closed roots ──

function record(where: string): (event: KeyboardEvent) => void {
  return (event) => {
    ui.push(`${where}:${event.key}:${probe.isDelivered(event) ? 'delivered' : 'native'}`);
  };
}

function buildUi(where: 'dock' | 'overlay', root: ShadowRoot): void {
  if (root.querySelector(`[data-e2e="${where}"]`) !== null) return;
  const box = document.createElement('div');
  box.setAttribute('data-e2e', where);
  box.style.setProperty('pointer-events', 'auto');
  const card = document.createElement('div');
  card.setAttribute('data-e2e', `${where}-card`);
  card.tabIndex = 0;
  card.textContent = 'part';
  card.addEventListener('keydown', record(`${where}-card`));
  // A card of ours takes Enter («вставить эту часть») and its arrows.
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') event.preventDefault();
  });
  const field = document.createElement('input');
  field.setAttribute('data-e2e', `${where}-field`);
  field.addEventListener('keydown', record(`${where}-field`));
  // Our field takes the first Esc itself (it clears what was typed), like a search field does.
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && field.value !== '') {
      field.value = '';
      event.preventDefault();
    }
  });
  box.append(card, field);
  root.append(box);
}

function overlayRoot(): ShadowRoot {
  return started.mounts.overlay('modal').root;
}

function setOverlay(overlay: OverlayKind, open: boolean): void {
  overlays.set(overlay, open);
  const root = overlayRoot();
  if (overlays.list().length > 0) buildUi('overlay', root);
  else root.querySelector('[data-e2e="overlay"]')?.remove();
}

const TOGGLED: Partial<Record<DispatcherCommandId, OverlayKind>> = { palette: 'palette', cheatsheet: 'cheatsheet', spenders: 'spenders', 'fan-panel': 'fan-panel' };

/** The chat's first authoritative state as the lazy part would know it. */
let dockSettled = params.get('cg-dock') !== 'loading';
const readyListeners = new Set<() => void>();

const sink: HotkeySink = {
  ready: (command: KeyCommand) => dockSettled || command.target !== 'dock',
  onReady(listener: () => void) {
    readyListeners.add(listener);
    return () => {
      readyListeners.delete(listener);
    };
  },
  run(command: KeyCommand) {
    ran.push(command.slot === null ? `${command.id}@${command.target}` : `${command.id}:${command.slot}@${command.target}`);
    if (command.id === 'close') {
      const top = overlays.top();
      if (top !== null) setOverlay(top, false);
      return;
    }
    const overlay = TOGGLED[command.id];
    if (overlay !== undefined) setOverlay(overlay, !overlays.isOpen(overlay));
  },
  refuse(command: DispatcherCommandId, refusal: KeyRefusal) {
    refused.push(`${command}:${refusal}`);
  },
  quickJump(open: boolean) {
    quick.push(open);
    setOverlay('quick-jump', open);
  },
};

if (params.get('cg-lazy') !== 'manual') dispatcher.connect(sink);

function element(target: string): HTMLElement | null {
  const root = target.startsWith('dock') ? started.mounts.dock.root : overlayRoot();
  return root.querySelector<HTMLElement>(`[data-e2e="${target}"]`);
}

const api = {
  async ready(timeoutMs = 10_000) {
    const port = await Promise.race([started.host, new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
    return { ready: port !== null, platform, readyStateAtStart };
  },
  /** The dock's host is in place above the open chat's composer, with our card and field in its closed root. */
  dock() {
    buildUi('dock', started.mounts.dock.root);
    return {
      kind: started.mounts.points().dock.kind,
      connected: started.mounts.dock.host.isConnected,
      dismissible: started.mounts.dock.host.hasAttribute('data-dismissible-open'),
      keyPending: started.mounts.dock.host.hasAttribute(KEY_PENDING_ATTRIBUTE),
    };
  },
  log() {
    return { ran: [...ran], refused: [...refused], quick: [...quick], notices: [...notices], ui: [...ui], overlays: [...overlays.list()], stats: dispatcher.stats() };
  },
  /** `prevented` is read now, after every listener ran: whether the key ended up cancelled. */
  reached() {
    return reached.map((event) => ({ code: event.code, key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, prevented: event.defaultPrevented }));
  },
  clear() {
    ran.length = 0;
    refused.length = 0;
    quick.length = 0;
    notices.length = 0;
    ui.length = 0;
    reached.length = 0;
    return true;
  },
  overlay(overlay: OverlayKind, open: boolean) {
    setOverlay(overlay, open);
    const host = started.mounts.overlay('modal').host;
    return { open: [...overlays.list()], dismissible: host.hasAttribute('data-dismissible-open') };
  },
  focus(target: string) {
    const found = element(target);
    found?.focus();
    return { found: found !== null, focus: probe.focus(new KeyboardEvent('keydown')) };
  },
  blurOurs() {
    (document.activeElement as HTMLElement | null)?.blur();
    return probe.focus(new KeyboardEvent('keydown'));
  },
  fieldValue(target: string) {
    return (element(target) as HTMLInputElement | null)?.value ?? null;
  },
  setFieldValue(target: string, value: string) {
    const field = element(target) as HTMLInputElement | null;
    if (field !== null) field.value = value;
    return field !== null;
  },
  focusKind() {
    return probe.focus(new KeyboardEvent('keydown'));
  },
  connect() {
    dispatcher.connect(sink);
    return true;
  },
  /** The chat's first state arrived. */
  dockReady() {
    dockSettled = true;
    for (const listener of [...readyListeners]) listener();
    return true;
  },
  /** A key the page forges: a scripted event on `window`, as a script of the site could dispatch. */
  forge(init: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
    window.dispatchEvent(event);
    return { prevented: event.defaultPrevented };
  },
};

type Api = typeof api;
Object.defineProperty(globalThis, '__cgInput', {
  value: {
    async call(method: keyof Api, argsJson: string): Promise<string> {
      const args = JSON.parse(argsJson) as unknown[];
      // eslint-disable-next-line @typescript-eslint/unbound-method -- applied to `api` itself
      const result: unknown = await (Reflect.apply(api[method], api, args) as unknown);
      return JSON.stringify(result ?? null);
    },
  },
});
