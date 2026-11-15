// The launcher of a site's page, drawn (decision X46; ui-design §3.13; SP-001, NF-001): one raised card with a button
// per board, top to bottom as the dock's chips stand (launcher.ts `LAUNCHER_TARGETS`). Two looks of one family:
// - `rows` — Fansly's card in the bottom left corner: a row per board, its glyph and its label (2026-10-27: a column,
//   «Онлайн» added; 2026-11-02: «Очереди»). The old Fansly extension had «$» and «Новые» there (`fansly-chat`
//   src/content/bootstrap.css: left 18 px, bottom 18 px, every page).
// - `icons` — ChatSpace's (2026-11-15, the owner: «чтобы не было разницы между фансли и чатспейсом»): the same card,
//   narrow, at the bottom of ChatSpace's 64 px account rail: 32 × 32 buttons with the glyph alone; the label lives in
//   the tooltip and `aria-label`, the same words and keys as Fansly's.
// One chunk of each site's own lazy build, loaded once the tab may show it (the site's starter); plain DOM in a closed
// root: the application — Preact, the kit, the texts — is loaded by the first click, never for the buttons.
//
// - The kit's tokens without the kit's code (ui-design §3.11 «Вход», the vault's entry): a `--cg-raised` card with a
//   hairline of `--cg-rule-2` and `--cg-shadow`, the glyphs in terracotta, the labels in ink; a button's hover and its
//   wait are terracotta's chip. The site's chunk hands the token sheet in (`tokens`), so the card wears the colours of
//   our surfaces (2026-10-20: no palette of its own). The scheme is the one «Тема» gives our surfaces, once the
//   application hands it (`SiteLauncher.follow`); until then the page's own.
// - The glyphs are the dock's chips' own (`online`, `queues`, `coin`, `userNew`, ui kit Icon.tsx), except the dot of
//   «Онлайн»: the kit's green here. The key in the tooltip is the scheme's panel level (⌘⇧M / Ctrl+Alt+M, the vendored
//   key scheme; «Новые» ⌘⇧U / Ctrl+Alt+U, its row outside the scheme on the same modifiers, decision X55); «Онлайн» and
//   «Очереди» have no key of their own (⌘K finds them).

import type { ClosedHost } from './hosts';
import { LAUNCHER_TARGETS, type LauncherTarget, type SiteLauncher } from './launcher';

/** One stroke of a glyph on the 16 px grid: [element, attributes]; `class: fill` a solid mark, `class: dot` the green one. */
type Stroke = readonly [string, Readonly<Record<string, string>>];

/** What a board's button shows: its words (Russian, as the old extension's: the application's language is not read this early), its key, its glyph. */
export interface LauncherFace {
  /** The row's label (`rows`). */
  readonly label: string;
  /** The tooltip, before the key. */
  readonly title: string;
  readonly aria: string;
  /** The board's key in the vendored scheme; null — none of its own. */
  readonly key: 'spenders' | 'newcomers' | null;
  /** The dock chip's glyph (ui kit Icon.tsx). */
  readonly glyph: readonly Stroke[];
}

/** Every board's face: a target of `LAUNCHER_TARGETS` without one here does not compile. */
export const LAUNCHER_FACES: Readonly<Record<LauncherTarget, LauncherFace>> = {
  online: {
    label: 'Онлайн',
    title: 'Фаны онлайн',
    aria: 'Открыть «Онлайн»',
    key: null,
    glyph: [
      ['circle', { cx: '6.4', cy: '5.6', r: '2.7' }],
      ['path', { d: 'M1.8 13.8c.5-2.6 2.3-4.1 4.6-4.1s4.1 1.5 4.6 4.1' }],
      ['circle', { class: 'dot', cx: '12.6', cy: '4.3', r: '2.2' }],
    ],
  },
  queues: {
    label: 'Очереди',
    title: 'Очереди фанов',
    aria: 'Открыть «Очереди»',
    key: null,
    glyph: [
      ['path', { d: 'M6.2 4.2h7.6M6.2 8h7.6M6.2 11.8h7.6' }],
      ['circle', { class: 'fill', cx: '2.9', cy: '4.2', r: '1.1' }],
      ['circle', { cx: '2.9', cy: '8', r: '0.75' }],
      ['circle', { cx: '2.9', cy: '11.8', r: '0.75' }],
    ],
  },
  spenders: {
    label: 'Spenders',
    title: 'Spenders',
    aria: 'Открыть Spenders',
    key: 'spenders',
    glyph: [
      ['circle', { cx: '8', cy: '8', r: '6.2' }],
      ['path', { d: 'M9.9 6.1c-.3-.6-1-1-1.9-1-1 0-1.8.5-1.8 1.3 0 1.8 3.8 1 3.8 3.1 0 .8-.8 1.4-2 1.4-.9 0-1.7-.4-2-1.1M8 4v1.1M8 10.9V12' }],
    ],
  },
  newcomers: {
    label: 'Новые',
    title: 'Новые фоловеры',
    aria: 'Открыть «Новые»',
    key: 'newcomers',
    glyph: [
      ['circle', { cx: '6.4', cy: '5.6', r: '2.7' }],
      ['path', { d: 'M1.8 13.8c.5-2.6 2.3-4.1 4.6-4.1s4.1 1.5 4.6 4.1' }],
      ['path', { class: 'fill', d: 'M12.6 1.4l.78 2.02 2.02.78-2.02.78-.78 2.02-.78-2.02-2.02-.78 2.02-.78z' }],
    ],
  },
};

