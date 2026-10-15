import type { FanslyApiCall, FanslyApiPurpose, FanslyPaceMode } from '@cg/contracts/fansly-api';
import { FanslyApiError } from './errors';

export const FANSLY_API_BASE = 'https://apiv3.fansly.com/api/v1/';

interface Rule {
  readonly method: 'GET' | 'POST';
  readonly path: RegExp;
  readonly family: string;
  readonly queries: readonly string[];
  readonly purposes: Partial<Record<FanslyApiPurpose, FanslyPaceMode>>;
  readonly requiredQuery?: string;
  readonly emptyResponse?: boolean;
}

/** FS-NET-1 and §8.4: permission is a method, path, purpose AND mode. No AI reads. */
export const FANSLY_ALLOWLIST: readonly Rule[] = [
  { method: 'GET', path: /^\/account\/me$/, family: 'account', queries: [], purposes: { identity: 'cooldown' } },
  { method: 'GET', path: /^\/account$/, family: 'account', queries: ['ids'], requiredQuery: 'ids', purposes: { newcomers: 'queue', spenders: 'cooldown', 'notes-read': 'queue' } },
  { method: 'GET', path: /^\/account\/[1-9][0-9]*\/followersnew$/, family: 'account', queries: ['before', 'after', 'limit', 'offset', 'search', 'lastSeenAfter'], purposes: { newcomers: 'queue' } },
  { method: 'GET', path: /^\/messaging\/groups$/, family: 'messagingGroups', queries: ['sortOrder', 'flags', 'subscriptionTierId', 'listIds', 'search', 'limit', 'offset'], purposes: { newcomers: 'queue', spenders: 'cooldown' } },
  { method: 'GET', path: /^\/group\/[1-9][0-9]*$/, family: 'group', queries: [], purposes: { newcomers: 'queue', registration: 'cooldown', 'notes-read': 'queue' } },
  { method: 'POST', path: /^\/group$/, family: 'group', queries: [], purposes: { newcomers: 'queue', spenders: 'queue' } },
  { method: 'GET', path: /^\/message$/, family: 'message', queries: ['groupId', 'limit', 'before'], requiredQuery: 'groupId', purposes: { newcomers: 'queue' } },
  { method: 'GET', path: /^\/message\/automated$/, family: 'message', queries: [], purposes: { newcomers: 'queue' } },
  { method: 'POST', path: /^\/message$/, family: 'message', queries: [], purposes: { greeting: 'immediate' } },
  { method: 'POST', path: /^\/notes$/, family: 'notes', queries: [], purposes: { 'notes-write': 'immediate' } },
  { method: 'POST', path: /^\/notes\/edit$/, family: 'notes', queries: [], purposes: { 'notes-write': 'immediate' } },
  { method: 'POST', path: /^\/notes\/delete$/, family: 'notes', queries: [], purposes: { 'notes-write': 'immediate' }, emptyResponse: true },
];

export function admit(call: FanslyApiCall): { url: URL; family: string; emptyResponse: boolean } {
  const fail = (): never => { throw new FanslyApiError('CG-FAN-REQUEST', 'before-dispatch'); };
  if (!/^[1-9][0-9]{0,39}$/.test(call.accountId) || !Number.isSafeInteger(call.tabId) || call.tabId < 0 || !/^\/[a-zA-Z0-9/]+$/.test(call.path)) return fail();
  const rule = FANSLY_ALLOWLIST.find((row) => row.method === call.method && row.path.test(call.path) && Object.hasOwn(row.purposes, call.purpose) && row.purposes[call.purpose] === call.mode);
  if (rule === undefined || (call.method === 'GET' && call.body !== undefined) || (call.method === 'POST' && (typeof call.body !== 'object' || call.body === null || Array.isArray(call.body)))) return fail();
  if (call.retry !== undefined && call.retry !== 'none' && (call.retry !== 'transient' || call.method !== 'GET' || call.mode !== 'queue')) return fail();
  const url = new URL(call.path.slice(1), FANSLY_API_BASE);
  for (const [name, value] of Object.entries(call.query ?? {})) {
    if (!rule.queries.includes(name) || typeof value !== 'string' || value.length > 8192) return fail();
    url.searchParams.set(name, value);
  }
  if (rule.requiredQuery && !url.searchParams.get(rule.requiredQuery)) return fail();
  const followers = /^\/account\/([1-9][0-9]*)\/followersnew$/.exec(call.path);
  if (followers !== null && followers[1] !== call.accountId) return fail();
  for (const name of ['ids', 'groupId']) {
    const value = url.searchParams.get(name);
    if (value !== null && !(name === 'ids' ? /^[1-9][0-9]{0,39}(?:,[1-9][0-9]{0,39})*$/ : /^[1-9][0-9]{0,39}$/).test(value)) return fail();
  }
  // A traversal, origin override or encoded separator cannot reach dispatch.
  if (!url.href.startsWith(FANSLY_API_BASE)) return fail();
  url.searchParams.set('ngsw-bypass', 'true');
  return { url, family: rule.family, emptyResponse: rule.emptyResponse === true };
}
