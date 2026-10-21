// Loading the `settings` key (architecture.md §5.6, §9.4, D-23; RB-012):
// numbered forward-only migrations, read-only when the store is newer than
// this build (CG-STORAGE-VERSION), broken optional values → defaults (named),
// and a value that cannot be interpreted is left untouched (CG-STORAGE-READ),
// never overwritten with defaults.

import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  UI_DEFAULTS_REVISION,
  type SettingsLoadOutcome,
  type SettingsMigrations,
  type SettingsV1,
} from '@cg/contracts/settings';

import { isPlainRecord } from '../storage/json';
import { repairSettings } from './repair';

/**
 * The migration chain of this build, contiguous up to SETTINGS_SCHEMA_VERSION.
 * v1 is the first released schema: there is nothing older to migrate yet.
 * A v2 adds `{from: 1, to: 2, migrate}` here, never edits a released step.
 */
export const SETTINGS_MIGRATIONS: SettingsMigrations = [];

/** Problems of a chain: gaps, steps that skip or go back, a wrong end. Empty — the chain is sound. */
export function migrationChainProblems(steps: SettingsMigrations, current: number = SETTINGS_SCHEMA_VERSION): string[] {
  const problems: string[] = [];
  steps.forEach((step, index) => {
    if (step.to !== step.from + 1) problems.push(`step ${index}: ${step.from} → ${step.to} is not one version forward`);
    const previous = steps[index - 1];
    if (previous && previous.to !== step.from) problems.push(`step ${index}: starts at ${step.from}, the previous ends at ${previous.to}`);
  });
  const last = steps.at(-1);
  if (last && last.to !== current) problems.push(`the chain ends at ${last.to}, the build is at ${current}`);
  return problems;
}

/** The oldest stored version this build can migrate from. */
export function oldestSupportedVersion(steps: SettingsMigrations, current: number = SETTINGS_SCHEMA_VERSION): number {
  return steps[0]?.from ?? current;
}

/**
 * Undo revision 2's forced light theme once. That revision did not record whether light was chosen or imposed,
 * so every light store marked 2 returns to «Как на сайте»; older explicit light choices stay. Preserve the text
 * size of revision 2 stores, and keep the larger-text upgrade for older stores. The next settings write carries
 * the new marker, so a theme chosen after this survives reloads (including light).
 */
export function takeUiDefaults(settings: SettingsV1): SettingsV1 {
  if (settings.ui.defaultsTaken === UI_DEFAULTS_REVISION) return settings;
  const theme = settings.ui.defaultsTaken === 2 && settings.ui.theme === 'light' ? 'host' : settings.ui.theme;
  const textSize = settings.ui.defaultsTaken === 2 ? settings.ui.textSize ?? 'normal' : 'large';
  return { ...settings, ui: { ...settings.ui, theme, textSize, defaultsTaken: UI_DEFAULTS_REVISION } };
}

export function loadStoredSettings(
  raw: unknown,
  migrations: SettingsMigrations = SETTINGS_MIGRATIONS,
  current: number = SETTINGS_SCHEMA_VERSION,
): SettingsLoadOutcome {
  if (raw === undefined) return { kind: 'fresh', settings: structuredCopy(DEFAULT_SETTINGS) };
  if (!isPlainRecord(raw)) return { kind: 'current', settings: structuredCopy(DEFAULT_SETTINGS), repaired: ['settings'] };
  const version = raw['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    const { settings, repaired } = repairSettings(raw);
    return { kind: 'current', settings: takeUiDefaults(settings), repaired: ['schemaVersion', ...repaired] };
  }
  if (version > current) return { kind: 'newer', settings: repairSettings(raw).settings, storedVersion: version };
  if (version === current) {
    const { settings, repaired } = repairSettings(raw);
    return { kind: 'current', settings: takeUiDefaults(settings), repaired };
  }
  if (migrationChainProblems(migrations, current).length > 0) return { kind: 'unreadable', code: 'CG-STORAGE-READ' };
  let value: Record<string, unknown> = { ...raw };
  for (let from = version; from < current; from += 1) {
    const step = migrations.find((candidate) => candidate.from === from);
    if (!step) return { kind: 'unreadable', code: 'CG-STORAGE-READ' };
    try {
      const next = step.migrate(value);
      if (!isPlainRecord(next)) return { kind: 'unreadable', code: 'CG-STORAGE-READ' };
      value = { ...next, schemaVersion: step.to };
    } catch {
      return { kind: 'unreadable', code: 'CG-STORAGE-READ' };
    }
  }
  const { settings, repaired } = repairSettings(value);
  return { kind: 'migrated', settings: takeUiDefaults(settings), from: version, repaired };
}

function structuredCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
