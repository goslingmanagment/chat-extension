// Hand-written checks of the MAIN bridge (§5.3, D-06): MAIN carries no zod,
// so it checks every request against the contracts' shapes by hand — exact
// key sets, id and token formats, ranges. This file holds the building blocks
// and the envelope check of the boot; requests.ts holds the payload checks of
// the runtime. protocol.test.ts runs the contracts fixtures
// (BRIDGE_REQUEST_FIXTURES) through both.
//
// A shape is a tiny spec `{ key: check }` with exact keys; a key ending in
// `?` is optional (absent, never undefined).

export type Check = (value: unknown) => boolean;
export type Plain = Record<string, unknown>;

export const isPlain = (value: unknown): value is Plain => typeof value === 'object' && value !== null && !Array.isArray(value);

/** An object with exactly the spec's keys (`name?` — optional). */
export const shape =
  (spec: Record<string, Check>): Check =>
  (value) => {
    if (!isPlain(value)) return false;
    for (const key of Object.keys(value)) if (!(key in spec) && !(`${key}?` in spec)) return false;
    for (const key in spec) {
      const name = key.replace('?', '');
      if (name in value ? !(spec[key] as Check)(value[name]) : name === key) return false;
    }
    return true;
  };

const matches =
  (pattern: RegExp): Check =>
  (value) =>
    typeof value === 'string' && pattern.test(value);

/** contracts NATIVE_ID_PATTERN — host and platform ids are strings, never numbers. */
export const isId = matches(/^[1-9]\d{0,29}$/) as (value: unknown) => value is string;
/** contracts UUID_PATTERN. */
export const isUuid = matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
/** contracts EPOCH_TOKEN_PATTERN. */
export const isToken = matches(/^[\w-]{1,64}$/);
/** contracts DIGEST_PATTERN. */
export const isDigest = matches(/^[0-9a-f]{8,64}$/);
export const int =
  (min: number, max = Number.MAX_SAFE_INTEGER): Check =>
  (value) =>
    Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
export const count = int(0);
export const orNull =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
export const is =
  (...values: unknown[]): Check =>
  (value) =>
    values.includes(value);

/** The request envelope (contracts BridgeRequestSchema minus the payload). */
export const isRequestEnvelope = shape({ v: is(1), kind: is('req'), id: int(1), t: (value) => typeof value === 'string', documentEpoch: orNull(isToken), seq: count, payload: () => true });
