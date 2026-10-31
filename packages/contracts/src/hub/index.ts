// The hub facade and its DTOs (architecture.md §5.8, §8; hub-pr-plan.md §4
// with the critic's corrections). Background-side contract: `@cg/hub`
// implements HubFacade over the vendored SDK; tabs and pages see these DTOs
// only through the tab protocol. No hub paths here (wire.ts).

export * from './wire';
export * from './auth';
export * from './bootstrap';
export * from './ai';
export * from './recaps';
export * from './spenders';
export * from './feed';
export * from './newcomers';
export type * from './claim-body';
export * from './usage';
export * from './attribution';
export * from './note-attribution';
export * from './conversation';
export * from './fan-card';
export * from './fan-marks';
export * from './queue';
export * from './online';
export * from './onlyfans-feed';
export * from './server-tab';
export * from './fan-queues';
export * from './routes';
export * from './registry';
export * from './error-map';
export * from './facade';
