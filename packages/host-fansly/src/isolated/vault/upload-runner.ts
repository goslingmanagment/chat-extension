import { VaultCheckpointSchema, type VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';
import type { VaultCheckpointStore } from './checkpoint-store';
import type { VaultEvent, VaultSession } from './session';
import { handoffFile, readVaultView, vaultMediaKey, watchVault, type VaultView } from './vault-dom';

export type VaultStopReason = 'route-left' | 'identity-changed' | 'album-closed' | 'album-changed' | 'uploader-missing' | 'uploader-busy' | 'uploader-error' | 'handoff-unavailable' | 'handoff-indeterminate' | 'timeout' | 'order-mismatch' | 'checkpoint-write-failed' | 'file-missing' | 'internal-error' | 'stream-lost' | 'stopped';
export interface VaultUploadSnapshot {
  state: 'idle' | 'running' | 'pausing' | 'paused' | 'stopped' | 'complete';
  confirmed: number;
  total: number;
  pending: number | null;
  uncertain: boolean;
  reason: VaultStopReason | null;
  uploaderText: string;
  checkpointLeftBehind: boolean;
}
export interface VaultUploadOptions {
  doc: Document;
  session: VaultSession;
  store: VaultCheckpointStore;
  /** Upload order. The panel constructs it from the person's selection (P13b). */
  files: readonly File[];
  checkpoint: VaultCheckpoint;
  albumTitle: string;
  onChange?: (snapshot: VaultUploadSnapshot) => void;
  now?: () => number;
  timeoutMs?: number;
  handoff?: typeof handoffFile;
}

const active = new WeakSet<Document>();

/** One person-started queue. No implicit resume, retry, or resolution of an in-flight checkpoint. */
export class VaultUploadRunner {
  private checkpoint: VaultCheckpoint;
  private readonly now: () => number;
  private readonly generation: number;
  private state: VaultUploadSnapshot['state'] = 'idle';
  private reason: VaultStopReason | null = null;
  private uncertain: boolean;
  private busy = false;
  private stopped = false;
  private wake: () => void = () => undefined;
  private checkpointLeftBehind = false;
  private uploaderText = '';
  private events: VaultEvent[] = [];
  private lost = false;

  constructor(private readonly options: VaultUploadOptions) {
    this.checkpoint = VaultCheckpointSchema.parse(options.checkpoint);
    if (new Set(this.checkpoint.files.map((f) => vaultMediaKey(f.name))).size !== this.checkpoint.files.length) throw new Error('Duplicate vault file keys');
    this.now = options.now ?? Date.now;
    this.generation = options.session.current().generation;
    this.uncertain = this.checkpoint.pending !== null;
    if (this.checkpoint.pending !== null && this.checkpoint.pending.index !== this.checkpoint.confirmed) throw new Error('Nonsequential checkpoint');
  }
  snapshot(): VaultUploadSnapshot {
    return { state: this.state, confirmed: this.checkpoint.confirmed, total: this.checkpoint.files.length, pending: this.checkpoint.pending?.index ?? null, uncertain: this.uncertain, reason: this.reason, uploaderText: this.uploaderText, checkpointLeftBehind: this.checkpointLeftBehind };
  }
  private emit(): void { this.options.onChange?.(this.snapshot()); }
  pause(): void { if (this.state === 'running') { this.state = 'pausing'; this.emit(); } }
  stop(): void { this.stopped = true; this.wake(); }
  /** Only the person's explicit album check may resolve an uncertain file; disk first, memory second. */
  async resolveUncertain(outcome: 'present' | 'missing'): Promise<void> {
    if (this.busy || !this.uncertain || this.checkpoint.pending === null) throw new Error('No idle uncertain file');
    this.busy = true;
    try {
      const observed = await this.options.session.under(() => this.options.session.inspect());
      // The human must inspect this checkpoint's own album in this tab, not a new account or route.
      const current = this.options.session.current();
      const view = readVaultView(this.options.doc);
      if (!observed.fresh() || !observed.ok || current.generation !== this.generation || !current.onRoute || current.accountId !== this.checkpoint.hostAccountId || observed.value.creatorId !== this.checkpoint.hostAccountId || observed.value.albumId !== this.checkpoint.albumId || view?.title !== this.options.albumTitle) throw new Error('Vault identity changed');
      const next = { ...this.checkpoint, confirmed: this.checkpoint.confirmed + (outcome === 'present' ? 1 : 0), pending: null, updatedAt: this.now() };
      const result = await this.options.session.under(() => this.options.store.save(next));
      if (!result.ok) throw result.error;
      this.checkpoint = next;
      this.uncertain = false;
      if (!result.fresh()) this.reason = 'identity-changed';
      this.emit();
    } finally { this.busy = false; }
  }
  private guard(view: VaultView | null): VaultStopReason | null {
    const current = this.options.session.current();
    if (!current.onRoute) return 'route-left';
    if (current.accountId !== this.checkpoint.hostAccountId || current.generation !== this.generation) return 'identity-changed';
    if (this.stopped) return 'stopped';
    if (!view || !view.root.isConnected) return 'album-closed';
    if (view.title !== this.options.albumTitle) return 'album-changed';
    if (!view.input || !view.input.isConnected || view.input.disabled) return 'uploader-missing';
    return null;
  }
  private halt(reason: VaultStopReason): false {
    this.reason = reason;
    this.state = 'stopped';
    this.uncertain = this.checkpoint.pending !== null;
    this.emit();
    return false;
  }
  private async save(next: VaultCheckpoint): Promise<boolean> {
    const result = await this.options.session.under(() => this.options.store.save(next));
    if (!result.ok) return this.halt('checkpoint-write-failed');
    this.checkpoint = next;
    if (!result.fresh()) return this.halt('identity-changed');
    return true;
  }
  async start(): Promise<void> {
    if (this.busy || this.uncertain || active.has(this.options.doc)) throw new Error('Resolve uncertain file before starting an idle queue');
    if (this.state === 'complete') return;
    this.busy = true;
    active.add(this.options.doc);
    this.stopped = false;
    this.state = 'running';
    this.reason = null;
    this.lost = false;
    const offEvents = this.options.session.subscribe((event) => {
      if (event === null) this.lost = true;
      else if (this.checkpoint.pending !== null) {
        // At most a few events per file; overflow is ambiguous, never unbounded memory.
        if (this.events.length >= 16) this.lost = true;
        else this.events.push(event);
      }
      this.wake();
    });
    const offChanges = this.options.session.onChange(() => this.wake());
    const offDom = watchVault(this.options.doc, () => this.wake());
    this.emit();
    try {
      while (this.checkpoint.confirmed < this.checkpoint.files.length) {
        if (this.snapshot().state === 'pausing') { this.state = 'paused'; return; }
        if (!await this.one()) return;
      }
      this.state = 'complete';
      try { await this.options.store.clear(this.checkpoint.hostAccountId, this.checkpoint.albumId, this.checkpoint.uploadId); }
      catch { this.checkpointLeftBehind = true; }
    } catch { this.halt('internal-error'); }
    finally {
      this.wake = () => undefined;
      offEvents(); offChanges(); offDom();
      this.busy = false;
      active.delete(this.options.doc);
      this.emit();
    }
  }
  private async one(): Promise<boolean> {
    const { doc, session, files } = this.options;
    const view = readVaultView(doc);
    const refused = this.guard(view);
    if (refused !== null) return this.halt(refused);
    if (view!.busy) return this.halt('uploader-busy');
    if (view!.error) return this.halt('uploader-error');
    const index = this.checkpoint.confirmed;
    const expected = this.checkpoint.files[index]!;
    const file = files[index];
    if (!file || file.name !== expected.name || file.size !== expected.size || file.lastModified !== expected.lastModified) return this.halt('file-missing');
    // Titles can be duplicated: even a skip must belong to the account + album the checkpoint names.
    const admission = await session.under(() => session.inspect());
    const admittedView = readVaultView(doc);
    const admissionGuard = this.guard(admittedView);
    if (admissionGuard) return this.halt(admissionGuard);
    if (!admission.fresh()) return this.halt('identity-changed');
    if (!admission.ok) return this.halt('stream-lost');
    if (admission.value.creatorId !== this.checkpoint.hostAccountId) return this.halt('identity-changed');
    if (admission.value.albumId !== this.checkpoint.albumId) return this.halt('album-changed');
    // A card that was already present is a safe skip, but never resolves a persisted pending file automatically.
    if (admittedView!.cards.some((card) => vaultMediaKey(card.name) === vaultMediaKey(file.name) && card.ready)) {
      return this.save({ ...this.checkpoint, confirmed: index + 1, updatedAt: this.now() });
    }
    if (!await this.save({ ...this.checkpoint, pending: { index, passedAt: this.now() }, updatedAt: this.now() })) return false;
    const fence = await session.under(() => session.inspect());
    const fresh = readVaultView(doc);
    const lateGuard = this.guard(fresh);
    const refusal = lateGuard ?? (!fence.fresh() ? 'identity-changed' : !fence.ok ? 'stream-lost' : fence.value.creatorId !== this.checkpoint.hostAccountId ? 'identity-changed' : fence.value.albumId !== this.checkpoint.albumId ? 'album-changed' : fresh!.input !== view!.input ? 'uploader-missing' : fresh!.busy ? 'uploader-busy' : this.lost ? 'stream-lost' : null);
    if (refusal !== null) {
      // No change was dispatched; clearing this preflight mark is safe.
      await this.save({ ...this.checkpoint, pending: null, updatedAt: this.now() });
      return this.halt(refusal);
    }
    if (!fence.ok) return this.halt('stream-lost');
    this.events = [];
    const wait = this.confirm(file.name, fence.value.seq);
    let handed: ReturnType<typeof handoffFile>;
    try { handed = (this.options.handoff ?? handoffFile)(fresh!.input!, file); }
    catch { handed = 'unknown'; }
    if (handed !== 'passed') {
      this.stopped = true;
      this.wake();
      await wait;
      if (handed === 'unavailable') await this.save({ ...this.checkpoint, pending: null, updatedAt: this.now() });
      return this.halt(handed === 'unavailable' ? 'handoff-unavailable' : 'handoff-indeterminate');
    }
    this.emit();
    this.wake();
    if (!await wait) return false;
    // A skipped batch reports its loss AFTER delivering its events; consume the proof only now, after that turn.
    if (this.lost) return this.halt('stream-lost');
    const finalView = readVaultView(doc);
    const finalGuard = this.guard(finalView);
    if (finalGuard) return this.halt(finalGuard);
    if (this.events.filter((e) => e?.t === 'fx.vaultAdded' && e.p.seq > fence.value.seq).length !== 1) return this.halt('handoff-indeterminate');
    if (this.events.some((e) => e?.t === 'fx.vaultReloaded' && e.p.seq > fence.value.seq && e.p.albumId !== this.checkpoint.albumId)) return this.halt('album-changed');
    const orderMismatch = vaultMediaKey(finalView!.cards[0]?.name ?? '') !== vaultMediaKey(file.name);
    // Proof is complete. A failed durable save still leaves pending and blocks a repeat after reload.
    if (!await this.save({ ...this.checkpoint, confirmed: index + 1, pending: null, updatedAt: this.now() })) return false;
    if (orderMismatch) return this.halt('order-mismatch');
    this.emit();
    return true;
  }
  private confirm(name: string, fence: number): Promise<boolean> {
    return new Promise((resolve) => {
      let ended = false;
      const finish = (reason: VaultStopReason | null): void => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        this.wake = () => undefined;
        resolve(reason === null ? true : this.halt(reason));
      };
      const timer = setTimeout(() => finish('timeout'), this.options.timeoutMs ?? 45 * 60 * 1000);
      this.wake = () => {
        const view = readVaultView(this.options.doc);
        const refusal = this.guard(view);
        if (refusal) return finish(refusal);
        if (this.lost) return finish('stream-lost');
        this.uploaderText = view!.text;
        if (view!.error) return finish('uploader-error');
        const added = this.events.filter((e) => e?.t === 'fx.vaultAdded' && e.p.seq > fence);
        const reloaded = this.events.filter((e) => e?.t === 'fx.vaultReloaded' && e.p.seq > fence);
        if (added.length > 1) return finish('handoff-indeterminate');
        if (reloaded.some((e) => e?.t === 'fx.vaultReloaded' && e.p.albumId !== this.checkpoint.albumId)) return finish('album-changed');
        const seq = added[0]?.p.seq;
        if (seq === undefined || !reloaded.some((e) => e!.p.seq > seq) || view!.busy) return;
        const ready = view!.cards.find((card) => vaultMediaKey(card.name) === vaultMediaKey(name) && card.ready);
        if (!ready) return;
        finish(null);
      };
    });
  }
}
