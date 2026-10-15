// Structural ports supplied by bg/fansly. No import of the background owner,
// platform, or browser API: one session owner, one store, one telemetry window.
export interface ApiSession {
  readonly legacyId: string;
  readonly canonicalId: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly checks: Readonly<Record<string, string>>;
  readonly connected: boolean;
}
export interface LimitFact {
  readonly requestId: string;
  readonly at: number;
  readonly accountId: string | null;
  readonly source: 'own' | 'page' | 'unknown';
  readonly method?: string;
  readonly pathname?: string;
  readonly retryAfterMs?: number;
}
export interface ApiSessionPort {
  readonly ready: Promise<void>;
  idle(): Promise<void>;
  forTab(tabId: number): ApiSession | null;
  forAccount(accountId: string): ApiSession | null;
  rateLimits(): readonly LimitFact[];
  trackOwnRequest(request: { readonly requestId: string; readonly accountId: string; readonly url: string; readonly stamp: string; readonly method: string }): boolean;
  recordOwnLimit(fact: LimitFact): Promise<void>;
  disconnect(accountId: string): Promise<void>;
}
export interface PacerStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}
