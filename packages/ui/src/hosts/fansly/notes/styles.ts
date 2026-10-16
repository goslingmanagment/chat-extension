// «Заметки»'s sheets (R20 P11b; ui-design §1, §2, §3.4, §3.7): the button in Fansly's header row — the row's own size
// and colour, as «Регистрация» beside it — and the panel in our layer 900, in the site's profile (Fansly's palette in
// both of its themes). The family's surfaces: the raised card, the sunken capsule of the view, hairlines between notes,
// terracotta only for our main action (Создать / Сохранить) and the open button. Nothing here reaches the fan: no blue.
//
// A note here is a JS comment: a CSS one would ship in the chunk.

import { type MountSurfaceKind } from '@cg/contracts/vm';

import { overlayRootCss } from '../../../overlays/layer';

/** A surface of Fansly's own (contracts features/fansly.ts `FANSLY_SURFACES_AHEAD`). */
export const NOTES_SURFACE = 'notes' as MountSurfaceKind;

export const NOTES_BUTTON_CSS = `
:host { display: inline-flex; }
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
${p}__name:hover { background: var(--cg-hover); }
${p}__name:focus { outline: none; background: var(--cg-input-bg); box-shadow: inset 0 0 0 1px var(--cg-input-border); }
${p}__name::placeholder { color: var(--cg-ink-faint); font-weight: 500; }
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
${p}__note-acts { display: flex; gap: 2px; flex: none; }
${p}__note-text { margin: 2px 0 0; color: var(--cg-ink-2); font-size: var(--cg-text-sm); line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
${p}__note.is-foreign ${p}__note-title, ${p}__note.is-foreign ${p}__note-text { color: var(--cg-ink-muted); }
${p}__tag { display: inline-flex; align-items: center; gap: 4px; flex: none; height: 20px; padding: 0 7px; border-radius: var(--cg-r-pill); background: var(--cg-groove); color: var(--cg-ink-muted); font-size: var(--cg-text-xs); }
${p}__confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; padding: 8px 10px; border-radius: var(--cg-r-md); background: var(--cg-sunk); box-shadow: inset 0 0 0 1px var(--cg-rule); color: var(--cg-ink-strong); font-size: var(--cg-text-sm); }
${p}__confirm-t { flex: 1 1 100%; }
${p}__edit { margin: 8px -6px; padding: 8px; border-radius: var(--cg-r-md); background: var(--cg-draft); box-shadow: inset 0 0 0 1px var(--cg-rule-2); display: flex; flex-direction: column; gap: 6px; }
${p}__edit .cg-field { width: 100%; box-sizing: border-box; }
${p}__edit .cg-field--area { font-size: var(--cg-text-sm); line-height: 18px; }
${p}__problem { margin: 0; color: var(--cg-ink-strong); font-size: var(--cg-text-sm); line-height: 16px; }
${p}__problem-code { color: var(--cg-ink-muted); font-weight: 400; }

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
