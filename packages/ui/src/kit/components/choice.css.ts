// The sheet of Segmented, Checkbox and Tabs, apart from the components: the kit's base sheet carries
// every component's CSS, while these components are used only by lazy chunks
// (Recap, Coach, the settings). A module is one unit for the bundler, so CSS in the components'
// module would pull them into the first dock chunk (architecture.md §11).

export const CHOICE_CSS = `
.cg-seg { display: inline-flex; align-items: center; flex: none; padding: 2px; border-radius: 7px; box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
.cg-seg__b { height: 22px; padding: 0 8px; border-radius: 5px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; }
.cg-seg--md { border-radius: var(--cg-r-md); }
.cg-seg--md .cg-seg__b { height: 28px; padding: 0 12px; border-radius: var(--cg-r-sm); font-size: inherit; }
.cg-seg__b:hover { color: var(--cg-ink); }
.cg-seg__b[aria-pressed="true"] { background: var(--cg-seg-on); color: var(--cg-ink-strong); font-weight: 500; }
.cg-seg__b[aria-disabled="true"] { color: var(--cg-ink-faint); cursor: default; }
.cg-check {
  display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 7px; flex: none; border-radius: var(--cg-r-sm);
  color: var(--cg-ink-2); font-weight: 500; white-space: nowrap;
}
.cg-check[aria-pressed="true"], .cg-check[aria-checked="true"] { color: var(--cg-ink-strong); }
.cg-check:hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-check[aria-disabled="true"] { color: var(--cg-ink-faint); background: none; cursor: default; }
.cg-check--14 { gap: 8px; height: 28px; padding: 0; }
.cg-check--14:hover { background: none; }
.cg-tabs { display: flex; align-items: center; gap: 2px; min-width: 0; }
.cg-tab { height: 28px; padding: 0 10px; border-radius: var(--cg-r-md); color: var(--cg-ink-muted); white-space: nowrap; flex: none; }
.cg-tab:hover { background: var(--cg-hover); color: var(--cg-ink); }
.cg-tab[aria-selected="true"] { background: var(--cg-hover); color: var(--cg-ink-strong); font-weight: 500; }
.cg-tab[aria-disabled="true"] { color: var(--cg-ink-faint); background: none; cursor: default; }
`;
