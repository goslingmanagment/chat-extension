// R20 P9e: only missing names and a person's chat-resolution click. Every
// request is admitted and paced by P9b; no history, ack, or message send.
import type { FanslyClient } from './client';
import type { PacerStorage } from './pacer';
import { FanslyApiError } from './errors';

export const NAMES_STORAGE_KEY = 'fansly.spenders.names';
export const NAMES_TTL_MS = 6 * 60 * 60_000;
export const RESOLVE_BUDGET_MS = 15_000;
const ID = /^[1-9]\d{0,23}$/;
const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim().slice(0, 1000) : null;
const id = (value: unknown): string | null => typeof value === 'string' && ID.test(value) ? value : null;
const malformed = (): FanslyApiError => new FanslyApiError('malformed', { sent: true });

export interface SpenderName { readonly fanRef: string; readonly name: string; readonly username: string | null; readonly displayName: string | null }
export interface SpenderFan { readonly fanRef: string; readonly displayName: string | null; readonly username: string | null }

/** Exact membership fence: never use a same-named account, group chat, or another creator's conversation. */
function directGroup(value: unknown, account: string, fan: string): string | null {
  const group = record(value);
  const members = list(group?.['users']).map((user) => id(record(user)?.['userId']));
  return group?.['type'] !== 3 && members.length === 2 && new Set(members).size === 2 && members.includes(account) && members.includes(fan) ? id(group?.['id']) : null;
}

