// Server-side journal of the stand: every HTTP call and socket event, labelled
// with who made it (native page client, test control, asset, foreign). Bounded
// ring; readers page through it with `since`.

import type { ServerJournalEntry, ServerJournalPage } from '../../fixture-chatspace/src/protocol';

const MAX_ENTRIES = 20_000;

type NewEntry = Omit<ServerJournalEntry, 'seq' | 'at'>;

export class ServerJournal {
  private readonly started = performance.now();
  private readonly entries: ServerJournalEntry[] = [];
  private seq = 0;

  record(entry: NewEntry): ServerJournalEntry {
    this.seq += 1;
    const full: ServerJournalEntry = { ...entry, seq: this.seq, at: Math.round((performance.now() - this.started) * 100) / 100 };
    this.entries.push(full);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    return full;
  }

  read(since = 0): ServerJournalPage {
    return { entries: this.entries.filter((entry) => entry.seq > since), next: this.seq };
  }

  /** Drops everything recorded so far; sequence numbers keep growing. */
  clear(): number {
    this.entries.length = 0;
    return this.seq;
  }
}
