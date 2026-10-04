// Styles of Recap and Review (ui-design §4.11), adopted when their chunk
// loads: the paragraph and the blocks (a 128 px heading column, the heading
// above the text at 560 px and narrower), the facts row, the picker.

import { type StyleSource } from '../../kit';

export const ANALYSIS_CSS = `
.cg-prose { display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr); padding: 10px 12px 12px 0; }
.cg-raw { font-size: var(--cg-text-lg); line-height: 21px; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 72ch; }
.cg-blocks { display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr); padding: 2px 12px 8px 0; }
.cg-block { grid-column: 2; display: grid; grid-template-columns: 128px minmax(0, 1fr); gap: 2px 16px; padding: 8px 0; border-top: 1px solid var(--cg-rule); }
.cg-block:first-child { border-top: 0; }
.cg-block > b { font-weight: 600; color: var(--cg-ink-strong); font-size: var(--cg-text-base); line-height: 20px; }
.cg-block .cg-md { line-height: 20px; }
.cg-block__main { min-width: 0; }
.cg-block__main > * + * { margin-top: 6px; }
.cg-rv-ex { margin-top: 4px; padding-left: 10px; border-left: 1px solid var(--cg-rule-3); }
.cg-rv-ex__t { font-size: var(--cg-text-lg); line-height: 20px; color: var(--cg-ink-2); white-space: pre-wrap; overflow-wrap: anywhere; max-width: 72ch; }
.cg-rv-item > * + * { margin-top: 4px; }
.cg-facts {
  flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 14px; min-height: 30px; padding: 4px 6px 4px var(--cg-gutter);
  border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-muted);
}
.cg-fact { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.cg-fact > .cg-dot, .cg-fact > .cg-ico, .cg-fact > .cg-spin { flex: none; }
.cg-fact.is-strong { color: var(--cg-ink-strong); font-weight: 500; }
.cg-fact__code { font-weight: 500; color: var(--cg-ink-2); }
.cg-facts .cg-fact__btn { margin-left: -10px; }
.cg-pick { display: grid; grid-template-columns: calc(var(--cg-gutter) - 1px) minmax(0, 1fr); padding: 10px 10px 10px 0; }
.cg-pick:focus-visible { outline: none; border-radius: 0; box-shadow: inset 2px 0 0 var(--cg-focus); }
.cg-pick__note { color: var(--cg-ink-2); }
.cg-pick__slot { display: flex; align-items: center; gap: 10px; min-height: 28px; }
.cg-pick__name { font-weight: 500; color: var(--cg-ink); }
.cg-pick__age { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); margin-right: auto; }
.cg-pick__acts { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 0 -8px; }
.cg-pick__note + .cg-pick__slot { margin-top: 4px; }
.cg-bare :is(.cg-block, .cg-facts) { border-color: var(--cg-bare-rule); }
@container cg (max-width: 560px) {
  .cg-block { grid-template-columns: minmax(0, 1fr); }
}
`;

export const ANALYSIS_STYLE: StyleSource = { id: 'cg-dock-analysis', css: ANALYSIS_CSS };
