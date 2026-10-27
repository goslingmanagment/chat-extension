// Byte budgets of the storage keys (architecture.md §9.4 «Пределы хранилищ»,
// §5.6): the composition root hands `storageBudgetOf` to the platform's
// storage wrappers, which refuse a larger value with CG-STORAGE-FULL before
// the browser is asked. `unlimitedStorage` is not requested (§3): these are
// the extension's own caps.

import { STORAGE_KEYS } from '@cg/contracts/settings';
import { STORAGE_LIMITS } from '@cg/contracts/limits';

const KiB = 1024;
const MiB = 1024 * KiB;

/** storage.session keys of the background (results of operations, the settings revision). */
export const SESSION_KEYS = {
  /** Index of the stored results: ids, owners, sizes, times. */
  resultsIndex: 'results.index',
  /** Prefix of one stored result: `result.<opId>`. */
  resultPrefix: 'result.',
  /** Revision of the settings, monotonic while the browser runs (§9.4 «с ревизией»). */
  settingsRevision: 'settings.revision',
  /** The greeting leases of «Новые» this install holds (H-7): tokens and deadlines, no text. */
  greetingLeases: 'newcomers.leases',
  /** 1.15.0: revision of `settings.ext`, its own counter. */
  settingsExtRevision: 'settings.ext.revision',
} as const;

/** storage.local keys of the background that are not part of the frozen `STORAGE_KEYS`. */
export const LOCAL_KEYS = {
  /** 500 seen models, at most 16 decimal ids (30 digits) each; no session secrets. */
  soundAccounts: 'sound.accounts',
  /** Registrations of human sends the hub has not answered yet (§6.6, H-7): ids only. */
  nativeSends: 'send.native',
  /** The error counters of today and of the day before, by CG code (LG-010): codes and counts only. */
  dayCounters: 'log.counters',
  /** The X8 fuse (decision X25): when and why it tripped, on which ChatSpace build, its last reset. No text. */
  sendFuse: 'send.fuse',
  /** 1.21.0 (decision X48): who-sent facts the hub has not answered yet — ids, a time and two marks; no text. */
  sendAttributions: 'send.attribution',
  /** Who wrote each Fansly note: facts the hub has not answered yet — ids, an action, questionnaire labels; no text. */
  noteAttributions: 'note.attribution',
} as const;

/** One stored result (an OpView: up to 64k characters of stream plus the parsed result). */
export const RESULT_MAX_BYTES = 512 * KiB;

export const STORAGE_KEY_BUDGETS: Readonly<Record<string, number>> = {
  [STORAGE_KEYS.settings]: 256 * KiB,
  /** 1.15.0: a site's few switches and a depth (`settings.ext`); room for later sites and fields. */
  [STORAGE_KEYS.settingsExt]: 16 * KiB,
  [STORAGE_KEYS.authToken]: 16 * KiB,
  [STORAGE_KEYS.authMeta]: 16 * KiB,
  [STORAGE_KEYS.cacheBootstrap]: 1 * MiB,
  [STORAGE_KEYS.cacheCatalog]: 1 * MiB,
  [STORAGE_KEYS.presence]: 256 * KiB,
  /** 500 events of a few hundred bytes (TL-009). */
  [STORAGE_KEYS.telemetryQueue]: 1 * MiB,
  /** No text: ids, states, times; open entries are never dropped. */
  [STORAGE_KEYS.sendJournal]: 1 * MiB,
  /** «Новые» drafts: up to 400 and 1 MiB with their removal marks (§9.4). */
  [STORAGE_KEYS.newcomersDrafts]: STORAGE_LIMITS.previewDraftsTotalBytes,
  /** 500 models × 16 ids of up to 30 digits, plus canonical keys and JSON. */
  [LOCAL_KEYS.soundAccounts]: 320 * KiB,
  /** No text: at most 200 registrations of a few hundred bytes. */
  [LOCAL_KEYS.nativeSends]: 256 * KiB,
  /** Two days × the CG registry (about a hundred codes), some forty bytes a code. */
  [LOCAL_KEYS.dayCounters]: 16 * KiB,
  /** One fuse record and a counter: a few hundred bytes. */
  [LOCAL_KEYS.sendFuse]: 4 * KiB,
  /** No text: at most 1000 facts of about 250 bytes. */
  [LOCAL_KEYS.sendAttributions]: 512 * KiB,
  /** No text: at most 1000 facts of about 300 bytes; a fill names a few questionnaire labels. */
  [LOCAL_KEYS.noteAttributions]: 1 * MiB,
  [SESSION_KEYS.resultsIndex]: 1 * MiB,
  [SESSION_KEYS.settingsRevision]: 64,
  [SESSION_KEYS.settingsExtRevision]: 64,
};

/** The budget of a key: its own, the per-result budget for `result.*`, or none. */
export function storageBudgetOf(key: string): number | undefined {
  if (key.startsWith(SESSION_KEYS.resultPrefix)) return RESULT_MAX_BYTES;
  return STORAGE_KEY_BUDGETS[key];
}
