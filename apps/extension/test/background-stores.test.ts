// The adapters of the background composition root between wave-1 packages
// that brought the same store twice (R07's stores, R10's and R18's ports):
// one writer per key, R07's guarantees kept.

import { journalEntry } from '@cg/contracts/fixtures';
import type { SendJournalEntry } from '@cg/contracts';
import { createSendJournal } from '@cg/core/services/custody';
import { describe, expect, it } from 'vitest';

import { sendJournalStoreOver } from '../bg/chatspace/send-journal-store.ts';
import { memoryStore } from './support/memory-store.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const SEND_KEY = 'send.journal';

describe('sendJournalStoreOver — the coordinator journal on the send journal', () => {
  const entry = (n: number, over: Partial<SendJournalEntry> = {}): SendJournalEntry => ({ ...journalEntry, attemptId: uuid(n), fanRef: String(2000 + n), ...over });
  const world = (data = new Map<string, unknown>()) => {
    const local = memoryStore('local', data);
    const journal = createSendJournal({ local });
    return { local, journal, store: sendJournalStoreOver(journal) };
  };

  it('[X8-07] a new attempt is journaled before anything else; moves advance it; the value keeps the journal’s own format', async () => {
    const { store, journal, local } = world();
    expect(await store.get(SEND_KEY)).toEqual([]);
    await store.set(SEND_KEY, [entry(1)]);
    expect(journal.get(uuid(1))?.state).toBe('preparing');
    expect(local.data.get(SEND_KEY)).toMatchObject({ v: 1, entries: [{ attemptId: uuid(1), state: 'preparing' }] });
    await store.set(SEND_KEY, [entry(1, { state: 'nativeEnqueued', pendingId: 'p-1', updatedAt: journalEntry.updatedAt + 10 })]);
    expect(journal.get(uuid(1))).toMatchObject({ state: 'nativeEnqueued', pendingId: 'p-1' });
    // The same facts again: no write.
    const writes = local.sets.length;
    await store.set(SEND_KEY, [entry(1, { state: 'nativeEnqueued', pendingId: 'p-1', updatedAt: journalEntry.updatedAt + 99 })]);
    expect(local.sets.length).toBe(writes);
  });

  it('[X8-07] a record that did not save rejects: the coordinator holds instead of asking the hub', async () => {
    const { store, local, journal } = world();
    await store.get(SEND_KEY);
    local.failNextSet();
    await expect(store.set(SEND_KEY, [entry(1)])).rejects.toMatchObject({ name: 'StorageCallError', code: 'CG-STORAGE-WRITE' });
    expect(journal.get(uuid(1))).toBeNull();
    // A second open attempt to the same fan is refused by the journal itself.
    await store.set(SEND_KEY, [entry(1)]);
    await expect(store.set(SEND_KEY, [entry(1), entry(2, { fanRef: entry(1).fanRef })])).rejects.toMatchObject({ code: 'CG-SEND-BUSY' });
  });

  it('[RB-007] after an unload a half-way attempt is uncertain; it is released only when the coordinator that restored it drops it', async () => {
    const data = new Map<string, unknown>();
    const first = world(data);
    await first.store.set(SEND_KEY, [entry(1), entry(2)]);
    await first.store.set(SEND_KEY, [entry(1, { state: 'nativeEnqueued' }), entry(2)]);

    // A new background: a send that begins before the restore must not free anybody's fan.
    const early = world(data);
    await early.store.set(SEND_KEY, [entry(3)]);
    expect(early.journal.get(uuid(1))?.state).toBe('uncertain');
    expect(early.journal.get(uuid(2))?.state).toBe('uncertain');

    const second = world(data);
    const restored = (await second.store.get(SEND_KEY)) as SendJournalEntry[];
    expect(restored.map((item) => [item.attemptId, item.state]).sort()).toEqual([[uuid(1), 'uncertain'], [uuid(2), 'uncertain'], [uuid(3), 'uncertain']]);
    // The hub resolved attempt 1: the coordinator drops it, the journal releases its fan.
    await second.store.set(SEND_KEY, restored.filter((item) => item.attemptId !== uuid(1)));
    expect(second.journal.get(uuid(1))).toBeNull();
    expect(second.journal.get(uuid(2))?.state).toBe('uncertain');
    // The late linked pair ends an uncertain attempt as sent.
    await second.store.set(SEND_KEY, restored.filter((item) => item.attemptId !== uuid(1)).map((item) => (item.attemptId === uuid(2) ? { ...item, state: 'sentObserved' as const, platformMessageId: '4100' } : item)));
    expect(second.journal.get(uuid(2))).toMatchObject({ state: 'sentObserved', platformMessageId: '4100' });
  });
});

