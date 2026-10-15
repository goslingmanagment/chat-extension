// The stylesheet of the extension pages (ui-design §3.10, §4.23, §4.24, §10):
// the 360 px popup, the settings — a column of sections and the section in
// cards — and the debug pages on that same shell. They wear the agency
// identity (decision X32; agency-site, the brand's home): warm paper, ink,
// Literata 800 for headings and Golos Text for the rest, black buttons, the
// gosling's yellow and the pond's blue as the only colours of their own. The
// kit's tokens are re-pointed at the brand here, on the pages only: the dock
// inside ChatSpace never adopts this sheet and keeps the family look (X28).

import { type StyleSource } from '../kit';

/**
 * The brand's palette (agency-site src/styles/tokens.css; the night values are the release site's) and the
 * kit's tokens re-pointed at it. `:root[data-scheme]` outranks the kit's own dark block, so one block serves
 * both schemes; the palette alone differs by scheme.
 */
const BRAND_CSS = `
:root {
  --pg-paper: #f7f3ea; --pg-shade: #e7dfcf; --pg-line: #d9d0be; --pg-line-2: #cfc6b4; --pg-hair: #e9e2d4;
  --pg-ink: #1c1b17; --pg-ink-2: #3a372f; --pg-ink-3: #5a564c; --pg-ink-4: #8d8778;
  --pg-card: #fffdf8; --pg-pond: #8db8d4; --pg-on-pond: #1c1b17; --pg-down: #f4c845; --pg-on-down: #1c1b17;
  --pg-focus: #d0501a; --pg-danger: #b53a17;
  --pg-btn: #1c1b17; --pg-btn-ink: #f7f3ea; --pg-btn-hover: #000;
  --pg-display: 'Literata', Georgia, 'Times New Roman', serif;
  --pg-text: 'Golos Text', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
:root[data-scheme="dark"] {
  --pg-paper: #1c1b17; --pg-shade: #2d2b25; --pg-line: #3d3a33; --pg-line-2: #4a463d; --pg-hair: #312e28;
  --pg-ink: #f7f3ea; --pg-ink-2: #ded7c8; --pg-ink-3: #b0a998; --pg-ink-4: #7f796c;
  --pg-card: #24221d; --pg-pond: #2b4d63; --pg-on-pond: #f7f3ea; --pg-down: #f4c845; --pg-on-down: #1c1b17;
  --pg-focus: #f4c845; --pg-danger: #f07b58;
  --pg-btn: #f7f3ea; --pg-btn-ink: #1c1b17; --pg-btn-hover: #fff;
}
:root, :root[data-scheme] {
  --cg-ink-strong: var(--pg-ink); --cg-ink: var(--pg-ink); --cg-ink-2: var(--pg-ink-2); --cg-ink-muted: var(--pg-ink-3); --cg-ink-faint: var(--pg-ink-4);
  --cg-rule: var(--pg-hair); --cg-rule-2: var(--pg-line); --cg-rule-3: var(--pg-line-2); --cg-rule-float: var(--pg-line);
  --cg-surface: var(--pg-paper); --cg-raised: var(--pg-card); --cg-chip: var(--pg-card); --cg-groove: var(--pg-shade);
  --cg-sunk: color-mix(in srgb, var(--pg-shade) 45%, var(--pg-paper));
  --cg-hover: color-mix(in srgb, var(--pg-shade) 60%, var(--pg-paper));
  --cg-press: var(--pg-shade); --cg-seg-on: var(--pg-card);
  --cg-sel: color-mix(in srgb, var(--pg-down) 32%, var(--pg-card));
  --cg-input-bg: var(--pg-card); --cg-input-border: var(--pg-line-2);
  --cg-feed-bg: var(--pg-shade); --cg-debug-bg: var(--cg-sunk); --cg-nav-bg: var(--pg-paper); --cg-nav-current: var(--pg-shade);
  --cg-scrim: rgb(28 27 23 / 0.36);
  --cg-accent: var(--pg-ink); --cg-focus: var(--pg-focus); --cg-focus-soft: color-mix(in srgb, var(--pg-focus) 30%, transparent);
  --cg-danger: var(--pg-danger); --cg-bar: var(--pg-line-2); --cg-bar-strong: var(--pg-ink-2);
  --cg-clay: var(--pg-ink); --cg-clay-ink: var(--pg-ink); --cg-clay-bg: var(--cg-hover); --cg-clay-line: var(--pg-ink-3);
  --cg-draft: color-mix(in srgb, var(--pg-down) 24%, var(--pg-card)); --cg-draft-hover: color-mix(in srgb, var(--pg-down) 34%, var(--pg-card));
  --cg-shadow-float: 0 18px 40px -20px rgb(28 27 23 / 0.4), 0 2px 6px rgb(28 27 23 / 0.06);
  --cg-font-page: var(--pg-text);
}
`;

