// What the two MAIN scripts lend each other (architecture.md §6.8 «Тап и
// основной мост живут в одном MAIN-мире»). Types only: nothing here reaches a
// bundle.
//
// The bridge with its runtime is the document_start content script
// (chatspace-main); the tap script (chatspace-ws) is registered by the
// background only while the `wsTap` flag is on. Everything of §6.6–§6.8 that
// needs the tap to mean anything — the freshness counters, the X8 send port,
// the receipt observer, the observation of human sends — ships in the tap
// script, so the document_start bundle stays within its budget (§11). The tap
// leaves its handle under the non-enumerable `Symbol.for('wsTap')`;
// the runtime takes it once and lends the tap script its page reads and its
// event channel (`LiveHost`), and gets the live port back.
//
// The page sees the handle too (MAIN is untrusted, §14): at worst it takes
// the port first, and the bridge stays without one — the same as no tap.

import { type Plain } from './check';

// Page objects are described with function-valued properties: they are
// ChatSpace's, and we only ever call them on their own object.

/** Pinia calls `$onAction` subscribers BEFORE the action's body; `after` runs with its result, `onError` when it throws. */
export type ActionListener = (context: { name: string; args: unknown[]; after: (cb: (result: unknown) => void) => void; onError: (cb: () => void) => void }) => void;

export interface PageStore {
  readonly $id: string;
  readonly $onAction: (listener: ActionListener, detached?: boolean) => unknown;
  /** State changes; `flush: 'sync'` reports each one as it happens. Returns its own stop function. */
  readonly $subscribe?: (listener: () => void, options?: { detached?: boolean; flush?: 'sync' }) => unknown;
  readonly [member: string]: unknown;
}

export type QueueListener = (input: unknown, after: (cb: (entry: unknown) => void) => void, onError: (cb: () => void) => void) => void;

/** A Colada cache entry, as far as the bridge reads it. */
export interface Entry {
  readonly state?: { readonly value?: { readonly data?: unknown } };
  readonly asyncStatus?: { readonly value?: unknown };
  readonly active?: boolean;
  readonly when?: number;
}

export interface Route {
  readonly name: 'chat' | 'accounts-overview' | 'other';
  readonly acc: string | null;
  /** The open chat's fan; only on the `chat` route. */
  readonly fan: string | null;
}

/** The composer's draft as recorded inside the queue action, before the native send (contracts SentDraftSchema). */
export interface SentDraft {
  readonly revision: number;
  readonly provenance: 'empty' | 'our-insert' | 'human-or-unknown';
  readonly insertIntentId: string | null;
  readonly editedSinceInsert: boolean | null;
}

/** What the runtime lends the tap script. Page memory only; nothing here loads or writes anything. */
export interface LiveHost {
  /** The bridge's document epoch. */
  readonly epoch: () => string;
  /** An event that is never coalesced or dropped (contracts BRIDGE_UNDROPPABLE_EVENTS). */
  readonly post: (t: string, payload: Plain) => void;
  readonly route: () => Route;
  /** A store that exists; never created. */
  readonly store: (id: string) => PageStore | undefined;
  /** `getQueryData(key)` of the cache. */
  readonly data: (...key: string[]) => unknown;
  /** The loaded OnlyFans account with this host id (`["accounts"]`), as far as a send needs it; null — none. */
  readonly account: (acc: string) => { readonly platformAccountId: string | null } | null;
  /** The fan as the page holds it (`["fansMap", acc][fan]`), raw; null — not held. */
  readonly fan: (acc: string, fan: string) => Plain | null;
  /** The cache entry of a key; never created. */
  readonly entry: (...key: string[]) => Entry | null;
  /** The send queue, when it is shaped as §6.2 `pendingMessages` expects; else null. */
  readonly queue: () => PageStore | null;
  /** The account's entries in the queue (`messagesByAccountId[acc]`). */
  readonly entries: (acc: string) => Plain[];
  /**
   * The OnlyFans accounts ChatSpace asked its socket to subscribe (`subscribedAccountIds`, of the accounts the port
   * serves: other platforms share the socket); null — not observable.
   */
  readonly members: () => { has(acc: string): boolean } | null;
  /** The open chat's draft and the digest of its text, when acc/fan is the open chat with an observed editor; else null. */
  readonly draft: (acc: string, fan: string) => { readonly draft: SentDraft; readonly digest: string } | null;
  /** The live port's anchor changed: the contract is judged again. */
  readonly changed: () => void;
}

