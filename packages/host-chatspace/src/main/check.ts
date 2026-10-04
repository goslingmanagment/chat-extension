// Hand-written checks of the MAIN bridge (§5.3, D-06): MAIN carries no zod,
// so it checks every request against the contracts' shapes by hand — exact
// key sets, id and token formats, ranges. This file holds the building blocks
// (the boot's envelope check is in bridge.ts, the runtime's payload checks in
// requests.ts); protocol.test.ts runs the contracts fixtures
// (BRIDGE_REQUEST_FIXTURES) through both. The builders are called with
// `@__PURE__`, so a bundle that needs one check does not carry them all.
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
export const isId = /* @__PURE__ */ matches(/^[1-9]\d{0,29}$/) as (value: unknown) => value is string;
/**
 * Numeric ids of the host may come as numbers (the account's `id`); the wire wants the string form. A number that is
 * not a safe integer has already lost digits when it was parsed: it is no id (two different ids could read the same).
 */
export const idOf = (value: unknown): string | null => {
  const id = Number.isSafeInteger(value) ? String(value) : value;
  return isId(id) ? id : null;
};
/** contracts UUID_PATTERN. */
export const isUuid = /* @__PURE__ */ matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
/** contracts EPOCH_TOKEN_PATTERN. */
export const isToken = /* @__PURE__ */ matches(/^[\w-]{1,64}$/);
/** contracts DIGEST_PATTERN. */
export const isDigest = /* @__PURE__ */ matches(/^[0-9a-f]{8,64}$/);
export const int =
  (min: number, max = Number.MAX_SAFE_INTEGER): Check =>
  (value) =>
    Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
export const count = /* @__PURE__ */ int(0);
export const orNull =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
export const is =
  (...values: unknown[]): Check =>
  (value) =>
    values.includes(value);
