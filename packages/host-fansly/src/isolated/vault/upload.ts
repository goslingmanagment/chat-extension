// One file into the vault album open on the page, confirmed (docs/project-unite/architecture.md §7.11; FS-VLT-1,
// FS-VLT-2; R20 P13a). The step a run (run.ts) takes per file; the run writes its checkpoint before it.
//
// - Who and where (AU-036): the tab's creator, by the page's own `/account/me` (the port's account), and the album
//   by its id — the one the page loaded last on this address (`fx.vaultLoaded`), while its header stands. Both must
//   be the run's, and the page must be on `/creator/vault`, or nothing is handed over.
// - The handoff: the page's own `app-media-upload-input input[type=file]`, one file, one `change` (handoff.ts). The
//   page takes it at once — its «Processing Media» line or an upload template comes in the same task; nothing of it
//   — the page did not take the file, which is said as not known, never as «nothing happened».
// - The confirmation, all three in this order: an addition to an album (`fx.vaultAdded`, the page's `POST
//   /vault/albums/media` after its 1 s debounce, main:12828-12834) after the handoff; a load of THIS album after that
//   addition (`fx.vaultLoaded` with the run's album and a greater observation number: the page's `loadVault()`,
//   main:12818-12827); and the file's card in the album (its name, the extension aside: dom.ts). A load of another
//   album meanwhile — the person switched it, and the page added the file to that one — is not known.
// - Watched only while the file is in flight (FS-VLT-2): the vault's facts, the port's route and accounts, and one
//   `childList` observer on the album view, all taken off when the step settles; idle, the uploader watches nothing.
//   The only timer is the file's time limit, 45 min (the old extension's: a 1 GB video took most of it).
// - Never a second handoff of the same file: whatever was handed and not confirmed is `unknown`, and only the
//   person's answer decides what happens to it (VA-004, run.ts).

import type { FanslyHandoffPath } from '@cg/contracts/fansly';
import type { HostEvent } from '@cg/contracts/host';

import type { FanslyPort } from '../host-port';
import { isVaultPath, readVaultPage, VAULT_SELECTORS, vaultMediaKey, type VaultPage } from './dom';
import { handFile } from './handoff';

/** How long one file may take to be confirmed (the old extension's limit). */
export const VAULT_FILE_TIMEOUT_MS = 45 * 60 * 1000;

/** The account and the album a run is bound to (the checkpoint's key, `fansly.vault.*`). */
export interface VaultTarget {
  readonly hostAccountId: string;
  readonly albumId: string;
}

/**
 * Why a step was not taken or not seen to its end — the stops of the old runner that the page can cause:
 * `route-left` — not on `/creator/vault`; `album-closed` — no album open, or its id unknown (a type album);
 * `album-changed` — another album than the run's; `account-changed` — another creator, or none (AU-036);
 * `uploader-missing` — «Upload to Vault» not expanded; `uploader-busy` — a file of the page's own in progress;
 * `uploader-error` — Fansly gave the file up, nothing landed; `handoff-unavailable` — the input took nothing;
 * `handoff-indeterminate` — the dispatch may have reached the page; `not-taken` — the page showed no sign of the
 * file; `timeout` — not confirmed within the limit; `stopped` — the run was stopped with the file in flight.
 */
export const VAULT_HALTS = [
  'route-left',
  'album-closed',
  'album-changed',
  'account-changed',
  'uploader-missing',
  'uploader-busy',
  'uploader-error',
  'handoff-unavailable',
  'handoff-indeterminate',
  'not-taken',
  'timeout',
  'stopped',
] as const;
export type VaultHalt = (typeof VAULT_HALTS)[number];

export type VaultUploadOutcome =
  /** Confirmed by the addition, the reload of the album and the file's card; `top` — the album's first card after. */
  | { readonly state: 'done'; readonly path: FanslyHandoffPath; readonly top: string | null }
  /** Nothing was handed over. */
  | { readonly state: 'refused'; readonly halt: VaultHalt }
  /** Handed over, and Fansly gave it up: nothing landed — a new click may try again. */
  | { readonly state: 'failed'; readonly path: FanslyHandoffPath }
  /** Handed over (or maybe), the outcome not seen: only the person says what happened to it. */
  | { readonly state: 'unknown'; readonly halt: VaultHalt; readonly path: FanslyHandoffPath | null };

/** What the page shows the uploader now. */
export interface VaultView {
  /** On `/creator/vault`. */
  readonly route: boolean;
  /** The tab's creator (Fansly `account.id`); null — the page has not said it yet (AU-036). */
  readonly hostAccountId: string | null;
  /** The open album's id; null — none open, or one without an id. */
  readonly albumId: string | null;
  readonly title: string | null;
  readonly uploader: 'ready' | 'busy' | 'missing';
  /** The album's cards as keys (dom.ts `vaultMediaKey`), the page's order: the newest first. */
  readonly cards: readonly string[];
}

export interface VaultUploaderStats {
  /** A file is in flight: the album view, the facts, the route and the accounts are watched. */
  readonly watching: boolean;
  /** Steps that watched, since the uploader was made. */
  readonly watches: number;
  /** Callbacks of the album view's observer, since the uploader was made. */
  readonly mutations: number;
}

export interface VaultUploader {
  view(): VaultView;
  /** Hands `file` to the open album of `target` and waits for its confirmation; never rejects. One at a time. */
  upload(file: File, target: VaultTarget, signal?: AbortSignal): Promise<VaultUploadOutcome>;
  stats(): VaultUploaderStats;
}

/** The port's members the uploader reads: the vault's facts, the account, and its route and account events. */
export type VaultPort = Pick<FanslyPort, 'vault' | 'current' | 'subscribe'>;

