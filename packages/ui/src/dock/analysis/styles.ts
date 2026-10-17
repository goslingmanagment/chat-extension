// Styles of Recap and Review (ui-design §4.11), adopted when their chunk
// loads: the paragraph and the blocks (a 128 px heading column, the heading
// above the text at 560 px and narrower), the facts row, the picker. What the
// AI wrote is set in the serif of a draft; a heading is the accent's ink.
// `--cg-lead` is where a sheet's text starts: 12 px in the dock, the gutter
// elsewhere (the panel of a fan, the window of «Развернуть ↗»).

import { type StyleSource } from '../../kit';

export const ANALYSIS_CSS = `
.cg-prose { display: grid; grid-template-columns: var(--cg-lead, calc(var(--cg-gutter) - 1px)) minmax(0, 1fr); padding: 10px 12px 12px 0; }
.cg-raw { font-family: var(--cg-serif); font-size: var(--cg-text-ai); line-height: var(--cg-leading-ai); white-space: pre-wrap; overflow-wrap: anywhere; max-width: 72ch; }
.cg-blocks { display: grid; grid-template-columns: var(--cg-lead, calc(var(--cg-gutter) - 1px)) minmax(0, 1fr); padding: 2px 12px 8px 0; }
.cg-block { grid-column: 2; display: grid; grid-template-columns: 128px minmax(0, 1fr); gap: 2px 16px; padding: 8px 0; border-top: 1px solid var(--cg-rule); }
.cg-block:first-child { border-top: 0; }
.cg-block > b { font-weight: 600; color: var(--cg-clay-ink); font-size: var(--cg-text-sm); line-height: 21px; }
.cg-block .cg-md { font-family: var(--cg-serif); font-size: var(--cg-text-ai); line-height: var(--cg-leading-ai); }
.cg-block__main { min-width: 0; }
.cg-block__main > * + * { margin-top: 6px; }
.cg-rv-ex { margin-top: 4px; padding: 5px 10px 6px; border: 1px dashed var(--cg-clay-line); border-radius: 9px; background: var(--cg-draft); }
.cg-rv-ex__t { font-family: var(--cg-serif); font-size: var(--cg-text-ai); line-height: var(--cg-leading-ai); color: var(--cg-ink); white-space: pre-wrap; overflow-wrap: anywhere; max-width: 72ch; }
.cg-rv-item > * + * { margin-top: 4px; }
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
.cg-pick__slot { display: flex; align-items: center; gap: 10px; min-height: 28px; }
.cg-pick__name { font-weight: 500; color: var(--cg-ink); }
.cg-pick__age { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); margin-right: auto; }
.cg-pick__acts { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 0; }
.cg-pick__note + .cg-pick__slot { margin-top: 4px; }
@container cg (max-width: 560px) {
  .cg-block { grid-template-columns: minmax(0, 1fr); }
}
`;

export const ANALYSIS_STYLE: StyleSource = { id: 'cg-dock-analysis', css: ANALYSIS_CSS };
