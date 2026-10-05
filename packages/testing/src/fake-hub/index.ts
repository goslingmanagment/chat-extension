// @cg/testing/fake-hub — the fake hub (architecture.md §12 п. 2, R02): every
// route of the contracts' hub route table behind the hub's checks, a stateful
// model with scenario scripts switchable per test, SSE with controllable
// timing and failures, auth and the narrow token, the claim/custody
// automaton, and a request journal. In-process (`createFakeHub().fetch`) for
// unit tests, loopback (`startFakeHub`) for e2e.

export { FakeHub, createFakeHub, hubErrorBody, FAKE_HUB_CONTROL_HEADER, FAKE_HUB_CONTROL_PREFIX, type FakeHubOptions } from './hub';
export { startFakeHub, type FakeHubServer, type FakeHubServerOptions } from './server';
export { fakeHubControl, type FakeHubControlClient } from './control-client';
export { checkCommand } from './command';
export { callsTo, describeCalls, forbiddenCalls, invalidCalls, journalViolations, JOURNAL_KEPT_STRING_KEYS, redact, unscriptedCalls } from './journal';
export { AI_CAPABILITIES_HEADER, FORBIDDEN_OPERATION_ROUTES, FORBIDDEN_ROUTE_FAMILIES, facadeRequestOf, matchRoute, routePath, validateRequest, WIRE_SPECS, wireOf, type WireCall } from './routing';
export { DEFAULT_PRESET, FAKE_PAGES, PILOT_CAPABILITIES, bootstrapOf, featureVerdict, pilotPageFlags, presetConfig, type FakeHubConfig, type FakePage } from './config';
export { FAKE_USERS, SIGN_IN_FAILURES_PER_MINUTE, type FakeUser } from './auth';
export { DEFAULT_CATALOG, generationText } from './ai';
export { streamBodyRefusal, type BodySchemaLike, type StreamBodyRefusal } from './ai-rules';
export { sseFrameText, SSE_HEARTBEAT } from './sse';
export { hubCall, readSse, type FetchLike, type HubCallOptions, type SseRead } from './kit';
export { FakeHubClock, iso } from './clock';
export type * from './types';
