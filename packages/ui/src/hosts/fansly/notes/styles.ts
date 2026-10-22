// «Заметки»'s sheets (R20 P11b, P11b2; ui-design §1, §2, §3.4, §3.7): the button in Fansly's header row — the row's own size
// and colour, as «Регистрация» beside it — and the panel in our layer 900, in the site's profile (Fansly's palette in
// both of its themes). The family's surfaces: the raised card, the sunken capsule of the view, hairlines between notes,
// terracotta only for our main action (Создать / Сохранить) and the open button. Nothing here reaches the fan: no blue.
//
// A questionnaire (P11b2) is a table: the label column muted, the facts in the page's ink, the month in mono at the
// right; in the editor each value is its own box. The Goose's rewrite under a field is terracotta (the family's AI
// colour) with its facts in serif, as AI text is everywhere; what it drops is struck through.
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
  position: fixed; pointer-events: auto; display: flex; flex-direction: column; box-sizing: border-box;
  border-radius: var(--cg-r-lg); background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-rule-float), var(--cg-shadow-float);
  color: var(--cg-ink); font-size: var(--cg-text-base); line-height: 18px; overflow: hidden; outline: none;
}
.cg-root ${p}:focus-visible { outline: none; }
${p}.is-center { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(520px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 64px)); }
${p}__head { display: flex; flex-direction: column; gap: 4px; padding: 10px 8px 8px 14px; border-bottom: 1px solid var(--cg-rule); }
${p}__row { display: flex; align-items: center; gap: 2px; min-width: 0; }
${p}__who { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; }
${p}__name { flex: 0 1 auto; min-width: 60px; max-width: 100%; height: 26px; margin: 0 0 0 -6px; padding: 0 6px; box-sizing: border-box; border: 0; border-radius: var(--cg-r-sm); background: transparent; color: var(--cg-ink-strong); font: inherit; font-size: var(--cg-text-md); font-weight: 600; text-overflow: ellipsis; }
${p}__namebox { flex: 0 1 auto; display: inline-grid; grid-template-columns: minmax(0, max-content); min-width: 60px; max-width: 100%; margin: 0 0 0 -6px; }
${p}__namebox > ${p}__name { grid-area: 1 / 1; width: 100%; min-width: 0; margin: 0; }
${p}__namebox::after { content: attr(data-value) '\\00a0'; grid-area: 1 / 1; visibility: hidden; white-space: pre; overflow: hidden; padding: 0 6px; font-size: var(--cg-text-md); font-weight: 600; }
${p}__name:hover { background: var(--cg-hover); }
${p}__name:focus { outline: none; background: var(--cg-input-bg); box-shadow: inset 0 0 0 1px var(--cg-input-border); }
${p}__name::placeholder { color: var(--cg-ink-faint); font-weight: 500; }
${p}__name[data-notes-fan-name]::placeholder { color: var(--cg-ink-2); font-weight: 600; opacity: 1; }
${p}__handle { flex: none; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
${p}__hint { margin: 0; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 15px; }
${p}__hint[data-status='error'], ${p}__hint[data-status='unconfirmed'], ${p}__hint[data-status='too-long'] { color: var(--cg-ink-strong); font-weight: 500; }

${p}__body { flex: 1; min-height: 0; overflow: auto; padding: 4px 14px 10px; }
${p}__empty { margin: 12px 0; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); line-height: 17px; }
${p}__error { margin: 12px 0; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
${p}__error-t { display: flex; align-items: center; gap: 6px; color: var(--cg-ink-strong); font-weight: 500; }
${p}__list { margin: 0; padding: 0; list-style: none; }
${p}__note { padding: 10px 0; border-bottom: 1px solid var(--cg-rule); }
${p}__note:last-child { border-bottom: 0; }
${p}__note-head { display: flex; align-items: center; gap: 4px; min-height: 22px; }
${p}__note-title { flex: 1; min-width: 0; color: var(--cg-ink-strong); font-weight: 600; overflow-wrap: anywhere; }
${p}__note-title:has(+ ${p}__note-date) { flex: 0 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${p}__note-date { flex: none; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }
${p}__note-title + ${p}__note-date { flex: 1; }
${p}__note-title + ${p}__note-date::before { content: '·'; margin: 0 5px 0 1px; }
${p}__note-acts { display: flex; gap: 2px; flex: none; }
${p}__note-text { margin: 2px 0 0; color: var(--cg-ink-2); font-size: var(--cg-text-sm); line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
${p}__note.is-foreign ${p}__note-title, ${p}__note.is-foreign ${p}__note-text { color: var(--cg-ink-muted); }
${p}__note.is-cut ${p}__note-text, ${p}__note.is-cut ${p}__form { max-height: 240px; overflow: auto; }
${p}__latest { display: grid; gap: 2px; padding: 6px 8px; border-radius: var(--cg-r-sm); background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule); }
${p}__latest ${p}__note-text { max-height: 160px; overflow: auto; }
${p}__latest-h { color: var(--cg-ink-muted); font-size: var(--cg-text-xs); font-weight: 600; }
${p}__tag { display: inline-flex; align-items: center; gap: 4px; flex: none; height: 20px; padding: 0 7px; border-radius: var(--cg-r-pill); background: var(--cg-groove); color: var(--cg-ink-muted); font-size: var(--cg-text-xs); }
${p}__confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; padding: 8px 10px; border-radius: var(--cg-r-md); background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule); color: var(--cg-ink-strong); font-size: var(--cg-text-sm); }
${p}__confirm-t { flex: 1 1 100%; }
${p}__edit { margin: 8px -6px; padding: 8px; border-radius: var(--cg-r-md); background: var(--cg-draft); box-shadow: inset 0 0 0 1px var(--cg-rule-2); display: flex; flex-direction: column; gap: 6px; }
${p}__edit .cg-field { width: 100%; box-sizing: border-box; }
${p}__edit .cg-field--area { font-size: var(--cg-text-sm); line-height: 18px; }
${p}__problem { margin: 0; color: var(--cg-ink-strong); font-size: var(--cg-text-sm); line-height: 16px; }
${p}__edit-head { display: flex; align-items: center; gap: 4px; }
${p}__edit-head .cg-field { flex: 1; min-width: 0; }
${p}__mode { flex: none; }

