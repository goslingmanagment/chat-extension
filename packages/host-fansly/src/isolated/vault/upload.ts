// One file into the vault album open on the page, confirmed (docs/project-unite/architecture.md §7.11, §7.19;
// FS-VLT-1, FS-VLT-2; R20 P13a). The step a run (run.ts) takes per file; the run writes its checkpoint before it.
//
// - Who (AU-036): the tab's creator, by the page's own `/account/me` (the port's account).
// - Which album: the one the page shows, bound to the load it shows. The page names an album only by the address it
//   loads it with, which MAIN alone sees (`fx.vaultLoaded`); the page's own `selectedVaultAlbum`, where its upload
//   goes, is the album of the load it STARTED last. So the uploader binds the album of the load started last (the
//   port keeps it) to the list that load rendered — a new element for every load that answers (dom.ts) — and to the
//   title shown then. The album is known only while the page shows exactly that: its spinner (a load on the way), a
//   list rendered after it (an answer MAIN's word has not reached yet), another title — no album, nothing handed
//   over. A loss of MAIN's facts or another life of the address unbinds it until the page loads one again.
// - The handoff: the page's own `app-media-upload-input input[type=file]`, one file, one `change` (handoff.ts) — and
//   only on the page as the run's ticket saw it before its checkpoint write (`ticket()`: the port's generation and
//   the bound load). The page takes the file at once — its «Processing Media» line or an upload template comes in
//   the same task; nothing of it — the page did not take the file, said as not known, never as «nothing happened».
// - The confirmation, fenced after the handoff: every observation MAIN numbered before it — an addition or a load
//   that began earlier and answers late — is no evidence. Then all of it, in this order: an addition to an album
//   (`fx.vaultAdded`, the page's `POST /vault/albums/media` after its 1 s debounce, main:12828-12834); a load of THIS
//   album after that addition (the page's `loadVault()`, main:12818-12827); the file's card in the album, settled
//   (no «Processing» on it), with the page's upload line gone. A load of another album after the handoff — the person
//   switched it, and the page added the file to that one — the album closed, «Upload to Vault» collapsed, the route,
//   the creator, a loss of MAIN's facts: not known, at once.
// - Watched only while the file is in flight (FS-VLT-2): one `childList` observer on the album view and the file's
//   time limit, 45 min (the old extension's: a 1 GB video took most of it); idle, the uploader observes nothing on the
//   page. What it hears all along is the port's: the vault's facts, losses, route and accounts — the binding's.
// - Never a second handoff of the same file: whatever was handed and not confirmed is `unknown`, and only the
//   person's answer decides what happens to it (VA-004, run.ts).

import type { FanslyHandoffPath } from '@cg/contracts/fansly';
import type { HostEvent } from '@cg/contracts/host';

import type { FanslyPort, FanslyVaultFact, FanslyVaultFacts } from '../host-port';
import { isVaultPath, readVaultPage, VAULT_SELECTORS, vaultMediaKey, type VaultPage } from './dom';
import { handFile } from './handoff';

/** How long one file may take to be confirmed (the old extension's limit). */
export const VAULT_FILE_TIMEOUT_MS = 45 * 60 * 1000;

/**
 * The account and the album a run is bound to (the checkpoint's key, `fansly.vault.*`), and the album's title as the
 * page showed it when the run began: an album renamed or another one of a different title is not the run's.
 */
export interface VaultTarget {
  readonly hostAccountId: string;
  readonly albumId: string;
  readonly title?: string | null;
}

/**
 * Why a step was not taken or not seen to its end — the stops of the old runner that the page can cause:
 * `route-left` — not on `/creator/vault`, or another life of the address since the run looked; `album-closed` — no
 * album open, or its id unknown (a type album); `album-loading` — the album shown is not yet the album of a load MAIN
 * named; `album-changed` — another album than the run's, or another load of it since the run looked;
 * `account-changed` — another creator, or none (AU-036); `uploader-missing` — «Upload to Vault» not expanded;
 * `uploader-busy` — a file of the page's own in progress; `uploader-error` — Fansly gave the file up, nothing landed;
 * `handoff-unavailable` — the input took nothing; `handoff-indeterminate` — the dispatch may have reached the page;
 * `not-taken` — the page showed no sign of the file; `lost` — MAIN's facts were lost; `timeout` — not confirmed
 * within the limit; `stopped` — the run was stopped with the file in flight.
 */
export const VAULT_HALTS = [
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
] as const;
export type VaultHalt = (typeof VAULT_HALTS)[number];

export type VaultUploadOutcome =
  /** Confirmed by the addition, the reload of the album and the file's card; `top` — the album's first card after. */
  | { readonly state: 'done'; readonly path: FanslyHandoffPath; readonly top: string | null }
  /** Nothing was handed over. */
  | { readonly state: 'refused'; readonly halt: VaultHalt }
  /** Handed over, and Fansly gave it up: nothing landed — a new click may try again. `said` — Fansly's own words. */
  | { readonly state: 'failed'; readonly path: FanslyHandoffPath; readonly said: string | null }
  /** Handed over (or maybe), the outcome not seen: only the person says what happened to it. */
  | { readonly state: 'unknown'; readonly halt: VaultHalt; readonly path: FanslyHandoffPath | null };

