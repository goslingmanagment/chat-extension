// «Заметки»'s sheets (ui-design §1, §2, §3.4, §3.7): the button in Fansly's header row — the row's own size and colour,
// as «Регистрация» beside it — and the panel in our layer 900, in the site's profile (Fansly's palette in both of its
// themes). Nothing here reaches the fan: no blue.
//
// 2026-10-26 (the panel on one screen): the questionnaire is a table whose rows light up under the pointer and open in
// place on a sunk box; the empty fields are raised «+ Метка» chips; terracotta only for the main action (Сохранить),
// the Goose's ✦ and its «✨ Заполнить / Дополнить из чата». 2026-10-27: a fan without a questionnaire gets the
// family's draft card (dashed terracotta frame, warm fill) with a large «✨ Заполнить из чата»; the Goose's suggestions
// are the family's draft in small, pills in its rows (dashed terracotta edge, warm fill, its words in serif) with ✓ and
// ×, the fan's words in a bubble under the pill, a terracotta bar over the rows, a green line when done, a dark toast
// for «Отменить». Its motion is the prototype's: a warm band sweeps the table while the Goose reads, the pills come in
// one by one with a small bounce, a ✓ dissolves the frame (the words turn the row's own, in terracotta) and the row
// lands with a warm glow and a short green ✓, a × fades the pill out; the rows glide (`useFlip` in the panel). The
// notes are a log: the date in a column at the left, the actions under the pointer.
//
// A note here is a JS comment: a CSS one would ship in the chunk. The button's root is no inline-size container (as
// «Регистрация»'s): its slot takes the words' width and never lies over the slot before it.

import { type MountSurfaceKind } from '@cg/contracts/vm';

import { overlayRootCss } from '../../../overlays/layer';

/** A surface of Fansly's own (contracts features/fansly.ts `FANSLY_SURFACES_AHEAD`). */
export const NOTES_SURFACE = 'notes' as MountSurfaceKind;

export const NOTES_BUTTON_CSS = `
:host { display: inline-flex; }
.cg-root[data-cg-surface='header-slot'] { container-type: normal; }
.cg-nb { display: inline-flex; align-items: center; gap: 4px; color: var(--cg-ink-muted); font-size: 12px; line-height: 14px; white-space: nowrap; }
.cg-nb__divider { margin: 0 2px; }
.cg-nb__button { all: unset; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; border-radius: 6px; }
.cg-nb__button:hover, .cg-nb__button[aria-pressed='true'] { color: var(--cg-accent); }
.cg-nb__button:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
.cg-nb svg { width: 13px; height: 13px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.cg-nb__count { min-width: 14px; height: 14px; padding: 0 4px; box-sizing: border-box; border-radius: var(--cg-r-pill); background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-2); font-size: 10px; line-height: 14px; text-align: center; font-variant-numeric: tabular-nums; }
`;

const p = '.cg-notes';

