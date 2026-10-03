// A host whose page memory the test moves: the route, the composer and its
// draft, the chat window, the visible tail, the contract. Writes — insert,
// navigate, the freshness checkpoint — go to the scripted host it wraps
// (@cg/testing's FakeHostPort in the tests), which checks every intent
// against the contracts and logs it; an applied insert then becomes the
// composer's draft here, as it does on the page. Imports only @cg/contracts.

import {
  chatKeyOf,
  type ChatRef,
  type ChatWindow,
  type DraftSnapshot,
  type FreshnessCheckpoint,
  type HostAccount,
  type HostCapability,
  type CapabilityState,
  type HostContractReport,
  type HostEvent,
  type HostFan,
  type HostIdentity,
  type HostPort,
  type HostSnapshot,
  type HostTheme,
  type HumanSendFact,
  type InsertIntent,
  type InsertReceipt,
  type LiveTextTail,
  type MountPoints,
  type NavigationIntent,
  type NavigationItem,
  type NavigationReceipt,
  type Unsubscribe,
} from '@cg/contracts';

const digestOf = (revision: number): string => `feedbeef${revision.toString(16).padStart(8, '0')}`;

export class MutableHost implements HostPort {
  readonly kind = 'chatspace' as const;
  readonly platform = 'onlyfans' as const;
  readonly previewSend = null;

  private snapshot: HostSnapshot;
  private readonly drafts = new Map<string, DraftSnapshot>();
  private readonly windows = new Map<string, ChatWindow>();
  private readonly tails = new Map<string, LiveTextTail>();
  private readonly fans = new Map<string, HostFan>();
  private readonly listeners = new Set<(event: HostEvent) => void>();
  private readonly contracts = new Set<(report: HostContractReport) => void>();
  private readonly mountListeners = new Set<(mounts: MountPoints) => void>();
  /** How many times the page memory was read, by kind (to prove nothing is read without need). */
  readonly reads = { draft: 0, tail: 0 };
  failDraftRead = false;
  /** How many times `insert` was called on the host, whatever it answered. */
  inserts = 0;
  /** The bridge call is lost after it may have run: `insert` rejects, the outcome is unknown. */
  insertThrows = false;

  constructor(
    private readonly base: HostPort,
    memory: { readonly drafts: readonly DraftSnapshot[]; readonly chatWindows: readonly ChatWindow[]; readonly tails: readonly { readonly chat: ChatRef; readonly tail: LiveTextTail }[]; readonly fans: readonly HostFan[] },
  ) {
    this.snapshot = base.current();
    for (const draft of memory.drafts) if (draft.identity.chat !== null) this.drafts.set(chatKeyOf(draft.identity.chat), draft);
    for (const window of memory.chatWindows) this.windows.set(chatKeyOf(window.chat), window);
    for (const { chat, tail } of memory.tails) this.tails.set(chatKeyOf(chat), tail);
    for (const fan of memory.fans) this.fans.set(chatKeyOf(fan.chat), fan);
  }

  // ── what the test moves ──────────────────────────────────────────────────

