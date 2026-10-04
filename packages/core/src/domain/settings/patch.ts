// Applying a settings change (architecture.md §5.6, §9.4; ST-013…ST-018):
// sections merge field by field, `null` in the two maps removes a key,
// `mutedAccounts` is replaced whole, `personas.scope` is never patched. A new
// hub address drops the persona choices (they are pages of another hub,
// BG-005). The result must pass the schema as a whole (map caps included).

import {
  SETTINGS_OPTIONS_ONLY_SECTIONS,
  SettingsSchema,
  type SettingsPatch,
  type SettingsV1,
} from '@cg/contracts/settings';

import { stableJson } from '../storage/json';

export type SettingsPatchOutcome =
  | { readonly ok: true; readonly settings: SettingsV1; readonly changed: boolean; readonly hubChanged: boolean }
  | { readonly ok: false; readonly reason: 'restricted' | 'invalid' };

type Partial2<T> = { readonly [K in keyof T]?: T[K] | undefined };

/** Copies only the fields the patch actually carries (an absent or undefined field keeps its value). */
function merge<T extends object>(base: T, patch: Partial2<T> | undefined): T {
  if (patch === undefined) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) out[key] = value;
  return out as T;
}

function mergeMap<V>(base: Readonly<Record<string, V>>, patch: Readonly<Record<string, V | null>> | undefined): Record<string, V> {
  const out: Record<string, V> = { ...base };
  if (patch === undefined) return out;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

/** Whether a patch touches a section only the options page may change (`settings.patchRestricted`). */
export function touchesRestricted(patch: SettingsPatch): boolean {
  return SETTINGS_OPTIONS_ONLY_SECTIONS.some((section) => patch[section] !== undefined);
}

export function applySettingsPatch(current: SettingsV1, patch: SettingsPatch, options: { readonly restricted: boolean }): SettingsPatchOutcome {
  if (!options.restricted && touchesRestricted(patch)) return { ok: false, reason: 'restricted' };
  const hub = merge(current.hub, patch.hub);
  const hubChanged = hub.baseUrl !== current.hub.baseUrl;
  const next: SettingsV1 = {
    schemaVersion: current.schemaVersion,
    hub,
    ui: merge(current.ui, patch.ui),
    generation: {
      split: patch.generation?.split ?? current.generation.split,
      windows: merge(current.generation.windows, patch.generation?.windows),
      coach: merge(current.generation.coach, patch.generation?.coach),
    },
    sound: {
      messages: merge(current.sound.messages, patch.sound?.messages),
      subscribers: merge(current.sound.subscribers, patch.sound?.subscribers),
      volume: patch.sound?.volume ?? current.sound.volume,
      mutedAccounts: patch.sound?.mutedAccounts !== undefined ? [...new Set(patch.sound.mutedAccounts)] : current.sound.mutedAccounts,
    },
    personas: hubChanged
      ? { scope: null, byPageId: {} }
      : { scope: current.personas.scope, byPageId: mergeMap(current.personas.byPageId, patch.personas?.byPageId) },
    accounts: { labels: mergeMap(current.accounts.labels, patch.accounts?.labels) },
    debug: merge(current.debug, patch.debug),
    onboarding: merge(current.onboarding, patch.onboarding),
  };
  const checked = SettingsSchema.safeParse(next);
  if (!checked.success) return { ok: false, reason: 'invalid' };
  return { ok: true, settings: checked.data, changed: stableJson(checked.data) !== stableJson(current), hubChanged };
}

/**
 * The persona choices belong to one hub and one user (`personas.scope`):
 * another scope signing in clears them; the same scope keeps them. Never
 * patched by a tab or page — the background calls this on sign-in.
 */
export function withPersonaScope(current: SettingsV1, scope: SettingsV1['personas']['scope']): SettingsV1 {
  const same = scope !== null && current.personas.scope !== null && current.personas.scope.hubOrigin === scope.hubOrigin && current.personas.scope.userId === scope.userId;
  if (same) return current;
  if (scope === null && current.personas.scope === null && Object.keys(current.personas.byPageId).length === 0) return current;
  return { ...current, personas: { scope, byPageId: {} } };
}
