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

/** Wall clock and timers. Deadlines from the hub are converted with `localDeadline`, never by shifting this clock (HB-008). */
export interface HubClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Reads the global timers at call time, so test fake timers apply. */
export const SYSTEM_CLOCK: HubClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

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
  /** For the device label «Firefox · OS · ChatSpace» (AU-005). */
  readonly os: HubOs;
  /** `settings.hub.baseUrl`, read at sign-in and to detect a mismatch with the stored sign-in (AU-016). */
  hubOrigin(): string;
  /** `settings.debug.enabled` (ST-097): the prompt echo and the dev/compat mode. */
  debugEnabled(): boolean;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Random ids we mint (prompt viewer tokens). */
export type UuidSource = () => string;