export const NOTES_CSS = `${overlayRootCss(NOTES_SURFACE, 'panel')}
.cg-notes-scrim { position: fixed; inset: 0; background: var(--cg-scrim); pointer-events: auto; }
${p} {
  --cg-notes-label: 118px;
  position: fixed; pointer-events: auto; display: flex; flex-direction: column; box-sizing: border-box;
  border-radius: var(--cg-r-lg); background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-rule-float), var(--cg-shadow-float);
  color: var(--cg-ink); font-size: var(--cg-text-base); line-height: 18px; outline: none;
}
.cg-root ${p}:focus-visible { outline: none; }
${p}.is-center { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(540px, calc(100vw - 32px)); max-height: min(780px, calc(100vh - 64px)); }
${p}__spacer { flex: 1; }

${p}__head { padding: 10px 8px 9px 16px; border-bottom: 1px solid var(--cg-rule); }
${p}__row { display: flex; align-items: center; gap: 2px; min-width: 0; }
${p}__who { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
${p}__namebox { display: inline-grid; grid-template-columns: minmax(0, max-content) auto; align-items: center; max-width: 100%; margin-left: -6px; }
${p}__namebox::after { content: attr(data-value) '\\00a0'; grid-area: 1 / 1; visibility: hidden; white-space: pre; overflow: hidden; padding: 0 6px; font-size: var(--cg-text-lg); font-weight: 600; }
${p}__name { grid-area: 1 / 1; width: 100%; min-width: 60px; height: 26px; margin: 0; padding: 0 6px; box-sizing: border-box; border: 0; border-radius: var(--cg-r-sm); background: transparent; color: var(--cg-ink-strong); font: inherit; font-size: var(--cg-text-lg); font-weight: 600; text-overflow: ellipsis; cursor: text; }
${p}__name.is-static { width: auto; height: auto; margin-left: 0; padding: 3px 0; }
${p}__name:hover { background: var(--cg-hover); }
${p}__name:focus { outline: none; background: var(--cg-input-bg); box-shadow: inset 0 0 0 1px var(--cg-input-border), 0 0 0 3px var(--cg-focus-soft); }
${p}__name::placeholder { color: var(--cg-ink-faint); font-weight: 500; }
${p}__name[data-notes-fan-name]::placeholder { color: var(--cg-ink-strong); font-weight: 600; opacity: 1; }
${p}__pen { grid-area: 1 / 2; display: inline-flex; padding: 0 4px; color: var(--cg-ink-faint); opacity: 0; cursor: pointer; transition: opacity 120ms var(--cg-ease); }
${p}__who:hover ${p}__pen, ${p}__name:focus ~ ${p}__pen { opacity: 1; }
${p}__handle { max-width: 100%; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${p}__hint { margin: 5px 0 0; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 15px; }
${p}__hint[data-status='error'], ${p}__hint[data-status='unconfirmed'], ${p}__hint[data-status='too-long'] { color: var(--cg-ink-strong); font-weight: 500; }

${p}__body { flex: 1; min-height: 0; overflow: auto; padding: 2px 16px 16px; border-radius: 0 0 var(--cg-r-lg) var(--cg-r-lg); container-type: inline-size; }
${p}__empty { margin: 14px 0; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); line-height: 17px; }
${p}__error { margin: 14px 0; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
${p}__error-t { display: flex; align-items: center; gap: 6px; color: var(--cg-ink-strong); font-weight: 500; }

${p}__sec { padding-top: 12px; }
${p}__sec + ${p}__sec { margin-top: 12px; border-top: 1px solid var(--cg-rule); }
${p}__sec-head { display: flex; align-items: center; gap: 6px; min-height: 24px; margin-bottom: 6px; }
${p}__sec-t { margin: 0; color: var(--cg-ink-strong); font-size: var(--cg-text-md); font-weight: 600; line-height: 20px; overflow-wrap: anywhere; }
${p}__count { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); font-variant-numeric: tabular-nums; }
${p}__ai.cg-btn { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); font-weight: 600; }
${p}__ai.cg-btn:hover { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-ink); color: var(--cg-clay-ink); }
${p}__ai.cg-btn--sm { height: 24px; padding: 0 9px; }
${p}__ai--lg.cg-btn { height: 34px; padding: 0 16px; border-radius: var(--cg-r-md); font-size: var(--cg-text-md); }
${p}__ai.cg-btn[aria-disabled='true'] { background: none; box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-faint); }
${p}__tag { display: inline-flex; align-items: center; gap: 4px; flex: none; height: 20px; padding: 0 7px; border-radius: var(--cg-r-pill); background: var(--cg-groove); color: var(--cg-ink-muted); font-size: var(--cg-text-xs); font-weight: 400; }
${p}__none { margin: 0 0 8px; color: var(--cg-ink-2); font-size: var(--cg-text-sm); line-height: 18px; }

${p}__table { display: grid; gap: 1px; margin: 0 -8px; }
${p}__frow {
  all: unset; box-sizing: border-box; position: relative; display: grid; grid-template-columns: var(--cg-notes-label) minmax(0, 1fr) 14px; column-gap: 12px; align-items: start;
  padding: 5px 8px; border-radius: var(--cg-r-sm); cursor: pointer; transition: background-color 120ms var(--cg-ease);
}
${p}__frow:hover { background: var(--cg-hover); }
${p}__frow:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: -2px; }
${p}__frow[aria-disabled='true'] { cursor: default; }
${p}__frow[aria-disabled='true']:hover { background: none; }
${p}__row-pen { padding-top: 3px; color: var(--cg-ink-faint); opacity: 0; transition: opacity 120ms var(--cg-ease); }
${p}__frow:hover ${p}__row-pen, ${p}__frow:focus-visible ${p}__row-pen { opacity: 1; }
${p}__label { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); line-height: 19px; overflow-wrap: break-word; hyphens: auto; }
${p}__value { display: grid; gap: 2px; min-width: 0; }
${p}__fact { position: relative; display: flex; align-items: baseline; gap: 10px; color: var(--cg-ink); font-size: var(--cg-text-base); line-height: 19px; }
${p}__value[data-many] ${p}__fact::before { content: ''; position: absolute; left: -8px; top: 8px; width: 3px; height: 3px; border-radius: 50%; background: var(--cg-ink-faint); }
${p}__fact-t { flex: 1; min-width: 0; overflow-wrap: break-word; hyphens: auto; }
${p}__fact-date { flex: none; color: var(--cg-ink-faint); font-family: var(--cg-mono); font-size: var(--cg-text-2xs); font-variant-numeric: tabular-nums; }
${p}__fresh { margin-left: 4px; color: var(--cg-clay-ink); font-size: 10px; vertical-align: 1px; }
${p}__frow.is-fresh ${p}__label { color: var(--cg-ink-2); }
${p}__free { padding: 3px 8px; color: var(--cg-ink-2); font-size: var(--cg-text-sm); line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }

${p}__fedit { display: grid; grid-template-columns: var(--cg-notes-label) minmax(0, 1fr); column-gap: 12px; align-items: start; padding: 7px 8px 8px; border-radius: var(--cg-r-md); background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
${p}__table > ${p}__fedit { margin: 2px 0; }
${p}__form > ${p}__fedit { margin: 6px -8px 0; }
${p}__fedit > ${p}__label { padding-top: 6px; color: var(--cg-ink-strong); font-weight: 500; }
${p}__cell { display: grid; gap: 6px; min-width: 0; }
${p}__cell .cg-field, ${p}__quick .cg-field, ${p}__edit .cg-field { width: 100%; box-sizing: border-box; font-size: var(--cg-text-base); line-height: 19px; }
${p}__acts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
${p}__keys { color: var(--cg-ink-faint); font-size: var(--cg-text-xs); line-height: 15px; }
${p} .cg-act--sm { height: 24px; padding: 0 10px; border-radius: var(--cg-r-sm); font-size: var(--cg-text-sm); }
${p}__problem { margin: 0; color: var(--cg-ink-strong); font-size: var(--cg-text-sm); line-height: 17px; }

${p}__blank { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
${p}__chip {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 10px 0 8px; border-radius: var(--cg-r-pill);
  background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-2); font-size: var(--cg-text-sm); white-space: nowrap; cursor: pointer;
  transition: background-color 120ms var(--cg-ease), color 120ms var(--cg-ease), box-shadow 120ms var(--cg-ease);
}
${p}__chip > span { color: var(--cg-ink-faint); font-weight: 600; }
${p}__chip:hover { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); }
${p}__chip:hover > span { color: var(--cg-clay-ink); }
${p}__chip:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
${p}__chip[aria-disabled='true'] { cursor: default; opacity: 0.55; }
${p}__chip[aria-disabled='true']:hover { background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-2); }
${p}__unplaced { margin: 8px 0 0; color: var(--cg-ink-2); font-size: var(--cg-text-xs); line-height: 16px; }
${p}__form-acts { display: flex; justify-content: flex-end; gap: 2px; margin: 8px -6px 0 0; }
${p}__form-acts .cg-btn { color: var(--cg-ink-faint); }
${p}__form-acts .cg-btn:hover { color: var(--cg-ink-2); }

${p}__running { display: flex; align-items: center; gap: 8px; min-height: 30px; margin: 0 0 8px; padding: 2px 4px 2px 10px; border-radius: var(--cg-r-md); background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); font-size: var(--cg-text-sm); }
${p}__running .cg-stages { flex: 0 1 auto; }
${p}__run-mark { font-size: 11px; animation: cg-notes-breathe 1.2s ease-in-out infinite; }
@keyframes cg-notes-breathe { 50% { opacity: 0.35; transform: scale(0.85); } }
${p}__running ${p}__stop.cg-btn { color: var(--cg-clay-ink); }

${p}__start { display: grid; margin: 2px 0 4px; padding: 14px 16px 16px; border: 1px dashed var(--cg-clay-line); border-radius: var(--cg-r-md); background: var(--cg-draft); }
${p}__start-t { margin: 0 0 3px; color: var(--cg-ink-strong); font-size: var(--cg-text-md); font-weight: 600; line-height: 20px; }
${p}__start-s { margin: 0 0 12px; color: var(--cg-ink-2); font-size: var(--cg-text-sm); line-height: 18px; }
${p}__start-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
${p}__start > ${p}__running { margin: -4px -6px; background: none; box-shadow: none; }
${p}__form[data-busy] ${p}__table { position: relative; overflow: hidden; }
${p}__form[data-busy] ${p}__table > :not(${p}__scan), ${p}__form[data-busy] ${p}__blank { opacity: 0.55; }
${p}__scan { position: absolute; left: 0; right: 0; top: -60px; height: 60px; z-index: 1; pointer-events: none; background: linear-gradient(180deg, rgb(217 119 87 / 0), rgb(217 119 87 / 0.12) 55%, rgb(217 119 87 / 0)); animation: cg-notes-scan 1.6s var(--cg-ease) infinite; }
@keyframes cg-notes-scan { 0% { top: -60px; opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
${p}__notice { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 0 0 8px; padding: 5px 6px 5px 10px; border-radius: var(--cg-r-md); background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule); color: var(--cg-ink-2); font-size: var(--cg-text-sm); line-height: 17px; }
${p}__notice-t { flex: 1 1 200px; display: flex; align-items: center; gap: 6px; }
${p}__notice.is-failed ${p}__notice-t { color: var(--cg-ink-strong); }
${p}__notice-acts { display: flex; gap: 2px; margin-left: auto; }

${p}__sugbar, ${p}__done { animation: cg-notes-in 260ms var(--cg-ease); }
@keyframes cg-notes-in { from { opacity: 0; transform: translateY(-3px); } }
${p}__sugbar { display: flex; align-items: center; gap: 4px 6px; flex-wrap: wrap; min-height: 32px; margin: 0 0 8px; padding: 3px 4px 3px 10px; border-radius: var(--cg-r-md); background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); font-size: var(--cg-text-sm); line-height: 18px; }
${p}__sugbar-t { display: inline-flex; align-items: baseline; gap: 6px; font-weight: 600; }
${p}__sugbar-w { color: var(--cg-ink-2); font-weight: 400; }
${p}__spark { font-size: 11px; }
${p}__sugbar .cg-btn--quiet { color: var(--cg-clay-ink); }
${p}__done { display: flex; align-items: center; gap: 8px; min-height: 32px; margin: 0 0 8px; padding: 3px 4px 3px 10px; border-radius: var(--cg-r-md); background: var(--cg-good-bg); box-shadow: inset 0 0 0 1px var(--cg-good-line); color: var(--cg-good-ink); font-size: var(--cg-text-sm); line-height: 18px; }
${p}__done-b { flex: 1; min-width: 0; display: grid; gap: 1px; }
${p}__done-t { font-weight: 500; }
${p}__done-u { color: var(--cg-ink-2); font-size: var(--cg-text-xs); line-height: 16px; }

${p}__frow.is-suggested { cursor: default; }
${p}__frow.is-suggested:hover { background: none; }
${p}__frow.is-ghost > ${p}__label { color: var(--cg-ink-faint); }
${p}__newf { display: block; margin-top: 1px; color: var(--cg-clay-ink); font-size: var(--cg-text-xs); line-height: 15px; }
${p}__fact.is-dropped ${p}__fact-t { color: var(--cg-ink-faint); text-decoration: line-through; text-decoration-color: var(--cg-ink-faint); }
${p}__value[data-many] ${p}__fact.is-sug::before { display: none; }
${p}__frow.is-fresh ${p}__fact-t { border-radius: 3px; animation: cg-notes-ink 1100ms var(--cg-ease); }
${p}__frow.is-fresh > ${p}__label { animation: cg-notes-label 900ms var(--cg-ease); }
@keyframes cg-notes-ink { 0%, 35% { background-color: var(--cg-clay-bg); box-shadow: 0 0 0 2px var(--cg-clay-bg); color: var(--cg-clay-ink); } 100% { background-color: transparent; box-shadow: 0 0 0 2px transparent; } }
@keyframes cg-notes-label { from { color: var(--cg-clay-ink); } }
${p}__landed { position: absolute; right: 8px; top: 5px; color: var(--cg-good-ink); font-size: var(--cg-text-sm); font-weight: 600; line-height: 19px; pointer-events: none; animation: cg-notes-landed 1700ms linear both; }
@keyframes cg-notes-landed { 0% { opacity: 0; transform: scale(0.7); } 10% { opacity: 1; transform: scale(1.1); } 18% { transform: none; } 72% { opacity: 1; } 100% { opacity: 0; } }

${p}__pill { display: inline-flex; align-items: baseline; gap: 2px; max-width: 100%; margin: 1px 0; padding: 0 2px 0 7px; border: 1px dashed var(--cg-clay-line); border-radius: 7px; background: var(--cg-draft); vertical-align: baseline; animation: cg-notes-pill-in 420ms var(--cg-ease) backwards; animation-delay: calc(var(--cg-i, 0) * 60ms); transition: border-color 200ms var(--cg-ease), background-color 200ms var(--cg-ease), padding 260ms var(--cg-ease); }
${p}__pill.is-inline { margin-left: 1px; padding-left: 3px; }
${p}__pill:hover, ${p}__pill:focus-within { border-style: solid; border-color: var(--cg-clay); background: var(--cg-draft-hover); }
${p}__pill-t { all: unset; cursor: pointer; font-family: var(--cg-serif); font-size: var(--cg-text-ai); line-height: 20px; color: var(--cg-ink-strong); overflow-wrap: break-word; hyphens: auto; }
${p}__pill-t:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; border-radius: 3px; }
${p}__pill-plus { margin-right: 3px; color: var(--cg-clay-ink); font-family: var(--cg-font); font-weight: 600; }
${p}__pill-ok, ${p}__pill-no { all: unset; flex: none; align-self: center; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 5px; cursor: pointer; }
${p}__pill-ok { margin-left: 4px; color: var(--cg-clay-ink); }
${p}__pill-no { color: var(--cg-ink-faint); }
${p}__pill-ok:hover { background: var(--cg-clay-bg); }
${p}__pill-no:hover { background: var(--cg-hover); color: var(--cg-ink-2); }
/* ✓: the frame dissolves and the words turn the row's own, in terracotta, while the write is in flight. */
${p}__pill.is-saving { padding-left: 0; padding-right: 0; border-color: transparent; background: var(--cg-clay-bg); }
${p}__pill.is-saving ${p}__pill-t { cursor: default; font-family: var(--cg-font); font-size: var(--cg-text-base); line-height: 19px; color: var(--cg-clay-ink); }
${p}__pill.is-saving ${p}__pill-plus { display: none; }
${p}__pill-saving { align-self: center; margin: 0 6px 0 8px; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); animation: cg-notes-pulse 900ms ease-in-out infinite; }
${p}__pill.is-leaving { animation: cg-notes-pill-out 220ms var(--cg-ease) forwards; pointer-events: none; }
@keyframes cg-notes-pill-in { 0% { opacity: 0; transform: translateY(5px) scale(0.92); } 55% { opacity: 1; transform: translateY(-1px) scale(1.015); } 100% { opacity: 1; transform: none; } }
@keyframes cg-notes-pill-out { to { opacity: 0; transform: scale(0.94) translateX(4px); filter: blur(1px); } }
@keyframes cg-notes-pulse { 50% { opacity: 0.45; } }
${p}__said { position: absolute; left: 0; top: calc(100% + 4px); z-index: 6; display: none; gap: 3px; width: max-content; max-width: 100%; padding: 8px 10px; box-sizing: border-box; border-radius: var(--cg-r-md); background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-rule-2), var(--cg-shadow-float); color: var(--cg-ink); font-family: var(--cg-font); font-size: var(--cg-text-sm); line-height: 17px; white-space: normal; pointer-events: none; }
${p}__pill:hover ${p}__said, ${p}__pill:focus-within ${p}__said { display: grid; }
${p}__said-h { color: var(--cg-ink-muted); font-size: var(--cg-text-xs); }
${p}__said-q { color: var(--cg-ink-strong); }
${p}__said-r { color: var(--cg-ink-2); }
${p}__said-k { margin-top: 3px; padding-top: 5px; border-top: 1px solid var(--cg-rule); color: var(--cg-ink-faint); font-size: var(--cg-text-xs); }
${p}__conflict { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 4px 0 2px; padding: 6px 6px 6px 10px; border-radius: var(--cg-r-md); background: var(--cg-amber-bg); box-shadow: inset 0 0 0 1px var(--cg-amber-line); color: var(--cg-amber-ink); font-size: var(--cg-text-sm); line-height: 17px; }
${p}__conflict-t { flex: 1 1 220px; }
${p}__conflict-acts { display: flex; gap: 2px; }

${p}__toast { position: absolute; left: 50%; bottom: 14px; z-index: 7; display: flex; align-items: center; gap: 8px; max-width: calc(100% - 32px); padding: 5px 5px 5px 14px; box-sizing: border-box; border-radius: var(--cg-r-lg); background: var(--cg-ink); color: var(--cg-raised); box-shadow: var(--cg-shadow-float); font-size: var(--cg-text-sm); line-height: 18px; transform: translateX(-50%); animation: cg-notes-toast 200ms var(--cg-ease) both; pointer-events: none; }
${p}__toast-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${p}__toast-b { all: unset; flex: none; padding: 4px 10px; border-radius: 7px; color: var(--cg-clay); font-weight: 600; cursor: pointer; pointer-events: auto; }
${p}__toast-b:hover { background: rgb(255 255 255 / 0.1); }
${p}__toast-b:focus-visible { outline: 2px solid var(--cg-clay); outline-offset: 1px; }
${p}__toast-b[aria-disabled='true'] { opacity: 0.6; cursor: default; }
@keyframes cg-notes-toast { from { opacity: 0; transform: translate(-50%, 6px); } }
@media (prefers-reduced-motion: reduce) {
  ${p}__pill, ${p}__pill-saving, ${p}__toast, ${p}__sugbar, ${p}__done, ${p}__run-mark, ${p}__frow.is-fresh ${p}__fact-t, ${p}__frow.is-fresh > ${p}__label { animation: none; }
  ${p}__scan, ${p}__landed { display: none; }
  ${p}__pill { transition: none; }
}

${p}__quick { display: grid; gap: 6px; }
${p}__quick .cg-field--area { min-height: 32px; }
${p}__list { margin: 6px 0 0; padding: 0; list-style: none; }
${p}__item { position: relative; display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; column-gap: 8px; align-items: start; padding: 8px 0; border-top: 1px solid var(--cg-rule); }
${p}__item:first-child { border-top: 0; }
${p}__item.is-editing { display: block; }
${p}__date { color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 19px; font-variant-numeric: tabular-nums; white-space: nowrap; }
${p}__item-b { display: grid; gap: 2px; min-width: 0; }
${p}__item-head { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; }
${p}__item-title { color: var(--cg-ink-strong); font-size: var(--cg-text-base); font-weight: 600; line-height: 19px; overflow-wrap: anywhere; }
${p}__item-text { margin: 0; color: var(--cg-ink); font-size: var(--cg-text-base); line-height: 19px; white-space: pre-wrap; overflow-wrap: anywhere; }
${p}__item.is-foreign ${p}__item-title, ${p}__item.is-foreign ${p}__item-text { color: var(--cg-ink-muted); }
${p}__item.is-cut ${p}__item-text { max-height: 240px; overflow: auto; }
${p}__item-acts { display: flex; margin-top: -2px; opacity: 0; transition: opacity 120ms var(--cg-ease); }
${p}__item:hover ${p}__item-acts, ${p}__item:focus-within ${p}__item-acts { opacity: 1; }
${p}__item-b ${p}__hint { margin: 2px 0 0; }

${p}__edit { display: flex; flex-direction: column; gap: 6px; margin: 6px 0; padding: 8px; border-radius: var(--cg-r-md); background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
${p}__latest { display: grid; gap: 2px; padding: 6px 8px; border-radius: var(--cg-r-sm); background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-rule); }
${p}__latest ${p}__item-text { max-height: 160px; overflow: auto; font-size: var(--cg-text-sm); }
${p}__latest-h { color: var(--cg-ink-muted); font-size: var(--cg-text-xs); font-weight: 600; }
${p}__confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; padding: 8px 10px; border-radius: var(--cg-r-md); background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule); color: var(--cg-ink-strong); font-size: var(--cg-text-sm); }
${p}__confirm-t { flex: 1 1 100%; }

@container (max-width: 440px) {
  ${p}__sec { --cg-notes-label: 110px; }
  ${p}__frow, ${p}__fedit { column-gap: 10px; }
  ${p}__fact { gap: 6px; }
}
@container (max-width: 300px) {
  ${p}__frow { grid-template-columns: minmax(0, 1fr) 14px; row-gap: 1px; }
  ${p}__frow > ${p}__label { grid-column: 1 / -1; }
  ${p}__fedit { grid-template-columns: minmax(0, 1fr); row-gap: 4px; }
  ${p}__fedit > ${p}__label { padding-top: 0; }
}
${p}__note-foot { margin: 0; padding: 0 16px 10px; color: var(--cg-ink-faint); font-size: var(--cg-text-xs); line-height: 15px; }
`;
