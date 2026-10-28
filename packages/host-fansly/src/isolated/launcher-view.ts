// The floating launcher of a Fansly page, drawn (decision X46; ui-design §3.13; SP-001, NF-001): one raised card in
// the bottom left corner with three rows, top to bottom as the dock's chips stand — «Онлайн», «Spenders», «Новые»
// (2026-10-27: a column, «Онлайн» added). The old Fansly extension had «$» and «Новые» there (`fansly-chat`
// src/content/bootstrap.css: left 18 px, bottom 18 px, every page). One chunk of Fansly's own lazy build
// (lazy/fansly/launcher.ts), loaded once the tab is admitted (starter.ts); plain DOM in a closed root: the application
// — Preact, the kit, the texts — is loaded by the first click, never for the buttons.
//
// - The kit's tokens without the kit's code (ui-design §3.11 «Вход», the vault's entry): a `--cg-raised` card with a
//   hairline of `--cg-rule-2` and `--cg-shadow`, the glyphs in terracotta, the labels in ink; a row's hover and its
//   wait are terracotta's chip. The chunk hands the token sheet in (`tokens`, lazy/fansly/launcher.ts), so the card
//   wears the colours of our surfaces (2026-10-20: no palette of its own). The scheme is the one «Тема» gives our
//   surfaces, once the application hands it (`FanslyLauncher.follow`); until then the page's own.
// - Where: fixed, 16 px from the bottom left corner, on our layer under Fansly's modals (mount.ts `LAUNCHER_Z`): a
//   modal of Fansly's covers it, as it covers Fansly's own page. FBuddy's toasts stand bottom right, our toasts top
//   right, the vault's entry bottom right: the corner is nobody's. «Рассылка» folded stands above the card
//   (ui outreach.css.ts `.is-launcher`).
// - The glyphs are the dock's chips' own (`online`, `coin`, `userNew`, ui kit Icon.tsx), except the dot of «Онлайн»:
//   the kit's green here, where the label stands next to it. The key in the tooltip is the scheme's panel level
//   (⌘⇧M / Ctrl+Alt+M, the vendored key scheme; «Новые» ⌘⇧U / Ctrl+Alt+U, its row outside the scheme on the same
//   modifiers, decision X55); «Онлайн» has no key of its own (⌘K finds it).

import type { ClosedHost } from '@cg/host-kit/isolated/hosts';

import type { FanslyLauncher, LauncherTarget } from './launcher';

/** The launcher's words: Russian, as the old extension's (the application's language setting is not read this early). */
export const LAUNCHER_TEXT: Readonly<Record<LauncherTarget, { readonly label: string; readonly title: string; readonly aria: string }>> = {
  online: { label: 'Онлайн', title: 'Фаны онлайн', aria: 'Открыть «Онлайн»' },
  spenders: { label: 'Spenders', title: 'Spenders', aria: 'Открыть Spenders' },
  newcomers: { label: 'Новые', title: 'Новые фоловеры', aria: 'Открыть «Новые»' },
};

const isMac = (platform: string): boolean => /mac|darwin|iphone|ipad|ipod/i.test(platform);
/** ⌘⇧M on a Mac, Ctrl+Alt+M elsewhere: the scheme's `spenders` row at its panel level. */
export const spendersKeyLabel = (platform: string): string => (isMac(platform) ? '⌘⇧M' : 'Ctrl+Alt+M');
/** ⌘⇧U on a Mac, Ctrl+Alt+U elsewhere: «Новые», a row outside the scheme on its panel modifiers (decision X55). */
export const newcomersKeyLabel = (platform: string): string => (isMac(platform) ? '⌘⇧U' : 'Ctrl+Alt+U');

/** The rows top to bottom: the dock's order of its board chips (contracts features/common.ts). */
export const LAUNCHER_ORDER: readonly LauncherTarget[] = ['online', 'spenders', 'newcomers'];

/** The key in a row's tooltip; null — the row has none. */
const keyLabel = (target: LauncherTarget, platform: string): string | null =>
  target === 'spenders' ? spendersKeyLabel(platform) : target === 'newcomers' ? newcomersKeyLabel(platform) : null;

