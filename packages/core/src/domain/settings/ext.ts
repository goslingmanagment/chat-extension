// Reading and changing the `settings.ext` key (1.15.0; R20 FS-SET-1,
// docs/project-unite/architecture.md §12; contracts settings-ext.ts). Pure.
//
// - Read: every field this build knows, each on its own; a field that is not
//   stored or does not read is its default (named when it was stored broken).
//   A stored `v` above this build's is `newer`: read what reads, write nothing.
// - Write: the patch goes into the STORED object; every field the patch does
//   not name stays exactly as stored — known or unknown, readable or broken.
//   A default is never written down and never replaces a stored value, so a
//   later build that adds a field, or another build of the same version, loses
//   nothing to this one.
//
// Both walk the key's schema (R20 F9b): a site's section is read and written
// by the names `SettingsExtSchema` gives its `hosts` — this module names no
// site, and a section a later contract adds is read with no change here.

import { DEFAULT_SETTINGS_EXT, SETTINGS_EXT_VERSION, SettingsExtSchema, type SettingsExt, type SettingsExtLoadOutcome, type SettingsExtPatch } from '@cg/contracts/settings-ext';

import { isPlainRecord, stableJson } from '../storage/json';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface FieldSchema {
  safeParse(value: unknown): { readonly success: boolean; readonly data?: unknown };
}

/** An object of the key's schema: its fields by name, each a value or an object of its own. */
interface SectionSchema {
  readonly shape: Readonly<Record<string, FieldSchema>>;
}

const sectionOf = (schema: FieldSchema): SectionSchema | null => ('shape' in schema && isPlainRecord(schema.shape) ? (schema as unknown as SectionSchema) : null);

/** The sites' sections, by the names the key's schema gives them. */
const HOST_SECTIONS: readonly string[] = Object.keys(SettingsExtSchema.shape.hosts.shape);

/** A stored field read on its own: absent — the default, unnamed; broken — the default, named by path. */
function field<T>(stored: Readonly<Record<string, unknown>> | null, key: string, schema: FieldSchema, fallback: T, path: string, repaired: string[]): T {
  if (stored === null || !(key in stored)) return fallback;
  const read = schema.safeParse(stored[key]);
  if (read.success) return read.data as T;
  repaired.push(path);
  return fallback;
}

/** A stored object at `key`: null when absent; when it is there and not an object, it is named broken. */
function section(stored: Readonly<Record<string, unknown>> | null, key: string, path: string, repaired: string[]): Readonly<Record<string, unknown>> | null {
  if (stored === null || !(key in stored)) return null;
  const value = stored[key];
  if (isPlainRecord(value)) return value;
  repaired.push(path);
  return null;
}

/**
 * Reads an object of the schema out of what is stored: every object inside it first, then every value, each in the
 * schema's order — so a broken object is named before the values it took with it (`leaves` runs after the walk).
 */
function readSection(
  stored: Readonly<Record<string, unknown>> | null,
  schema: SectionSchema,
  defaults: Readonly<Record<string, unknown>>,
  path: string,
  repaired: string[],
  leaves: (() => void)[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    const at = path === '' ? key : `${path}.${key}`;
    const nested = sectionOf(fieldSchema);
    // The key is taken here, so the view keeps the schema's order of fields.
    out[key] = undefined;
    if (nested !== null) out[key] = readSection(section(stored, key, at, repaired), nested, defaults[key] as Readonly<Record<string, unknown>>, at, repaired, leaves);
    else leaves.push(() => (out[key] = field(stored, key, fieldSchema, defaults[key], at, repaired)));
  }
  return out;
}

function readKnown(stored: Readonly<Record<string, unknown>>, repaired: string[]): SettingsExt {
  const { v: _version, ...fields } = SettingsExtSchema.shape;
  const leaves: (() => void)[] = [];
  const read = readSection(stored, { shape: fields }, DEFAULT_SETTINGS_EXT, '', repaired, leaves);
  for (const leaf of leaves) leaf();
  return { v: SETTINGS_EXT_VERSION, ...read } as SettingsExt;
}

