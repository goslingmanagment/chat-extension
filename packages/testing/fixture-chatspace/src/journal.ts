// Page-side journal of the stand: what the app itself did (requests it
// created and how it captured fetch, store actions, socket traffic, query
// fetches and invalidations, composer and route events). Plain JSON, bounded.

import type { PageJournalEntry } from './protocol';

const MAX_ENTRIES = 5000;
const entries: PageJournalEntry[] = [];
let seq = 0;

export function record(type: string, data: Record<string, unknown> = {}): void {
  seq += 1;
  entries.push({ ...data, seq, at: Math.round(performance.now() * 100) / 100, type });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function readJournal(since = 0): PageJournalEntry[] {
  return entries.filter((entry) => entry.seq > since).map((entry) => JSON.parse(JSON.stringify(entry)) as PageJournalEntry);
}
