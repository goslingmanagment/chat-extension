// A scripted HostPort (architecture.md §5.2, §16 freeze item 9): what the
// ChatSpace adapter (R09) promises its consumers — the operation and send
// coordinators (R10), the controllers (R11, R12) — without a ChatSpace page.
// It answers from the script's memory and answer queues, plays the script's
// timeline on `advance()`, and checks every call against the contracts the
// way the real adapter must: an intent without its action token, a deferred
// insert through insert(), a second queue call for one attempt are contract
// violations, not refusals a person would see.

import {
  InsertIntentSchema,
  NavigationIntentSchema,
  PreviewSendRequestSchema,
  DispatchTicketSchema,
  chatKeyOf,
  type ChatRef,
  type ChatWindow,
  type DispatchTicket,
  type DraftSnapshot,
  type FreshnessCheckpoint,
  type HostAccount,
  type HostContractReport,
  type HostEvent,
  type HostFan,
  type HostIdentity,
  type HostPort,
  type HostSnapshot,
  type HostTheme,
  type InsertIntent,
  type InsertReceipt,
  type LiveTextTail,
  type MediaFanState,
  type MediaFolder,
  type MediaFoldersPage,
  type MediaItem,
  type MediaItemsPage,
  type MediaPort,
  type MediaRead,
  type MediaReadFailure,
  type MediaRequest,
  type MediaTags,
  type MountPoints,
  type NavigationIntent,
  type NavigationItem,
  type NavigationReceipt,
  type PreviewSendCommit,
  type PreviewSendPort,
  type PreviewSendPreflight,
  type PreviewSendRequest,
  type SendAttemptView,
  type Unsubscribe,
} from '@cg/contracts';

/** What ChatSpace already holds in page memory; the port reads only this (never the network). */
export interface HostMemory {
  readonly drafts: readonly DraftSnapshot[];
  readonly tails: readonly { readonly chat: ChatRef; readonly tail: LiveTextTail }[];
  readonly chatWindows: readonly ChatWindow[];
  readonly fans: readonly HostFan[];
  readonly chatList: readonly NavigationItem[];
}

/** Answers to the port's checks and writes, taken in order per kind; an empty queue answers the default. */
export interface HostAnswers {
  /** `token.redeem` for each insert and navigation (default: redeemed). */
  readonly redeem?: readonly boolean[];
  readonly insert?: readonly InsertReceipt[];
  readonly navigate?: readonly NavigationReceipt[];
  /** null — MAIN gave no checkpoint (default: the script's `checkpoint`). */
  readonly checkpoint?: readonly (FreshnessCheckpoint | null)[];
  readonly preflight?: readonly PreviewSendPreflight[];
  readonly commit?: readonly PreviewSendCommit[];
}

export type HostStep =
  | { readonly kind: 'event'; readonly at: number; readonly event: HostEvent }
  /** A PreviewSendPort.onState update of one attempt. */
  | { readonly kind: 'send-state'; readonly at: number; readonly view: SendAttemptView }
  | { readonly kind: 'contract'; readonly at: number; readonly report: HostContractReport }
  | { readonly kind: 'mounts'; readonly at: number; readonly mounts: MountPoints }
  | { readonly kind: 'theme'; readonly at: number; readonly theme: HostTheme };

/**
 * 1.30.0 (X53): the account's vault as the host's API answers the media picker: folders in order, the media of a folder
 * by its id (`all` — every medium), what each fan got of them, the release forms of a medium; `fail` — a kind of read
 * that answers this failure instead.
 */
export interface FakeMediaVault {
  readonly folders: readonly MediaFolder[];
  readonly items: Readonly<Record<string, readonly MediaItem[]>>;
  readonly states?: Readonly<Record<string, readonly MediaFanState[]>>;
  readonly tags?: Readonly<Record<string, MediaTags>>;
  readonly fail?: { readonly [K in MediaRequest['of']]?: MediaReadFailure };
}

export interface HostScript {
  readonly start: HostSnapshot;
  /** 1.30.0 (X53): the vault the media picker reads; absent — a host without one (HostPort.media absent). */
  readonly media?: FakeMediaVault;
  readonly memory: HostMemory;
  /** The checkpoint MAIN gives when the answers queue is empty. */
  readonly checkpoint: FreshnessCheckpoint | null;
  readonly answers: HostAnswers;
  /** Offsets from the scenario start, ms, non-decreasing. */
  readonly timeline: readonly HostStep[];
}