/** The stored version: a whole number ≥ 1; anything else reads as this build's (named). */
function storedVersion(stored: Readonly<Record<string, unknown>>): number | null {
  const v = stored['v'];
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
}

export function loadStoredSettingsExt(raw: unknown, current: number = SETTINGS_EXT_VERSION): SettingsExtLoadOutcome {
  if (raw === undefined) return { kind: 'fresh', ext: clone(DEFAULT_SETTINGS_EXT) };
  if (!isPlainRecord(raw)) return { kind: 'current', ext: clone(DEFAULT_SETTINGS_EXT), repaired: ['settings.ext'] };
  const repaired: string[] = [];
  const version = storedVersion(raw);
  const ext = readKnown(raw, repaired);
  if (version !== null && version > current) return { kind: 'newer', ext, storedVersion: version };
  return { kind: 'current', ext, repaired: version === null ? ['v', ...repaired] : repaired };
}

export type SettingsExtPatchOutcome =
  | {
      readonly ok: true;
      /** What to store: the stored object with the patch written into it. */
      readonly stored: Record<string, unknown>;
      readonly ext: SettingsExt;
      readonly changed: boolean;
    }
  | { readonly ok: false; readonly reason: 'invalid' };

/** A nested object of the stored value to write into: a copy of what is there, or a new one (a broken value is replaced). */
const child = (parent: Record<string, unknown>, key: string): Record<string, unknown> => {
  const value = parent[key];
  const next = isPlainRecord(value) ? { ...value } : {};
  parent[key] = next;
  return next;
};

/** Copies the fields a patch carries (an absent or undefined one keeps the stored value); answers their paths. */
const setDefined = (target: Record<string, unknown>, patch: Readonly<Record<string, unknown>>, path: string): string[] => {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    target[key] = value;
    paths.push(`${path}.${key}`);
  }
  return paths;
};

/**
 * Writes a patch into the stored object (`stored` — what the key holds now, undefined when nothing). Only the named
 * fields change; `windows.deep: null` removes the wish. The result must read back without a repair of what the
 * patch wrote.
 */
export function applySettingsExtPatch(stored: unknown, patch: SettingsExtPatch): SettingsExtPatchOutcome {
  const base: Record<string, unknown> | null = isPlainRecord(stored) ? clone(stored) : null;
  const next: Record<string, unknown> = { ...base, v: (base === null ? null : storedVersion(base)) ?? SETTINGS_EXT_VERSION };
  /** Paths the patch wrote: each must read back as written. */
  const written: string[] = [];
  const hostPatches: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>> = patch.hosts ?? {};
  const hostsNamed = HOST_SECTIONS.filter((host) => hostPatches[host] !== undefined);
  for (const host of hostsNamed) {
    const block = child(child(next, 'hosts'), host);
    const entries = Object.entries(hostPatches[host] ?? {});
    // A site's own values first, then its objects (the sound's tones), each written field by field.
    written.push(...setDefined(block, Object.fromEntries(entries.filter(([, value]) => !isPlainRecord(value))), `hosts.${host}`));
    for (const [key, value] of entries) if (isPlainRecord(value)) written.push(...setDefined(child(block, key), value, `hosts.${host}.${key}`));
  }
  const deep = patch.windows?.deep;
  if (deep !== undefined) {
    const windows = child(next, 'windows');
    if (deep === null) delete windows['deep'];
    else {
      windows['deep'] = deep;
      written.push('windows.deep');
    }
  }
  const repaired: string[] = [];
  const ext = readKnown(next, repaired);
  if (written.some((path) => repaired.includes(path))) return { ok: false, reason: 'invalid' };
  // Nothing stored and nothing named: nothing to write (a default is never written down).
  const changed = base === null ? hostsNamed.length > 0 || deep !== undefined : stableJson(next) !== stableJson(base);
  return { ok: true, stored: next, ext, changed };
}
