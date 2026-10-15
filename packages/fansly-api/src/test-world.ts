// Unit fixtures; never imported by runtime entries.
import type { ApiSession, ApiSessionPort, LimitFact } from './ports';
export function apiWorld() {
  const values = new Map<string, unknown>();
  const templates = new Map<number, ApiSession>([[1, { legacyId: '10', canonicalId: '100', connected: true, headers: { authorization: 'private', 'fansly-client-id': 'client', 'fansly-session-id': 'session', 'fansly-client-ts': 'old', 'fansly-client-check': 'wrong', Origin: 'forbidden' }, checks: { group: 'group-check', account: 'account-check', message: 'message-check' } }]]);
  const facts: LimitFact[] = [];
  const tracked: Array<Parameters<ApiSessionPort['trackOwnRequest']>[0]> = [];
  const session: ApiSessionPort = {
    ready: Promise.resolve(), idle: () => Promise.resolve(),
    forTab: (id) => templates.get(id) ?? null,
    forAccount: (id) => [...templates.values()].find((value) => value.legacyId === id || value.canonicalId === id) ?? null,
    rateLimits: () => facts,
    trackOwnRequest: (request) => { tracked.push(request); return true; },
    recordOwnLimit: (fact) => { const i = facts.findIndex((value) => value.requestId === fact.requestId); if (i < 0) facts.push(fact); else facts[i] = { ...facts[i]!, ...fact }; return Promise.resolve(); },
    disconnect: (id) => { for (const [tab, value] of templates) if (value.legacyId === id || value.canonicalId === id) templates.delete(tab); return Promise.resolve(); },
  };
  const storage = { get: (key: string) => Promise.resolve(structuredClone(values.get(key))), set: (key: string, value: unknown) => { values.set(key, structuredClone(value)); return Promise.resolve(); } };
  return { session, storage, values, facts, tracked, templates };
}
