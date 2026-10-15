// One account of everything the observation holds (docs/project-unite/
// architecture.md §5.5; FS-TAIL-5): the rings with their objects' overheads,
// the texts, the tombstones, the groups and the fans' avatars — counted here
// as they change — and, read when asked, the deferred-parse queue (two bytes a
// character) and the bridge's stream (its queue and the batches in flight).
// A snapshot's answer is built and handed to the port in one step and kept by
// nobody: no copy of it is held.
//
// Over a limit the observation does not grow: `enforce` drops texts of the
// least recently active chat first (texts alone ≤ 2 MiB), then whole chats,
// then the fans' avatars, then groups, and — when nothing of the observation
// is left to drop — the stream's waiting queue with one `fx.gap {memory}`. Whatever was dropped is
// `unknown` from then on. The estimates are conservative (the spike's
// measures in protocol.ts); `about:memory` calibrates them in P16a.

import { MEMORY_MAX_BYTES, TEXT_MAX_BYTES } from './protocol';

export interface Memory {
  /** Ring records, their slots, chats' own objects, correlation ids. */
  rings: number;
  texts: number;
  tombs: number;
  /** Groups, their members, the fans' avatar addresses, the welcome hashes. */
  groups: number;
  /** All of it, the queue and the stream included. */
  total(): number;
}

/** `held` — what the deferred queue and the stream hold now, in bytes. */
export function createMemory(held: () => number): Memory {
  const memory: Memory = {
    rings: 0,
    texts: 0,
    tombs: 0,
    groups: 0,
    total: () => memory.rings + memory.texts + memory.tombs + memory.groups + held(),
  };
  return memory;
}

/** What may be dropped, least recently active first; each says whether it found something to drop. */
export interface Evictors {
  texts(): boolean;
  chat(): boolean;
  avatar(): boolean;
  group(): boolean;
  stream(): boolean;
}

/** Brings the account within its limits. */
export function enforce(memory: Memory, evict: Evictors): void {
  while (memory.texts > TEXT_MAX_BYTES && evict.texts());
  while (memory.total() > MEMORY_MAX_BYTES && (evict.texts() || evict.chat() || evict.avatar() || evict.group() || evict.stream()));
}
