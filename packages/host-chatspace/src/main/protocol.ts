// Literal copies of @cg/contracts bridge constants. MAIN must not import
// anything, so the values are repeated here and pinned by protocol.test.ts.

export const PROTOCOL_VERSION = 1;
export const TAG_MAIN_READY = 'main-ready';
export const TAG_ISO_HELLO = 'iso-hello';
export const TAG_CONNECT = 'connect';
export const WS_TAP_KEY = 'chatgoose.wsTap';

/** Envelope kinds (contracts BridgeRequestSchema / BridgeResponseSchema). */
export const KIND_REQ = 'req';
export const KIND_RES = 'res';
/** contracts BRIDGE_ERRORS member for a request type this MAIN does not serve. */
export const ERR_UNKNOWN_REQUEST = 'unknown-request';
