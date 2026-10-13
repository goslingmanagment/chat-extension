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

import {
  DEFAULT_SETTINGS_EXT,
  FanslySettingsSchema,
  SETTINGS_EXT_VERSION,
  SettingsExtSchema,
  type SettingsExt,
  type SettingsExtLoadOutcome,
  type SettingsExtPatch,
} from '@cg/contracts/settings-ext';

import { isPlainRecord, stableJson } from '../storage/json';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface FieldSchema {
  safeParse(value: unknown): { readonly success: boolean; readonly data?: unknown };
}

const FANSLY = 'fansly-web';
const FANSLY_FIELDS = FanslySettingsSchema.shape;
const SOUND_FIELDS = FanslySettingsSchema.shape.sound.shape;
const DEEP = SettingsExtSchema.shape.windows.shape.deep;

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

function readKnown(stored: Readonly<Record<string, unknown>>, repaired: string[]): SettingsExt {
  const defaults = DEFAULT_SETTINGS_EXT.hosts[FANSLY];
  const hosts = section(stored, 'hosts', 'hosts', repaired);
  const fansly = section(hosts, FANSLY, `hosts.${FANSLY}`, repaired);
  const sound = section(fansly, 'sound', `hosts.${FANSLY}.sound`, repaired);
  const windows = section(stored, 'windows', 'windows', repaired);
  const p = `hosts.${FANSLY}`;
  return {
    v: SETTINGS_EXT_VERSION,
    hosts: {
      [FANSLY]: {
        enabled: field(fansly, 'enabled', FANSLY_FIELDS.enabled, defaults.enabled, `${p}.enabled`, repaired),
        viaTab: field(fansly, 'viaTab', FANSLY_FIELDS.viaTab, defaults.viaTab, `${p}.viaTab`, repaired),
        notesView: field(fansly, 'notesView', FANSLY_FIELDS.notesView, defaults.notesView, `${p}.notesView`, repaired),
        sound: {
          messagesTone: field(sound, 'messagesTone', SOUND_FIELDS.messagesTone, defaults.sound.messagesTone, `${p}.sound.messagesTone`, repaired),
          subscribersTone: field(sound, 'subscribersTone', SOUND_FIELDS.subscribersTone, defaults.sound.subscribersTone, `${p}.sound.subscribersTone`, repaired),
        },
      },
    },
    windows: { deep: field(windows, 'deep', DEEP, null, 'windows.deep', repaired) },
  };
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
  const fansly = patch.hosts?.[FANSLY];
  if (fansly !== undefined) {
    const block = child(child(next, 'hosts'), FANSLY);
    const { sound, ...flags } = fansly;
    written.push(...setDefined(block, flags, `hosts.${FANSLY}`));
    if (sound !== undefined) written.push(...setDefined(child(block, 'sound'), sound, `hosts.${FANSLY}.sound`));
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
  const changed = base === null ? fansly !== undefined || deep !== undefined : stableJson(next) !== stableJson(base);
  return { ok: true, stored: next, ext, changed };
}
