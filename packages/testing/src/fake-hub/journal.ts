// The fake hub's request journal: every call, classified (our route, a
// forbidden operation, unknown), with its answer and who gave it. Tests assert
// on it — «this route was called with this request», «a forbidden route was
// never called», «no request failed the contract schema». No conversation
// text, draft, prompt, password or model output ever lands here: text fields
// of requests are replaced by their length, responses are not kept (only the
// stream's frame types).

import { type HubRouteKey } from '@cg/contracts';

import { type FakeHubJournalEntry, type FakeHubJournalPage, type StreamOutcome } from './types';

/** Request keys whose values are text a person or a model wrote (or a secret). */
const TEXT_KEYS = new Set(['password', 'draftText', 'chatterQuestion', 'question', 'answer', 'text']);

/** A deep copy with every text-bearing value replaced by `‹N chars›`. */
export function redact(value: unknown, key: string | null = null): unknown {
  if (key !== null && TEXT_KEYS.has(key) && typeof value === 'string') return `‹${value.length} chars›`;
  if (Array.isArray(value)) return value.map((item) => redact(item, null));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  return value;
}

const MAX_ENTRIES = 20_000;

type Stored = Omit<FakeHubJournalEntry, 'stream'> & { readonly stream: { frames: string[]; outcome: StreamOutcome | null } | null };
export type JournalRecord = Omit<FakeHubJournalEntry, 'seq' | 'stream'> & { readonly streaming?: boolean };

export class FakeHubJournal {
  private readonly entries: Stored[] = [];
  private seq = 0;

  /** Records a call; returns its sequence number (streams fill their frames in later). */
  record(entry: JournalRecord): number {
    this.seq += 1;
    const { streaming, ...rest } = entry;
    this.entries.push({ ...rest, seq: this.seq, request: redact(rest.request), stream: streaming === true ? { frames: [], outcome: null } : null });
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    return this.seq;
  }

  streamFrame(seq: number, type: string): void {
    this.entries.find((entry) => entry.seq === seq)?.stream?.frames.push(type);
  }

  streamEnd(seq: number, outcome: StreamOutcome): void {
    const stream = this.entries.find((entry) => entry.seq === seq)?.stream;
    if (stream !== undefined && stream !== null && stream.outcome === null) stream.outcome = outcome;
  }

  /** Entries with seq > since, oldest first (copies). */
  read(since = 0): FakeHubJournalPage {
    const entries = this.entries
      .filter((entry) => entry.seq > since)
      .map((entry) => ({ ...entry, stream: entry.stream === null ? null : { frames: [...entry.stream.frames], outcome: entry.stream.outcome } }));
    return { entries, next: this.seq };
  }

  /** The sequence number to read from later («everything after this point»). */
  mark(): number {
    return this.seq;
  }
}

// ── Readings tests use (pure, over entries from any source: in-process or the control endpoint) ──

/** Calls the client must never make (§8.1 «Никогда»), and calls to paths the hub does not know. */
export function forbiddenCalls(entries: readonly FakeHubJournalEntry[]): FakeHubJournalEntry[] {
  return entries.filter((entry) => entry.kind === 'forbidden' || entry.kind === 'unknown' || entry.kind === 'foreign-origin');
}

/** Requests the hub refused for failing the contract schema: a client bug unless the test sent them on purpose. */
export function invalidCalls(entries: readonly FakeHubJournalEntry[]): FakeHubJournalEntry[] {
  return entries.filter((entry) => entry.issues.length > 0);
}

/** Requests a scripted run met that nothing in the script matched (`unscripted: 'fail'`). */
export function unscriptedCalls(entries: readonly FakeHubJournalEntry[]): FakeHubJournalEntry[] {
  return entries.filter((entry) => entry.servedBy === 'unscripted');
}

/** Everything that should fail a test that did not ask for it: forbidden, unknown, invalid and unscripted calls. */
export function journalViolations(entries: readonly FakeHubJournalEntry[]): FakeHubJournalEntry[] {
  return entries.filter((entry) => forbiddenCalls([entry]).length > 0 || invalidCalls([entry]).length > 0 || unscriptedCalls([entry]).length > 0);
}

export function callsTo(entries: readonly FakeHubJournalEntry[], route: HubRouteKey): FakeHubJournalEntry[] {
  return entries.filter((entry) => entry.route === route);
}

/** One line per entry, for failure messages. */
export function describeCalls(entries: readonly FakeHubJournalEntry[]): string {
  return entries
    .map((entry) => `#${entry.seq} ${entry.method} ${entry.path} → ${entry.status}${entry.error === null ? '' : ` ${entry.error}`} [${entry.kind}${entry.operation === null ? '' : `:${entry.operation}`}, ${entry.servedBy}]${entry.issues.length > 0 ? ` issues: ${entry.issues.join('; ')}` : ''}`)
    .join('\n');
}
