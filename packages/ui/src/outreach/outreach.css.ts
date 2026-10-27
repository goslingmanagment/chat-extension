// The look of «Рассылка» (2026-10-25, the owner's pick: the synthesis on «Новые»'s window; ui-design §1): «Новые»'s frame
// and rows as they are (frame.css.ts, card.css.ts), and what the outreach adds in the family's tokens — the offer's
// plate in the head, «Кому»'s panel, the versions under the fans (three lines of the draft look, one solid line once
// gone), «Не войдут», the offer with its media tiles, the card's conversation with the version where the next message
// would stand, what went as a real bubble, the end, the media sheet over the window and the chip in the page's corner.
// Blue is only «Отправить» and what reached a fan; green only «+$25»; red only a failure's dot.
// A note here is a JS comment: a CSS one would ship in the window's chunk, prose for nobody.

import { type StyleSource } from '../kit';

export const OUTREACH_CSS = `
.cg-dialog.cg-dialog--wide.cg-nw.cg-ow { width: min(1180px, calc(100vw - 48px)); height: min(852px, calc(100vh - 48px)); }
.cg-dialog.cg-dialog--wide.cg-nw.cg-ow.is-large { width: min(1280px, calc(100vw - 32px)); height: min(900px, calc(100vh - 32px)); }
.cg-ow .cg-nw__main { grid-template-columns: 420px minmax(0, 1fr); position: relative; }
.cg-ow.is-large .cg-nw__main { grid-template-columns: 460px minmax(0, 1fr); }
.cg-ow .cg-nw__frame { position: relative; }
.cg-ow .cg-nw__close { align-self: center; }
.cg-btn.cg-ow__min { flex: none; align-self: center; }
.cg-ow__line b { color: var(--cg-ink-strong); font-weight: 500; }
.cg-ow .cg-nw__list { position: relative; }
.cg-ow__empty { flex: 1; padding: 28px 18px; color: var(--cg-ink-muted); font-size: var(--cg-text-sm2); text-align: center; }

${/* The offer's plate in the head: what the outreach sells, and the way back to it. */ ''}
.cg-ow__offer {
  flex: 0 1 auto; min-width: 0; max-width: 460px; display: flex; align-items: center; gap: 10px; height: 44px; margin-right: 4px; padding: 0 6px;
  border: 0; border-radius: 10px; background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule); color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.cg-ow__offer:hover { box-shadow: inset 0 0 0 1px var(--cg-rule-3); }
.cg-ow__offer:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; }
.cg-ow__otext { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.cg-ow__otitle { font-size: var(--cg-text-base); line-height: 17px; font-weight: 500; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-ow__osub { max-width: 300px; font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-ow__ochange { flex: none; pointer-events: none; }
.cg-ow__glyph {
  flex: none; display: inline-flex; justify-content: center; width: 24px; height: 32px; padding-top: 7px; border-radius: 5px; box-sizing: border-box;
  background: var(--cg-surface); box-shadow: inset 0 0 0 1px var(--cg-rule-2); font: 600 21px/1 var(--cg-serif); color: var(--cg-ink-muted);
}

${/* A medium as a picture: its thumbnail, or its kind in words on the photo's own warm darkness (the same in both themes). */ ''}
.cg-ow__thumb {
  position: relative; flex: none; display: block; overflow: hidden; border-radius: 6px; background: #3a302b; box-shadow: inset 0 0 0 1px rgb(255 255 255 / .06);
}
.cg-ow__thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cg-ow__blank { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 4px; font-size: var(--cg-text-2xs); line-height: 1.2; text-align: center; color: rgb(255 255 255 / .62); }
.cg-ow__thumb.is-xs { width: 24px; height: 32px; border-radius: 5px; }
.cg-ow__thumb.is-sm { width: 30px; height: 40px; border-radius: 5px; }
.cg-ow__thumb.is-md { width: 44px; height: 58px; border-radius: 7px; }
.cg-ow__thumb.is-lg { width: 96px; height: 128px; border-radius: 9px; }
.cg-ow__thumb.is-bt { width: 64px; height: 84px; border-radius: 8px; }
.cg-ow__thumb.is-xs .cg-ow__blank, .cg-ow__thumb.is-sm .cg-ow__blank, .cg-ow__thumb.is-md .cg-ow__blank { font-size: 0; }
.cg-ow__thumb.is-free-ring { box-shadow: 0 0 0 1.5px var(--cg-clay-ink); }
.cg-ow__mini { position: absolute; inset: 0; z-index: 1; display: flex; align-items: center; justify-content: center; color: #fff; }
.cg-ow__mini .cg-ico { filter: drop-shadow(0 1px 1px rgb(0 0 0 / .5)); }
.cg-ow__thumbs { flex: none; display: flex; gap: 3px; }
.cg-ow__len {
  position: absolute; left: 4px; bottom: 4px; z-index: 1; display: inline-flex; align-items: center; gap: 2px; height: 16px; padding: 0 4px; border-radius: 4px;
  background: rgb(0 0 0 / .6); color: #fff; font-size: var(--cg-text-2xs); line-height: 16px;
}
.cg-ow__len .cg-ico { width: 10px; height: 10px; fill: #fff; stroke: none; }
.cg-ow__thumb.is-md .cg-ow__len { left: 3px; bottom: 3px; height: 15px; padding: 0 3px; line-height: 15px; }
.cg-ow__lock {
  position: absolute; right: 4px; top: 4px; z-index: 1; display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: rgb(0 0 0 / .6); color: #fff; font-size: var(--cg-text-2xs); font-weight: 600;
}
.cg-ow__lock .cg-ico { width: 11px; height: 11px; }
.cg-ow__free {
  position: absolute; left: 4px; top: 4px; z-index: 1; height: 18px; padding: 0 6px; border-radius: 9px; background: var(--cg-clay-ink); color: var(--cg-surface);
  font-size: var(--cg-text-2xs); font-weight: 600; line-height: 18px;
}

${/* «Кому»: the tiers as checkboxes with their fans, the conditions with what they do, the live count at the foot. */ ''}
.cg-ow__kom { position: relative; }
.cg-btn.cg-ow__komb { max-width: 520px; }
.cg-ow__pop {
  position: absolute; left: 32px; top: 36px; z-index: 20; width: 372px; max-height: min(560px, calc(100vh - 220px)); overflow-y: auto; padding: 4px 4px 0;
  border: 1px solid var(--cg-rule-float); border-radius: var(--cg-r-lg); background: var(--cg-raised); box-shadow: var(--cg-shadow-float); scrollbar-width: thin;
}
.cg-ow__popnote { margin: 6px 6px 2px; padding: 7px 10px; border-radius: var(--cg-r-md); background: var(--cg-sunk); font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-2); }
.cg-ow__poph { padding: 9px 10px 3px; font-size: var(--cg-text-sm); font-weight: 500; color: var(--cg-ink-muted); }
.cg-ow__pi { display: flex; align-items: flex-start; gap: 10px; padding: 6px 10px; border-radius: var(--cg-r-sm); color: var(--cg-ink); line-height: 18px; }
.cg-ow__pi:hover { background: var(--cg-hover); }
.cg-ow__pib { flex: 1; min-width: 0; display: flex; align-items: flex-start; gap: 10px; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.cg-ow__pib:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; border-radius: 3px; }
.cg-ow__pib .cg-cb { flex: none; margin-top: 2px; color: var(--cg-ink-faint); }
.cg-ow__pi.is-on .cg-ow__pib .cg-cb { color: var(--cg-ink-strong); }
.cg-ow__pib > span { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.cg-ow__pib small { font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); text-wrap: pretty; }
.cg-ow__pi > i { flex: none; font-style: normal; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
input.cg-ow__minin.cg-field { flex: none; width: 82px; height: 24px; margin: -3px 0; padding: 0 8px; font-size: var(--cg-text-sm); color: var(--cg-ink); box-sizing: border-box; }
.cg-ow__popf { position: sticky; bottom: 0; margin: 6px -4px 0; padding: 10px 14px 11px; border-top: 1px solid var(--cg-rule); background: var(--cg-raised); font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-ow__popf b { color: var(--cg-ink-strong); font-weight: 500; }

${/* The rows: the tier after the name, a version that went in one solid line, «Не войдут» with why. */ ''}
.cg-ow .cg-nw__row.is-off .cg-nw__copy { opacity: .55; }
.cg-ow .cg-nw__row.is-aside { cursor: pointer; }
.cg-ow .cg-nw__row.is-aside .cg-nw__name { color: var(--cg-ink-2); font-weight: 500; }
.cg-ow .cg-nw__row.is-aside .cg-nw__ava { opacity: .7; }
.cg-ow .cg-nw__dtext { -webkit-line-clamp: 3; }
.cg-ow .cg-nw__draft.is-one .cg-nw__dtext { -webkit-line-clamp: 1; }
.cg-ow .cg-nw__draft.is-went { border-style: solid; border-color: var(--cg-rule-2); background: none; color: var(--cg-ink-muted); }
.cg-ow .cg-nw__st.is-strong { color: var(--cg-ink-strong); font-weight: 500; }
.cg-ow .cg-nw__st.is-done .cg-ico { color: var(--cg-ink-strong); }
.cg-btn.cg-ow__rsend { flex: none; }
.cg-ow__q2 { font-weight: 400; color: var(--cg-ink-muted); }
.cg-ow__after { font-weight: 400; color: var(--cg-ink-2); }
.cg-ow__money { color: var(--cg-money); font-weight: 500; }
.cg-ow__group { display: flex; align-items: center; gap: 0; height: 100%; padding: 10px 14px 0; box-sizing: border-box; font-size: var(--cg-text-sm); font-weight: 500; color: var(--cg-ink-muted); }
.cg-ow__group i { flex: 1; height: 1px; margin-left: 12px; background: var(--cg-rule); }

${/* The foot: «Написать N версий» is the next step — the family's main look; «Текст изменился · Переписать N». */ ''}
.cg-btn.cg-ow__main { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); font-weight: 600; }
.cg-btn.cg-ow__main:hover { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay); }
.cg-btn.cg-ow__main[aria-disabled="true"] { background: none; box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-faint); font-weight: 500; }
.cg-nw__bline.is-changed { min-height: 26px; gap: 2px; color: var(--cg-ink-2); }
.cg-btn.cg-ow__strong { color: var(--cg-ink-strong); font-weight: 500; }
.cg-ow .cg-btn--quiet[aria-pressed="true"] { background: var(--cg-seg-on); color: var(--cg-ink-strong); }

${/* The offer on the right: the common text and the media every fan gets. */ ''}
.cg-ow__ocard { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--cg-surface); }
.cg-ow__ohead { flex: none; display: flex; align-items: center; gap: 12px; padding: 16px 20px 14px 22px; border-bottom: 1px solid var(--cg-rule); }
.cg-ow__oicon {
  flex: none; display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 12px;
  background: var(--cg-sunk); color: var(--cg-ink-2); box-shadow: inset 0 0 0 1px var(--cg-rule);
}
.cg-ow__oicon.is-media { width: auto; min-width: 48px; background: none; box-shadow: none; }
.cg-ow__oicon.is-media .cg-ow__thumbs { gap: 4px; }
.cg-ow__q { margin-top: 14px; font: 600 34px/1 var(--cg-serif); color: var(--cg-ink-muted); }
.cg-ow__obody { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 18px; padding: 18px 22px 20px; overflow-y: auto; scrollbar-width: thin; }
.cg-ow__sec { display: flex; flex-direction: column; gap: 7px; }
.cg-ow__label { display: flex; align-items: center; gap: 8px; min-height: 26px; font-size: var(--cg-text-sm); font-weight: 500; color: var(--cg-ink-2); }
.cg-ow__label > span:not(.cg-nw__grow) { font-weight: 400; color: var(--cg-ink-muted); }
.cg-ow .cg-ow__text.cg-field { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: var(--cg-r-lg); font-size: var(--cg-text-lg); line-height: 21px; color: var(--cg-ink-strong); }
.cg-ow__hint { font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-muted); }
.cg-ow__bad { font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-danger); }
.cg-ow__tiles { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px; }
.cg-ow__tile { display: flex; flex-direction: column; gap: 6px; }
.cg-ow__tcap { max-width: 120px; font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-2); }
.cg-ow__tcap b { display: block; font-weight: 500; color: var(--cg-ink-strong); }
.cg-ow__addrow { display: flex; align-items: center; gap: 6px; margin: -6px 0 0 -6px; }
.cg-btn.cg-ow__addmedia { color: var(--cg-ink-2); font-weight: 500; }

${/* The fan's card, chat-like: the archive's strip, the conversation, then the version where the next message would go. */ ''}
.cg-ow__card { position: relative; }
.cg-ow__card .cg-nc__head .cg-nw__tag { margin-left: 8px; font-size: var(--cg-text-sm); font-weight: 400; color: var(--cg-ink-2); }
.cg-ow__card .cg-nc__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0 4px; }
.cg-btn.cg-nc__open { color: var(--cg-clay-ink); }
.cg-ow__conv { flex: 1 1 0; min-height: 96px; display: flex; flex-direction: column; border-top: 1px solid var(--cg-rule); background: var(--cg-feed-bg); }
.cg-ow__conv > .cg-feed { flex: 1 1 0; padding: 4px 22px 14px; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 24px); mask-image: linear-gradient(to bottom, transparent 0, #000 24px); }
.cg-ow__pill {
  flex: none; align-self: center; display: inline-flex; align-items: center; gap: 6px; max-width: calc(100% - 44px); margin: 10px 0 4px; padding: 3px 11px; border-radius: var(--cg-r-pill);
  background: var(--cg-surface); box-shadow: 0 0 0 1px var(--cg-rule); font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-2);
}
.cg-ow__pill .cg-ico { flex: none; color: var(--cg-ink-muted); }
.cg-ow__pill > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cg-feed__msg.cg-ow__sentmsg { max-width: 74%; }
.cg-feed__msg.cg-ow__sentmsg.is-going { opacity: .78; }
.cg-ow__btiles { display: flex; flex-wrap: wrap; gap: 6px; margin: 3px 0 8px; white-space: normal; }
.cg-ow__sm { display: inline-block; vertical-align: -2px; }
.cg-ow__dzone { flex: none; display: flex; flex-direction: column; gap: 10px; max-height: 58%; overflow-y: auto; padding: 14px 20px 16px 22px; border-top: 1px solid var(--cg-rule); scrollbar-width: thin; }
.cg-ow__dzone.is-empty { flex-direction: row; align-items: center; gap: 10px; min-height: 64px; box-sizing: border-box; font-size: var(--cg-text-sm2); color: var(--cg-ink-muted); }
.cg-ow__dcard { display: flex; flex-direction: column; gap: 7px; padding: 11px 14px 13px 15px; border: 1px dashed var(--cg-clay-line); border-radius: var(--cg-r-xl); background: var(--cg-draft); }
.cg-ow__dcard:focus-within { border-color: var(--cg-clay); box-shadow: 0 0 0 2px var(--cg-focus-soft); }
.cg-ow__dcard.is-busy { opacity: .72; }
.cg-ow__dcard.is-went { border-style: solid; border-color: var(--cg-rule-2); background: none; }
.cg-ow__dcard.is-went .cg-ow__dhead b { color: var(--cg-ink-2); }
.cg-ow__dcard.is-went .cg-ow__dtext { color: var(--cg-ink-muted); }
.cg-ow__dhead { display: flex; align-items: baseline; gap: 8px; font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); }
.cg-ow__dhead b { font-weight: 500; color: var(--cg-clay-ink); }
.cg-ow__dtext { font: var(--cg-text-ai)/var(--cg-leading-ai) var(--cg-serif); color: var(--cg-ink-strong); white-space: pre-wrap; overflow-wrap: anywhere; }
.cg-ow .cg-ow__dta.cg-field {
  display: block; width: 100%; min-height: 21px; margin: 0; padding: 0; border: 0; border-radius: 0; outline: 0; box-shadow: none; background: none; resize: none;
  font: var(--cg-text-ai)/var(--cg-leading-ai) var(--cg-serif); color: var(--cg-ink-strong);
}
.cg-ow .cg-ow__dta.cg-field:focus, .cg-ow .cg-ow__dta.cg-field:focus-visible { outline: none; box-shadow: none; }
.cg-ow__dwait { display: flex; align-items: center; gap: 8px; min-height: 42px; font-size: var(--cg-text-sm2); color: var(--cg-ink-muted); }
.cg-ow__dmedia { display: flex; align-items: center; gap: 12px; margin-top: 3px; }
.cg-ow__dmedia .cg-ow__thumbs { gap: 6px; }
.cg-ow__dwords { display: flex; flex-direction: column; gap: 1px; min-width: 0; font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-muted); }
.cg-ow__dwords b { font-weight: 500; color: var(--cg-ink-strong); }
.cg-ow__dnone { display: flex; align-items: center; gap: 12px; margin-top: 1px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-ow__link {
  align-self: flex-start; margin-top: 1px; padding: 0; border: 0; background: none; font: inherit; font-size: inherit; color: var(--cg-ink-2); text-align: left;
  text-decoration: underline; text-decoration-color: var(--cg-rule-3); text-underline-offset: 3px; cursor: pointer;
}
.cg-ow__link:hover { color: var(--cg-ink-strong); text-decoration-color: currentColor; }
.cg-ow__link:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; border-radius: 2px; }
.cg-ow__dnone .cg-ow__link, .cg-ow__dhead .cg-ow__link { margin: 0; }
.cg-ow__ownl { display: inline-flex; align-items: baseline; gap: 4px; color: var(--cg-ink-muted); }
.cg-ow__calm { display: flex; align-items: center; gap: 8px; min-height: 22px; margin: -2px 0 -4px; font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-2); }
.cg-ow__calm b { font-weight: 500; color: var(--cg-ink-strong); }
.cg-ow__calm > .cg-dot { flex: none; }
.cg-ow__acts { display: flex; align-items: center; gap: 2px; }
.cg-ow__acts .cg-btn--quiet { gap: 6px; color: var(--cg-ink-2); }
.cg-ow__acts .cg-btn--quiet:first-child { margin-left: -6px; }
.cg-ow__acts .cg-btn--send { height: 32px; padding: 0 14px; font-size: var(--cg-text-md); }
.cg-ow__dzone.is-sent { flex-direction: row; align-items: center; gap: 12px; min-height: 72px; box-sizing: border-box; }
.cg-ow__sentline { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cg-ow__sentline b { display: inline-flex; align-items: center; gap: 7px; font-weight: 500; color: var(--cg-ink-strong); }
.cg-ow__sentline > span { padding-left: 21px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-ow__dzone .cg-nc__gst { margin: -2px 0 0; }

${/* The end: what the outreach did — sent, bought or answered, what to check. */ ''}
.cg-ow__end { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--cg-surface); }
.cg-ow__ebody { flex: 1; min-height: 0; overflow-y: auto; padding: 26px 32px 12px; scrollbar-width: thin; }
.cg-ow__etitle { margin: 0; font: 600 var(--cg-text-3xl)/1.15 var(--cg-serif); color: var(--cg-ink-strong); letter-spacing: -0.01em; }
.cg-ow__esub { margin-top: 6px; font-size: var(--cg-text-sm2); color: var(--cg-ink-muted); }
.cg-ow__stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 20px 0 26px; border: 1px solid var(--cg-rule-2); border-radius: var(--cg-r-xl); }
.cg-ow__stats.is-two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.cg-ow__stat { min-width: 0; display: flex; flex-direction: column; gap: 3px; padding: 14px 18px 15px; }
.cg-ow__stat + .cg-ow__stat { border-left: 1px solid var(--cg-rule-2); }
.cg-ow__stat > span { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-ow__stat b { font-size: 24px; line-height: 30px; font-weight: 600; color: var(--cg-ink-strong); }
.cg-ow__stat b.cg-ow__money { color: var(--cg-money); }
.cg-ow__stat b i { font-style: normal; font-size: var(--cg-text-xl); font-weight: 500; color: var(--cg-ink-muted); }
.cg-ow__stat small { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-ow__eh { margin: 22px 0 4px; font-size: var(--cg-text-base); font-weight: 600; color: var(--cg-ink-strong); }
.cg-ow__stats + .cg-ow__eh { margin-top: 0; }
.cg-ow__erow { display: flex; align-items: center; gap: 12px; min-height: 52px; border-bottom: 1px solid var(--cg-rule); }
.cg-ow__erow .cg-nw__ava.is-row { width: 30px; height: 30px; font-size: var(--cg-text-sm); }
.cg-ow__ename { flex: none; width: 96px; padding: 0; border: 0; background: none; font: inherit; font-weight: 500; color: var(--cg-ink-strong); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.cg-ow__ename:hover { text-decoration: underline; text-decoration-color: var(--cg-rule-3); text-underline-offset: 3px; }
.cg-ow__emid { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 7px; font-size: var(--cg-text-sm2); color: var(--cg-ink-2); }
.cg-ow__erow .cg-ow__money { font-weight: 600; }
.cg-ow__quote { min-width: 0; color: var(--cg-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-ow__quote::before { content: "«"; color: var(--cg-ink-muted); }
.cg-ow__quote::after { content: "»"; color: var(--cg-ink-muted); }
.cg-ow__etime { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-ow__names { display: flex; flex-wrap: wrap; gap: 6px 20px; padding-top: 6px; font-size: var(--cg-text-sm2); color: var(--cg-ink-muted); }
.cg-ow__names b { margin-right: 5px; font-weight: 500; color: var(--cg-ink-strong); }
.cg-ow__efoot { flex: none; display: flex; align-items: center; gap: 12px; min-height: 58px; margin: 0 32px; border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-ow__efoot > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

${/* The media sheet over the window: the vault picker or «Из постов», «Готово». */ ''}
.cg-ow__veil { position: absolute; inset: 72px 0 0; z-index: 30; background: rgb(27 26 23 / .16); }
:host([data-scheme="dark"]) .cg-ow__veil { background: rgb(0 0 0 / .42); }
.cg-ow__sheet {
  position: absolute; left: 10px; right: 10px; bottom: 10px; top: 82px; z-index: 31; display: flex; flex-direction: column; min-height: 0; overflow: hidden;
  border-radius: 12px; background: var(--cg-surface); box-shadow: var(--cg-shadow-float), 0 0 0 1px var(--cg-rule-2);
}
.cg-ow__shead { flex: none; display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 10px 0 20px; border-bottom: 1px solid var(--cg-rule); }
.cg-ow__stitle { font-size: var(--cg-text-xl); font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; }
.cg-ow__ssub { min-width: 0; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-ow__sheet .cg-pvm { flex: 1; min-height: 0; }
.cg-ow__sfoot { flex: none; display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 12px 0 20px; border-top: 1px solid var(--cg-rule); background: var(--cg-sunk); }
.cg-ow__sum { flex: 1; min-width: 0; font-size: var(--cg-text-sm2); color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-ow__sum b { color: var(--cg-ink-strong); font-weight: 600; }
.cg-ow__posts { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px 20px; overflow-y: auto; scrollbar-width: thin; }
.cg-ow__pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.cg-ow__pcell {
  display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 8px 12px 8px 8px; border: 0; border-radius: var(--cg-r-lg); background: var(--cg-surface);
  box-shadow: inset 0 0 0 1px var(--cg-rule-2); font: inherit; color: inherit; text-align: left; cursor: pointer;
}
.cg-ow__pcell:hover { box-shadow: inset 0 0 0 1px var(--cg-ink-muted); }
.cg-ow__pcell.is-on { background: var(--cg-seg-on); box-shadow: inset 0 0 0 1.5px var(--cg-ink-strong); }
.cg-ow__pcell:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; }
.cg-ow__pcell .cg-cb { flex: none; color: var(--cg-ink-faint); }
.cg-ow__pcell.is-on .cg-cb { color: var(--cg-ink-strong); }
.cg-ow__pthumb { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 48px; border-radius: 6px; background: #3a302b; color: #fff; }
.cg-ow__pwords { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-ow__pwords b { font-size: var(--cg-text-base); font-weight: 500; color: var(--cg-ink-strong); }
.cg-ow__pempty { display: flex; align-items: center; gap: 10px; padding: 18px 4px; font-size: var(--cg-text-sm2); line-height: 19px; color: var(--cg-ink-muted); text-wrap: pretty; }
.cg-ow__pempty .cg-ico { flex: none; color: var(--cg-ink-muted); }
.cg-ow__phint { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-muted); }

@media (max-width: 760px) {
  .cg-dialog.cg-dialog--wide.cg-nw.cg-ow, .cg-dialog.cg-dialog--wide.cg-nw.cg-ow.is-large { width: calc(100vw - 16px); height: calc(100vh - 16px); }
  .cg-ow__offer { display: none; }
  .cg-ow__ebody { padding: 18px 16px 10px; }
  .cg-ow__efoot { margin: 0 16px; }
  .cg-ow__stats { grid-template-columns: minmax(0, 1fr); }
  .cg-ow__stat + .cg-ow__stat { border-left: 0; border-top: 1px solid var(--cg-rule-2); }
}
@media (prefers-reduced-motion: reduce) { .cg-ow__dcard { transition: none; } }
`;