/** What the page shows the uploader now. */
export interface VaultView {
  /** On `/creator/vault`. */
  readonly route: boolean;
  /** The tab's creator (Fansly `account.id`); null — the page has not said it yet (AU-036). */
  readonly hostAccountId: string | null;
  /** The open album's id; null — none open, one without an id, or not yet the album of a load MAIN named. */
  readonly albumId: string | null;
  readonly title: string | null;
  /** An album is open and its load is on the way, or its answer is not yet bound to MAIN's word of it. */
  readonly loading: boolean;
  readonly uploader: 'ready' | 'busy' | 'missing';
  /** The album's cards as keys (dom.ts `vaultMediaKey`), the page's order: the newest first. */
  readonly cards: readonly string[];
  /** The same cards' file names as the page shows them. */
  readonly names: readonly string[];
  /** The cards Fansly is done with (no «Processing», no failure on them), as keys: the ones that count as in the album. */
  readonly settled: readonly string[];
}

export interface VaultUploaderStats {
  /** A file is in flight: the album view, the facts, the route and the accounts are watched. */
  readonly watching: boolean;
  /** Steps that watched, since the uploader was made. */
  readonly watches: number;
  /** Callbacks of the album view's observer, since the uploader was made. */
  readonly mutations: number;
}

export interface VaultUploadOptions {
  /** Stops the wait: the file in flight is not known. */
  readonly signal?: AbortSignal;
  /** `ticket()` taken before the run's checkpoint write: the page that moved since takes nothing. */
  readonly ticket?: string;
}

export interface VaultUploader {
  view(): VaultView;
  /** The page as the uploader knows it now: the port's generation and the bound load. */
  ticket(): string;
  /** Hands `file` to the open album of `target` and waits for its confirmation; never rejects. One at a time. */
  upload(file: File, target: VaultTarget, options?: VaultUploadOptions): Promise<VaultUploadOutcome>;
  stats(): VaultUploaderStats;
  /** Stops hearing the port; a file in flight is not known. */
  dispose(): void;
}

/** The port's members the uploader reads: the vault's facts, the account, and its route and account events. */
export type VaultPort = Pick<FanslyPort, 'current' | 'subscribe'> & { readonly vault: Pick<FanslyVaultFacts, 'album' | 'onFact' | 'onLost'> };

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
 * (never a guess, AU-036) or no album with an id is open and bound.
 */
export function vaultTargetOf(view: VaultView): VaultTarget | null {
  return view.route && view.hostAccountId !== null && view.albumId !== null ? { hostAccountId: view.hostAccountId, albumId: view.albumId, title: view.title } : null;
}

/** Why `view` cannot take `target`'s file, or null — it can. */
export function vaultGuard(view: VaultView, target: VaultTarget): VaultHalt | null {
  if (!view.route) return 'route-left';
  if (view.hostAccountId !== target.hostAccountId) return 'account-changed';
  if (view.loading) return 'album-loading';
  if (view.albumId === null) return 'album-closed';
  if (view.albumId !== target.albumId) return 'album-changed';
  return target.title === undefined || target.title === view.title ? null : 'album-changed';
}

/** The album of the load the page started last, bound to what that load rendered. */
interface Binding {
  readonly albumId: string | null;
  readonly seq: number;
  readonly list: Element | null;
  readonly title: string | null;
}

/** The file in flight: whose it is, and what settles it. */
interface Flight {
  readonly account: string;
  fact(fact: FanslyVaultFact): void;
  halt(halt: VaultHalt): void;
}

