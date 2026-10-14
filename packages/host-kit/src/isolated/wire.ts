// Bridge constants the isolated side of every site needs synchronously at
// document_start. They live in @cg/contracts/bridge, a schema module:
// importing even a constant from it builds its schemas at startup (zod/mini
// builders are not pure-annotated), which the early start cannot afford (§11,
// spike M0). So the handshake and the transport's own refusals are repeated
// here and pinned to the contracts by wire.test.ts; the schemas themselves
// load lazily (validation.ts). What belongs to one host's registry — its
// writes, the events that are never coalesced, the outcome of a write that
// may have run — is that host's own early copy (ChatSpace:
// host-chatspace/src/isolated/wire.ts).

import type { BridgeError } from '@cg/contracts/bridge';

/** contracts BRIDGE_PROTOCOL_VERSION. */
export const PROTOCOL_VERSION = 1;
/** contracts BRIDGE_TAG_KEY: the handshake message's key for its tag. */
export const TAG_KEY = 'tag';
/** contracts BRIDGE_TAGS. */
export const TAGS = { mainReady: 'main-ready', isoHello: 'iso-hello', connect: 'connect' } as const;
/** contracts BRIDGE_ERRORS_BEFORE_EXECUTION: a write refused with one of these did not happen. */
export const ERRORS_BEFORE_EXECUTION: readonly BridgeError[] = ['unknown-request', 'bad-request', 'not-ready', 'identity-mismatch', 'stale-document', 'disabled'];
