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
// - A run continued from the checkpoint whose file in flight already stands in the album — its card settled — counts
//   that file on the person's Start with no question (the old panel's positive evidence, its `createRunner`); only a
//   file whose card is not seen asks. A file left uncertain in this tab is always the person's to answer (VA-004).
// - The panel minimizes into its strip («Загрузка в волт · Готово N из M») while a file is in flight, as the old one
//   did; only closing waits for the pause. A complete run reads the album's first cards against the set (the old
//   report's order line).

import { vaultCheckpointFollows, type VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';
import type { VaultAlbumOrder, VaultItemState, VaultOrderCheck, VaultPanelAction, VaultPanelClient, VaultPanelNote, VaultPanelVM, VaultResumeVM, VaultRunVM, VaultStartBlock } from '@cg/contracts/vault-fansly';

import { vaultMediaKey } from './dom';
import { planVaultUpload, type VaultPlan } from './plan';
import { VAULT_CHECKPOINT_TTL_MS, createVaultRun, findVaultCheckpoint, sameVaultFiles, type VaultCheckpointStore, type VaultRun, type VaultRunSnapshot } from './run';
import { vaultTargetOf, type VaultTarget, type VaultUploader, type VaultView } from './upload';

/**
 * The panel's store (the background's `fansly.vault.*`): the run's checkpoints, and for the panel the album's row as it
 * is now with whether another tab of this browser holds the album's upload (`held`, the background's word).
 */
export interface VaultPanelStore extends VaultCheckpointStore {
  look(target: VaultTarget): Promise<{ readonly checkpoint: VaultCheckpoint | null; readonly held: boolean }>;
}

export interface VaultPanelDeps {
  readonly uploader: VaultUploader;
  readonly store: VaultPanelStore;
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
  /** Files the person said are in the album (VA-004), or counted by their card on Start: handed over by an earlier run, not by this one. */
  answered: number;
  /** Of those, the ones counted by their card on Start: said as confirmed by the earlier run. */
  readonly credited: Set<number>;
  readonly fromCheckpoint: boolean;
  snapshot: VaultRunSnapshot;
  /** The album's first cards against the set, read once the run is complete. */
  order: VaultOrderCheck | null;
}

const keyOf = (target: VaultTarget | null): string | null => (target === null ? null : `${target.hostAccountId}:${target.albumId}`);

/**
 * The album's first cards against the set (the old panel's `buildOrderReport`): the newest upload is on top, so the set
 * top to bottom is its uploads reversed. `files` — the uploads in their order (the plan's `sequence`).
 */
export function checkVaultOrder(files: readonly { readonly name: string }[], view: Pick<VaultView, 'cards' | 'names'>): VaultOrderCheck {
  if (view.cards.length === 0) return { kind: 'unseen' };
  const expected = [...files].reverse();
  const checked = Math.min(expected.length, view.cards.length);
  for (let index = 0; index < checked; index += 1) {
    const due = expected[index];
    const card = view.cards[index];
    if (due !== undefined && card !== undefined && vaultMediaKey(due.name) !== card) return { kind: 'mismatch', position: index + 1, expected: due.name, actual: view.names[index] ?? card };
  }
  return { kind: 'ok', checked };
}

/** The Fansly account as the old panel named it: «Имя (@handle)», `@handle` or the name; null — neither. */
export function vaultAccountLabel(person: { readonly username: string | null; readonly displayName: string | null }): string | null {
  const name = person.displayName?.trim() ?? '';
  const handle = person.username?.trim().replace(/^@+/, '') ?? '';
  if (name !== '' && handle !== '' && name.replace(/^@+/, '') !== handle) return `${name} (@${handle})`;
  if (handle !== '') return `@${handle}`;
  return name === '' ? null : name;
}
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
  /** The checkpoint the background keeps for the album of `key`, as last read; null — none there; `held` — another tab holds it. */
  let checked: { readonly key: string; readonly checkpoint: VaultCheckpoint | null; readonly held: boolean } | null = null;
  /** The album whose checkpoint is being read, and the read's own number (a later read wins). */
  let reading: { readonly key: string; readonly serial: number } | null = null;
  let serial = 0;
  let bound: Bound | null = null;
  let note: VaultPanelNote | null = null;
  let resetArmed = false;
  let writing = false;
  let starting = false;
  /** Every Start's own number: one the panel hid (the owner switched the vault off) starts nothing when its reading comes. */
  let starts = 0;
  let disposed = false;

  const active = (): boolean => bound !== null && ACTIVE.has(bound.snapshot.state);
  const alive = (checkpoint: VaultCheckpoint | null): VaultCheckpoint | null => (checkpoint !== null && now() - checkpoint.updatedAt <= VAULT_CHECKPOINT_TTL_MS ? checkpoint : null);
  /** The background's checkpoint of the open album, while it is known and not forgotten. */
  const kept = (): VaultCheckpoint | null => (checked !== null && checked.key === keyOf(target) ? alive(checked.checkpoint) : null);
  /** Another tab of this browser holds the open album's upload (the background's word, as last read). */
  const heldNow = (): boolean => checked !== null && checked.key === keyOf(target) && checked.held;

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
        if (made.order === null) made.order = checkVaultOrder(made.files, uploader.view());
        // The run cleared its checkpoint; one it could not clear may be offered again on the next visit.
        checked = { key: made.key, checkpoint: null, held: false };
        if (snapshot.checkpointLeftBehind) note = 'left-behind';
      }
      emit();
      // Not kept: another tab may hold the album, or have taken the run further — the row is read again.
      if (snapshot.state === 'stopped' && snapshot.stop?.kind === 'checkpoint-write-failed') void recheck(made.target, made);
    });
    made = { run, key: keyOf(at) ?? '', target: at, files, uploadId, previous: checkpoint?.confirmed ?? 0, answered: 0, credited: new Set(), fromCheckpoint: checkpoint !== null, snapshot: run.snapshot(), order: null };
    return made;
  };

  /** A run of these very files and this album, from the checkpoint the background keeps: built at once, so its question is asked now. */
  const adopt = (): void => {
    if (bound !== null || plan === null || plan.problems.length > 0 || target === null) return;
    const checkpoint = kept();
    if (checkpoint === null || !sameVaultFiles(checkpoint.files, refsOf(plan.sequence))) return;
    bound = bind(target, plan.sequence, checkpoint);
  };

  /**
   * Drops a run that does not hold a file now (new files, another order). What it wrote is on disk: the album's
   * checkpoint is read again, so the panel says it as the next run will find it.
   */
  const drop = (): void => {
    if (bound === null || active()) return;
    if (bound.fromCheckpoint || bound.snapshot.state !== 'idle') checked = null;
    bound = null;
  };

  const read = (at: VaultTarget): void => {
    const key = keyOf(at) ?? '';
    const mine = (serial += 1);
    reading = { key, serial: mine };
    store.look(at).then(
      ({ checkpoint, held }) => {
        if (disposed || reading?.serial !== mine) return;
        reading = null;
        checked = { key, checkpoint, held };
        if (held) note = 'held';
        else if (note === 'read-failed' || note === 'held') note = null;
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
    // An album another tab holds is asked again each time: that tab may have let it go.
    if (mode !== 'closed' && target !== null && (checked?.key !== keyOf(target) || checked.held) && reading?.key !== keyOf(target)) read(target);
    adopt();
  };

  /** The run's view of the album's row holds: its next write would follow the row on disk (`vaultCheckpointFollows`). */
  const consistent = (run: Bound, row: VaultCheckpoint | null): boolean => {
    if (row === null || row.uploadId !== run.uploadId) return false;
    const { confirmed, items } = run.snapshot;
    const uncertain = items.findIndex((item) => item.status === 'uncertain');
    if (uncertain >= 0) return row.confirmed === confirmed && row.pending?.index === uncertain;
    return confirmed >= items.length || vaultCheckpointFollows(row, { ...row, confirmed, pending: { index: confirmed, passedAt: row.updatedAt } });
  };

  /**
   * A write of the panel's was not kept: the album's row is read again, and the panel says why (review of P13b) —
   * another tab holds the album (`held`), or another tab took the run further than this copy knows (`moved`): the copy
   * that fell behind goes, and the row's own state comes back (its file in flight asks its question again).
   */
  const recheck = async (at: VaultTarget, run: Bound | null): Promise<void> => {
    let status: Awaited<ReturnType<VaultPanelStore['look']>>;
    try {
      status = await store.look(at);
    } catch {
      return;
    }
    if (disposed || bound !== run) return;
    const key = keyOf(at) ?? '';
    if (status.held) {
      checked = { key, checkpoint: status.checkpoint, held: true };
      note = 'held';
      return emit();
    }
    if (run === null || consistent(run, status.checkpoint)) return;
    note = 'moved';
    checked = { key, checkpoint: status.checkpoint, held: false };
    if (!active()) {
      bound = null;
      adopt();
    }
    emit();
  };

  /** The panel hid (the owner switched the vault off, the person left): a file in flight is seen to its end, nothing after it is handed over. */
  const halt = (): void => {
    starts += 1;
    if (bound === null || !ACTIVE.has(bound.snapshot.state)) return;
    if (bound.snapshot.current !== null) bound.run.pause();
    else bound.run.stop();
  };

  /**
   * The file a run from the checkpoint left uncertain, when its card stands settled in the album now (the old panel's
   * `findReadyCard`: no «Processing», no failure, the form idle): Start counts it with no question. Only before that run
   * started in this tab; null — none.
   */
  const creditable = (): number | null => {
    if (bound === null || !bound.fromCheckpoint || bound.snapshot.state !== 'idle' || bound.key !== keyOf(target)) return null;
    const index = bound.snapshot.items.findIndex((item) => item.status === 'uncertain');
    const file = index < 0 ? undefined : bound.files[index];
    if (file === undefined || page.loading || page.uploader === 'busy') return null;
    return page.settled.includes(vaultMediaKey(file.name)) ? index : null;
  };

  /** Counts the creditable file as in the album, written first (VA-004); false — not written, said, nothing changed. */
  const credit = async (run: Bound): Promise<boolean> => {
    const index = creditable();
    if (index === null) return true;
    writing = true;
    emit();
    const written = await run.run.resolve('present');
    writing = false;
    if (!written) {
      note = 'save-failed';
      emit();
      void recheck(run.target, run);
      return false;
    }
    run.answered += 1;
    run.credited.add(index);
    return true;
  };

  const startBlock = (): VaultStartBlock | null => {
    if (starting) return 'checking';
    if (bound !== null && ACTIVE.has(bound.snapshot.state)) return 'running';
    if (heldNow()) return 'held';
    if (plan === null) return 'files';
    if (plan.problems.length > 0) return 'problems';
    if (bound !== null && bound.snapshot.state === 'complete') return 'done';
    if (bound !== null && bound.snapshot.items.some((item) => item.status === 'uncertain') && creditable() === null) return 'answer';
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
    if (!shown || writing) return;
    look();
    if (bound !== null && creditable() !== null) {
      if (!(await credit(bound))) return;
      look();
    }
    if (startBlock() !== null || plan === null || target === null) return emit();
    note = null;
    const mine = (starts += 1);
    /** The panel hid meanwhile (the owner switched the vault off), or went: this Start starts nothing (review of P13b). */
    const cancelled = (): boolean => disposed || !shown || mine !== starts;
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
        if (!cancelled()) note = 'read-failed';
        return emit();
      }
      starting = false;
      // The person moved on meanwhile (other files, another album): nothing starts on the old picture.
      if (cancelled() || plan?.sequence !== files || keyOf(target) !== keyOf(at) || bound !== null) return emit();
      if (found.kind === 'other') {
        checked = { key: keyOf(at) ?? '', checkpoint: found.checkpoint, held: false };
        return emit();
      }
      checked = { key: keyOf(at) ?? '', checkpoint: found.kind === 'continue' ? found.checkpoint : null, held: false };
      bound = bind(at, files, found.kind === 'continue' ? found.checkpoint : null);
      // A file left uncertain by that run: counted when its card stands in the album, else its question comes first (VA-004).
      if (bound.snapshot.items.some((item) => item.status === 'uncertain')) {
        if (creditable() === null) return emit();
        if (!(await credit(bound))) return;
      }
    }
    const run = bound;
    if (cancelled()) return emit();
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
    if (!written) void recheck(run.target, run);
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
      emit();
      return recheck(at, bound);
    }
    note = null;
    checked = { key: keyOf(at) ?? '', checkpoint: null, held: false };
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
    // The file Start will count by its card: in the album from the earlier run, as the old panel showed it.
    const credit = creditable();
    const stateOf = (file: File): VaultItemState => {
      if (bound === null || snapshot === null) return 'pending';
      const index = sequence.indexOf(file);
      if (index === credit) return 'previous';
      const status = snapshot.items[index]?.status ?? 'pending';
      return status === 'verified' && (index < bound.previous || bound.credited.has(index)) ? 'previous' : status;
    };
    // A file Start will count by its card asks nothing.
    const question = credit === null ? (snapshot?.items.find((item) => item.status === 'uncertain') ?? null) : null;
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
            startedAt: snapshot.startedAt,
            album: bound.target.title ?? null,
            stop: snapshot.stop,
            code: snapshot.code,
            report:
              snapshot.state === 'complete'
                ? {
                    uploaded: snapshot.items.filter((item, index) => item.status === 'verified' && index >= bound!.previous).length - bound.answered,
                    present: snapshot.items.filter((item) => item.status === 'present').length,
                    previous: bound.previous + bound.answered,
                    order: bound.order ?? { kind: 'unseen' },
                  }
                : null,
          };
    const person = deps.account();
    // The creator as the page names it; a page that names it by id alone — by its id.
    const label = page.hostAccountId === null ? null : ((person === null ? null : vaultAccountLabel(person)) ?? page.hostAccountId);
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
        reset: !holding && !writing && onDisk && !heldNow(),
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
          // While a file is in flight too: the strip keeps the count (the old panel's).
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
          look();
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
      else halt();
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