/** The consumer broke the contract (not a host refusal a person should see). */
export class HostContractViolation extends Error {
  constructor(
    message: string,
    readonly input: unknown,
  ) {
    super(message);
    this.name = 'HostContractViolation';
  }
}

type Callback<T> = (value: T) => void;

function emit<T>(callbacks: ReadonlySet<Callback<T>>, value: T): void {
  for (const callback of callbacks) callback(value);
}

function listen<T>(callbacks: Set<Callback<T>>, callback: Callback<T>): Unsubscribe {
  callbacks.add(callback);
  return () => {
    callbacks.delete(callback);
  };
}

const sameChat = (a: ChatRef, b: ChatRef): boolean => chatKeyOf(a) === chatKeyOf(b);

/** Every call the consumer made, for assertions. */
export interface HostCalls {
  readonly redeemed: { readonly kind: 'insert' | 'navigate'; readonly intentId: string; readonly actionToken: string; readonly redeemed: boolean }[];
  readonly inserts: InsertIntent[];
  readonly navigations: NavigationIntent[];
  readonly checkpoints: ChatRef[];
  readonly preflights: PreviewSendRequest[];
  /** Queue calls that reached MAIN, one per attempt. */
  readonly commits: { readonly request: PreviewSendRequest; readonly ticket: DispatchTicket }[];
  /** 1.30.0 (X53): every read of the media picker. */
  readonly media: MediaRequest[];
}

/** 1.30.0 (X53): the vault of FakeMediaVault, paged as the host pages it. */
class FakeMediaPort implements MediaPort {
  constructor(
    private readonly host: FakeHostPort,
    private readonly vault: FakeMediaVault,
  ) {}

  private answer<T>(request: MediaRequest, value: () => T): Promise<MediaRead<T>> {
    this.host.calls.media.push(request);
    const failure = this.vault.fail?.[request.of];
    return Promise.resolve(failure === undefined ? { ok: true, value: value() } : { ok: false, reason: failure, status: failure === 'http' ? 500 : null });
  }

  folders(hostAccountId: string, offset: number): Promise<MediaRead<MediaFoldersPage>> {
    return this.answer({ of: 'folders', acc: hostAccountId, offset }, () => ({ items: this.vault.folders.slice(offset, offset + 10), hasMore: offset + 10 < this.vault.folders.length }));
  }

  items(hostAccountId: string, folder: string, offset: number): Promise<MediaRead<MediaItemsPage>> {
    const all = this.vault.items[folder] ?? [];
    return this.answer({ of: 'items', acc: hostAccountId, folder, offset }, () => ({ items: all.slice(offset, offset + 40), hasMore: offset + 40 < all.length }));
  }

  fanStates(chat: ChatRef, ids: readonly string[]): Promise<MediaRead<readonly MediaFanState[]>> {
    return this.answer({ of: 'states', acc: chat.hostAccountId, fan: chat.platformFanId, ids: [...ids] }, () => (this.vault.states?.[chat.platformFanId] ?? []).filter((state) => ids.includes(state.id)));
  }

  tags(hostAccountId: string, ids: readonly string[]): Promise<MediaRead<MediaTags>> {
    return this.answer({ of: 'tags', acc: hostAccountId, ids: [...ids] }, () => {
      const users = new Set<string>();
      const guests = new Set<string>();
      for (const id of ids) {
        for (const user of this.vault.tags?.[id]?.users ?? []) users.add(user);
        for (const guest of this.vault.tags?.[id]?.guests ?? []) guests.add(guest);
      }
      return { users: [...users], guests: [...guests] };
    });
  }
}

class FakePreviewSendPort implements PreviewSendPort {
  private readonly firstResults = new Map<string, PreviewSendCommit>();
  readonly states = new Map<string, Set<Callback<SendAttemptView>>>();

  constructor(private readonly host: FakeHostPort) {}

  preflight(req: PreviewSendRequest): Promise<PreviewSendPreflight> {
    this.host.check(PreviewSendRequestSchema, req, 'preflight');
    this.host.calls.preflights.push(req);
    return Promise.resolve(this.host.take('preflight') ?? { ok: true });
  }

  commit(req: PreviewSendRequest, ticket: DispatchTicket): Promise<PreviewSendCommit> {
    this.host.check(PreviewSendRequestSchema, req, 'commit');
    this.host.check(DispatchTicketSchema, ticket, 'commit ticket');
    if (ticket.attemptId !== req.attemptId) throw new HostContractViolation('the ticket belongs to another attempt', { req, ticket });
    // MAIN keeps a map of used attempts: a repeated command returns the first result and never calls the queue again.
    const first = this.firstResults.get(req.attemptId);
    if (first !== undefined) return Promise.resolve(first);
    const result = this.host.take('commit') ?? { state: 'nativeEnqueued', pendingId: `pending-${req.attemptId}` };
    this.firstResults.set(req.attemptId, result);
    this.host.calls.commits.push({ request: req, ticket });
    return Promise.resolve(result);
  }

