// Structured logs (architecture.md §5.7, §9.2, D-21). Texts are never logged:
// no conversation, drafts, prompts, model output or URLs with parameters —
// only lengths and fingerprints. Redaction runs before the console, the disk
// and any export; the logger never throws and never slows the work down.

import * as z from 'zod/mini';

import { checkBridgeFrame } from './bridge';
import { CgCodeSchema } from './errors';
import { ChatKeySchema } from './ids';
import { LOG_LIMITS } from './limits';
import { CountSchema, EpochTokenSchema, IsoTimestampSchema, UuidSchema, boundedText } from './primitives';

/** `debug` only with debug.enabled; `info`/`warn`/`error` always. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export const LogLevelSchema = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Field names whose values are always replaced, at any depth (LG-003). A key
 * matches when, lowercased without `_` and `-`, it equals one of these or
 * ends with one (isRedactedLogField): `leaseToken`, `actionToken`,
 * `promptToken`, `dispatchTicket`, `set-cookie` match; `tabSessionId` and
 * `inputTokens` do not. The writer redacts before the console, the disk and
 * any export, and the background redacts again whatever a tab or page sent.
 */
export const LOG_REDACTED_FIELDS = ['authorization', 'bearer', 'token', 'password', 'cookie', 'session', 'ticket', 'secret', 'apikey'] as const;

export function isRedactedLogField(key: string): boolean {
  const name = key.toLowerCase().replace(/[-_]/g, '');
  if (/(?:^|-)(?:client-(?:id|ts|check)|session-id)$/.test(key.toLowerCase())) return true;
  return LOG_REDACTED_FIELDS.some((field) => name === field || name.endsWith(field));
}

/** One record measured as the bridge measures a frame: plain JSON within the log limits. */
const logFrameLimits = (maxFrameBytes: number) => ({
  maxFrameBytes,
  maxStringLength: LOG_LIMITS.maxStringLength,
  maxArrayLength: LOG_LIMITS.maxArrayLength,
  maxObjectKeys: LOG_LIMITS.maxObjectKeys,
  maxDepth: LOG_LIMITS.maxDepth,
});
const RECORD_FRAME = logFrameLimits(LOG_LIMITS.maxRecordBytes);
const UI_RECORD_FRAME = logFrameLimits(LOG_LIMITS.maxRecordBytesFromUi);

/** Dotted scope of the writer: `bg.ops`, `tab.dock`, `main.bridge`. */
export const LOG_SCOPE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+){0,5}$/;

/** A JSON value already redacted and truncated to LOG_LIMITS (depth, keys, array, string). */
export const LogFieldsSchema = z.record(z.string().check(z.maxLength(64)), z.unknown()).check(
  z.refine((r) => Object.keys(r).length <= LOG_LIMITS.maxObjectKeys, { message: 'too many fields' }),
);

const logRecordShape = {
  ts: IsoTimestampSchema,
  /** Monotonic within the writing context and session. */
  seq: CountSchema,
  level: LogLevelSchema,
  scope: z.string().check(z.regex(LOG_SCOPE_PATTERN), z.maxLength(64)),
  /** A fixed message, not data: values go to `fields`. */
  msg: boundedText(500),
  code: z.optional(CgCodeSchema),
  fields: z.optional(LogFieldsSchema),
  ctx: z.optional(
    z.strictObject({
      tabSessionId: z.optional(UuidSchema),
      opId: z.optional(UuidSchema),
      attemptId: z.optional(UuidSchema),
      chatKey: z.optional(ChatKeySchema),
      routeEpoch: z.optional(CountSchema),
      /** Sign-in epoch. */
      session: z.optional(CountSchema),
      documentEpoch: z.optional(EpochTokenSchema),
    }),
  ),
};

/** A stored or exported record: plain JSON, at most LOG_LIMITS.maxRecordBytes, depth/keys/arrays/strings within LOG_LIMITS. */
export const LogRecordSchema = z
  .strictObject(logRecordShape)
  .check(z.refine((r) => checkBridgeFrame(r, RECORD_FRAME).ok, { message: 'a log record is plain JSON within LOG_LIMITS' }));
export type LogRecord = z.infer<typeof LogRecordSchema>;

/** A record a tab or page sends with `log.write`: the same, at most LOG_LIMITS.maxRecordBytesFromUi. */
export const LogRecordFromUiSchema = z
  .strictObject(logRecordShape)
  .check(z.refine((r) => checkBridgeFrame(r, UI_RECORD_FRAME).ok, { message: 'a record from a tab or page is plain JSON within 4 KiB' }));
