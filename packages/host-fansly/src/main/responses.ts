// The response table of the XHR observer (docs/project-unite/architecture.md
// §5.4; fansly-web.md §4): which answers of the page MAIN reads, told apart
// without a hook on `open` — by `responseURL` and the answer's own form — and
// the bounded queue of the ones read later.
//
// | path (`ngsw-bypass=true` ignored)      | kind      | the form the table asks                          |
// |----------------------------------------|-----------|--------------------------------------------------|
// | `/message` + `groupId`, no `before`     | history   | `messages[]` — the fresh end, a certificate's candidate |
// | `/message` + `groupId` + `before`       | older     | `messages[]` — an older page                      |
// | exactly `/message`, no `groupId`        | receipt   | `id`, `groupId` — the answer of `POST /message`   |
// | `/messages?ids=`                       | byIds     | `messages[]`                                     |
// | `/message/unread`                      | unread    | `messageInteractions[]`                          |
// | `/group/<id>/` or `/group/<id>`         | group     | `id === <id>`, `type` a number, `users[]` — the same address answers a `POST` (members added) with less; a part is not the group |
// | `/messaging/groups`                    | groups    | `data[]`                                         |
// | `/account/me`                          | me        | `account.id` — the creator                       |
// | `/account?ids=`                        | accounts  | an array — the page's account cache: avatars (P7b) |
// | `/message/automated`                   | automated | an array — the welcome texts                     |
// | exactly `/vault/albums/media`          | vault     | `success` alone: the page reads no more (P3a)    |
//
// Every answer: status 2xx, `{success: true, response}` (the page's envelope,
// main:28316-28420). The method is not known without a hook on `open`; the
// page reads `/message` without `groupId` and `/vault/albums/media` only as
// the answers of its `POST`s.
//
// An answer up to RESPONSE_NOW_CHARS is read at `loadend`; a longer one (the
// inbox, up to 115 KB) is kept as its string — never the request — in a
// queue of at most DEFERRED_MAX_ITEMS answers and DEFERRED_MAX_CHARS, read
// when the page is idle (`requestIdleCallback`, within its slice) or drained
// with a budget before a snapshot (P7b). An answer over RESPONSE_MAX_CHARS,
// or one the full queue cannot take, is not read: an explicit loss — the
// area it names becomes unknown — never a long block (§5.4: the P3a
// calibration, 115 KB in 0.2 ms).
//
// Which chats the table's answers certify, and what they say of groups and
// fans, is the observation's (observation.ts, identity.ts, P7b); the creator
// (`me`) and the vault's confirmation are the runtime's. The fresh end keeps
// the page's own `limit=`: an answer shorter than it proves the start (§5.6).

import { idOf, isPlain } from '@cg/host-kit/main/check';
import type { Guard } from '@cg/host-kit/main/guard';

import { DEFERRED_MAX_CHARS, DEFERRED_MAX_ITEMS, IDLE_RESERVE_MS, IDLE_TIMEOUT_MS } from './protocol';

export type ResponseKind = 'history' | 'older' | 'receipt' | 'byIds' | 'unread' | 'group' | 'groups' | 'me' | 'accounts' | 'automated' | 'vault';

/** An answer of the API by its address: of the table, or `other` — an API answer MAIN does not read. */
export interface ApiCall {
  readonly kind: ResponseKind | 'other';
  /** The chat its address names (`groupId=` of `/message`, `/group/<id>`); null — none. */
  readonly groupId: string | null;
  /** The page's `limit=` of the history (a positive integer); null — absent or another. */
  readonly limit?: number | null;
}

const OTHER: ApiCall = { kind: 'other', groupId: null };

/** An answer read: its kind, the chat its address names, and the `response` of its envelope, of the table's form. */
export interface ResponseRead extends ApiCall {
  readonly response: unknown;
}

const API_PATH = '/api/v1/';
const GROUP_PATH = /^group\/(\d+)\/?$/;

const param = (query: string, name: string): string | null => {
  for (const part of query.split('&')) {
    if (part === name) return '';
    if (part.startsWith(`${name}=`)) return part.slice(name.length + 1);
  }
  return null;
};

/**
 * The kind of an answer by its address: the table's, `other` — the API's but not the table's, null — not the API (a
 * string comparison, ≤ 0.01 ms: §5.4). `origins` — the API's origins; one matches with a port after it too (the
 * stand's loopback API).
 */
