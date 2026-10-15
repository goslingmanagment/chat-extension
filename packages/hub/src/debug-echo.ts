// The prompt echo of debug mode (architecture.md §9.3, §14; DB-002…DB-008).
// With `debug-input-v1` the hub answers a `debug_input_v1` frame — only
// inside the window the owner opened (DB-003: silence is not an error). The
// snapshot lives ONLY in the background's memory: 12 min, at most 10, blocks
// cut to 500 000 characters, the manifest to 100 000. A tab gets an opaque
// token and counters (DB-006); the text opens on debug-prompt.html by that
// token. Turning debug off or signing out clears everything.

import { DEBUG_LIMITS, FEATURE_IDS, type FeatureId, type HubAiFeature, type HubFrame, type OpFeature, type PromptSnapshotView } from '@cg/contracts';

import { type HubClock, type UuidSource } from './ports';

type DebugFrame = Extract<HubFrame, { type: 'debug_input_v1' }>;

interface EchoEntry {
  readonly token: string;
  readonly opId: string;
  readonly feature: OpFeature;
  /** Monotonic: the snapshot TTL and the order of eviction. */
  readonly createdAt: number;
  frame: DebugFrame | null;
  capturedAt: number | null;
  /** Requested and the stream ended without an echo: the owner's window is closed (DB-003, DB-008 «эхо выключено»). */
  ended: boolean;
  readonly fromCache: boolean;
}

/** What a tab may know about an echo: the opaque token and counters, never text (DB-006). */
export interface EchoTicket {
  readonly token: string;
  readonly state: 'pending' | 'ok' | 'echo-off';
  readonly blocks: number;
  readonly chars: number;
  readonly fromCache: boolean;
}

const MAX_TOMBSTONES = 64;
const MAX_BLOCKS = 32;

/**
 * Our operation of a stream request (the hub's `fan-summary` is a full or a short recap). 1.15.0 (R20 P4b3): the two
 * hub features of Fansly's own operations are those operations (`SiteOpId`); the snapshot's view names shared
 * features only (`PromptSnapshotView.feature`), so theirs shows without a name.
 */
export function featureOfHub(feature: HubAiFeature, summaryMode: 'short' | undefined): OpFeature {
  switch (feature) {
    case 'fast-reply':
      return 'reply';
    case 'improve-draft':
      return 'fix';
    case 'hi-greeting':
      return 'hi';
    case 'ping':
      return 'ping';
    case 'chat-review':
      return 'review';
    case 'fan-summary':
      return summaryMode === 'short' ? 'recap-short' : 'recap';
    case 'coach-chat':
      return 'coach';
    case 'voice-script':
      return 'voice-script';
    case 'fan-notes-fill':
      return 'notes-fill';
  }
}

/** The shared feature a view may name; a site's operation has none there. */
const viewFeature = (feature: OpFeature): FeatureId | null => ((FEATURE_IDS as readonly string[]).includes(feature) ? (feature as FeatureId) : null);

export class PromptEchoStore {
  private readonly byToken = new Map<string, EchoEntry>();
  private readonly byOp = new Map<string, string>();
  private readonly expired: string[] = [];

  constructor(
    /** `now` for the capture time shown; `monotonic` for the snapshot TTL (HB-008). */
    private readonly clock: Pick<HubClock, 'now' | 'monotonic'>,
    private readonly uuid: UuidSource,
  ) {}

  /** A stream asked for the echo. */
  requested(opId: string, feature: OpFeature): void {
    this.sweep();
    const token = this.uuid();
    this.byToken.set(token, { token, opId, feature, createdAt: this.clock.monotonic(), frame: null, capturedAt: null, ended: false, fromCache: false });
    this.byOp.set(opId, token);
    this.trim();
  }

  record(opId: string, frame: DebugFrame): void {
    const entry = this.entryOf(opId);
    if (entry === null) return;
    entry.frame = frame;
    entry.capturedAt = this.clock.now();
  }

