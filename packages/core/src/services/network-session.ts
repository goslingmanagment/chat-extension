import type { NetworkSessionSnapshot } from '@cg/contracts/diagnostics';
// Background-core observation (§3.3, §8.2). Site data is injected by the
// composition root. No transport, API client, page code or session logging.
import { createWriteChain, type KeyValuePort } from './storage/ports';

export interface RequestFact {
  readonly phase: 'headers' | 'completed' | 'error';
  readonly requestId: string;
  readonly url: string;
  readonly tabId: number;
  readonly frameId: number;
  readonly documentUrl?: string;
  readonly originUrl?: string;
  readonly requestHeaders?: readonly { readonly name: string; readonly value?: string }[];
  readonly statusCode?: number;
}
export interface SessionTemplate {
  readonly legacyId: string;
  canonicalId: string | null;
  /** Captured samples: the API client regenerates per-request timestamps and selects a route check from `checks`. */
  headers: Record<string, string>;
  /** Latest accepted check per route family in memory; persisted on meaningful session changes. */
  checks: Record<string, string>;
  observedAt: number;
  connected: boolean;
}
export interface RateLimitFact {
  readonly requestId: string;
  readonly at: number;
  /** null means every creator, including one learned after this response. */
  readonly accountId: string | null;
  readonly source: 'own' | 'page' | 'unknown';
}
interface Candidate {
  tabId: number;
  at: number;
  legacyId: string;
  headers: Record<string, string>;
  family: string | null;
}
interface Snapshot {
  v: 1;
  templates: SessionTemplate[];
  tabs: [number, string][];
  registered: number[];
  tabTimes: [number, number][];
  limits: RateLimitFact[];
}
export interface NetworkSessionDeps {
  readonly storage: KeyValuePort;
  readonly key: string;
  readonly now: () => number;
  readonly pageRequest: (fact: RequestFact) => boolean;
  readonly apiRequest: (url: string) => boolean;
  readonly ownOrigin: string;
  readonly requiredHeaders: readonly string[];
  readonly checkHeader: string;
  /** Stable session identity: changes reset route checks and require persistence. */
  readonly materialHeaders: readonly string[];
  readonly accountOf: (authorization: string) => string | null;
  readonly familyOf: (url: string) => string | null;
}

const MAX_PENDING = 256;
const MAX_ACCOUNTS = 128;
const PENDING_MS = 120_000;
const FACT_MS = 24 * 60 * 60_000;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,39}$/.test(value);
const headerMap = (value: unknown): value is Record<string, string> => record(value) && Object.entries(value).length <= 16 && Object.values(value).every((v) => typeof v === 'string' && v.length <= 8192);

