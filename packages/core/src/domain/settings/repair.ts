// Reading stored settings field by field (architecture.md §9.4): a broken
// optional value falls back to its default and is named, everything readable
// is kept, unknown keys are dropped. Identity is never guessed: a broken
// persona scope drops the persona choices it scoped.

import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, SettingsSchema, type SettingsV1 } from '@cg/contracts/settings';

import { isPlainRecord } from '../storage/json';

/** The part of a zod schema the repair walks: parse, and an object's shape. */
interface SchemaLike {
  safeParse(value: unknown): { readonly success: boolean; readonly data?: unknown };
  readonly shape?: Readonly<Record<string, SchemaLike>>;
}

export interface SettingsRepair {
  readonly settings: SettingsV1;
  /** Dotted paths that were reset or trimmed (`ui.theme`, `sound.mutedAccounts`). */
  readonly repaired: readonly string[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function repairNode(schema: SchemaLike, fallback: unknown, stored: unknown, path: string, repaired: string[]): unknown {
  const shape = schema.shape;
  if (shape !== undefined) {
    if (!isPlainRecord(stored)) {
      repaired.push(path);
      return clone(fallback);
    }
    const defaults = fallback as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(shape)) out[key] = repairNode(child, defaults[key], stored[key], `${path}.${key}`, repaired);
    return out;
  }
  const direct = schema.safeParse(stored);
  if (direct.success) return direct.data;
  if (Array.isArray(fallback) && Array.isArray(stored)) {
    const kept = stored.filter((item) => schema.safeParse([item]).success);
    while (kept.length > 0 && !schema.safeParse(kept).success) kept.pop();
    repaired.push(path);
    return kept;
  }
  if (isPlainRecord(fallback) && isPlainRecord(stored)) {
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stored)) if (schema.safeParse({ [key]: value }).success) kept[key] = value;
    const keys = Object.keys(kept);
    while (keys.length > 0 && !schema.safeParse(kept).success) delete kept[keys.pop() as string];
    repaired.push(path);
    return kept;
  }
  repaired.push(path);
  return clone(fallback);
}

/** Every field that reads is kept; `schemaVersion` becomes this build's. */
export function repairSettings(stored: unknown): SettingsRepair {
  const repaired: string[] = [];
  const shape = (SettingsSchema as unknown as SchemaLike).shape ?? {};
  if (!isPlainRecord(stored)) return { settings: clone(DEFAULT_SETTINGS), repaired: ['settings'] };
  const out: Record<string, unknown> = { schemaVersion: SETTINGS_SCHEMA_VERSION };
  const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  for (const [key, child] of Object.entries(shape)) {
    if (key === 'schemaVersion') continue;
    out[key] = repairNode(child, defaults[key], stored[key], key, repaired);
  }
  const personas = out['personas'] as { scope: unknown; byPageId: Record<string, unknown> };
  if (repaired.includes('personas.scope') || repaired.includes('personas')) {
    // Whose choices these are is unknown now: they are not kept for anyone.
    if (Object.keys(personas.byPageId).length > 0 && !repaired.includes('personas.byPageId')) repaired.push('personas.byPageId');
    personas.scope = null;
    personas.byPageId = {};
  }
  const checked = SettingsSchema.safeParse(out);
  if (!checked.success) return { settings: clone(DEFAULT_SETTINGS), repaired: ['settings'] };
  return { settings: checked.data, repaired };
}