const isMac = (platform: string): boolean => /mac|darwin|iphone|ipad|ipod/i.test(platform);
/** The key in a button's tooltip: ⌘⇧M / ⌘⇧U on a Mac, Ctrl+Alt+M / Ctrl+Alt+U elsewhere; null — the board has none. */
export const launcherKeyLabel = (key: LauncherFace['key'], platform: string): string | null => {
  if (key === null) return null;
  const letter = key === 'spenders' ? 'M' : 'U';
  return isMac(platform) ? `⌘⇧${letter}` : `Ctrl+Alt+${letter}`;
};

/** `rows` — Fansly's card with a label per row; `icons` — ChatSpace's narrow column in its account rail. */
export type LauncherLook = 'rows' | 'icons';

const HOST_CSS = `:host { all: initial; display: block; font-family: var(--cg-font); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }`;
const CARD_CSS = `
.card {
  display: flex; flex-direction: column; gap: 2px; padding: 4px; border-radius: 14px;
  background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-rule-2), var(--cg-shadow);
}`;
const GLYPH_CSS = `
button:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: -2px; }
svg { width: 16px; height: 16px; flex: none; fill: none; stroke: var(--cg-clay); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
svg .fill { fill: var(--cg-clay); stroke: none; }
svg .dot { fill: var(--cg-money); stroke: none; }
button[aria-busy="true"] svg { animation: l-wait 900ms ease-in-out infinite alternate; }
@keyframes l-wait { to { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { button { transition: none; } button[aria-busy="true"] svg { animation: none; } }
`;

/** Each look's sheet, after the kit's tokens. */
export const LAUNCHER_CSS: Readonly<Record<LauncherLook, string>> = {
  rows: `
${HOST_CSS}${CARD_CSS}
button {
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 14px 0 10px; border-radius: 10px;
  color: var(--cg-ink); font-family: inherit; font-size: 13px; font-weight: 600; line-height: 1; white-space: nowrap; cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
button:hover, button[aria-busy="true"] { background: var(--cg-clay-bg); color: var(--cg-clay-ink); }${GLYPH_CSS}`,
  icons: `
${HOST_CSS}${CARD_CSS}
button {
  all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 10px;
  cursor: pointer; transition: background-color 120ms ease;
}
button:hover, button[aria-busy="true"] { background: var(--cg-clay-bg); }${GLYPH_CSS}`,
};

/** The launcher's sheet in its closed root, after the kit's tokens: adopted, or — where the content script's world refuses — a <style> of its own. */
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

/** How long a kept click shows its wait at most. */
export const BUSY_MS = 15_000;

export interface LauncherViewEnv {
  /** The launcher's host and its closed root (registered for the keys): Fansly's corner overlay, ChatSpace's rail slot. */
  readonly host: Pick<ClosedHost, 'host' | 'root'>;
  readonly launcher: SiteLauncher;
  /** The kit's token sheet (`THEME_CSS`): `--cg-*` on `:host`, the dark values under `data-scheme="dark"`. */
  readonly tokens: string;
  /** `navigator.platform`, for the key in the tooltip. */
  readonly platform: string;
  readonly look: LauncherLook;
}

/** Draws the card with its buttons into the host's root; the answer takes it out (the host stays its site's). */
export function drawLauncher(env: LauncherViewEnv): () => void {
  const { host, launcher, look } = env;
  const doc = host.host.ownerDocument;
  const root = host.root;
  dress(root, doc, `${env.tokens}\n${LAUNCHER_CSS[look]}`);
  const scheme = (): void => host.host.setAttribute('data-scheme', launcher.scheme());
  scheme();
  const offTheme = launcher.onScheme(scheme);
  const card = doc.createElement('div');
  card.className = 'card';
  const buttons = LAUNCHER_TARGETS.map((target) => {
    const face = LAUNCHER_FACES[target];
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('data-launcher', target);
    button.setAttribute('aria-label', face.aria);
    const key = launcherKeyLabel(face.key, env.platform);
    button.title = key === null ? face.title : `${face.title} · ${key}`;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    for (const [name, attributes] of face.glyph) {
      const stroke = doc.createElementNS('http://www.w3.org/2000/svg', name);
      for (const [attribute, value] of Object.entries(attributes)) stroke.setAttribute(attribute, value);
      svg.append(stroke);
    }
    button.append(svg);
    if (look === 'rows') button.append(doc.createTextNode(face.label));
    button.addEventListener('click', () => launcher.ask(target));
    return button;
  });
  card.append(...buttons);
  root.append(card);
  /**
   * The kept click shows on its button until the application takes it — at most BUSY_MS: an application that did not
   * load says nothing here, and the next click asks for it again.
   */
  let timer: ReturnType<typeof setTimeout> | undefined;
  const mark = (waiting: LauncherTarget | null): void => {
    for (const button of buttons) {
      if (button.getAttribute('data-launcher') === waiting) button.setAttribute('aria-busy', 'true');
      else button.removeAttribute('aria-busy');
    }
  };
  const busy = (): void => {
    clearTimeout(timer);
    const waiting = launcher.pending();
    mark(waiting);
    if (waiting !== null) timer = setTimeout(() => mark(null), BUSY_MS);
  };
  busy();
  const offPending = launcher.onPending(busy);
  return () => {
    clearTimeout(timer);
    offTheme();
    offPending();
    card.remove();
  };
}