export interface VaultTimer {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface VaultUploaderEnv {
  readonly win: Window;
  readonly port: VaultPort;
  readonly timeoutMs?: number;
  readonly timer?: VaultTimer;
}

/**
 * The account and album a run of the page as it is now would belong to; null — the page has not named its creator
 * (never a guess, AU-036) or no album with an id is open.
 */
export function vaultTargetOf(view: VaultView): VaultTarget | null {
  return view.route && view.hostAccountId !== null && view.albumId !== null ? { hostAccountId: view.hostAccountId, albumId: view.albumId } : null;
}

/** Why `view` cannot take `target`'s file, or null — it can. */
export function vaultGuard(view: VaultView, target: VaultTarget): VaultHalt | null {
  if (!view.route) return 'route-left';
  if (view.hostAccountId !== target.hostAccountId) return 'account-changed';
  if (view.albumId === null) return 'album-closed';
  return view.albumId === target.albumId ? null : 'album-changed';
}

export function createVaultUploader(env: VaultUploaderEnv): VaultUploader {
  const { win, port } = env;
  const doc = win.document;
  const limit = env.timeoutMs ?? VAULT_FILE_TIMEOUT_MS;
  const timer: VaultTimer = env.timer ?? { set: (callback, ms) => win.setTimeout(callback, ms), clear: (handle) => win.clearTimeout(handle as number) };
  let watching = false;
  let watches = 0;
  let mutations = 0;

  const viewOf = (page: VaultPage): VaultView => {
    const loaded = port.vault.album();
    return {
      route: isVaultPath(win.location.pathname),
      hostAccountId: port.current().accounts[0]?.hostAccountId ?? null,
      albumId: page.albumOpen ? (loaded?.albumId ?? null) : null,
      title: page.albumOpen ? page.title : null,
      uploader: page.input === null ? 'missing' : page.busy ? 'busy' : 'ready',
      cards: page.cards,
    };
  };

  const upload = (file: File, target: VaultTarget, signal?: AbortSignal): Promise<VaultUploadOutcome> => {
    if (watching) return Promise.resolve({ state: 'refused', halt: 'uploader-busy' });
    // The page as it is at the very moment of the handoff: what changed since the run looked is a refusal.
    const page = readVaultPage(doc);
    const now = viewOf(page);
    const blocked = vaultGuard(now, target) ?? (now.uploader === 'busy' ? 'uploader-busy' : null);
    const { input, host } = page;
    if (blocked !== null || input === null || host === null) return Promise.resolve({ state: 'refused', halt: blocked ?? 'uploader-missing' });
    if (signal?.aborted === true) return Promise.resolve({ state: 'refused', halt: 'stopped' });
    const key = vaultMediaKey(file.name);

    return new Promise<VaultUploadOutcome>((resolve) => {
      let path: FanslyHandoffPath | null = null;
      /** The newest addition seen since the handoff; null — none yet. */
      let added: number | null = null;
      let reloaded = false;
      const offs: Array<() => void> = [];
      const settle = (outcome: VaultUploadOutcome): void => {
        if (!watching) return;
        watching = false;
        for (const off of offs.splice(0)) off();
        resolve(outcome);
      };
      const unknown = (halt: VaultHalt): void => settle({ state: 'unknown', halt, path });
      const check = (): void => {
        const after = readVaultPage(doc);
        // Fansly gave the file up before adding anything: nothing landed.
        if (added === null && after.failed && path !== null) return settle({ state: 'failed', path });
        if (reloaded && path !== null && after.cards.includes(key)) settle({ state: 'done', path, top: after.cards[0] ?? null });
      };

      // Everything that can settle the step is armed before the page sees the file — and only now (FS-VLT-2).
      watching = true;
      watches += 1;
      offs.push(
        port.vault.onFact((fact) => {
          if (fact.t === 'fx.vaultAdded') {
            added = Math.max(added ?? 0, fact.p.seq);
            return;
          }
          // The page shows another album: the addition may have gone to it.
          if (fact.p.albumId !== target.albumId) return unknown('album-changed');
          if (added !== null && fact.p.seq > added) reloaded = true;
          check();
        }),
        port.subscribe((event: HostEvent) => {
          if (event.type === 'route' && !isVaultPath(win.location.pathname)) unknown('route-left');
          else if (event.type === 'accounts' && event.accounts[0]?.hostAccountId !== target.hostAccountId) unknown('account-changed');
        }),
      );
      const observer = new (win as Window & typeof globalThis).MutationObserver(() => {
        mutations += 1;
        check();
      });
      observer.observe(host, { childList: true, subtree: true });
      offs.push(() => observer.disconnect());
      const deadline = timer.set(() => unknown('timeout'), limit);
      offs.push(() => timer.clear(deadline));
      if (signal !== undefined) {
        const onAbort = (): void => unknown('stopped');
        signal.addEventListener('abort', onAbort);
        offs.push(() => signal.removeEventListener('abort', onAbort));
      }

      let handed: ReturnType<typeof handFile>;
      try {
        handed = handFile(win, input, file, `${VAULT_SELECTORS.host} ${VAULT_SELECTORS.uploader} ${VAULT_SELECTORS.input}`);
      } catch {
        // HandoffIndeterminateError, or anything else once the input was touched: the page may have the file.
        return unknown('handoff-indeterminate');
      }
      if (handed === 'unavailable') return settle({ state: 'refused', halt: 'handoff-unavailable' });
      path = handed;
      // The page takes a file in the same task (its processing line, main:11752); no sign of it — it did not.
      if (!readVaultPage(doc).busy) unknown('not-taken');
    });
  };

  return { view: () => viewOf(readVaultPage(doc)), upload, stats: () => ({ watching, watches, mutations }) };
}