export function createSpendersLookup(client: Pick<FanslyClient, 'call'>, now: () => number = Date.now, storage?: PacerStorage) {
  const names = new Map<string, { at: number; value: SpenderName | null }>();
  const groups = new Map<string, string>();
  const pending = new Map<string, Promise<string | null>>();
  let epoch = 0;
  const key = (account: string, fan: string): string => `${account}:${fan}`;
  // Names are not credentials: keep the bounded six-hour cache in storage.local, across event-page sleep.
  const prune = (): void => {
    const counts = new Map<string, number>();
    for (const [cacheKey, entry] of [...names].reverse()) {
      const account = cacheKey.split(':')[0] ?? '';
      const n = (counts.get(account) ?? 0) + 1;
      counts.set(account, n);
      if (n > 2000 || entry.at > now() || now() - entry.at >= NAMES_TTL_MS) names.delete(cacheKey);
    }
    while (names.size > 10_000) names.delete(names.keys().next().value as string);
  };
  const ready = storage === undefined ? Promise.resolve() : storage.get([NAMES_STORAGE_KEY]).then((answer) => {
    if (!answer.ok || epoch !== 0) return;
    const raw = record(answer.value[NAMES_STORAGE_KEY]);
    if (raw?.['v'] !== 1) return;
    for (const tuple of list(raw['entries']).slice(-10_000)) {
      if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== 'string' || !/^[1-9]\d{0,23}:[1-9]\d{0,23}$/.test(tuple[0])) continue;
      const entry = record(tuple[1]);
      const at = entry?.['at'];
      if (typeof at !== 'number' || !Number.isFinite(at)) continue;
      const value = record(entry?.['value']);
      if (entry?.['value'] === null) names.set(tuple[0], { at, value: null });
      else if (value !== null && id(value['fanRef']) === tuple[0].split(':')[1] && text(value['name']) !== null && (value['username'] === null || text(value['username']) !== null) && (value['displayName'] === null || text(value['displayName']) !== null)) {
        names.set(tuple[0], { at, value: { fanRef: value['fanRef'] as string, name: text(value['name']) as string, username: text(value['username']), displayName: text(value['displayName']) } });
      }
    }
    prune();
  }).catch(() => undefined);
  let saving = Promise.resolve();
  const save = (): Promise<void> => {
    const snapshot = { v: 1, entries: [...names] };
    const write = saving.then(async () => { await storage?.set({ [NAMES_STORAGE_KEY]: snapshot }); }).catch(() => undefined);
    saving = write;
    return write;
  };
  let nameQueue = Promise.resolve();
  async function readNames(account: string, fanRefs: readonly string[]): Promise<SpenderName[]> {
      const atEpoch = epoch;
      await ready;
      if (atEpoch !== epoch) return [];
      const requested = [...new Set(fanRefs)];
      if (!ID.test(account) || requested.some((fan) => !ID.test(fan))) throw new FanslyApiError('not-admitted', { sent: false });
      const missing = requested.filter((fan) => now() - (names.get(key(account, fan))?.at ?? -Infinity) >= NAMES_TTL_MS);
      for (let offset = 0; offset < missing.length; offset += 100) {
        const batch = missing.slice(offset, offset + 100);
        const answer = await client.call({ purpose: 'spenders', route: 'account.byIds', account, query: { ids: batch.join(',') } });
        if (atEpoch !== epoch) return [];
        if (!Array.isArray(answer.response)) throw malformed();
        const found = new Map<string, SpenderName>();
        for (const entry of list(answer.response)) {
          const row = record(entry);
          const fanRef = id(row?.['id']);
          if (fanRef === null || !batch.includes(fanRef)) continue;
          const displayName = text(row?.['displayName']);
          const username = text(row?.['username']);
          const note = list(row?.['notes']).map(record).find((note) => note?.['contentType'] === 12002);
          const name = text(note?.['note']) ?? displayName ?? username;
          if (name !== null) found.set(fanRef, { fanRef, name, username, displayName });
        }
        for (const fan of batch) names.set(key(account, fan), { at: now(), value: found.get(fan) ?? null });
        // Bound the cache across creators without allowing a restart of a board to re-buy its names.
        prune();
        await save();
      }
      return requested.flatMap((fan) => { const value = names.get(key(account, fan))?.value; return value === undefined || value === null ? [] : [value]; });
    }
  return {
    cached: (account: string, fan: string): string | null => groups.get(key(account, fan)) ?? null,
    names(account: string, fanRefs: readonly string[]): Promise<SpenderName[]> {
      const atEpoch = epoch;
      const work = nameQueue.then(() => atEpoch === epoch ? readNames(account, fanRefs) : []);
      nameQueue = work.then(() => undefined, () => undefined);
      return work;
    },
    resolve(account: string, fan: SpenderFan): Promise<string | null> {
      const cacheKey = key(account, fan.fanRef);
      const known = groups.get(cacheKey);
      if (known !== undefined) return Promise.resolve(known);
      const running = pending.get(cacheKey);
      if (running !== undefined) return running;
      const atEpoch = epoch;
      const work = (async (): Promise<string | null> => {
        if (!ID.test(account) || !ID.test(fan.fanRef) || account === fan.fanRef) throw new FanslyApiError('not-admitted', { sent: false });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), RESOLVE_BUDGET_MS);
        try {
          const search = fan.displayName?.trim() || fan.username?.trim();
          let groupId: string | null = null;
          if (search) {
            const answer = await client.call({ purpose: 'spenders', route: 'messaging.groups', account, query: { sortOrder: '1', flags: '0', subscriptionTierId: '', listIds: '', search, limit: '100', offset: '0' }, signal: controller.signal });
            const response = record(answer.response);
            if (response === null || !Array.isArray(response['data'])) throw malformed();
            const aggregation = record(response['aggregationData']);
            for (const row of list(response['data']).map(record)) {
              if (row?.['partnerAccountId'] !== fan.fanRef) continue;
              const group = list(aggregation?.['groups']).find((item) => record(item)?.['id'] === row['groupId']);
              groupId = directGroup(group, account, fan.fanRef);
              if (groupId !== null) break;
            }
          }
          // A successful empty search (or no name to search) may get-or-create once by exact identity.
          // A failed/indeterminate request throws: it never falls through to another write or retries.
          if (groupId === null && atEpoch === epoch) {
            const answer = await client.call({ purpose: 'spenders', route: 'group.create', account, body: { users: [{ userId: fan.fanRef, permissionFlags: 0 }, { userId: account, permissionFlags: 0 }], recipients: [], lastMessage: null, userSettings: null, type: 1 }, signal: controller.signal });
            groupId = directGroup(answer.response, account, fan.fanRef);
            if (groupId === null) throw malformed();
          }
          if (atEpoch !== epoch) return null;
          if (groupId !== null) groups.set(cacheKey, groupId);
          while (groups.size > 2000) groups.delete(groups.keys().next().value as string);
          return groupId;
        } finally { clearTimeout(timer); }
      })().finally(() => { if (pending.get(cacheKey) === work) pending.delete(cacheKey); });
      pending.set(cacheKey, work);
      return work;
    },
    clear() { epoch++; names.clear(); groups.clear(); pending.clear(); return ready.then(save); },
    flush: () => saving,
  };
}
