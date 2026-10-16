/** The same result mark in the dock, analysis windows and fan panel. */
export const STALE_ROW_CSS = `
.cg-stale {
  display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; min-height: 34px; margin: 8px 8px 0; padding: 3px 4px 3px 2px;
  border-radius: 9px; background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); font-size: var(--cg-text-sm2);
}
.cg-stale > .cg-gut { width: 22px; }
.cg-stale__t { color: var(--cg-ink-2); }
.cg-stale__t b { color: var(--cg-ink-strong); font-weight: 600; }
`;

export const STALE_ROW_NARROW_CSS = `
  .cg-stale { grid-template-columns: 22px minmax(0, 1fr); row-gap: 4px; padding-bottom: 6px; }
  .cg-stale > .cg-btn { grid-column: 2; justify-self: start; }
`;
