// Bridge constants the isolated side needs synchronously at document_start.
// They live in @cg/contracts/bridge, a schema module: importing even a
// constant from it builds its schemas at startup (zod/mini builders are not
// pure-annotated), which the early start cannot afford (§11, spike M0). So
// the handshake and the write-failure rules are repeated here and pinned to
// the contracts by wire.test.ts; the schemas themselves load lazily
// (validate.ts).

import type { BridgeError, ToMainType } from '@cg/contracts/bridge';
import type { CgCode } from '@cg/contracts/errors';

/** contracts BRIDGE_PROTOCOL_VERSION. */
export const PROTOCOL_VERSION = 1;
/** contracts BRIDGE_TAGS. */
export const TAGS = { mainReady: 'main-ready', isoHello: 'iso-hello', connect: 'connect' } as const;
/** contracts BRIDGE_ERRORS_BEFORE_EXECUTION: a write refused with one of these did not happen. */
export const ERRORS_BEFORE_EXECUTION: readonly BridgeError[] = ['unknown-request', 'bad-request', 'not-ready', 'identity-mismatch', 'stale-document', 'disabled'];
/** contracts BRIDGE_WRITE_REQUESTS. */
export const WRITE_REQUESTS: readonly ToMainType[] = ['insertGuarded', 'navigate', 'previewSendCommit'];
/** contracts BRIDGE_UNDROPPABLE_EVENTS: never coalesced or dropped. */
export const UNDROPPABLE_EVENTS: readonly string[] = ['incoming', 'coverage', 'humanSend', 'previewSendState'];
/** contracts BRIDGE_WRITE_FAILURES: the fixed outcome of a write that may have run (timeout, lost answer, `internal`). */
export const WRITE_FAILURES = {
  insertGuarded: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' },
  navigate: { state: 'failed', code: 'CG-NAV-TIMEOUT', insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } },
} as const satisfies Record<'insertGuarded' | 'navigate', { readonly state: string; readonly code: CgCode; readonly insert?: { readonly state: string; readonly code: CgCode } }>;
