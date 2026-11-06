// Page-visible coexistence markers; no page data or extension API.
export const LEGACY_SELECTOR = '#chatgoose-root, #chatgoose-followers-launcher, style#chatgoose-bootstrap-style, style#chatgoose-style';
export const RELOAD_ATTRIBUTE = 'data-fx-reload';
export const INSTANCE_ATTRIBUTE = 'data-fx-instance';
export type StopReason = 'legacy' | 'update';
// One selector each takes Gecko's id-table path; a list walks the whole page.
const LEGACY_SELECTORS = LEGACY_SELECTOR.split(', ');
export const hasLegacyDom = (doc: Document): boolean => LEGACY_SELECTORS.some((selector) => doc.querySelector(selector) !== null);
