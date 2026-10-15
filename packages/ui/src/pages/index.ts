// ui/pages — the extension pages (architecture.md §9.9; ui-design §3.10,
// §4.23, §4.24, §10; R16): the popup, the options page with its eight
// sections and the sign-in screen, the prompt echo and the journals. A
// page's composition root builds the AppClient with core's
// `createPagesClient` and calls one of the mount functions; nothing here
// touches `browser.*`, the network or storage.

export { journalOfHash, mountDebugJournal, mountDebugPrompt, mountOptions, mountPopup, type OptionsPageDeps, type PageDeps } from './pages';
export { type OptionsRoute } from './options/Options';
export { type OptionsSlots } from './options/slots';
export { JOURNAL_PAGE_SIZE, JOURNAL_REFRESH_MS } from './debug/Journal';
export { PAGES_CSS, PAGES_SOURCE } from './styles';
export { FONTS_SOURCE } from './brand/fonts';
