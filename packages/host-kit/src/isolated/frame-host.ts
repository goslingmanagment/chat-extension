// Workboard's screens over the site (hub package R, 2026-11-15; R-protocol.md; the coordinator: one host of Workboard
// «frame» screens, the board «Отчёт» first, «Записать кастом» and «Мои деньги» later through the same seam). Plain DOM in
// closed roots of ours, the same on Fansly and ChatSpace:
//
// - The layer: a full-window host in <html>, above the site's own modals (FRAME_Z), holding the iframe of
//   `<team origin>/workboard/frame/<screen>`: `allow="clipboard-write"`, no `sandbox`, `referrerpolicy="no-referrer"`.
//   Created once per tab and screen, hidden (never unloaded) when collapsed, so opening again is instant.
// - The handshake (version 1): the frame posts `{ cg: "report-board/hello", v: 1 }` to its parent until it holds a
//   port; a hello is taken only from this iframe's window and the team origin, once: a `MessageChannel` is made, its
//   second port transferred to the frame with the team origin as the target. Nothing secret crosses: the frame asks for
//   what it needs over the port, and the extension's background answers (the device token never leaves it).
// - Keys: while the layer shows, the frame has the focus; a key that still lands on the site's page (the layer just
//   opened) stops in the capture phase of the window and never reaches the site's hotkeys; Esc collapses.
// - The bar (`.mini` of the prototype, 8-docs 2026-11-13-products report-panel-mockups/columns.html): 44 px at the
//   bottom of the site while a frame exists in the tab or a compare goes on: the screen's title and chip, the compare
//   line, the count, and «Отчёт» / «К отчёту».
// - The highlight (`.is-hl`): our own frame over a row of the site, never the site's node touched; it follows the row
//   while it scrolls and goes when the row leaves the page.

import type { ShadowRootRegistry } from './shadow-registry';

/** Above every site layer we know: Fansly's modals (≤ 1000) and notices (9999), FBuddy (1 000 000), ChatSpace's dialogs. */
export const FRAME_Z = 2_147_483_000;
/** The handshake's words (contracts report-board.ts; repeated here: the host kit carries no schemas). */
export const FRAME_PORT = 'report-board/port';
export const FRAME_PROTOCOL = 2;
/** The port is offered this often after the frame's `load`, at most this many times (R-protocol, handshake v2). */
export const FRAME_PORT_EVERY_MS = 500;
export const FRAME_PORT_TRIES = 20;

