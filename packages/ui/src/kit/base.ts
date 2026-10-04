// The kit's base stylesheet (ui-design §2.3, §2.8, §2.9, §6.2): what every
// root of ours needs before any component — the shadow host reset, the root
// with the host font and the 13 px base, the `cg` size container the narrow
// rules key on (§3.3), the button reset, the one focus ring, <kbd> labels,
// the screen-reader-only class, the shared entrance animation and the
// reduced-motion switch. Nothing global: inside a shadow root `:host` is our
// own host element; on an extension page the same rules hold for <html>.

/** The size container every surface root establishes; narrow rules use `@container cg (…)`. */
export const KIT_CONTAINER = 'cg';

/** The class of the element a surface renders into (one per root). */
export const ROOT_CLASS = 'cg-root';

export const BASE_CSS = `
/* ChatSpace's inherited styles stop at our host, except its font (§2.3: the host's font). */
:host { all: initial; display: block; font-family: inherit; }
.cg-root {
  container: ${KIT_CONTAINER} / inline-size;
  font-family: inherit; font-size: var(--cg-text-base); line-height: 18px; font-weight: 400;
  color: var(--cg-ink); text-align: left; letter-spacing: normal; text-transform: none; font-style: normal;
  -webkit-text-size-adjust: 100%; overflow-wrap: break-word;
}
.cg-root--page { font-family: var(--cg-font-page); background: var(--cg-surface); }
.cg-root *, .cg-root *::before, .cg-root *::after { box-sizing: border-box; }
.cg-root :where(p, h1, h2, h3, h4, h5, h6, ul, ol, figure, blockquote, pre) { margin: 0; }
.cg-root :where(button) {
  appearance: none; margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit;
  text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.cg-root :where(button[aria-disabled="true"]) { cursor: default; }
.cg-root :where(input, textarea, select) { font: inherit; color: inherit; margin: 0; }
.cg-root :where(a) { color: inherit; }
.cg-root :focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; border-radius: var(--cg-r-sm); }
.cg-root :focus:not(:focus-visible) { outline: none; }
.cg-root kbd { font: inherit; font-size: var(--cg-text-xs); font-weight: 400; letter-spacing: 0.02em; color: var(--cg-ink-muted); }
.cg-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
@keyframes cg-open { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) {
  .cg-root *, .cg-root *::before, .cg-root *::after { animation-duration: 0s !important; animation-iteration-count: 1 !important; transition: none !important; }
}
`;
