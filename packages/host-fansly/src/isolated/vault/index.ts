// host-fansly/isolated/vault — the vault uploader of a Fansly tab (docs/project-unite/architecture.md §7.11, §7.15,
// §7.19, §7.21; R20 P13a, P13b): the vault page as it reads it (dom.ts), a file into the page's own input
// (../handoff.ts, shared with the voice's attachment), one file confirmed (upload.ts), a run with its checkpoint
// (run.ts), the person's files as a run takes them (plan.ts), the panel's controller (panel.ts) and the port's single
// file (serve.ts). Its own entry, `@cg/host-fansly/isolated/vault`: the early isolated bundle (`fansly.js`) never
// carries it — it comes with the vault's panel, its lazy chunk (`lazy/fansly/vault.js`), over the port's vault facts
// (`FanslyPort.vault`). Nothing here talks to the network; checkpoints go through the store it is given.

export { VAULT_SELECTORS, isVaultPath, readVaultPage, vaultMediaKey, type VaultPage } from './dom';
export { HandoffIndeterminateError, handFile, type HandoffResult } from '../handoff';
export {
  VAULT_FILE_TIMEOUT_MS,
  VAULT_HALTS,
  createVaultUploader,
  vaultGuard,
  vaultTargetOf,
  type VaultHalt,
  type VaultPort,
  type VaultTarget,
  type VaultTimer,
  type VaultUploadOptions,
  type VaultUploadOutcome,
  type VaultUploader,
  type VaultUploaderEnv,
  type VaultUploaderStats,
  type VaultView,
} from './upload';
export {
  VAULT_CHECKPOINT_TTL_MS,
  VAULT_FILES_MAX,
  createVaultRun,
  findVaultCheckpoint,
  vaultDuplicateKeys,
  sameVaultFiles,
  vaultStopCode,
  type VaultCheckpointStore,
  type VaultFileRef,
  type VaultItemStatus,
  type VaultResume,
  type VaultRun,
  type VaultRunDeps,
  type VaultRunInit,
  type VaultRunSnapshot,
  type VaultRunState,
  type VaultStop,
} from './run';
export { VAULT_MEDIA_EXTENSIONS, isVaultMedia, planVaultUpload, type VaultPick, type VaultPlan } from './plan';
export { checkVaultOrder, createVaultPanel, vaultAccountLabel, type VaultPanel, type VaultPanelDeps, type VaultPanelStore } from './panel';
export { vaultUploadOf } from './serve';