/** A random 128-bit key, hex. */
function randomKey(win: Window): string {
  const bytes = new Uint8Array(16);
  win.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The bar's view: the extension's composition makes the words. */
export interface FrameBarView {
  readonly title: string;
  /** The chip: its text and tone (`clay` asks, `good` counted, `wait` a spinner). null — no chip yet. */
  readonly chip: { readonly text: string; readonly tone: 'plain' | 'clay' | 'good' | 'wait' } | null;
  /** «Сверка: <b>page</b>, rest»; or a plain line (not found, open a tab). null — no compare. */
  readonly compare: { readonly page: string; readonly rest: string } | { readonly words: string } | null;
  /** «Ваши продажи: 17,» and «$477.40». null — not known yet. */
  readonly sales: { readonly label: string; readonly total: string } | null;
  /** «Отчёт», or «К отчёту» in compare mode. */
  readonly button: string;
}

export interface FrameHostEnv {
  readonly doc: Document;
  readonly registry?: ShadowRootRegistry;
  /** The team origin (`https://chatgoose.gosling-agency.ru`; the stand's own in a test build). */
  readonly origin: string;
  /** The screen's address on that origin. */
  readonly url: string;
  /** The kit's token sheet (`THEME_CSS`). */
  readonly tokens: string;
  /** The scheme our surfaces wear now. */
  readonly scheme: () => 'light' | 'dark';
  /** A message of the frame over the port (a plain object; the composition checks it). */
  readonly onMessage: (message: unknown) => void;
  /** The port arrived at the frame (said once a frame). */
  readonly onConnected?: () => void;
  /** Esc on the site's page while the layer shows. */
  readonly onEscape: () => void;
  /** «Отчёт» / «К отчёту» on the bar. */
  readonly onBarButton: () => void;
}

export interface FrameHost {
  /** The layer shows (the frame created the first time). */
  show(): void;
  /** The layer hides; the frame stays loaded. */
  hide(): void;
  shown(): boolean;
  /** Whether a frame exists in this tab. */
  exists(): boolean;
  /** A message to the frame over its port; kept until the port is there. */
  post(message: object): void;
  bar(view: FrameBarView | null): void;
  /** Whether the bar shows now. */
  barShown(): boolean;
  /** The bar's left edge (px from the window's left): ChatSpace's bar starts right of its account rail. */
  inset(left: number): void;
  scheme(): void;
  dispose(): void;
}

const LAYER_CSS = `
:host { all: initial; }
.layer { position: fixed; inset: 0; display: flex; background: var(--cg-surface); }
iframe { flex: 1; width: 100%; height: 100%; border: 0; display: block; background: var(--cg-surface); color-scheme: normal; }
`;

const BAR_CSS = `
:host { all: initial; }
.mini {
  position: absolute; left: 0; right: 0; bottom: 0; box-sizing: border-box; display: flex; align-items: center; gap: 14px; height: 44px;
  padding: 0 10px 0 16px; background: var(--cg-raised); box-shadow: 0 -1px 0 var(--cg-rule-2), 0 -12px 30px -16px rgb(0 0 0 / .45);
  font: 13px/18px var(--cg-font); color: var(--cg-ink); white-space: nowrap; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
}
:host([data-scheme="dark"]) .mini { box-shadow: 0 -1px 0 var(--cg-rule-2), 0 -12px 30px -16px rgb(0 0 0 / .9); }
.mini-t { display: flex; align-items: center; gap: 7px; font-weight: 600; color: var(--cg-ink-strong); }
.mini-t svg { width: 16px; height: 16px; flex: none; fill: none; stroke: var(--cg-clay); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.chip { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px; border-radius: 99px; background: var(--cg-chip); font-size: 12px; font-weight: 600; color: var(--cg-ink-2); }
.chip.is-clay { background: var(--cg-clay-bg); color: var(--cg-clay-ink); }
.chip.is-good { background: var(--cg-good-bg); color: var(--cg-good-ink); }
.spin { flex: none; width: 12px; height: 12px; box-sizing: border-box; border-radius: 50%; border: 1.5px solid var(--cg-clay-line); border-top-color: var(--cg-clay-ink); animation: sp .9s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
.mini-c { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--cg-ink-2); }
.mini-c b { font-weight: 600; color: var(--cg-ink-strong); }
.grow { flex: 1; }
.mini-s { color: var(--cg-ink-muted); }
.mini-s b { font-weight: 600; color: var(--cg-ink-strong); font-variant-numeric: tabular-nums; }
button {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; height: 22px; padding: 0 6px; border-radius: 6px; cursor: pointer;
  font: 600 12px/1 var(--cg-font); background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-strong);
}
button:hover { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); }
button:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
`;

/** The prototype's `report` icon, stroke by stroke. */
const ICON = ['M4 2.4h5.4l2.8 2.8v8.4H4z', 'M9.2 2.6v2.8H12', 'M6 9.7l1.4 1.4 2.6-2.9'];
function icon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICON) {
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function dress(root: ShadowRoot, doc: Document, css: string): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = doc.createElement('style');
    style.textContent = css;
    root.append(style);
  }
}

/** A host of ours in <html>: a plain `div` with a closed root (hosts.ts, decision X22: neutral names only). */
function hostOf(doc: Document, registry: ShadowRootRegistry | undefined, css: string, z: number, layer: 'frame' | 'frame-bar' | 'frame-mark'): { host: HTMLElement; root: ShadowRoot; remove(): void } {
  const host = doc.createElement('div');
  host.setAttribute('data-host', 'overlay');
  host.setAttribute('data-layer', layer);
  host.style.setProperty('position', 'fixed');
  host.style.setProperty('z-index', String(z));
  const root = host.attachShadow({ mode: 'closed' });
  const unregister = registry?.register(host, root);
  dress(root, doc, css);
  doc.documentElement.append(host);
  return {
    host,
    root,
    remove() {
      unregister?.();
      host.remove();
    },
  };
}

const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

