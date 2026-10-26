// The dock's stylesheet (ui-design §2, §3.1–§3.3, §4.1–§4.10), adopted after
// the kit's sheets into the dock's closed shadow root. Tokens only: no colour
// outside the `--cg-*` list. The family look (decision X28): the bar is a card
// of raised chips with Reply's options in a sunken capsule, a result is a
// panel of draft cards. The bar's chips are the old Fansly extension's buttons
// (2026-10-22, the owner's word): 13 px, weight 600, 30 px high, 0 8 px, and
// neither they nor a result's head follow «Размер текста: Крупнее» (X55) —
// only the AI text, the parts and the cards grow. The narrow rules are
// container queries on the kit's `cg` container (the dock's own width, not the
// window's), in px whatever the text size, and go one way: what hides at a
// width stays hidden below it. Between two of them a row that does not fit
// scrolls sideways, as the old bar did; it never drops a word.
//
//   always  Spenders and «Новые» are their icons, on every site and width
//           (X64: as on Fansly); the word is the name and
//           the hint. No persona and no «Скачать лог» on the bar
//           (2026-10-22): the persona is in Reply's hint, the log in the popup
//   widest  the rest in words: the capsule with the word «Split», the status
//           in words, the palette key
//   < 1000  no palette key; the status words short
//   < 900   Split in the capsule is its glyph alone
//   < 820   no lock in the capsule while a generation runs
//   < 690   the status in the windows' place while the chat loads is its
//           spinner alone; Hi variants in a column below 680
//   < 648   the words' chips 6 px in, the capsule's cells narrower, 24 px
//           from one to the next: every word fits on ~585 px of bar (all of
//           them at full padding need ~638; Fansly's composer is 600–940 px
//           wide, ChatSpace's ~540–1020) — 2026-10-26, the bar with «Онлайн»
//           (its number at the icon's corner, the chip 30 px like its
//           neighbours), Voice its 🎙, no Review
//   < 596   Recap and Coach are their icons too (the row needs ~542)
//   < 552   no seams (the row of icons needs ~506); below that it scrolls,
//           as the old bar did
//   < 420   the five icons in «Ещё» at once; while the chat loads, the
//           status spinner in its place
//   ≤ 420   no head meta; Insert under the text
//   < 360   «Ещё раз» is ↻; the buttons of a Recap head take a second
//           line; «Ещё» is ⋯
//           and the chips closer still (a 320 px column, §6.5)
//
// No goose in the bar (decision X31): its cell is the room that keeps every
// chip on a ~540 px composer, as on a 1512 px window with ChatSpace's side
// panel open.

import { BASE_TEXT_DECLARATIONS, dark, type StyleSource } from '../kit';
import { STALE_ROW_CSS, STALE_ROW_NARROW_CSS } from './stale-row.css';

/** Text kept for screen readers while its button shows an icon only. */
const VISUALLY_HIDDEN = 'position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;';

/**
 * The sheet ships in the dock's first chunk, whose budget is 45 KiB gzip (architecture.md §11), and a CSS comment
 * in it would ship too: prose for nobody. So a note here is a JS comment in an empty `${…}`, which the minifier
 * drops; it stands where a CSS comment would.
 */
/**
 * The steps of a narrow bar, in px of the dock's width whatever the text size (2026-10-22: in the root's text they
 * folded at ~703 px under «Крупнее», on every Fansly composer), each a few px above the width its row needs plus the
 * dock's 8 px around the bar on Fansly (measured on both sites' stands, 2026-10-26, the bar with «Онлайн», Voice its
 * 🎙, no Review; a new chip on the bar means measuring again, `pnpm see dock-widths`): below `TIGHT_BELOW` the words'
 * chips and the capsule close up, below `ICONS_BELOW` Recap and Coach are their icons, below `SEAMS_BELOW` the seams
 * go, below `MORE_BELOW` the five icons go into «Ещё». Above `ICONS_BELOW` the bar shows every word; nothing scrolls
 * above `SEAMS_BELOW`.
 */
