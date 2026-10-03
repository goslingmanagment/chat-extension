// Redaction shared by the console, the disk and the export (architecture.md
// §9.2, LG-003, LG-008, LG-022). One pass over a value does four things:
//
// 1. forbidden field names (`isRedactedLogField`: authorization, bearer,
//    token, password, cookie, session, ticket, secret, apikey and their
//    endings) lose their value at any depth;
// 2. every string that survives is scrubbed of the live secrets (the current
//    hub token and its tail, kept up to date on sign-in and sign-out), of
//    secret SHAPES (`sk-…`, hub device tokens, `Bearer …`, JWTs), of
//    «label=value» pairs and of URL parameters;
// 3. the payload allowlist: a string passes only under a field name that is
//    known to carry machine values (codes, states, ids, versions…). Anything
//    else — `text`, `draft`, `prompt`, `answer`, a fan's name — becomes its
//    length. Texts of conversations, drafts, prompts and model output never
//    reach a log, whoever wrote the call;
// 4. the size limits of LOG_LIMITS: depth 8, 100 array items, 100 keys,
//    20 000 characters per string, with visible truncation marks.
//
// Never throws: cycles, throwing getters, proxies, bigints and symbols all
// become plain JSON. Running it twice changes nothing (idempotent), so the
// background can redact again whatever a tab or a page sent.

import { LOG_LIMITS } from '@cg/contracts/limits';
import { isRedactedLogField } from '@cg/contracts/logs';

export const REDACTED = '[redacted]';

