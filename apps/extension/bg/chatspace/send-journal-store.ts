// The X8 attempt journal of R10's send coordinator on R07's send journal
// (architecture.md §6.7.7 п. 3, §6.7.8, §9.4). Part of the ChatSpace
// background chunk (bg/chatspace.ts): the core never holds it.
//
// The coordinator persists through a key-value port: the whole list of its
// journal entries under `send.journal`, rewritten at every move. R07's send
// journal owns the same key with stronger rules for the one thing that must
// never be lost — an open attempt holds its fan: a versioned value, records
// this build cannot parse are kept and hold their fan, a value changed from
// outside is repaired, a store it cannot read refuses every send. Two
// writers of one key would corrupt it, so there is one: this adapter turns
// the coordinator's whole-list write into the journal's `begin`, `advance`
// and `release`.
// - A new attempt is journaled with `begin` BEFORE the coordinator asks the
//   hub; a refusal or a failed write rejects, and the coordinator holds
//   (§6.7.7: an unwritten record means no queue call).
// - A move is `advance`; the journal keeps an observed fact in memory when
//   its write fails and writes it with the next change.
// - An uncertain attempt leaves the journal (`release`) only when the
//   coordinator had it and dropped it — that is, after the hub resolved it.
//   Attempts the coordinator never saw through this adapter stay: a write
//   that comes before the restore never frees a fan.
// - After an unload the journal has already turned half-way attempts into
//   `uncertain` (§6.7.7 п. 6); the coordinator restores them as such.
// - A part the person sent themselves (§6.6, the coordinator's `nativeSent`)
//   is in the list too, born `sentObserved`. It is no attempt: it goes to
//   the journal as a finished record (`record`), never through `begin` — a
//   `preparing` record would hold the fan, read «неизвестно, ушло ли» after
//   an unload, and its refused move to `sentObserved` would fail every later
//   write of the list. A record of what the person did never rejects a
//   write: a journal that does not take it now is asked again next time —
//   and «took it» is read from the journal itself at every write, never
//   remembered here: a journal that could not be read when the record came
//   holds nothing of it once it reads again.

import { type SendJournalEntry } from '@cg/contracts/send';
import { STORAGE_KEYS } from '@cg/contracts/settings';
import { isNativeSendEntry } from '@cg/core/domain/send';
import { type KeyValueStore as ThrowingStore } from '@cg/core/services';
import { type SendJournal, type SendJournalUpdate } from '@cg/core/services/custody';

const KEY = STORAGE_KEYS.sendJournal;

/** A write the journal did not take, as the core's throwing stores raise one (`StorageCallError`): its code only, never a value. */
function storageError(code: string, key: string): Error {
  return Object.assign(new Error(`${code} ${key}`), { name: 'StorageCallError', code, key });
}

const sameFacts = (a: SendJournalEntry, b: SendJournalEntry): boolean =>
  a.state === b.state && a.code === b.code && a.pendingId === b.pendingId && a.platformMessageId === b.platformMessageId;

function updateOf(entry: SendJournalEntry): SendJournalUpdate {
  return {
    state: entry.state,
    ...(entry.code === undefined ? {} : { code: entry.code }),
    ...(entry.pendingId === undefined ? {} : { pendingId: entry.pendingId }),
    ...(entry.platformMessageId === undefined ? {} : { platformMessageId: entry.platformMessageId }),
  };
}

/** A copy of an entry as it is first journaled: `preparing`, no outcome yet. */
function asPreparing(entry: SendJournalEntry): SendJournalEntry {
  const { code: _code, pendingId: _pendingId, platformMessageId: _messageId, ...rest } = entry;
  return { ...rest, state: 'preparing' };
}

export function sendJournalStoreOver(journal: SendJournal): ThrowingStore {
  /** Attempts the coordinator has held (restored or written through here). */
  const seen = new Set<string>();

  return {
    async get(key) {
      if (key !== KEY) return undefined;
      await journal.start();
      const entries = journal.list();
      for (const entry of entries) seen.add(entry.attemptId);
      return entries;
    },

    async set(key, value) {
      if (key !== KEY || !Array.isArray(value)) throw storageError('CG-STORAGE-WRITE', key);
      const entries = value as readonly SendJournalEntry[];
      for (const entry of entries) {
        const existing = journal.get(entry.attemptId);
        if (isNativeSendEntry(entry)) {
          // The person's own send: a finished record, never an open one — and never a reason to refuse this write.
          // Offered for as long as the journal does not hold it.
          if (existing === null) await journal.record(entry);
          continue;
        }
        if (existing === null) {
          // A finished attempt the journal no longer keeps (its own bound): nothing to hold, nothing to write.
          if (seen.has(entry.attemptId) && entry.state !== 'preparing') continue;
          const begun = await journal.begin(asPreparing(entry));
          if (!begun.ok) throw storageError(begun.code, `${KEY} ${entry.attemptId}`);
          seen.add(entry.attemptId);
          if (entry.state === 'preparing') continue;
        } else {
          seen.add(entry.attemptId);
          if (sameFacts(existing, entry)) continue;
        }
        const moved = await journal.advance(entry.attemptId, updateOf(entry));
        if (!moved.ok) throw storageError(moved.code === 'CG-STORAGE-VERSION' ? moved.code : 'CG-STORAGE-WRITE', `${KEY} ${entry.attemptId}`);
      }
      // The coordinator dropped an attempt it had: an uncertain one was resolved by the hub.
      const kept = new Set(entries.map((entry) => entry.attemptId));
      for (const entry of journal.list()) {
        if (kept.has(entry.attemptId) || !seen.has(entry.attemptId)) continue;
        seen.delete(entry.attemptId);
        if (entry.state === 'uncertain') await journal.release(entry.attemptId);
      }
    },
  };
}
