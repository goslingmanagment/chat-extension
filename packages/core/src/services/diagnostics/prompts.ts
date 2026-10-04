// The prompt snapshot store (architecture.md §9.3; DB-004…DB-008). Only in
// the background's memory: 12 minutes, at most 10 snapshots, and a total
// character budget so ten huge prompts cannot fill the event page. A tab
// gets only the opaque token (OpDebugView.promptToken) and the counts; the
// text is answered to debug-prompt.html alone (`debug.prompt`, which the
// protocol restricts to that page). Debug off or a sign-out clears it all;
// a token the store does not know — evicted, expired, or lost when the
// event page unloaded — is answered with an honest «истёк». Prompt text is
// never logged and never exported.

import { DEBUG_LIMITS } from '@cg/contracts/limits';
import { type FeatureId } from '@cg/contracts/features';
import { type PromptSnapshotView } from '@cg/contracts/tab-messages';

import { promptView, type PromptSnapshotContent } from '../../domain/debug';

/** All snapshots together, characters (≈ 16 MB of UTF-16): the oldest go first beyond it. */
export const PROMPT_STORE_MAX_CHARS = 8_000_000;

/** What a token may look like: what the composition root mints (a UUID) fits, junk does not. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export interface PromptStoreDeps {
  readonly now: () => number;
  /** A fresh opaque token (crypto.randomUUID in the background). */
  readonly token: () => string;
  /** debug.enabled. */
  readonly debugEnabled: () => boolean;
}

interface Entry {
  readonly token: string;
  readonly at: number;
  /** null: the hub sent no echo for this generation (DB-008). */
  readonly content: PromptSnapshotContent | null;
  readonly echoOff: { readonly feature: FeatureId | null; readonly capturedAt: number; readonly fromCache: boolean } | null;
}

export interface PromptStoreStats {
  readonly count: number;
  readonly chars: number;
}

export class PromptSnapshotStore {
  private entries: Entry[] = [];

  constructor(private readonly deps: PromptStoreDeps) {}

  private on(): boolean {
    try {
      return this.deps.debugEnabled();
    } catch {
      return false;
    }
  }

  /** DB-004: keeps a snapshot and returns its token for the tab; null outside debug mode. */
  put(content: PromptSnapshotContent): string | null {
    if (!this.on()) return null;
    return this.add({ content, echoOff: null });
  }

  /**
   * DB-008: a generation in debug mode whose echo did not come (the hub
   * answers it only in a window the owner opened, DB-003, or it was served
   * from a cache): the page explains why there is no prompt.
   */
  putNoEcho(facts: { readonly feature: FeatureId | null; readonly capturedAt: number; readonly fromCache: boolean }): string | null {
    if (!this.on()) return null;
    return this.add({ content: null, echoOff: { ...facts } });
  }

  private add(entry: Omit<Entry, 'token' | 'at'>): string | null {
    let token: string;
    try {
      token = this.deps.token();
    } catch {
      return null;
    }
    if (!TOKEN_PATTERN.test(token)) return null;
    this.expire();
    this.entries = this.entries.filter((e) => e.token !== token);
    this.entries.push({ ...entry, token, at: this.deps.now() });
    while (this.entries.length > DEBUG_LIMITS.promptSnapshotsKept || (this.entries.length > 1 && this.chars() > PROMPT_STORE_MAX_CHARS)) this.entries.shift();
    return token;
  }

  private chars(): number {
    return this.entries.reduce((sum, e) => sum + (e.content?.chars ?? 0), 0);
  }

  private expire(): void {
    const cutoff = this.deps.now() - DEBUG_LIMITS.promptSnapshotTtlMs;
    this.entries = this.entries.filter((e) => e.at > cutoff);
  }

  /** DB-006/DB-007: `debug.prompt` — the view for debug-prompt.html, or why there is none. */
  view(token: string): PromptSnapshotView {
    if (!this.on()) {
      this.clear();
      return promptView('debug-off', null);
    }
    if (!TOKEN_PATTERN.test(token)) return promptView('not-found', null);
    this.expire();
    const entry = this.entries.find((e) => e.token === token);
    if (entry === undefined) return promptView('expired', null);
    if (entry.content !== null) return promptView('ok', entry.content);
    const echo = entry.echoOff;
    return promptView('echo-off', echo === null ? null : { feature: echo.feature, capturedAt: echo.capturedAt, fromCache: echo.fromCache, blocks: [], manifest: null, manifestTruncated: false, chars: 0 });
  }

  /** Debug off, sign-out (§9.3). */
  clear(): void {
    this.entries = [];
  }

  /** Counts only: what diagnostics may show. */
  stats(): PromptStoreStats {
    this.expire();
    return { count: this.entries.length, chars: this.chars() };
  }
}
