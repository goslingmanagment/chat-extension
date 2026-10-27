// The look of «Онлайн» (2026-10-26, the owner's demo): «Новые»'s frame and rows and «Рассылка»'s card as they are, and
// what the window adds in the family's tokens — the live dot of the title, the presence dots (green: now, amber: within
// half an hour, grey: longer), the groups' heads, the rows of an auto height with the text under them, the period's
// menu, the card's «why now» box, its composer, the line of what went, and the end of the pass. Green is only presence and answers;
// blue only «Отправить».
// A note here is a JS comment: a CSS one would ship in the window's chunk, prose for nobody.

import { type StyleSource } from '../kit';
import { MINI_STRIP_CSS } from '../spenders/preview/MiniStrip';

export const ONLINE_CSS = `
.ol .cg-nw__title { display: flex; align-items: center; gap: 10px; }
.ol .cg-nw__title::before {
  content: ""; flex: none; width: 9px; height: 9px; margin-top: 3px; border-radius: 50%; background: var(--cg-good-ink);
  box-shadow: 0 0 0 3px var(--cg-good-bg);
}
.ol .cg-nw__list { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.ol .cg-nw__row { height: auto; min-height: 70px; padding-bottom: 10px; cursor: pointer; }
.ol .cg-nw__row.is-sel, .ol .cg-nw__row.is-sel:hover { background: var(--cg-sel); }
.ol .cg-nw__row.is-handled .cg-nw__copy, .ol .cg-nw__row.is-handled .ol-av { opacity: .62; }
.ol .cg-nw__row.is-handled.is-sel .cg-nw__copy, .ol .cg-nw__row.is-handled.is-sel .ol-av { opacity: 1; }
.ol .cg-nw__row.is-new { animation: ol-flash 2.6s var(--cg-ease); }
@keyframes ol-flash { 0%, 35% { background: var(--cg-good-bg); } 100% { background: transparent; } }
@media (prefers-reduced-motion: reduce) { .ol .cg-nw__row.is-new { animation: none; } }
.ol .cg-nw__dtext { -webkit-line-clamp: 2; }
.ol .cg-ow__group { height: auto; padding: 14px 14px 6px; }
.ol .cg-ow__group > span { margin-left: 6px; font-weight: 400; }
.ol .cg-ow__group.is-quiet { color: var(--cg-ink-faint); }
.ol .cg-nw__st.is-why { color: var(--cg-ink-2); }
.ol .cg-nw__st.is-act { color: var(--cg-ink-strong); font-weight: 500; }
.ol .cg-nw__st.is-good { color: var(--cg-good-ink); font-weight: 500; }
.ol .cg-nw__st.is-quiet { color: var(--cg-ink-muted); }
.ol .cg-nw__st.is-done { color: var(--cg-ink-2); }
.ol-good { color: var(--cg-good-ink); font-weight: 500; }
.ol-empty { padding: 22px 18px; color: var(--cg-ink-muted); font-size: var(--cg-text-sm2); text-align: center; }

${/* The picture with its presence dot; the dot of the row's end. */ ''}
.ol-av { position: relative; flex: none; width: 40px; height: 40px; }
.ol .cg-nw__row > .ol-av { margin-top: 6px; }
.ol-av.is-card { width: 48px; height: 48px; }
.ol-pres { position: absolute; right: -1px; bottom: -1px; z-index: 1; width: 11px; height: 11px; border-radius: 50%; background: var(--cg-good-ink); box-shadow: 0 0 0 2px var(--cg-surface); }
.ol-av.is-card .ol-pres { width: 13px; height: 13px; }
.ol-pres.is-fading { background: var(--cg-amber-ink); }
.ol-pres.is-gone { background: var(--cg-ink-faint); }
.ol .cg-nw__row.is-sel .ol-pres { box-shadow: 0 0 0 2px var(--cg-sel); }
.ol-seen { display: inline-flex; align-items: center; gap: 5px; font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); white-space: nowrap; }
.ol-seen.is-fresh { color: var(--cg-ink-2); }
.ol-sdot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--cg-good-ink); }
.ol-sdot.is-fading { background: var(--cg-amber-ink); }
.ol-sdot.is-gone { background: var(--cg-ink-faint); }

${/* The name with the fan's badges (Fansly): FBuddy's gem in its tier's colour, Fansly's blue card in its corner. */ ''}
.ol-name { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ol-name > .cg-nw__name, .ol-name > .cg-nc__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ol-badge {
  position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; height: 18px; padding: 0 5px;
  border-radius: 999px; border: 1px solid var(--ol-badge-line); background: var(--ol-badge-bg); color: var(--ol-badge-ink);
}
.ol-name.is-card .ol-badge { height: 20px; padding: 0 6px; }
.ol-badge .cg-ico { stroke-width: 1.8; }
.ol-badge__card.cg-ico { position: absolute; right: -4px; bottom: -3px; width: 9px; height: 9px; padding: 1px; box-sizing: content-box; border-radius: 3px; background: var(--cg-surface); color: #0ea5e9; stroke-width: 2.2; }
.ol .cg-nw__row.is-sel .ol-badge__card.cg-ico { background: var(--cg-sel); }
.ol-badge.is-bronze { --ol-badge-ink: #b8692a; --ol-badge-line: rgb(205 127 50 / .6); --ol-badge-bg: rgb(205 127 50 / .14); }
.ol-badge.is-silver { --ol-badge-ink: #5f6f86; --ol-badge-line: rgb(100 116 139 / .55); --ol-badge-bg: rgb(100 116 139 / .13); }
.ol-badge.is-gold { --ol-badge-ink: #b58900; --ol-badge-line: rgb(234 179 8 / .7); --ol-badge-bg: rgb(255 215 0 / .2); }
.ol-badge.is-platinum { --ol-badge-ink: #0891b2; --ol-badge-line: rgb(8 145 178 / .6); --ol-badge-bg: rgb(8 145 178 / .14); }
.ol-badge.is-blue { --ol-badge-ink: #0ea5e9; --ol-badge-line: rgb(14 165 233 / .6); --ol-badge-bg: rgb(14 165 233 / .13); }
.ol-badge.is-basic { --ol-badge-ink: #e05a72; --ol-badge-line: rgb(251 113 133 / .6); --ol-badge-bg: rgb(251 113 133 / .13); }
:host([data-scheme="dark"]) .ol-badge.is-silver { --ol-badge-ink: #cbd5e1; --ol-badge-line: rgb(203 213 225 / .5); }
:host([data-scheme="dark"]) .ol-badge.is-gold { --ol-badge-ink: #ffd700; }
:host([data-scheme="dark"]) .ol-badge.is-bronze { --ol-badge-ink: #d9934f; }
:host([data-scheme="dark"]) .ol-badge.is-platinum { --ol-badge-ink: #22d3ee; }
:host([data-scheme="dark"]) .ol-badge.is-blue, :host([data-scheme="dark"]) .ol-badge__card.cg-ico { color: #7dd3fc; }
:host([data-scheme="dark"]) .ol-badge.is-blue { --ol-badge-ink: #7dd3fc; }
.ol-fbuddy { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); line-height: 16px; }
.ol-fbuddy .cg-ico { color: #0891b2; }

${/* The bar: «Зашли за» and its menu. */ ''}
.ol-period { display: inline-flex; align-items: center; gap: 4px; }

${/* The card: why now, the conversation, the text. */ ''}
.ol .cg-nc__head { padding-bottom: 10px; }
.ol .cg-nc__meta + .cg-nc__meta { margin-top: 2px; }
.ol-meta2 { display: inline-flex; align-items: center; gap: 6px; }
.ol-why {
  flex: none; display: flex; align-items: flex-start; gap: 9px; margin: 0 20px 12px 22px; padding: 9px 12px; border-radius: var(--cg-r-md); background: var(--cg-sunk);
  font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-2);
}
.ol-why b { color: var(--cg-ink-strong); font-weight: 600; }
.ol-why .cg-ico { flex: none; margin-top: 2px; color: var(--cg-ink-muted); }
.ol-why.is-warn { background: var(--cg-amber-bg); box-shadow: inset 0 0 0 1px var(--cg-amber-line); }
.ol-why.is-warn .cg-ico { color: var(--cg-amber-ink); }
.ol .cg-ow__acts kbd { margin-left: 4px; font: 500 var(--cg-text-2xs)/16px var(--cg-font); padding: 0 5px; border-radius: 4px; box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-muted); }
.ol-sent { display: flex; align-items: center; gap: 10px; min-height: 46px; font-size: var(--cg-text-sm2); color: var(--cg-ink-2); }
.ol-sent b { flex: none; display: inline-flex; align-items: center; gap: 7px; font-weight: 500; color: var(--cg-ink-strong); white-space: nowrap; }
.ol-sent .cg-btn { margin-left: auto; }
.ol .cg-ow__dzone.is-sent { min-height: 0; }

${/* Under the conversation, as in the Spenders chat: the text (or the line where it will stand), then the composer — the field «Свой текст» with Fix inside, its «Отправить», the strip — then «Пропустить», «Не предлагать» and the advice. */ ''}
${MINI_STRIP_CSS}
.ol .ol-zone { gap: 10px; }
.ol-hint { font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); }
.ol-hint b { font-weight: 600; color: var(--cg-ink-2); }
.ol-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ol-text > .cg-ow__dhead { padding: 0 2px; }
.ol-text__acts { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
.ol-text__acts .cg-btn--send { margin-right: 6px; }
.ol-compose { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ol-compose__draft { display: flex; align-items: flex-end; gap: 8px; min-width: 0; }
.ol-compose__box { position: relative; flex: 1 1 auto; min-width: 0; }
.ol-compose__box .cg-field--area { min-height: 36px; padding-right: 60px; }
.ol-compose__fix { position: absolute; right: 4px; bottom: 4px; display: inline-flex; }
.ol-compose__send { flex: none; }
.ol .ol-compose__row { min-height: 38px; }
.ol .ol-compose__row > .cg-pvb { flex: none; padding: 0; margin-left: -7px; }

${/* The end of the pass, and the pane with no card. */ ''}
.ol-end { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 12px; padding: 32px 40px; }
.ol-end h3 { margin: 0; font: 600 26px/1.15 var(--cg-serif); color: var(--cg-ink-strong); }
.ol-end p { margin: 0; max-width: 52ch; color: var(--cg-ink-2); font-size: var(--cg-text-md); line-height: 20px; }
.ol-end ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; font-size: var(--cg-text-md); color: var(--cg-ink-2); }
.ol-end li b { color: var(--cg-ink-strong); font-weight: 600; }
`;

export const ONLINE_STYLES: StyleSource = { id: 'cg-online', css: ONLINE_CSS };
