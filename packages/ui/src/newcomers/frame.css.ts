// The look of the «Новые» window on every site (X59, X60; ui-design §3.6): the old Fansly extension's window in the
// family's tokens — a compact window over a scrim (1040 × 700 at most), the serif title over the page's name, one
// toolbar (the period, what runs, the search), quiet lines under it; the list of 344 px on the left — tabs underlined
// in terracotta, the fan's picture (the batch's tick), the name, «@handle · …», the status in words (terracotta where
// the person can act), the batch's draft under the fan in the family's draft look, the batch at the list's foot — and
// the site's card on the right. Blue only on what reaches a fan.
// Every size is a token, so «Крупнее» scales the window; the rows' heights follow it (frame.tsx ROW_HEIGHTS).
// A note here is a JS comment: a CSS one would ship in the window's chunk, prose for nobody.

import { type StyleSource } from '../kit';

export const NEWCOMERS_FRAME_CSS = `
.cg-dialog.cg-dialog--wide.cg-nw {
  top: 50%; translate: -50% -50%; width: min(1040px, calc(100vw - 48px)); height: min(700px, calc(100vh - 48px)); max-height: none;
  border-radius: 14px; font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink);
}
.cg-dialog.cg-dialog--wide.cg-nw.is-large { width: min(1180px, calc(100vw - 32px)); height: min(780px, calc(100vh - 32px)); }
.cg-nw__frame { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.cg-nw__grow { flex: 1 1 0; min-width: 0; }

.cg-nw__head { flex: none; display: flex; align-items: center; gap: 12px; padding: 14px 12px 12px 22px; border-bottom: 1px solid var(--cg-rule); }
.cg-nw__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cg-nw__title { margin: 0; font: 600 var(--cg-text-3xl)/1.15 var(--cg-serif); color: var(--cg-ink-strong); letter-spacing: -0.01em; }
.cg-nw__sub { display: flex; gap: 6px; min-width: 0; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-nw__sub > * + *::before { content: "·"; margin-right: 6px; }
.cg-nw__close { flex: none; align-self: flex-start; }

.cg-nw__bar { flex: none; display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 6px 12px 6px 22px; border-bottom: 1px solid var(--cg-rule); min-width: 0; }
.cg-nw__period-box { flex: none; display: inline-flex; align-items: center; gap: 2px; }
.cg-nw__label { color: var(--cg-ink-2); }
.cg-nw__stage { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-nw .cg-nw__search { width: 220px; height: 30px; min-width: 120px; flex: 0 1 auto; }
.cg-nw__refresh { flex: none; }
.cg-nw__line { flex: none; display: flex; align-items: baseline; gap: 12px; padding: 5px 22px; border-bottom: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-muted); }
.cg-nw__line > span:first-child { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cg-nw__line > span + span { flex: none; white-space: nowrap; }
.cg-nw__line > b { color: var(--cg-ink-strong); font-weight: 500; white-space: nowrap; }
.cg-nw__state { flex: 1; min-height: 0; overflow-y: auto; padding: 24px 20px; color: var(--cg-ink-muted); }

.cg-nw__main { flex: 1; min-height: 0; display: grid; grid-template-columns: 344px minmax(0, 1fr); }
.cg-nw.is-large .cg-nw__main { grid-template-columns: 388px minmax(0, 1fr); }
.cg-nw__main > * { min-width: 0; min-height: 0; }
.cg-nw__side { display: flex; flex-direction: column; border-right: 1px solid var(--cg-rule); }
.cg-nw__tabs { flex: none; display: flex; gap: 18px; padding: 0 18px; border-bottom: 1px solid var(--cg-rule); }
.cg-nw__tab { margin-bottom: -1px; padding: 11px 0 9px; border-bottom: 2px solid transparent; color: var(--cg-ink-muted); white-space: nowrap; }
.cg-nw__tab:hover { color: var(--cg-ink); }
.cg-nw__tab.is-on { color: var(--cg-clay-ink); border-bottom-color: var(--cg-clay); font-weight: 500; }
.cg-nw__tabn { font-weight: 400; white-space: pre; }
.cg-nw__tools { flex: none; display: flex; align-items: center; gap: 4px; height: 42px; padding: 0 8px; border-bottom: 1px solid var(--cg-rule); }
.cg-nw__tools .cg-menu { z-index: 6; }
.cg-nw__list { flex: 1; min-height: 0; }

.cg-nw__row {
  display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; column-gap: 11px; align-content: start; height: 100%; padding: 9px 12px 0 14px;
  border-bottom: 1px solid var(--cg-rule); cursor: pointer; outline: none;
}
.cg-nw__row:hover { background: var(--cg-hover); }
.cg-nw__row.is-sel { background: var(--cg-sel); box-shadow: inset 3px 0 var(--cg-clay); }
.cg-nw__row:focus-visible { box-shadow: inset 0 0 0 2px var(--cg-focus); }
.cg-nw__row.is-sel:focus-visible { box-shadow: inset 3px 0 var(--cg-clay), inset 0 0 0 1px var(--cg-focus); }
${/* The row's heights are frame.tsx ROW_HEIGHTS: 52 px of text (18 + 16 + 2 + 16) between 9 px above and below. */ ''}
.cg-nw__copy { min-width: 0; display: flex; flex-direction: column; }
.cg-nw__name { line-height: 18px; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-nw__custom { font-weight: 400; color: var(--cg-ink-muted); }
.cg-nw__tag { margin-left: 6px; font-size: var(--cg-text-sm); font-weight: 400; color: var(--cg-ink-2); }
.cg-nw__meta { font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${/* «в разговоре: …» rides the meta line: a line of its own would outgrow the row's fixed height and spill into the next. */ ''}
.cg-nw__mline { display: flex; align-items: center; gap: 8px; min-width: 0; }
.cg-nw__mline > .cg-nw__meta { flex: 0 0 auto; max-width: 100%; }
.cg-nw__mline > .cg-talk { flex: 0 1 auto; min-width: 0; }
.cg-nw__st { display: flex; align-items: center; gap: 5px; min-width: 0; margin-top: 2px; font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-nw__st > .cg-dot, .cg-nw__st > .cg-spin, .cg-nw__st > .cg-ico { flex: none; }
.cg-nw__st.is-act { color: var(--cg-clay-ink); font-weight: 500; }
.cg-nw__st.is-2, .cg-nw__st.is-busy { color: var(--cg-ink-2); }
.cg-nw__st.is-done { color: var(--cg-ink-strong); font-weight: 500; }
.cg-nw__end { grid-column: 3; grid-row: 1; align-self: center; }
.cg-nw__draft {
  grid-column: 2 / 4; margin: 7px 0 0; padding: 4px 9px; border: 1px dashed var(--cg-clay-line); border-radius: var(--cg-r-md); background: var(--cg-draft);
  font: var(--cg-text-sm2)/17px var(--cg-serif); color: var(--cg-ink);
}
.cg-nw__dtext { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.cg-nw__draft.is-sent { border-style: solid; border-color: var(--cg-rule); background: none; color: var(--cg-ink-muted); }

.cg-nw__ava {
  position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 50%;
  background: var(--cg-sunk); color: var(--cg-ink-2); font-weight: 600; box-shadow: inset 0 0 0 1px var(--cg-rule);
}
.cg-nw__ava.is-row { width: 40px; height: 40px; }
.cg-nw__ava.is-card { width: 48px; height: 48px; font-size: var(--cg-text-xl); }
.cg-nw__ava img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cg-nw__pick { position: relative; display: inline-flex; width: 40px; height: 40px; margin-top: 6px; padding: 0; border-radius: 50%; }
${/* «Крупнее»: 58 px of text (20 + 18 + 2 + 18), the draft's two lines of 19 px. */ ''}
.cg-nw.is-large .cg-nw__name { line-height: 20px; }
.cg-nw.is-large .cg-nw__meta, .cg-nw.is-large .cg-nw__st { line-height: 18px; }
.cg-nw.is-large .cg-nw__draft { line-height: 19px; }
.cg-nw.is-large .cg-nw__pick { margin-top: 9px; }
.cg-nw__tick {
  position: absolute; right: -3px; bottom: -3px; display: none; align-items: center; justify-content: center; width: 18px; height: 18px;
  border-radius: 50%; background: var(--cg-surface); color: #fff; box-shadow: inset 0 0 0 1.5px var(--cg-ink-faint), 0 0 0 2px var(--cg-surface);
}
.cg-nw__row:hover .cg-nw__pick.is-box .cg-nw__tick, .cg-nw__pick.is-on .cg-nw__tick { display: inline-flex; }
.cg-nw__pick.is-box:hover .cg-nw__tick { box-shadow: inset 0 0 0 1.5px var(--cg-clay), 0 0 0 2px var(--cg-surface); }
.cg-nw__pick.is-on .cg-nw__tick { background: var(--cg-clay); box-shadow: 0 0 0 2px var(--cg-surface); }
.cg-nw__pick.is-on .cg-nw__ava { box-shadow: 0 0 0 2px var(--cg-clay); }
.cg-nw__pick[aria-disabled="true"] { cursor: default; }

.cg-nw__batch { flex: none; display: flex; flex-direction: column; gap: 4px; padding: 8px 10px 10px 14px; border-top: 1px solid var(--cg-rule); background: var(--cg-sunk); }
.cg-nw__bline { display: flex; align-items: center; gap: 6px; min-height: 28px; min-width: 0; font-size: var(--cg-text-sm); color: var(--cg-ink-2); }
.cg-nw__bline.is-hint { min-height: 0; color: var(--cg-ink-muted); line-height: 16px; }
.cg-nw__bn { color: var(--cg-ink-strong); font-weight: 500; white-space: nowrap; }
.cg-nw__bst { display: inline-flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

${/* A narrow window (the browser's zoom of 200 %, ui-design §11): one column that scrolls — the list in a box of its own, the card under it. */ ''}
@media (max-width: 760px) {
  .cg-dialog.cg-dialog--wide.cg-nw, .cg-dialog.cg-dialog--wide.cg-nw.is-large { width: calc(100vw - 16px); height: calc(100vh - 16px); }
  .cg-nw__main, .cg-nw.is-large .cg-nw__main { display: flex; flex-direction: column; overflow-y: auto; scrollbar-width: thin; }
  .cg-nw__main > * { flex: none; }
  .cg-nw__main > :last-child { min-height: 420px; }
  .cg-nw__side { height: min(360px, 70vh); border-right: 0; border-bottom: 1px solid var(--cg-rule); }
  .cg-nw__main .cg-vlist { overscroll-behavior: auto; }
  .cg-nw .cg-nw__search { width: 140px; }
  .cg-nw__bar { flex-wrap: wrap; padding-left: 16px; }
  .cg-nw__head, .cg-nw__line { padding-left: 16px; padding-right: 16px; }
}
@media (prefers-reduced-motion: reduce) { .cg-nw__row { transition: none; } }
`;

/** The window's frame, shared by every site's «Новые»: one id, so a page that has both carries it once. */
export const NEWCOMERS_FRAME_STYLES: StyleSource = { id: 'cg-newcomers-frame', css: NEWCOMERS_FRAME_CSS };
