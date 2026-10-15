// The vault panel of a Fansly tab (1.15.0; R20 P13b; docs/project-unite/architecture.md §7.11, §7.21; FS-VLT-1,
// VA-001…VA-006): its view model, what the person asks of it, and the names of its texts.
//
// A site module, like send-fansly.ts: imported by its own subpath only (`@cg/contracts/vault-fansly`) and only by
// Fansly's own code — the panel (ui/hosts/fansly/vault), its controller (host-fansly/isolated/vault/panel.ts), its
// texts (core/domain/hosts/fansly/i18n/vault.ts) and Fansly's composition. Types and plain lists, no schema: nothing
// of it crosses a boundary between runtimes — the panel and its controller live in one tab; the checkpoint they keep
// in the background is `VaultCheckpoint` of tab-messages-fansly.ts.
//
// - The panel is a surface of Fansly's own (`FANSLY_SURFACES_AHEAD`), not a view of the shared AppClient: its model
//   comes from its own client (`VaultPanelClient`), which the composition hands to the surface, and its actions go
//   back there. `F` is the person's file as the page gives it (a DOM `File`): contracts carry no DOM types.
// - Its texts are Fansly's: keys `fansly.vault.*` in Fansly's catalogs (the shared catalogs never carry them, R20
//   §3.4). The shared I18n port takes them by name.

/** How the album should read top to bottom once the run is done; Fansly lists the newest upload first (VA-002). */
export const VAULT_ALBUM_ORDERS = ['first-on-top', 'last-on-top'] as const;
export type VaultAlbumOrder = (typeof VAULT_ALBUM_ORDERS)[number];

/** A run of the uploader (host-fansly isolated/vault/run.ts `VaultRunState`). */
export const VAULT_RUN_STATES = ['idle', 'running', 'pausing', 'paused', 'stopped', 'complete'] as const;
export type VaultRunStateName = (typeof VAULT_RUN_STATES)[number];

/** One file of a run (run.ts `VaultItemStatus`); `previous` — confirmed by a run before this one (its checkpoint). */
export const VAULT_ITEM_STATES = ['pending', 'present', 'uploading', 'verified', 'previous', 'failed', 'uncertain'] as const;
export type VaultItemState = (typeof VAULT_ITEM_STATES)[number];

/** Why a run stopped: the page's reasons (upload.ts `VAULT_HALTS`) and the run's own (run.ts `VaultStop`). */
export const VAULT_STOP_KINDS = [
  'route-left',
  'album-closed',
  'album-loading',
  'album-changed',
  'account-changed',
  'uploader-missing',
  'uploader-busy',
  'uploader-error',
  'handoff-unavailable',
  'handoff-indeterminate',
  'not-taken',
  'lost',
  'timeout',
  'stopped',
  'order-mismatch',
  'checkpoint-write-failed',
  'internal-error',
] as const;
export type VaultStopKind = (typeof VAULT_STOP_KINDS)[number];

/** A set the run cannot take as it is. */
export type VaultPlanProblem =
  /** Nothing the vault takes among the files. */
  | { readonly kind: 'empty' }
  /** Files whose album cards would read the same (the name without its extension): the second would never go. */
  | { readonly kind: 'duplicate-keys'; readonly names: readonly string[] }
  /** More files than one run takes (`vaultFilesPerUpload`). */
  | { readonly kind: 'too-many'; readonly count: number; readonly max: number };

/** What was left out of the set, or may not be confirmed. */
export interface VaultPlanWarning {
  readonly kind: 'non-ascii' | 'nested-ignored' | 'unsupported-ignored';
  readonly count: number;
}

/** One file of the set, in the album's order top to bottom. */
export interface VaultItemVM {
  readonly name: string;
  readonly size: number;
  readonly state: VaultItemState;
}

/** The person's files as the run will take them. */
export interface VaultSelectionVM {
  /** The picked folder's name; null — files picked one by one, or of several folders. */
  readonly folder: string | null;
  readonly bytes: number;
  readonly items: readonly VaultItemVM[];
  readonly problems: readonly VaultPlanProblem[];
  readonly warnings: readonly VaultPlanWarning[];
}

/**
 * A checkpoint the background keeps for the open album (VA-005): `found` — no files picked yet; `continue` — of these
 * very files, the run goes on from it; `other` — of other files: the person picks those again or drops it.
 */
export interface VaultResumeVM {
  readonly kind: 'found' | 'continue' | 'other';
  readonly done: number;
  readonly total: number;
}