  onState(attemptId: string, cb: (view: SendAttemptView) => void): () => void {
    const set = this.states.get(attemptId) ?? new Set<Callback<SendAttemptView>>();
    this.states.set(attemptId, set);
    return listen(set, cb);
  }
}

export class FakeHostPort implements HostPort {
  readonly kind = 'chatspace' as const;
  readonly platform = 'onlyfans' as const;
  readonly calls: HostCalls = { redeemed: [], inserts: [], navigations: [], checkpoints: [], preflights: [], commits: [], media: [] };
  /** 1.30.0 (X53): present only when the script has a vault. */
  declare readonly media?: MediaPort;

  private snapshot: HostSnapshot;
  private readonly queues: { -readonly [K in keyof HostAnswers]-?: NonNullable<HostAnswers[K]>[number][] };
  private readonly events = new Set<Callback<HostEvent>>();
  private readonly contracts = new Set<Callback<HostContractReport>>();
  private readonly mountListeners = new Set<Callback<MountPoints>>();
  private readonly themeListeners = new Set<Callback<HostTheme>>();
  private readonly sendPort: FakePreviewSendPort;
  private step = -1;
  private disposed = false;

  constructor(
    readonly script: HostScript,
    readonly startedAt = 0,
  ) {
    this.snapshot = script.start;
    this.queues = {
      redeem: [...(script.answers.redeem ?? [])],
      insert: [...(script.answers.insert ?? [])],
      navigate: [...(script.answers.navigate ?? [])],
      checkpoint: [...(script.answers.checkpoint ?? [])],
      preflight: [...(script.answers.preflight ?? [])],
      commit: [...(script.answers.commit ?? [])],
    };
    this.sendPort = new FakePreviewSendPort(this);
    if (script.media !== undefined) Object.defineProperty(this, 'media', { value: new FakeMediaPort(this, script.media), enumerable: true });
  }

  /** As the adapter's: a port only while the capability in the current report is on (a `contract` step moves it). */
  get previewSend(): PreviewSendPort | null {
    return this.snapshot.contract.capabilities.previewSend.state === 'on' ? this.sendPort : null;
  }

  /** @internal The next scripted answer of a kind, or undefined when the queue is empty. */
  take<K extends keyof HostAnswers>(kind: K): NonNullable<HostAnswers[K]>[number] | undefined {
    return this.queues[kind].shift();
  }

  /** @internal Throws HostContractViolation when `value` fails `schema`. */
  check(schema: { safeParse(value: unknown): { success: boolean } }, value: unknown, what: string): void {
    if (this.disposed) throw new HostContractViolation(`${what} after dispose()`, value);
    if (!schema.safeParse(value).success) throw new HostContractViolation(`${what}: the input breaks its contract schema`, value);
  }

  /** Clock of the timeline: the offset of the last played step. */
  get now(): number {
    const step = this.script.timeline[this.step];
    return this.startedAt + (step?.at ?? 0);
  }

  /** Plays the next timeline step; false when the timeline is over. */
  advance(): boolean {
    const step = this.script.timeline[this.step + 1];
    if (step === undefined || this.disposed) return false;
    this.step += 1;
    switch (step.kind) {
      case 'event':
        this.applyEvent(step.event);
        emit(this.events, step.event);
        break;
      case 'send-state':
        emit(this.sendPort.states.get(step.view.attemptId) ?? new Set<Callback<SendAttemptView>>(), step.view);
        break;
      case 'contract':
        this.snapshot = { ...this.snapshot, contract: step.report };
        emit(this.contracts, step.report);
        break;
      case 'mounts':
        this.snapshot = { ...this.snapshot, mounts: step.mounts };
        emit(this.mountListeners, step.mounts);
        break;
      case 'theme':
        this.snapshot = { ...this.snapshot, theme: step.theme };
        emit(this.themeListeners, step.theme);
        break;
    }
    return true;
  }

  /** Plays the whole timeline. */
  run(): void {
    while (this.advance()) {
      // each step notifies its listeners synchronously
    }
  }

  private applyEvent(event: HostEvent): void {
    if (event.type === 'route') this.snapshot = { ...this.snapshot, route: event.route };
    else if (event.type === 'composer') this.snapshot = { ...this.snapshot, composer: event.composer };
    else if (event.type === 'accounts') this.snapshot = { ...this.snapshot, accounts: event.accounts };
  }