  /** The stream of `opId` is over, with or without an echo. */
  finished(opId: string): void {
    const entry = this.entryOf(opId);
    if (entry !== null) entry.ended = true;
  }

  /** A result served from the result cache (AI-128): the original's echo, marked «из кэша» (DB-008). */
  alias(originalOpId: string, opId: string): void {
    const original = this.entryOf(originalOpId);
    if (original === null) return;
    const token = this.uuid();
    this.byToken.set(token, { ...original, token, opId, fromCache: true });
    this.byOp.set(opId, token);
    this.trim();
  }

  ticket(opId: string): EchoTicket | null {
    const entry = this.entryOf(opId);
    if (entry === null) return null;
    const blocks = entry.frame === null ? [] : [...entry.frame.systemBlocks, ...entry.frame.userBlocks];
    return {
      token: entry.token,
      state: entry.frame !== null ? 'ok' : entry.ended ? 'echo-off' : 'pending',
      blocks: blocks.length,
      chars: blocks.reduce((sum, block) => sum + block.text.length, 0),
      fromCache: entry.fromCache,
    };
  }

  /** debug.prompt: the snapshot behind a token, for debug-prompt.html only. */
  view(token: string, debugEnabled: boolean): PromptSnapshotView {
    const empty = { fromCache: false, capturedAt: null, feature: null, manifest: null, blocks: [] };
    if (!debugEnabled) return { state: 'debug-off', ...empty };
    this.sweep();
    const entry = this.byToken.get(token);
    if (entry === undefined) return { state: this.expired.includes(token) ? 'expired' : 'not-found', ...empty };
    const base = { fromCache: entry.fromCache, capturedAt: entry.capturedAt === null ? null : new Date(entry.capturedAt).toISOString(), feature: viewFeature(entry.feature) };
    if (entry.frame === null) return { state: entry.ended ? 'echo-off' : 'not-found', ...base, manifest: null, blocks: [] };
    const cut = (text: string, max: number) => ({ text: text.length > max ? text.slice(0, max) : text, truncated: text.length > max });
    const blocks = [
      ...entry.frame.systemBlocks.map((block, index) => ({ name: `system ${index + 1}`, ...cut(block.text, DEBUG_LIMITS.promptBlockMaxChars) })),
      ...entry.frame.userBlocks.map((block, index) => ({ name: `user ${index + 1}`, ...cut(block.text, DEBUG_LIMITS.promptBlockMaxChars) })),
    ].slice(0, MAX_BLOCKS);
    const manifest = entry.frame.contextManifest === null ? null : cut(JSON.stringify(entry.frame.contextManifest, null, 2), DEBUG_LIMITS.promptManifestMaxChars).text;
    return { state: 'ok', ...base, manifest, blocks };
  }

  clear(): void {
    this.byToken.clear();
    this.byOp.clear();
    this.expired.length = 0;
  }

  size(): number {
    this.sweep();
    return this.byToken.size;
  }

  private entryOf(opId: string): EchoEntry | null {
    this.sweep();
    const token = this.byOp.get(opId);
    return token === undefined ? null : (this.byToken.get(token) ?? null);
  }

  private sweep(): void {
    const now = this.clock.monotonic();
    for (const entry of [...this.byToken.values()]) {
      if (now - entry.createdAt >= DEBUG_LIMITS.promptSnapshotTtlMs) this.drop(entry);
    }
  }

  private trim(): void {
    const entries = [...this.byToken.values()].sort((a, b) => a.createdAt - b.createdAt);
    while (entries.length > DEBUG_LIMITS.promptSnapshotsKept) {
      const oldest = entries.shift();
      if (oldest !== undefined) this.drop(oldest);
    }
  }

  private drop(entry: EchoEntry): void {
    this.byToken.delete(entry.token);
    if (this.byOp.get(entry.opId) === entry.token) this.byOp.delete(entry.opId);
    this.expired.push(entry.token);
    if (this.expired.length > MAX_TOMBSTONES) this.expired.shift();
  }
}
