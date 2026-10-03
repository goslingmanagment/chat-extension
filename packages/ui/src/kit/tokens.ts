// `--cg-*` tokens (§10.1 «Тема»). R13 derives them from the host's
// `--color-om-*` variables and the `dark` class; R00 uses neutral fallbacks.

export const BASE_TOKENS_CSS = `
:host {
  --cg-bg: var(--color-om-surface, #ffffff);
  --cg-fg: var(--color-om-text, #1f2328);
  --cg-muted: #6b7280;
  --cg-border: rgba(127, 127, 127, 0.28);
  --cg-accent: #3b6df2;
  --cg-radius: 8px;
  --cg-font: inherit;
  all: initial;
  display: block;
  font-family: var(--cg-font);
  color: var(--cg-fg);
}
`;