export const TIGHT_BELOW = 648;
export const ICONS_BELOW = 596;
export const SEAMS_BELOW = 552;
export const MORE_BELOW = 420;

export const DOCK_CSS = `
${/* The bar is first in the document (Tab reaches it first, ui-design §6.3) and last on screen. In the dock the gutter is the number cell of a draft card. */ ''}
.cg-dock { position: relative; display: flex; flex-direction: column-reverse; font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink); --cg-gutter: 31px; --cg-lead: 12px; }
${/* The bar and a result's head keep the base type scale under «Крупнее» (2026-10-22): only the AI text, parts and cards grow. */ ''}
.cg-strip, .cg-head { ${BASE_TEXT_DECLARATIONS} }

${/* ── the bar: a card of raised chips, the old Fansly extension's 30 px buttons in the 40 px bar it had before (2026-10-22, the owner: at 48 px it stood apart from the composer); a row that does not fit scrolls ── */ ''}
.cg-strip {
  display: flex; align-items: center; gap: 4px; height: 40px; min-width: 0; padding: 0 5px;
  overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; overscroll-behavior-x: contain;
  background: var(--cg-raised); border: 1px solid var(--cg-rule-2); border-radius: var(--cg-r-lg); box-shadow: var(--cg-shadow);
}
.cg-strip .cg-act:not(.cg-opt) { height: 30px; padding: 0 8px; border-radius: 7px; font-size: 13px; line-height: 1; font-weight: 600; }
.cg-strip .cg-tones { height: 30px; }
${/* The old dark bar: its buttons a step darker than the card (#21201c on #262420), a hairline of the line colour. */ ''}
${dark('.cg-strip')} { --cg-chip: color-mix(in srgb, var(--cg-surface) 50%, var(--cg-raised)); }
${/* What is left of a low quota: a count on the bar's frame over Reply's corner, clear of its word. */ ''}
.cg-slot--reply { position: relative; }
.cg-quota {
  position: absolute; top: -7px; left: -4px; z-index: 2; min-width: 15px; height: 13px; padding: 0 3px; border-radius: var(--cg-r-pill);
  background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line), 0 0 0 2px var(--cg-raised); color: var(--cg-clay-ink);
  font-family: var(--cg-mono); font-size: var(--cg-text-kbd); line-height: 13px; font-weight: 600; text-align: center; cursor: default;
}
.cg-quota.is-zero { background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-danger), 0 0 0 2px var(--cg-raised); color: var(--cg-danger); }
.cg-slot { display: inline-flex; align-items: center; gap: 4px; flex: none; min-width: 0; }
.cg-strip__acts { flex: none; display: flex; align-items: center; gap: 4px; }
.cg-strip__opts { display: flex; align-items: center; gap: 4px; min-width: 0; margin-left: auto; padding-left: 8px; }
.cg-strip__opts > * { flex: none; }
.cg-strip__opts > .cg-status-word { flex: 0 1 auto; min-width: 0; }
.cg-act--ico > .cg-ico { display: none; width: 14px; height: 14px; }
${/* Spenders and «Новые» are their icons at every width, on both sites (X64): the word is in the hint and in the name. Voice too (the owner, 2026-10-23: «войс лучше иконкой»), the old Fansly extension's 🎙. */ ''}
.cg-strip .cg-slot--voice .cg-act--ico, .cg-strip .cg-slot--boards .cg-act--ico { width: 30px; padding: 0; }
.cg-slot--voice .cg-act--ico > .cg-ico, .cg-slot--boards .cg-act--ico > .cg-ico { display: block; }
.cg-slot--voice .cg-act--ico > .cg-act__t, .cg-slot--boards .cg-act--ico > .cg-act__t { ${VISUALLY_HIDDEN} }
.cg-act.is-busy > .cg-ico { opacity: 0.35; }
${/* «Онлайн N»: the number of fans worth a message now, in the green of presence, at the icon's corner as the quota sits at Reply's (2026-10-26: beside the icon it took ~30 px the bar did not have). The chip stays 30 px whatever the number; the corner leans into the room before the windows' block, inside the bar. */ ''}
.cg-act__n {
  position: absolute; top: -3px; left: -7px; z-index: 2; min-width: 15px; height: 13px; padding: 0 3px; border-radius: var(--cg-r-pill); box-sizing: border-box;
  background: var(--cg-good-bg); box-shadow: inset 0 0 0 1px var(--cg-good-line), 0 0 0 2px var(--cg-raised); color: var(--cg-good-ink);
  font-family: var(--cg-mono); font-size: var(--cg-text-kbd); line-height: 13px; font-weight: 600; text-align: center; pointer-events: none;
}
.cg-slot--more { display: none; }
${/* «Ещё» opens above the whole bar, not over its upper edge. */ ''}
.cg-strip .cg-menu--top { bottom: calc(100% + 9px); }
.cg-hint {
  padding: 0 5px; border-radius: 5px; box-shadow: inset 0 0 0 1px var(--cg-rule-3), 0 1px 0 var(--cg-rule-3);
  font-family: var(--cg-mono); font-size: var(--cg-text-2xs); line-height: 18px; color: var(--cg-ink-muted); white-space: nowrap;
}
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
${/* «Reply — @fan» (the old head, 2026-10-22): the name gives way with «…», never to the meta rule. */ ''}
.cg-head__fan { flex: 0 1 auto; min-width: 3em; margin-left: -4px; font-weight: 700; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-head__meta { flex: 0 3 auto; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
${/* «☑ с Recap · 3 д назад»: the meta's words as a tick that asks again the other way (1.48.0). */ ''}
.cg-head__recap { flex: none; display: inline-flex; }
.cg-head__recap .cg-check { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; }
.cg-head__recap .cg-check[aria-pressed="true"] { color: var(--cg-ink-2); }
${/* What the answer cost, the head's last quiet word, as the old head printed it; in/write/read/out in its hint. */ ''}
.cg-head__usage { font-family: var(--cg-mono); font-size: var(--cg-text-xs); letter-spacing: 0; cursor: default; }
.cg-head__sp { flex: 1; min-width: 0; order: 1; }
.cg-head > .cg-timer { flex: none; order: 2; }
.cg-head__acts { display: flex; align-items: center; gap: 2px; flex: none; order: 3; }
.cg-again .cg-ico { display: none; }
${/* «Скрыть» is × at every width, as the old panel's close (X57); its word stays its name. */ ''}
.cg-hide { width: 26px; padding: 0; justify-content: center; }
.cg-hide .cg-btn__t { ${VISUALLY_HIDDEN} }
${/* A head button's key is in its hint, not printed beside it (ui-design §1 п. 7): the head says no norm. */ ''}
.cg-head__acts kbd { display: none; }

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
${/* Side by side the variants read as one row of cards: each column's last card reaches the row's foot, its buttons
   stand at the card's foot — «Вставить» at the text's edge, «Копировать» at the far one — and a card of one message
   keeps the same margin on both sides of its text. */ ''}
@container cg (min-width: 680px) {
  .cg-hi { grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
  .cg-hi__col { container: cg-hi / inline-size; display: flex; flex-direction: column; }
  .cg-hi__col > .cg-part:last-child { flex-grow: 1; }
  .cg-hi .cg-vhead { padding: 0 11px; }
  .cg-hi .cg-part { grid-template-columns: 24px minmax(0, 1fr); grid-template-rows: 1fr; padding: 8px 10px 8px 0; }
  .cg-hi .cg-part.is-solo { grid-template-columns: 10px minmax(0, 1fr); }
  .cg-hi .cg-part__t { font-size: var(--cg-text-lg); line-height: 20px; }
  .cg-hi .cg-part__a { grid-column: 2; flex-wrap: wrap; row-gap: 4px; margin: 8px 0 0; }
  .cg-hi .cg-part__copy { order: 1; margin-left: auto; }
  .cg-hi .cg-part.is-done .cg-part__a, .cg-hi .cg-part.is-done.is-kept .cg-part__a { margin: 8px 0 0; }
  .cg-hi .cg-part__card, .cg-hi .cg-part__extra { grid-column: 2; }
}
${/* A variant's column of a ~700 px dock is ~225 px: «Копировать» in words beside «Вставить ↵» does not fit its card, so
   the copy is its icon there, as on a narrow dock; a row that still runs past the card wraps instead. */ ''}
@container cg-hi (max-width: 279px) {
  .cg-hi .cg-part__copy { width: 28px; padding: 0; justify-content: center; }
  .cg-hi .cg-part__copy .cg-btn__t { display: none; }
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
.cg-fix__t { font-family: var(--cg-serif); font-size: var(--cg-text-ai); line-height: var(--cg-leading-ai); white-space: pre-wrap; overflow-wrap: anywhere; }
.cg-fix__t.is-was { font-family: inherit; font-size: var(--cg-text-base); line-height: 19px; color: var(--cg-ink-muted); }
.cg-fix__acts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 8px; }
.cg-fix__go:not([aria-disabled="true"]) { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); }
.cg-fix__go:not([aria-disabled="true"]):hover { box-shadow: inset 0 0 0 1px var(--cg-clay-ink); }
.cg-fix__why { padding: 0 8px; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); }
.cg-fix__why::first-letter { text-transform: uppercase; }
.cg-fix__card { padding: 0 12px 10px; }
.cg-done { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-2); padding: 0 6px 0 4px; white-space: nowrap; }

${/* ── «Фан написал новое»: a tinted notice over the parts ── */ ''}
${STALE_ROW_CSS}
${/* Split was asked and one message came (the old extension's note): the same row, amber — a miss of the ask, not of the chat. */ ''}
.cg-stale.cg-stale--split { background: var(--cg-amber-bg); box-shadow: inset 0 0 0 1px var(--cg-amber-line); }
${/* ↵ is printed on «Вставить» only while its part holds the focus (2026-10-22): elsewhere Enter is the site's, and would send the draft. */ ''}
.cg-part:not(:focus-within) .cg-ins kbd, .cg-part:not(:focus-within) .cg-copy-main kbd { display: none; }

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
${/* «Нет персоны»: the persona picked in the banner — the browser's own list, «Сохранить», «Настройки». */ ''}
.cg-pick { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.cg-pick__list {
  height: 26px; max-width: 200px; padding: 0 6px; border: 0; border-radius: 7px; cursor: pointer;
  background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule-2); color: var(--cg-ink); font-size: var(--cg-text-base);
}

${/* ── «Вид ответа: без подложки» (the default): the result and the bar are one card — the sheet is its upper part ── */ ''}
.cg-bare .cg-sheet { margin-bottom: 0; border-bottom: 0; border-radius: var(--cg-r-lg) var(--cg-r-lg) 0 0; box-shadow: none; }
.cg-bare .cg-strip:has(+ .cg-sheet) { border-radius: 0 0 var(--cg-r-lg) var(--cg-r-lg); border-top-color: var(--cg-rule); }

${/* ── narrow composer (ui-design §3.3): px of the dock's own width, whatever the text size ── */ ''}
@container cg (max-width: 999px) {
  .cg-hint, .cg-status-word .cg-long { display: none; }
  .cg-status-word .cg-short { display: inline; }
}
@container cg (max-width: 899px) {
  .cg-split .cg-act__t { ${VISUALLY_HIDDEN} }
  .cg-tones .cg-split { width: 26px; padding: 0; }
}
@container cg (max-width: 819px) {
  .cg-lock { display: none; }
}
@container cg (max-width: 689px) {
  ${/* While the chat loads the status in the windows' place is its spinner alone. */ ''}
  .cg-status-word .cg-short { ${VISUALLY_HIDDEN} }
}
@container cg (max-width: ${TIGHT_BELOW - 1}px) {
  .cg-strip__opts { padding-left: 4px; }
  .cg-strip .cg-div { margin: 0 2px; }
  ${/* The words' chips 6 px in (2026-10-23): every word, «Онлайн» on the bar, still fits a ~595 px composer; an icon's chip keeps its own width. */ ''}
  .cg-strip .cg-act:not(.cg-opt) { padding: 0 6px; }
  .cg-strip .cg-slot--voice .cg-act--ico, .cg-strip .cg-slot--boards .cg-act--ico { padding: 0; }
  ${/* 22 px cells 2 px apart: a tone stays a target of its own, 24 px from the next one (WCAG 2.5.8). */ ''}
  .cg-tones .cg-opt { width: 22px; }
  .cg-tones__track { gap: 2px; }
}
@container cg (max-width: ${ICONS_BELOW - 1}px) {
  ${/* Recap and Coach too: below here their words no longer fit the bar. */ ''}
  .cg-strip .cg-slot--two .cg-act--ico { width: 30px; padding: 0; }
  .cg-slot--two .cg-act--ico > .cg-ico { display: block; }
  .cg-slot--two .cg-act--ico > .cg-act__t { ${VISUALLY_HIDDEN} }
}
@container cg (max-width: ${MORE_BELOW - 1}px) {
  ${/* The five icons go into «Ещё» at once: the windows alone would give back less than «Ещё» takes. Nothing scrolls then, and «Ещё» opens above the bar. */ ''}
  .cg-strip { overflow: visible; }
  .cg-slot--two, .cg-slot--boards { display: none; }
  .cg-slot--more { display: inline-flex; }
  ${/* At the narrowest the status spinner takes «Ещё»'s place while the chat loads. */ ''}
  .cg-strip.has-status .cg-slot--more { display: none; }
}
@container cg (max-width: 600px) {
  .cg-refresh .cg-btn__t { ${VISUALLY_HIDDEN} }
  .cg-op { grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr) 44px auto; }
  .cg-op__feat { display: none; }
}
@container cg (max-width: ${SEAMS_BELOW - 1}px) {
  .cg-strip .cg-div { display: none; }
}
@container cg (max-width: 420px) {
  .cg-head { gap: 6px; padding-left: 10px; }
  .cg-head__meta, .cg-head__recap { display: none; }
${STALE_ROW_NARROW_CSS}
}
@container cg (max-width: 359px) {
  .cg-again { width: 26px; padding: 0; justify-content: center; }
  .cg-again .cg-ico { display: block; }
  .cg-again .cg-btn__t { ${VISUALLY_HIDDEN} }
  ${/* The bar in a 320 px column (ui-design §6.5): «Ещё» is ⋯ and the chips closer still, so that the capsule stays inside the dock in both languages. */ ''}
  .cg-strip { padding: 0 4px; }
  .cg-strip, .cg-strip__acts, .cg-slot { gap: 2px; }
  .cg-strip .cg-act:not(.cg-opt) { padding: 0 5px; }
  .cg-tones__seam { margin: 0 2px; }
  .cg-more .cg-act__t { ${VISUALLY_HIDDEN} }
  .cg-more::before { content: "⋯"; }
  ${/* Recap: a segment and up to four buttons. They do not fit one line here, and nothing may run out of the dock. */ ''}
  .cg-head--tools { flex-wrap: wrap; row-gap: 2px; padding-top: 4px; padding-bottom: 3px; }
  .cg-head--tools > .cg-head__sp { display: none; }
  .cg-head--tools > .cg-head__acts { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) { .cg-sheet { animation: none; } }
`;

export const DOCK_STYLE: StyleSource = { id: 'cg-dock', css: DOCK_CSS };
