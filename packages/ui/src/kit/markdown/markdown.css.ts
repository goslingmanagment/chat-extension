// The Markdown sheet, apart from the renderer: the kit's base sheet carries
// every component's CSS, while the parser and the renderer are used only by
// lazy chunks (Recap, Review, Coach). A module is one unit for the bundler,
// so the CSS in the renderer's module would pull both into the first dock
// chunk (architecture.md §11).

export const MARKDOWN_CSS = `
.cg-md { font-size: var(--cg-text-lg); line-height: 21px; color: var(--cg-ink); overflow-wrap: anywhere; }
.cg-md > * + * { margin-top: 8px; }
.cg-md p, .cg-md li { max-width: 72ch; }
.cg-md p, .cg-md h3, .cg-md h4, .cg-md h5, .cg-md ul, .cg-md ol, .cg-md pre, .cg-md blockquote { margin-bottom: 0; }
.cg-md h3, .cg-md h4, .cg-md h5 { margin: 12px 0 0; font-size: var(--cg-text-base); line-height: 20px; font-weight: 600; color: var(--cg-ink-strong); }
.cg-md > h3:first-child, .cg-md > h4:first-child, .cg-md > h5:first-child { margin-top: 0; }
.cg-md ul, .cg-md ol { margin-top: 8px; padding-left: 20px; }
.cg-md li + li { margin-top: 2px; }
.cg-md li > * + * { margin-top: 4px; }
.cg-md strong { font-weight: 600; color: var(--cg-ink-strong); }
.cg-md em { font-style: normal; font-weight: 500; }
.cg-md code { font-family: var(--cg-mono); font-size: 0.86em; padding: 0 3px; border-radius: var(--cg-r-xs); background: var(--cg-sunk); }
.cg-md pre { padding: 8px 10px; border-radius: var(--cg-r-md); background: var(--cg-sunk); overflow-x: auto; white-space: pre; }
.cg-md pre code { padding: 0; background: none; font-size: var(--cg-text-xs); line-height: 16px; }
.cg-md blockquote { margin: 8px 0 0; padding-left: 10px; border-left: 1px solid var(--cg-rule-3); color: var(--cg-ink-2); }
.cg-md hr { border: 0; border-top: 1px solid var(--cg-rule); margin: 12px 0 0; }
.cg-md a { color: inherit; text-decoration: underline; text-decoration-color: var(--cg-rule-3); text-underline-offset: 2px; }
.cg-md a:hover { text-decoration-color: currentColor; }
.cg-md .cg-money { font-family: var(--cg-mono); font-variant-numeric: tabular-nums; font-size: 0.93em; font-weight: 600; color: var(--cg-ink-strong); }
.cg-md .cg-quote { color: var(--cg-clay-ink); }
`;
