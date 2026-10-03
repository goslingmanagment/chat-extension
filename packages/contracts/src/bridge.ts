// MAIN ↔ isolated handshake (architecture.md §5.3). The MAIN bridge is a
// dependency-free bundle and cannot import this file: it repeats the literals,
// and packages/host-chatspace tests pin both copies to these values.

import * as z from 'zod/mini';

export const BRIDGE_PROTOCOL_VERSION = 1;

/** `window.postMessage` tags of the handshake; everything after it rides a MessagePort. */
export const BRIDGE_TAGS = {
  mainReady: 'main-ready',
  isoHello: 'iso-hello',
  connect: 'connect',
} as const;

/** Non-enumerable global through which the WS tap hands its subscription to the bridge (§6.8). */
export const WS_TAP_SYMBOL_KEY = 'chatgoose.wsTap';

/** Hard limits on anything that crosses from MAIN (§5.3 «Пределы»). */
export const BRIDGE_LIMITS = {
  maxFrameBytes: 256 * 1024,
  maxStringLength: 20_000,
  callTimeoutMs: 2_000,
} as const;

/**
 * Answer of the MAIN bridge to `{t: 'probe'}`. MAIN is untrusted (§14): the
 * isolated side parses it with this schema and drops anything else.
 */
export const MainProbeSchema = z.strictObject({
  v: z.literal(BRIDGE_PROTOCOL_VERSION),
  /** `document.readyState` when the MAIN script started: `loading` proves document_start. */
  readyStateAtStart: z.enum(['loading', 'interactive', 'complete']),
  /** Time the MAIN bridge spent installing itself, ms (budget ≤ 1 ms, §11). */
  installMs: z.number().check(z.gte(0), z.lte(10_000)),
  /** Whether the WS tap global was present when the probe ran. */
  wsTap: z.boolean(),
});
export type MainProbe = z.infer<typeof MainProbeSchema>;
