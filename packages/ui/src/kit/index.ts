// ui/kit — the base every surface builds on (architecture.md §10.1, R13):
// tokens, theme, focus, styles. R00 ships the style adoption helper and the
// first tokens. Rules: no browser.*, no fetch, no host DOM, no SDK (§4).

export { adoptStyles, type StyleMode } from './styles';
export { BASE_TOKENS_CSS } from './tokens';