${p}__body { container-type: inline-size; }
${p}__form { margin-top: 4px; }
${p}__fields, ${p}__frow { display: grid; grid-template-columns: var(--cg-notes-label) minmax(0, 1fr); column-gap: 12px; }
${p} { --cg-notes-label: 96px; }
${p}__fields { row-gap: 4px; margin: 0; align-items: start; }
${p}__frow { align-items: start; }
${p}__pair { display: contents; }
${p}__label { color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 18px; overflow-wrap: anywhere; }
${p}__value { display: grid; gap: 2px; min-width: 0; margin: 0; }
${p}__fact { position: relative; display: flex; align-items: baseline; gap: 8px; color: var(--cg-ink-2); font-size: var(--cg-text-sm); line-height: 18px; }
${p}__value[data-many] ${p}__fact::before { content: ''; position: absolute; left: -8px; top: 8px; width: 3px; height: 3px; border-radius: 50%; background: var(--cg-ink-faint); }
${p}__fact-t { flex: 1; min-width: 0; overflow-wrap: anywhere; }
${p}__fact-date { flex: none; color: var(--cg-ink-faint); font-family: var(--cg-mono); font-size: var(--cg-text-2xs); font-variant-numeric: tabular-nums; }
${p}__free { grid-column: 1 / -1; color: var(--cg-ink-2); font-size: var(--cg-text-sm); line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
${p}__blank { margin: 6px 0 0; color: var(--cg-ink-faint); font-size: var(--cg-text-xs); line-height: 15px; }
${p}__rows { display: grid; gap: 4px; }
${p}__rows ${p}__label { padding-top: 5px; }
${p}__rows ${p}__free { color: var(--cg-ink-muted); cursor: default; }
${p}__cell { display: grid; gap: 4px; min-width: 0; }
${p}__cell .cg-field--area { min-height: 28px; padding-top: 4px; padding-bottom: 4px; }
${p}__suggest { display: grid; gap: 2px; padding: 2px 4px 6px 8px; border-radius: var(--cg-r-sm); background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); }
${p}__suggest-head { display: flex; align-items: center; gap: 2px; }
${p}__suggest-t { flex: 1; min-width: 0; color: var(--cg-clay-ink); font-size: var(--cg-text-xs); font-weight: 600; }
${p}__suggest-facts { display: grid; gap: 1px; padding-right: 4px; font-family: var(--cg-serif); font-size: var(--cg-text-sm); line-height: 19px; overflow-wrap: anywhere; }
${p}__fact-add { color: var(--cg-ink); text-decoration: none; }
${p}__fact-add::before { content: '+ '; color: var(--cg-clay-ink); font-family: var(--cg-font); font-weight: 700; }
${p}__fact-del { color: var(--cg-ink-muted); text-decoration: line-through; }
${p}__quotes { margin: 2px 4px 0 0; padding: 0 0 0 8px; list-style: none; border-left: 2px solid var(--cg-clay-line); color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 16px; font-style: italic; overflow-wrap: anywhere; }
${p}__quote-label { color: var(--cg-ink-2); font-style: normal; font-weight: 600; }
${p}__frow[data-notes-ai] > ${p}__label::after { content: '✦'; margin-left: 4px; color: var(--cg-clay-ink); font-size: 9px; vertical-align: 1px; }
${p}__frow[data-notes-ai] .cg-field--area:not(:focus) { box-shadow: inset 0 0 0 1px var(--cg-clay-line); }
${p}__proposed { display: flex; align-items: center; gap: 6px; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 16px; }
${p}__proposed-t { flex: 1; min-width: 0; overflow-wrap: anywhere; }
${p}__strip { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; }
${p}__strip ${p}__fill { flex: 1 1 180px; }
${p}__strip-acts { display: flex; gap: 2px; flex: none; }
@container (max-width: 280px) {
  ${p}__fields, ${p}__frow { grid-template-columns: minmax(0, 1fr); row-gap: 1px; }
  ${p}__value { margin-bottom: 4px; padding-left: 8px; }
  ${p}__rows ${p}__label { padding-top: 0; }
}
${p}__problem-code { color: var(--cg-ink-muted); font-weight: 400; }
${p}__fill { display: flex; align-items: baseline; gap: 6px; margin: 0; color: var(--cg-clay-ink); font-size: var(--cg-text-sm); line-height: 17px; overflow-wrap: anywhere; }
${p}__stage { align-items: center; gap: 2px; min-width: 0; }
${p}__stage .cg-stages { flex: 0 1 auto; }
${p}__fill.is-failed { color: var(--cg-ink-strong); }
${p}__fill-act { color: var(--cg-clay-ink); }

${p}__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 10px 8px 14px; border-top: 1px solid var(--cg-rule); }
${p}__spacer { flex: 1; }
${p}__view { height: 26px; max-width: 170px; padding: 0 22px 0 9px; border: 0; border-radius: var(--cg-r-pill); background-color: var(--cg-groove); box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink-2); font: inherit; font-size: var(--cg-text-sm); cursor: pointer; appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 12px) 50%, calc(100% - 8px) 50%; background-size: 4px 4px; background-repeat: no-repeat; }
${p}__view:hover { color: var(--cg-ink-strong); }
${p}__view:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
${p}__kbd { color: var(--cg-ink-faint); font-size: var(--cg-text-xs); font-variant-numeric: tabular-nums; }
${p}__note-foot { margin: 0; padding: 0 14px 8px; color: var(--cg-ink-faint); font-size: var(--cg-text-xs); line-height: 15px; }
`;
