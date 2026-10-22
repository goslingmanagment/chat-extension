// The look of the «Новые» card on every site (X59, X60; ui-design §3.12): the old Fansly extension's card in the
// family's tokens — the profile, the way into the chat at the top right, the site's notes, the conversation in the
// preview's own bubbles (the feed every site's previews wear), the verdict, the draft in the serif of AI text, «AI»,
// and «Отправить →». Blue only on what reaches a fan.
// Every size is a token, so «Крупнее» scales the window.
// A note here is a JS comment: a CSS one would ship in the window's chunk, prose for nobody.

import { type StyleSource } from '../kit';
import { STALE_ROW_CSS } from '../dock/stale-row.css';
import { FEED_CSS } from '../spenders/preview/Feed';

export const NEWCOMERS_CARD_CSS = `
.cg-nc { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--cg-surface); }
.cg-nc--none { align-items: center; justify-content: center; }
.cg-nc__head { flex: none; display: flex; align-items: center; gap: 12px; padding: 16px 20px 12px 22px; }
.cg-nc__who { flex: 1; min-width: 0; }
.cg-nc__name { margin: 0; font-size: var(--cg-text-xl); line-height: 20px; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-nc__meta { margin-top: 3px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-nc__open { flex: none; align-self: flex-start; margin-top: 2px; color: var(--cg-clay-ink); font-size: var(--cg-text-sm); text-decoration: none; white-space: nowrap; border-radius: 3px; }
a.cg-nc__open:hover { text-decoration: underline; }
a.cg-nc__open:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; }
.cg-btn.cg-nc__open { margin-top: -4px; padding: 0 6px; color: var(--cg-clay-ink); }
.cg-nc__note {
  flex: none; display: flex; align-items: center; gap: 8px; min-height: 30px; margin: 0 20px 10px 22px; padding: 0 4px 0 10px; border-radius: var(--cg-r-md);
  font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-2); background: var(--cg-sunk);
}
.cg-nc__note .cg-ico { flex: none; color: var(--cg-ink-muted); }
.cg-nc__note > span { min-width: 0; }
.cg-nc__note .cg-btn { flex: none; }
.cg-nc__lag { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-strong); font-weight: 500; }
.cg-nc__bio {
  flex: none; margin: 0 22px 10px; max-height: 54px; overflow-y: auto; font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-2);
  white-space: pre-wrap; overflow-wrap: anywhere; scrollbar-width: thin;
}
.cg-nc__moved { flex: none; margin: 0 22px 10px; padding: 7px 10px; border-radius: var(--cg-r-md); font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-strong); background: var(--cg-sunk); }
.cg-nc__proof { flex: none; margin: 0 22px 10px; padding: 7px 10px; max-height: 130px; overflow: auto; border: 1px solid var(--cg-rule); border-radius: var(--cg-r-md); font-size: var(--cg-text-sm); }
.cg-nc__proof summary { cursor: pointer; color: var(--cg-ink-strong); font-weight: 500; }
.cg-nc__proofNote { margin-top: 4px; color: var(--cg-ink-muted); }
.cg-nc__proof blockquote { margin: 6px 0 0; color: var(--cg-ink); white-space: pre-wrap; overflow-wrap: anywhere; }

.cg-nc > .cg-feed { flex: 1 1 0; min-height: 64px; padding: 12px 22px; border-top: 1px solid var(--cg-rule); }
.cg-nc .cg-feed__state { margin: auto; display: inline-flex; align-items: center; gap: 6px; max-width: 46ch; padding: 16px; text-align: center; color: var(--cg-ink-muted); }
.cg-nc .cg-feed__fail { margin: auto 0; display: flex; flex-direction: column; gap: 6px; color: var(--cg-ink-2); }
.cg-nc .cg-feed__fail p { margin: 0; }
.cg-nc__state { flex: 1; min-height: 0; overflow-y: auto; border-top: 1px solid var(--cg-rule); }
.cg-nc__empty { margin: auto; display: inline-flex; align-items: center; gap: 6px; max-width: 46ch; padding: 16px; text-align: center; color: var(--cg-ink-muted); }

.cg-nc__verdict { flex: none; display: flex; align-items: center; gap: 12px; padding: 10px 20px 10px 22px; border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-2); }
.cg-nc__why { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cg-nc__why b { color: var(--cg-ink-strong); font-weight: 500; }
.cg-nc__check { flex: none; display: inline-flex; }
.cg-nc__verdict .cg-card { border-top: 0; }

.cg-nc__greet { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px 20px 16px 22px; border-top: 1px solid var(--cg-rule); }
.cg-nc__field { position: relative; }
.cg-nc__field .cg-field { padding: 10px 44px 10px 12px; border-radius: var(--cg-r-lg); font: var(--cg-text-ai)/var(--cg-leading-ai) var(--cg-serif); }
.cg-nc__field .cg-field::placeholder { font: var(--cg-text-sm)/18px var(--cg-font); }
.cg-nc__ai {
  position: absolute; top: 8px; right: 9px; padding: 0 5px; border-radius: var(--cg-r-sm); font-size: var(--cg-text-xs); line-height: 16px; font-weight: 600;
  color: var(--cg-clay-ink); background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line);
}
.cg-nc__gbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cg-nc__gbar .cg-pvb__slot { display: inline-flex; flex: none; }
.cg-nc__gnote { font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-muted); }
.cg-nc__gnote.is-strong { color: var(--cg-ink-strong); font-weight: 500; }
.cg-nc__greet .cg-stale { margin: 0; }
.cg-nc__greet .cg-card { border-top: 0; }
.cg-nc__gst { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--cg-text-sm2); line-height: 17px; color: var(--cg-ink-muted); }
.cg-nc__gst > b { font-weight: 500; color: var(--cg-ink-strong); }
.cg-nc__gst > .cg-dot, .cg-nc__gst > .cg-spin, .cg-nc__gst > .cg-ico { flex: none; }
.cg-nc__gst.is-sent { color: var(--cg-ink-2); }
.cg-nc__gst .cg-btn { margin-left: 2px; }
.cg-nc__gcode { flex-basis: 100%; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); overflow-wrap: anywhere; }
.cg-nc__gcode b { font-weight: 500; color: var(--cg-ink-2); }
.cg-nc__greet .cg-pvm__line { margin: 0 -20px -16px -22px; padding-left: 22px; }

@media (max-width: 760px) {
  .cg-nc__head, .cg-nc__greet, .cg-nc__verdict { padding-left: 16px; padding-right: 16px; }
  .cg-nc > .cg-feed { padding: 8px 16px; }
  .cg-nc__bio, .cg-nc__proof, .cg-nc__moved, .cg-nc__note { margin-left: 16px; margin-right: 16px; }
}
${FEED_CSS}
${STALE_ROW_CSS}
`;

/** The card's sheet, shared by every site's «Новые»: one id, so a page that has both carries it once. */
export const NEWCOMERS_CARD_STYLES: StyleSource = { id: 'cg-newcomers-card', css: NEWCOMERS_CARD_CSS };
