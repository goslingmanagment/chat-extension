// `--cg-*` tokens (§10.1 «Тема»). R13 derives them from the host's
// `--color-om-*` variables ("R G B" triplets; only names ChatSpace defines —
// the stand's palette test checks) and the `dark` class; R00 uses the light
// steps with neutral fallbacks.

export const BASE_TOKENS_CSS = `
:host {
  --cg-bg: rgb(var(--color-om-neutral-0, 255 255 255));
  --cg-fg: rgb(var(--color-om-neutral-900, 31 35 40));
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
