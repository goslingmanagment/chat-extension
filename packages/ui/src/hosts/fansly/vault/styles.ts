// The vault panel's sheet (R20 P13b; ui-design §1, §2, §3.4): our layer 900 of the overlay host, the entry and the
// card in its bottom right corner over Fansly's page. The family's three surfaces: raised — what is pressed (the
// entry, the card, the chips), sunken — what is chosen (the album's order), and the dashed terracotta of a question
// we ask (the uncertain file, as Б2). The old Fansly panel's colours (its vault.css), in the report's tokens: a green,
// amber or red dot at each fact of the page, the file's state as a tinted pill (terracotta — loading, green — in the
// album, red — Fansly gave it up, amber — not known), the run's block green once all is in the album and red on a stop,
// and «Начать» filled terracotta. The minimized strip keeps the count, green or red as the run ended.
// Fansly's palette comes as the page's own triplets (the site's profile), so both of its themes read as the page.
//
// A note here is a JS comment: a CSS one would ship in the chunk, prose for nobody.

import { type MountSurfaceKind } from '@cg/contracts/vm';

import { overlayRootCss } from '../../../overlays/layer';

/** A surface of Fansly's own (contracts features/fansly.ts `FANSLY_SURFACES_AHEAD`): the kit mounts it under this name. */
export const VAULT_SURFACE = 'vault' as MountSurfaceKind;

const card = `.cg-vault__card`;

