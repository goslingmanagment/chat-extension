// The memory of «Четыре группы» over Fansly's chats, as the background keeps it (2026-11-13; contracts
// fansly-filters.ts, groups spec §9): the one owner of `fansly.filters` in storage.local, for `fansly.filters.read`
// and `fansly.filters.remember`.
//
// - One key, one person: `{v: 1, owner: '<hubOrigin>|<userId>', accounts: {[creator]: {tier, list, at}}}`. Nobody
//   signed in: an empty memory, nothing written. Another owner than the stored one: the stored value is dropped and the
//   key starts empty for the new one (the pins' rule, services/hosts/fansly/pins.ts).
// - Every read and write is one step of one queue. A creator remembered last goes last when the key is over its budget.
// - Ids and chips' labels only (the creator's own tiers and lists); the log hears counts.

import { EMPTY_FILTER_MEMO, FanslyFilterMemoSchema, type FanslyFilterMemo } from '@cg/contracts/fansly-filters';

import { LOCAL_KEYS, STORAGE_KEY_BUDGETS, stableJson } from '../../../domain/storage';
import { createWriteChain, type KeyValuePort, type ServiceLog } from '../../storage/ports';

export const FANSLY_FILTERS_KEY = LOCAL_KEYS.fanslyFilters;

export interface FanslyFiltersMemoryDeps {
  readonly local: KeyValuePort;
  readonly now: () => number;
  /** Who is signed in now (`<hubOrigin>|<userId>`); null — nobody. */
  readonly owner: () => string | null;
  readonly log?: ServiceLog;
}

export interface FanslyFiltersMemory {
  read(creator: string): Promise<FanslyFilterMemo>;
  remember(creator: string, group: 'tier' | 'list', key: string | null): Promise<FanslyFilterMemo>;
}

/** The store could not be read or written. */
export class FanslyFiltersStorageError extends Error {
  constructor(readonly code: 'CG-STORAGE-READ' | 'CG-STORAGE-WRITE' | 'CG-STORAGE-FULL') {
    super(code);
  }
}

interface Stored {
  readonly v: 1;
  readonly owner: string;
  readonly accounts: Readonly<Record<string, FanslyFilterMemo & { readonly at: number }>>;
}

const SCOPE = 'bg.fansly.filters';

/** The stored value of this owner; anything else (none, another owner, damaged) — empty. */
function readStore(raw: unknown, owner: string): { readonly store: Stored; readonly foreign: boolean } {
  const empty: Stored = { v: 1, owner, accounts: {} };
  if (typeof raw !== 'object' || raw === null) return { store: empty, foreign: false };
  const value = raw as { v?: unknown; owner?: unknown; accounts?: unknown };
  if (value.v !== 1 || typeof value.owner !== 'string' || typeof value.accounts !== 'object' || value.accounts === null) return { store: empty, foreign: false };
  if (value.owner !== owner) return { store: empty, foreign: true };
  const accounts: Record<string, FanslyFilterMemo & { readonly at: number }> = {};
  for (const [creator, entry] of Object.entries(value.accounts as Record<string, unknown>)) {
    const memo = FanslyFilterMemoSchema.safeParse(typeof entry === 'object' && entry !== null ? { tier: (entry as { tier?: unknown }).tier ?? null, list: (entry as { list?: unknown }).list ?? null } : null);
    const at = typeof entry === 'object' && entry !== null ? (entry as { at?: unknown }).at : undefined;
    if (memo.success && /^\d{1,24}$/.test(creator)) accounts[creator] = { ...memo.data, at: typeof at === 'number' && Number.isFinite(at) ? at : 0 };
  }
  return { store: { v: 1, owner, accounts }, foreign: false };
}

export function createFanslyFiltersMemory(deps: FanslyFiltersMemoryDeps): FanslyFiltersMemory {
  const log = deps.log ?? (() => undefined);
  const chain = createWriteChain();
  const budget = STORAGE_KEY_BUDGETS[FANSLY_FILTERS_KEY] ?? 64 * 1024;

  const run = (creator: string, change: { readonly group: 'tier' | 'list'; readonly key: string | null } | null): Promise<FanslyFilterMemo> => {
    const asked = deps.owner();
    return chain(async () => {
      const owner = deps.owner();
      if (owner === null || owner !== asked) return EMPTY_FILTER_MEMO;
      const got = await deps.local.get([FANSLY_FILTERS_KEY]);
      if (!got.ok) {
        log({ level: 'warn', scope: SCOPE, msg: 'filters memory not read', code: got.code });
        throw new FanslyFiltersStorageError('CG-STORAGE-READ');
      }
      const raw = got.value[FANSLY_FILTERS_KEY];
      const { store, foreign } = readStore(raw, owner);
      if (foreign) log({ level: 'info', scope: SCOPE, msg: 'filters memory of another owner dropped' });
      const before = store.accounts[creator];
      const memo: FanslyFilterMemo = before === undefined ? EMPTY_FILTER_MEMO : { tier: before.tier, list: before.list };
      if (change === null) return memo;
      const after: FanslyFilterMemo = change.group === 'tier' ? { ...memo, tier: change.key } : { ...memo, list: change.key };
      const accounts: Record<string, FanslyFilterMemo & { readonly at: number }> = { ...store.accounts };
      if (after.tier === null && after.list === null) delete accounts[creator];
      else accounts[creator] = { ...after, at: deps.now() };
      // Over the budget: the creators remembered longest ago go first.
      let next: Stored = { v: 1, owner, accounts };
      while (stableJson(next).length * 2 > budget && Object.keys(next.accounts).length > 1) {
        const oldest = Object.entries(next.accounts).sort((a, b) => a[1].at - b[1].at)[0]?.[0];
        if (oldest === undefined) break;
        const rest = { ...next.accounts };
        delete rest[oldest];
        next = { v: 1, owner, accounts: rest };
      }
      if (raw === undefined ? Object.keys(next.accounts).length > 0 : stableJson(next) !== stableJson(raw)) {
        const written = Object.keys(next.accounts).length === 0 ? await deps.local.remove([FANSLY_FILTERS_KEY]) : await deps.local.set({ [FANSLY_FILTERS_KEY]: next });
        if (!written.ok) {
          log({ level: 'warn', scope: SCOPE, msg: 'filters memory not written', code: written.code });
          throw new FanslyFiltersStorageError(written.code === 'CG-STORAGE-FULL' ? 'CG-STORAGE-FULL' : 'CG-STORAGE-WRITE');
        }
      }
      return after;
    });
  };

  return {
    read: (creator) => run(creator, null),
    remember: (creator, group, key) => run(creator, { group, key }),
  };
}
