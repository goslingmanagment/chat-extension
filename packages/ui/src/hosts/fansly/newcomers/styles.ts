// The look of Fansly's own parts of «Новые фоловеры» (X59; ui-design §3.12), in the family's «Новые» frame every site
// shares (ui/newcomers frame.css.ts: the window, the toolbar, the list, the rows, the batch): what only the pass has —
// «Пауза», «Проверить заново», the pause Fansly asked for, why the pass stopped or the list failed — and Fansly's card on
// the right: the profile, «Открыть в Fansly ↗», the conversation in plain bubbles (ours on the right), the verdict, the
// draft in the serif of AI text and «Отправить →». Blue only on what reaches a fan: the card's «Отправить →» and a
// draft row's own small «Отправить» (X59).
// Every size is a token, so «Крупнее» scales the window.

import { STALE_ROW_CSS } from '../../../dock/stale-row.css';

export const FANSLY_NEWCOMERS_CSS = `
.cg-fnw__run, .cg-fnw__refresh { flex: none; }
.cg-fnw__cool { color: var(--cg-ink-strong); font-weight: 500; }
.cg-fnw__stopped { flex: none; padding: 6px 16px 8px 22px; border-bottom: 1px solid var(--cg-rule); }
.cg-fnw__failed { flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 18px 22px; max-width: 72ch; }
.cg-fnw__hint2 { margin: 0; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); }

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
  .cg-fnc__head, .cg-fnc__greet, .cg-fnc__verdict { padding-left: 16px; padding-right: 16px; }
  .cg-fnc__feed { padding: 8px 16px; }
  .cg-fnc__bio, .cg-fnc__proof { margin-left: 16px; margin-right: 16px; }
}
${STALE_ROW_CSS}
`;