  probe(): HostContractReport {
    return this.snapshot.contract;
  }

  onContract(cb: (report: HostContractReport) => void): Unsubscribe {
    return listen(this.contracts, cb);
  }

  current(): HostSnapshot {
    return this.snapshot;
  }

  subscribe(cb: (event: HostEvent) => void): Unsubscribe {
    return listen(this.events, cb);
  }

  readDraft(expected: HostIdentity): Promise<DraftSnapshot> {
    const chat = expected.chat;
    const found = chat === null ? undefined : this.script.memory.drafts.find((d) => d.identity.chat !== null && sameChat(d.identity.chat, chat));
    if (found === undefined) return Promise.reject(new Error('no draft of that chat in page memory'));
    return Promise.resolve(found);
  }

  readVisibleTail(expected: HostIdentity, max: number): Promise<LiveTextTail | null> {
    const chat = expected.chat;
    const found = chat === null ? undefined : this.script.memory.tails.find((t) => sameChat(t.chat, chat));
    if (found === undefined || this.snapshot.contract.capabilities.freshText.state !== 'on') return Promise.resolve(null);
    return Promise.resolve({ ...found.tail, messages: found.tail.messages.slice(-max) });
  }

  chatWindow(chat: ChatRef): ChatWindow | null {
    return this.script.memory.chatWindows.find((w) => sameChat(w.chat, chat)) ?? null;
  }

  fan(chat: ChatRef): HostFan | null {
    return this.script.memory.fans.find((f) => sameChat(f.chat, chat)) ?? null;
  }

  listCachedChats(hostAccountId: string, limit: number): readonly NavigationItem[] {
    return this.script.memory.chatList.filter((item) => item.chat.hostAccountId === hostAccountId).slice(0, limit);
  }

  listCachedAccounts(): readonly HostAccount[] {
    return this.snapshot.accounts;
  }

  private redeem(kind: 'insert' | 'navigate', intentId: string, actionToken: string): boolean {
    const redeemed = this.take('redeem') ?? true;
    this.calls.redeemed.push({ kind, intentId, actionToken, redeemed });
    return redeemed;
  }

  insert(intent: InsertIntent): Promise<InsertReceipt> {
    this.check(InsertIntentSchema, intent, 'insert');
    if (intent.expected.kind !== 'open') throw new HostContractViolation('a deferred insert rides a navigation, never insert()', intent);
    if (!this.redeem('insert', intent.intentId, intent.cause.actionToken)) return Promise.resolve({ state: 'rejected', code: 'CG-INSERT-FAILED' });
    this.calls.inserts.push(intent);
    const receipt = this.take('insert') ?? { state: 'applied', draftRevision: intent.expected.draftRevision + 1, draftDigest: 'feedbeef0000aaaa', ms: 6 };
    return Promise.resolve(receipt);
  }

  focusComposer(): Promise<boolean> {
    return Promise.resolve(this.snapshot.composer !== null);
  }

  navigate(intent: NavigationIntent): Promise<NavigationReceipt> {
    this.check(NavigationIntentSchema, intent, 'navigate');
    if (!this.redeem('navigate', intent.intentId, intent.cause.actionToken)) return Promise.resolve({ state: 'failed', code: 'CG-NAV-FAILED', insert: null });
    this.calls.navigations.push(intent);
    const receipt = this.take('navigate') ?? { state: 'navigated', routeEpoch: this.snapshot.route.epoch + 1, insert: null };
    return Promise.resolve(receipt);
  }

  checkpoint(chat: ChatRef): Promise<FreshnessCheckpoint | null> {
    this.calls.checkpoints.push(chat);
    const answer = this.queues.checkpoint.length > 0 ? this.take('checkpoint') : this.script.checkpoint;
    return Promise.resolve(answer ?? null);
  }

  mounts(): MountPoints {
    return this.snapshot.mounts;
  }

  onMounts(cb: (mounts: MountPoints) => void): Unsubscribe {
    return listen(this.mountListeners, cb);
  }

  theme(): HostTheme {
    return this.snapshot.theme;
  }

  onTheme(cb: (theme: HostTheme) => void): Unsubscribe {
    return listen(this.themeListeners, cb);
  }

  dispose(): void {
    this.disposed = true;
    this.events.clear();
    this.contracts.clear();
    this.mountListeners.clear();
    this.themeListeners.clear();
    this.sendPort.states.clear();
  }
}
