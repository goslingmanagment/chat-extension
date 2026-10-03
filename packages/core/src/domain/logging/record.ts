// LogRecord creation (architecture.md §5.7, §9.2; LG-007, LG-008, LG-009,
// LG-011). A record is built from a fixed message and machine fields, goes
// through the shared redaction, and is held to the size of its writer: 8 KiB
// in the background, 4 KiB from a tab or page. A record that is still too
// large after per-field limits is shrunk step by step, and as a last resort
// its fields are replaced by a truncation note — the record itself is never
// lost to its size.

import { isCgCode } from '@cg/contracts/errors';
import { checkBridgeFrame } from '@cg/contracts/bridge';
import { ChatKeySchema } from '@cg/contracts/ids';
import { LOG_LIMITS } from '@cg/contracts/limits';
import { LOG_SCOPE_PATTERN, type LogLevel, type LogRecord } from '@cg/contracts/logs';
import { EPOCH_TOKEN_PATTERN, UUID_PATTERN } from '@cg/contracts/primitives';

import { LOG_VALUE_LIMITS, sanitizeFields, serializeError, truncateText, type Redactor, type SanitizeLimits } from './redact';

export type LogCtx = NonNullable<LogRecord['ctx']>;

export interface RecordInput {
  readonly level: LogLevel;
  readonly scope: string;
  /** A fixed message, not data: values go to `fields`. */
  readonly msg: string;
  /** A CG code; anything else is kept as `fields.invalidCode` and the record has no code. */
  readonly code?: string;
  readonly fields?: Readonly<Record<string, unknown>>;
  /** Anything thrown; lands in `fields.error` as name/message/stack/code/detail/cause (LG-009). */
  readonly error?: unknown;
  readonly ctx?: Partial<Record<keyof LogCtx, unknown>>;
}

export interface RecordEnvironment {
  readonly now: number;
  readonly seq: number;
  readonly redactor: Pick<Redactor, 'text'>;
  /** LOG_LIMITS.maxRecordBytes in the background, maxRecordBytesFromUi in tabs and pages. */
  readonly maxBytes: number;
}

export const MSG_MAX_CHARS = 500;
const SCOPE_MAX_CHARS = 64;

/** Fixed scope words: lowercase, dotted, at most six parts (`bg.ops`, `tab.dock`). */
export function normalizeScope(scope: string): string {
  if (LOG_SCOPE_PATTERN.test(scope) && scope.length <= SCOPE_MAX_CHARS) return scope;
  const parts = scope
    .toLowerCase()
    .split('.')
    .map((part) => part.replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, ''))
    .filter((part) => part.length > 0)
    .slice(0, 6);
  const first = parts[0];
  if (first === undefined) return 'unknown';
  if (!/^[a-z]/.test(first)) parts[0] = `x${first}`;
  const candidate = parts.join('.').slice(0, SCOPE_MAX_CHARS).replace(/[.-]+$/, '');
  return LOG_SCOPE_PATTERN.test(candidate) ? candidate : 'unknown';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Keeps only the ctx fields that pass their shape; a bad one is dropped, never logged raw. */
export function cleanCtx(ctx: RecordInput['ctx']): LogCtx | undefined {
  if (ctx === undefined) return undefined;
  const out: { -readonly [K in keyof LogCtx]?: LogCtx[K] } = {};
  const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
  if (uuid(ctx.tabSessionId)) out.tabSessionId = ctx.tabSessionId;
  if (uuid(ctx.opId)) out.opId = ctx.opId;
  if (uuid(ctx.attemptId)) out.attemptId = ctx.attemptId;
  const chatKey = ChatKeySchema.safeParse(ctx.chatKey);
  if (chatKey.success) out.chatKey = chatKey.data;
  if (isCount(ctx.routeEpoch)) out.routeEpoch = ctx.routeEpoch;
  if (isCount(ctx.session)) out.session = ctx.session;
  if (typeof ctx.documentEpoch === 'string' && EPOCH_TOKEN_PATTERN.test(ctx.documentEpoch)) out.documentEpoch = ctx.documentEpoch;
  return Object.keys(out).length > 0 ? out : undefined;
}

