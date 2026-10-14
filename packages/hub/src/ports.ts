// What the hub facade needs from the background, as ports the composition
// root wires (architecture.md §4: `hub` gets browser capabilities from
// `platform`, never touches browser.* itself).
//
// The key-value port has the shape of @cg/platform's `KeyValueStore` (R07):
// calls never throw, a failure is a result with a CG-STORAGE-* code, and one
// `set` is one atomic browser write. The integrator passes R07's
// `createKeyValueStore('local' | 'session')` as is.

/** CG-STORAGE-* codes of a failed storage call (R07 `StorageFailureCode`). */
export type HubStorageFailureCode = 'CG-STORAGE-READ' | 'CG-STORAGE-WRITE' | 'CG-STORAGE-FULL';

export type HubStorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: HubStorageFailureCode; readonly detail: string };

/** `storage.local` (sign-in, caches) or `storage.session` (the Spenders board). */
export interface HubKeyValueStore {
  get(keys: readonly string[]): Promise<HubStorageResult<Readonly<Record<string, unknown>>>>;
  /** One call is one atomic write (AU-006). */
  set(items: Readonly<Record<string, unknown>>): Promise<HubStorageResult<void>>;
  remove(keys: readonly string[]): Promise<HubStorageResult<void>>;
}

/**
 * Two clocks and timers (HB-008). Deadlines from the hub are converted with
 * `localDeadline` / Retry-After, never by shifting a clock.
 */
export interface HubClock {
  /** Wall time, epoch ms: what is shown, absolute UTC boundaries (the quota's day), stamps that outlive the background (storage). */
  now(): number;
  /** Monotonic ms (`performance.now`): elapsed time inside one background lifetime — TTLs, cache ages, budgets. A wall-clock jump never moves it. */
  monotonic(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Reads the globals at call time, so test fake timers apply. */
export const SYSTEM_CLOCK: HubClock = {
  now: () => Date.now(),
  monotonic: () => globalThis.performance.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

/** A moment stamped on both clocks; `mono` is absent for a stamp read back from storage (another background lifetime). */
export interface ClockStamp {
  readonly at: number;
  readonly mono?: number | undefined;
}

export function stampNow(clock: HubClock): { readonly at: number; readonly mono: number } {
  return { at: clock.now(), mono: clock.monotonic() };
}

/**
 * Time since `stamp`: by the monotonic clock while the background that made
 * it lives; by the wall clock for a stored stamp — and a stored stamp from the
 * future (the wall clock went back) counts as infinitely old, never as fresh.
 */
export function elapsedSince(clock: HubClock, stamp: ClockStamp): number {
  if (stamp.mono !== undefined) return Math.max(0, clock.monotonic() - stamp.mono);
  const age = clock.now() - stamp.at;
  return age < 0 ? Number.POSITIVE_INFINITY : age;
}

export type HubLogLevel = 'debug' | 'info' | 'warn' | 'error';
/** Facts only: routes, statuses, codes, counts, epochs. Never a token, a password, a message, a draft, a prompt or model output. */
export type HubLogFields = Readonly<Record<string, string | number | boolean | null>>;
export type HubLog = (level: HubLogLevel, message: string, fields?: HubLogFields) => void;

export const SILENT_LOG: HubLog = () => undefined;

export type HubOs = 'windows' | 'macos' | 'linux' | 'other';

export interface HubEnvironment {
  /** The extension's manifest version: `x-client-version: chat-extension/<version>` (HB-004), the minVersion gate. */
  readonly extensionVersion: string;
  /** A CG_TEST_HOSTS=1 build (loopback stand and fake hub): http hub origins, the compat mode. */
  readonly testBuild: boolean;
  /** For the device label «Firefox · OS · ChatGoose» (AU-005). */
  readonly os: HubOs;
  /** `settings.hub.baseUrl`, read at sign-in and to detect a mismatch with the stored sign-in (AU-016). */
  hubOrigin(): string;
  /** `settings.debug.enabled` (ST-097): the prompt echo and the dev/compat mode. */
  debugEnabled(): boolean;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Random ids we mint (prompt viewer tokens). */
export type UuidSource = () => string;
