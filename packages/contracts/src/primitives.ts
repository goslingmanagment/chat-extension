// Schema building blocks shared by every contract module (architecture.md §5).
// One form per concept: every numeric host/platform id is the same string
// form, money is integer mills, wall-clock instants are either epoch ms
// (local clocks) or ISO strings (anything that leaves the browser), and
// growing vocabularies from the hub are open tokens (hub-pr-plan.md §4.0,
// critic item 14). `null` always means "unknown", never 0.

import * as z from 'zod/mini';

/**
 * Numeric ids of the host and the platform (OnlyMonster account, OnlyFans
 * creator and fan, message ids): decimal strings, no leading zero, ≤ 30
 * digits. Never converted with Number(): their size is not an order.
 */
export const NATIVE_ID_PATTERN = /^[1-9]\d{0,29}$/;
export const NativeIdSchema = z.string().check(z.regex(NATIVE_ID_PATTERN));
export type NativeId = z.infer<typeof NativeIdSchema>;

/** Hub integer ids (pageId, userId): positive safe integers. */
export const HubIntIdSchema = z.int().check(z.gte(1));
export type HubIntId = z.infer<typeof HubIntIdSchema>;

/**
 * Open token: a value from a vocabulary the hub may grow (flags, features,
 * capabilities, reasons, sources, coverage, kinds). The client narrows it
 * against its own constants; an unknown value means "off" or "unknown",
 * never a parse failure of the whole response.
 */
export const OpenTokenSchema = z.string().check(z.minLength(1), z.maxLength(64));
export type OpenToken = z.infer<typeof OpenTokenSchema>;

/** Ids we mint ourselves (operations, attempts, intents, tab sessions, events): RFC 4122 text form. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const UuidSchema = z.string().check(z.regex(UUID_PATTERN));
export type Uuid = z.infer<typeof UuidSchema>;

/** Opaque refs we receive and pass back unchanged (generationRef, ChatSpace's local pending id). */
export const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const RefSchema = z.string().check(z.regex(REF_PATTERN));

/**
 * Epoch tokens minted by a world for its own lifetime (the MAIN document
 * epoch, the host login epoch). Compared for equality only.
 */
export const EPOCH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const EpochTokenSchema = z.string().check(z.regex(EPOCH_TOKEN_PATTERN));

/**
 * Local fingerprints (draft document, request parameters, text integrity):
 * lowercase hex. MAIN computes them synchronously, so no crypto.subtle; they
 * never leave the browser and never key anything on the hub.
 */
export const DIGEST_PATTERN = /^[0-9a-f]{8,64}$/;
export const DigestSchema = z.string().check(z.regex(DIGEST_PATTERN));

/** One-time action tokens issued by the background for a trusted UI event. */
export const ACTION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export const ActionTokenSchema = z.string().check(z.regex(ACTION_TOKEN_PATTERN));

/** Non-negative counters, revisions and epochs that are numbers. */
export const CountSchema = z.int().check(z.gte(0));
/** Local wall-clock instant, ms since the Unix epoch. */
export const EpochMsSchema = z.int().check(z.gte(0));
/** Durations, ms. */
export const DurationMsSchema = z.number().check(z.gte(0), z.lte(86_400_000));

/** An instant that leaves the browser or comes from a host/hub: ISO 8601 with an offset. */
export const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
export const IsoTimestampSchema = z.string().check(z.maxLength(40), z.regex(ISO_TIMESTAMP_PATTERN));
export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;

/**
 * Money: an integer count of USD mills (1 mill = $0.001), signed (refunds and
 * net values can be negative), a JS number within the safe-integer range —
 * the hub's `mills` on the wire. Never dollars with fractions, never cents;
 * `null` = unknown, never 0. Formatting is i18n's `formatMoneyMills`.
 */
export const MoneyMillsSchema = z.int();
export type MoneyMills = number;

/** AI cost: integer micro-USD (hub `costMicroUsd`); debug surfaces only (Б4). */
export const MicroUsdSchema = z.int().check(z.gte(0));

/** Hub origin: scheme + host (+ port), no path. Release builds accept https only (enforced by the background). */
export const HUB_ORIGIN_PATTERN = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;
export const HubOriginSchema = z.string().check(z.maxLength(256), z.regex(HUB_ORIGIN_PATTERN));

/** IANA time zone name as the hub takes it (`Europe/Moscow`, `UTC`). */
export const TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;
export const TimeZoneSchema = z.string().check(z.maxLength(64), z.regex(TIME_ZONE_PATTERN));

/** Persona key of the hub catalog (`aiPersonaCatalog.key`, body `personaKey`): 1–120. */
export const PersonaKeySchema = z.string().check(z.minLength(1), z.maxLength(120));

/** Persona definition identity (`definitionId`, opaque, 16–100 as the hub has it). Compared, never parsed. */
export const PersonaDefinitionIdSchema = z.string().check(z.minLength(16), z.maxLength(100));

/** Display-only text from the host or the hub (names, handles, labels). */
export const displayText = (max: number) => z.string().check(z.maxLength(max));
/** Non-empty bounded text. */
export const boundedText = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
