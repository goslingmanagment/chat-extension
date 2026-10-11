// The dock's stylesheet (ui-design §2, §3.1–§3.3, §4.1–§4.10), adopted after
// the kit's sheets into the dock's closed shadow root. Tokens only: no colour
// outside the `--cg-*` list. The family look (decision X28): the bar is a card
// of raised chips with Reply's options in a sunken capsule, a result is a
// panel of draft cards. The narrow rules are container queries on the kit's
// `cg` container (the dock's own width, not the window's) and go one way: what
// hides at a width stays hidden below it.
//
//   widest  everything: the capsule with the word «Split», Spenders and
//           «Новые», the status in words, the persona, the palette key
//   < 1000  no persona, no palette key; the status words short
//   < 900   Split in the capsule is its glyph alone
//   < 820   Spenders and «Новые» move into «Ещё»; the status is a spinner in the
//           goose's place; no lock in the capsule while a generation runs; the
//           chips stand closer
//   < 680   Review, Recap, Coach in «Ещё» too; Hi variants in a column
//   ≤ 600   head without meta and key labels
//   < 480   the capsule's cells narrower, 24 px from one to the next; no seams
//   < 440   no goose (while the chat loads its spinner stays, in the place of «Ещё»)
//   ≤ 420   «Скрыть» is ×; Insert under the text
//   < 360   «Ещё раз» is ↻, so «черновик · не отправлено» fits whole; the
//           buttons of a Recap or Review head take a second line; «Ещё» is ⋯
//           and the chips closer still (a 320 px column, §6.5)

import { type StyleSource } from '../kit';

/** Text kept for screen readers while its button shows an icon only. */
const VISUALLY_HIDDEN = 'position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;';

/**
 * The sheet ships in the dock's first chunk, whose budget is 45 KiB gzip (architecture.md §11), and a CSS comment
 * in it would ship too: prose for nobody. So a note here is a JS comment in an empty `${…}`, which the minifier
 * drops; it stands where a CSS comment would.
 */
