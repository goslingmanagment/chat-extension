// The constants of ChatSpace's bridge registry the isolated side needs
// synchronously at document_start. They live in @cg/contracts/bridge, a
// schema module: importing even a constant from it builds its schemas at
// startup (zod/mini builders are not pure-annotated), which the early start
// cannot afford (§11, spike M0). So ChatSpace's writes, its events that are
// never coalesced and its write-failure rules are repeated here and pinned to
// the contracts by main/protocol.test.ts; the schemas themselves load lazily
// (validate.ts). The handshake's own constants, the same for every site, are
// in @cg/host-kit/isolated/wire.ts.

import type { ToMainType } from '@cg/contracts/bridge';
import type { CgCode } from '@cg/contracts/errors';

/** contracts BRIDGE_WRITE_REQUESTS. */
export const WRITE_REQUESTS: readonly ToMainType[] = ['insertGuarded', 'navigate', 'previewSendCommit', 'attachFile'];
/** contracts BRIDGE_UNDROPPABLE_EVENTS: never coalesced or dropped. */
export const UNDROPPABLE_EVENTS: readonly string[] = ['incoming', 'coverage', 'humanSend', 'previewSendState', 'previewSendFuse', 'fault'];
/** contracts BRIDGE_WRITE_FAILURES: the fixed outcome of a write that may have run (timeout, lost answer, `internal`). */
export const WRITE_FAILURES = {
  insertGuarded: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' },
  navigate: { state: 'failed', code: 'CG-NAV-TIMEOUT', insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } },
  previewSendCommit: { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' },
  attachFile: { state: 'unknown' },
} as const satisfies Record<'insertGuarded' | 'navigate' | 'previewSendCommit' | 'attachFile', { readonly state: string; readonly code?: CgCode; readonly insert?: { readonly state: string; readonly code: CgCode } }>;
