// The look of «Новые» on Fansly (R20 P10a; ui-design §3.6, §3.12, §4.17): the family's list window — the 52 px header,
// the filters, flat rows on hairlines — with three columns (Фан · Подписка · Статус), the initial as the avatar, and
// the card of 480 px: the profile, the verdict in words, «Уже писали» folded, the conversation in the host's own
// bubble colours. No colour of meaning beyond the family's list: blue only on «Отправить» of the card's greeting (R20
// P10c: what reaches the fan), the terracotta only where the kit puts it (focus, the selected row, the mark's dot), red
// only beside a code.

import { FEED_CSS } from '../../../spenders/preview/Feed';

export const FANSLY_NEWCOMERS_CSS = `
.cg-fnw__custom { font-weight: 400; color: var(--cg-ink-muted); }
.cg-nc__st.is-2 { color: var(--cg-ink-2); }
.cg-fnc__check { display: flex; margin-top: 6px; }
.cg-fnw__cool { border-top: 0; border-bottom: 1px solid var(--cg-rule); color: var(--cg-ink-strong); font-weight: 500; }
.cg-fnw .cg-nc__incomplete { border-top: 0; border-bottom: 1px solid var(--cg-rule); }
.cg-fnw__stopped { flex: none; padding: 6px 16px 8px 20px; border-bottom: 1px solid var(--cg-rule); }
.cg-fnw__failed { flex: none; display: flex; flex-direction: column; gap: 10px; padding: 16px 20px 8px; max-width: 72ch; }
.cg-fnw__hint2 { font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); }
.cg-fnw__empty { padding: 24px 20px; color: var(--cg-ink-muted); max-width: 64ch; }
.cg-fnc { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--cg-surface); }
.cg-fnc--none { align-items: center; justify-content: center; }
.cg-fnc__head { flex: none; display: flex; align-items: flex-start; gap: 10px; padding: 12px 12px 10px 16px; border-bottom: 1px solid var(--cg-rule); }
.cg-fnc__who { flex: 1; min-width: 0; }
.cg-fnc__name { font-size: var(--cg-text-xl); line-height: 22px; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-fnc__user { font-weight: 400; color: var(--cg-ink-muted); margin-left: 6px; font-size: var(--cg-text-base); }
.cg-fnc__meta { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); margin-top: 2px; }
.cg-fnc__open { flex: none; text-decoration: none; }
.cg-fnc__verdict {
  flex: none; display: flex; flex-direction: column; gap: 2px; padding: 8px 12px 8px 16px; border-bottom: 1px solid var(--cg-rule);
  font-size: var(--cg-text-sm); line-height: 18px; color: var(--cg-ink-2);
}
.cg-fnc__verdict .is-strong { color: var(--cg-ink-strong); font-weight: 500; }
.cg-fnc__why { color: var(--cg-ink-muted); }
.cg-fnc__bio {
  flex: none; max-height: 88px; overflow-y: auto; padding: 8px 12px 8px 16px; border-bottom: 1px solid var(--cg-rule);
  font-size: var(--cg-text-sm); line-height: 18px; color: var(--cg-ink-2); white-space: pre-wrap; overflow-wrap: anywhere; scrollbar-width: thin;
}
.cg-fnc__proof { flex: none; padding: 6px 12px 8px 16px; border-bottom: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); line-height: 18px; }
.cg-fnc__proof summary { cursor: pointer; color: var(--cg-ink-strong); font-weight: 500; }
.cg-fnc__proofNote { color: var(--cg-ink-muted); margin-top: 4px; }
.cg-fnc__proof blockquote {
  margin: 6px 0 0; padding: 6px 10px; border-radius: var(--cg-r-xl); background: var(--cg-chat-out); color: var(--cg-ink);
  white-space: pre-wrap; overflow-wrap: anywhere; max-height: 120px; overflow-y: auto;
}
.cg-fnc__auto { display: block; font-size: var(--cg-text-xs); line-height: 16px; color: var(--cg-ink-muted); margin-bottom: 2px; }
.cg-fnc__fail { align-self: stretch; display: flex; flex-direction: column; gap: 6px; margin: auto 0; color: var(--cg-ink-2); }
.cg-fnc .cg-feed__empty { display: inline-flex; align-items: center; gap: 6px; }
/* R20 P10c: the card's greeting at its foot — the field, the bar of buttons, the click's state, the hint. */
.cg-fnc__greet { flex: none; display: flex; flex-direction: column; gap: 6px; padding: 8px 12px 10px 16px; border-top: 1px solid var(--cg-rule); background: var(--cg-surface); }
.cg-fnc__field { position: relative; }
.cg-fnc__field .cg-field { width: 100%; box-sizing: border-box; padding-right: 36px; }
.cg-fnc__ai {
  position: absolute; top: 6px; right: 8px; padding: 0 5px; border-radius: var(--cg-r-sm, 4px); font-size: var(--cg-text-xs); line-height: 16px;
  font-weight: 600; color: var(--cg-ink-2); background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule-2);
}
.cg-fnc__gnote { font-size: var(--cg-text-sm); line-height: 18px; color: var(--cg-ink-muted); }
.cg-fnc__gnote.is-strong { color: var(--cg-ink-strong); font-weight: 500; }
.cg-fnc__mark { margin: 0; }
.cg-fnc__gbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cg-fnc__count { margin-right: auto; font-size: var(--cg-text-xs); color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; }
.cg-fnc__gst { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12.5px; line-height: 17px; color: var(--cg-ink-muted); }
.cg-fnc__gst > b { font-weight: 500; color: var(--cg-ink-strong); }
.cg-fnc__gst.is-sent { color: var(--cg-ink-2); }
.cg-fnc__gcode { flex-basis: 100%; font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-muted); }
.cg-fnc__gcode > b { font-weight: 500; color: var(--cg-ink-2); }
.cg-fnc__noauto { font-size: var(--cg-text-xs); line-height: 16px; color: var(--cg-ink-muted); }
${FEED_CSS}
`;
