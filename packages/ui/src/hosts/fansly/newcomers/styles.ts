// The look of «Новые фоловеры» on Fansly (X57; ui-design §3.12): the old Fansly extension's window in the family's
// tokens — a compact window over a scrim (1040 × 700 at most), the serif title over «@креатор», one toolbar (the period,
// the progress, the queue's button, the search, «Проверить заново»), the dates in a quiet line; the list of 320 px on
// the left — tabs underlined in terracotta, the fan's picture, the name, «@handle · 2 ч назад», the status in words
// (terracotta where the person can act), the batch's draft under the fan in the family's draft look — and the card on
// the right: the profile, «Открыть в Fansly ↗», the conversation in plain bubbles (ours on the right), the draft in the
// serif of AI text and «Отправить →», the only blue besides «Отправить N →» of the batch: both reach fans.
// Every size is a token, so «Крупнее» scales the window; the rows' heights follow it in the component.

import { STALE_ROW_CSS } from '../../../dock/stale-row.css';

export const FANSLY_NEWCOMERS_CSS = `
.cg-dialog.cg-dialog--wide.cg-fnw {
  top: 50%; translate: -50% -50%; width: min(1040px, calc(100vw - 48px)); height: min(700px, calc(100vh - 48px)); max-height: none;
  border-radius: 14px; font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink);
}
.cg-dialog.cg-dialog--wide.cg-fnw.is-large { width: min(1180px, calc(100vw - 32px)); height: min(780px, calc(100vh - 32px)); }
.cg-fnw__frame { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.cg-fnw__grow { flex: 1 1 0; min-width: 0; }

.cg-fnw__head { flex: none; display: flex; align-items: center; gap: 12px; padding: 14px 12px 12px 22px; border-bottom: 1px solid var(--cg-rule); }
.cg-fnw__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cg-fnw__title { margin: 0; font: 600 var(--cg-text-3xl)/1.15 var(--cg-serif); color: var(--cg-ink-strong); letter-spacing: -0.01em; }
.cg-fnw__sub { display: flex; gap: 6px; min-width: 0; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-fnw__creator + .cg-fnw__page::before { content: "·"; margin-right: 6px; }
.cg-fnw__close { flex: none; align-self: flex-start; }

.cg-fnw__bar { flex: none; display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 6px 12px 6px 22px; border-bottom: 1px solid var(--cg-rule); min-width: 0; }
.cg-fnw__period-box { flex: none; display: inline-flex; align-items: center; gap: 2px; }
.cg-fnw__label { color: var(--cg-ink-2); }
.cg-fnw__stage { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-fnw__run, .cg-fnw__refresh { flex: none; }
.cg-fnw .cg-fnw__search { width: 220px; height: 30px; min-width: 120px; flex: 0 1 auto; }
.cg-fnw__line { flex: none; padding: 5px 22px; border-bottom: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-muted); }
.cg-fnw__cool { color: var(--cg-ink-strong); font-weight: 500; }
.cg-fnw .cg-nc__incomplete b { color: var(--cg-ink-strong); font-weight: 500; }
.cg-fnw__stopped { flex: none; padding: 6px 16px 8px 22px; border-bottom: 1px solid var(--cg-rule); }
.cg-fnw__failed { flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 18px 22px; max-width: 72ch; }
.cg-fnw__hint2 { margin: 0; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); }
.cg-fnw__state { flex: 1; min-height: 0; overflow-y: auto; padding: 24px 20px; color: var(--cg-ink-muted); }

.cg-fnw__main { flex: 1; min-height: 0; display: grid; grid-template-columns: 320px minmax(0, 1fr); }
.cg-fnw.is-large .cg-fnw__main { grid-template-columns: 360px minmax(0, 1fr); }
.cg-fnw__side { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--cg-rule); }
.cg-fnw__tabs { flex: none; display: flex; gap: 18px; padding: 0 18px; border-bottom: 1px solid var(--cg-rule); }
.cg-fnw__tab { margin-bottom: -1px; padding: 11px 0 9px; border-bottom: 2px solid transparent; color: var(--cg-ink-muted); white-space: nowrap; }
.cg-fnw__tab:hover { color: var(--cg-ink); }
.cg-fnw__tab.is-on { color: var(--cg-clay-ink); border-bottom-color: var(--cg-clay); font-weight: 500; }
.cg-fnw__tabn { font-weight: 400; white-space: pre; }
.cg-fnw__tools { flex: none; display: flex; align-items: center; gap: 4px; height: 42px; padding: 0 8px; border-bottom: 1px solid var(--cg-rule); }
.cg-fnw__tools .cg-menu { z-index: 6; }
.cg-fnw__list { flex: 1; min-height: 0; }

.cg-fnw__row {
  display: grid; grid-template-columns: 40px minmax(0, 1fr); column-gap: 11px; align-content: start; height: 100%; padding: 9px 14px 0;
  border-bottom: 1px solid var(--cg-rule); cursor: pointer; outline: none;
}
.cg-fnw__row:hover { background: var(--cg-hover); }
.cg-fnw__row.is-sel { background: var(--cg-sel); box-shadow: inset 3px 0 var(--cg-clay); }
.cg-fnw__row:focus-visible { box-shadow: inset 0 0 0 2px var(--cg-focus); }
.cg-fnw__row.is-sel:focus-visible { box-shadow: inset 3px 0 var(--cg-clay), inset 0 0 0 1px var(--cg-focus); }
/* The row's heights are the component's ROW_HEIGHTS: 52 px of text (18 + 16 + 2 + 16) between 9 px above and below. */
.cg-fnw__copy { min-width: 0; display: flex; flex-direction: column; }
.cg-fnw__name { line-height: 18px; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-fnw__custom { font-weight: 400; color: var(--cg-ink-muted); }
.cg-fnw__meta { font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-fnw__st { display: flex; align-items: center; gap: 5px; min-width: 0; margin-top: 2px; font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-fnw__st.is-act { color: var(--cg-clay-ink); font-weight: 500; }
.cg-fnw__st.is-2, .cg-fnw__st.is-busy { color: var(--cg-ink-2); }
.cg-fnw__st.is-done { color: var(--cg-ink-strong); font-weight: 500; }
.cg-fnw__draft {
  grid-column: 2; margin: 7px 0 0; padding: 4px 9px; border: 1px dashed var(--cg-clay-line); border-radius: var(--cg-r-md); background: var(--cg-draft);
  font: var(--cg-text-sm2)/17px var(--cg-serif); color: var(--cg-ink);
}
.cg-fnw__dtext { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.cg-fnw__draft.is-sent { border-style: solid; border-color: var(--cg-rule); background: none; color: var(--cg-ink-muted); }

.cg-fnw__ava {
  position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 50%;
  background: var(--cg-sunk); color: var(--cg-ink-2); font-weight: 600; box-shadow: inset 0 0 0 1px var(--cg-rule);
}
.cg-fnw__ava.is-row { width: 40px; height: 40px; }
.cg-fnw__ava.is-card { width: 48px; height: 48px; font-size: var(--cg-text-xl); }
.cg-fnw__ava img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cg-fnw__pick { position: relative; display: inline-flex; width: 40px; height: 40px; margin-top: 6px; padding: 0; border-radius: 50%; }
/* «Крупнее»: 58 px of text (20 + 18 + 2 + 18), the draft's two lines of 19 px. */
.cg-fnw.is-large .cg-fnw__name { line-height: 20px; }
.cg-fnw.is-large .cg-fnw__meta, .cg-fnw.is-large .cg-fnw__st { line-height: 18px; }
.cg-fnw.is-large .cg-fnw__draft { line-height: 19px; }
.cg-fnw.is-large .cg-fnw__pick { margin-top: 9px; }
.cg-fnw__tick {
  position: absolute; right: -3px; bottom: -3px; display: none; align-items: center; justify-content: center; width: 18px; height: 18px;
  border-radius: 50%; background: var(--cg-surface); color: #fff; box-shadow: inset 0 0 0 1.5px var(--cg-ink-faint), 0 0 0 2px var(--cg-surface);
}
.cg-fnw__row:hover .cg-fnw__pick.is-box .cg-fnw__tick, .cg-fnw__pick.is-on .cg-fnw__tick { display: inline-flex; }
.cg-fnw__pick.is-box:hover .cg-fnw__tick { box-shadow: inset 0 0 0 1.5px var(--cg-clay), 0 0 0 2px var(--cg-surface); }
.cg-fnw__pick.is-on .cg-fnw__tick { background: var(--cg-clay); box-shadow: 0 0 0 2px var(--cg-surface); }
.cg-fnw__pick.is-on .cg-fnw__ava { box-shadow: 0 0 0 2px var(--cg-clay); }
.cg-fnw__pick[aria-disabled="true"] { cursor: default; }

.cg-fnw__batch { flex: none; display: flex; flex-direction: column; gap: 4px; padding: 8px 10px 10px 14px; border-top: 1px solid var(--cg-rule); background: var(--cg-sunk); }
.cg-fnw__bline { display: flex; align-items: center; gap: 6px; min-height: 28px; min-width: 0; font-size: var(--cg-text-sm); color: var(--cg-ink-2); }
.cg-fnw__bline.is-hint { min-height: 0; color: var(--cg-ink-muted); line-height: 16px; }
.cg-fnw__bline.is-stop { min-height: 0; color: var(--cg-ink-2); line-height: 16px; }
.cg-fnw__bn { color: var(--cg-ink-strong); font-weight: 500; white-space: nowrap; }
.cg-fnw__bst { display: inline-flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.cg-fnc { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--cg-surface); }
.cg-fnc--none { align-items: center; justify-content: center; }
.cg-fnc__head { flex: none; display: flex; align-items: center; gap: 12px; padding: 16px 20px 12px 22px; }
.cg-fnc__who { flex: 1; min-width: 0; }
.cg-fnc__name { margin: 0; font-size: var(--cg-text-xl); line-height: 20px; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-fnc__meta { margin-top: 3px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-fnc__open { flex: none; align-self: flex-start; margin-top: 2px; color: var(--cg-clay-ink); font-size: var(--cg-text-sm); text-decoration: none; white-space: nowrap; border-radius: 3px; }
.cg-fnc__open:hover { text-decoration: underline; }
.cg-fnc__open:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; }
.cg-fnc__bio {
  flex: none; margin: 0 22px 10px; max-height: 54px; overflow-y: auto; font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-2);
  white-space: pre-wrap; overflow-wrap: anywhere; scrollbar-width: thin;
}
.cg-fnc__proof { flex: none; margin: 0 22px 10px; padding: 7px 10px; max-height: 130px; overflow: auto; border: 1px solid var(--cg-rule); border-radius: var(--cg-r-md); font-size: var(--cg-text-sm); }
.cg-fnc__proof summary { cursor: pointer; color: var(--cg-ink-strong); font-weight: 500; }
.cg-fnc__proofNote { margin-top: 4px; color: var(--cg-ink-muted); }
.cg-fnc__proof blockquote { margin: 6px 0 0; color: var(--cg-ink); white-space: pre-wrap; overflow-wrap: anywhere; }

.cg-fnc__feed {
  flex: 1; min-height: 64px; display: flex; flex-direction: column; gap: 8px; padding: 12px 22px; overflow-y: auto; overscroll-behavior: contain;
  border-top: 1px solid var(--cg-rule); scrollbar-width: thin; outline: none;
}
.cg-fnc__feed:focus-visible { box-shadow: inset 0 0 0 2px var(--cg-focus-soft); }
.cg-fnc__msg {
  flex: none; align-self: flex-start; max-width: 82%; padding: 7px 11px 6px; border: 1px solid var(--cg-rule); border-radius: 12px;
  color: var(--cg-ink); white-space: pre-wrap; overflow-wrap: anywhere;
}
.cg-fnc__msg.is-own { align-self: flex-end; background: var(--cg-sunk); }
.cg-fnc__auto, .cg-fnc__att { display: block; font-size: var(--cg-text-xs); line-height: 15px; color: var(--cg-ink-muted); }
.cg-fnc__auto { margin-bottom: 2px; }
.cg-fnc__att { margin-top: 2px; }
.cg-fnc__time { display: block; margin-top: 3px; text-align: right; font-size: var(--cg-text-2xs); line-height: 13px; color: var(--cg-ink-muted); }
.cg-fnc__older, .cg-fnc__sys { flex: none; align-self: center; }
.cg-fnc__sys { font-size: var(--cg-text-xs); color: var(--cg-ink-muted); text-align: center; }
.cg-fnc__empty { margin: auto; display: inline-flex; align-items: center; gap: 6px; max-width: 46ch; padding: 16px; text-align: center; color: var(--cg-ink-muted); }
.cg-fnc__fail { margin: auto 0; display: flex; flex-direction: column; gap: 6px; color: var(--cg-ink-2); }
.cg-fnc__fail p { margin: 0; }

.cg-fnc__verdict { flex: none; display: flex; align-items: center; gap: 12px; padding: 10px 20px 10px 22px; border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-2); }
.cg-fnc__why { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cg-fnc__why b { color: var(--cg-ink-strong); font-weight: 500; }
.cg-fnc__check { flex: none; display: inline-flex; }

.cg-fnc__greet { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px 20px 16px 22px; border-top: 1px solid var(--cg-rule); }
.cg-fnc__field { position: relative; }
.cg-fnc__field .cg-field { padding: 10px 44px 10px 12px; border-radius: var(--cg-r-lg); font: var(--cg-text-ai)/var(--cg-leading-ai) var(--cg-serif); }
.cg-fnc__field .cg-field::placeholder { font: var(--cg-text-sm)/18px var(--cg-font); }
.cg-fnc__ai {
  position: absolute; top: 8px; right: 9px; padding: 0 5px; border-radius: var(--cg-r-sm); font-size: var(--cg-text-xs); line-height: 16px; font-weight: 600;
  color: var(--cg-clay-ink); background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line);
}
.cg-fnc__gbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cg-fnc__gnote { font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-muted); }
.cg-fnc__gnote.is-strong { color: var(--cg-ink-strong); font-weight: 500; }
.cg-fnc__greet .cg-stale { margin: 0; }
.cg-fnc__gst { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--cg-text-sm2); line-height: 17px; color: var(--cg-ink-muted); }
.cg-fnc__gst > b { font-weight: 500; color: var(--cg-ink-strong); }
.cg-fnc__gst.is-sent { color: var(--cg-ink-2); }
.cg-fnc__gcode { flex-basis: 100%; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }

@media (max-width: 760px) {
  .cg-dialog.cg-dialog--wide.cg-fnw, .cg-dialog.cg-dialog--wide.cg-fnw.is-large { width: calc(100vw - 16px); height: calc(100vh - 16px); }
  .cg-fnw__main, .cg-fnw.is-large .cg-fnw__main { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
  .cg-fnw__side { border-right: 0; border-bottom: 1px solid var(--cg-rule); }
  .cg-fnw .cg-fnw__search { width: 140px; }
  .cg-fnw__bar { flex-wrap: wrap; padding-left: 16px; }
  .cg-fnw__head, .cg-fnw__line, .cg-fnc__head, .cg-fnc__greet, .cg-fnc__verdict { padding-left: 16px; padding-right: 16px; }
  .cg-fnc__feed { padding: 8px 16px; }
  .cg-fnc__bio, .cg-fnc__proof { margin-left: 16px; margin-right: 16px; }
}
@media (prefers-reduced-motion: reduce) { .cg-fnw__row { transition: none; } }
${STALE_ROW_CSS}
`;
