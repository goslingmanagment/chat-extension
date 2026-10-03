// @cg/testing/stand — the ChatSpace-like stand (architecture.md §12, R02): the
// fixture app's loopback stand server, the egress sink and the synthetic
// dataset. Its own entry, apart from the package root, because the stand
// stays out of the AMO sources archive (apps/extension/build/sources-archive.ts)
// and nothing that travels there may import it.

export { startStandServer, STRICT_STAND_CSP, type StandServer, type StandServerOptions } from '../stand-server';
export { createDataset, STAND_IDS, type StandAccount, type StandChat, type StandDataset, type StandFan, type StandMessage } from './dataset';
export { egressHost, egressProxyPrefs, startEgressSink, type EgressAttempt, type EgressPage, type EgressSink } from './egress-sink';
export { E2E_EVIDENCE_DIR, FIXTURE_BUILD_DIR, FIXTURE_SOURCE_DIR } from './paths';
export type { CallOrigin, PageJournalEntry, SendOutcome, ServerJournalEntry, ServerJournalPage, StandBreak, StandControl } from '../../fixture-chatspace/src/protocol';