export function createFrameHost(env: FrameHostEnv): FrameHost {
  const { doc } = env;
  const win = doc.defaultView as Window;
  let layer: ReturnType<typeof hostOf> | null = null;
  let iframe: HTMLIFrameElement | null = null;
  let port: MessagePort | null = null;
  const queue: object[] = [];
  let visible = false;
  let barHost: ReturnType<typeof hostOf> | null = null;
  let left = 0;

  /**
   * The handshake (version 2): the key is ours alone — in the frame's address fragment, which no page script reads
   * (a closed root, another origin). On every `load` of the frame the port goes with the key, a fresh channel each
   * 500 ms, until the frame answers `ready` on one of them (at most FRAME_PORT_TRIES); that one is the port. Nothing
   * the frame or the page posts to this window is listened to.
   */
  const key = randomKey(win);
  let offers: MessagePort[] = [];
  let offerTimer: ReturnType<typeof setTimeout> | undefined;
  const stopOffers = (keep: MessagePort | null): void => {
    clearTimeout(offerTimer);
    for (const offer of offers) if (offer !== keep) offer.close();
    offers = [];
  };
  const offer = (tries: number): void => {
    if (iframe === null || port !== null || tries >= FRAME_PORT_TRIES) return;
    const channel = new MessageChannel();
    const mine = channel.port1;
    offers.push(mine);
    mine.onmessage = (message: MessageEvent) => {
      const data = message.data as { t?: unknown; v?: unknown } | null;
      if (port === null) {
        if (typeof data !== 'object' || data === null || data.t !== 'ready' || data.v !== FRAME_PROTOCOL) return;
        port = mine;
        stopOffers(mine);
        for (const queued of queue.splice(0)) mine.postMessage(queued);
        env.onConnected?.();
        return;
      }
      if (port === mine) env.onMessage(data);
    };
    mine.start();
    iframe.contentWindow?.postMessage({ cg: FRAME_PORT, v: FRAME_PROTOCOL, key }, env.origin, [channel.port2]);
    offerTimer = setTimeout(() => offer(tries + 1), FRAME_PORT_EVERY_MS);
  };
  /** The frame (re)loaded: its old port is gone with its document; the handshake starts over. */
  const onLoad = (): void => {
    port?.close();
    port = null;
    stopOffers(null);
    offer(0);
  };

  /** While the layer shows, the site's page hears no key: Esc collapses, the rest stops here. */
  const onKey = (event: KeyboardEvent): void => {
    if (!visible) return;
    event.stopImmediatePropagation();
    if (event.type === 'keydown' && event.key === 'Escape') {
      event.preventDefault();
      env.onEscape();
    }
  };
  for (const type of KEY_EVENTS) win.addEventListener(type, onKey, true);

  const create = (): void => {
    if (layer !== null) return;
    layer = hostOf(doc, env.registry, `${env.tokens}\n${LAYER_CSS}`, FRAME_Z, 'frame');
    layer.host.style.setProperty('inset', '0');
    layer.host.setAttribute('data-scheme', env.scheme());
    const box = doc.createElement('div');
    box.className = 'layer';
    iframe = doc.createElement('iframe');
    iframe.setAttribute('allow', 'clipboard-write');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('title', 'Workboard');
    iframe.addEventListener('load', onLoad);
    iframe.src = `${env.url}#k=${key}&v=${String(FRAME_PROTOCOL)}`;
    box.append(iframe);
    layer.root.append(box);
  };

  const bar = (view: FrameBarView | null): void => {
    if (view === null || visible) {
      if (barHost !== null) barHost.host.style.setProperty('display', 'none');
      if (view === null) return;
    }
    barHost ??= hostOf(doc, env.registry, `${env.tokens}\n${BAR_CSS}`, FRAME_Z - 1, 'frame-bar');
    barHost.host.setAttribute('data-scheme', env.scheme());
    barHost.host.style.setProperty('left', `${String(left)}px`);
    barHost.host.style.setProperty('right', '0');
    barHost.host.style.setProperty('bottom', '0');
    barHost.host.style.setProperty('height', '44px');
    barHost.host.style.setProperty('display', visible ? 'none' : 'block');
    const root = barHost.root;
    for (const child of [...root.children]) if (child.tagName !== 'STYLE') child.remove();
    const section = doc.createElement('section');
    section.className = 'mini';
    section.setAttribute('aria-label', `${view.title}, свёрнут`);
    const title = doc.createElement('span');
    title.className = 'mini-t';
    title.append(icon(doc), doc.createTextNode(view.title));
    section.append(title);
    if (view.chip !== null) {
      const chip = doc.createElement('span');
      chip.className = `chip${view.chip.tone === 'clay' ? ' is-clay' : view.chip.tone === 'good' ? ' is-good' : ''}`;
      if (view.chip.tone === 'wait') {
        const spin = doc.createElement('i');
        spin.className = 'spin';
        chip.append(spin);
      }
      chip.append(doc.createTextNode(view.chip.text));
      section.append(chip);
    }
    if (view.compare !== null) {
      const line = doc.createElement('span');
      line.className = 'mini-c';
      if ('words' in view.compare) line.textContent = view.compare.words;
      else {
        const page = doc.createElement('b');
        page.textContent = view.compare.page;
        line.append(doc.createTextNode('Сверка: '), page, doc.createTextNode(`, ${view.compare.rest}`));
      }
      line.title = line.textContent ?? '';
      section.append(line);
    }
    const grow = doc.createElement('span');
    grow.className = 'grow';
    section.append(grow);
    if (view.sales !== null) {
      const sales = doc.createElement('span');
      sales.className = 'mini-s';
      const total = doc.createElement('b');
      total.textContent = view.sales.total;
      sales.append(doc.createTextNode(`${view.sales.label} `), total);
      section.append(sales);
    }
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = view.button;
    button.addEventListener('click', () => env.onBarButton());
    section.append(button);
    root.append(section);
  };

  return {
    show() {
      create();
      visible = true;
      layer?.host.style.setProperty('display', 'block');
      if (barHost !== null) barHost.host.style.setProperty('display', 'none');
      // The board takes the keys: typing there never reaches the site.
      iframe?.focus();
    },
    hide() {
      visible = false;
      layer?.host.style.setProperty('display', 'none');
      if (doc.activeElement === layer?.host) (doc.activeElement as HTMLElement).blur();
    },
    shown: () => visible,
    exists: () => layer !== null,
    post(message) {
      if (port !== null) port.postMessage(message);
      else queue.push(message);
    },
    bar,
    barShown: () => barHost !== null && barHost.host.style.display !== 'none',
    inset(px) {
      left = px;
      barHost?.host.style.setProperty('left', `${String(px)}px`);
    },
    scheme() {
      layer?.host.setAttribute('data-scheme', env.scheme());
      barHost?.host.setAttribute('data-scheme', env.scheme());
    },
    dispose() {
      stopOffers(null);
      for (const type of KEY_EVENTS) win.removeEventListener(type, onKey, true);
      port?.close();
      layer?.remove();
      barHost?.remove();
    },
  };
}

