// @cg/testing — stand host, fake hub, e2e harness, data shapes (architecture.md
// §12, R02). Part 1: the ChatSpace-like stand (fixture-chatspace + the loopback
// stand server), the egress sink and the synthetic dataset.

export { startStandServer, STRICT_STAND_CSP, type StandServer, type StandServerOptions } from './stand-server';
export { createDataset, STAND_IDS, type StandAccount, type StandChat, type StandDataset, type StandFan, type StandMessage } from './stand/dataset';
export { egressHost, egressProxyPrefs, startEgressSink, type EgressAttempt, type EgressPage, type EgressSink } from './stand/egress-sink';
export { E2E_EVIDENCE_DIR, FIXTURE_BUILD_DIR, FIXTURE_SOURCE_DIR } from './stand/paths';
export type { CallOrigin, PageJournalEntry, SendOutcome, ServerJournalEntry, ServerJournalPage, StandBreak, StandControl } from '../fixture-chatspace/src/protocol';
