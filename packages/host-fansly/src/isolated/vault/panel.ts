// The vault panel's controller (docs/project-unite/architecture.md §7.11, §7.21; FS-VLT-1; VA-001…VA-006; R20 P13b):
// what the person sees and asks on `/creator/vault`, over the uploader and the run of P13a. The old extension's panel
// (fansly-chat `src/content/vault/vault-panel.ts`) without its DOM: the model is `VaultPanelVM`
// (contracts vault-fansly.ts), the panel's UI draws it (ui/hosts/fansly/vault) and asks by `VaultPanelAction`.
//
// - The page's facts — the creator, the open album, «Upload to Vault» — are read when something says they moved: the
//   port's route and accounts, MAIN's vault facts, the person coming back to the panel (`refresh`), an action. No
//   timer (the old panel re-read the page every second, VA-006) and no observer: the album is watched only while a
//   file is in flight, by the uploader (FS-VLT-2). A fact read late changes nothing that matters: the run checks the
//   page itself before every file and stops with the reason.
// - The checkpoint of the open album (VA-005) is read when the panel opens on it, and again by every Start
//   (`findVaultCheckpoint`: a forgotten one is cleared). Of the same files — the run continues from it, built at once,
//   so a file left uncertain asks its question before anything starts (VA-004); of other files — Start waits until the
//   person picks those again or drops it («Сбросить прошлый запуск», asked twice). Never a fresh run over a checkpoint
//   it could not read: a read that failed is said, and nothing starts.
// - One run at a time, bound to its album; files and order are kept while it runs or waits for an answer; new files or
//   another order drop a run that is not running. A run that stopped keeps its reason on screen until the person acts.
// - The person's own steps on the checkpoint (an answer, a reset) are said when they fail and change nothing then.