/** The prototype's `.is-hl` over a row of the site: our own frame, the site's node untouched. */
export interface RowHighlight {
  /** Frames the row and keeps the frame on it while it scrolls; the previous one goes. */
  show(row: Element): void;
  clear(): void;
}

const HIGHLIGHT_CSS = `
:host { all: initial; }
.hl { position: fixed; box-sizing: border-box; border-radius: 8px; background: rgb(217 119 87 / .12); box-shadow: inset 0 0 0 1px var(--cg-clay-line), 0 0 0 2px rgb(217 119 87 / .25); pointer-events: none; }
`;

export function createRowHighlight(doc: Document, tokens: string, scheme: () => 'light' | 'dark'): RowHighlight {
  const win = doc.defaultView as Window;
  let host: ReturnType<typeof hostOf> | null = null;
  let box: HTMLElement | null = null;
  let row: Element | null = null;
  let frame = 0;
  const follow = (): void => {
    frame = 0;
    if (row === null || box === null || host === null) return;
    if (!row.isConnected) {
      clear();
      return;
    }
    const rect = row.getBoundingClientRect();
    box.style.left = `${String(rect.left - 4)}px`;
    box.style.top = `${String(rect.top - 2)}px`;
    box.style.width = `${String(rect.width + 8)}px`;
    box.style.height = `${String(rect.height + 4)}px`;
    frame = win.requestAnimationFrame(follow);
  };
  function clear(): void {
    if (frame !== 0) win.cancelAnimationFrame(frame);
    frame = 0;
    row = null;
    host?.remove();
    host = null;
    box = null;
  }
  return {
    show(next) {
      clear();
      row = next;
      // Under the bar and the layer, over the site.
      host = hostOf(doc, undefined, `${tokens}\n${HIGHLIGHT_CSS}`, FRAME_Z - 2, 'frame-mark');
      host.host.setAttribute('data-scheme', scheme());
      host.host.style.setProperty('inset', '0');
      host.host.style.setProperty('pointer-events', 'none');
      box = doc.createElement('div');
      box.className = 'hl';
      host.root.append(box);
      follow();
    },
    clear,
  };
}
