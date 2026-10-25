// @cg/contracts/vm — the UI contract (architecture.md §10.1, §10.2; ui-design
// direction B «strip», X10): view models with their seven view states,
// AppClient and the ViewSelector → ViewOf map, UiAction with the UserOptions
// allowlist and PreferenceKey, ActionReceipt, the action catalog (keys,
// labels, reasons), the I18n port, theme token names and the scheme signal,
// and the mount, toast, clipboard and dialog ports. Type-only except a few
// constant lists and the UiAction schema, so the dock's first chunk pays for
// what it imports only.

export * from './signal';
export * from './i18n';
export * from './theme';
export * from './host-profile';
export * from './selectors';
export * from './actions';
export * from './catalog';
export * from './view';
export * from './result';
export * from './dock';
export * from './analysis';
export * from './batch';
export * from './spenders';
export * from './newcomers';
export * from './outreach';
export * from './preview';
export * from './voice';
export * from './talking';
export * from './media';
export * from './panels';
export * from './pages';
export * from './app-client';
export * from './ports';