export const VAULT_CSS = `${overlayRootCss(VAULT_SURFACE, 'panel')}
.cg-vault__entry {
  position: fixed; right: 16px; bottom: 16px; pointer-events: auto;
  display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px 0 11px;
  border-radius: var(--cg-r-pill); background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-rule-2), var(--cg-shadow);
  color: var(--cg-ink-strong); font-size: var(--cg-text-base); font-weight: 600; white-space: nowrap; cursor: pointer;
  transition: background-color 120ms var(--cg-ease), box-shadow 120ms var(--cg-ease), color 120ms var(--cg-ease);
}
.cg-vault__entry:hover, .cg-vault__entry.is-busy { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line), var(--cg-shadow); color: var(--cg-clay-ink); }
.cg-vault__entry.is-strip { font-variant-numeric: tabular-nums; }
.cg-vault__entry.is-ok { background: var(--cg-good-bg); box-shadow: inset 0 0 0 1px var(--cg-good-line), var(--cg-shadow); color: var(--cg-good-ink); }
.cg-vault__entry.is-bad { background: var(--cg-bad-bg); box-shadow: inset 0 0 0 1px var(--cg-bad-line), var(--cg-shadow); color: var(--cg-bad-ink); }
.cg-vault__glyph { color: var(--cg-clay); font-size: 15px; line-height: 1; }
.cg-vault__entry .cg-ico { color: var(--cg-ink-muted); }

${card} {
  position: fixed; right: 16px; bottom: 16px; pointer-events: auto;
  display: flex; flex-direction: column; width: min(460px, calc(100vw - 32px)); max-height: calc(100vh - 88px);
  border-radius: var(--cg-r-lg); background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-rule-float), var(--cg-shadow-float);
  color: var(--cg-ink); font-size: var(--cg-text-base); line-height: 18px; overflow: hidden; outline: none;
}
.cg-vault__head { display: flex; align-items: flex-start; gap: 2px; padding: 12px 10px 10px 16px; border-bottom: 1px solid var(--cg-rule); }
.cg-vault__heading { flex: 1; min-width: 0; }
.cg-vault__title { color: var(--cg-ink-strong); font-size: var(--cg-text-md); line-height: 20px; font-weight: 600; }
.cg-vault__sub { margin-top: 2px; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); line-height: 16px; overflow-wrap: anywhere; }

.cg-vault__body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
.cg-vault__facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
.cg-vault__k { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); }
.cg-vault__v { display: flex; align-items: baseline; gap: 8px; margin: 0; min-width: 0; color: var(--cg-ink-strong); overflow-wrap: anywhere; }
.cg-vault__v::before { content: ''; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--cg-ink-faint); transform: translateY(-1px); }
.cg-vault__v.is-ok::before { background: var(--cg-good-fill); }
.cg-vault__v.is-warn::before { background: var(--cg-amber-ink); }
.cg-vault__v.is-bad::before { background: var(--cg-bad-ink); }
.cg-vault__v.is-bad, .cg-vault__v.is-warn { color: var(--cg-ink-2); }
.cg-vault__row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cg-vault__order { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.cg-vault__order .cg-seg { background: var(--cg-groove); }
.cg-vault__hint { margin: -4px 0 0; color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 15px; }

.cg-vault__notes { display: flex; flex-direction: column; gap: 6px; }
.cg-vault__note { margin: 0; padding: 8px 10px; border-radius: var(--cg-r-md); background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule); color: var(--cg-ink); font-size: var(--cg-text-sm); line-height: 16px; }
.cg-vault__note.is-problem { background: var(--cg-bad-bg); box-shadow: inset 0 0 0 1px var(--cg-bad-line); color: var(--cg-bad-ink); }
.cg-vault__note.is-warning { background: var(--cg-amber-bg); box-shadow: inset 0 0 0 1px var(--cg-amber-line); color: var(--cg-amber-ink); }
.cg-vault__confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 10px; border-radius: var(--cg-r-md); background: var(--cg-amber-bg); box-shadow: inset 0 0 0 1px var(--cg-amber-line); color: var(--cg-amber-ink); font-size: var(--cg-text-sm); }

.cg-vault__ask { padding: 10px 12px; border: 1px dashed var(--cg-clay-line); border-radius: var(--cg-r-md); background: var(--cg-clay-bg); display: flex; flex-direction: column; gap: 6px; }
.cg-vault__ask-t { margin: 0; color: var(--cg-ink-strong); font-weight: 600; overflow-wrap: anywhere; }
.cg-vault__ask-b { margin: 0; color: var(--cg-ink-2); font-size: var(--cg-text-sm); line-height: 16px; }

.cg-vault__set { display: flex; flex-direction: column; gap: 6px; }
.cg-vault__set-t { color: var(--cg-ink-2); font-size: var(--cg-text-sm); overflow-wrap: anywhere; }
.cg-vault__list { margin: 0; padding: 0; list-style: none; max-height: 260px; overflow: auto; border-radius: var(--cg-r-md); background: var(--cg-input-bg); box-shadow: inset 0 0 0 1px var(--cg-rule); }
.cg-vault__item { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; min-height: 28px; padding: 0 10px; border-bottom: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); }
.cg-vault__item:last-child { border-bottom: 0; }
.cg-vault__n { color: var(--cg-ink-faint); font-variant-numeric: tabular-nums; }
.cg-vault__name { color: var(--cg-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cg-vault__size { color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; }
.cg-vault__state { justify-self: end; padding: 1px 8px; border-radius: var(--cg-r-pill); color: var(--cg-ink-muted); font-size: var(--cg-text-xs); line-height: 16px; white-space: nowrap; }
.cg-vault__item.is-uploading .cg-vault__state { background: var(--cg-clay-bg); color: var(--cg-clay-ink); }
.cg-vault__item.is-verified .cg-vault__state, .cg-vault__item.is-previous .cg-vault__state, .cg-vault__item.is-present .cg-vault__state { background: var(--cg-good-bg); color: var(--cg-good-ink); }
.cg-vault__item.is-failed .cg-vault__state { background: var(--cg-bad-bg); color: var(--cg-bad-ink); }
.cg-vault__item.is-uncertain .cg-vault__state { background: var(--cg-amber-bg); color: var(--cg-amber-ink); }

.cg-vault__run { display: flex; flex-direction: column; gap: 6px; }
.cg-vault__track { height: 4px; border-radius: var(--cg-r-pill); background: var(--cg-groove); box-shadow: inset 0 0 0 1px var(--cg-rule-2); overflow: hidden; }
.cg-vault__bar { height: 100%; background: var(--cg-clay); transition: width 150ms var(--cg-ease); }
.cg-vault__status { display: flex; flex-direction: column; gap: 3px; padding: 9px 11px; border-radius: var(--cg-r-md); background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule); }
.cg-vault__status.is-ok { background: var(--cg-good-bg); box-shadow: inset 0 0 0 1px var(--cg-good-line); }
.cg-vault__status.is-bad { background: var(--cg-bad-bg); box-shadow: inset 0 0 0 1px var(--cg-bad-line); }
.cg-vault__line { margin: 0; color: var(--cg-ink); font-size: var(--cg-text-sm); line-height: 18px; overflow-wrap: anywhere; }
.cg-vault__line.is-count { color: var(--cg-ink-strong); font-weight: 600; font-variant-numeric: tabular-nums; }
.cg-vault__code { color: var(--cg-ink-muted); font-size: var(--cg-text-xs); }

.cg-vault__foot { display: flex; align-items: center; gap: 6px; padding: 10px 16px 6px; border-top: 1px solid var(--cg-rule); }
.cg-vault__start:not([aria-disabled="true"]) { background: var(--cg-clay); box-shadow: inset 0 0 0 1px var(--cg-clay); color: #fff; }
.cg-vault__start:not([aria-disabled="true"]):hover { background: color-mix(in srgb, var(--cg-clay) 86%, #000); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cg-clay) 86%, #000); color: #fff; }
.cg-vault__spacer { flex: 1; }
.cg-vault__foot-note { margin: 0; padding: 0 16px 10px; color: var(--cg-ink-faint); font-size: var(--cg-text-xs); line-height: 15px; }
@media (prefers-reduced-motion: reduce) { .cg-vault__entry, .cg-vault__bar { transition: none; } }
`;