export interface VaultStopVM {
  readonly kind: VaultStopKind;
  /** `order-mismatch`: the file expected on top, and what is there (null — no card seen). */
  readonly expected?: string;
  readonly actual?: string | null;
  /** `checkpoint-write-failed`: the file IS in the album; only the checkpoint does not say so. */
  readonly afterUpload?: boolean;
}

export interface VaultRunVM {
  readonly state: VaultRunStateName;
  /** Files in the album from the start of the set. */
  readonly done: number;
  readonly total: number;
  /** The file in flight. */
  readonly current: string | null;
  /** The album the run is bound to, as the page titled it. */
  readonly album: string | null;
  readonly stop: VaultStopVM | null;
  /** The code a stop is said with (`CG-VAULT-*`); null — none. */
  readonly code: string | null;
  /** Once complete: uploaded now, already in the album, confirmed by an earlier run. */
  readonly report: { readonly uploaded: number; readonly present: number; readonly previous: number } | null;
}

/** Why Start is not offered now (its tooltip); null — it is. */
export const VAULT_START_BLOCKS = ['files', 'problems', 'account', 'album', 'album-loading', 'uploader', 'uploader-busy', 'answer', 'other', 'checking', 'running', 'done', 'held'] as const;
export type VaultStartBlock = (typeof VAULT_START_BLOCKS)[number];

/**
 * A step on the checkpoint that failed, said until the next one succeeds: `read-failed` — the album's checkpoint could
 * not be read, so nothing starts (a fresh run over it would upload its files again); `save-failed` — the person's
 * answer was not written; `clear-failed` — a reset was not; `left-behind` — a finished run's checkpoint stayed;
 * `held` — another tab of this browser holds the album's upload (the background's word): this one writes nothing;
 * `moved` — another tab took the run further than this panel knew: the panel read the album's row again (review of
 * P13b).
 */
export type VaultPanelNote = 'read-failed' | 'save-failed' | 'clear-failed' | 'left-behind' | 'held' | 'moved';

export interface VaultPanelVM {
  /** On `/creator/vault` and admitted (the page's `vault`, the host's `vault`): the entry stands; false — nothing is drawn. */
  readonly shown: boolean;
  /** `closed` — the entry alone (VA-001); `open` — the panel; `minimized` — its strip. */
  readonly mode: 'closed' | 'open' | 'minimized';
  /** The tab's creator as the page names it (`@username`, else the display name); null — not said yet (AU-036). */
  readonly account: string | null;
  readonly album: { readonly state: 'open' | 'loading' | 'none'; readonly title: string | null };
  readonly uploader: 'ready' | 'busy' | 'missing';
  readonly order: VaultAlbumOrder;
  readonly selection: VaultSelectionVM | null;
  readonly resume: VaultResumeVM | null;
  /** The file handed over and never confirmed: the person says whether it is in the album (VA-004). */
  readonly question: { readonly name: string } | null;
  readonly run: VaultRunVM | null;
  readonly note: VaultPanelNote | null;
  /** «Сбросить прошлый запуск» asked once: the next click confirms. */
  readonly resetArmed: boolean;
  /** The request in flight (a checkpoint read, a write of the person's answer, a reset). */
  readonly busy: boolean;
  readonly controls: {
    readonly start: 'start' | 'resume';
    readonly blocked: VaultStartBlock | null;
    readonly pause: boolean;
    readonly reset: boolean;
    /** Close and minimize: not while a file is in flight (the person pauses first). */
    readonly close: boolean;
    /** Picking files and the order: not while a run holds them. */
    readonly pick: boolean;
  };
}

export type VaultPanelAction<F> =
  | { readonly type: 'open' }
  | { readonly type: 'close' }
  | { readonly type: 'minimize' }
  | { readonly type: 'pick'; readonly files: readonly F[] }
  | { readonly type: 'order'; readonly order: VaultAlbumOrder }
  | { readonly type: 'start' }
  | { readonly type: 'pause' }
  | { readonly type: 'answer'; readonly answer: 'present' | 'missing' }
  | { readonly type: 'reset' }
  | { readonly type: 'reset-cancel' }
  /** The person came back to the panel (a pointer, the focus): the page's facts are read again. */
  | { readonly type: 'refresh' };

/** The panel's own client: its model, its changes and its actions (the shared AppClient's discipline, for one surface). */
export interface VaultPanelClient<F> {
  view(): VaultPanelVM;
  subscribe(listener: (view: VaultPanelVM) => void): () => void;
  dispatch(action: VaultPanelAction<F>): void;
}

