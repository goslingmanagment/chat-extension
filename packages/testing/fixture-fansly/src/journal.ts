// Page-side journal of the stand: what the app did — its backend requests
// (with the handler they were made in), route changes, components created and
// destroyed, model writes. Plain JSON, bounded; read through
// `window.__fanslyStand.journal(since)`.

import type { FanslyPageJournalEntry } from './protocol';

const MAX_ENTRIES = 5000;
const entries: FanslyPageJournalEntry[] = [];
let seq = 0;

export function record(type: string, data: Record<string, unknown> = {}): void {
  seq += 1;
  entries.push({ ...data, seq, at: Math.round(performance.now() * 100) / 100, type });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function readJournal(since = 0): FanslyPageJournalEntry[] {
  return entries.filter((entry) => entry.seq > since).map((entry) => JSON.parse(JSON.stringify(entry)) as FanslyPageJournalEntry);
}
