// The dock's stylesheet (ui-design §2, §3.1–§3.3, §4.1–§4.10), adopted after
// the kit's sheets into the dock's closed shadow root. Tokens only: no colour
// outside the `--cg-*` list. The narrow rules are container queries on the
// kit's `cg` container (the dock's own width, not the window's) and go one
// way: what hides at a width stays hidden below it.
//
//   ≥ 900  everything; the quota in full
//   < 900  the quota short; a crowded strip gives the persona's place away
//   < 790  no persona, no ⌘K; tighter buttons
//   < 690  no key labels on the buttons (tooltips and the cheatsheet keep them)
//   < 680  Hi variants in a column instead of side by side
//   ≤ 600  Review, Recap, Coach in «Ещё»; head without meta and key labels
//   ≤ 420  no quota, no tone value, no lock; «Скрыть» is ×; Insert under the text
//   < 360  «Ещё раз» is ↻, so «черновик · не отправлено» fits whole

import { dark, type StyleSource } from '../kit';

/** Text kept for screen readers while its button shows an icon only. */
const VISUALLY_HIDDEN = 'position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;';

export const DOCK_CSS = `
.cg-dock { position: relative; display: flex; flex-direction: column; font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink); }

/* ── the strip: one line of words ── */
.cg-strip { display: flex; align-items: center; height: 34px; min-width: 0; }
.cg-mark { width: var(--cg-gutter); height: 34px; flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--cg-ink-2); }
.cg-mark.is-off { color: var(--cg-ink-faint); }
.cg-slot { display: inline-flex; align-items: center; flex: none; min-width: 0; }
.cg-strip__acts { flex: none; display: flex; align-items: center; margin-left: -6px; }
.cg-strip__opts { display: flex; align-items: center; min-width: 0; margin-left: auto; padding: 0 2px 0 8px; }
.cg-strip__opts > * { flex: none; }
.cg-strip__opts > .cg-slot--persona, .cg-strip__opts > .cg-status-word { flex: 0 1 auto; min-width: 0; }
.cg-slot--more { display: none; }
.cg-opt kbd { display: none; }
/* «Тон: Flirt» reads as one phrase: the value closes the button's gap. */
.cg-tone-val { margin-left: -5px; }
.cg-lock { margin-left: 1px; }
.cg-hint { font-size: var(--cg-text-xs); letter-spacing: 0.02em; color: var(--cg-ink-muted); padding: 0 6px 0 4px; white-space: nowrap; }
.cg-persona { display: block; line-height: 26px; height: 26px; padding: 0 6px; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; min-width: 0; }
.cg-persona.is-missing { color: var(--cg-ink-2); }
.cg-quota { color: var(--cg-ink-2); white-space: nowrap; padding: 0 6px; }
.cg-quota.is-zero { color: var(--cg-ink-strong); font-weight: 600; }
.cg-quota .cg-short, .cg-status-word .cg-short { display: none; }
.cg-status-word { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-2); white-space: nowrap; padding: 0 6px; overflow: hidden; text-overflow: ellipsis; }

/* ── the sheet: what opens above the line ── */
.cg-sheet {
  display: flex; flex-direction: column; max-height: var(--cg-cap); margin-bottom: 2px; overflow: hidden;
  background: var(--cg-surface); border: 1px solid var(--cg-rule); border-radius: var(--cg-r-xl); box-shadow: var(--cg-shadow);
  animation: cg-open 140ms var(--cg-ease);
}
.cg-sheet > :not(.cg-body) { flex: none; }
.cg-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.cg-head { flex: none; display: flex; align-items: center; gap: 10px; min-height: 34px; min-width: 0; padding: 0 4px 0 0; border-bottom: 1px solid var(--cg-rule); }
.cg-head:last-child { border-bottom: 0; }
.cg-head > .cg-gut { margin-right: -10px; }
.cg-head__title { flex: none; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; }
.cg-head__meta { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.cg-head__draft { flex: none; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); white-space: nowrap; }
.cg-head__score { flex: none; font-size: var(--cg-text-xl); font-weight: 600; color: var(--cg-ink-strong); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cg-head__score span { color: var(--cg-ink-muted); font-weight: 400; font-size: var(--cg-text-sm); }
.cg-head__sp { flex: 1; min-width: 0; order: 1; }
.cg-head > .cg-timer { flex: none; order: 2; }
.cg-head__acts { display: flex; align-items: center; gap: 2px; flex: none; order: 3; }
.cg-again .cg-ico, .cg-hide .cg-ico { display: none; }

/* ── streaming: preliminary text, no buttons ── */
/* A stage that does not fit ends in «…» instead of a cut letter. */
.cg-head .cg-stage.is-now { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cg-stream { display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr); padding: 9px 10px 11px 0; }

/* ── parts: Hi variants, the Б2 question ── */
.cg-part.is-confirm .cg-ins { display: none; }
.cg-vhead { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 6px 0 var(--cg-gutter); border-top: 1px solid var(--cg-rule); color: var(--cg-ink-muted); font-size: var(--cg-text-sm); }
.cg-vhead:first-child { border-top: 0; }
.cg-vhead b { color: var(--cg-ink-2); font-weight: 600; }
.cg-vhead + .cg-part { border-top: 0; padding-top: 2px; }
.cg-hi__col { min-width: 0; }
.cg-hi__col + .cg-hi__col { border-top: 1px solid var(--cg-rule); }
.cg-hi__col > .cg-part:first-child { border-top: 0; }
@container cg (min-width: 680px) {
  .cg-hi { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
  .cg-hi__col + .cg-hi__col { border-top: 0; border-left: 1px solid var(--cg-rule); }
  .cg-hi .cg-vhead { padding-left: 14px; border-top: 0; }
  .cg-hi .cg-part { grid-template-columns: 22px minmax(0, 1fr); padding: 6px 10px 10px 0; border-top: 0; }
  .cg-hi .cg-part + .cg-part { padding-top: 4px; }
  .cg-hi .cg-part__n { text-align: right; padding-right: 8px; }
  .cg-hi .cg-part__t { font-size: var(--cg-text-md); }
  .cg-hi .cg-part__a { grid-column: 2; justify-self: start; margin: 6px 0 0 -8px; }
  .cg-hi .cg-part.is-done .cg-part__a { margin: 2px 0 0 -8px; }
  .cg-hi .cg-part__card, .cg-hi .cg-part__extra { grid-column: 2; }
}
.cg-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--cg-rule-3); }
${dark('.cg-confirm')} { border-top-color: var(--cg-rule-2); }
.cg-confirm__q { color: var(--cg-ink); font-weight: 500; margin-right: 6px; }
.cg-confirm__loss { color: var(--cg-ink-2); font-weight: 400; }
.cg-confirm.is-long .cg-confirm__q { flex-basis: 100%; margin-bottom: 2px; }

/* ── Fix ── */
.cg-fixbox:focus-visible { outline: none; border-radius: 0; box-shadow: inset 2px 0 0 var(--cg-focus); background: var(--cg-sunk); }
.cg-fixbox.is-confirm { background: var(--cg-sunk); }
.cg-fixbox.is-confirm .cg-fix:last-child { padding-bottom: 10px; }
.cg-fix { display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr); padding: 9px 10px 4px 0; }
.cg-fix + .cg-fix { border-top: 1px solid var(--cg-rule); padding-top: 9px; }
.cg-cap { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); margin-bottom: 2px; }
.cg-fix__t { font-size: var(--cg-text-lg); line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }
.cg-fix__t.is-was { color: var(--cg-ink-muted); }
.cg-fix__acts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 6px 6px 10px calc(var(--cg-gutter) - 9px); }
.cg-fix__why { padding: 0 8px; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); }
.cg-fix__why::first-letter { text-transform: uppercase; }
.cg-fix__card { padding: 0 10px 10px var(--cg-gutter); }
.cg-done { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-2); padding: 0 6px 0 8px; white-space: nowrap; }

/* ── «Фан написал новое» ── */
.cg-stale { display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr) auto; align-items: center; min-height: 34px; padding: 2px 4px 2px 0; border-bottom: 1px solid var(--cg-rule); font-size: var(--cg-text-sm2); }
.cg-stale__t { color: var(--cg-ink-2); }
.cg-stale__t b { color: var(--cg-ink-strong); font-weight: 600; }

/* ── the refusal of a fourth generation: what runs now ── */
.cg-card + .cg-ops { border-top: 1px solid var(--cg-rule); }
.cg-ops { padding: 4px 0 6px; }
.cg-op { display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr) 64px 48px auto; align-items: center; min-height: 32px; padding: 0 4px 0 0; }
.cg-op__fan { font-weight: 500; color: var(--cg-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-op__feat { color: var(--cg-ink-muted); }
.cg-op__t { color: var(--cg-ink-muted); text-align: right; padding-right: 8px; white-space: nowrap; }
.cg-op__a { display: flex; gap: 2px; }

/* A countdown that leads the card's actions starts at the text column, as a button's label does. */
.cg-card__acts > .cg-count:first-child { padding-left: 8px; }

/* ── the status banner: the sheet's last row ── */
.cg-sheet > * + .cg-banner { border-top: 1px solid var(--cg-rule); }
.cg-banner > .cg-btn--quiet { box-shadow: inset 0 0 0 1px var(--cg-rule-3); color: var(--cg-ink-strong); font-weight: 500; }
${dark('.cg-banner > .cg-btn--quiet')} { box-shadow: inset 0 0 0 1px var(--cg-rule-2); }

/* ── «Вид ответа: без подложки» (the default): inked onto the feed between two hairlines ── */
.cg-bare .cg-sheet { background: transparent; border: 0; border-top: 1px solid var(--cg-rule-3); border-bottom: 1px solid var(--cg-bare-edge); border-radius: 0; box-shadow: none; margin-bottom: 0; }
.cg-bare :is(.cg-head, .cg-vhead, .cg-hi__col, .cg-stale, .cg-fix + .cg-fix, .cg-card + .cg-ops, .cg-sheet > * + .cg-banner) { border-color: var(--cg-bare-rule); }
.cg-bare :is(.cg-fixbox:focus-visible, .cg-fixbox.is-confirm) { background: var(--cg-bare-hover); }

/* ── narrow composer (ui-design §3.3) ── */
@container cg (max-width: 899px) {
  .cg-quota .cg-long { display: none; }
  .cg-quota .cg-short { display: inline; }
  .cg-strip.is-crowded .cg-slot--persona { display: none; }
}
@container cg (max-width: 789px) {
  .cg-slot--persona, .cg-hint { display: none; }
  .cg-strip .cg-act { padding: 0 5px; gap: 4px; }
  .cg-tone-val { margin-left: -4px; }
  .cg-strip__acts { margin-left: -5px; }
}
@container cg (max-width: 689px) {
  .cg-strip .cg-act kbd { display: none; }
}
@container cg (max-width: 600px) {
  .cg-slot--two { display: none; }
  .cg-slot--more { display: inline-flex; }
  .cg-strip.has-status :is(.cg-slot--tone, .cg-slot--split), .cg-strip.has-status .cg-status-word + .cg-div { display: none; }
  .cg-head__meta, .cg-head__acts kbd { display: none; }
  .cg-refresh .cg-btn__t { ${VISUALLY_HIDDEN} }
  .cg-op { grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr) 44px auto; }
  .cg-op__feat { display: none; }
}
@container cg (max-width: 420px) {
  .cg-slot--quota, .cg-tone-val, .cg-lock { display: none; }
  .cg-status-word .cg-long { display: none; }
  .cg-status-word .cg-short { display: inline; }
  .cg-head { gap: 6px; }
  .cg-head > .cg-gut { margin-right: -6px; }
  .cg-hide { width: 26px; padding: 0; justify-content: center; }
  .cg-hide .cg-ico { display: block; }
  .cg-hide .cg-btn__t { ${VISUALLY_HIDDEN} }
  .cg-stale { grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr); row-gap: 4px; padding-bottom: 6px; }
  .cg-stale > .cg-btn { grid-column: 2; justify-self: start; margin-left: -8px; }
}
@container cg (max-width: 359px) {
  .cg-again { width: 26px; padding: 0; justify-content: center; }
  .cg-again .cg-ico { display: block; }
  .cg-again .cg-btn__t { ${VISUALLY_HIDDEN} }
}
@media (prefers-reduced-motion: reduce) { .cg-sheet { animation: none; } }
`;

export const DOCK_STYLE: StyleSource = { id: 'cg-dock', css: DOCK_CSS };