export function createNetworkSession(deps: NetworkSessionDeps) {
  const chain = createWriteChain();
  const templates = new Map<string, SessionTemplate>();
  const tabs = new Map<number, string>();
  const registered = new Set<number>();
  const tabTimes = new Map<number, number>();
  const pending = new Map<string, Candidate>();
  const own = new Map<string, string>();
  const limits: RateLimitFact[] = [];
  let sequenceAt = 0;
  let readable = false;
  let enabled = false;
  let dirty = false;
  let flushing: Promise<void> | null = null;
  const snapshot = (): Snapshot => ({ v: 1, templates: [...templates.values()].map((value) => ({ ...value, headers: { ...value.headers }, checks: { ...value.checks } })), tabs: [...tabs], registered: [...registered], tabTimes: [...tabTimes], limits: [...limits] });
  const canonical = (legacy: string): string => templates.get(legacy)?.canonicalId ?? legacy;
  const prune = (): void => {
    for (const [key, value] of pending) if (value.at < deps.now() - PENDING_MS) pending.delete(key);
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value as string);
    while (own.size > MAX_PENDING) own.delete(own.keys().next().value as string);
    while (limits.length > MAX_PENDING || (limits[0]?.at ?? deps.now()) < deps.now() - FACT_MS) { limits.shift(); dirty = true; }
  };
  const save = async (): Promise<void> => {
    prune();
    if (!dirty) return;
    const result = await deps.storage.set({ [deps.key]: snapshot() });
    if (!result.ok) { readable = false; throw new Error(result.code); }
    dirty = false;
  };
  const ready = chain(async () => {
    const stored = await deps.storage.get([deps.key]);
    if (!stored.ok) throw new Error(stored.code);
    const raw = stored.value[deps.key];
    if (record(raw) && raw['v'] === 1) {
      if (Array.isArray(raw['templates'])) for (const value of raw['templates'].slice(-MAX_ACCOUNTS)) {
        if (record(value) && id(value['legacyId']) && (value['canonicalId'] === null || id(value['canonicalId'])) && headerMap(value['headers']) && headerMap(value['checks']) && typeof value['observedAt'] === 'number' && typeof value['connected'] === 'boolean') templates.set(value['legacyId'], value as unknown as SessionTemplate);
      }
      if (Array.isArray(raw['tabs'])) for (const pair of raw['tabs']) if (Array.isArray(pair) && Number.isInteger(pair[0]) && pair[0] >= 0 && id(pair[1]) && templates.has(pair[1])) tabs.set(pair[0] as number, pair[1]);
      if (Array.isArray(raw['registered'])) for (const value of raw['registered']) if (typeof value === 'number' && Number.isInteger(value) && value >= 0) registered.add(value);
      if (Array.isArray(raw['tabTimes'])) for (const pair of raw['tabTimes']) if (Array.isArray(pair) && tabs.has(pair[0] as number) && typeof pair[1] === 'number' && Number.isFinite(pair[1])) tabTimes.set(pair[0] as number, pair[1]);
      // Old snapshots have no per-tab clock. No in-flight request is restored,
      // so future observations safely start after every saved account clock.
      if (Array.isArray(raw['limits'])) for (const value of raw['limits'].slice(-MAX_PENDING)) if (record(value) && typeof value['requestId'] === 'string' && typeof value['at'] === 'number' && (value['accountId'] === null || id(value['accountId'])) && ['own', 'page', 'unknown'].includes(String(value['source']))) limits.push(value as unknown as RateLimitFact);
    }
    sequenceAt = Math.max(0, ...[...templates.values()].map((value) => value.observedAt), ...[...tabTimes.values()]);
    prune();
    readable = true;
  });
  // A read failure remains fail-closed, but does not become an unhandled rejection before the readiness barrier.
  void ready.catch(() => undefined);
  // Mutations arriving in the same burst share one queued write. The returned
  // promise still covers persistence (and its failure), before an API user runs.
  const flush = (): Promise<void> => {
    if (flushing === null) {
      flushing = chain(save).finally(() => { flushing = null; });
    }
    return flushing;
  };
  const run = (task: () => void): Promise<void> => chain(async () => { await ready; task(); }).then(flush);

  const service = {
    ready,
    /** The permission/settings controller changes this before accepting any API observation. */
    setEnabled(value: boolean): Promise<void> {
      enabled = value;
      return run(() => {
        if (!value) {
          dirty ||= templates.size > 0 || tabs.size > 0 || registered.size > 0;
          templates.clear(); tabs.clear(); tabTimes.clear(); registered.clear(); pending.clear(); own.clear();
        }
        // Keep 429 facts across a revoke/regrant; an unchanged enable is read-only.
      });
    },
    accept(fact: RequestFact): Promise<void> {
      if (!enabled || !deps.apiRequest(fact.url)) return Promise.resolve();
      return run(() => {
        if (!enabled) return;
        prune();
        const isOwn = fact.originUrl?.startsWith(deps.ownOrigin) === true || fact.documentUrl?.startsWith(deps.ownOrigin) === true;
        if (fact.phase === 'headers') {
          pending.delete(fact.requestId);
          const headers: Record<string, string> = {};
          const names = [...deps.requiredHeaders, deps.checkHeader];
          for (const header of fact.requestHeaders ?? []) {
            const name = header.name.toLowerCase();
            if (names.includes(name) && header.value !== undefined && header.value.length <= 8192) headers[name] = header.value;
          }
          const legacyId = deps.accountOf(headers['authorization'] ?? '');
          if (legacyId !== null && isOwn) own.set(fact.requestId, legacyId);
          if (!isOwn && legacyId !== null && deps.pageRequest(fact) && deps.requiredHeaders.every((name) => !!headers[name])) {
            sequenceAt = Math.max(deps.now(), sequenceAt + 0.001);
            pending.set(fact.requestId, { tabId: fact.tabId, at: sequenceAt, legacyId, headers, family: deps.familyOf(fact.url) });
          }
          return;
        }
        const candidate = pending.get(fact.requestId);
        pending.delete(fact.requestId);
        if (fact.phase === 'completed' && fact.statusCode === 429 && !limits.some((value) => value.requestId === fact.requestId)) {
          const legacy = isOwn && fact.tabId < 0 ? own.get(fact.requestId) : registered.has(fact.tabId) ? tabs.get(fact.tabId) : undefined;
          dirty = true;
          limits.push({ requestId: fact.requestId, at: deps.now(), accountId: legacy === undefined ? null : canonical(legacy), source: isOwn ? 'own' : deps.pageRequest(fact) ? 'page' : 'unknown' });
        }
        own.delete(fact.requestId);
        if (candidate !== undefined && fact.phase === 'completed' && fact.tabId === candidate.tabId && deps.pageRequest(fact) && (fact.statusCode ?? 0) >= 200 && (fact.statusCode ?? 0) < 300) {
          const previous = templates.get(candidate.legacyId);
          const oldLegacy = tabs.get(candidate.tabId);
          // A different tab may refresh either account's template. It must
          // never advance this tab's association clock or prevent its binding.
          if ((tabTimes.get(candidate.tabId) ?? 0) <= candidate.at) {
            tabTimes.set(candidate.tabId, candidate.at);
            if (previous === undefined || previous.observedAt <= candidate.at) {
              const material = previous === undefined || deps.materialHeaders.some((name) => previous.headers[name] !== candidate.headers[name]);
              const checks = material ? {} : { ...previous?.checks };
              const check = candidate.headers[deps.checkHeader];
              const learnedFamily = candidate.family !== null && check !== undefined && checks[candidate.family] === undefined;
              if (candidate.family !== null && check !== undefined) checks[candidate.family] = check;
              // Timestamps and rotating checks stay fresh in memory, but must
              // not turn every 2xx into a whole-snapshot write. A new family is
              // durable so its accepted check is available after a wake.
              const changed = material || previous?.connected !== true || learnedFamily;
              dirty ||= changed;
              templates.set(candidate.legacyId, { legacyId: candidate.legacyId, canonicalId: previous?.canonicalId ?? null, headers: candidate.headers, checks, observedAt: candidate.at, connected: true });
            }
            dirty ||= oldLegacy !== candidate.legacyId;
            tabs.set(candidate.tabId, candidate.legacyId);
            if (oldLegacy !== undefined && oldLegacy !== candidate.legacyId && ![...tabs.values()].includes(oldLegacy)) templates.delete(oldLegacy);
            while (templates.size > MAX_ACCOUNTS) templates.delete(templates.keys().next().value as string);
          }
        }
      });
    },
    register(tabId: number): Promise<void> { return run(() => { dirty ||= !registered.has(tabId); registered.add(tabId); }); },
    forget(tabId: number): Promise<void> {
      return run(() => {
        const legacy = tabs.get(tabId);
        dirty ||= tabs.has(tabId) || registered.has(tabId);
        tabs.delete(tabId); tabTimes.delete(tabId); registered.delete(tabId);
        for (const [key, value] of pending) if (value.tabId === tabId) pending.delete(key);
        if (legacy !== undefined && ![...tabs.values()].includes(legacy)) templates.delete(legacy);
      });
    },
    /** The identity response is bound to the exact captured legacy session, never matched by name. */
    resolveIdentity(tabId: number, legacyId: string, canonicalId: string): Promise<void> {
      return run(() => {
        const template = templates.get(legacyId);
        if (!id(canonicalId) || tabs.get(tabId) !== legacyId || template === undefined) return;
        dirty ||= template.canonicalId !== canonicalId;
        template.canonicalId = canonicalId;
        for (let i = 0; i < limits.length; i++) {
          const fact = limits[i];
          if (fact?.accountId === legacyId && legacyId !== canonicalId) { limits[i] = { ...fact, accountId: canonicalId }; dirty = true; }
        }
      });
    },
    disconnect(accountId: string): Promise<void> {
      return run(() => { for (const value of templates.values()) if (value.connected && (value.legacyId === accountId || value.canonicalId === accountId)) { value.connected = false; dirty = true; } });
    },
    forTab(tabId: number): SessionTemplate | null { const legacy = tabs.get(tabId); return legacy === undefined ? null : service.forAccount(legacy); },
    forAccount(accountId: string): SessionTemplate | null {
      if (!readable || !enabled) return null;
      const value = [...templates.values()].find((entry) => entry.connected && (entry.legacyId === accountId || entry.canonicalId === accountId));
      return value?.connected === true ? { ...value, headers: { ...value.headers }, checks: { ...value.checks } } : null;
    },
    /** Safe page projection: explicitly assembled, never a spread of a transport template. */
    diagnostics(tabId: number): NetworkSessionSnapshot {
      const legacy = tabs.get(tabId);
      const value = readable && enabled && legacy !== undefined ? templates.get(legacy) : undefined;
      const allowed = new Set([...deps.requiredHeaders, deps.checkHeader]);
      return {
        present: value?.connected === true,
        ageMs: value === undefined ? null : Math.max(0, Math.floor(deps.now() - value.observedAt)),
        accountId: value === undefined ? null : value.canonicalId ?? value.legacyId,
        headerNames: value === undefined ? [] : Object.keys(value.headers).filter((name) => allowed.has(name) && /^[a-z][a-z0-9-]{0,63}$/.test(name)).sort().slice(0, 16),
      };
    },
    /** IDs only, including disconnected templates: a previously seen model is still our own. */
    aliases(accountId: string): readonly string[] {
      if (!readable) return [];
      return [...new Set([...templates.values()].filter((entry) => entry.legacyId === accountId || entry.canonicalId === accountId).flatMap((entry) => entry.canonicalId === null ? [entry.legacyId] : [entry.legacyId, entry.canonicalId]))];
    },
    rateLimits(): readonly RateLimitFact[] { return readable ? limits.map((fact) => ({ ...fact })) : []; },
    idle: () => run(() => undefined),
  };
  return service;
}
export type NetworkSession = ReturnType<typeof createNetworkSession>;

/** The legacy account prefix of a base64 session token; ids stay decimal strings. */
export function legacyAccount(token: string): string | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(token) || token.length % 4 !== 0 || token.length > 8192) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0;
  let buffer = 0;
  let prefix = '';
  for (const char of token) {
    if (char === '=') break;
    buffer = (buffer << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits < 8) continue;
    bits -= 8;
    const byte = (buffer >>> bits) & 255;
    if (byte === 58) return id(prefix) ? prefix : null;
    if (byte < 48 || byte > 57 || prefix.length >= 40) return null;
    prefix += String.fromCharCode(byte);
  }
  return null;
}
