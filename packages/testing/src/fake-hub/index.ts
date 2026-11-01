// @cg/testing/fake-hub — the fake hub (architecture.md §12 п. 2, R02): every
// route of the contracts' hub route table behind the hub's checks, a stateful
// model with scenario scripts switchable per test, SSE with controllable
// timing and failures, auth and the narrow token, the claim/custody
// automaton, and a request journal. In-process (`createFakeHub().fetch`) for
// unit tests, loopback (`startFakeHub`) for e2e.

export { FakeHub, FakeHubConnectionDrop, createFakeHub, hubErrorBody, FAKE_HUB_CONTROL_HEADER, FAKE_HUB_CONTROL_PREFIX, type FakeHubOptions } from './hub';
export { startFakeHub, type FakeHubServer, type FakeHubServerOptions } from './server';
export { fakeHubControl, type FakeHubControlClient } from './control-client';
export { checkCommand } from './command';
export { OutreachModel } from './outreach';
export { type OutreachSeed, type OutreachTouchSeed } from './types';
export { callsTo, describeCalls, forbiddenCalls, invalidCalls, journalViolations, JOURNAL_KEPT_STRING_KEYS, redact, unscriptedCalls } from './journal';
export { AI_CAPABILITIES_HEADER, FORBIDDEN_OPERATION_ROUTES, FORBIDDEN_ROUTE_FAMILIES, facadeRequestOf, matchRoute, routePath, validateRequest, WIRE_SPECS, wireOf, type WireCall } from './routing';
export {
  DEFAULT_PRESET,
  FAKE_PAGES,
  FANSLY_PAGE_FLAGS,
  PILOT_CAPABILITIES,
  bootstrapOf,
  fanslyPageFlags,
  featureVerdict,
  pageFeature,
  pilotPageFlags,
  presetConfig,
  TELEGRAM_PAGE,
  TELEGRAM_PAGE_FLAGS,
  TELEGRAM_PERSONA,
  featureNeedsOn,
  telegramPageFlags,
  telegramWorld,
  type FakeHubConfig,
  type FakePage,
  type FakePlatform,
} from './config';
export { FAKE_USERS, SIGN_IN_FAILURES_PER_MINUTE, type FakeUser } from './auth';
export { DEFAULT_CATALOG, generationText } from './ai';
export {
  aiFeatureRunsOnPlatform,
  classifyPair,
  clientContextBesideRefusal,
  resolveCoverageCheck,
  streamBodyRefusal,
  telegramShapeRefusal,
  type BodySchemaLike,
  type CoverageCheckAnswer,
  type PairState,
  type StreamBodyRefusal,
} from './ai-rules';
export { sseFrameText, SSE_HEARTBEAT } from './sse';
export { hubCall, readSse, type FetchLike, type HubCallOptions, type SseRead } from './kit';
export { FakeHubClock, iso } from './clock';
export {
  FAKE_VOICE_OUTCOMES,
  HUB_VOICE_SCRIPT_MAX_CHARS,
  HUB_VOICE_TAGS,
  VOICE_RENDER_MS,
  VOICE_ROUTES,
  canonicalVoiceScript,
  voiceRequestHash,
  type FakeVoiceOutcome,
  type FakeVoiceOutcomeKind,
  type VoiceNoteSnapshot,
} from './voice';
export { voiceAudioSamples, type VoiceAudioSample } from './voice-audio';
export type * from './types';