export const DOCK_CSS = `
${/* The bar is first in the document (Tab reaches it first, ui-design §6.3) and last on screen. In the dock the gutter is the number cell of a draft card. */ ''}
.cg-dock { position: relative; display: flex; flex-direction: column-reverse; font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink); --cg-gutter: 31px; --cg-lead: 12px; }

${/* ── the bar: a card of raised chips ── */ ''}
.cg-strip {
  display: flex; align-items: center; gap: 4px; height: 40px; min-width: 0; padding: 0 5px 0 1px;
  background: var(--cg-raised); border: 1px solid var(--cg-rule-2); border-radius: var(--cg-r-lg); box-shadow: var(--cg-shadow);
}
.cg-mark { position: relative; width: 30px; height: 28px; flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--cg-clay); }
.cg-mark.is-off { color: var(--cg-ink-faint); }
.cg-mark > .cg-spin { display: none; }
.cg-quota {
  position: absolute; top: -3px; right: -4px; min-width: 15px; height: 14px; padding: 0 3px; border-radius: var(--cg-r-pill);
  background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink);
  font-family: var(--cg-mono); font-size: 9.5px; line-height: 14px; font-weight: 600; text-align: center;
}
.cg-quota.is-zero { background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-danger); color: var(--cg-danger); }
.cg-slot { display: inline-flex; align-items: center; gap: 4px; flex: none; min-width: 0; }
.cg-strip__acts { flex: none; display: flex; align-items: center; gap: 4px; }
.cg-strip__opts { display: flex; align-items: center; gap: 4px; min-width: 0; margin-left: auto; padding-left: 8px; }
.cg-strip__opts > * { flex: none; }
.cg-strip__opts > .cg-slot--persona, .cg-strip__opts > .cg-status-word { flex: 0 1 auto; min-width: 0; }
.cg-slot--more, .cg-strip.has-status .cg-slot--boards { display: none; }
${/* «Ещё» opens above the whole bar, not over its upper edge. */ ''}
.cg-strip .cg-menu--top { bottom: calc(100% + 9px); }
.cg-hint {
  padding: 0 5px; border-radius: 5px; box-shadow: inset 0 0 0 1px var(--cg-rule-3), 0 1px 0 var(--cg-rule-3);
  font-family: var(--cg-mono); font-size: var(--cg-text-2xs); line-height: 18px; color: var(--cg-ink-muted); white-space: nowrap;
}
.cg-persona { display: block; line-height: 26px; height: 26px; padding: 0 4px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; min-width: 0; }
.cg-persona.is-missing { color: var(--cg-ink-2); }
.cg-status-word { display: inline-flex; align-items: center; gap: 6px; font-size: var(--cg-text-sm); color: var(--cg-ink-2); white-space: nowrap; padding: 0 4px; overflow: hidden; text-overflow: ellipsis; }
.cg-status-word .cg-short { display: none; }

${/* ── the sheet: what opens above the bar. «На подложке» — a card of its own; «без подложки» (below) — one card with the bar. ── */ ''}
.cg-sheet {
  display: flex; flex-direction: column; max-height: var(--cg-cap); margin-bottom: 2px; overflow: hidden;
  background: var(--cg-raised); border: 1px solid var(--cg-rule-2); border-radius: var(--cg-r-lg); box-shadow: var(--cg-shadow);
  animation: cg-open 140ms var(--cg-ease);
}
.cg-sheet > :not(.cg-body) { flex: none; }
.cg-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.cg-head { flex: none; display: flex; align-items: center; gap: 8px; min-height: 36px; min-width: 0; padding: 0 5px 0 12px; border-bottom: 1px solid var(--cg-rule); }
.cg-head:last-child { border-bottom: 0; }
.cg-head > .cg-gut { width: auto; }
.cg-head > .cg-gut:empty { display: none; }
.cg-head__title { flex: none; font-weight: 700; color: var(--cg-ink-strong); white-space: nowrap; }
.cg-head__meta { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.cg-head__draft { flex: none; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); white-space: nowrap; }
.cg-head__score { flex: none; font-size: var(--cg-text-xl); font-weight: 600; color: var(--cg-ink-strong); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cg-head__score span { color: var(--cg-ink-muted); font-weight: 400; font-size: var(--cg-text-sm); }
.cg-head__sp { flex: 1; min-width: 0; order: 1; }
.cg-head > .cg-timer { flex: none; order: 2; }
.cg-head__acts { display: flex; align-items: center; gap: 2px; flex: none; order: 3; }
.cg-again .cg-ico, .cg-hide .cg-ico { display: none; }

${/* ── streaming: the draft as it is written, no buttons ── */ ''}
${/* A stage that does not fit ends in «…» instead of a cut letter. */ ''}
.cg-head .cg-stage.is-now { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cg-stream { display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr); margin: 8px; padding: 7px 10px 8px 0; border: 1px dashed var(--cg-clay-line); border-radius: 9px; background: var(--cg-draft); }

${/* ── parts: Hi variants, the Б2 question ── */ ''}
.cg-part.is-confirm .cg-ins { display: none; }
.cg-vhead { display: flex; align-items: center; gap: 8px; height: 22px; padding: 0 4px; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); }
.cg-vhead b { color: var(--cg-ink-2); font-weight: 600; }
.cg-hi { display: grid; gap: 8px; padding: 6px 8px 8px; }
.cg-hi__col { display: grid; gap: 6px; align-content: start; min-width: 0; }
@container cg (min-width: 680px) {
  .cg-hi { grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
  .cg-hi .cg-part { grid-template-columns: 24px minmax(0, 1fr); }
  .cg-hi .cg-part__t { font-size: var(--cg-text-lg); line-height: 20px; }
  .cg-hi .cg-part__a { grid-column: 2; justify-self: start; margin: 6px 0 0 -2px; }
  .cg-hi .cg-part.is-done .cg-part__a { margin: 2px 0 0 -2px; }
  .cg-hi .cg-part__card, .cg-hi .cg-part__extra { grid-column: 2; }
}
.cg-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--cg-clay-line); }
.cg-confirm__q { color: var(--cg-ink); font-weight: 500; margin-right: 6px; }
.cg-confirm__loss { color: var(--cg-ink-2); font-weight: 400; }
.cg-confirm.is-long .cg-confirm__q { flex-basis: 100%; margin-bottom: 2px; }

${/* ── Fix: «Ваш текст» is plain, «После Fix» is the draft ── */ ''}
.cg-fixbox { display: grid; gap: 6px; padding: 8px 8px 0; }
.cg-fixbox:focus-visible { outline: none; }
.cg-fixbox:focus-visible .cg-fix:last-child, .cg-fixbox.is-confirm .cg-fix:last-child { background: var(--cg-draft-hover); border-color: var(--cg-clay-ink); }
.cg-fix { display: grid; grid-template-columns: 10px minmax(0, 1fr); padding: 6px 10px 7px 0; border: 1px solid var(--cg-rule); border-radius: 9px; }
.cg-fix:last-child { border: 1px dashed var(--cg-clay-line); background: var(--cg-draft); }
.cg-fixbox > .cg-fix:only-child { border: 1px solid var(--cg-rule); background: none; }
.cg-cap { font-size: var(--cg-text-xs); line-height: 16px; color: var(--cg-ink-muted); margin-bottom: 1px; }
.cg-fix__t { font-family: var(--cg-serif); font-size: 14.5px; line-height: 21px; white-space: pre-wrap; overflow-wrap: anywhere; }
.cg-fix__t.is-was { font-family: inherit; font-size: var(--cg-text-base); line-height: 19px; color: var(--cg-ink-muted); }
.cg-fix__acts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 8px; }
.cg-fix__go:not([aria-disabled="true"]) { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); }
.cg-fix__go:not([aria-disabled="true"]):hover { box-shadow: inset 0 0 0 1px var(--cg-clay-ink); }
.cg-fix__why { padding: 0 8px; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); }
.cg-fix__why::first-letter { text-transform: uppercase; }
.cg-fix__card { padding: 0 12px 10px; }
.cg-done { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-2); padding: 0 6px 0 4px; white-space: nowrap; }

${/* ── «Фан написал новое»: a tinted notice over the parts ── */ ''}
.cg-stale {
  display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; min-height: 34px; margin: 8px 8px 0; padding: 3px 4px 3px 2px;
  border-radius: 9px; background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); font-size: var(--cg-text-sm2);
}
.cg-stale > .cg-gut { width: 22px; }
.cg-stale__t { color: var(--cg-ink-2); }
.cg-stale__t b { color: var(--cg-ink-strong); font-weight: 600; }

${/* ── the refusal of a fourth generation: what runs now ── */ ''}
.cg-card + .cg-ops { border-top: 1px solid var(--cg-rule); }
.cg-ops { padding: 4px 0 6px; }
.cg-op { display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr) 64px 48px auto; align-items: center; min-height: 32px; padding: 0 6px 0 0; }
.cg-op__fan { font-weight: 500; color: var(--cg-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-op__feat { color: var(--cg-ink-muted); }
.cg-op__t { color: var(--cg-ink-muted); text-align: right; padding-right: 8px; white-space: nowrap; }
.cg-op__a { display: flex; gap: 2px; }

${/* A countdown that leads the card's actions starts at the text column, as a button's label does. */ ''}
.cg-card__acts > .cg-count:first-child { padding-left: 8px; }

${/* ── the status banner: the sheet's last row ── */ ''}
.cg-sheet > * + .cg-banner { border-top: 1px solid var(--cg-rule); }

${/* ── «Вид ответа: без подложки» (the default): the result and the bar are one card — the sheet is its upper part ── */ ''}
.cg-bare .cg-sheet { margin-bottom: 0; border-bottom: 0; border-radius: var(--cg-r-lg) var(--cg-r-lg) 0 0; box-shadow: none; }
.cg-bare .cg-strip:has(+ .cg-sheet) { border-radius: 0 0 var(--cg-r-lg) var(--cg-r-lg); border-top-color: var(--cg-rule); }

${/* ── narrow composer (ui-design §3.3) ── */ ''}
@container cg (max-width: 999px) {
  .cg-slot--persona, .cg-hint, .cg-status-word .cg-long { display: none; }
  .cg-status-word .cg-short { display: inline; }
}
@container cg (max-width: 899px) {
  .cg-split .cg-act__t { ${VISUALLY_HIDDEN} }
  .cg-tones .cg-split { width: 26px; padding: 0; }
}
@container cg (max-width: 819px) {
  ${/* Nothing of the right block is left here (the windows are in «Ещё», the status is the goose's spinner): it gives its gap back. */ ''}
  .cg-strip__opts, .cg-strip.has-status .cg-slot--more, .cg-lock, .cg-strip.has-status .cg-goose { display: none; }
  .cg-slot--more { display: inline-flex; }
  .cg-mark > .cg-spin { display: block; }
  .cg-strip .cg-act:not(.cg-opt) { padding: 0 8px; }
}
@container cg (max-width: 679px) {
  .cg-slot--two { display: none; }
  .cg-strip.has-status .cg-slot--more { display: inline-flex; }
  .cg-strip, .cg-strip__acts, .cg-slot { gap: 3px; }
  .cg-strip .cg-act:not(.cg-opt) { padding: 0 7px; }
  .cg-mark { width: 26px; }
}
@container cg (max-width: 600px) {
  .cg-head__meta, .cg-head__acts kbd { display: none; }
  .cg-refresh .cg-btn__t { ${VISUALLY_HIDDEN} }
  .cg-op { grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr) 44px auto; }
  .cg-op__feat { display: none; }
}
@container cg (max-width: 479px) {
  .cg-strip .cg-div { display: none; }
  .cg-strip .cg-act:not(.cg-opt) { padding: 0 6px; }
  ${/* 22 px cells 2 px apart: a tone stays a target of its own, 24 px from the next one (WCAG 2.5.8). */ ''}
  .cg-tones .cg-opt { width: 22px; }
  .cg-tones__track { gap: 2px; }
}
@container cg (max-width: 439px) {
  ${/* No room for the goose. While the chat loads its spinner stands in for «Ещё», which would open nothing then. */ ''}
  .cg-strip:not(.has-status) .cg-mark, .cg-strip.has-status .cg-slot--more { display: none; }
  .cg-strip { padding: 0 3px; }
  .cg-mark { width: 22px; }
}
@container cg (max-width: 420px) {
  .cg-head { gap: 6px; padding-left: 10px; }
  .cg-hide { width: 26px; padding: 0; justify-content: center; }
  .cg-hide .cg-ico { display: block; }
  .cg-hide .cg-btn__t { ${VISUALLY_HIDDEN} }
  .cg-stale { grid-template-columns: 22px minmax(0, 1fr); row-gap: 4px; padding-bottom: 6px; }
  .cg-stale > .cg-btn { grid-column: 2; justify-self: start; }
}
@container cg (max-width: 359px) {
  .cg-again { width: 26px; padding: 0; justify-content: center; }
  .cg-again .cg-ico { display: block; }
  .cg-again .cg-btn__t { ${VISUALLY_HIDDEN} }
  ${/* The bar in a 320 px column (ui-design §6.5): «Ещё» is ⋯ and the chips closer still, so that the capsule stays inside the dock in both languages. */ ''}
  .cg-strip, .cg-strip__acts, .cg-slot { gap: 2px; }
  .cg-strip .cg-act:not(.cg-opt) { padding: 0 5px; }
  .cg-tones__seam { margin: 0 2px; }
  .cg-more .cg-act__t { ${VISUALLY_HIDDEN} }
  .cg-more::before { content: "⋯"; }
  ${/* Recap and Review: a segment or a score and up to four buttons. They do not fit one line here, and nothing may run out of the dock. */ ''}
  .cg-head--tools { flex-wrap: wrap; row-gap: 2px; padding-top: 4px; padding-bottom: 3px; }
  .cg-head--tools > .cg-head__sp { display: none; }
  .cg-head--tools > .cg-head__acts { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) { .cg-sheet { animation: none; } }
`;

export const DOCK_STYLE: StyleSource = { id: 'cg-dock', css: DOCK_CSS };