export function classifyAddress(url: string, origins: readonly string[]): ApiCall | null {
  for (const origin of origins) {
    if (!url.startsWith(origin)) continue;
    let at = origin.length;
    if (url.charCodeAt(at) === 58) {
      at += 1;
      while (url.charCodeAt(at) >= 48 && url.charCodeAt(at) <= 57) at += 1;
    }
    if (!url.startsWith(API_PATH, at)) continue;
    const rest = url.slice(at + API_PATH.length);
    const cut = rest.indexOf('?');
    const path = cut < 0 ? rest : rest.slice(0, cut);
    const query = cut < 0 ? '' : rest.slice(cut + 1);
    switch (path) {
      case 'message': {
        const group = param(query, 'groupId');
        if (group === null) return { kind: 'receipt', groupId: null };
        const groupId = idOf(group);
        const limit = Number(param(query, 'limit') ?? NaN);
        return groupId === null ? OTHER : { kind: param(query, 'before') === null ? 'history' : 'older', groupId, limit: Number.isSafeInteger(limit) && limit > 0 ? limit : null };
      }
      case 'messages':
        return param(query, 'ids') === null ? OTHER : { kind: 'byIds', groupId: null };
      case 'message/unread':
        return { kind: 'unread', groupId: null };
      case 'messaging/groups':
        return { kind: 'groups', groupId: null };
      case 'account/me':
        return { kind: 'me', groupId: null };
      case 'account':
        return param(query, 'ids') === null ? OTHER : { kind: 'accounts', groupId: null };
      case 'message/automated':
        return { kind: 'automated', groupId: null };
      case 'vault/albums/media':
        return { kind: 'vault', groupId: null };
      default: {
        const groupId = idOf(GROUP_PATH.exec(path)?.[1]);
        return groupId === null ? OTHER : { kind: 'group', groupId };
      }
    }
  }
  return null;
}

/** Whether `response` has the form the table asks of its kind (the header of this file). */
function ofForm(call: ApiCall, response: unknown): boolean {
  if (call.kind === 'other') return false;
  if (call.kind === 'vault') return true;
  if (call.kind === 'automated' || call.kind === 'accounts') return Array.isArray(response);
  if (!isPlain(response)) return false;
  switch (call.kind) {
    case 'history':
    case 'older':
    case 'byIds':
      return Array.isArray(response['messages']);
    case 'receipt':
      return idOf(response['id']) !== null && idOf(response['groupId']) !== null;
    case 'unread':
      return Array.isArray(response['messageInteractions']);
    case 'group':
      return idOf(response['id']) === call.groupId && typeof response['type'] === 'number' && Array.isArray(response['users']);
    case 'groups':
      return Array.isArray(response['data']);
    case 'me':
      return isPlain(response['account']) && idOf(response['account']['id']) !== null;
  }
}

/** Parses an answer of the table: `{success: true, response}` of the table's form; null — not one (damaged, refused, another form). */
export function readResponse(call: ApiCall, text: string, parse: (text: string) => unknown): ResponseRead | null {
  let body: unknown;
  try {
    body = parse(text);
  } catch {
    // The page could not read it either.
    return null;
  }
  if (!isPlain(body) || body['success'] !== true) return null;
  const response = body['response'];
  return ofForm(call, response) ? { ...call, response } : null;
}

/** An answer waiting to be read: its call, its text and whatever the runtime stamped it with at `loadstart`. */
export interface Deferred<S> {
  readonly call: ApiCall;
  readonly text: string;
  readonly stamp: S | undefined;
}

export interface ResponseQueue<S> {
  /** Keeps the answer for later; false — the queue is full: the answer is lost. */
  push(item: Deferred<S>): boolean;
  /** Reads waiting answers until `budgetMs` is spent (a snapshot's bounded drain, P7b); true — nothing waits. */
  drain(budgetMs: number): boolean;
  size(): number;
  /** Characters waiting (a string of them — two bytes a character at most: the memory account, §5.5). */
  chars(): number;
}

export interface QueueNatives {
  readonly now: () => number;
  /** requestIdleCallback as captured at install; null — the browser has none. */
  readonly idle: ((callback: (deadline: IdleDeadline) => void, options: { timeout: number }) => unknown) | null;
  /** setTimeout as captured at install: the stand-in for an idle callback. */
  readonly later: (callback: () => void, ms: number) => unknown;
  readonly guard: Guard;
}

/** The deferred-parse queue; `read` handles one answer, `idled` closes the idle callback (the runtime's flush). */
export function createResponseQueue<S>(natives: QueueNatives, read: (item: Deferred<S>) => void, idled: () => void): ResponseQueue<S> {
  const { now, idle, later, guard } = natives;
  const items: Array<Deferred<S>> = [];
  let chars = 0;
  let asked = false;

  const one = (): void => {
    const item = items.shift();
    if (item === undefined) return;
    chars -= item.text.length;
    read(item);
  };

  const onIdle = guard('xhrIdle', (deadline?: IdleDeadline) => {
    asked = false;
    // A timer stands in for a browser without idle callbacks: one answer a turn.
    if (deadline === undefined) one();
    else while (items.length > 0 && (deadline.didTimeout || deadline.timeRemaining() > IDLE_RESERVE_MS)) one();
    if (items.length > 0) ask();
    idled();
  });
  const ask = (): void => {
    if (asked) return;
    asked = true;
    if (idle !== null) idle(onIdle, { timeout: IDLE_TIMEOUT_MS });
    else later(onIdle, 0);
  };

  return {
    push(item) {
      if (items.length >= DEFERRED_MAX_ITEMS || chars + item.text.length > DEFERRED_MAX_CHARS) return false;
      items.push(item);
      chars += item.text.length;
      ask();
      return true;
    },
    drain(budgetMs) {
      const until = now() + budgetMs;
      while (items.length > 0 && now() < until) one();
      return items.length === 0;
    },
    size: () => items.length,
    chars: () => chars,
  };
}