function isoOf(ms: number): string {
  const date = new Date(Number.isFinite(ms) ? ms : 0);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

/** Tighter and tighter field limits for a record that is still too large. */
const SHRINK_STEPS: readonly SanitizeLimits[] = [
  { ...LOG_VALUE_LIMITS, maxStringLength: 2000, maxArrayLength: 20, maxObjectKeys: 40 },
  { ...LOG_VALUE_LIMITS, maxStringLength: 300, maxArrayLength: 8, maxObjectKeys: 16, maxDepth: 5 },
  { ...LOG_VALUE_LIMITS, maxStringLength: 60, maxArrayLength: 3, maxObjectKeys: 8, maxDepth: 3 },
];

function frameLimits(maxBytes: number) {
  return {
    maxFrameBytes: maxBytes,
    maxStringLength: LOG_LIMITS.maxStringLength,
    maxArrayLength: LOG_LIMITS.maxArrayLength,
    maxObjectKeys: LOG_LIMITS.maxObjectKeys,
    maxDepth: LOG_LIMITS.maxDepth,
  };
}

/** UTF-8 bytes of the record's JSON, or null when it breaks a log limit. */
export function recordBytes(record: LogRecord, maxBytes: number = LOG_LIMITS.maxRecordBytes): number | null {
  const check = checkBridgeFrame(record, frameLimits(maxBytes));
  return check.ok ? check.bytes : null;
}

/**
 * Builds one redacted record within the size of its writer. Never throws:
 * if everything fails, a minimal record that says so is returned.
 */
export function buildRecord(input: RecordInput, env: RecordEnvironment): LogRecord {
  try {
    const base: { -readonly [K in keyof LogRecord]: LogRecord[K] } = {
      ts: isoOf(env.now),
      seq: isCount(env.seq) ? env.seq : 0,
      level: input.level,
      scope: normalizeScope(input.scope),
      msg: truncateText(env.redactor.text(typeof input.msg === 'string' && input.msg.length > 0 ? input.msg : '(no message)'), MSG_MAX_CHARS),
    };
    if (input.code !== undefined && isCgCode(input.code)) base.code = input.code;
    const ctx = cleanCtx(input.ctx);
    if (ctx !== undefined) base.ctx = ctx;
    let raw: Record<string, unknown> | undefined;
    if (input.fields !== undefined || input.error !== undefined) {
      raw = { ...(input.fields ?? {}) };
      if (input.error !== undefined) raw['error'] = serializeError(input.error);
      if (input.code !== undefined && !isCgCode(input.code)) raw['invalidCode'] = typeof input.code === 'string' ? input.code : '[non-string]';
    } else if (input.code !== undefined && !isCgCode(input.code)) {
      raw = { invalidCode: typeof input.code === 'string' ? input.code : '[non-string]' };
    }
    if (raw === undefined) return base;
    for (const limits of [LOG_VALUE_LIMITS, ...SHRINK_STEPS]) {
      const candidate: LogRecord = { ...base, fields: sanitizeFields(raw, env.redactor, limits) };
      if (recordBytes(candidate, env.maxBytes) !== null) return candidate;
    }
    const note: LogRecord = { ...base, fields: { _truncated: true, _fieldCount: Object.keys(raw).length } };
    return recordBytes(note, env.maxBytes) !== null ? note : { ...base, msg: truncateText(base.msg, 100), fields: { _truncated: true } };
  } catch {
    return { ts: isoOf(env.now), seq: 0, level: input.level === 'debug' ? 'debug' : 'error', scope: 'log', msg: 'log record could not be built' };
  }
}

/** UTF-8 bytes of a string (core has no TextEncoder). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** UTF-8 bytes of the JSON form of a value; 0 for what JSON cannot write. */
export function jsonBytes(value: unknown): number {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? utf8Length(text) : 0;
  } catch {
    return 0;
  }
}

/**
 * The background's second pass over a record that a tab or a page sent
 * (LG-003, LG-011): the same redaction again, now with the live secrets the
 * tab never had (the token and its tail), within the background's 8 KiB, the
 * sender's ctx added. Idempotent for anything the background wrote itself.
 */
export function redactRecord(
  record: LogRecord,
  redactor: Pick<Redactor, 'text'>,
  options: { readonly maxBytes?: number; readonly ctx?: RecordInput['ctx'] } = {},
): LogRecord {
  const at = Date.parse(record.ts);
  const input: { -readonly [K in keyof RecordInput]: RecordInput[K] } = {
    level: record.level,
    scope: record.scope,
    msg: record.msg,
    ctx: { ...(record.ctx ?? {}), ...(options.ctx ?? {}) },
  };
  if (record.code !== undefined) input.code = record.code;
  if (record.fields !== undefined) input.fields = record.fields;
  return buildRecord(input, { now: Number.isFinite(at) ? at : 0, seq: record.seq, redactor, maxBytes: options.maxBytes ?? LOG_LIMITS.maxRecordBytes });
}

/** The file/console line (LG-007): ISO time, level, [scope], CG code, fields as JSON. */
export function formatRecordLine(record: LogRecord): string {
  const parts = [record.ts, record.level.toUpperCase().padEnd(5), `[${record.scope}]`];
  if (record.code !== undefined) parts.push(record.code);
  parts.push(record.msg);
  let line = parts.join(' ');
  if (record.ctx !== undefined) line += ` ctx=${safeJson(record.ctx)}`;
  if (record.fields !== undefined) line += ` ${safeJson(record.fields)}`;
  return line;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return '"[unserializable]"';
  }
}