export function createVaultUploader(env: VaultUploaderEnv): VaultUploader {
  const { win, port } = env;
  const doc = win.document;
  const limit = env.timeoutMs ?? VAULT_FILE_TIMEOUT_MS;
  const timer: VaultTimer = env.timer ?? { set: (callback, ms) => win.setTimeout(callback, ms), clear: (handle) => win.clearTimeout(handle as number) };
  let flight: Flight | null = null;
  let watches = 0;
  let mutations = 0;
  let disposed = false;
  /** The greatest observation number of the vault's facts heard: the fence of a handoff. */
  let heard = 0;
  let bound: Binding | null = null;
  const bind = (albumId: string | null, seq: number): void => {
    const page = readVaultPage(doc);
    bound = { albumId, seq, list: page.list, title: page.title };
  };
  const generation = (): number => port.current().route.epoch;
  let life = generation();
  const known = port.vault.album();
  if (known !== null) {
    heard = known.seq;
    bind(known.albumId, known.seq);
  }

  const offs = [
    port.vault.onFact((fact) => {
      heard = Math.max(heard, fact.p.seq);
      // Only the load started last is the page's album: a late answer of an earlier one binds nothing.
      if (fact.t === 'fx.vaultLoaded' && (bound === null || fact.p.seq > bound.seq)) bind(fact.p.albumId, fact.p.seq);
      flight?.fact(fact);
    }),
    port.vault.onLost(() => {
      bound = null;
      flight?.halt('lost');
    }),
    port.subscribe((event: HostEvent) => {
      const creator = port.current().accounts[0]?.hostAccountId ?? null;
      if (flight !== null && creator !== flight.account) return flight.halt('account-changed');
      // Another generation of the port — another address, a return from bfcache: unbound, and the file in flight is
      // not seen to its end on the page it was handed to.
      if (event.type === 'route' && generation() !== life) {
        life = generation();
        bound = null;
        flight?.halt('route-left');
      }
    }),
  ];

  const viewOf = (page: VaultPage): VaultView => {
    const shown = bound !== null && page.albumOpen && !page.loading && page.list !== null && page.list === bound.list && page.title === bound.title;
    return {
      route: isVaultPath(win.location.pathname),
      hostAccountId: port.current().accounts[0]?.hostAccountId ?? null,
      albumId: shown ? (bound?.albumId ?? null) : null,
      title: page.albumOpen ? page.title : null,
      loading: page.albumOpen && !shown && (page.loading || bound === null || page.list !== bound.list),
      uploader: page.input === null ? 'missing' : page.busy ? 'busy' : 'ready',
      cards: page.cards,
      names: page.names,
      settled: page.settled,
    };
  };
  const ticket = (): string => `${String(generation())}:${String(bound?.seq ?? 'none')}`;

  const upload = (file: File, target: VaultTarget, options: VaultUploadOptions = {}): Promise<VaultUploadOutcome> => {
    if (flight !== null || disposed) return Promise.resolve({ state: 'refused', halt: 'uploader-busy' });
    // The page as it is at the very moment of the handoff: what changed since the run looked is a refusal.
    const page = readVaultPage(doc);
    const now = viewOf(page);
    let blocked = vaultGuard(now, target) ?? (now.uploader === 'busy' ? 'uploader-busy' : null);
    if (blocked === null && options.ticket !== undefined && options.ticket !== ticket()) {
      blocked = options.ticket.split(':')[0] === String(generation()) ? 'album-changed' : 'route-left';
    }
    const { input, host } = page;
    if (blocked !== null || input === null || host === null) return Promise.resolve({ state: 'refused', halt: blocked ?? 'uploader-missing' });
    const { signal } = options;
    if (signal?.aborted === true) return Promise.resolve({ state: 'refused', halt: 'stopped' });
    const key = vaultMediaKey(file.name);
    /** Every observation numbered up to now began before the handoff: no evidence of it. */
    const fence = Math.max(heard, bound?.seq ?? 0);

    return new Promise<VaultUploadOutcome>((resolve) => {
      let path: FanslyHandoffPath | null = null;
      /** The newest addition after the fence; null — none yet. */
      let added: number | null = null;
      let reloaded = false;
      const offs: Array<() => void> = [];
      const settle = (outcome: VaultUploadOutcome): void => {
        if (flight !== current) return;
        flight = null;
        for (const off of offs.splice(0)) off();
        resolve(outcome);
      };
      const unknown = (halt: VaultHalt): void => settle({ state: 'unknown', halt, path });
      const check = (): void => {
        if (path === null) return;
        const after = readVaultPage(doc);
        // The album closed, «Upload to Vault» collapsed: whatever the page does with the file now is not seen.
        if (!after.albumOpen) return unknown('album-closed');
        if (after.input === null) return unknown('uploader-missing');
        // Fansly gave the file up before adding anything: nothing landed.
        if (added === null && after.failed) return settle({ state: 'failed', path, said: after.failure });
        if (reloaded && !after.busy && after.settled.includes(key)) settle({ state: 'done', path, top: after.cards[0] ?? null });
      };
      const current: Flight = {
        account: target.hostAccountId,
        fact(fact) {
          if (fact.p.seq <= fence) return;
          if (fact.t === 'fx.vaultAdded') {
            added = Math.max(added ?? 0, fact.p.seq);
            return;
          }
          // The page shows another album: the addition may have gone to it.
          if (fact.p.albumId !== target.albumId) return unknown('album-changed');
          if (added !== null && fact.p.seq > added) reloaded = true;
          check();
        },
        halt: unknown,
      };

      // Everything that can settle the step is armed before the page sees the file — the page's album only now
      // (FS-VLT-2).
      flight = current;
      watches += 1;
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

  return {
    view: () => viewOf(readVaultPage(doc)),
    ticket,
    upload,
    stats: () => ({ watching: flight !== null, watches, mutations }),
    dispose() {
      if (disposed) return;
      disposed = true;
      flight?.halt('stopped');
      for (const off of offs) off();
    },
  };
}
