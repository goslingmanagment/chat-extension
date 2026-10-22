// Styles of Recap and Review (ui-design §4.11), adopted when their chunk
// loads. They read as the old Fansly client's report (2026-10-20, the owner's
// reference): in the window a head with the score's badge and the fan's name
// in the serif; the text in a dashed document of the draft's fill, its blocks
// under mono headings with a dot of their colour — the verdict on terracotta,
// «что работает» on green, the numbered mistakes each with «Как надо было» on
// paper. What the AI wrote is set in the serif of a draft. The facts row, the
// picker. `--cg-lead` is where a sheet's text starts: 12 px in the dock, the
// gutter elsewhere (the panel of a fan, the window of «Развернуть ↗»).

import { type StyleSource } from '../../kit';

export const ANALYSIS_CSS = `
.cg-rhead { flex: none; display: flex; align-items: center; gap: 14px; min-width: 0; padding: 14px 10px 13px 18px; border-bottom: 1px solid var(--cg-rule); }
.cg-rhead__t { display: grid; gap: 1px; min-width: 0; }
.cg-rhead__k { font-family: var(--cg-mono); font-size: var(--cg-text-2xs); line-height: 16px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cg-ink-muted); }
.cg-rhead__h { margin: 0; font-family: var(--cg-serif); font-size: var(--cg-text-3xl); line-height: 1.2; font-weight: 700; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-rhead__sub { font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-rhead__line { display: flex; align-items: center; min-width: 0; margin-top: 2px; }
.cg-rhead > .cg-spin { flex: none; }
${/* Under the title (Recap's «Коротко | Полностью»): the fan's name keeps the head's width, the buttons theirs. */ ''}
.cg-rhead__tools { display: inline-flex; align-items: center; justify-self: start; margin-top: 6px; }
.cg-rhead > .cg-head__acts { align-self: center; }
.cg-score {
  flex: none; display: inline-flex; align-items: baseline; justify-content: center; font-family: var(--cg-mono); font-variant-numeric: tabular-nums; font-weight: 600;
  background: var(--cg-sunk); color: var(--cg-ink-strong); box-shadow: inset 0 0 0 1px var(--cg-rule-2);
}
.cg-score__of { font-weight: 500; opacity: 0.62; }
.cg-score--lg { align-items: center; flex-direction: column; justify-content: center; width: 52px; height: 52px; border-radius: var(--cg-r-lg); font-size: 26px; line-height: 26px; }
.cg-score--lg .cg-score__of { font-size: var(--cg-text-2xs); line-height: 12px; letter-spacing: 0.04em; }
.cg-score--sm { height: 22px; padding: 0 7px; border-radius: var(--cg-r-sm); font-size: var(--cg-text-lg); line-height: 22px; }
.cg-score--sm .cg-score__of { font-size: var(--cg-text-xs); }
.cg-score[data-cg-tier="top"] { background: var(--cg-good-fill); color: #fff; box-shadow: none; }
.cg-score[data-cg-tier="good"] { background: var(--cg-good-bg); color: var(--cg-good-ink); box-shadow: inset 0 0 0 1px var(--cg-good-line); }
.cg-score[data-cg-tier="mid"] { background: var(--cg-amber-bg); color: var(--cg-amber-ink); box-shadow: inset 0 0 0 1px var(--cg-amber-line); }
.cg-score[data-cg-tier="low"] { background: color-mix(in srgb, var(--cg-warn-ink) 14%, transparent); color: var(--cg-warn-ink); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cg-warn-ink) 30%, transparent); }
.cg-score[data-cg-tier="poor"] { background: var(--cg-bad-bg); color: var(--cg-bad-ink); box-shadow: inset 0 0 0 1px var(--cg-bad-line); }
.cg-doc {
  display: grid; gap: 14px; margin: 10px 12px 12px; padding: 14px 16px 16px; border: 1px dashed var(--cg-clay-line); border-radius: var(--cg-r-xl); background: var(--cg-draft);
  font-family: var(--cg-serif); font-size: var(--cg-text-ai); line-height: var(--cg-leading-ai); color: var(--cg-ink);
}
.cg-doc .cg-md { font-family: var(--cg-serif); font-size: var(--cg-text-ai); line-height: var(--cg-leading-ai); }
.cg-doc .cg-md strong { font-weight: 700; }
.cg-raw { white-space: pre-wrap; overflow-wrap: anywhere; max-width: 72ch; }
.cg-rsec { display: grid; gap: 7px; min-width: 0; }
.cg-rsec + .cg-rsec:not(.is-tinted) { padding-top: 13px; border-top: 1px solid var(--cg-rule-2); }
.cg-rsec.is-tinted + .cg-rsec:not(.is-tinted) { border-top: 0; padding-top: 0; }
.cg-rsec.is-tinted { padding: 12px 14px 13px; border-radius: var(--cg-r-xl); }
.cg-rsec.is-tinted.is-clay { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); }
.cg-rsec.is-tinted.is-good { background: var(--cg-good-bg); box-shadow: inset 0 0 0 1px var(--cg-good-line); }
.cg-rsec[data-cg-section="verdict"] .cg-rsec__b { font-size: calc(var(--cg-text-ai) + 1px); }
.cg-rsec__h {
  display: flex; align-items: center; gap: 7px; margin: 0; font-family: var(--cg-mono); font-size: var(--cg-text-xs); line-height: 16px; font-weight: 600;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--cg-ink-2);
}
.cg-rsec__dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--cg-bar-strong); }
.cg-rsec.is-clay .cg-rsec__dot { background: var(--cg-clay-ink); }
.cg-rsec.is-good .cg-rsec__dot { background: var(--cg-good-ink); }
.cg-rsec.is-amber .cg-rsec__dot { background: var(--cg-amber-ink); }
.cg-rsec.is-bad .cg-rsec__dot { background: var(--cg-bad-ink); }
.cg-rsec__b { min-width: 0; }
.cg-rsec__b > * + * { margin-top: 8px; }
.cg-ritems { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.cg-rv-item { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 4px; }
.cg-rv-item__n { justify-self: end; padding-right: 4px; font-family: var(--cg-mono); font-size: var(--cg-text-sm); font-weight: 600; color: var(--cg-ink-2); line-height: var(--cg-leading-ai); }
.cg-rsec.is-bad .cg-rv-item__n { color: var(--cg-bad-ink); }
.cg-rv-item__b { min-width: 0; }
.cg-rv-item__b > * + * { margin-top: 8px; }
.cg-rv-ex { display: grid; gap: 4px; padding: 9px 12px 10px; border: 1px dashed var(--cg-clay-line); border-radius: var(--cg-r-lg); background: var(--cg-raised); }
.cg-rv-ex__k { font-family: var(--cg-mono); font-size: var(--cg-text-2xs); line-height: 14px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cg-clay-ink); }
.cg-rv-where { text-transform: none; letter-spacing: 0.02em; font-weight: 500; color: var(--cg-ink-muted); }
.cg-rv-ex__t { font-family: var(--cg-serif); font-size: var(--cg-text-ai); line-height: var(--cg-leading-ai); color: var(--cg-ink-strong); white-space: pre-wrap; overflow-wrap: anywhere; max-width: 72ch; }
.cg-facts {
  flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 14px; min-height: 30px; padding: 4px 6px 4px var(--cg-lead, var(--cg-gutter));
  border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-muted);
}
.cg-fact { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.cg-fact > .cg-dot, .cg-fact > .cg-ico, .cg-fact > .cg-spin { flex: none; }
.cg-fact.is-strong { color: var(--cg-ink-strong); font-weight: 500; }
.cg-fact__code { font-weight: 500; color: var(--cg-ink-2); }
.cg-facts .cg-fact__btn { margin-left: -10px; }
.cg-pick { display: grid; grid-template-columns: var(--cg-lead, calc(var(--cg-gutter) - 1px)) minmax(0, 1fr); padding: 10px 10px 10px 0; }
.cg-pick:focus-visible { outline: none; border-radius: 0; box-shadow: inset 2px 0 0 var(--cg-focus); }
.cg-pick__note { color: var(--cg-ink-2); }
.cg-pick__explain { max-width: 64ch; font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-muted); }
.cg-pick__slot { display: flex; align-items: center; gap: 10px; min-height: 28px; }
.cg-pick__name { font-weight: 500; color: var(--cg-ink); }
.cg-pick__age { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); margin-right: auto; }
.cg-pick__acts { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 0; }
.cg-pick__first:not([aria-disabled="true"]) { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); font-weight: 600; }
.cg-pick__first:not([aria-disabled="true"]):hover { box-shadow: inset 0 0 0 1px var(--cg-clay-ink); }
.cg-copy-all.is-done { color: var(--cg-good-ink); }
.cg-pick__note + .cg-pick__slot { margin-top: 4px; }
@container cg (max-width: 560px) {
  .cg-rhead { flex-wrap: wrap; row-gap: 8px; padding-left: 14px; }
  .cg-rhead > .cg-head__sp { display: none; }
  .cg-rhead > .cg-head__acts { margin-left: auto; }
  .cg-doc { margin: 8px; padding: 12px 12px 14px; }
}
`;

export const ANALYSIS_STYLE: StyleSource = { id: 'cg-dock-analysis', css: ANALYSIS_CSS };