export const PAGES_CSS = `${BRAND_CSS}
html, body { margin: 0; padding: 0; background: var(--cg-surface); }
.cg-root--page { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
.cg-root--page :focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; border-radius: 6px; }
.pg-link {
  color: var(--cg-ink-strong); text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 0.22em;
  text-decoration-color: color-mix(in srgb, currentColor 55%, transparent); cursor: pointer;
}
.pg-link:hover { text-decoration-color: currentColor; text-decoration-thickness: 2px; }
.pg-code { font-weight: 500; color: var(--cg-ink-muted); letter-spacing: 0.01em; }
.pg-mono { font-family: var(--cg-mono); font-size: 12.5px; line-height: 18px; }
.pg-logo { display: block; height: auto; color: var(--cg-ink-strong); overflow: visible; }
.pg-art { display: block; height: auto; flex: none; }

/* ── the brand's display face: page titles, card titles, the verdict, the popup's name ── */
.pg-h1, .pg-h2, .pg-stage__t, .pg-popup__hero .pg-popup__line > b, .pg-check__head b, .pg-check__item::before {
  font-family: var(--pg-display); font-weight: 800; font-variant-numeric: lining-nums; color: var(--cg-ink-strong); letter-spacing: -0.012em;
}

/* ── kit controls in the brand (pages only): black primary, paper-white secondary, links for quiet actions ── */
.cg-root--page .cg-btn { height: 34px; padding: 0 12px; gap: 7px; border-radius: 8px; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--cg-ink-strong); }
.cg-root--page .cg-btn--sm { height: 28px; padding: 0 9px; font-size: 13px; border-radius: 7px; }
.cg-root--page .cg-btn--icon { width: 34px; padding: 0; justify-content: center; }
.cg-root--page .cg-btn--sm.cg-btn--icon { width: 28px; }
.cg-root--page .cg-btn:hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-root--page .cg-btn--line { background: transparent; box-shadow: inset 0 0 0 1.5px var(--pg-ink); }
.cg-root--page .cg-btn--line:hover, .cg-root--page .cg-btn--line[aria-expanded="true"], .cg-root--page .cg-btn--line:active { background: var(--pg-btn); box-shadow: inset 0 0 0 1.5px var(--pg-btn); color: var(--pg-btn-ink); }
.cg-root--page .cg-btn--line:hover kbd, .cg-root--page .cg-btn--line:hover .pg-popup__count { color: inherit; opacity: 0.75; }
.cg-root--page .cg-btn.pg-primary { height: 38px; padding: 0 16px; background: var(--pg-btn); color: var(--pg-btn-ink); box-shadow: none; font-weight: 600; }
.cg-root--page .cg-btn.pg-primary:hover { background: var(--pg-btn-hover); color: var(--pg-btn-ink); }
.cg-root--page .cg-btn.pg-primary .cg-ico { color: var(--pg-btn-ink); }
${/* A quiet action and a plain one read as links: the word underlined, no icon beside it (the brand has no icon set). */ ''}
.cg-root--page .cg-btn--quiet, .cg-root--page .cg-btn--plain { padding: 0 6px; color: var(--cg-ink-2); font-weight: 500; text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 0.22em; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); }
.cg-root--page .cg-btn--quiet:hover, .cg-root--page .cg-btn--plain:hover { background: none; color: var(--cg-ink-strong); text-decoration-color: currentColor; }
.cg-root--page .cg-btn--quiet:not(.cg-btn--icon) .cg-ico, .cg-root--page .cg-btn--plain:not(.cg-btn--icon) .cg-ico { display: none; }
.cg-root--page .cg-btn--quiet.cg-btn--icon { text-decoration: none; }
.cg-root--page .cg-btn--quiet.cg-btn--icon:hover { background: var(--cg-hover); }
.cg-root--page .cg-btn[aria-disabled="true"] { color: var(--cg-ink-faint); background: none; box-shadow: inset 0 0 0 1px var(--pg-hair); text-decoration: none; }
.cg-root--page .cg-btn--quiet[aria-disabled="true"], .cg-root--page .cg-btn--plain[aria-disabled="true"] { box-shadow: none; }
.cg-root--page .cg-btn.pg-primary[aria-disabled="true"] { background: var(--pg-shade); color: var(--cg-ink-faint); }
.cg-root--page .cg-btn--line[aria-disabled="true"] { box-shadow: inset 0 0 0 1.5px var(--pg-line-2); }
.cg-root--page .cg-btn kbd { color: var(--cg-ink-muted); font-size: 12px; }
.cg-root--page .cg-ico { color: inherit; }

/* a state dot: ink — fine, the gosling's egg — look here, the beak's red — a failure (always next to its words) */
.cg-root--page .cg-dot { width: 8px; height: 8px; }
.cg-root--page .cg-dot--ink { background: var(--pg-ink); }
.cg-root--page .cg-dot--ring { background: var(--pg-down); box-shadow: inset 0 0 0 1.5px var(--pg-ink); }
${/* On night paper the egg keeps its ink outline: a light ring around it shows where it ends. */ ''}
:root[data-scheme="dark"] .cg-root--page .cg-dot--ring { box-shadow: inset 0 0 0 1.5px var(--pg-ink-2); }
.cg-root--page .cg-dot--danger { background: var(--pg-danger); }

/* a checkbox of the settings is a switch: ink when on, a hairline groove when off; the word next to it says the state */
.pg-page .cg-check--14, .pg-signin .cg-check--14 { gap: 10px; height: 30px; padding: 0; color: var(--cg-ink-strong); font-weight: 500; font-size: inherit; }
.pg-page .cg-check--14 .cg-cb, .pg-signin .cg-check--14 .cg-cb { display: none; }
.pg-page .cg-check--14::before, .pg-signin .cg-check--14::before {
  content: ""; flex: none; width: 38px; height: 22px; border-radius: 99px; background: transparent; box-shadow: inset 0 0 0 1.5px var(--pg-ink-3);
  transition: background-color 140ms var(--cg-ease), box-shadow 140ms var(--cg-ease);
}
.pg-page .cg-check--14::after, .pg-signin .cg-check--14::after {
  content: ""; position: absolute; left: 4px; top: 50%; width: 14px; height: 14px; margin-top: -7px; border-radius: 99px; background: var(--pg-ink-3);
  transition: transform 140ms var(--cg-ease), background-color 140ms var(--cg-ease);
}
.pg-page .cg-check--14, .pg-signin .cg-check--14 { position: relative; }
.pg-page .cg-check--14[aria-checked="true"]::before, .pg-signin .cg-check--14[aria-checked="true"]::before { background: var(--pg-ink); box-shadow: inset 0 0 0 1.5px var(--pg-ink); }
.pg-page .cg-check--14[aria-checked="true"]::after, .pg-signin .cg-check--14[aria-checked="true"]::after { transform: translateX(16px); background: var(--pg-paper); }
.pg-page .cg-check--14[aria-checked="false"], .pg-signin .cg-check--14[aria-checked="false"] { color: var(--cg-ink-2); }
${/* A switch named by its row (the row's name is its aria-label) says nothing more: «Включён» next to a switch that is off
   would read as its state. The word stays for screen readers; a switch with a label of its own keeps it. */ ''}
.pg-page .cg-check--14[aria-label] .cg-check__t { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.pg-page .cg-check--14[aria-disabled="true"], .pg-signin .cg-check--14[aria-disabled="true"] { color: var(--cg-ink-faint); }
.pg-page .cg-check--14[aria-disabled="true"]::before, .pg-signin .cg-check--14[aria-disabled="true"]::before { opacity: 0.45; }
.pg-page .cg-check--14:hover::before, .pg-signin .cg-check--14:hover::before { box-shadow: inset 0 0 0 1.5px var(--pg-ink); }

/* a choice of a few words: a groove of shade with the chosen word on paper-white */
.pg-page .cg-seg--md { flex-wrap: wrap; max-width: 100%; padding: 3px; gap: 2px; border-radius: 10px; background: var(--pg-shade); box-shadow: none; }
.pg-page .cg-seg--md .cg-seg__b { height: 32px; padding: 0 14px; border-radius: 7px; color: var(--cg-ink-2); font-weight: 500; }
.pg-page .cg-seg--md .cg-seg__b:hover { color: var(--cg-ink-strong); }
.pg-page .cg-seg--md .cg-seg__b[aria-pressed="true"] { background: var(--pg-card); color: var(--cg-ink-strong); font-weight: 600; box-shadow: 0 1px 2px rgb(28 27 23 / 0.12); }
:root[data-scheme="dark"] .pg-page .cg-seg--md .cg-seg__b[aria-pressed="true"] { background: var(--pg-ink); color: var(--pg-paper); }
.cg-root--page .cg-field { min-height: 40px; padding: 9px 12px; border-color: var(--pg-line-2); border-radius: 8px; font-size: 15px; line-height: 20px; }
.cg-root--page .cg-field:hover { border-color: var(--pg-ink-3); }
.cg-root--page .cg-field:focus, .cg-root--page .cg-field:focus-visible { border-color: var(--pg-ink-2); box-shadow: 0 0 0 3px var(--cg-focus-soft); }
.cg-root--page .cg-menu { border-radius: 12px; padding: 6px; }
.cg-root--page .cg-field::placeholder { color: var(--pg-ink-4); }
${/* ST-016: a store newer than this build — every control reads «look, do not touch». */ ''}
.pg-page .cg-seg__b[aria-disabled="true"], .pg-page .pg-step:has([aria-disabled="true"]):not(:has(.pg-step__b:not([aria-disabled="true"]))), .pg-page .pg-choice[aria-disabled="true"], .pg-page .pg-pick[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
.cg-root--page .cg-toast { border-radius: 14px; }

/* ── popup (§4.23): the persona's name in the display face, the facts on one paper-white card ── */
/* Firefox makes the panel under the button as wide as the document itself asks for, and the root is a size container
   (.cg-root): by itself it asks for nothing, and the panel opens as a line 0 px wide. So the popup's root says its
   width; where the browser gives the width (the overflow menu of a narrow window) the root just fills it. */
.cg-root--page[data-cg-surface="popup"] { contain-intrinsic-inline-size: 360px; }
.pg-site-access { box-sizing: border-box; max-width: 520px; margin: 12px; padding: 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pg-site-access > .cg-card { flex-basis: 100%; }
:root:has(.pg-popup) .pg-site-access { max-width: 336px; }
.pg-popup { width: 360px; max-width: 100%; font-size: 14px; line-height: 20px; color: var(--cg-ink-2); background: var(--cg-surface); overflow: hidden; }
.pg-popup__head { display: flex; align-items: flex-end; gap: 10px; padding: 16px 16px 2px; }
.pg-popup__head .pg-logo { width: 116px; }
.pg-popup__ver { margin-left: auto; padding-bottom: 2px; font-size: 12.5px; line-height: 16px; color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; }
.pg-popup__hero { padding: 16px 16px 0; min-width: 0; }
.pg-popup__hero .pg-popup__cap { font-size: 13px; color: var(--cg-ink-muted); }
.pg-popup__hero .pg-popup__line { display: block; }
.pg-popup__hero .pg-popup__line > b { display: block; margin-top: 1px; font-size: 27px; line-height: 34px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pg-popup__hero .pg-popup__line > b.pg-popup__none { color: var(--cg-ink-muted); }
.pg-popup__hero .pg-popup__line--fit > .pg-popup__aside { display: block; min-width: 0; text-align: left; color: var(--cg-ink-2); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pg-popup__hero .pg-popup__under { margin-top: 0; text-align: left; }
.pg-pills { display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 12px 16px 14px; }
.pg-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; line-height: 18px; color: var(--cg-ink-2); white-space: nowrap; }
.pg-pill b { font-weight: 600; color: var(--cg-ink-strong); }
.pg-pill .cg-ico { color: var(--cg-ink-strong); }
.pg-popup__card { margin: 0 16px; padding: 0 14px; border-radius: 14px; background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--pg-line); }
.pg-popup__card > .pg-popup__sec { padding: 11px 0 12px; }
${/* On the card a value keeps its words whole and the note beside it goes to a line of its own when both do not fit. */ ''}
.pg-popup__card .pg-popup__line { flex-wrap: wrap; column-gap: 12px; row-gap: 0; }
.pg-popup__card .pg-popup__line > b { flex: 0 1 auto; max-width: 100%; }
.pg-popup__card .pg-popup__aside { margin-left: auto; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.pg-popup__card > .pg-popup__sec + .pg-popup__sec { border-top: 1px solid var(--cg-rule); }
.pg-popup__sec { padding: 10px 16px; min-width: 0; }
.pg-popup__cap { font-size: 12.5px; line-height: 18px; color: var(--cg-ink-muted); }
.pg-popup__line { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; }
.pg-popup__line > b, .pg-popup__main { font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.pg-popup__line > b .cg-dot { margin-right: 7px; vertical-align: 1px; }
.pg-popup__line .cg-btn--quiet { height: 22px; margin: -2px -6px -2px 0; font-size: 13px; color: var(--cg-ink-muted); }
.pg-popup__aside { flex: none; color: var(--cg-ink-muted); font-size: 12.5px; white-space: nowrap; }
/* A row whose right side is somebody's free text (a page title): it gives way first and ends in «…»; the name on the
   left is cut only once the title is down to its 30 %, so neither is ever squeezed out and the row never grows. */
.pg-popup__line--fit > b { flex: 0 1 auto; }
.pg-popup__line--fit > .pg-popup__aside { flex: 0 1000 auto; min-width: 30%; overflow: hidden; text-overflow: ellipsis; text-align: right; }
.pg-popup__under { margin-top: 1px; min-width: 0; font-size: 13px; color: var(--cg-ink-muted); text-align: right; }
/* The tag is its own box of the row's width: a long label ends in «…» inside it and never reaches past the popup. */
.pg-popup__under .pg-pagetag { display: block; font-size: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; overflow-wrap: normal; }
.pg-popup__copy { font: inherit; color: inherit; border-radius: 4px; }
.pg-popup__copy:hover { color: var(--cg-ink-strong); text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 0.22em; }
.pg-popup__err { font-size: 13px; line-height: 18px; color: var(--cg-ink-2); }
.pg-popup__err + .pg-popup__err { margin-top: 8px; }
.pg-popup__err .pg-code { display: flex; align-items: center; gap: 7px; }
.pg-popup__problems { margin: 0 16px 10px; padding: 12px 14px; border-radius: 14px; background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--pg-line); }
${/* What opens inside ChatSpace in a row, «Настройки» in ink beside a short last one: one primary, never a grid of equals. */ ''}
.pg-popup__btns { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; padding: 14px 16px 16px; }
.pg-popup__btns .cg-btn { grid-column: span 3; justify-content: flex-start; height: 38px; padding: 0 12px; min-width: 0; }
.pg-popup__btns .cg-btn.pg-popup__short { grid-column: span 2; }
.pg-popup__btns .cg-btn.pg-primary { grid-column: span 4; justify-content: center; }
.pg-popup__btns .cg-btn.pg-primary .pg-popup__key { display: none; }
.pg-popup__btns .cg-btn.pg-primary.pg-popup__wide { grid-column: 1 / -1; }
.pg-popup__count { font-weight: 500; color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; }
${/* Why the buttons above do not work, said on the popup and not only in their tooltips. */ ''}
.pg-popup__why { display: flex; align-items: flex-start; gap: 8px; margin: -4px 16px 14px; font-size: 13px; line-height: 18px; color: var(--cg-ink-2); }
.pg-popup__why .cg-dot { margin-top: 5px; }
.pg-popup__key { margin-left: auto; display: inline-flex; }
.pg-popup__foot { display: flex; align-items: center; gap: 12px; padding: 11px 16px 13px; border-top: 1px solid var(--pg-line); font-size: 13px; color: var(--cg-ink-muted); white-space: nowrap; }
.pg-popup__foot .pg-link { color: var(--cg-ink-2); }
.pg-popup__foot .cg-btn { margin-left: auto; margin-right: -6px; }
/* The card of a popup state stands on the popup's own edge: no gutter, the dot inside the code line. */
.pg-popup__state { margin: 12px 16px 4px; padding: 16px; border-radius: 14px; background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--pg-line); }
.pg-popup__state .cg-card__acts { margin-left: 0; margin-top: 12px; }
.pg-popup__state .cg-card__title { font-family: var(--pg-display); font-weight: 800; font-size: 20px; line-height: 26px; letter-spacing: -0.01em; }
.pg-popup__lead { color: var(--cg-ink-2); margin: 10px 0 0; }
.pg-popup .cg-state { padding: 20px 18px; }

/* ── settings shell (§4.24): the column of sections, the section's title, its cards ── */
.pg-page { display: grid; grid-template-columns: 264px minmax(0, 1fr); min-height: 100vh; font-size: 15px; line-height: 22px; color: var(--cg-ink-2); background: var(--cg-surface); }
.pg-nav { position: sticky; top: 0; align-self: start; height: 100vh; display: flex; flex-direction: column; gap: 2px; padding: 28px 16px 20px; border-right: 1px solid var(--pg-line); background: var(--cg-nav-bg); overflow-y: auto; }
.pg-brand { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 4px 12px; padding: 0 12px 24px; }
.pg-brand .pg-logo { width: 152px; }
.pg-brand span { font-size: 13px; line-height: 18px; color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; }
.pg-brand__for { flex-basis: 100%; font-size: 14px; color: var(--cg-ink-muted); }
.pg-nav__a { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 12px; border-radius: 8px; color: var(--cg-ink-2); font-weight: 500; text-decoration: none; }
.pg-nav__a:hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.pg-nav__a[aria-current="page"] { background: var(--pg-shade); color: var(--cg-ink-strong); font-weight: 600; }
.pg-nav__a .cg-dot { margin-left: auto; }
.pg-nav__foot { margin-top: auto; padding: 18px 12px 0; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; font-size: 13.5px; line-height: 20px; color: var(--cg-ink-muted); }
.pg-tag { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; margin-left: 8px; border-radius: 5px; background: var(--pg-down); color: var(--pg-on-down); font-size: 11.5px; line-height: 18px; font-weight: 600; white-space: nowrap; vertical-align: 1px; text-decoration: none; }
.pg-main { min-width: 0; padding: 40px 48px 72px; }
.pg-main > * { max-width: 1040px; }
.pg-select { display: none; margin-bottom: 20px; }
.pg-head { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 24px; margin-bottom: 28px; }
.pg-head > :first-child { min-width: 0; flex: 1 1 420px; }
.pg-h1 { margin: 0; font-size: 40px; line-height: 44px; letter-spacing: -0.02em; text-wrap: balance; }
.pg-lead { margin: 10px 0 0; max-width: 64ch; font-size: 16px; line-height: 24px; color: var(--cg-ink-2); }
.pg-h2 { margin: 0 0 4px; font-size: 21px; line-height: 26px; }
.pg-note { margin: 14px 0 0; max-width: 72ch; font-size: 13.5px; line-height: 20px; color: var(--cg-ink-muted); }
.pg-sub { margin-top: 6px; font-size: 13.5px; line-height: 20px; color: var(--cg-ink-muted); }

/* cards: paper-white on paper, a hairline, no shadow; a wide section puts a quieter column beside the main one */
.pg-card { container: pg-card / inline-size; min-width: 0; padding: 22px 24px 10px; border-radius: 16px; background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--pg-line); }
${/* The column beside the main one is the brand's quiet band: shade, no edge; what it holds is secondary. */ ''}
.pg-grid:not(.pg-grid--even) > .pg-col:last-child > .pg-card { background: color-mix(in srgb, var(--pg-shade) 62%, var(--pg-paper)); box-shadow: none; }
:root[data-scheme="dark"] .pg-grid:not(.pg-grid--even) > .pg-col:last-child > .pg-card { background: var(--pg-shade); }
.pg-card--quiet.pg-card--quiet { background: color-mix(in srgb, var(--pg-shade) 62%, var(--pg-paper)); box-shadow: none; }
:root[data-scheme="dark"] .pg-card--quiet.pg-card--quiet { background: var(--pg-shade); }
.pg-card + .pg-card, .pg-card + .pg-grid, .pg-grid + .pg-card, .pg-grid + .pg-grid { margin-top: 16px; }
.pg-card__lead { margin: 0 0 6px; max-width: 64ch; font-size: 13.5px; line-height: 20px; color: var(--cg-ink-muted); }
.pg-card > .pg-note:last-child { margin: 12px 0 14px; }
.pg-card--flat { padding-bottom: 22px; }
.pg-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.pg-grid--even { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.pg-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.pg-col > .pg-card + .pg-card { margin-top: 0; }

/* the save state: «Сохранено ✓» only with the background's revision (ST-014) */
.pg-save { flex: none; display: inline-flex; align-items: center; gap: 7px; min-height: 34px; font-size: 13.5px; line-height: 20px; color: var(--cg-ink-muted); white-space: nowrap; }
.pg-save[data-pg-save="saved"] { color: var(--cg-ink-strong); font-weight: 500; }
.pg-save--failed { color: var(--cg-ink-2); }
.pg-save .cg-btn { margin-left: 2px; }

/* a section that could not be read or reached: the kit's error card, on a card of its own (ST-017) */
.pg-main > .cg-card { margin: 0 0 16px; padding: 18px 20px 18px 0; border-radius: 16px; background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--pg-line); }
.pg-main > .cg-card .cg-card__title { font-size: 16px; line-height: 22px; }
.pg-main > .cg-card .cg-card__acts { margin-top: 10px; }

/* the deep-link plate (ST-008) and the read-only barrier (ST-016): the gosling's yellow, the code and what it means */
.pg-plate { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; align-items: start; gap: 0 14px; margin: 0 0 16px; padding: 16px 18px 16px 20px; border-radius: 16px; background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--pg-line); font-size: 14px; line-height: 20px; color: var(--cg-ink-2); }
.pg-plate > .cg-dot { margin-top: 6px; justify-self: center; }
.pg-plate .pg-code { color: var(--cg-ink-2); }
.pg-plate__t { font-weight: 600; color: var(--cg-ink-strong); }
.pg-plate__b { color: var(--cg-ink-2); }
.pg-plate .cg-btn { margin: -6px -8px 0 0; }

/* the first-run checklist (ST-012): a card of numbered steps, as on the site's «Как начать» */
.pg-check { margin: 0 0 16px; padding: 22px 24px 10px; border-radius: 16px; background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--pg-line); }
.pg-check__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 12px; }
.pg-check__head b { font-size: 21px; line-height: 26px; white-space: nowrap; }
.pg-check__head span { color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pg-check__head .cg-btn { margin-left: auto; }
.pg-check__lead { margin: 4px 0 8px; font-size: 13.5px; line-height: 20px; color: var(--cg-ink-muted); }
.pg-check__list { margin: 0; padding: 0; list-style: none; counter-reset: pg-step; }
.pg-check__item { counter-increment: pg-step; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 0 12px; min-height: 48px; border-top: 1px solid var(--cg-rule); color: var(--cg-ink-2); }
.pg-check__item > :first-child { justify-self: center; color: var(--cg-ink-muted); }
.pg-check__item:not(.is-done) > .cg-dot { display: none; }
.pg-check__item::before { content: counter(pg-step); grid-row: 1; grid-column: 1; justify-self: center; font-size: 19px; line-height: 24px; }
.pg-check__item.is-done::before { content: none; }
${/* A step done is a quiet line with its tick; a step to do has its number in the display face, its words and its action. */ ''}
.pg-check__item.is-done { min-height: 34px; color: var(--cg-ink-muted); font-size: 14px; }
.pg-check__item:not(.is-done) .pg-check__t { color: var(--cg-ink-strong); font-weight: 600; }
.pg-check__item .cg-btn--quiet { justify-self: end; }
${/* R20 P14b1: a site's own steps under the eight, a subheading over their own numbered list. */ ''}
.pg-check__group { margin-top: 10px; }
.pg-check__sub { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 12px; padding: 10px 0 6px; border-top: 1px solid var(--cg-rule); }
.pg-check__sub b { font-family: var(--pg-display); font-weight: 800; font-size: 16px; line-height: 22px; color: var(--cg-ink-strong); }
.pg-check__sub span { color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pg-check__item > .pg-site-access { justify-self: end; }

/* R20 P14b1: a site's own card in a shared section («Аккаунты», the sign-in screen) */
.pg-sitecard { position: relative; }
.pg-sitecard + .pg-intro.pg-intro, .pg-sitecard + .pg-note { margin-top: 16px; }
.pg-sitecard__save { position: absolute; top: 18px; right: 24px; }
.pg-signin .pg-sitecard { margin-top: 16px; }
${/* The P9a hook of a site's switch (the button inside `.pg-site-access`), here a plain wrapper of the button. */ ''}
.pg-sitecard .pg-site-access, .pg-check__item .pg-site-access { margin: 0; padding: 0; max-width: none; display: inline-flex; }
${/* A site's own tone row has no switch of its own: the room of one, so its picker stands under the shared ones. */ ''}
.pg-tone-pad { flex: none; width: 38px; }

/* «Статус» (§4.24): the verdict on the stage — the pond when ready, the gosling's yellow when something waits — then the rows */
.pg-sum { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 6px 24px; margin: 0 0 16px; padding: 28px 32px 26px; border-radius: 28px; background: var(--pg-pond); color: var(--pg-on-pond); overflow: hidden; }
.pg-sum[data-pg-readiness="actions-needed"] { background: var(--pg-down); color: var(--pg-on-down); }
.pg-sum[data-pg-readiness="unknown"] { background: var(--pg-shade); color: var(--cg-ink-strong); }
.pg-sum > b, .pg-sum > span { grid-column: 1; min-width: 0; }
.pg-sum b { display: block; font-family: var(--pg-display); font-weight: 800; font-size: 34px; line-height: 40px; letter-spacing: -0.015em; color: inherit; }
.pg-sum > span:not(.pg-acts) { display: block; margin-top: -2px; font-size: 16px; line-height: 24px; color: inherit; }
.pg-sum .pg-acts { margin: 12px 0 0; display: flex; flex-wrap: wrap; gap: 8px; }
.pg-sum .cg-btn--line:not(.pg-primary) { height: 38px; padding: 0 14px; background: transparent; box-shadow: inset 0 0 0 1.5px currentColor; color: inherit; }
.pg-sum .cg-btn--line:not(.pg-primary):hover { background: var(--pg-ink); box-shadow: inset 0 0 0 1.5px var(--pg-ink); color: var(--pg-paper); }
.pg-sum .pg-art { grid-column: 2; grid-row: 1 / span 3; align-self: end; width: 236px; margin: 0 -4px -26px 0; }
${/* The goose looking back stands taller than the goslings: it is cut by the stage's floor like the site's hero goose. */ ''}
.pg-sum .pg-art--lost { width: 112px; margin: -48px 10px -26px 0; }
:root[data-scheme="dark"] .pg-sum .cg-btn--line:not(.pg-primary):hover { background: var(--pg-on-pond); box-shadow: inset 0 0 0 1.5px var(--pg-on-pond); color: var(--pg-pond); }
:root[data-scheme="dark"] .pg-sum[data-pg-readiness="actions-needed"] .cg-btn--line:not(.pg-primary):hover { background: var(--pg-on-down); color: var(--pg-down); }
.pg-acts { display: flex; flex-wrap: wrap; gap: 8px; }
.pg-row { display: grid; grid-template-columns: 14px minmax(140px, 190px) minmax(0, 1fr) auto; align-items: start; gap: 0 16px; padding: 14px 0; border-bottom: 1px solid var(--cg-rule); }
.pg-card > .pg-row:last-child { border-bottom: 0; }
.pg-row > .cg-dot { margin-top: 7px; justify-self: center; }
${/* Silence is a signal (§1 п. 7): a row that is fine has no mark; the egg and the red dot stand only where to look. */ ''}
.pg-row[data-pg-level="ok"] > .cg-dot { visibility: hidden; }
.pg-row__k { color: var(--cg-ink-2); }
.pg-row__v { color: var(--cg-ink-strong); font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.pg-row__v small { display: block; margin-top: 2px; font-size: 13.5px; line-height: 20px; font-weight: 400; color: var(--cg-ink-muted); }
.pg-row__a { justify-self: end; margin: -6px 0; }
.pg-card--rows .pg-row { grid-template-columns: 14px minmax(0, 1fr) auto; padding: 10px 0; }
.pg-card--rows .pg-row > .pg-row__v { display: contents; }
.pg-card--rows .pg-row__v small { grid-column: 2 / -1; margin-top: 0; }
${/* The value of a service row is short («включён», «3 генерации»): it sits at the right end of its name's line. */ ''}
.pg-card--rows { padding-top: 8px; }
.pg-card .pg-note:last-child { margin-bottom: 14px; }
.pg-row.is-target, .pg-opt.is-target, .pg-zone.is-target { animation: pg-target 2s var(--cg-ease); }
@keyframes pg-target { 0%, 60% { background: color-mix(in srgb, var(--pg-down) 30%, transparent); box-shadow: 0 0 0 8px color-mix(in srgb, var(--pg-down) 30%, transparent); } 100% { background: transparent; box-shadow: 0 0 0 8px transparent; } }

/* option rows inside a card: the name and its hint on the left, the control on the right; a narrow card stacks them */
.pg-opt { display: grid; grid-template-columns: minmax(150px, 32%) minmax(0, 1fr); gap: 10px 24px; padding: 16px 0; border-bottom: 1px solid var(--cg-rule); }
.pg-card > .pg-opt:last-child, .pg-card > :last-child > .pg-opt:last-child { border-bottom: 0; }
.pg-opt__k b { display: block; font-weight: 600; color: var(--cg-ink-strong); }
.pg-opt__k span { display: block; margin-top: 2px; font-size: 13.5px; line-height: 20px; color: var(--cg-ink-muted); }
.pg-opt__v { min-width: 0; }
.pg-opt__v--center { display: flex; align-items: center; }
${/* A row whose control is small — a stepper, a lone switch — keeps it at the card's right edge, as the Fansly extension did. */ ''}
.pg-opt:has(> .pg-opt__v > .pg-line > .pg-step), .pg-opt:has(> .pg-opt__v > .cg-check--14:only-child) { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
.pg-opt:has(> .pg-opt__v > .pg-line > .pg-step) > .pg-opt__v, .pg-opt:has(> .pg-opt__v > .cg-check--14:only-child) > .pg-opt__v { justify-self: end; text-align: right; }
.pg-opt:has(> .pg-opt__v > .pg-line > .pg-step) > .pg-opt__v > .pg-line { justify-content: flex-end; }
@container pg-card (max-width: 420px) {
  .pg-opt { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .pg-row { grid-template-columns: 14px minmax(0, 1fr); }
  .pg-row > .pg-row__v, .pg-row > .pg-row__a { grid-column: 2; }
  .pg-row > .pg-row__a { justify-self: start; margin: 6px 0 0 -6px; }
}
.pg-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; }
${/* What stands between a section's title and its cards: a line of state and actions, or a note. */ ''}
.pg-intro.pg-intro { margin: 0 0 16px; }
.pg-value { color: var(--cg-ink-strong); font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
.pg-muted { color: var(--cg-ink-muted); }
.pg-pagetag { color: var(--cg-ink-muted); font-size: 13.5px; font-weight: 400; overflow-wrap: anywhere; }
.pg-value > .pg-pagetag { margin-left: 8px; }
.pg-pick { gap: 6px; min-width: 132px; justify-content: space-between; }
.pg-pick .cg-ico { color: var(--cg-ink-muted); }
.pg-page .cg-menu { z-index: 20; max-height: 320px; overflow-y: auto; }
.pg-field { width: 300px; max-width: 100%; }
.pg-field--wide { width: 380px; }

/* «Вид ответа»: two choice cards with a miniature of the chat (§4.24) */
.pg-choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.pg-choice { display: block; width: 100%; padding: 10px; border-radius: 16px; background: var(--pg-card); box-shadow: inset 0 0 0 1px var(--pg-line); text-align: left; }
.pg-choice:hover { box-shadow: inset 0 0 0 1px var(--pg-ink-3); }
.pg-choice[aria-checked="true"] { box-shadow: inset 0 0 0 2px var(--pg-ink); }
.pg-choice[aria-disabled="true"] { cursor: default; }
.pg-choice__t { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-weight: 600; color: var(--cg-ink-strong); }
.pg-radio { flex: none; width: 16px; height: 16px; border-radius: 99px; box-shadow: inset 0 0 0 1.5px var(--pg-ink-3); }
.pg-choice[aria-checked="true"] .pg-radio { background: var(--pg-down); box-shadow: inset 0 0 0 1.5px var(--pg-ink), inset 0 0 0 4.5px var(--pg-card); }
.pg-mini { height: 96px; padding: 8px; border-radius: 8px; background: var(--cg-feed-bg); display: flex; flex-direction: column; justify-content: flex-end; gap: 4px; overflow: hidden; }
.pg-mini i { display: block; height: 6px; border-radius: 3px; background: var(--pg-line-2); }
/* «без подложки»: the result and the bar are one card; «на подложке»: the result is a card of its own above the bar */
.pg-mini__res { display: flex; flex-direction: column; gap: 3px; margin-bottom: -4px; padding: 4px; background: var(--cg-raised); border: 1px solid var(--pg-line); border-bottom-color: var(--pg-hair); border-radius: 5px 5px 0 0; }
.pg-mini__res i { height: 7px; border-radius: 3px; background: var(--cg-draft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pg-down) 60%, var(--pg-line)); }
:root[data-scheme="dark"] .pg-mini__res i { background: color-mix(in srgb, var(--pg-down) 55%, var(--pg-card)); box-shadow: none; }
.pg-mini__res.is-sheet { margin-bottom: -2px; border-bottom-color: var(--pg-line); border-radius: 5px; }
.pg-mini__strip { display: flex; align-items: center; gap: 3px; height: 13px; padding: 0 4px; background: var(--cg-raised); border: 1px solid var(--pg-line); border-top: 0; border-radius: 0 0 5px 5px; }
.pg-mini__res.is-sheet + .pg-mini__strip { border-top: 1px solid var(--pg-line); border-radius: 5px; }
.pg-mini__strip i { width: 16px; height: 5px; background: var(--pg-line-2); }
.pg-mini__strip i:first-child { background: var(--pg-ink); }
.pg-mini__comp { height: 18px; border-radius: 5px; background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--pg-line); }

/* «Тема»: four cards, each a page in miniature in the theme's own colours (they show the theme, so they are not tokens) */
.pg-choices--themes { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@container pg-card (max-width: 640px) { .pg-choices--themes { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.pg-choices--themes .pg-choice { padding: 8px; }
.pg-choices--themes .pg-choice__t { margin-top: 8px; gap: 7px; font-size: 13.5px; line-height: 18px; white-space: nowrap; }
.pg-tmini { position: relative; display: block; height: 64px; border-radius: 8px; overflow: hidden; box-shadow: inset 0 0 0 1px var(--pg-line); }
.pg-tmini__s { position: absolute; inset: 0; display: grid; grid-template-columns: 24% minmax(0, 1fr); gap: 6px; padding: 7px; background: #f7f3ea; }
.pg-tmini__s > i { border-radius: 4px; background: #e7dfcf; }
.pg-tmini__s > b { display: flex; flex-direction: column; justify-content: center; gap: 5px; padding: 0 8px; border-radius: 5px; background: #fffdf8; box-shadow: inset 0 0 0 1px #d9d0be; }
.pg-tmini__s > b > i { display: block; height: 5px; border-radius: 3px; background: #d9d0be; }
.pg-tmini__s > b > i:last-child { width: 42%; background: #1c1b17; }
.pg-tmini__s--dark { background: #1c1b17; }
.pg-tmini__s--dark > i { background: #2d2b25; }
.pg-tmini__s--dark > b { background: #24221d; box-shadow: inset 0 0 0 1px #3d3a33; }
.pg-tmini__s--dark > b > i { background: #4a463d; }
.pg-tmini__s--dark > b > i:last-child { background: #f7f3ea; }
${/* «Как в системе» and «Как в ChatSpace» are both halves; ChatSpace's own greys tell the second from the first. */ ''}
.pg-tmini[data-pg-tmini="system"] .pg-tmini__s--dark, .pg-tmini[data-pg-tmini="host"] .pg-tmini__s--dark { clip-path: inset(0 0 0 50%); }
.pg-tmini[data-pg-tmini="host"] .pg-tmini__s--light { background: #ffffff; }
.pg-tmini[data-pg-tmini="host"] .pg-tmini__s--light > i { background: #f1f1ee; }
.pg-tmini[data-pg-tmini="host"] .pg-tmini__s--light > b { background: #ffffff; box-shadow: inset 0 0 0 1px #e1e0da; }
.pg-tmini[data-pg-tmini="host"] .pg-tmini__s--light > b > i { background: #cbcac3; }
.pg-tmini[data-pg-tmini="host"] .pg-tmini__s--light > b > i:last-child { background: #3d3b32; }
.pg-tmini[data-pg-tmini="host"] .pg-tmini__s--dark { background: #13120f; }
.pg-tmini[data-pg-tmini="host"] .pg-tmini__s--dark > i { background: #222019; }
.pg-tmini[data-pg-tmini="host"] .pg-tmini__s--dark > b { background: #1a1813; box-shadow: inset 0 0 0 1px #33312a; }

/* the volume slider: a 4 px track, a 16 px knob with an ink ring (§4.24) */
.pg-range { appearance: none; -moz-appearance: none; width: 240px; max-width: 100%; height: 16px; margin: 0; background: transparent; cursor: pointer; }
.pg-range::-moz-range-track { height: 4px; border-radius: 2px; background: var(--pg-line-2); }
.pg-range::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--pg-ink); }
.pg-range::-moz-range-thumb { width: 16px; height: 16px; border: 0; border-radius: 99px; background: var(--pg-card); box-shadow: inset 0 0 0 2px var(--pg-ink); }
.pg-range::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: var(--pg-line-2); }
.pg-range::-webkit-slider-thumb { appearance: none; width: 16px; height: 16px; margin-top: -6px; border-radius: 99px; background: var(--pg-card); box-shadow: inset 0 0 0 2px var(--pg-ink); }
.pg-range[aria-disabled="true"] { cursor: default; opacity: 0.6; }
.pg-range__v { min-width: 28px; color: var(--cg-ink-strong); font-weight: 600; font-variant-numeric: tabular-nums; }

/* the message-window stepper: − N +, typed by hand; the wheel does nothing (ST-094) */
.pg-step { display: inline-flex; align-items: center; height: 36px; border-radius: 8px; background: var(--pg-card); box-shadow: inset 0 0 0 1px var(--pg-line-2); }
.pg-step:focus-within { box-shadow: inset 0 0 0 1px var(--pg-ink-2), 0 0 0 3px var(--cg-focus-soft); }
.pg-step__b { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; color: var(--cg-ink-strong); font-size: 17px; line-height: 1; }
.pg-step__b:hover { background: var(--cg-hover); }
.pg-step__b[aria-disabled="true"] { color: var(--cg-ink-faint); background: none; cursor: default; }
.pg-step__i { width: 64px; height: 36px; padding: 0 4px; border: 0; border-left: 1px solid var(--pg-hair); border-right: 1px solid var(--pg-hair); outline: 0; background: none; text-align: center; font: inherit; color: var(--cg-ink-strong); font-weight: 600; font-variant-numeric: tabular-nums; }
.pg-step__i:focus-visible { outline: 0; }
.pg-chip { display: inline-flex; align-items: center; height: 24px; padding: 0 9px; border-radius: 6px; background: var(--pg-shade); font-size: 13px; color: var(--cg-ink-2); white-space: nowrap; font-variant-numeric: tabular-nums; }

/* the hotkeys' reference: groups in columns, a row is the action and its keys; what does not work as usual says so under it */
.pg-keys { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px 40px; }
.pg-keys > thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.pg-keys > tbody { display: block; min-width: 0; }
.pg-table.pg-keys tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 12px; border-bottom: 1px solid var(--cg-rule); }
.pg-table.pg-keys tr:last-child { border-bottom: 0; }
.pg-table.pg-keys td { display: block; padding: 9px 0; border: 0; }
.pg-table.pg-keys td:nth-child(2) { justify-self: end; text-align: right; }
.pg-table.pg-keys td[data-pg-delivery] { grid-column: 1 / -1; padding: 0 0 9px; margin-top: -5px; font-size: 13px; line-height: 18px; }
.pg-table.pg-keys td[data-pg-delivery="delivered"], .pg-table.pg-keys td[data-pg-delivery="cancelable"], .pg-table.pg-keys td[data-pg-delivery="none"] { display: none; }
.pg-table.pg-keys .pg-table__group { display: block; border-bottom: 2px solid var(--pg-ink); }
.pg-table.pg-keys .pg-table__group th { display: block; padding: 6px 0 8px; border: 0; }
.pg-keys--flow { display: block; }
.pg-keys--flow > tbody { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); column-gap: 40px; }
.pg-table.pg-keys--flow tr:last-child { border-bottom: 1px solid var(--cg-rule); }

/* plain tables: pages, catalog, accounts, journals */
.pg-table { width: 100%; border-collapse: collapse; }
.pg-table th { padding: 8px 12px 8px 0; border-bottom: 1px solid var(--pg-line); text-align: left; font-size: 13px; line-height: 18px; font-weight: 500; color: var(--cg-ink-muted); white-space: nowrap; }
.pg-table td { padding: 10px 12px 10px 0; border-bottom: 1px solid var(--cg-rule); vertical-align: top; color: var(--cg-ink-2); overflow-wrap: anywhere; }
.pg-table tr:last-child td { border-bottom: 0; }
.pg-table td:last-child, .pg-table th:last-child { padding-right: 0; }
.pg-table__group th { padding: 18px 0 6px; border-bottom-color: var(--cg-rule); font-family: var(--pg-display); font-weight: 800; font-size: 16px; line-height: 22px; color: var(--cg-ink-strong); }
.pg-table kbd {
  display: inline-block; min-width: 26px; padding: 0 7px; border-radius: 6px; background: var(--pg-card); box-shadow: inset 0 0 0 1px var(--pg-ink-3), inset 0 -2px 0 var(--pg-ink-3);
  font: 500 12.5px/24px var(--cg-mono); color: var(--cg-ink-strong); text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.pg-table .pg-strong { color: var(--cg-ink-strong); font-weight: 600; }
.pg-list { margin: 0; padding: 0; list-style: none; }
.pg-list > li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 12px 0; border-bottom: 1px solid var(--cg-rule); }
.pg-list > li:last-child { border-bottom: 0; }
.pg-list > li > b { font-weight: 600; color: var(--cg-ink-strong); }
.pg-list > li > span { color: var(--cg-ink-muted); font-size: 13.5px; }
.pg-list > li > .cg-menu-anchor, .pg-list > li > .pg-pick { margin-left: auto; }

/* accounts (ST-067…ST-078) */
.pg-acc { padding: 16px 0; border-bottom: 1px solid var(--cg-rule); }
.pg-card > .pg-acc:last-child { border-bottom: 0; }
.pg-acc__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.pg-acc__head b { font-size: 16px; font-weight: 600; color: var(--cg-ink-strong); }
.pg-acc__acts { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pg-acc__grid { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px 36px; margin: 12px 0 0; }
.pg-acc__fact { min-width: 0; }
.pg-acc__fact--label { flex: 1 1 240px; max-width: 320px; }
.pg-acc__grid dt { margin: 0 0 4px; color: var(--cg-ink-muted); font-size: 13px; line-height: 18px; }
.pg-acc__grid dd { margin: 0; min-width: 0; min-height: 30px; display: flex; flex-wrap: wrap; align-items: center; column-gap: 8px; }
.pg-acc__grid dd > .pg-pagetag { margin-left: 0; }
.pg-acc__fact--label .cg-field { width: 100%; min-height: 34px; padding: 6px 10px; font-size: 14px; }
.pg-group { margin: 0; padding: 4px 0 2px; font-size: 13.5px; line-height: 20px; font-weight: 600; color: var(--cg-ink-muted); }
.pg-card > .pg-group { margin: 0 0 2px; padding: 0; font-family: var(--pg-display); font-weight: 800; font-size: 21px; line-height: 26px; letter-spacing: -0.012em; color: var(--cg-ink-strong); }
.pg-card .pg-group + .pg-acc { border-top: 0; }

/* the sign-in screen that replaces the settings (ST-011): the brand's stage beside a paper-white card */
.pg-signin { max-width: 460px; margin: 0 auto; padding: 8px 0 24px; }
.pg-signin > .pg-brand { padding: 0 0 22px; }
.pg-signin > .pg-brand .pg-logo { width: 188px; }
.pg-signin .pg-h1 { font-size: 36px; line-height: 40px; }
.pg-signin__stage { display: grid; grid-template-columns: minmax(0, 1fr); padding: 28px 28px 0; border-radius: 28px; background: var(--pg-pond); color: var(--pg-on-pond); overflow: hidden; }
.pg-signin__stage .pg-h1, .pg-signin__stage .pg-lead { color: inherit; }
.pg-signin__stage .pg-art { justify-self: end; width: 200px; margin: 6px -4px 0 0; }
.pg-signin__card { margin-top: 16px; padding: 24px 24px 20px; border-radius: 16px; background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--pg-line); }
.pg-signin .pg-check { margin-top: 20px; }
.pg-form { display: grid; gap: 14px; margin: 0; }
.pg-form label { display: grid; gap: 6px; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--cg-ink-strong); }
.pg-form .pg-field { width: 100%; }
.pg-form__acts { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.pg-form__acts .cg-btn { height: 44px; padding: 0 22px; font-size: 15px; }
.pg-form__acts .cg-btn.pg-primary { flex: 1; justify-content: center; }
.pg-details { margin-top: 18px; border-top: 1px solid var(--pg-line); }
.pg-details > summary { display: flex; align-items: center; gap: 8px; height: 44px; cursor: pointer; color: var(--cg-ink-strong); font-weight: 500; list-style: none; }
.pg-details > summary::-webkit-details-marker { display: none; }
.pg-details > summary::before { content: "›"; display: inline-block; width: 12px; color: var(--cg-ink-muted); font-size: 18px; transition: transform 120ms var(--cg-ease); }
.pg-details[open] > summary::before { transform: rotate(90deg); }
.pg-details__body { padding: 0 0 14px; }
.pg-zone { padding: 4px 0; }

/* the debug pages (§10): monospace on the settings' paper */
.pg-debug { max-width: 1040px; margin: 0 auto; padding: 40px clamp(20px, 4vw, 56px) 72px; font-size: 15px; line-height: 22px; color: var(--cg-ink-2); }
.pg-debug > .pg-lead { margin-bottom: 24px; }
.pg-debug__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0 0 16px; color: var(--cg-ink-muted); font-size: 13.5px; }
.pg-debug__meta > .cg-btn, .pg-debug__acts { margin-left: auto; }
.pg-debug__acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pg-debug__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 12px; color: var(--cg-ink-muted); font-size: 13.5px; }
.pg-debug__filters > :last-child { margin-left: auto; }
.pg-debug__pager { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 12px 0 0; color: var(--cg-ink-muted); font-size: 13.5px; font-variant-numeric: tabular-nums; }
.pg-debug .pg-h2 { margin-top: 28px; }
.pg-block { margin: 0 0 16px; padding: 4px 20px 12px; border-radius: 16px; background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--pg-line); }
.pg-block__head { display: flex; align-items: center; gap: 10px; padding: 10px 0 6px; font-size: 13px; line-height: 18px; font-weight: 600; color: var(--cg-ink-muted); }
.pg-pre { margin: 0; padding: 0 0 4px; font-family: var(--cg-mono); font-size: 12.5px; line-height: 19px; color: var(--cg-ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.pg-journal td { font-family: var(--cg-mono); font-size: 12.5px; line-height: 18px; padding: 6px 12px 6px 0; }
.pg-journal td:nth-child(1), .pg-journal td:nth-child(2), .pg-journal td:nth-child(3) { white-space: nowrap; overflow-wrap: normal; color: var(--cg-ink-muted); }
.pg-journal tr.is-warn td:nth-child(2), .pg-journal tr.is-error td:nth-child(2) { color: var(--cg-ink-strong); font-weight: 600; }
.pg-debug .cg-tabs { flex-wrap: wrap; gap: 4px; }
.pg-debug .cg-tab { height: 34px; padding: 0 14px; border-radius: 8px; color: var(--cg-ink-2); font-weight: 500; }
.pg-debug .cg-tab[aria-selected="true"] { background: var(--pg-shade); color: var(--cg-ink-strong); font-weight: 600; }
.pg-scroll { max-width: 100%; overflow-x: auto; padding: 4px 20px; border-radius: 16px; background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--pg-line); }
.pg-scroll > .pg-journal { min-width: 560px; }

/* page toasts: the kit's stack, at the page's own corner */
.pg-toasts.cg-toasts { top: 16px; right: 16px; }
.pg-popup .pg-toasts.cg-toasts { top: 8px; right: 8px; width: calc(100% - 16px); }
.pg-page .cg-dialog--center, .pg-popup .cg-dialog--center, .pg-debug .cg-dialog--center { width: min(440px, calc(100vw - 32px)); top: max(24px, min(96px, 12vh)); }
.cg-root--page .cg-dialog--center { border-radius: 20px; }

@media (max-width: 1180px) {
  .pg-grid, .pg-grid--even { grid-template-columns: minmax(0, 1fr); }
}
${/* A window of half a screen keeps its column of sections, narrower; only a phone-narrow one gets the list (§10). */ ''}
@media (max-width: 1040px) {
  .pg-page { grid-template-columns: 212px minmax(0, 1fr); }
  .pg-nav { padding: 24px 10px 16px; }
  .pg-brand { padding: 0 10px 18px; }
  .pg-brand .pg-logo { width: 128px; }
  .pg-main { padding: 32px 28px 56px; }
  .pg-sum .pg-art { width: 168px; margin-bottom: -26px; }
  .pg-sum .pg-art--lost { width: 92px; }
}
@media (max-width: 640px) {
  .pg-page { grid-template-columns: 1fr; }
  .pg-nav { display: none; }
  .pg-select { display: block; }
  .pg-main, .pg-debug { padding: 24px 16px 48px; }
  .pg-h1 { font-size: 32px; line-height: 36px; }
  .pg-card, .pg-check { padding: 18px 18px 8px; border-radius: 16px; }
  .pg-sum { padding: 22px 20px; border-radius: 20px; }
  .pg-sum b { font-size: 28px; line-height: 34px; }
  .pg-sum .pg-art { display: none; }
  .pg-head { flex-wrap: wrap; }
}
@media (max-width: 480px) {
  .pg-choices:not(.pg-choices--themes) { grid-template-columns: 1fr; }
}
${/* A few words that no longer fit one line stand two by two, never torn. */ ''}
@container pg-card (max-width: 420px) {
  .pg-page .cg-seg--md { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); width: 100%; }
  .pg-page .cg-seg--md .cg-seg__b { padding: 0 8px; }
}
@container pg-card (max-width: 300px) {
  .pg-page .cg-seg--md { grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .pg-row.is-target, .pg-opt.is-target, .pg-zone.is-target { animation: none; background: var(--cg-sunk); }
  .pg-details > summary::before { transition: none; }
  .pg-page .cg-check--14::before, .pg-page .cg-check--14::after { transition: none; }
}

.pg-site-pill { display:flex; flex-wrap:wrap; gap:6px 12px; width:100%; align-items:center; }
.pg-site-pill small { color:var(--cg-ink-2); }
.pg-site-details { grid-column:2 / -1; min-width:0; font-size:13px; }
.pg-site-details summary { cursor:pointer; padding:8px 0; }
.pg-site-details dl { margin:0; }
.pg-site-details dl > div { border-top:1px solid var(--cg-rule); padding:10px 0; }
.pg-site-details dt { font-weight:600; }
.pg-site-details dd { margin:4px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--cg-ink-2); }
`;

export const PAGES_SOURCE: StyleSource = { id: 'cg-pages', css: PAGES_CSS };