/** The chip of a minimized outreach: its own root, a corner of the page. */
export const OUTREACH_CHIP_CSS = `
.cg-ow-chip {
  position: fixed; bottom: 16px; z-index: 1; display: flex; align-items: center; gap: 10px; width: 300px; padding: 9px 12px 9px 9px; border: 0; border-radius: 12px;
  background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-rule-2), var(--cg-shadow-float); font-family: var(--cg-font); text-align: left; cursor: pointer;
  pointer-events: auto; box-sizing: border-box; color: var(--cg-ink);
}
.cg-ow-chip.is-rail { left: 76px; }
.cg-ow-chip.is-launcher { left: 16px; bottom: 136px; }
.cg-ow-chip:hover { box-shadow: inset 0 0 0 1px var(--cg-clay-line), var(--cg-shadow-float); }
.cg-ow-chip:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; }
.cg-ow-chip__icon { flex: none; display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 9px; background: var(--cg-clay-bg); color: var(--cg-clay-ink); }
.cg-ow-chip__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cg-ow-chip__text b { font-size: var(--cg-text-base); line-height: 17px; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-ow-chip__text b span { font-weight: 400; color: var(--cg-ink-2); }
.cg-ow-chip__text > span { font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-ow-chip .cg-ow__money { color: var(--cg-money); font-weight: 500; }
.cg-ow-chip__exp { flex: none; color: var(--cg-ink-muted); }
`;

export const OUTREACH_STYLES: StyleSource = { id: 'cg-outreach', css: OUTREACH_CSS };
export const OUTREACH_CHIP_STYLES: StyleSource = { id: 'cg-outreach-chip', css: OUTREACH_CHIP_CSS };
