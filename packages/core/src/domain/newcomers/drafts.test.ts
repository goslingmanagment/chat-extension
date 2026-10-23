// The shared drafts of previews and «Новые» (drafts.ts): what one store keeps, what it lets go first, and that what it
// holds always fits its key's budget (a write past it is refused whole, CG-STORAGE-FULL).

import { STORAGE_LIMITS } from '@cg/contracts/limits';
import { BATCH_LIMITS } from '@cg/contracts/vm';
import { describe, expect, it } from 'vitest';

import { EMPTY_DRAFTS, draftKey, findDraft, putDraft, utf8Bytes, type DraftStore } from './drafts';

const AT = Date.UTC(2026, 9, 23, 10);
const REV = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
const key = (pageId: number, fan: number): string => draftKey({ hubOrigin: 'https://hub.example.test', userId: 7, pageId, list: 'newcomers', fanRef: String(800_000_000_000_000_000n + BigInt(fan)) });
/** A greeting as Hi writes it: a few hundred characters in Russian. */
const greeting = (n: number): string => `Привет! Спасибо, что подписался, ${n} — `.padEnd(300, 'рада тебя видеть ');

describe('[NF-012] the drafts of previews and greetings', () => {
  it('several full batches of «Новые» keep every unsent draft (an hour of six creators’ windows); beyond 400 the oldest goes first', () => {
    let store: DraftStore = EMPTY_DRAFTS;
    let now = AT;
    const keys: string[] = [];
    // Six creators, a full batch each, an hour apart: nobody has sent yet.
    for (let page = 0; page < 6; page += 1, now += 3_600_000) {
      for (let n = 0; n < BATCH_LIMITS.picks; n += 1) {
        keys.push(key(page, n));
        store = putDraft(store, key(page, n), greeting(n), (now += 1000), REV).store;
      }
    }
    expect(keys.filter((k) => findDraft(store, k, now) === null)).toEqual([]);
    // To the cap, then one more: only the oldest draft goes.
    for (let n = 0; keys.length < 400; n += 1) {
      keys.push(key(6, n));
      store = putDraft(store, key(6, n), greeting(n), (now += 1000), REV).store;
    }
    expect(keys.filter((k) => findDraft(store, k, now) === null)).toEqual([]);
    store = putDraft(store, key(7, 0), greeting(0), (now += 1000), REV).store;
    expect([store.drafts.length, findDraft(store, keys[0] as string, now), findDraft(store, keys[1] as string, now)?.key]).toEqual([400, null, keys[1]]);
  });

  it('a full store with every removal mark it keeps fits its key’s budget: the marks count toward the bytes, the oldest drafts go', () => {
    let store: DraftStore = EMPTY_DRAFTS;
    let now = AT;
    // Every draft of a full store cleared once (an empty text leaves its mark), then drafts of the longest kind.
    for (let n = 0; n < 2 * 400; n += 1) store = putDraft(store, key(1, n), '', (now += 1000)).store;
    for (let n = 0; n < 120; n += 1) store = putDraft(store, key(2, n), 'Привет'.repeat(833), (now += 1000), REV).store;
    expect(store.removed).toHaveLength(800);
    expect(store.drafts.length).toBeLessThan(120);
    expect(utf8Bytes(JSON.stringify(store))).toBeLessThanOrEqual(STORAGE_LIMITS.previewDraftsTotalBytes);
    // The newest draft is kept, the oldest went.
    expect([findDraft(store, key(2, 119), now)?.key, findDraft(store, key(2, 0), now)]).toEqual([key(2, 119), null]);
  });
});
