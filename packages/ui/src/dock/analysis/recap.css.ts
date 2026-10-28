// The Recap window and its cheat sheet (2026-10-28, the owner's «Досье во весь экран»). A calm reader: a rail of
// contents on paper a shade darker, the document on the paper itself; headings that catch the eye (a tinted tile and
// the name in 21 px), the labels of «Имя: …» in a column of their own, the model's text in the serif. The window's frame
// (its size, the stronger scrim) is the overlay's (overlays/expanded); this sheet is adopted with Recap's chunk, by the
// window's root and by the dock's, where the cheat sheet folds.

import { dark, type StyleSource } from '../../kit';

export const RECAP_CSS = `
.cg-rx {
  --cg-rx-rail: 268px;
  position: relative; isolation: isolate; flex: 1 1 auto; display: grid; grid-template-columns: var(--cg-rx-rail) minmax(0, 1fr);
  min-height: 0; height: 100%; color: var(--cg-ink); font-family: var(--cg-font); -webkit-font-smoothing: antialiased; outline: none;
}
.cg-rx-paper {
  position: absolute; inset: 0; z-index: -1; overflow: hidden; border-radius: 16px; transform-origin: 0 0; background: var(--cg-surface);
  box-shadow: 0 34px 90px -30px rgb(27 26 23 / 0.55), 0 3px 10px -2px rgb(27 26 23 / 0.1), 0 0 0 1px rgb(27 26 23 / 0.08);
}
.cg-rx-paper__rail { position: absolute; left: 0; top: 0; bottom: 0; width: var(--cg-rx-rail); background: var(--cg-sunk); box-shadow: inset -1px 0 0 var(--cg-rule); }
.cg-rx-paper__tint { position: absolute; inset: 0; background: var(--cg-clay-bg); opacity: 0; }

${/* ── the rail ── */ ''}
.cg-rx-rail {
  position: relative; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none;
  padding: 24px 16px 16px 18px; border-radius: 16px 0 0 16px;
}
.cg-rx-rail::-webkit-scrollbar { display: none; }
.cg-rx-kick { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--cg-clay-ink); }
.cg-rx-fan { margin: 9px 0 0; font-size: 22px; line-height: 1.18; font-weight: 700; letter-spacing: -0.02em; color: var(--cg-ink-strong); overflow-wrap: anywhere; }
.cg-rx-handle { margin-top: 4px; font-size: 12px; line-height: 16px; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.cg-rx-seg { position: relative; display: grid; grid-template-columns: 1fr 1fr; margin: 18px 0 16px; padding: 3px; border-radius: 10px; background: var(--cg-groove); }
.cg-rx-seg__b {
  position: relative; z-index: 1; height: 30px; padding: 0; border: 0; border-radius: 7px; background: none; cursor: pointer;
  color: var(--cg-ink-muted); font: inherit; font-size: 13px; line-height: 30px; font-weight: 600; transition: color 160ms;
}
.cg-rx-seg__b:hover { color: var(--cg-ink-2); }
.cg-rx-seg__b[aria-checked="true"] { color: var(--cg-ink-strong); }
.cg-rx-seg__b[aria-disabled="true"] { color: var(--cg-ink-faint); cursor: default; }
.cg-rx-seg__b:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
.cg-rx-seg__thumb {
  position: absolute; z-index: 0; top: 3px; left: 3px; width: calc(50% - 3px); height: 30px; border-radius: 7px; background: var(--cg-surface);
  box-shadow: 0 1px 2px rgb(38 36 32 / 0.14), 0 0 0 0.5px rgb(38 36 32 / 0.1); transition: transform var(--cg-rx-spring-ms, 460ms) var(--cg-rx-spring, ease);
}
.cg-rx-seg[data-cg-len="full"] .cg-rx-seg__thumb { transform: translateX(100%); }
${/* Dark: the paper and its groove are one shade, the chosen length and the section read are a lighter one. */ ''}
${dark('.cg-rx-seg__thumb, .cg-rx-toc__marker')} { background: var(--cg-seg-on); }

.cg-rx-cap { margin: 4px 2px 8px; font-size: 12.5px; line-height: 1.4; font-weight: 500; color: var(--cg-ink-muted); }
.cg-rx-id + .cg-rx-cap { margin-top: 20px; }
.cg-rx-toc { position: relative; display: grid; gap: 1px; margin: 0 -8px; }
.cg-rx-toc__marker {
  position: absolute; left: 0; right: 0; top: 0; height: 38px; border-radius: 9px; background: var(--cg-surface); pointer-events: none;
  box-shadow: 0 1px 2px rgb(38 36 32 / 0.08), 0 0 0 1px var(--cg-rule-2);
  transition: transform var(--cg-rx-spring-ms, 460ms) var(--cg-rx-spring, ease), height var(--cg-rx-spring-ms, 460ms) var(--cg-rx-spring, ease), opacity 200ms;
}
.cg-rx-toc__marker::before { content: ""; position: absolute; left: 0; top: 11px; bottom: 11px; width: 3px; border-radius: 0 3px 3px 0; background: var(--cg-clay); }
.cg-rx-toc__item {
  position: relative; z-index: 1; display: block; width: 100%; min-height: 38px; padding: 0 10px; border: 0; border-radius: 9px; background: none;
  text-align: left; color: var(--cg-ink-2); font: inherit; font-size: 13.5px; line-height: 1.25; font-weight: 500; cursor: pointer;
  transition: background-color 120ms, color 160ms;
}
.cg-rx-toc__item:hover:not(:disabled) { background: rgb(27 26 23 / 0.04); color: var(--cg-ink-strong); }
.cg-rx-toc__item.is-on { color: var(--cg-ink-strong); font-weight: 600; }
.cg-rx-toc__item.is-on:hover { background: none; }
.cg-rx-toc__item:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: -2px; }
.cg-rx-toc__item:disabled { cursor: default; }
.cg-rx-toc__in { display: grid; grid-template-columns: 26px minmax(0, 1fr) 20px; align-items: center; gap: 11px; min-height: 38px; }
.cg-rx-toc__n { min-width: 0; }
.cg-rx-toc__k {
  justify-self: end; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 5px; font: inherit; font-size: 10.5px; line-height: 18px; font-weight: 600;
  text-align: center; color: var(--cg-ink-faint); box-shadow: inset 0 0 0 1px var(--cg-rule-3); opacity: 0; transition: opacity 160ms;
}
.cg-rx-toc:hover .cg-rx-toc__k, .cg-rx-toc:focus-within .cg-rx-toc__k { opacity: 1; }
.cg-rx-toc.is-ghost .cg-rx-toc__item { color: var(--cg-ink-faint); }
.cg-rx-toc.is-ghost .cg-rx-tile { opacity: 0.5; filter: grayscale(0.7); }
${/* A build: the rows light up as the sections are written. */ ''}
.cg-rx-toc__st { position: absolute; right: 10px; top: 50%; display: none; width: 15px; height: 15px; margin-top: -7.5px; color: var(--cg-good-ink); }
.cg-rx-toc.is-building .cg-rx-toc__st { display: block; }
.cg-rx-toc__st .cg-ico { width: 15px; height: 15px; stroke-width: 2; animation: cg-rx-pop 420ms var(--cg-rx-spring, ease); }
.cg-rx-toc__item.is-wait { color: var(--cg-ink-faint); }
.cg-rx-toc__item.is-wait .cg-rx-tile { opacity: 0.45; filter: grayscale(0.8); }
.cg-rx-toc__item.is-wait .cg-rx-toc__st { border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--cg-rule-3); }
.cg-rx-toc__item.is-writing { color: var(--cg-ink-strong); }
.cg-rx-toc__item.is-writing .cg-rx-toc__st { border-radius: 50%; border: 1.5px solid var(--cg-clay-line); border-top-color: var(--cg-clay-ink); animation: cg-rx-spin 0.85s linear infinite; }
.cg-rx-toc__item.is-done .cg-rx-tile { animation: cg-rx-lit 700ms var(--cg-ease); }
@keyframes cg-rx-lit { 0% { box-shadow: 0 0 0 0 rgb(217 119 87 / 0.5), inset 0 0 0 1px var(--cg-rx-tl); } 100% { box-shadow: 0 0 0 9px rgb(217 119 87 / 0), inset 0 0 0 1px var(--cg-rx-tl); } }
@keyframes cg-rx-pop { from { transform: scale(0.4); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes cg-rx-spin { to { transform: rotate(1turn); } }

.cg-rx-rail__sp { flex: 1 1 12px; min-height: 12px; }
${/* The card that asks for attention: the chat went on after the Recap. */ ''}
.cg-rx-freshwrap { margin-top: 4px; animation: cg-rx-in 320ms var(--cg-ease) both; }
.cg-rx-fresh { padding: 13px 13px 13px 14px; border-radius: 12px; background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); }
.cg-rx-fresh__t { display: flex; align-items: baseline; gap: 9px; font-size: 13.5px; line-height: 1.3; font-weight: 650; color: var(--cg-ink-strong); text-wrap: balance; }
.cg-rx-fresh .cg-dot { position: relative; flex: none; width: 8px; height: 8px; transform: translateY(-1px); box-shadow: 0 0 0 3px rgb(217 119 87 / 0.2); }
.cg-rx-fresh .cg-dot::after { content: ""; position: absolute; inset: -5px; border-radius: 50%; border: 1.5px solid var(--cg-clay); opacity: 0; }
.cg-rx-fresh.is-ping .cg-dot::after { animation: cg-rx-ping 1300ms var(--cg-ease) 2; }
@keyframes cg-rx-ping { 0% { transform: scale(0.5); opacity: 0.9; } 100% { transform: scale(2); opacity: 0; } }
.cg-rx-fresh__s { margin: 2px 0 11px 17px; font-size: 12.5px; line-height: 1.4; color: var(--cg-ink-2); }
.cg-rx-fresh__row { display: flex; align-items: center; gap: 10px; }
.cg-rx-fresh__eta { font-size: 12px; line-height: 1.3; color: var(--cg-ink-muted); }

.cg-rx-facts { display: grid; gap: 7px; margin: 16px 0 0; padding: 0 2px; font-size: 12.5px; line-height: 1.35; color: var(--cg-ink-muted); }
.cg-rx-fact { display: grid; grid-template-columns: 15px minmax(0, 1fr); gap: 9px; align-items: start; }
.cg-rx-fact > .cg-ico { margin-top: 1px; stroke-width: 1.4; color: var(--cg-ink-faint); }
.cg-rx-fact > span { text-wrap: balance; }
.cg-rx-facts > .cg-fact { display: flex; gap: 9px; }
.cg-rx-facts > .cg-fact__btn { justify-self: start; }
.cg-rx-facts .cg-rx-link { justify-self: start; height: 26px; margin: 2px 0 0 -6px; padding: 0 8px; color: var(--cg-clay-ink); font-size: 12.5px; font-weight: 600; }
.cg-rx-facts .cg-rx-link:hover { background: var(--cg-clay-bg); color: var(--cg-clay-ink); }
.cg-rx-facts .cg-rx-link kbd { display: none; }
.cg-rx-keys { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 14px; padding: 12px 2px 0; border-top: 1px solid var(--cg-rule-2); font-size: 11.5px; line-height: 18px; color: var(--cg-ink-muted); }
.cg-rx-keys > span { display: inline-flex; align-items: center; gap: 5px; }
.cg-rx-kbd {
  display: inline-grid; place-items: center; min-width: 19px; height: 19px; padding: 0 5px; border-radius: 5px; background: var(--cg-surface);
  box-shadow: inset 0 0 0 1px var(--cg-rule-3), 0 1px 0 var(--cg-rule-3); font: inherit; font-size: 10.5px; line-height: 1; font-weight: 600; color: var(--cg-ink-2);
}

${/* ── the document ── */ ''}
.cg-rx-doc { position: relative; display: grid; grid-template-rows: auto auto minmax(0, 1fr); min-width: 0; min-height: 0; border-radius: 0 16px 16px 0; overflow: hidden; }
.cg-rx-top { position: relative; z-index: 3; display: flex; align-items: center; gap: 10px; height: 56px; padding: 0 14px 0 64px; box-shadow: 0 1px 0 transparent; transition: box-shadow 220ms; }
.cg-rx-top.is-scrolled { box-shadow: 0 1px 0 var(--cg-rule); }
.cg-rx-run { display: flex; align-items: center; gap: 9px; min-width: 0; font-size: 13.5px; line-height: 1.2; font-weight: 600; color: var(--cg-ink-2); opacity: 0; transform: translateY(5px); transition: opacity 180ms, transform 240ms var(--cg-ease); }
.cg-rx-run.is-on { opacity: 1; transform: none; }
.cg-rx-run > span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-rx-run .cg-rx-tile { width: 22px; height: 22px; border-radius: 6px; }
.cg-rx-tools { display: flex; align-items: center; gap: 2px; margin-left: auto; }
.cg-rx-tools__sep { width: 1px; height: 18px; margin: 0 5px; background: var(--cg-rule-2); }
.cg-rx-tools .cg-btn { height: 32px; min-width: 32px; padding: 0 9px; border-radius: 8px; color: var(--cg-ink-2); font-size: 13px; font-weight: 500; }
.cg-rx-tools .cg-btn--icon { width: 32px; padding: 0; }
.cg-rx-tools .cg-btn:hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-rx-tools .cg-btn kbd { display: none; }
.cg-rx-tools .cg-copy-all.is-done { color: var(--cg-good-ink); }

.cg-rx-pages { position: relative; min-height: 0; }
.cg-rx-scroll {
  position: absolute; inset: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin;
  scrollbar-color: var(--cg-rule-3) transparent; outline: none;
}
.cg-rx-scroll:focus-visible { box-shadow: inset 0 0 0 2px var(--cg-focus-soft); }
.cg-rx-scroll.is-empty { display: flex; flex-direction: column; }
.cg-rx-article { max-width: 900px; padding: 4px 44px 0 64px; }
.cg-rx-article > .cg-stale { margin: 0 0 18px; border-radius: 10px; }
.cg-rx-sec { position: relative; padding: 40px 0 34px; }
.cg-rx-sec + .cg-rx-sec { box-shadow: inset 0 1px 0 var(--cg-rule); }
.cg-rx-article > .cg-rx-sec:first-of-type { padding-top: 12px; }
.cg-rx-h { position: relative; isolation: isolate; display: flex; align-items: center; gap: 13px; margin: 0 0 24px; font-size: 21px; line-height: 1.25; font-weight: 650; letter-spacing: -0.014em; color: var(--cg-ink-strong); }
.cg-rx-h::before { content: ""; position: absolute; z-index: -1; inset: -8px -14px -8px -10px; border-radius: 12px; background: var(--cg-clay-bg); opacity: 0; }
.cg-rx-h.is-flash::before { animation: cg-rx-flash 1400ms var(--cg-ease); }
.cg-rx-h.is-flash .cg-rx-tile { animation: cg-rx-tilepop 560ms var(--cg-rx-spring, ease); }
@keyframes cg-rx-flash { 0% { opacity: 0; } 16% { opacity: 1; } 100% { opacity: 0; } }
@keyframes cg-rx-tilepop { 0% { transform: scale(1); } 35% { transform: scale(1.14); } 100% { transform: scale(1); } }

.cg-rx-tile { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: var(--cg-rx-tb); color: var(--cg-rx-ti); box-shadow: inset 0 0 0 1px var(--cg-rx-tl); }
.cg-rx-toc .cg-rx-tile, .cg-rx-crib .cg-rx-tile { width: 26px; height: 26px; border-radius: 7px; }
.cg-rx-tile.t-n { --cg-rx-tb: var(--cg-sunk); --cg-rx-ti: var(--cg-ink-2); --cg-rx-tl: var(--cg-rule-2); }
.cg-rx-rail .cg-rx-tile.t-n { --cg-rx-tb: var(--cg-surface); }
.cg-rx-tile.t-good { --cg-rx-tb: var(--cg-good-bg); --cg-rx-ti: var(--cg-good-ink); --cg-rx-tl: var(--cg-good-line); }
.cg-rx-tile.t-amber { --cg-rx-tb: var(--cg-amber-bg); --cg-rx-ti: var(--cg-amber-ink); --cg-rx-tl: var(--cg-amber-line); }
.cg-rx-tile.t-bad { --cg-rx-tb: var(--cg-bad-bg); --cg-rx-ti: var(--cg-bad-ink); --cg-rx-tl: var(--cg-bad-line); }
.cg-rx-tile.t-clay { --cg-rx-tb: var(--cg-clay-bg); --cg-rx-ti: var(--cg-clay-ink); --cg-rx-tl: var(--cg-clay-line); }

${/* The structure of the text, as typography. */ ''}
.cg-rx-grid { display: grid; grid-template-columns: minmax(112px, 166px) minmax(0, 1fr); column-gap: 32px; row-gap: 22px; align-items: baseline; }
.cg-rx-l { font-size: 13px; line-height: 1.4; font-weight: 600; color: var(--cg-ink-2); text-wrap: balance; }
.cg-rx-l small { display: block; margin-top: 3px; font-size: 12px; line-height: 1.4; font-weight: 400; color: var(--cg-ink-muted); }
.cg-rx-l.is-avoid, .cg-rx-fl.is-avoid { color: var(--cg-bad-ink); }
.cg-rx-l.is-act, .cg-rx-fl.is-act { color: var(--cg-clay-ink); }
.cg-rx-mark { display: inline-grid; place-items: center; width: 16px; height: 16px; margin: 0 6px 0 0; border-radius: 50%; vertical-align: -3px; }
.cg-rx-mark .cg-ico { width: 10px; height: 10px; stroke-width: 2.2; }
.is-avoid > .cg-rx-mark { background: var(--cg-bad-bg); box-shadow: inset 0 0 0 1px var(--cg-bad-line); }
.is-act > .cg-rx-mark { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); }
.cg-rx-v { min-width: 0; max-width: 620px; font-family: var(--cg-serif); font-size: 16.5px; line-height: 1.62; color: var(--cg-ink); text-wrap: pretty; overflow-wrap: anywhere; }
.cg-rx-v p { margin: 0; }
.cg-rx-v strong { font-weight: 700; color: var(--cg-ink-strong); }
.cg-rx-flow { display: grid; gap: 16px; max-width: 640px; }
.cg-rx-fl { margin-bottom: 4px; font-size: 12.5px; line-height: 1.4; font-weight: 600; color: var(--cg-ink-2); }
.cg-rx-fl small { font-size: inherit; font-weight: 400; color: var(--cg-ink-muted); }
.cg-rx-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.cg-rx-list > li { position: relative; padding-left: 20px; }
.cg-rx-list > li::before { content: ""; position: absolute; left: 4px; top: calc(0.92em - 2.5px); width: 5px; height: 5px; border-radius: 50%; background: var(--cg-ink-faint); }
.cg-rx-list.is-avoid > li::before, .cg-rx-list.is-avoid > li::after { left: 2px; top: calc(0.92em - 0.75px); width: 9px; height: 1.5px; border-radius: 1px; background: var(--cg-bad-ink); opacity: 0.7; transform: rotate(45deg); }
.cg-rx-list.is-avoid > li::after { content: ""; position: absolute; transform: rotate(-45deg); }
.cg-rx-list.is-act > li::before { background: var(--cg-clay); }
.cg-rx-il { font-family: var(--cg-font); font-size: 13.5px; line-height: 1; font-weight: 600; color: var(--cg-ink-2); }
.cg-rx-tl { margin: 0; padding: 0; list-style: none; }
.cg-rx-tl > li { position: relative; padding: 0 0 17px 26px; }
.cg-rx-tl > li:last-child { padding-bottom: 0; }
.cg-rx-tl > li::before { content: ""; position: absolute; left: 4.25px; top: 16px; bottom: -3px; width: 1.5px; border-radius: 1px; background: var(--cg-rule-3); }
.cg-rx-tl > li:last-child::before { display: none; }
.cg-rx-tl > li::after { content: ""; position: absolute; left: 0; top: 4.5px; width: 10px; height: 10px; border-radius: 50%; background: var(--cg-surface); box-shadow: inset 0 0 0 1.5px var(--cg-ink-muted); }
.cg-rx-tl > li:last-child::after { background: var(--cg-ink-2); box-shadow: 0 0 0 3px var(--cg-sunk); }
.cg-rx-tl__d { display: block; margin-bottom: 1px; font-family: var(--cg-font); font-size: 12.5px; line-height: 19px; font-weight: 650; color: var(--cg-ink-2); }
.cg-rx-tl__t { display: block; }
.cg-rx-quotes { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.cg-rx-pq { position: relative; padding-left: 26px; font-size: 18.5px; line-height: 1.45; font-style: italic; color: var(--cg-ink-strong); }
.cg-rx-pq::before { content: "\\201C"; position: absolute; left: -1px; top: -5px; font-family: var(--cg-serif); font-size: 40px; line-height: 1; font-style: normal; color: var(--cg-clay); opacity: 0.75; }
.cg-rx-pq.is-plain { font-size: 16.5px; font-style: normal; }
${/* The fan's words and the sums. */ ''}
.cg-rx-money {
  font-family: var(--cg-font); font-size: 0.9em; font-weight: 650; color: var(--cg-good-ink); font-variant-numeric: tabular-nums lining-nums;
  white-space: nowrap; letter-spacing: -0.005em;
}
.cg-rx-q { quotes: "\\201C" "\\201D" "\\2018" "\\2019"; font-style: italic; color: var(--cg-ink-strong); }
.cg-rx-q.is-ru { quotes: "\\00AB" "\\00BB" "\\201E" "\\201C"; font-style: normal; }
.cg-rx-q::before, .cg-rx-q::after { color: var(--cg-ink-faint); font-style: normal; }
.cg-rx-pq .cg-rx-q { font-style: inherit; }
.cg-rx-pq .cg-rx-q::before, .cg-rx-pq .cg-rx-q::after { content: none; }
${/* Reading aids read from the text: the stage, the spender's class, the sum. */ ''}
.cg-rx-meter { display: grid; grid-template-columns: repeat(var(--cg-rx-n, 4), minmax(0, 1fr)); gap: 4px; max-width: 470px; margin: 4px 0 14px; }
.cg-rx-meter__s { display: grid; gap: 6px; font-family: var(--cg-font); font-size: 11.5px; line-height: 1.2; font-weight: 500; color: var(--cg-ink-faint); white-space: nowrap; }
.cg-rx-meter__s::before { content: ""; height: 6px; border-radius: 3px; background: var(--cg-rule-2); }
.cg-rx-meter__s.is-past::before { background: var(--cg-rule-3); }
.cg-rx-meter__s.is-on { color: var(--cg-ink-strong); font-weight: 650; }
.cg-rx-meter__s.is-on::before { background: var(--cg-ink-2); }
.cg-rx-meter.is-good .cg-rx-meter__s.is-on { color: var(--cg-good-ink); }
.cg-rx-meter.is-good .cg-rx-meter__s.is-on::before { background: var(--cg-good-ink); }
.cg-rx-meter__s.is-lean { color: var(--cg-ink-2); }
.cg-rx-meter__s.is-lean::before { background: repeating-linear-gradient(-45deg, var(--cg-ink-faint) 0 1.5px, transparent 1.5px 4.5px); box-shadow: inset 0 0 0 1px var(--cg-rule-3); }
.cg-rx-fig { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; margin: 0 0 10px; }
.cg-rx-fig__n { font-family: var(--cg-font); font-size: 30px; line-height: 1.05; font-weight: 700; letter-spacing: -0.02em; color: var(--cg-good-ink); font-variant-numeric: tabular-nums lining-nums; }
.cg-rx-fig__c { font-family: var(--cg-font); font-size: 13px; line-height: 1.3; font-weight: 500; color: var(--cg-ink-muted); }
.cg-rx-md { padding: 12px 0 24px; max-width: 680px; }
.cg-rx-md .cg-md { font-family: var(--cg-serif); font-size: 16.5px; line-height: 1.62; }

.cg-rx-end { display: flex; align-items: center; gap: 14px; margin: 40px 0 0; padding: 16px 0 0; box-shadow: inset 0 1px 0 var(--cg-rule); font-size: 12.5px; line-height: 1.4; color: var(--cg-ink-muted); }
.cg-rx-end__sp { flex: 1; }
.cg-rx-end .cg-btn { color: var(--cg-ink-2); }
.cg-rx-tail { height: 40px; }
${/* A first build: the sections show as they are written; the one being written breathes. */ ''}
.cg-rx-article.is-stream .cg-rx-sec { animation: cg-rx-arrive 420ms var(--cg-ease) both; }
.cg-rx-sec.is-writing .cg-rx-h { color: var(--cg-ink-muted); }
.cg-rx-skel { display: grid; gap: 13px; max-width: 560px; padding: 6px 0 10px; }
.cg-rx-skel.is-grid { margin-left: 198px; }
.cg-rx-skel.is-wait { padding-top: 24px; }
.cg-rx-skel i { height: 11px; border-radius: 6px; background: var(--cg-sunk); animation: cg-rx-breathe 1.6s ease-in-out infinite; }
.cg-rx-skel i:nth-child(2) { width: 88%; animation-delay: 0.18s; }
.cg-rx-skel i:nth-child(3) { width: 64%; animation-delay: 0.36s; }
@keyframes cg-rx-breathe { 50% { opacity: 0.45; } }
@keyframes cg-rx-arrive { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes cg-rx-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

${/* ── the build's ribbon: the previous Recap stays readable under it ── */ ''}
.cg-rx-rib { position: relative; z-index: 2; display: grid; grid-template-rows: 0fr; transition: grid-template-rows 380ms var(--cg-ease); }
.cg-rx-rib.is-on { grid-template-rows: 1fr; }
.cg-rx-rib__clip { min-height: 0; overflow: hidden; }
.cg-rx-rib__box { position: relative; margin: 2px 30px 12px 64px; padding: 12px 12px 12px 14px; border-radius: 12px; background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule-2); overflow: hidden; }
.cg-rx-rib__box.is-done { background: var(--cg-good-bg); box-shadow: inset 0 0 0 1px var(--cg-good-line); }
.cg-rx-rib__row { display: flex; align-items: center; gap: 10px; min-height: 28px; }
.cg-rx-rib__title { flex: none; font-size: 13.5px; line-height: 1.3; font-weight: 650; color: var(--cg-ink-strong); }
.cg-rx-rib__note { min-width: 0; font-size: 12.5px; line-height: 1.3; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-rx-rib__time { flex: none; margin-left: auto; font-size: 12.5px; line-height: 1; color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cg-rx-rib__time b { font-weight: 650; color: var(--cg-ink-strong); }
.cg-rx-rib__row .cg-cancel { height: 28px; padding: 0 10px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--cg-rule-3); font-size: 12.5px; font-weight: 600; }
.cg-rx-rib__row .cg-cancel kbd { font-size: 11.5px; opacity: 0.72; }
.cg-rx-spin { flex: none; width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--cg-clay-line); border-top-color: var(--cg-clay-ink); animation: cg-rx-spin 0.9s linear infinite; }
.cg-rx-done { flex: none; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--cg-good-ink); color: #fff; }
.cg-rx-done .cg-ico { stroke-width: 2.2; }
.cg-rx-steps { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 8px 0 0 26px; font-size: 12.5px; line-height: 18px; color: var(--cg-ink-faint); }
.cg-rx-step { display: inline-flex; align-items: center; gap: 6px; }
.cg-rx-step__m { display: grid; place-items: center; width: 13px; height: 13px; border-radius: 50%; font-style: normal; }
.cg-rx-step.is-done { color: var(--cg-ink-muted); }
.cg-rx-step.is-done .cg-rx-step__m { color: var(--cg-good-ink); }
.cg-rx-step.is-done .cg-ico { stroke-width: 2; }
.cg-rx-step.is-now { color: var(--cg-ink-strong); font-weight: 600; }
.cg-rx-step.is-now .cg-rx-step__m { border: 1.5px solid var(--cg-clay-line); border-top-color: var(--cg-clay-ink); animation: cg-rx-spin 0.85s linear infinite; }
.cg-rx-rib__bar { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--cg-clay); transform-origin: 0 50%; transform: scaleX(0); animation: cg-rx-bar linear forwards; }
@keyframes cg-rx-bar { to { transform: scaleX(0.96); } }

${/* ── buttons of our own voice ── */ ''}
.cg-rx .cg-btn.cg-rx-btn { height: 32px; padding: 0 13px; border-radius: 8px; font-size: 13px; font-weight: 600; }
.cg-rx .cg-btn.cg-rx-btn.cg-btn--sm { height: 30px; padding: 0 12px; }
.cg-rx .cg-btn.cg-rx-btn kbd { font-size: 11.5px; opacity: 0.72; color: inherit; }
.cg-rx .cg-rx-btn--main:not([aria-disabled="true"]) { background: var(--cg-clay-ink); color: #fff; box-shadow: 0 1px 2px rgb(168 77 43 / 0.3); }
.cg-rx .cg-rx-btn--main:not([aria-disabled="true"]):hover { background: color-mix(in srgb, var(--cg-clay-ink) 86%, #000); color: #fff; }
.cg-rx .cg-rx-btn--soft:not([aria-disabled="true"]) { background: var(--cg-surface); color: var(--cg-clay-ink); box-shadow: inset 0 0 0 1px var(--cg-clay-line), 0 1px 2px rgb(168 77 43 / 0.1); }
.cg-rx .cg-rx-btn--soft:not([aria-disabled="true"]):hover { box-shadow: inset 0 0 0 1px var(--cg-clay), 0 1px 2px rgb(168 77 43 / 0.14); }
.cg-rx .cg-rx-btn--soft kbd { display: none; }
.cg-rx .cg-rx-btn--ghost:not([aria-disabled="true"]) { background: transparent; color: var(--cg-ink-2); box-shadow: inset 0 0 0 1px var(--cg-rule-3); }
.cg-rx .cg-rx-btn--ghost:not([aria-disabled="true"]):hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-rx .cg-rx-btn[aria-disabled="true"] { box-shadow: inset 0 0 0 1px var(--cg-rule-2); }

${/* ── no Recap of this length yet: the choice ── */ ''}
.cg-rx-empty { max-width: 860px; margin: auto 0; padding: 24px 44px 96px 64px; }
.cg-rx-empty__h { margin: 0; font-size: 26px; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; color: var(--cg-ink-strong); }
.cg-rx-empty__lead { max-width: 560px; margin: 10px 0 28px; font-family: var(--cg-serif); font-size: 17px; line-height: 1.55; color: var(--cg-ink-2); }
.cg-rx-empty__note { display: flex; align-items: center; gap: 8px; margin: -12px 0 18px; font-size: 13px; color: var(--cg-ink-2); }
.cg-rx-empty__explain { max-width: 640px; margin: 20px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--cg-ink-muted); }
.cg-rx-pick { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; max-width: 760px; border-radius: 16px; outline: none; }
.cg-rx-pick:focus-visible { box-shadow: 0 0 0 2px var(--cg-focus-soft); }
.cg-rx-pick.is-one { grid-template-columns: minmax(0, 380px); }
.cg-rx-card { display: flex; flex-direction: column; gap: 16px; padding: 20px; border-radius: 14px; background: var(--cg-surface); box-shadow: inset 0 0 0 1px var(--cg-rule-2); transition: box-shadow 160ms; }
.cg-rx-card:hover { box-shadow: inset 0 0 0 1px var(--cg-rule-3); }
.cg-rx-card.is-main { background: color-mix(in srgb, var(--cg-clay-bg) 30%, var(--cg-surface)); box-shadow: inset 0 0 0 1.5px var(--cg-clay-line), 0 10px 26px -18px rgb(168 77 43 / 0.45); }
.cg-rx-card.is-main:hover { box-shadow: inset 0 0 0 1.5px var(--cg-clay), 0 10px 26px -18px rgb(168 77 43 / 0.5); }
.cg-rx-card__h { display: flex; align-items: baseline; gap: 10px; font-size: 18px; line-height: 1.2; font-weight: 650; letter-spacing: -0.01em; color: var(--cg-ink-strong); }
.cg-rx-card__n { margin-left: auto; font-size: 12.5px; line-height: 1; font-weight: 500; color: var(--cg-ink-muted); }
.cg-rx-card__dl { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 9px 12px; margin: 0; }
.cg-rx-card__dl dt { font-size: 12.5px; line-height: 20px; font-weight: 600; color: var(--cg-ink-muted); }
.cg-rx-card__dl dd { margin: 0; font-size: 14.5px; line-height: 20px; color: var(--cg-ink); }
.cg-rx .cg-rx-card .cg-btn.cg-rx-btn { align-self: flex-start; height: 36px; margin-top: 4px; padding: 0 16px; font-size: 13.5px; }
.cg-rx-state { margin: auto 0; padding: 24px 44px 96px 64px; max-width: 720px; }

${/* ── «Свернуть»: the cheat sheet over the bar (in the dock's sheet, which gives it its card) ── */ ''}
.cg-sheet:has(> .cg-rx-away) { display: none; }
.cg-bare .cg-strip:has(+ .cg-sheet > .cg-rx-away) { border-radius: var(--cg-r-lg); border-top-color: var(--cg-rule-2); }
.cg-rx-crib { position: relative; display: block; font-family: var(--cg-font); color: var(--cg-ink); -webkit-font-smoothing: antialiased; overflow-y: auto; scrollbar-width: thin; }
.cg-rx-crib__head { display: flex; align-items: center; gap: 9px; padding: 8px 8px 0 12px; animation: cg-rx-in 260ms var(--cg-ease) both; }
.cg-rx-crib__head .cg-rx-tile { width: 24px; height: 24px; border-radius: 7px; }
.cg-rx-crib__t { font-size: 13.5px; line-height: 1.2; font-weight: 650; color: var(--cg-ink-strong); }
.cg-rx-crib__sub { min-width: 0; font-size: 12.5px; line-height: 1.2; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-rx-crib__run { display: inline-flex; align-items: center; gap: 7px; min-width: 0; font-size: 12.5px; color: var(--cg-ink-2); white-space: nowrap; }
.cg-rx-crib__run .cg-rx-spin { width: 13px; height: 13px; border-width: 1.5px; }
.cg-rx-crib__run b { font-weight: 600; color: var(--cg-ink-strong); font-variant-numeric: tabular-nums; }
.cg-rx-crib__sp { flex: 1; }
.cg-rx-crib .cg-btn { height: 28px; color: var(--cg-ink-2); font-size: 12.5px; }
.cg-rx-crib .cg-btn--icon { width: 28px; }
.cg-rx-crib .cg-btn:hover { color: var(--cg-ink-strong); }
.cg-rx-crib .cg-btn kbd { display: none; }
.cg-rx-crib__cols { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 0.9fr); gap: 0 26px; padding: 8px 18px 13px 45px; }
.cg-rx-crib__cols.is-2 { grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); }
.cg-rx-crib__cols.is-1 { grid-template-columns: minmax(0, 1fr); }
.cg-rx-crib__c { animation: cg-rx-in 280ms var(--cg-ease) both; }
.cg-rx-crib__c:nth-child(2) { animation-delay: 40ms; }
.cg-rx-crib__c:nth-child(3) { animation-delay: 80ms; }
.cg-rx-crib__c h4 { margin: 0 0 5px; font-size: 12px; line-height: 1.3; font-weight: 650; }
.cg-rx-crib__c.is-clay h4 { color: var(--cg-clay-ink); }
.cg-rx-crib__c.is-amber h4 { color: var(--cg-amber-ink); }
.cg-rx-crib__c.is-bad h4 { color: var(--cg-bad-ink); }
.cg-rx-crib__c ul { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; font-family: var(--cg-serif); font-size: 14px; line-height: 1.45; color: var(--cg-ink); }
.cg-rx-crib__c li { position: relative; padding-left: 13px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.cg-rx-crib__c li::before { content: ""; position: absolute; left: 1px; top: calc(0.72em - 2px); width: 4px; height: 4px; border-radius: 50%; background: var(--cg-ink-faint); }
.cg-rx-crib__c.is-clay li::before { background: var(--cg-clay); }
.cg-rx-crib__c.is-bad li::before { background: var(--cg-bad-ink); opacity: 0.6; }

${/* Narrower screens: a narrower rail; a window too narrow for one reads without it. */ ''}
@container cg (max-width: 1000px) {
  .cg-rx { --cg-rx-rail: 228px; }
  .cg-rx-article { padding-left: 40px; padding-right: 28px; }
  .cg-rx-top { padding-left: 40px; }
  .cg-rx-rib__box { margin-left: 40px; }
  .cg-rx-empty, .cg-rx-state { padding-left: 40px; }
  .cg-rx-grid { grid-template-columns: minmax(96px, 140px) minmax(0, 1fr); column-gap: 24px; }
}
@container cg (max-width: 720px) {
  .cg-rx { grid-template-columns: minmax(0, 1fr); }
  .cg-rx-rail, .cg-rx-paper__rail { display: none; }
  .cg-rx-doc { border-radius: 16px; }
  .cg-rx-grid { grid-template-columns: minmax(0, 1fr); row-gap: 6px; }
  .cg-rx-grid > .cg-rx-v { margin-bottom: 14px; }
  .cg-rx-crib__cols { grid-template-columns: minmax(0, 1fr); gap: 10px; padding-left: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .cg-rx-toc__marker, .cg-rx-seg__thumb, .cg-rx-run, .cg-rx-rib { transition-duration: 1ms; }
  .cg-rx-h.is-flash .cg-rx-tile, .cg-rx-toc__item.is-done .cg-rx-tile, .cg-rx-article.is-stream .cg-rx-sec, .cg-rx-crib__head, .cg-rx-crib__c, .cg-rx-freshwrap { animation: none; }
}
`;

export const RECAP_STYLE: StyleSource = { id: 'cg-dock-recap', css: RECAP_CSS };