/** Token shapes masked even when their exact value is unknown here (an upstream error string, a pasted header). */
const SECRET_SHAPES: readonly RegExp[] = [
  /\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{8,}/g,
  /\bagency_hub_(?:pending_device|device|core)_[A-Za-z0-9_-]{6,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
];

/** «label=value» and «label: value»: the label stays, the value goes. */
const LABELLED_SECRET =
  /(["']?\b(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization|cookie|session[_-]?id|ticket)["']?\s*[:=]\s*["']?)(?!\[redacted\])([^\s"'&,;)\]}]{3,})/gi;

/** A URL's parameters and fragment are never logged (§9.2): `https://h/p?x` → `https://h/p?[redacted]`. */
const URL_PARAMETERS = /\b((?:https?|wss?|moz-extension):\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi;

/** Shorter exact secrets would mask ordinary words. */
export const MIN_SECRET_LENGTH = 8;
/** The tail of a token is a secret of its own: it is what a support screen shows (DB-027). */
export const TOKEN_TAIL_LENGTH = 8;
/** Previous tokens stay on the list for a while: records written before a sign-out still name them. */
export const SECRET_HISTORY = 8;

/** The live secrets of this context: what the redactor masks by exact value. */
export interface Redactor {
  /** Scrubs one string (secrets, shapes, labels, URL parameters); idempotent. */
  text(value: string): string;
  /** Sign-in hands the new token, sign-out `null`; the list of secrets follows (LG-003). */
  setToken(token: string | null): void;
  /** Extra exact secrets (a pending reservation, an AMO key in a tool). */
  addSecret(value: string): void;
  readonly secretCount: number;
}

export function tokenSecrets(token: string): string[] {
  const out: string[] = [];
  if (token.length >= MIN_SECRET_LENGTH) out.push(token);
  if (token.length >= 2 * TOKEN_TAIL_LENGTH) out.push(token.slice(-TOKEN_TAIL_LENGTH));
  return out;
}

/** Shape-only scrubbing, for contexts that hold no secrets (tabs, pages). */
export function scrubText(value: string, secrets: readonly string[] = []): string {
  let out = value;
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LENGTH && out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  for (const shape of SECRET_SHAPES) out = out.replace(shape, REDACTED);
  out = out.replace(LABELLED_SECRET, (_match, label: string) => `${label}${REDACTED}`);
  out = out.replace(URL_PARAMETERS, (_match, base: string) => `${base}?${REDACTED}`);
  return out;
}

export function createRedactor(): Redactor {
  // Newest first; the current token's values lead.
  let secrets: string[] = [];
  const remember = (values: readonly string[]): void => {
    const merged = [...values, ...secrets.filter((value) => !values.includes(value))];
    // Longest first: a full token is replaced before its own tail.
    secrets = merged.slice(0, SECRET_HISTORY * 2);
  };
  const ordered = (): string[] => [...secrets].sort((a, b) => b.length - a.length);
  let cache: string[] = [];
  return {
    text(value) {
      try {
        return scrubText(value, cache);
      } catch {
        return REDACTED;
      }
    },
    setToken(token) {
      if (token !== null) remember(tokenSecrets(token));
      cache = ordered();
    },
    addSecret(value) {
      if (value.length >= MIN_SECRET_LENGTH) remember([value]);
      cache = ordered();
    },
    get secretCount() {
      return secrets.length;
    },
  };
}

// ── Values ─────────────────────────────────────────────────────────────────

export interface SanitizeLimits {
  readonly maxDepth: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxStringLength: number;
}

export const LOG_VALUE_LIMITS: SanitizeLimits = {
  maxDepth: LOG_LIMITS.maxDepth,
  maxArrayLength: LOG_LIMITS.maxArrayLength,
  maxObjectKeys: LOG_LIMITS.maxObjectKeys,
  maxStringLength: LOG_LIMITS.maxStringLength,
};

/** Field names whose string values are machine data and may be logged as they are (after scrubbing). */
const ALLOWED_STRING_FIELDS: ReadonlySet<string> = new Set([
  'action', 'adapter', 'anchor', 'anchors', 'browser', 'build', 'capabilities', 'capability', 'category', 'client', 'code', 'contract',
  'coverage', 'degraded', 'detail', 'disabled', 'disposition', 'error', 'event', 'failure', 'feature', 'features', 'file', 'flag', 'flags', 'format', 'from',
  'host', 'journal', 'kind', 'level', 'lifecycle', 'locale', 'method', 'metric', 'mime', 'missing', 'mode', 'model', 'name', 'origin',
  'os', 'outcome', 'pagelabel', 'phase', 'platform', 'provider', 'reason', 'result', 'route', 'scope', 'section', 'source', 'stage',
  'stages', 'state', 'status', 'surface', 'theme', 'to', 'tone', 'trigger', 'type', 'unit', 'version', 'via', 'why',
]);

/** Endings of machine-valued field names: `opId`, `chatKey`, `startedAt`, `insertMs`, `draftDigest`… */
const ALLOWED_STRING_SUFFIXES = [
  'id', 'ids', 'ref', 'refs', 'key', 'keys', 'at', 'ms', 'epoch', 'digest', 'hash', 'version', 'code', 'codes', 'status', 'state',
  'kind', 'count', 'bytes', 'chars', 'length', 'revision', 'seq', 'origin', 'build', 'reason', 'route', 'stage', 'phase', 'source',
] as const;

/** Inside a serialized error these carry the error itself, not data (LG-009). */
const ERROR_CONTAINERS: ReadonlySet<string> = new Set(['error', 'err', 'cause', 'exception', 'rejection']);
const ERROR_TEXT_FIELDS: ReadonlySet<string> = new Set(['name', 'message', 'stack', 'code', 'detail']);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

/** Whether a string under this field name is machine data (the payload allowlist, LG-003). */
export function isAllowedStringField(key: string, parentKey: string | null): boolean {
  const name = normalizedKey(key);
  if (ALLOWED_STRING_FIELDS.has(name)) return true;
  if (parentKey !== null && ERROR_CONTAINERS.has(normalizedKey(parentKey)) && ERROR_TEXT_FIELDS.has(name)) return true;
  return ALLOWED_STRING_SUFFIXES.some((suffix) => name.length > suffix.length && name.endsWith(suffix));
}

/** The marks this module writes itself; a second pass keeps them as they are (idempotence). */
const OWN_MARK = /^\[(?:text len=\d+|\+\d+ more|depth|circular|unreadable|symbol|function|redacted|(?:map|set) size=\d+|binary bytes=\d+)\]$/;

/** What replaces a string that is not allowed: its length, never its content (a mark stays a mark). */
export function lengthMark(text: string): string {
  return OWN_MARK.test(text) ? text : `[text len=${text.length}]`;
}

/** Index ≤ `at` that does not split a surrogate pair. */
function safeCut(text: string, at: number): number {
  const last = text.charCodeAt(at - 1);
  return at > 0 && last >= 0xd800 && last <= 0xdbff ? at - 1 : at;
}

/** Cuts a string to at most `max` characters, the mark included: `…[+1234]`. */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  // The mark never names more than text.length characters: reserve that much.
  const reserve = `…[+${text.length}]`.length;
  if (max <= reserve) return text.slice(0, safeCut(text, Math.max(0, max)));
  const cut = safeCut(text, max - reserve);
  return `${text.slice(0, cut)}…[+${text.length - cut}]`;
}

const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_KEY_LENGTH = 64;

export interface SanitizeOptions {
  readonly limits?: SanitizeLimits;
  /** Apply the payload allowlist (on for log fields; off for an export already made of records). */
  readonly allowlist?: boolean;
  /** Depth of the value inside its record: `fields` sits at 1, so its values start at 2. */
  readonly baseDepth?: number;
  /** Field name of the value itself, for the allowlist of a bare string or array. */
  readonly key?: string | null;
}

interface Walk {
  readonly redactor: Pick<Redactor, 'text'>;
  readonly limits: SanitizeLimits;
  readonly allowlist: boolean;
  readonly seen: WeakSet<object>;
}

function sanitizeString(walk: Walk, value: string, key: string | null, parentKey: string | null): string {
  if (OWN_MARK.test(value)) return value;
  if (walk.allowlist && key !== null && !isAllowedStringField(key, parentKey)) return lengthMark(value);
  return truncateText(walk.redactor.text(value), walk.limits.maxStringLength);
}

function readProperty(record: object, key: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: (record as Record<string, unknown>)[key] };
  } catch {
    return { ok: false };
  }
}

function inner(walk: Walk, value: unknown, depth: number, key: string | null, parentKey: string | null): unknown {
  switch (typeof value) {
    case 'string':
      return sanitizeString(walk, value, key, parentKey);
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'undefined':
      return null;
    case 'symbol':
      return '[symbol]';
    case 'function':
      return '[function]';
    case 'object':
      break;
  }
  if (value === null) return null;
  const object = value;
  if (walk.seen.has(object)) return '[circular]';
  if (depth >= walk.limits.maxDepth) return '[depth]';
  try {
    if (object instanceof Error) {
      walk.seen.add(object);
      // Its name/message/stack are the error itself, whatever field holds it.
      return inner(walk, serializeError(object), depth, 'error', parentKey);
    }
    if (object instanceof Date) {
      const time = object.getTime();
      return Number.isFinite(time) ? object.toISOString() : null;
    }
    if (object instanceof Map) return `[map size=${object.size}]`;
    if (object instanceof Set) return `[set size=${object.size}]`;
    if (ArrayBuffer.isView(object) || object instanceof ArrayBuffer) return `[binary bytes=${object.byteLength}]`;
    walk.seen.add(object);
    if (Array.isArray(object)) {
      const items: readonly unknown[] = object;
      const keep = items.length > walk.limits.maxArrayLength ? Math.max(0, walk.limits.maxArrayLength - 1) : items.length;
      const out: unknown[] = [];
      for (let i = 0; i < keep; i += 1) {
        const item = readProperty(items, String(i));
        // An array's items inherit its field name for the allowlist (`missing: ['app']`).
        out.push(item.ok ? inner(walk, item.value, depth + 1, key, parentKey) : '[unreadable]');
      }
      if (keep < items.length) out.push(`[+${items.length - keep} more]`);
      walk.seen.delete(object);
      return out;
    }
    const keys = Object.keys(object);
    const out: Record<string, unknown> = {};
    const keepKeys = keys.length > walk.limits.maxObjectKeys ? Math.max(0, walk.limits.maxObjectKeys - 1) : keys.length;
    let written = 0;
    let skipped = 0;
    for (const rawKey of keys) {
      if (written >= keepKeys) {
        skipped += 1;
        continue;
      }
      if (PROTOTYPE_KEYS.has(rawKey)) {
        skipped += 1;
        continue;
      }
      const safeKey = truncateText(walk.redactor.text(rawKey), MAX_KEY_LENGTH);
      if (isRedactedLogField(rawKey)) {
        out[safeKey] = REDACTED;
      } else {
        const property = readProperty(object, rawKey);
        out[safeKey] = property.ok ? inner(walk, property.value, depth + 1, rawKey, key) : '[unreadable]';
      }
      written += 1;
    }
    if (skipped > 0) out['_truncatedKeys'] = skipped;
    walk.seen.delete(object);
    return out;
  } catch {
    return '[unreadable]';
  }
}

/** Redacts and bounds any value into plain JSON (see the header). Never throws. */
export function sanitizeValue(value: unknown, redactor: Pick<Redactor, 'text'>, options: SanitizeOptions = {}): unknown {
  const walk: Walk = {
    redactor,
    limits: options.limits ?? LOG_VALUE_LIMITS,
    allowlist: options.allowlist ?? true,
    seen: new WeakSet<object>(),
  };
  try {
    return inner(walk, value, options.baseDepth ?? 0, options.key ?? null, null);
  } catch {
    return '[unreadable]';
  }
}

/** Log `fields`: always an object (a bare value lands under `value`), allowlisted, at record depth 1. */
export function sanitizeFields(
  fields: unknown,
  redactor: Pick<Redactor, 'text'>,
  limits: SanitizeLimits = LOG_VALUE_LIMITS,
): Record<string, unknown> {
  const value = sanitizeValue(fields, redactor, { limits, allowlist: true, baseDepth: 1 });
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

// ── Errors (LG-009) ────────────────────────────────────────────────────────

const STACK_MAX_LINES = 24;
const STACK_MAX_CHARS = 3000;
const CAUSE_MAX_DEPTH = 3;

function stackOf(error: { stack?: unknown }): string | undefined {
  const stack = error.stack;
  if (typeof stack !== 'string' || stack.length === 0) return undefined;
  return truncateText(stack.split('\n').slice(0, STACK_MAX_LINES).join('\n'), STACK_MAX_CHARS);
}

function readField(source: object, key: string): unknown {
  const read = readProperty(source, key);
  return read.ok ? read.value : undefined;
}

/**
 * Any thrown value as `name/message/stack/code/detail/cause` (LG-009). A
 * HubCallError-shaped value keeps its route and failure facts (status, the
 * hub's machine code, transport kind) — never a token or a hub message.
 */
export function serializeError(value: unknown, depth = 0): Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'string') return { name: 'NonError', message: value };
      return { name: 'NonError', message: `[${typeof value}]` };
    }
    const out: Record<string, unknown> = {};
    const name = readField(value, 'name');
    out['name'] = typeof name === 'string' && name.length > 0 ? name : value instanceof Error ? 'Error' : 'Object';
    const message = readField(value, 'message');
    if (typeof message === 'string') out['message'] = message;
    const stack = stackOf(value);
    if (stack !== undefined) out['stack'] = stack;
    const code = readField(value, 'code');
    if (typeof code === 'string' || typeof code === 'number') out['code'] = code;
    const detail = readField(value, 'detail');
    if (typeof detail === 'string') out['detail'] = detail;
    const route = readField(value, 'route');
    if (typeof route === 'string') out['route'] = route;
    const failure = readField(value, 'failure');
    if (failure !== null && typeof failure === 'object') {
      const facts: Record<string, unknown> = {};
      for (const fact of ['kind', 'status', 'error', 'reason', 'code', 'failure', 'retryAfterMs']) {
        const factValue = readField(failure, fact);
        if (typeof factValue === 'string' || typeof factValue === 'number') facts[fact] = factValue;
      }
      out['failure'] = facts;
    }
    const epoch = readField(value, 'epoch');
    if (typeof epoch === 'number') out['epoch'] = epoch;
    const cause = readField(value, 'cause');
    if (cause !== undefined && cause !== value) {
      out['cause'] = depth + 1 >= CAUSE_MAX_DEPTH ? { name: 'Cause', message: '[depth]' } : serializeError(cause, depth + 1);
    }
    return out;
  } catch {
    return { name: 'Unreadable' };
  }
}
