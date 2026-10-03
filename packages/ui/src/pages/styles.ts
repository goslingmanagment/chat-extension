// The stylesheet of the extension pages (ui-design §3.10, §4.23, §4.24, §10):
// the 360 px popup, the settings shell — a 248 px section column and a main
// column no wider than 760 px — and the debug pages on that same shell.
// Tokens only (§2.2): no colour of its own, hairlines instead of cards, the
// red dot only next to a failure, no blue besides the focus ring.

import { dark, type StyleSource } from '../kit';

export const PAGES_CSS = `
html, body { margin: 0; padding: 0; background: var(--cg-surface); }
.pg-link { color: var(--cg-ink-2); text-decoration: underline; text-decoration-color: var(--cg-rule-3); text-underline-offset: 2px; cursor: pointer; }
.pg-link:hover { color: var(--cg-ink-strong); text-decoration-color: var(--cg-ink-muted); }
.pg-code { font-weight: 500; color: var(--cg-ink-muted); letter-spacing: 0.01em; }
.pg-mono { font-family: var(--cg-mono); font-size: var(--cg-text-sm); line-height: 18px; }

/* ── popup (§4.23) ── */
.pg-popup { width: 360px; max-width: 100%; font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink); background: var(--cg-surface); overflow: hidden; }
.pg-popup__head { display: flex; align-items: center; gap: 10px; padding: 12px 12px 10px 14px; }
.pg-popup__head .cg-goose { color: var(--cg-ink-2); }
.pg-popup__brand { font-weight: 600; font-size: var(--cg-text-lg); line-height: 20px; color: var(--cg-ink-strong); }
.pg-popup__ver { margin-left: auto; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; }
.pg-pills { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 12px; }
.pg-pill {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: var(--cg-r-pill);
  box-shadow: inset 0 0 0 1px var(--cg-rule-2); font-size: var(--cg-text-sm); color: var(--cg-ink-2); white-space: nowrap;
}
.pg-pill b { font-weight: 500; color: var(--cg-ink-strong); }
.pg-pill .cg-ico { color: var(--cg-ink-2); }
.pg-popup__sec { padding: 10px 14px; border-top: 1px solid var(--cg-rule); }
.pg-popup__cap { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); margin-bottom: 2px; }
.pg-popup__line { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; }
.pg-popup__line > b, .pg-popup__main { font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.pg-popup__line > b .cg-dot { margin-right: 6px; }
.pg-popup__aside { flex: none; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); white-space: nowrap; }
.pg-popup__copy { font: inherit; color: inherit; border-radius: var(--cg-r-sm); }
.pg-popup__copy:hover { color: var(--cg-ink-strong); text-decoration: underline; text-decoration-color: var(--cg-rule-3); text-underline-offset: 2px; }
.pg-popup__err { font-size: var(--cg-text-sm); color: var(--cg-ink-2); }
.pg-popup__err + .pg-popup__err { margin-top: 6px; }
.pg-popup__err .pg-code { display: flex; align-items: center; gap: 6px; }
.pg-popup__btns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 10px 14px 14px; border-top: 1px solid var(--cg-rule); }
.pg-popup__btns .cg-btn { justify-content: flex-start; height: 30px; min-width: 0; }
.pg-popup__count { font-weight: 400; color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; }
.pg-popup__key { margin-left: auto; display: inline-flex; }
.pg-popup__foot { display: flex; align-items: center; gap: 12px; padding: 8px 14px 10px; border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.pg-popup__foot .cg-btn { margin-left: auto; }
/* The card of a popup state stands on the popup's own 14 px edge: no gutter, the dot inside the code line. */
.pg-popup__state { padding: 10px 14px 14px; }
.pg-popup__state .cg-card__acts { margin-left: 0; }
.pg-popup__lead { color: var(--cg-ink-2); margin: 0 0 10px; }
.pg-popup .cg-state { padding: 16px 14px; }

/* ── settings shell (§4.24) ── */
.pg-page { display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100vh; font-size: var(--cg-text-lg); line-height: 20px; color: var(--cg-ink); background: var(--cg-surface); }
.pg-nav { position: sticky; top: 0; align-self: start; height: 100vh; display: flex; flex-direction: column; gap: 1px; padding: 20px 12px; border-right: 1px solid var(--cg-rule); background: var(--cg-nav-bg); overflow-y: auto; }
.pg-brand { display: flex; align-items: center; gap: 10px; padding: 0 10px 18px; }
.pg-brand .cg-goose { color: var(--cg-ink-2); }
.pg-brand b { font-size: var(--cg-text-xl); line-height: 22px; font-weight: 600; color: var(--cg-ink-strong); }
.pg-brand span { margin-left: auto; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; }
.pg-nav__a { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; border-radius: 7px; color: var(--cg-ink-2); text-decoration: none; }
.pg-nav__a:hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.pg-nav__a[aria-current="page"] { background: var(--cg-nav-current); color: var(--cg-ink-strong); font-weight: 500; box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
${dark('.pg-nav__a[aria-current="page"]')} { box-shadow: none; }
.pg-nav__foot { margin-top: auto; padding: 16px 10px 0; display: flex; flex-direction: column; gap: 6px; font-size: var(--cg-text-sm); line-height: 18px; color: var(--cg-ink-muted); }
.pg-nav__foot .pg-link { align-self: start; }
.pg-tag { display: inline-flex; align-items: center; height: 16px; padding: 0 5px; margin-left: 6px; border-radius: var(--cg-r-pill); box-shadow: inset 0 0 0 1px var(--cg-rule-3); font-size: var(--cg-text-2xs); line-height: 16px; font-weight: 500; color: var(--cg-ink-2); white-space: nowrap; vertical-align: 1px; }
.pg-main { min-width: 0; padding: 28px 40px 56px; }
.pg-main > * { max-width: 760px; }
.pg-select { display: none; margin-bottom: 16px; }
.pg-h1 { margin: 0 0 4px; font-size: var(--cg-text-3xl); line-height: 28px; font-weight: 600; color: var(--cg-ink-strong); letter-spacing: -0.01em; }
.pg-lead { margin: 0 0 20px; color: var(--cg-ink-2); }
.pg-h2 { margin: 28px 0 6px; font-size: var(--cg-text-xl); line-height: 22px; font-weight: 600; color: var(--cg-ink-strong); }
.pg-note { margin: 10px 0 0; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); }
.pg-sub { margin-top: 6px; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); }
.pg-head { display: flex; align-items: flex-start; gap: 16px; }
.pg-head > :first-child { min-width: 0; flex: 1; }

/* the save state: «Сохранено ✓» only with the background's revision (ST-014) */
.pg-save { flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 28px; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); white-space: nowrap; }
.pg-save--failed { color: var(--cg-ink-2); }
.pg-save .cg-btn { margin-left: 2px; }

/* the deep-link plate (ST-008), the read-only barrier (ST-016), the checklist (ST-012) */
.pg-plate { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: start; gap: 0 12px; margin: 0 0 16px; padding: 10px 0; border-top: 1px solid var(--cg-rule-2); border-bottom: 1px solid var(--cg-rule-2); font-size: var(--cg-text-base); line-height: 18px; }
.pg-plate > .cg-dot { margin-top: 6px; justify-self: center; }
.pg-plate__t { font-weight: 600; color: var(--cg-ink-strong); }
.pg-plate__b { color: var(--cg-ink-2); }
.pg-check { margin: 0 0 20px; padding: 12px 0 4px; border-top: 1px solid var(--cg-rule-2); border-bottom: 1px solid var(--cg-rule-2); }
.pg-check__head { display: flex; align-items: baseline; gap: 12px; }
.pg-check__head b { font-size: var(--cg-text-xl); line-height: 22px; font-weight: 600; color: var(--cg-ink-strong); }
.pg-check__head span { color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; }
.pg-check__head .cg-btn { margin-left: auto; }
.pg-check__lead { margin: 2px 0 8px; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); }
.pg-check__list { margin: 0; padding: 0; list-style: none; counter-reset: pg-step; }
.pg-check__item { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 0 12px; min-height: 32px; border-top: 1px solid var(--cg-rule); color: var(--cg-ink-2); }
.pg-check__item > :first-child { justify-self: center; color: var(--cg-ink-2); }
.pg-check__item.is-done { color: var(--cg-ink-muted); }
.pg-check__item:not(.is-done) .pg-check__t { color: var(--cg-ink-strong); }

/* status rows (§4.24 «Статус») */
.pg-sum { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 14px 0 16px; border-bottom: 1px solid var(--cg-rule-2); }
.pg-sum b { font-size: var(--cg-text-xl); line-height: 22px; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; }
.pg-sum > span { color: var(--cg-ink-muted); }
.pg-acts { margin-left: auto; display: flex; flex-wrap: wrap; gap: 6px; }
.pg-row { display: grid; grid-template-columns: 22px 196px minmax(0, 1fr) auto; align-items: start; gap: 0 12px; padding: 12px 0; border-bottom: 1px solid var(--cg-rule); }
.pg-row > .cg-dot { margin-top: 7px; justify-self: center; }
.pg-row__k { color: var(--cg-ink-2); }
.pg-row__v { color: var(--cg-ink-strong); font-weight: 500; min-width: 0; overflow-wrap: anywhere; }
.pg-row__v small { display: block; margin-top: 1px; font-size: var(--cg-text-sm2); line-height: 18px; font-weight: 400; color: var(--cg-ink-muted); }
.pg-row__a { justify-self: end; margin: -3px 0; }
.pg-row.is-target, .pg-opt.is-target, .pg-zone.is-target { animation: pg-target 2s var(--cg-ease); }
@keyframes pg-target { 0%, 60% { background: var(--cg-sunk); box-shadow: 0 0 0 6px var(--cg-sunk); } 100% { background: transparent; box-shadow: 0 0 0 6px transparent; } }

/* option rows (§4.24 «Вид и звук» and the sections built from its parts) */
.pg-opt { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 12px 24px; padding: 16px 0; border-bottom: 1px solid var(--cg-rule); }
.pg-opt__k b { display: block; font-weight: 600; color: var(--cg-ink-strong); }
/* The explanation is inline text of the 14 / 20 block, as the mockup draws it: its rows are the mockup's rows. */
.pg-opt__k span { font-size: var(--cg-text-sm2); color: var(--cg-ink-muted); }
.pg-opt__v { min-width: 0; }
.pg-opt__v--center { display: flex; align-items: center; }
.pg-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; }
.pg-value { color: var(--cg-ink-strong); font-weight: 500; overflow-wrap: anywhere; min-width: 0; }
.pg-muted { color: var(--cg-ink-muted); }
.pg-page .cg-check--14 { color: var(--cg-ink-strong); font-weight: 500; font-size: inherit; }
.pg-page .cg-check--14[aria-checked="false"] { color: var(--cg-ink-2); }
.pg-page .cg-check--14[aria-disabled="true"] { color: var(--cg-ink-faint); }
.pg-page .cg-seg--md { flex-wrap: wrap; max-width: 100%; }
.pg-pick { gap: 4px; min-width: 112px; height: 28px; justify-content: space-between; }
.pg-pick .cg-ico { color: var(--cg-ink-muted); }
.pg-page .cg-menu { z-index: 20; max-height: 320px; overflow-y: auto; }
.pg-field { width: 280px; max-width: 100%; height: 32px; padding: 0 10px; font-size: inherit; line-height: 20px; }
.pg-field--wide { width: 360px; }

/* «Вид ответа»: two choice cards with a miniature of the chat (§4.24) */
.pg-choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.pg-choice { display: block; width: 100%; padding: 10px; border-radius: var(--cg-r-lg); box-shadow: inset 0 0 0 1px var(--cg-rule-2); text-align: left; }
.pg-choice[aria-checked="true"] { box-shadow: inset 0 0 0 1.5px var(--cg-ink-strong); }
.pg-choice[aria-disabled="true"] { cursor: default; }
.pg-choice__t { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-weight: 500; color: var(--cg-ink-strong); }
.pg-radio { flex: none; width: 14px; height: 14px; border-radius: var(--cg-r-pill); box-shadow: inset 0 0 0 1.5px var(--cg-ink-muted); }
.pg-choice[aria-checked="true"] .pg-radio { box-shadow: inset 0 0 0 4px var(--cg-ink-strong); }
.pg-mini { height: 96px; padding: 8px; border-radius: var(--cg-r-sm); background: var(--cg-feed-bg); display: flex; flex-direction: column; justify-content: flex-end; gap: 4px; overflow: hidden; }
.pg-mini i { display: block; height: 6px; border-radius: 3px; background: var(--cg-rule-3); }
.pg-mini__res { display: flex; flex-direction: column; gap: 5px; padding: 6px 6px 4px; border-top: 1px solid var(--cg-rule-3); border-bottom: 1px solid var(--cg-rule-2); }
.pg-mini__res.is-sheet { background: var(--cg-surface); border: 1px solid var(--cg-rule-2); border-radius: var(--cg-r-sm); }
.pg-mini__strip { display: flex; gap: 4px; height: 8px; }
.pg-mini__strip i { width: 18px; height: 5px; background: var(--cg-ink-muted); }
.pg-mini__comp { height: 18px; border-radius: 5px; background: var(--cg-surface); box-shadow: inset 0 0 0 1px var(--cg-rule-2); }

/* the volume slider: a 4 px track, a 14 px knob with an ink ring (§4.24) */
.pg-range { appearance: none; -moz-appearance: none; width: 220px; max-width: 100%; height: 14px; margin: 0; background: transparent; cursor: pointer; }
.pg-range::-moz-range-track { height: 4px; border-radius: 2px; background: var(--cg-bar); }
.pg-range::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--cg-ink-2); }
.pg-range::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: var(--cg-r-pill); background: var(--cg-surface); box-shadow: inset 0 0 0 1.5px var(--cg-ink-strong); }
.pg-range::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: var(--cg-bar); }
.pg-range::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; margin-top: -5px; border-radius: var(--cg-r-pill); background: var(--cg-surface); box-shadow: inset 0 0 0 1.5px var(--cg-ink-strong); }
.pg-range[aria-disabled="true"] { cursor: default; opacity: 0.6; }
.pg-range__v { min-width: 24px; color: var(--cg-ink-strong); font-weight: 500; font-variant-numeric: tabular-nums; }

/* the message-window stepper: − N +, typed by hand; the wheel does nothing (ST-094) */
.pg-step { display: inline-flex; align-items: center; height: 28px; border-radius: var(--cg-r-md); box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
.pg-step:focus-within { box-shadow: inset 0 0 0 1px var(--cg-rule-3), 0 0 0 2px var(--cg-focus-soft); }
.pg-step__b { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--cg-r-sm); color: var(--cg-ink-2); font-size: 15px; line-height: 1; }
.pg-step__b:hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.pg-step__b[aria-disabled="true"] { color: var(--cg-ink-faint); background: none; cursor: default; }
.pg-step__i { width: 56px; height: 28px; padding: 0 4px; border: 0; outline: 0; background: none; text-align: center; font: inherit; color: var(--cg-ink-strong); font-weight: 500; font-variant-numeric: tabular-nums; }
.pg-step__i:focus-visible { outline: 0; }
.pg-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: var(--cg-r-pill); box-shadow: inset 0 0 0 1px var(--cg-rule-2); font-size: var(--cg-text-sm); color: var(--cg-ink-2); white-space: nowrap; }

/* plain tables: hotkeys, pages, catalog, accounts, journals */
.pg-table { width: 100%; border-collapse: collapse; }
.pg-table th { padding: 6px 12px 6px 0; border-bottom: 1px solid var(--cg-rule-2); text-align: left; font-size: var(--cg-text-sm); line-height: 18px; font-weight: 500; color: var(--cg-ink-muted); white-space: nowrap; }
.pg-table td { padding: 8px 12px 8px 0; border-bottom: 1px solid var(--cg-rule); vertical-align: top; color: var(--cg-ink); overflow-wrap: anywhere; }
.pg-table td:last-child, .pg-table th:last-child { padding-right: 0; }
.pg-table kbd { font-size: var(--cg-text-sm); color: var(--cg-ink-strong); font-variant-numeric: tabular-nums; }
.pg-table .pg-strong { color: var(--cg-ink-strong); font-weight: 500; }
.pg-list { margin: 0; padding: 0; list-style: none; }
.pg-list > li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; padding: 8px 0; border-bottom: 1px solid var(--cg-rule); }
.pg-list > li > b { font-weight: 500; color: var(--cg-ink-strong); }
.pg-list > li > span { color: var(--cg-ink-muted); font-size: var(--cg-text-sm2); }

/* accounts (ST-067…ST-078) */
.pg-acc { padding: 14px 0; border-bottom: 1px solid var(--cg-rule); }
.pg-acc__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.pg-acc__head b { font-weight: 600; color: var(--cg-ink-strong); }
.pg-acc__acts { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pg-acc__grid { display: grid; grid-template-columns: 196px minmax(0, 1fr); gap: 6px 12px; margin-top: 8px; align-items: center; }
.pg-acc__grid dt { color: var(--cg-ink-2); margin: 0; }
.pg-acc__grid dd { margin: 0; min-width: 0; }
.pg-group { margin: 22px 0 0; font-size: var(--cg-text-sm); line-height: 18px; font-weight: 500; color: var(--cg-ink-muted); }

/* the sign-in screen that replaces the settings (ST-011) */
.pg-signin { max-width: 420px; }
.pg-form { display: grid; gap: 10px; margin: 16px 0 0; }
.pg-form label { display: grid; gap: 4px; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-2); }
.pg-form .pg-field { width: 100%; }
.pg-form__acts { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.pg-details { margin-top: 20px; border-top: 1px solid var(--cg-rule); }
.pg-details > summary { display: flex; align-items: center; gap: 6px; height: 36px; cursor: pointer; color: var(--cg-ink-2); font-weight: 500; list-style: none; }
.pg-details > summary::-webkit-details-marker { display: none; }
.pg-details > summary::before { content: "›"; display: inline-block; width: 12px; color: var(--cg-ink-muted); transition: transform 120ms var(--cg-ease); }
.pg-details[open] > summary::before { transform: rotate(90deg); }
.pg-details__body { padding: 0 0 12px; }
.pg-zone { padding: 4px 0; }

/* the debug pages (§10): monospace 12 px on the settings shell */
.pg-debug { max-width: 980px; margin: 0 auto; padding: 28px 40px 56px; font-size: var(--cg-text-lg); line-height: 20px; color: var(--cg-ink); }
.pg-debug__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0 0 16px; color: var(--cg-ink-muted); font-size: var(--cg-text-sm2); }
.pg-debug__meta > .cg-btn, .pg-debug__acts { margin-left: auto; }
.pg-debug__acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pg-block { margin: 0 0 16px; border-top: 1px solid var(--cg-rule-2); }
.pg-block__head { display: flex; align-items: center; gap: 10px; padding: 8px 0 4px; font-size: var(--cg-text-sm); line-height: 18px; font-weight: 500; color: var(--cg-ink-muted); }
.pg-pre { margin: 0; padding: 0 0 8px; font-family: var(--cg-mono); font-size: var(--cg-text-sm); line-height: 18px; color: var(--cg-ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.pg-journal td { font-family: var(--cg-mono); font-size: var(--cg-text-sm); line-height: 18px; padding: 4px 12px 4px 0; }
.pg-journal td:nth-child(1), .pg-journal td:nth-child(2), .pg-journal td:nth-child(3) { white-space: nowrap; overflow-wrap: normal; color: var(--cg-ink-muted); }
.pg-journal tr.is-warn td:nth-child(2), .pg-journal tr.is-error td:nth-child(2) { color: var(--cg-ink-strong); font-weight: 600; }
.pg-debug .cg-tabs { flex-wrap: wrap; }
.pg-scroll { max-width: 100%; overflow-x: auto; }
.pg-scroll > .pg-journal { min-width: 560px; }

/* page toasts: the kit's stack, at the page's own corner */
.pg-toasts.cg-toasts { top: 16px; right: 16px; }
.pg-popup .pg-toasts.cg-toasts { top: 8px; right: 8px; width: calc(100% - 16px); }
.pg-page .cg-dialog--center, .pg-popup .cg-dialog--center, .pg-debug .cg-dialog--center { width: min(440px, calc(100vw - 32px)); top: max(24px, min(96px, 12vh)); }

@media (max-width: 860px) {
  .pg-page { grid-template-columns: 1fr; }
  .pg-nav { display: none; }
  .pg-select { display: block; }
  .pg-main, .pg-debug { padding: 20px 16px 40px; }
  .pg-row { grid-template-columns: 22px minmax(0, 1fr); }
  .pg-row > .pg-row__v, .pg-row > .pg-row__a { grid-column: 2; }
  .pg-row > .pg-row__a { justify-self: start; margin: 4px 0 0 -8px; }
  .pg-opt { grid-template-columns: 1fr; gap: 8px; }
  .pg-acc__grid { grid-template-columns: 1fr; gap: 2px; }
  .pg-acc__grid dd { margin-bottom: 8px; }
  .pg-head { flex-wrap: wrap; }
  .pg-acts { margin-left: 0; }
}
@media (max-width: 480px) {
  .pg-choices { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .pg-row.is-target, .pg-opt.is-target, .pg-zone.is-target { animation: none; background: var(--cg-sunk); }
  .pg-details > summary::before { transition: none; }
}
`;

export const PAGES_SOURCE: StyleSource = { id: 'cg-pages', css: PAGES_CSS };