/** A message frame the tap read, without its text (contracts FROM_MAIN.incoming). */
export interface Fact {
  readonly acc: string;
  readonly fan: string;
  readonly msgId: string;
  readonly fromFan: boolean;
  readonly automatic: boolean;
  readonly tip: boolean;
  readonly sentAt: string | null;
  readonly socketEpoch: number;
  readonly fanSequence: number;
}

/** contracts FreshnessCheckpointSchema. */
export interface Checkpoint {
  readonly documentEpoch: string;
  readonly socketEpoch: number;
  readonly subscriptionEpoch: number;
  readonly hostAccountId: string;
  readonly platformFanId: string;
  readonly fanSequence: number;
  readonly lastFanMessageId: string | null;
  readonly knownFanMessageIds: readonly string[];
  readonly observedAt: number;
  readonly coverage: 'ok' | 'unknown';
}

/** Where the tap reports to, once the live port is attached. */
export interface TapSink {
  /** A message frame: a fan's message seen for the first time (the counters are already updated), or an outgoing one as it came. */
  readonly fact: (fact: Fact) => void;
  /** An account's coverage changed (contracts FROM_MAIN.coverage). */
  readonly coverage: (acc: string, state: 'ok' | 'unknown', reason: string) => void;
  /** The `wsFrames` anchor changed. */
  readonly changed: () => void;
  /** LiveHost.members. */
  readonly members: () => { has(acc: string): boolean } | null;
}

/** The tap as the send port and the receipt observer see it (ws-tap.ts). */
export interface Tap {
  /** False once switched off. */
  readonly on: () => boolean;
  /** `wsFrames` (LivePort.anchor). */
  readonly anchor: () => string;
  /** §6.8 п. 3, §11 `handlerMs`: frames the listener got, the time it spent on them in all and on the slowest one (ms). */
  readonly frameTime: () => readonly [frames: number, totalMs: number, maxMs: number];
  /** The subscription set may have changed. */
  readonly sync: () => void;
  /** The counters of one chat now, without the document epoch (§6.7.5). */
  readonly checkpoint: (acc: string, fan: string) => Omit<Checkpoint, 'documentEpoch'>;
  /** A checkpoint against the counters now: null — nothing new; else CG-SEND-STALE or CG-SEND-FRESHNESS. */
  readonly fresh: (checkpoint: Checkpoint) => string | null;
  readonly connect: (sink: TapSink) => void;
  readonly off: () => void;
}

/** What the tap script gives the runtime. */
export interface LivePort {
  /** One of LIVE_REQUESTS, its payload already checked (requests.ts): data, or a BRIDGE_ERRORS string. */
  readonly handle: (t: string, payload: Plain) => unknown;
  /**
   * The queue's send action was called (Pinia calls `$onAction` subscribers
   * before the action's body): its input, then `after` with the entry, or
   * `onError` (§6.6).
   */
  readonly sent: QueueListener;
  /** ChatSpace's subscription set changed. */
  readonly sync: () => void;
  /** §6.2 `wsFrames`: ok — the current socket is authenticated and its frames read well; missing — none yet; shape — unreadable. */
  readonly anchor: () => string;
}

/** The tap's handle under `Symbol.for('wsTap')`. */
export interface WsTapHandle {
  readonly version: 1;
  /** Sockets constructed through the tap since install. */
  readonly socketCount: () => number;
  /** Tap.frameTime: the tap's own instrumentation, for the debug mode and the e2e (nothing reads it on a frame). */
  readonly frameTime: () => readonly [frames: number, totalMs: number, maxMs: number];
  /** The bridge's runtime takes the live port; only the first call gets one. */
  readonly attach: (host: LiveHost) => LivePort | null;
  /** «Выключись» (§6.8 п. 10–11): stops listening and restores the constructor if it is still ours. */
  readonly dispose: () => void;
}
