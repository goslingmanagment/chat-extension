// The floating launcher of a Fansly page, drawn (decision X46; ui-design §3.13; SP-001, NF-001): two raised pill
// chips in the bottom left corner — «Spenders» and «Новые» — where the old Fansly extension had «$» and «Новые»
// (`fansly-chat` src/content/bootstrap.css: left 18 px, bottom 18 px, every page). One chunk of Fansly's own lazy
// build (lazy/fansly/launcher.ts), loaded once the tab is admitted (starter.ts); plain DOM in a closed root: the
// application — Preact, the kit, the texts — is loaded by the first click, never for the buttons.
//
// - The dock's chips without the kit's code (ui-design §3.11 «Вход», the vault's entry): the kit's own tokens
//   (`--cg-raised` card, a hairline of `--cg-rule-2`, `--cg-shadow`, the glyph in terracotta, the label in ink; hover
//   and the wait — terracotta's chip), whose sheet the chunk hands in (`tokens`, lazy/fansly/launcher.ts), so the
//   buttons are the chips by the composer in colour and face (2026-10-20: no palette of their own). The scheme is the
//   one «Тема» gives our surfaces, once the application hands it (`FanslyLauncher.follow`); until then the light
//   paper, the default.
// - Where: fixed, 16 px from the bottom left corner, on our layer under Fansly's modals (mount.ts `LAUNCHER_Z`): a
//   modal of Fansly's covers it, as it covers Fansly's own page. FBuddy's toasts stand bottom right, our toasts top
//   right, the vault's entry bottom right: the corner is nobody's.
// - The glyphs are the dock's own chips' (`bill`, `userPlus`, ui kit Icon.tsx); the key in the tooltip is the
//   scheme's panel level (⌘⇧M / Ctrl+Alt+M, the vendored key scheme; «Новые» ⌘⇧U / Ctrl+Alt+U, its row outside the
//   scheme on the same modifiers, decision X55; a test of the stand holds them to the tab's catalog).

import type { ClosedHost } from '@cg/host-kit/isolated/hosts';

import type { FanslyLauncher, LauncherTarget } from './launcher';

/** The launcher's words: Russian, as the old extension's (the application's language setting is not read this early). */
export const LAUNCHER_TEXT: Readonly<Record<LauncherTarget, { readonly label: string; readonly title: string; readonly aria: string }>> = {
  spenders: { label: 'Spenders', title: 'Spenders', aria: 'Открыть Spenders' },
  newcomers: { label: 'Новые', title: 'Новые фоловеры', aria: 'Открыть «Новые»' },
};

const isMac = (platform: string): boolean => /mac|darwin|iphone|ipad|ipod/i.test(platform);
/** ⌘⇧M on a Mac, Ctrl+Alt+M elsewhere: the scheme's `spenders` row at its panel level. */
export const spendersKeyLabel = (platform: string): string => (isMac(platform) ? '⌘⇧M' : 'Ctrl+Alt+M');
/** ⌘⇧U on a Mac, Ctrl+Alt+U elsewhere: «Новые», a row outside the scheme on its panel modifiers (decision X55). */
export const newcomersKeyLabel = (platform: string): string => (isMac(platform) ? '⌘⇧U' : 'Ctrl+Alt+U');

/** The dock chips' glyphs on the 16 px grid: [element, attributes] per stroke. */
const GLYPHS: Readonly<Record<LauncherTarget, readonly (readonly [string, Readonly<Record<string, string>>])[]>> = {
  spenders: [
    ['rect', { x: '1.8', y: '4.2', width: '12.4', height: '7.6', rx: '1.4' }],
    ['circle', { cx: '8', cy: '8', r: '1.7' }],
    ['path', { d: 'M4.3 6.5v.01M11.7 9.5v.01' }],
  ],
  newcomers: [
    ['circle', { cx: '6.4', cy: '5.6', r: '2.6' }],
    ['path', { d: 'M2 13.2c.5-2.4 2.2-3.8 4.4-3.8s3.9 1.4 4.4 3.8M12.6 4.8v4.4M10.4 7h4.4' }],
  ],
};

export const LAUNCHER_CSS = `
:host { all: initial; display: flex; gap: 8px; font-family: var(--cg-font); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
button {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 13px 0 10px;
  border-radius: var(--cg-r-pill); background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-rule-2), var(--cg-shadow);
  color: var(--cg-ink); font-family: inherit; font-size: 13px; font-weight: 600; line-height: 1; white-space: nowrap; cursor: pointer;
  transition: background-color 120ms ease, box-shadow 120ms ease, color 120ms ease;
}
button:hover, button[aria-busy="true"] { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line), var(--cg-shadow); color: var(--cg-clay-ink); }
button:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; }
svg { width: 16px; height: 16px; flex: none; fill: none; stroke: var(--cg-clay); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
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

/** Draws the two buttons into the host's root; the answer takes them out (the host stays the mounts'). */
export function drawFanslyLauncher(env: LauncherViewEnv): () => void {
  const { host, launcher } = env;
  const doc = host.host.ownerDocument;
  const root = host.root;
  dress(root, doc, env.tokens);
  const scheme = (): void => host.host.setAttribute('data-scheme', launcher.scheme() ?? 'light');
  scheme();
  const offTheme = launcher.onScheme(scheme);
  const buttons = (['spenders', 'newcomers'] as const).map((target) => {
    const text = LAUNCHER_TEXT[target];
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('data-launcher', target);
    button.setAttribute('aria-label', text.aria);
    button.title = `${text.title} · ${(target === 'spenders' ? spendersKeyLabel : newcomersKeyLabel)(env.platform)}`;
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
  root.append(...buttons);
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
    for (const button of buttons) button.remove();
  };
}