  private emit(event: HostEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  /** The person opens another chat (or leaves chats): a new route epoch, a new composer. */
  openChat(chat: ChatRef | null, account: HostAccount | null = this.snapshot.route.account): void {
    const epoch = this.snapshot.route.epoch + 1;
    const identity = this.snapshot.identity;
    const instance = `composer-${epoch}`;
    this.snapshot = {
      ...this.snapshot,
      route: { epoch, name: chat === null ? 'accounts-overview' : 'chat', account, chat },
      identity: identity === null ? null : { ...identity, chat, routeEpoch: epoch, composerInstanceId: chat === null ? null : instance },
      composer: chat === null ? null : { chat, instanceId: instance, ready: true, hidden: false, draft: { revision: 0, provenance: 'empty' } },
      mounts: { ...this.snapshot.mounts, dock: { ...this.snapshot.mounts.dock, kind: chat === null ? 'none' : 'in-flow', composerInstanceId: chat === null ? null : instance } },
    };
    if (chat !== null && identity !== null) {
      const key = chatKeyOf(chat);
      const known = this.drafts.get(key);
      const draft: DraftSnapshot = { identity: this.snapshot.identity as HostIdentity, revision: known?.revision ?? 0, plainText: known?.plainText ?? '', provenance: known?.provenance ?? 'empty', digest: known?.digest ?? digestOf(0) };
      this.drafts.set(key, draft);
      this.snapshot = { ...this.snapshot, composer: { chat, instanceId: instance, ready: true, hidden: false, draft: { revision: draft.revision, provenance: draft.provenance } } };
    }
    this.emit({ type: 'route', route: this.snapshot.route });
    this.emit({ type: 'composer', composer: this.snapshot.composer });
  }

  /** The person types (or clears) the draft of the open chat: a new revision of unknown-or-human origin. */
  type(text: string): void {
    const chat = this.snapshot.route.chat;
    const identity = this.snapshot.identity;
    if (chat === null || identity === null) throw new Error('no open chat to type in');
    const before = this.drafts.get(chatKeyOf(chat));
    const revision = (before?.revision ?? 0) + 1;
    const provenance = text.length === 0 ? 'empty' : 'human-or-unknown';
    this.drafts.set(chatKeyOf(chat), { identity, revision, plainText: text, provenance, digest: digestOf(revision) });
    const composer = this.snapshot.composer;
    if (composer !== null) this.snapshot = { ...this.snapshot, composer: { ...composer, draft: { revision, provenance } } };
    this.emit({ type: 'composer', composer: this.snapshot.composer });
  }

  draftOf(chat: ChatRef): DraftSnapshot | null {
    return this.drafts.get(chatKeyOf(chat)) ?? null;
  }

  setWindow(window: ChatWindow | null, chat: ChatRef): void {
    if (window === null) this.windows.delete(chatKeyOf(chat));
    else this.windows.set(chatKeyOf(chat), window);
    this.emit({ type: 'chatCache', chat });
  }

  setTail(chat: ChatRef, tail: LiveTextTail | null): void {
    if (tail === null) this.tails.delete(chatKeyOf(chat));
    else this.tails.set(chatKeyOf(chat), tail);
    this.emit({ type: 'chatCache', chat });
  }

  setFan(fan: HostFan): void {
    this.fans.set(chatKeyOf(fan.chat), fan);
    this.emit({ type: 'chatCache', chat: fan.chat });
  }

  setCapability(capability: HostCapability, state: CapabilityState): void {
    const contract: HostContractReport = { ...this.snapshot.contract, capabilities: { ...this.snapshot.contract.capabilities, [capability]: state } };
    this.snapshot = { ...this.snapshot, contract };
    for (const listener of [...this.contracts]) listener(contract);
  }

  setComposer(patch: Partial<NonNullable<HostSnapshot['composer']>> | null): void {
    const composer = this.snapshot.composer;
    this.snapshot = { ...this.snapshot, composer: patch === null || composer === null ? null : { ...composer, ...patch } };
    this.emit({ type: 'composer', composer: this.snapshot.composer });
  }

  setMounts(mounts: MountPoints): void {
    this.snapshot = { ...this.snapshot, mounts };
    for (const listener of [...this.mountListeners]) listener(mounts);
  }

  humanSend(fact: HumanSendFact): void {
    this.emit({ type: 'humanSend', fact });
  }

  reloadNeeded(): void {
    this.emit({ type: 'reloadNeeded' });
  }

  // ── HostPort ─────────────────────────────────────────────────────────────

  probe(): HostContractReport {
    return this.snapshot.contract;
  }

  onContract(cb: (report: HostContractReport) => void): Unsubscribe {
    this.contracts.add(cb);
    return () => {
      this.contracts.delete(cb);
    };
  }

  current(): HostSnapshot {
    return this.snapshot;
  }

  subscribe(cb: (event: HostEvent) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  readDraft(expected: HostIdentity): Promise<DraftSnapshot> {
    this.reads.draft += 1;
    const draft = expected.chat === null ? undefined : this.drafts.get(chatKeyOf(expected.chat));
    if (this.failDraftRead || draft === undefined) return Promise.reject(new Error('no draft of that chat in page memory'));
    return Promise.resolve(draft);
  }

  readVisibleTail(expected: HostIdentity, max: number): Promise<LiveTextTail | null> {
    this.reads.tail += 1;
    const tail = expected.chat === null ? undefined : this.tails.get(chatKeyOf(expected.chat));
    if (tail === undefined || this.snapshot.contract.capabilities.freshText.state !== 'on') return Promise.resolve(null);
    return Promise.resolve({ ...tail, messages: tail.messages.slice(-max) });
  }

  chatWindow(chat: ChatRef): ChatWindow | null {
    return this.windows.get(chatKeyOf(chat)) ?? null;
  }

  fan(chat: ChatRef): HostFan | null {
    return this.fans.get(chatKeyOf(chat)) ?? null;
  }

  listCachedChats(hostAccountId: string, limit: number): readonly NavigationItem[] {
    return this.base.listCachedChats(hostAccountId, limit);
  }

  listCachedAccounts(): readonly HostAccount[] {
    return this.snapshot.accounts;
  }

  /** The scripted host checks the intent and answers; an applied write becomes our draft, as on the page. */
  async insert(intent: InsertIntent): Promise<InsertReceipt> {
    this.inserts += 1;
    if (this.insertThrows) throw new Error('the bridge call was lost');
    const receipt = await this.base.insert(intent);
    if (receipt.state === 'applied') {
      const key = chatKeyOf(intent.target);
      const before = this.drafts.get(key);
      const identity = this.snapshot.identity;
      if (before !== undefined && identity !== null) {
        const text = intent.mode === 'append' ? `${before.plainText}\n${intent.text}` : intent.text;
        this.drafts.set(key, { identity, revision: receipt.draftRevision, plainText: text, provenance: 'our-insert', digest: receipt.draftDigest });
        const composer = this.snapshot.composer;
        if (composer !== null && chatKeyOf(composer.chat) === key) this.snapshot = { ...this.snapshot, composer: { ...composer, draft: { revision: receipt.draftRevision, provenance: 'our-insert' } } };
        this.emit({ type: 'composer', composer: this.snapshot.composer });
      }
    }
    return receipt;
  }

  focusComposer(expected: HostIdentity): Promise<boolean> {
    return this.base.focusComposer(expected);
  }

  navigate(intent: NavigationIntent): Promise<NavigationReceipt> {
    return this.base.navigate(intent);
  }

  checkpoint(chat: ChatRef): Promise<FreshnessCheckpoint | null> {
    return this.base.checkpoint(chat);
  }

  mounts(): MountPoints {
    return this.snapshot.mounts;
  }

  onMounts(cb: (mounts: MountPoints) => void): Unsubscribe {
    this.mountListeners.add(cb);
    return () => {
      this.mountListeners.delete(cb);
    };
  }

  theme(): HostTheme {
    return this.snapshot.theme;
  }

  onTheme(): Unsubscribe {
    return () => undefined;
  }

  dispose(): void {
    this.listeners.clear();
    this.contracts.clear();
    this.mountListeners.clear();
  }
}
