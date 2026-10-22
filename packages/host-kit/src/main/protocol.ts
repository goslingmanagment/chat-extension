// Literal copies of the @cg/contracts constants the MAIN boot works with
// (bridge.ts). MAIN must not import anything, so the values are repeated here
// and pinned to their source by protocol.test.ts. A host's own literals — its
// requests and events, its limits, its host contract — live in its own
// package and are pinned there (host-chatspace/src/main/protocol.ts).
//
// Three values here are still the first host's registry by value:
// WRITE_REQUESTS, STATE_EVENTS and WS_TAP_KEY are ChatSpace's writes, its
// state events and the hand-off key of its tap script. The boot moved here
// byte for byte (R20 P5, docs/project-unite/architecture.md §6), and it
// imports nothing, so what it reads by name moved with it; handing the lists
// in per host would cost bytes in a MAIN bundle that has none to spare. A
// host with another registry is not touched by them: it names none of these
// requests and events, coalesces its states in its own emitter, and when its
// tap is part of its MAIN script `probe` answers `wsTap: false`.

export const PROTOCOL_VERSION = 1;
/** contracts BRIDGE_TAG_KEY: the handshake message's key for its tag. */
export const TAG_KEY = 'tag';
export const TAG_MAIN_READY = 'main-ready';
export const TAG_ISO_HELLO = 'iso-hello';
export const TAG_CONNECT = 'connect';
/** Page-visible names never name the extension (decision X22). */
export const WS_TAP_KEY = 'wsTap';
/** Symbol.for key of the boot's one-shot hook for a runtime from a later MAIN script (bridge.ts). */
export const RUNTIME_KEY = 'mainRuntime';

/** Envelope kinds (contracts BridgeRequestSchema / BridgeResponseSchema / BridgeEventSchema). */
export const KIND_REQ = 'req';
export const KIND_RES = 'res';
export const KIND_EVT = 'evt';
/** The event that carries a guarded failure's count (guard.ts; contracts FROM_MAIN.fault). */
export const EVT_FAULT = 'fault';

/** contracts BRIDGE_ERRORS. */
export const ERR_UNKNOWN_REQUEST = 'unknown-request';
export const ERR_BAD_REQUEST = 'bad-request';
export const ERR_NOT_READY = 'not-ready';
export const ERR_IDENTITY = 'identity-mismatch';
export const ERR_STALE_DOCUMENT = 'stale-document';
export const ERR_DISABLED = 'disabled';
export const ERR_INTERNAL = 'internal';

/** contracts BRIDGE_WRITE_REQUESTS: deduplicated by request id. */
export const WRITE_REQUESTS: readonly string[] = ['insertGuarded', 'navigate', 'previewSendCommit', 'attachFile'];

/** §5.3: UI events at most 50 per second per type; extra ones coalesce (the latest wins). */
export const UI_EVENT_GAP_MS = 20;
/**
 * Events that carry a state: one equal to the last sent is not repeated. The
 * others (`accounts`, `chatCache`) are signals — «read again» — and always go out.
 */
export const STATE_EVENTS: readonly string[] = ['route', 'composer', 'contract'];
/** A hidden tab gets no animation frames: a timer stands in for «one frame». */
export const FRAME_FALLBACK_MS = 100;
/** Write results kept for deduplication by request id. */
export const WRITE_MEMORY = 64;