/** The dock chips' glyphs on the 16 px grid (ui kit Icon.tsx): [element, attributes] per stroke; `fill` a solid mark, `dot` the green one. */
const GLYPHS: Readonly<Record<LauncherTarget, readonly (readonly [string, Readonly<Record<string, string>>])[]>> = {
  online: [
    ['circle', { cx: '6.4', cy: '5.6', r: '2.7' }],
    ['path', { d: 'M1.8 13.8c.5-2.6 2.3-4.1 4.6-4.1s4.1 1.5 4.6 4.1' }],
    ['circle', { class: 'dot', cx: '12.6', cy: '4.3', r: '2.2' }],
  ],
  spenders: [
    ['circle', { cx: '8', cy: '8', r: '6.2' }],
    ['path', { d: 'M9.9 6.1c-.3-.6-1-1-1.9-1-1 0-1.8.5-1.8 1.3 0 1.8 3.8 1 3.8 3.1 0 .8-.8 1.4-2 1.4-.9 0-1.7-.4-2-1.1M8 4v1.1M8 10.9V12' }],
  ],
  newcomers: [
    ['circle', { cx: '6.4', cy: '5.6', r: '2.7' }],
    ['path', { d: 'M1.8 13.8c.5-2.6 2.3-4.1 4.6-4.1s4.1 1.5 4.6 4.1' }],
    ['path', { class: 'fill', d: 'M12.6 1.4l.78 2.02 2.02.78-2.02.78-.78 2.02-.78-2.02-2.02-.78 2.02-.78z' }],
  ],
};

export const LAUNCHER_CSS = `
:host { all: initial; display: block; font-family: var(--cg-font); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
.card {
  display: flex; flex-direction: column; gap: 2px; padding: 4px; border-radius: 14px;
  background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-rule-2), var(--cg-shadow);
}
button {
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 14px 0 10px; border-radius: 10px;
  color: var(--cg-ink); font-family: inherit; font-size: 13px; font-weight: 600; line-height: 1; white-space: nowrap; cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
button:hover, button[aria-busy="true"] { background: var(--cg-clay-bg); color: var(--cg-clay-ink); }
button:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: -2px; }
svg { width: 16px; height: 16px; flex: none; fill: none; stroke: var(--cg-clay); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
svg .fill { fill: var(--cg-clay); stroke: none; }
svg .dot { fill: var(--cg-money); stroke: none; }
button[aria-busy="true"] svg { animation: l-wait 900ms ease-in-out infinite alternate; }
@keyframes l-wait { to { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { button { transition: none; } button[aria-busy="true"] svg { animation: none; } }
`;

/** The launcher's sheet in its closed root, after the kit's tokens: adopted, or — where the content script's world refuses — a <style> of its own. */
function dress(root: ShadowRoot, doc: Document, tokens: string): void {
  const css = `${tokens}\n${LAUNCHER_CSS}`;
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
  /** The launcher's host (mount.ts `launcher()`): fixed in the corner, its closed root registered for the keys. */
  readonly host: ClosedHost;
  readonly launcher: FanslyLauncher;
  /** The kit's token sheet (`THEME_CSS`): `--cg-*` on `:host`, the dark values under `data-scheme="dark"`. */
  readonly tokens: string;
  /** `navigator.platform`, for the key in the tooltip. */
  readonly platform: string;
}

/** Draws the card with its rows into the host's root; the answer takes it out (the host stays the mounts'). */
export function drawFanslyLauncher(env: LauncherViewEnv): () => void {
  const { host, launcher } = env;
  const doc = host.host.ownerDocument;
  const root = host.root;
  dress(root, doc, env.tokens);
  const scheme = (): void => host.host.setAttribute('data-scheme', launcher.scheme());
  scheme();
  const offTheme = launcher.onScheme(scheme);
  const card = doc.createElement('div');
  card.className = 'card';
  const buttons = LAUNCHER_ORDER.map((target) => {
    const text = LAUNCHER_TEXT[target];
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('data-launcher', target);
    button.setAttribute('aria-label', text.aria);
    const key = keyLabel(target, env.platform);
    button.title = key === null ? text.title : `${text.title} · ${key}`;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    for (const [name, attributes] of GLYPHS[target]) {
      const stroke = doc.createElementNS('http://www.w3.org/2000/svg', name);
      for (const [key, value] of Object.entries(attributes)) stroke.setAttribute(key, value);
      svg.append(stroke);
    }
    button.append(svg, doc.createTextNode(text.label));
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