describe('sendJournalStoreOver — a part the person sent themselves (§6.6)', () => {
  const entry = (n: number, over: Partial<SendJournalEntry> = {}): SendJournalEntry => ({ ...journalEntry, attemptId: uuid(n), fanRef: String(2000 + n), ...over });
  /** What the coordinator's `nativeSent` puts into its list: born delivered, with the message's id — and of this minute (a finished record ages out). */
  const at = Date.now();
  const native = (n: number, over: Partial<SendJournalEntry> = {}): SendJournalEntry =>
    entry(n, { state: 'sentObserved', platformMessageId: '4100', documentEpoch: 'native-send', previewRevision: 0, createdAt: at, updatedAt: at, ...over });
  const world = (data = new Map<string, unknown>()) => {
    const local = memoryStore('local', data);
    const journal = createSendJournal({ local });
    return { local, journal, store: sendJournalStoreOver(journal) };
  };
  const states = (local: { data: Map<string, unknown> }): unknown[] => ((local.data.get(SEND_KEY) as { entries: { attemptId: string; state: string }[] } | undefined)?.entries ?? []).map((item) => [item.attemptId, item.state]);

  it('[TL-004] [NF-019] it is journaled finished, never as an open attempt: nothing holds the fan, and every later write of the list goes through', async () => {
    const { store, journal, local } = world();
    expect(await store.get(SEND_KEY)).toEqual([]);
    await store.set(SEND_KEY, [native(1)]);
    // One write, and what it wrote is the delivered record: `preparing` was never on disk.
    expect(local.sets.filter((keys) => keys.includes(SEND_KEY))).toHaveLength(1);
    expect(states(local)).toEqual([[uuid(1), 'sentObserved']]);
    expect(journal.open()).toEqual([]);

    // An X8 click on the same fan's next part, then on another fan: the list with the record in it is written as before.
    await store.set(SEND_KEY, [native(1), entry(2, { fanRef: native(1).fanRef, partIndex: 1, group: { ...journalEntry.group, partCount: 2 } })]);
    await store.set(SEND_KEY, [native(1), entry(2, { fanRef: native(1).fanRef, partIndex: 1, group: { ...journalEntry.group, partCount: 2 }, state: 'nativeEnqueued', pendingId: 'p-2' }), entry(3)]);
    expect(states(local)).toEqual([[uuid(1), 'sentObserved'], [uuid(2), 'nativeEnqueued'], [uuid(3), 'preparing']]);
    // The same list again: no write for the record.
    const writes = local.sets.length;
    await store.set(SEND_KEY, [native(1), entry(2, { fanRef: native(1).fanRef, partIndex: 1, group: { ...journalEntry.group, partCount: 2 }, state: 'nativeEnqueued', pendingId: 'p-2' }), entry(3)]);
    expect(local.sets.length).toBe(writes);
  });

  it('[RB-007] after an unload it comes back delivered — not «неизвестно, ушло ли» — and the fan is free', async () => {
    const data = new Map<string, unknown>();
    const first = world(data);
    await first.store.set(SEND_KEY, [native(1)]);
    const second = world(data);
    const restored = (await second.store.get(SEND_KEY)) as SendJournalEntry[];
    expect(restored.map((item) => [item.attemptId, item.state, item.documentEpoch, item.platformMessageId])).toEqual([[uuid(1), 'sentObserved', 'native-send', '4100']]);
    expect(second.journal.open()).toEqual([]);
    await second.store.set(SEND_KEY, [...restored, entry(2, { fanRef: native(1).fanRef })]);
    expect(second.journal.get(uuid(2))?.state).toBe('preparing');
  });

  it('[RB-007] a record that came while the journal could not be read is not lost when it reads again: the next write of the list journals it', async () => {
    const data = new Map<string, unknown>([[SEND_KEY, 'not a journal']]);
    const { store, journal, local } = world(data);
    // The person's send is told while the key holds something this build cannot read: nothing is kept on a promise.
    await expect(store.set(SEND_KEY, [native(1)])).resolves.toBeUndefined();
    expect(journal.get(uuid(1))).toBeNull();
    expect(local.data.get(SEND_KEY)).toBe('not a journal');
    // The key reads again. The coordinator writes its list at the next click — the record is still in that list.
    data.delete(SEND_KEY);
    await store.set(SEND_KEY, [native(1), entry(2)]);
    expect(states(local)).toEqual([[uuid(1), 'sentObserved'], [uuid(2), 'preparing']]);
    // …and after an unload the part is still delivered.
    const again = world(data);
    expect(((await again.store.get(SEND_KEY)) as SendJournalEntry[]).map((item) => [item.attemptId, item.state])).toEqual([[uuid(1), 'sentObserved'], [uuid(2), 'uncertain']]);
  });

  it('a record the journal does not take never rejects the write: the attempt next to it is journaled, the record is offered again', async () => {
    const { store, journal, local } = world();
    await store.get(SEND_KEY);
    // The disk fails for the record: it stays in the journal's memory; the write is not a refusal.
    local.failNextSet();
    await expect(store.set(SEND_KEY, [native(1)])).resolves.toBeUndefined();
    expect(journal.get(uuid(1))?.state).toBe('sentObserved');
    expect(local.data.has(SEND_KEY)).toBe(false);
    // The next change writes both.
    await store.set(SEND_KEY, [native(1), entry(2)]);
    expect(states(local)).toEqual([[uuid(1), 'sentObserved'], [uuid(2), 'preparing']]);
    // A record that is no proven delivery (no message id) is not journaled at all — and holds nobody.
    const { platformMessageId: _id, ...unproven } = native(3);
    await expect(store.set(SEND_KEY, [native(1), entry(2), unproven as SendJournalEntry, entry(4)])).resolves.toBeUndefined();
    expect(journal.get(uuid(3))).toBeNull();
    expect(journal.get(uuid(4))?.state).toBe('preparing');
  });
});
