// The operation journal of R10's scheduler on R07's results store
// (architecture.md §7 «Жизнь в фоне», §9.4 «Пределы хранилищ»).
//
// The scheduler persists through a key-value port: one value under `ops.v1`
// with every run — `{ v: 1, ops: [{ view, meta }] }` — rewritten whole at an
// admission, at a phase change and at the end. R07's results store keeps the
// same views one key per result (`result.<opId>` + `results.index`), with the
// budgets of §9.4, its own eviction and the recovery after an unload. Two
// writers of the same data would double it in storage.session, so there is
// one: this adapter turns the scheduler's whole-value write into the store's
// per-result writes.
// - A view goes to the results store only when it changed since this
//   background last wrote it (a 4 MiB value is not rewritten for one phase).
// - The scheduler's own facts about a run (who started it, the request key,
//   the environment tag, the fan label, the freshness checkpoint) are not a
//   view: they live next to the index in one small session key. A view whose
//   facts are missing is not handed back (the scheduler would drop it anyway).
// - A failed write rejects: the scheduler refuses the admission rather than
//   ask the hub without a journal record (§7 «до запроса в хаб»).
// - A result is removed only when the scheduler knew it and dropped it;
//   anything else leaves by the store's own 30-minute sweep.

import { OPS_STORE_KEY, type KeyValueStore as ThrowingStore, type ResultsStore } from '@cg/core/services';
import { type KeyValueStore } from '@cg/platform';

import { StorageCallError } from './ports';

/** storage.session key of the scheduler's per-run facts (ids, tags, flags — no stream text). */
export const OPS_META_KEY = 'ops.meta.v1';

interface StoredOp {
  readonly view: { readonly opId: string };
  readonly meta: { readonly startedBy: string | null };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function readOps(value: unknown): StoredOp[] | null {
  if (!isRecord(value) || value['v'] !== 1 || !Array.isArray(value['ops'])) return null;
  const ops: StoredOp[] = [];
  for (const item of value['ops'] as unknown[]) {
    if (!isRecord(item) || !isRecord(item['view']) || typeof item['view']['opId'] !== 'string' || !isRecord(item['meta'])) return null;
    const startedBy = item['meta']['startedBy'];
    if (startedBy !== null && typeof startedBy !== 'string') return null;
    ops.push(item as unknown as StoredOp);
  }
  return ops;
}

/** FNV-1a over the JSON of a view: «did it change since the last write», not an identity. */
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

export function opsStoreOver(results: ResultsStore, session: KeyValueStore): ThrowingStore {
  /** What this background last wrote (or read) per operation. */
  const written = new Map<string, string>();
  let lastMeta: string | null = null;

  return {
    async get(key) {
      if (key !== OPS_STORE_KEY) return undefined;
      await results.start();
      const [listed, metaRead] = await Promise.all([results.list({ scope: 'all' }), session.get([OPS_META_KEY])]);
      if (!metaRead.ok) throw new StorageCallError(metaRead.code, OPS_META_KEY);
      const stored = metaRead.value[OPS_META_KEY];
      const metas = isRecord(stored) ? stored : {};
      const ops: { view: unknown; meta: unknown }[] = [];
      for (const view of listed.ops) {
        const meta = metas[view.opId];
        if (meta === undefined) continue;
        ops.push({ view, meta });
        written.set(view.opId, fingerprint(view));
      }
      return ops.length === 0 ? undefined : { v: 1, ops };
    },

    async set(key, value) {
      if (key !== OPS_STORE_KEY) throw new StorageCallError('CG-STORAGE-WRITE', key);
      const ops = readOps(value);
      if (ops === null) throw new StorageCallError('CG-STORAGE-WRITE', key);

      // The facts first: a view without them is never handed back.
      const metas = Object.fromEntries(ops.map((op) => [op.view.opId, op.meta]));
      const metaText = JSON.stringify(metas);
      if (metaText !== lastMeta) {
        const saved = await session.set({ [OPS_META_KEY]: metas });
        if (!saved.ok) throw new StorageCallError(saved.code, OPS_META_KEY);
        lastMeta = metaText;
      }

      for (const op of ops) {
        const print = fingerprint(op.view);
        if (written.get(op.view.opId) === print) continue;
        const put = await results.put(op.view as Parameters<ResultsStore['put']>[0], { tabSessionId: op.meta.startedBy });
        if (!put.ok) throw new StorageCallError(put.code, `result ${op.view.opId}`);
        written.set(op.view.opId, print);
        for (const evicted of put.evicted) written.delete(evicted);
      }

      const kept = new Set(ops.map((op) => op.view.opId));
      const dropped = [...written.keys()].filter((opId) => !kept.has(opId));
      if (dropped.length > 0) {
        const gone = new Set(dropped);
        await results.removeWhere((meta) => gone.has(meta.opId));
        for (const opId of dropped) written.delete(opId);
      }
    },
  };
}