import type { VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';
import type { VaultAlbumOrder, VaultItemState, VaultPanelAction, VaultPanelClient, VaultPanelNote, VaultPanelVM, VaultResumeVM, VaultRunVM, VaultStartBlock } from '@cg/contracts/vault-fansly';

import { planVaultUpload, type VaultPlan } from './plan';
import { VAULT_CHECKPOINT_TTL_MS, createVaultRun, findVaultCheckpoint, sameVaultFiles, type VaultCheckpointStore, type VaultRun, type VaultRunSnapshot } from './run';
import { vaultTargetOf, type VaultTarget, type VaultUploader, type VaultView } from './upload';

export interface VaultPanelDeps {
  readonly uploader: VaultUploader;
  readonly store: VaultCheckpointStore;
  /** The tab's creator as the page names it (the port's account); null — not said yet. */
  readonly account: () => { readonly username: string | null; readonly displayName: string | null } | null;
  /** Something on the page moved — the route, the accounts, the vault's facts: the panel reads the page again. */
  readonly onPage: (listener: () => void) => () => void;
  readonly now?: () => number;
  readonly newId?: () => string;
  /** Tests: the run of P13a by default. */
  readonly createRun?: typeof createVaultRun;
}

export interface VaultPanel extends VaultPanelClient<File> {
  /** Whether the entry stands: the composition's word (on `/creator/vault`, the feature admitted on the page). */
  setShown(shown: boolean): void;
  /** A file of a run is in flight or the run pauses after it: the page must not take the panel away. */
  running(): boolean;
  dispose(): void;
}

interface Bound {
  readonly run: VaultRun;
  readonly key: string;
  readonly target: VaultTarget;
  readonly files: readonly File[];
  readonly uploadId: string;
  /** Confirmed by an earlier run (the checkpoint it continues). */
  readonly previous: number;
  /** Files the person said are in the album (VA-004): handed over by an earlier run, not by this one. */
  answered: number;
  readonly fromCheckpoint: boolean;
  snapshot: VaultRunSnapshot;
}

const keyOf = (target: VaultTarget | null): string | null => (target === null ? null : `${target.hostAccountId}:${target.albumId}`);
const refsOf = (files: readonly File[]) => files.map((file) => ({ name: file.name, size: file.size, lastModified: file.lastModified }));
const ACTIVE: ReadonlySet<string> = new Set(['running', 'pausing']);

export function createVaultPanel(deps: VaultPanelDeps): VaultPanel {
  const { uploader, store } = deps;
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const makeRun = deps.createRun ?? createVaultRun;
  const listeners = new Set<(view: VaultPanelVM) => void>();

  let shown = false;
  let mode: VaultPanelVM['mode'] = 'closed';
  let order: VaultAlbumOrder = 'first-on-top';
  let picked: readonly File[] | null = null;
  let plan: VaultPlan<File> | null = null;
  let page: VaultView = uploader.view();
  let target: VaultTarget | null = vaultTargetOf(page);
  /** The checkpoint the background keeps for the album of `key`, as last read; null — none there. */
  let checked: { readonly key: string; readonly checkpoint: VaultCheckpoint | null } | null = null;
  /** The album whose checkpoint is being read, and the read's own number (a later read wins). */
  let reading: { readonly key: string; readonly serial: number } | null = null;
  let serial = 0;
  let bound: Bound | null = null;
  let note: VaultPanelNote | null = null;
  let resetArmed = false;
  let writing = false;
  let starting = false;
  let disposed = false;

  const active = (): boolean => bound !== null && ACTIVE.has(bound.snapshot.state);
  const alive = (checkpoint: VaultCheckpoint | null): VaultCheckpoint | null => (checkpoint !== null && now() - checkpoint.updatedAt <= VAULT_CHECKPOINT_TTL_MS ? checkpoint : null);
  /** The background's checkpoint of the open album, while it is known and not forgotten. */
  const kept = (): VaultCheckpoint | null => (checked !== null && checked.key === keyOf(target) ? alive(checked.checkpoint) : null);

  const emit = (): void => {
    if (disposed) return;
    const view = vm();
    for (const listener of [...listeners]) listener(view);
  };

  /** Binds a run of `files` to `target`, from `checkpoint` (its `continue`) or new. Started only by the person. */
  const bind = (at: VaultTarget, files: readonly File[], checkpoint: VaultCheckpoint | null): Bound => {
    const uploadId = checkpoint?.uploadId ?? newId();
    let made: Bound | null = null;
    const run = makeRun({ target: at, files, checkpoint }, { uploader, store, now, newId: () => uploadId }, (snapshot) => {
      if (made === null || bound !== made) return;
      made.snapshot = snapshot;
      if (snapshot.state === 'complete') {
        // The run cleared its checkpoint; one it could not clear may be offered again on the next visit.
        checked = { key: made.key, checkpoint: null };
        if (snapshot.checkpointLeftBehind) note = 'left-behind';
      }
      emit();
    });
    made = { run, key: keyOf(at) ?? '', target: at, files, uploadId, previous: checkpoint?.confirmed ?? 0, answered: 0, fromCheckpoint: checkpoint !== null, snapshot: run.snapshot() };
    return made;
  };

  /** A run of these very files and this album, from the checkpoint the background keeps: built at once, so its question is asked now. */
  const adopt = (): void => {
    if (bound !== null || plan === null || plan.problems.length > 0 || target === null) return;
    const checkpoint = kept();
    if (checkpoint === null || !sameVaultFiles(checkpoint.files, refsOf(plan.sequence))) return;
    bound = bind(target, plan.sequence, checkpoint);
  };

  /** Drops a run that does not hold a file now (new files, another order, a reset). */
  const drop = (): void => {
    if (bound !== null && !active()) bound = null;
  };

  const read = (at: VaultTarget): void => {
    const key = keyOf(at) ?? '';
    const mine = (serial += 1);
    reading = { key, serial: mine };
    store.load(at).then(
      (checkpoint) => {
        if (disposed || reading?.serial !== mine) return;
        reading = null;
        checked = { key, checkpoint };
        if (note === 'read-failed') note = null;
        adopt();
        emit();
      },
      () => {
        if (disposed || reading?.serial !== mine) return;
        reading = null;
        note = 'read-failed';
        emit();
      },
    );
  };

  /** Reads the page again; another album: its checkpoint is read once the panel is open on it. */
  const look = (): void => {
    page = uploader.view();
    const next = vaultTargetOf(page);
    if (keyOf(next) !== keyOf(target)) {
      target = next;
      resetArmed = false;
      // A run built for another album and never started is that album's: it goes, and comes back with it.
      if (bound !== null && bound.key !== keyOf(target) && bound.snapshot.state === 'idle') bound = null;
    }
    if (mode !== 'closed' && target !== null && checked?.key !== keyOf(target) && reading?.key !== keyOf(target)) read(target);
    adopt();
  };

  const startBlock = (): VaultStartBlock | null => {
    if (starting) return 'checking';
    if (bound !== null && ACTIVE.has(bound.snapshot.state)) return 'running';
    if (plan === null) return 'files';
    if (plan.problems.length > 0) return 'problems';
    if (bound !== null && bound.snapshot.state === 'complete') return 'done';
    if (bound !== null && bound.snapshot.items.some((item) => item.status === 'uncertain')) return 'answer';
    if (bound === null && kept() !== null) return 'other';
    if (bound === null && (reading !== null || (target !== null && checked?.key !== keyOf(target)))) return 'checking';
    if (page.hostAccountId === null) return 'account';
    if (page.loading) return 'album-loading';
    if (page.albumId === null || (bound !== null && bound.key !== keyOf(target))) return 'album';
    if (page.uploader === 'missing') return 'uploader';
    if (page.uploader === 'busy') return 'uploader-busy';
    return null;
  };

  const start = async (): Promise<void> => {
    look();
    if (startBlock() !== null || plan === null || target === null) return emit();
    note = null;
    if (bound === null) {
      starting = true;
      emit();
      const at = target;
      const files = plan.sequence;
      let found: Awaited<ReturnType<typeof findVaultCheckpoint>>;
      try {
        found = await findVaultCheckpoint(store, at, refsOf(files), now());
      } catch {
        starting = false;
        note = 'read-failed';
        return emit();
      }
      starting = false;
      // The person moved on meanwhile (other files, another album): nothing starts on the old picture.
      if (disposed || plan?.sequence !== files || keyOf(target) !== keyOf(at) || bound !== null) return emit();
      if (found.kind === 'other') {
        checked = { key: keyOf(at) ?? '', checkpoint: found.checkpoint };
        return emit();
      }
      checked = { key: keyOf(at) ?? '', checkpoint: found.kind === 'continue' ? found.checkpoint : null };
      bound = bind(at, files, found.kind === 'continue' ? found.checkpoint : null);
      // A file left uncertain by that run: its question comes first (VA-004).
      if (bound.snapshot.items.some((item) => item.status === 'uncertain')) return emit();
    }
    const run = bound;
    emit();
    await run.run.start();
    emit();
  };

  const answer = async (value: 'present' | 'missing'): Promise<void> => {
    if (bound === null || writing || active()) return;
    const run = bound;
    writing = true;
    emit();
    const written = await run.run.resolve(value);
    writing = false;
    if (written && value === 'present') run.answered += 1;
    note = written ? null : 'save-failed';
    emit();
  };

  const reset = async (): Promise<void> => {
    if (active() || writing || target === null) return;
    if (!resetArmed) {
      resetArmed = true;
      return emit();
    }
    resetArmed = false;
    const uploadId = bound?.key === keyOf(target) ? bound.uploadId : kept()?.uploadId;
    if (uploadId === undefined) return emit();
    const at = target;
    writing = true;
    emit();
    const cleared = await store.clear(at, uploadId).catch(() => false);
    writing = false;
    if (!cleared) {
      note = 'clear-failed';
      return emit();
    }
    note = null;
    checked = { key: keyOf(at) ?? '', checkpoint: null };
    if (bound !== null && !active()) bound = null;
    emit();
  };

  const repick = (files: readonly File[] | null): void => {
    picked = files;
    plan = files === null ? null : planVaultUpload(files, order);
    drop();
    resetArmed = false;
    if (note !== 'read-failed') note = null;
    adopt();
  };

  const offPage = deps.onPage(() => {
    look();
    emit();
  });

  const vm = (): VaultPanelVM => {
    const snapshot = bound?.snapshot ?? null;
    const sequence = bound?.files ?? plan?.sequence ?? [];
    const stateOf = (file: File): VaultItemState => {
      if (bound === null || snapshot === null) return 'pending';
      const index = sequence.indexOf(file);
      const status = snapshot.items[index]?.status ?? 'pending';
      return status === 'verified' && index < bound.previous ? 'previous' : status;
    };
    const question = snapshot?.items.find((item) => item.status === 'uncertain') ?? null;
    const checkpoint = kept();
    let resume: VaultResumeVM | null = null;
    if (bound !== null && bound.fromCheckpoint && snapshot?.state === 'idle') resume = { kind: 'continue', done: bound.previous, total: bound.files.length };
    else if (bound === null && checkpoint !== null) resume = { kind: plan === null ? 'found' : 'other', done: checkpoint.confirmed, total: checkpoint.files.length };
    const runVm: VaultRunVM | null =
      bound === null || snapshot === null || (snapshot.state === 'idle' && !bound.fromCheckpoint)
        ? null
        : {
            state: snapshot.state,
            done: snapshot.confirmed,
            total: snapshot.total,
            current: snapshot.current === null ? null : (bound.files[snapshot.current]?.name ?? null),
            album: bound.target.title ?? null,
            stop: snapshot.stop,
            code: snapshot.code,
            report:
              snapshot.state === 'complete'
                ? {
                    uploaded: snapshot.items.filter((item, index) => item.status === 'verified' && index >= bound!.previous).length - bound.answered,
                    present: snapshot.items.filter((item) => item.status === 'present').length,
                    previous: bound.previous + bound.answered,
                  }
                : null,
          };
    const person = deps.account();
    // The creator as the page names it; a page that names it by id alone (Fansly's `/account/me`) — by its id.
    const label = page.hostAccountId === null ? null : person !== null && person.username !== null ? `@${person.username}` : (person?.displayName ?? page.hostAccountId);
    const holding = active();
    // A checkpoint on disk for the open album: the bound run's (written before its first file), or one it did not adopt.
    const onDisk = bound === null ? checkpoint !== null : bound.key === keyOf(target) && snapshot !== null && snapshot.state !== 'complete' && (bound.fromCheckpoint || snapshot.state !== 'idle');
    const blocked = startBlock();
    return {
      shown,
      mode,
      account: label,
      album: { state: page.albumId !== null ? 'open' : page.loading ? 'loading' : 'none', title: page.title },
      uploader: page.uploader,
      order,
      selection:
        plan === null
          ? null
          : { folder: plan.folder, bytes: plan.bytes, items: plan.items.map((file) => ({ name: file.name, size: file.size, state: stateOf(file) })), problems: plan.problems, warnings: plan.warnings },
      resume,
      question: question === null ? null : { name: question.name },
      run: runVm,
      note,
      resetArmed,
      busy: writing || starting || reading !== null,
      controls: {
        start: bound !== null && snapshot !== null && snapshot.state !== 'complete' && (snapshot.state !== 'idle' || bound.fromCheckpoint) ? 'resume' : 'start',
        blocked,
        pause: snapshot?.state === 'running',
        reset: !holding && !writing && onDisk,
        close: !holding,
        pick: !holding && !starting,
      },
    };
  };

  return {
    view: vm,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(action: VaultPanelAction<File>) {
      if (disposed) return;
      switch (action.type) {
        case 'open':
          mode = 'open';
          look();
          return emit();
        case 'close':
          if (active()) return;
          mode = 'closed';
          resetArmed = false;
          return emit();
        case 'minimize':
          if (active()) return;
          mode = 'minimized';
          return emit();
        case 'refresh':
          look();
          return emit();
        case 'pick':
          if (active() || starting) return;
          repick(action.files.length === 0 ? picked : action.files);
          look();
          return emit();
        case 'order':
          if (active() || starting || action.order === order) return;
          order = action.order;
          repick(picked);
          return emit();
        case 'start':
          void start();
          return;
        case 'pause':
          bound?.run.pause();
          return;
        case 'answer':
          void answer(action.answer);
          return;
        case 'reset':
          void reset();
          return;
        case 'reset-cancel':
          resetArmed = false;
          return emit();
      }
    },
    setShown(next) {
      if (shown === next) return;
      shown = next;
      if (shown) look();
      emit();
    },
    running: active,
    dispose() {
      if (disposed) return;
      disposed = true;
      offPage();
      listeners.clear();
      uploader.dispose();
    },
  };
}
