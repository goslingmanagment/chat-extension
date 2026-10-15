// Background-only port (R20 §8.3–8.4). Not a tab RPC and not in the common barrel.
export type FanslyApiPurpose = 'newcomers' | 'identity' | 'registration' | 'spenders' | 'notes-read' | 'notes-write' | 'greeting';
export type FanslyPaceMode = 'queue' | 'cooldown' | 'immediate';

export interface FanslyApiCall {
  readonly accountId: string;
  readonly tabId: number;
  readonly purpose: FanslyApiPurpose;
  readonly mode: FanslyPaceMode;
  readonly method: 'GET' | 'POST';
  /** Relative API path, starting with /; no address, escapes or query. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  /** Only queued reads may opt into three bounded retries of 429/5xx. */
  readonly retry?: 'none' | 'transient';
}

/** The part of AbortSignal used by the client; contracts have no DOM dependency. */
export interface FanslyApiSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface FanslyPreparedCall {
  /**
   * One attempt. All waiting finishes in prepare, before custody. Rechecks the
   * session and cooling, invokes the caller's final synchronous guard, then
   * dispatches without an await. Caller validates the response's domain schema.
   */
  dispatch(guard?: () => void): Promise<unknown>;
  /** Release an unused permit (also automatic after dispatch or cancellation). */
  cancel(): void;
}

export interface FanslyApiPort {
  prepare(call: FanslyApiCall, signal: FanslyApiSignal): Promise<FanslyPreparedCall>;
  /** Convenience for reads and actions without custody; still exactly one attempt. */
  request(call: FanslyApiCall, signal: FanslyApiSignal): Promise<unknown>;
}