/** The panel's texts in Fansly's catalogs (plain; `{name}` marks a parameter). */
export const FANSLY_VAULT_TEXT_KEYS = [
  'fansly.vault.entry',
  'fansly.vault.entryHint',
  'fansly.vault.title',
  'fansly.vault.subtitle',
  'fansly.vault.close',
  'fansly.vault.closeBlocked',
  'fansly.vault.minimize',
  'fansly.vault.expand',
  'fansly.vault.account',
  'fansly.vault.accountUnknown',
  'fansly.vault.album',
  'fansly.vault.albumNone',
  'fansly.vault.albumLoading',
  'fansly.vault.uploader',
  'fansly.vault.uploaderReady',
  'fansly.vault.uploaderBusy',
  'fansly.vault.uploaderMissing',
  'fansly.vault.pickFolder',
  'fansly.vault.pickFiles',
  'fansly.vault.order',
  'fansly.vault.orderFirst',
  'fansly.vault.orderLast',
  'fansly.vault.orderHint',
  'fansly.vault.empty',
  'fansly.vault.size.b',
  'fansly.vault.size.kb',
  'fansly.vault.size.mb',
  'fansly.vault.size.gb',
  'fansly.vault.problem.empty',
  'fansly.vault.problem.duplicates',
  'fansly.vault.problem.tooMany',
  'fansly.vault.warning.nonAscii',
  'fansly.vault.warning.nested',
  'fansly.vault.warning.unsupported',
  'fansly.vault.resume.found',
  'fansly.vault.resume.continue',
  'fansly.vault.resume.other',
  'fansly.vault.reset',
  'fansly.vault.resetConfirm',
  'fansly.vault.resetYes',
  'fansly.vault.resetNo',
  'fansly.vault.note.readFailed',
  'fansly.vault.note.saveFailed',
  'fansly.vault.note.clearFailed',
  'fansly.vault.note.leftBehind',
  'fansly.vault.note.held',
  'fansly.vault.note.moved',
  'fansly.vault.question.title',
  'fansly.vault.question.body',
  'fansly.vault.question.present',
  'fansly.vault.question.missing',
  'fansly.vault.start',
  'fansly.vault.resumeRun',
  'fansly.vault.pause',
  'fansly.vault.pausing',
  'fansly.vault.progress',
  'fansly.vault.current',
  'fansly.vault.paused',
  'fansly.vault.complete',
  'fansly.vault.report.uploaded',
  'fansly.vault.report.present',
  'fansly.vault.report.previous',
  'fansly.vault.item.pending',
  'fansly.vault.item.present',
  'fansly.vault.item.uploading',
  'fansly.vault.item.verified',
  'fansly.vault.item.previous',
  'fansly.vault.item.failed',
  'fansly.vault.item.uncertain',
  'fansly.vault.stop.route-left',
  'fansly.vault.stop.album-closed',
  'fansly.vault.stop.album-loading',
  'fansly.vault.stop.album-changed',
  'fansly.vault.stop.account-changed',
  'fansly.vault.stop.uploader-missing',
  'fansly.vault.stop.uploader-busy',
  'fansly.vault.stop.uploader-error',
  'fansly.vault.stop.handoff-unavailable',
  'fansly.vault.stop.handoff-indeterminate',
  'fansly.vault.stop.not-taken',
  'fansly.vault.stop.lost',
  'fansly.vault.stop.timeout',
  'fansly.vault.stop.stopped',
  'fansly.vault.stop.order-mismatch',
  'fansly.vault.stop.order-unseen',
  'fansly.vault.stop.checkpoint-write-failed',
  'fansly.vault.stop.checkpoint-after-upload',
  'fansly.vault.stop.internal-error',
  'fansly.vault.blocked.files',
  'fansly.vault.blocked.problems',
  'fansly.vault.blocked.account',
  'fansly.vault.blocked.album',
  'fansly.vault.blocked.album-loading',
  'fansly.vault.blocked.uploader',
  'fansly.vault.blocked.uploader-busy',
  'fansly.vault.blocked.answer',
  'fansly.vault.blocked.other',
  'fansly.vault.blocked.checking',
  'fansly.vault.blocked.running',
  'fansly.vault.blocked.done',
  'fansly.vault.blocked.held',
  'fansly.vault.errorFrom',
  'fansly.vault.footnote',
] as const;
export type FanslyVaultTextKey = (typeof FANSLY_VAULT_TEXT_KEYS)[number];

/** The panel's plural texts: one form per category of the locale, the count is `{n}`. */
export const FANSLY_VAULT_PLURAL_KEYS = ['fansly.vault.files'] as const;
export type FanslyVaultPluralKey = (typeof FANSLY_VAULT_PLURAL_KEYS)[number];
