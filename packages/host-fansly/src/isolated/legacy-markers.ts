// Page-visible coexistence markers; no page data or extension API.
export const LEGACY_SELECTOR = '#chatgoose-root, #chatgoose-followers-launcher, style#chatgoose-bootstrap-style, style#chatgoose-style';
export const RELOAD_ATTRIBUTE = 'data-fx-reload';
export const INSTANCE_ATTRIBUTE = 'data-fx-instance';
export type StopReason = 'legacy' | 'update';
export const hasLegacyDom = (doc: Document): boolean => doc.querySelector(LEGACY_SELECTOR) !== null;
