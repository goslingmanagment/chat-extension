export { repairSettings, type SettingsRepair } from './repair';
export { SETTINGS_MIGRATIONS, loadStoredSettings, migrationChainProblems, oldestSupportedVersion } from './load';
export { applySettingsPatch, touchesRestricted, withPersonaScope, type SettingsPatchOutcome } from './patch';
