// «Заметки»'s sheets (ui-design §1, §2, §3.4, §3.7): the button in Fansly's header row — the row's own size and colour,
// as «Регистрация» beside it — and the panel in our layer 900, in the site's profile (Fansly's palette in both of its
// themes). Nothing here reaches the fan: no blue.
//
// 2026-10-26 (the panel on one screen): the questionnaire is a table whose rows light up under the pointer and open in
// place on a sunk box; the empty fields are raised «+ Метка» chips; what the Goose found is the family's draft (dashed
// terracotta frame, warm fill, its facts in serif), each row ticked; terracotta only for the main action (Сохранить,
// Записать), the Goose's ✦ and «✨ Дополнить из чата». The notes are a log: the date in a column at the left, the
// actions under the pointer.
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
${p}__fill-act.cg-btn { color: var(--cg-clay-ink); font-weight: 500; }
${p}__fill-act.cg-btn:hover { background: var(--cg-clay-bg); color: var(--cg-clay-ink); }
${p}__fill-act.cg-btn[aria-disabled='true'] { color: var(--cg-ink-faint); background: none; }
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
${p}__label { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); line-height: 19px; overflow-wrap: anywhere; }
${p}__value { display: grid; gap: 2px; min-width: 0; }
${p}__fact { position: relative; display: flex; align-items: baseline; gap: 10px; color: var(--cg-ink); font-size: var(--cg-text-base); line-height: 19px; }
${p}__value[data-many] ${p}__fact::before { content: ''; position: absolute; left: -8px; top: 8px; width: 3px; height: 3px; border-radius: 50%; background: var(--cg-ink-faint); }
${p}__fact-t { flex: 1; min-width: 0; overflow-wrap: anywhere; }
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

${p}__running { display: flex; align-items: center; min-height: 28px; margin: 0 0 8px; padding: 2px 10px; border-radius: var(--cg-r-md); background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); font-size: var(--cg-text-sm); }
${p}__running .cg-stages { flex: 0 1 auto; }
${p}__form[data-busy] ${p}__table, ${p}__form[data-busy] ${p}__blank { opacity: 0.5; }
${p}__notice { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 0 0 8px; padding: 5px 6px 5px 10px; border-radius: var(--cg-r-md); background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule); color: var(--cg-ink-2); font-size: var(--cg-text-sm); line-height: 17px; }
${p}__notice-t { flex: 1 1 200px; display: flex; align-items: center; gap: 6px; }
${p}__notice.is-failed ${p}__notice-t { color: var(--cg-ink-strong); }
${p}__notice-acts { display: flex; gap: 2px; margin-left: auto; }

${p}__review { display: grid; gap: 8px; }
${p}__review-t { margin: 0; color: var(--cg-ink-2); font-size: var(--cg-text-sm); line-height: 18px; }
${p}__finds { display: grid; border: 1px dashed var(--cg-clay-line); border-radius: var(--cg-r-md); background: var(--cg-draft); }
${p}__find { display: grid; grid-template-columns: 16px minmax(0, 1fr); column-gap: 10px; padding: 9px 12px 10px 10px; cursor: pointer; outline: none; }
${p}__find + ${p}__find { border-top: 1px dashed var(--cg-clay-line); }
${p}__find:first-child { border-radius: var(--cg-r-md) var(--cg-r-md) 0 0; }
${p}__find:last-child { border-radius: 0 0 var(--cg-r-md) var(--cg-r-md); }
${p}__find:hover { background: var(--cg-draft-hover); }
${p}__find:focus-visible { box-shadow: inset 0 0 0 2px var(--cg-focus); }
${p}__find[aria-disabled='true'] { cursor: default; }
${p}__find-box { padding-top: 2px; color: var(--cg-clay-ink); }
${p}__find.is-off ${p}__find-box { color: var(--cg-ink-faint); }
${p}__find-b { display: grid; gap: 2px; min-width: 0; }
${p}__find.is-off ${p}__find-b { opacity: 0.5; }
${p}__find-h { display: flex; align-items: baseline; gap: 8px; }
${p}__find-l { color: var(--cg-ink-strong); font-size: var(--cg-text-sm); font-weight: 600; line-height: 18px; }
${p}__kind { color: var(--cg-clay-ink); font-size: var(--cg-text-xs); }
${p}__find-add, ${p}__find-del { display: block; text-decoration: none; }
${p}__find-add ${p}__fact { font-family: var(--cg-serif); font-size: var(--cg-text-ai); line-height: 21px; color: var(--cg-ink); }
${p}__find-del ${p}__fact { color: var(--cg-ink-muted); }
${p}__find-del ${p}__fact-t { text-decoration: line-through; }
${p}__quotes { display: grid; gap: 1px; margin-top: 2px; padding-left: 8px; border-left: 2px solid var(--cg-clay-line); color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 16px; font-style: italic; overflow-wrap: anywhere; }
${p}__review-acts { position: sticky; bottom: -16px; z-index: 1; margin: 0 -16px -16px; padding: 10px 16px 12px; border-top: 1px solid var(--cg-rule); background: var(--cg-raised); }

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
  ${p}__sec { --cg-notes-label: 92px; }
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
