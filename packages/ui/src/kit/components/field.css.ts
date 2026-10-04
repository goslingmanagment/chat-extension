// The sheet of the text fields, apart from the components: the kit's base sheet carries
// every component's CSS, while these components are used only by lazy chunks
// (Coach, the settings). A module is one unit for the bundler, so CSS in the components'
// module would pull them into the first dock chunk (architecture.md §11).

export const FIELD_CSS = `
.cg-field {
  display: block; width: 100%; min-width: 0; padding: 7px 10px; border: 1px solid var(--cg-input-border); border-radius: var(--cg-r-md);
  background: var(--cg-input-bg); color: var(--cg-ink); font: inherit; font-size: var(--cg-text-base); line-height: 18px; outline: 0;
}
.cg-field--area { resize: none; overflow-y: hidden; }
.cg-field::placeholder { color: var(--cg-ink-muted); opacity: 1; }
.cg-field:focus, .cg-field:focus-visible { outline: 0; border-color: var(--cg-rule-3); box-shadow: 0 0 0 2px var(--cg-focus-soft); border-radius: var(--cg-r-md); }
.cg-field[aria-disabled="true"] { color: var(--cg-ink-faint); }
.cg-search {
  display: flex; align-items: center; gap: 8px; width: 260px; max-width: 100%; height: 32px; padding: 0 10px; flex: none;
  border: 1px solid var(--cg-input-border); border-radius: var(--cg-r-md); background: var(--cg-input-bg); color: var(--cg-ink-muted); cursor: text;
}
.cg-search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; font: inherit; color: var(--cg-ink); padding: 0; appearance: none; }
.cg-search input::-webkit-search-cancel-button { display: none; }
.cg-search input::placeholder { color: var(--cg-ink-muted); opacity: 1; }
.cg-search input:focus-visible { outline: none; }
.cg-search:focus-within { border-color: var(--cg-rule-3); box-shadow: 0 0 0 2px var(--cg-focus-soft); }
`;
