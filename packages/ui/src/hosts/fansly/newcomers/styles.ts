// The look of what only Fansly's «Новые фоловеры» has (X59; ui-design §3.12), in the family's window and card every site
// shares (ui/newcomers frame.css.ts, card.css.ts): the pass's «Пауза», the pause Fansly asked for, why the pass stopped
// or the list failed. Every size is a token, so «Крупнее» scales the window.

export const FANSLY_NEWCOMERS_CSS = `
.cg-fnw__run { flex: none; }
.cg-fnw__cool { color: var(--cg-ink-strong); font-weight: 500; }
.cg-fnw__stopped { flex: none; padding: 6px 16px 8px 22px; border-bottom: 1px solid var(--cg-rule); }
.cg-fnw__failed { flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 18px 22px; max-width: 72ch; }
.cg-fnw__hint2 { margin: 0; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); }
.cg-fnw__looking { display: inline-flex; align-items: center; gap: 8px; }
`;
