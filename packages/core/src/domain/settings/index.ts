export { repairSettings, type SettingsRepair } from './repair';
export { SETTINGS_MIGRATIONS, loadStoredSettings, migrationChainProblems, oldestSupportedVersion } from './load';
export { applySettingsPatch, touchesRestricted, withPersonaScope, type SettingsPatchOutcome } from './patch';
export { SYSTEM_LOCALE_LAST_VERSION, SYSTEM_LOCALE_REWRITE, rewritesSystemLocale } from './locale-on-update';
export { applySettingsExtPatch, loadStoredSettingsExt, type SettingsExtPatchOutcome } from './ext';
