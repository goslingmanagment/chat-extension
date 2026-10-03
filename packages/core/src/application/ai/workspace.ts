// The shared state of the AI controllers of one tab (architecture.md §10.2,
// §7): the environment (sign-in, bootstrap, settings, catalog), the mirror
// of operations, the open chat as a target, what the dock sheet shows per
// chat, part inserts and copies, and local recap copies. The dock, Recap,
// Review and Coach controllers are thin view-model builders and action
// handlers over it, so each can be loaded on its own (Coach, Recap and
// Review are lazy chunks) while the strip still knows what runs and what is
// open.
//
// Nothing here starts by itself: a generation needs a `generate` token of a
// trusted click or key, an insert an `insert` token. Views are rebuilt on a
// change of this state; the notification is coalesced into one microtask.

import { type CgCode, type CgErrorWire } from '@cg/contracts/errors';
import { type FeatureId, type Surface, type Tone } from '@cg/contracts/features';
import { type ChatWindow, type HostSnapshot, type LiveTextTail } from '@cg/contracts/host';
import { isFlagOn, type Bootstrap, type BootstrapPage, type ClientFeatureFlag } from '@cg/contracts/hub';
import { chatKeyOf, type ChatKey, type ChatRef, type HostAccount, type HostIdentity, type HumanCause, type PartRef, type Target } from '@cg/contracts/ids';
import { LIVE_TEXT_LIMITS } from '@cg/contracts/limits';
import { type ActiveOpSummary, type CoachTurn } from '@cg/contracts/ops';
import { type SettingsV1 } from '@cg/contracts/settings';
import { type AiQuotaSnapshot } from '@cg/contracts/tab-messages';
import { type DockStatus, type TargetHandle, type UnavailableReasonId, type UserOptions } from '@cg/contracts/vm';

import { fanScriptOf, featureGate, freshTextLimits, planStart, policyOf, toneAfterStart, toneForRegenerate, type FanScript } from '../../domain/features';
import { routeChangeEntry } from '../../domain/insert';
import { flagUsable, isTerminalOpState } from '../../domain/ops';
import { reviewCopyText } from '../../domain/output';
import { archiveLag, type ArchiveLag, type ArchivePoint, type RecapSlotKey } from '../../domain/recap';
import { TabEnvironment, type EnvironmentChange, type PersonaState } from './environment';
import { artifactHandle, readArtifactHandle, targetHandle, type Artifact } from './handles';
import { InsertService, partText, type InsertContext, type PartBlock } from './insert-service';
import { OpStore, type OpRecord, type OpStoreEvent } from './op-store';
import { type AiPorts, type RpcAnswer } from './ports';
import { RecapBook, type RecapOwner } from './recap-book';

/** What the dock's sheet shows in one chat; the latest action of the person decides. */
export type Sheet =
  | { readonly kind: 'draft'; readonly opId: string }
  | { readonly kind: 'recap' }
  | { readonly kind: 'review' }
  | { readonly kind: 'refusal'; readonly refusal: RefusalState };

/** A start that was not admitted: no operation exists (ui-design §4.9). */
export interface RefusalState {
  readonly feature: FeatureId;
  readonly error: CgErrorWire;
  readonly running: readonly ActiveOpSummary[];
}

interface ChatUi {
  /** Б1: the one-off tone of the next Reply in this chat. */
  tone: Tone | null;
  sheet: Sheet | null;
}

export interface OpenChat {
  readonly chat: ChatRef;
  readonly key: ChatKey;
  readonly handle: TargetHandle;
  readonly account: HostAccount | null;
  readonly identity: HostIdentity | null;
  readonly routeEpoch: number;
}

export interface ReadyTarget {
  readonly target: Target;
  readonly page: BootstrapPage;
  readonly bootstrap: Bootstrap;
  readonly settings: SettingsV1;
  readonly persona: PersonaState & { readonly key: string; readonly definitionId: string };
}

/** The open chat as the AI sees it right now. */
export interface Situation {
  readonly host: HostSnapshot;
  /** null — no chat is open (the dock is hidden, UI-012). */
  readonly chat: OpenChat | null;
  readonly status: DockStatus;
  /** The banner's error: code and facts. */
  readonly statusError: CgErrorWire | null;
  /** Why no AI action can start at all; null — actions are decided one by one. */
  readonly off: UnavailableReasonId | null;
  /** Why parts can only be copied; null — they can be inserted. */
  readonly copyOnly: PartBlock | null;
  /** Present when a generation can be started for the open chat. */
  readonly ready: ReadyTarget | null;
  readonly window: ChatWindow | null;
  /** The fan's display name as ChatSpace holds it; decoration only. */
  readonly fanName: string | null;
  readonly quota: AiQuotaSnapshot | null;
  readonly quotaZero: boolean;
  readonly persona: PersonaState | null;
  readonly pageName: string | null;
}

export interface StartRequest {
  readonly feature: FeatureId;
  readonly surface: Surface;
  readonly options: UserOptions;
  readonly cause: HumanCause['kind'];
  /** «Ещё раз»: the operation to repeat (its tone, its Split snapshot, Fix's same source). */
  readonly regenerateOf?: OpRecord;
  /** Bypass the result cache (every Recap build, Refresh). */
  readonly force?: boolean;
  readonly coachHistory?: readonly CoachTurn[];
}

export type StartResult =
  | { readonly kind: 'started'; readonly opId: string; readonly reopened: boolean }
  | { readonly kind: 'refused'; readonly refusal: RefusalState }
  | { readonly kind: 'failed'; readonly error: CgErrorWire };

export type CopyState = 'idle' | 'done' | 'failed';

/** How long «Скопировано» stays on a part (ui-design §4.3). */
export const COPIED_MARK_MS = 2_000;
/** UI-031: «AI: осталось N» from this many requests down. */
export const QUOTA_LOW_AT = 25;

const BINDING_STATUS: Partial<Record<CgCode, UnavailableReasonId>> = {
  'CG-BINDING-MISSING': 'no-binding',
  'CG-BINDING-AMBIGUOUS': 'no-binding',
  'CG-BINDING-NOT-GRANTED': 'not-granted',
};

const failed = (code: CgCode, facts: Omit<CgErrorWire, 'code'> = {}): StartResult => ({ kind: 'failed', error: { code, ...facts } });

export class AiWorkspace {
  readonly env: TabEnvironment;
  readonly ops: OpStore;
  readonly inserts: InsertService;
  readonly recaps: RecapBook;

  private readonly chats = new Map<ChatKey, ChatUi>();
  private readonly expanded = new Set<string>();
  private readonly copies = new Map<string, Exclude<CopyState, 'idle'>>();
  private readonly shown = new Set<string>();
  private readonly tails = new Map<ChatKey, { tail: LiveTextTail | null; dirty: boolean; reading: boolean; known: boolean }>();
  private readonly listeners = new Set<() => void>();
  private readonly opListeners = new Set<(event: OpStoreEvent) => void>();
  private readonly startListeners = new Set<(record: OpRecord) => void>();
  private readonly insertListeners = new Set<(record: OpRecord, part: PartRef) => void>();
  private readonly resetListeners = new Set<(filter: (chatKey: ChatKey, pageId: number) => boolean) => void>();
  private readonly offs: (() => void)[] = [];
  private readonly timers = new Set<unknown>();
  private hostReload = false;
  private versionValue = 0;
  private flushing = false;
  private situationCache: { version: number; value: Situation } | null = null;
  private personas: Readonly<Record<string, { key: string; definitionId: string }>> = {};
  private syncedChat: ChatKey | null = null;
  /** Whose results the tab holds: undefined — not known yet, null — nobody is signed in. */
  private signIn: string | null | undefined = undefined;
  private portWasDown = false;
  private disposed = false;

  constructor(readonly ports: AiPorts) {
    this.env = new TabEnvironment(ports.rpc);
    this.ops = new OpStore(ports.rpc, ports.clock);
    this.recaps = new RecapBook({
      ports,
      changed: () => this.bump(),
      openChat: () => this.situation().chat?.key ?? null,
      personaOf: (pageId) => this.env.persona(pageId).definitionId,
    });
    this.inserts = new InsertService({
      ports,
      record: (opId) => this.ops.get(opId),
      context: (record) => this.insertContext(record),
      token: (kind, cause) => this.token(kind, 'dock', cause),
      changed: () => this.bump(),
      wakeAt: (at) => this.wakeAt(at),
      inserted: (record, part) => {
        for (const listener of [...this.insertListeners]) listener(record, part);
      },
    });
  }

  /** Subscribes to the host and the background and reads the first state. */
  start(): void {
    const { host, i18n, rpc } = this.ports;
    this.offs.push(
      this.env.subscribe((change) => this.onEnvironment(change)),
      this.ops.subscribe((event) => this.onOp(event)),
      host.subscribe((event) => {
        switch (event.type) {
          case 'route':
            this.ports.journal?.write(routeChangeEntry(event.route, rpc.tabSessionId() ?? undefined));
            this.routeChanged();
            break;
          case 'chatCache': {
            const tail = this.tails.get(chatKeyOf(event.chat));
            if (tail !== undefined) tail.dirty = true;
            this.bump();
            break;
          }
          case 'humanSend':
            this.humanSent(event.fact);
            break;
          case 'reloadNeeded':
            this.hostReload = true;
            this.bump();
            break;
          case 'composer':
          case 'accounts':
          case 'incoming':
          case 'coverage':
            this.bump();
            break;
        }
      }),
      host.onContract(() => this.bump()),
      host.onMounts(() => this.bump()),
      i18n.subscribe(() => this.bump()),
    );
    this.env.start();
    this.routeChanged();
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    for (const timer of this.timers) this.ports.clock.clearTimer(timer);
    this.timers.clear();
    this.env.dispose();
    this.ops.dispose();
    this.recaps.dispose();
    this.listeners.clear();
  }

  // ── change notification ─────────────────────────────────────────────────

  /** Grows on every change a view may depend on. */
  get version(): number {
    return this.versionValue;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Something a view shows changed: the listeners hear it once, after the current work. */
  bump(): void {
    this.versionValue += 1;
    if (this.flushing || this.disposed) return;
    this.flushing = true;
    void Promise.resolve().then(() => {
      this.flushing = false;
      if (this.disposed) return;
      for (const listener of [...this.listeners]) listener();
    });
  }

  /** Rebuild the views at this moment (a deadline passes, a mark expires). */
  wakeAt(at: number): void {
    const { clock } = this.ports;
    const timer = clock.setTimer(Math.max(0, at - clock.now()), () => {
      this.timers.delete(timer);
      this.bump();
    });
    this.timers.add(timer);
  }

  onOpEvent(listener: (event: OpStoreEvent) => void): () => void {
    this.opListeners.add(listener);
    return () => {
      this.opListeners.delete(listener);
    };
  }

  /** A generation was admitted in this tab (the Coach panel yields, AI-100). */
  onStarted(listener: (record: OpRecord) => void): () => void {
    this.startListeners.add(listener);
    return () => {
      this.startListeners.delete(listener);
    };
  }

  onInserted(listener: (record: OpRecord, part: PartRef) => void): () => void {
    this.insertListeners.add(listener);
    return () => {
      this.insertListeners.delete(listener);
    };
  }

  /** A sign-in or persona change invalidated the state of these chats: drop what belongs to them. */
  onReset(listener: (affected: (chatKey: ChatKey, pageId: number) => boolean) => void): () => void {
    this.resetListeners.add(listener);
    return () => {
      this.resetListeners.delete(listener);
    };
  }

  // ── the open chat ────────────────────────────────────────────────────────

  situation(): Situation {
    const cached = this.situationCache;
    if (cached !== null && cached.version === this.versionValue) return cached.value;
    const value = this.readSituation();
    // Reading may start a lazy read (a binding, the quota) but never changes what was just read.
    this.situationCache = { version: this.versionValue, value };
    return value;
  }

  private readSituation(): Situation {
    const { host } = this.ports;
    const snapshot = host.current();
    const route = snapshot.route;
    const chatRef = route.name === 'chat' ? route.chat : null;
    const chat: OpenChat | null =
      chatRef === null ? null : { chat: chatRef, key: chatKeyOf(chatRef), handle: targetHandle('dock', chatRef), account: route.account, identity: snapshot.identity, routeEpoch: route.epoch };
    const base = { host: snapshot, chat, window: null, fanName: null, quota: null, quotaZero: false, persona: null, pageName: null, ready: null, copyOnly: null } as const;
    const off = (status: DockStatus, reason: UnavailableReasonId, error: CgErrorWire | null): Situation => ({ ...base, status, statusError: error, off: reason });

    if (this.hostReload || this.env.reloadNeeded) return off('reload-needed', 'reload-needed', { code: 'CG-RUNTIME-RELOADED' });
    const session = this.env.session;
    const settings = this.env.settings;
    if (session === undefined || settings === null) {
      const bootstrap = this.env.bootstrap;
      // The background did not answer at all: that is the hub line, not a sign-in question.
      if (bootstrap.s === 'error') return off('hub-down', 'hub-down', bootstrap.error);
      return off('loading-chat', 'chat-loading', null);
    }
    if (session === null) return off('not-signed-in', 'not-signed-in', { code: 'CG-AUTH-REQUIRED' });
    const bootstrap = this.env.bootstrap;
    if (bootstrap.s === 'error') return off('hub-down', 'hub-down', bootstrap.error);
    if (bootstrap.s !== 'ready') return off('loading-chat', 'chat-loading', null);
    if (chat === null) return off('ready', 'chat-loading', null);

    // UI-011: without the host's identity the account is not known — nothing sensitive runs.
    const identityOn = snapshot.contract.capabilities.identity.state === 'on' && snapshot.contract.capabilities.route.state === 'on';
    if (!identityOn) return off('host-degraded', 'host-degraded', { code: 'CG-HOST-CONTRACT' });
    if (chat.account === null || chat.identity === null) return off('loading-chat', 'chat-loading', null);

    const binding = this.env.binding(chat.account);
    if (binding.s === 'error') {
      const reason = BINDING_STATUS[binding.error.code];
      return reason === undefined ? off('hub-down', 'hub-down', binding.error) : off('no-binding', reason, binding.error);
    }
    if (binding.s !== 'ready') return off('loading-chat', 'chat-loading', null);
    const page = this.env.page(binding.value.pageId);
    if (page === null) return off('no-binding', 'not-granted', { code: 'CG-BINDING-NOT-GRANTED' });

    const persona = this.env.persona(page.pageId);
    const named = { ...base, persona, pageName: page.title };
    if (persona.status === 'loading') return { ...named, status: 'loading-chat', statusError: null, off: 'chat-loading' };
    if (persona.status !== 'ok' || persona.key === null || persona.definitionId === null) {
      const catalog = this.env.catalog;
      if (catalog.s === 'error') return { ...named, status: 'hub-down', statusError: catalog.error, off: 'hub-down' };
      const code: CgCode = persona.status === 'none' ? 'CG-PERSONA-NONE' : persona.status === 'unavailable' ? 'CG-PERSONA-UNAVAILABLE' : 'CG-PERSONA-UNASSIGNED';
      return { ...named, status: 'no-persona', statusError: { code }, off: 'no-persona' };
    }

    const quota = this.env.quota(page.pageId);
    const quotaZero = quota !== null && quota.remainingRequestsToday === 0;
    const window = host.chatWindow(chat.chat, 200);
    const fan = host.fan(chat.chat);
    const fanName = fan?.displayName ?? fan?.username ?? null;
    const target: Target = { binding: binding.value, chat: chat.chat, fanRef: chat.chat.platformFanId, conversationRef: chat.chat.platformFanId };
    const ready: ReadyTarget = { target, page, bootstrap: bootstrap.value, settings: settings.settings, persona: { ...persona, key: persona.key, definitionId: persona.definitionId } };
    const known = { ...named, window, fanName, quota, quotaZero, ready };

    if (window === null || window.state === 'loading') return { ...known, ready: null, status: 'loading-chat', statusError: null, off: 'chat-loading' };

    // Copy-only: the fan is blocked, ChatSpace's contract for the insert broke, the composer is not there, or the owner's switch is off.
    const composer = snapshot.composer;
    const blocked = composer?.hidden === true || snapshot.mounts.dock.kind === 'copy-only-row' || fan?.isBlocked === true;
    if (blocked) return { ...known, status: 'blocked-fan', statusError: { code: 'CG-GATE-FAN-BLOCKED' }, off: null, copyOnly: { reason: 'fan-blocked', code: 'CG-GATE-FAN-BLOCKED' } };
    const insert = snapshot.contract.capabilities.insert;
    if (insert.state !== 'on') {
      const code = insert.code ?? 'CG-HOST-CONTRACT';
      return { ...known, status: 'host-degraded', statusError: { code, ...(insert.reason === undefined ? {} : { detail: insert.reason }) }, off: null, copyOnly: { reason: 'host-degraded', code } };
    }
    if (composer === null || !composer.ready || chatKeyOf(composer.chat) !== chat.key || snapshot.mounts.dock.kind === 'none') {
      return { ...known, status: 'host-degraded', statusError: { code: 'CG-HOST-COMPOSER-MISSING' }, off: null, copyOnly: { reason: 'composer-missing', code: 'CG-HOST-COMPOSER-MISSING' } };
    }
    const insertion = flagUsable(bootstrap.value, page.pageId, 'insertion');
    return { ...known, status: 'ready', statusError: null, off: null, copyOnly: insertion ? null : { reason: 'feature-disabled', code: 'CG-FEATURE-DISABLED' } };
  }

  /** Whether an owner switch is usable on the open chat's page. */
  flag(flag: ClientFeatureFlag): boolean {
    const ready = this.situation().ready;
    return ready !== null && flagUsable(ready.bootstrap, ready.page.pageId, flag);
  }

  /** The master switch of a flag, whatever page is open (the strip hides nothing it cannot explain). */
  flagOn(flag: ClientFeatureFlag): boolean {
    const bootstrap = this.env.bootstrap;
    return bootstrap.s === 'ready' && isFlagOn(bootstrap.value.flags, flag);
  }

  // ── per-chat UI state ────────────────────────────────────────────────────

  private ui(key: ChatKey): ChatUi {
    let ui = this.chats.get(key);
    if (ui === undefined) {
      ui = { tone: null, sheet: null };
      this.chats.set(key, ui);
    }
    return ui;
  }

  tone(key: ChatKey): Tone | null {
    return this.chats.get(key)?.tone ?? null;
  }

  setTone(key: ChatKey, tone: Tone | null): void {
    this.ui(key).tone = tone;
    this.bump();
  }

  sheet(key: ChatKey): Sheet | null {
    return this.chats.get(key)?.sheet ?? null;
  }

  setSheet(key: ChatKey, sheet: Sheet | null): void {
    this.ui(key).sheet = sheet;
    this.bump();
  }

  isExpanded(id: string): boolean {
    return this.expanded.has(id);
  }

  setExpanded(id: string, expanded: boolean): void {
    if (expanded) this.expanded.add(id);
    else this.expanded.delete(id);
    this.bump();
  }

  // ── tokens ───────────────────────────────────────────────────────────────

  /** A one-time token of the trusted click or key being handled (§14). */
  async token(kind: 'generate' | 'insert' | 'navigate', surface: Surface, cause: HumanCause['kind']): Promise<RpcAnswer<HumanCause>> {
    const answer = await this.ports.rpc.request('token.issue', { kind, surface });
    return answer.ok ? { ok: true, payload: { kind: cause, actionToken: answer.payload.actionToken } } : answer;
  }

  // ── starting a generation ────────────────────────────────────────────────

  /**
   * Starts a feature in the open chat: the gates, the draft and the fresh
   * tail it may carry, the token, the plan, the admission. Nothing is spent
   * on a refusal; what was typed stays with the person.
   */
  async startFeature(request: StartRequest): Promise<StartResult> {
    const situation = this.situation();
    const { chat, ready } = situation;
    if (chat === null || chat.identity === null) return failed('CG-GATE-CHAT-LOADING');
    if (ready === null) return failed(situation.statusError?.code ?? 'CG-GATE-CHAT-LOADING', situation.statusError ?? {});
    const { feature, surface } = request;
    const rule = policyOf(feature);
    if (situation.quotaZero) return failed('CG-QUOTA-DAILY', situation.quota === null ? {} : { retryAt: Date.parse(situation.quota.resetsAt) });
    if (rule.flag !== null && !flagUsable(ready.bootstrap, ready.page.pageId, rule.flag)) return failed('CG-FEATURE-DISABLED');

    const original = request.regenerateOf;
    const source = original?.memo.fixSource ?? null;
    const composer = situation.host.composer;
    const gate = featureGate(feature, {
      platform: ready.target.binding.platform,
      window: situation.window,
      // Fix again rewrites the same source, whatever the field holds now.
      draftEmpty: source !== null ? false : composer === null ? null : composer.draft.provenance === 'empty',
    });
    if (gate !== null) return failed(gate.code);

    const { host } = this.ports;
    let draft: { plainText: string; revision: number; digest: string } | null = source === null ? null : { plainText: source.text, revision: source.revision, digest: source.digest };
    if (draft === null && (rule.requiresDraft || request.options.attachMyDraft === true)) {
      try {
        const read = await host.readDraft(chat.identity);
        draft = { plainText: read.plainText, revision: read.revision, digest: read.digest };
      } catch {
        // Fix cannot run without its source; Coach simply goes without the attachment.
        if (rule.requiresDraft) return failed('CG-HOST-NOT-READY');
      }
    }
    const limits = freshTextLimits(feature, surface, ready.bootstrap, ready.page.pageId);
    let fresh: LiveTextTail | null = null;
    if (limits !== null) {
      try {
        fresh = await host.readVisibleTail(chat.identity, limits.maxItems);
      } catch {
        fresh = null;
      }
    }
    const token = await this.token('generate', surface, request.cause);
    if (!token.ok) return failed(token.error.code, token.error);
    // The person switched chats while the page was read: this click was for the chat that is gone.
    if (this.ports.host.current().route.epoch !== chat.routeEpoch) return failed('CG-CONTEXT-CHANGED');

    const plan = planStart({
      feature,
      surface,
      target: ready.target,
      cause: token.payload,
      options: request.options,
      settings: ready.settings,
      bootstrap: ready.bootstrap,
      tone: original !== undefined ? toneForRegenerate(original.view) : this.tone(chat.key),
      draft,
      fresh,
      ...(request.coachHistory === undefined ? {} : { coachHistory: request.coachHistory }),
      ...(original === undefined ? {} : { regenerateOf: original.view.opId, splitWanted: original.memo.split }),
      ...(request.force === true ? { force: true } : {}),
    });
    if (!plan.ok) return failed(plan.code);

    const outcome = await this.ops.start(plan.start, { fixSource: plan.start.draft !== undefined && feature === 'fix' ? plan.start.draft : null, personaDefinitionId: ready.persona.definitionId });
    switch (outcome.kind) {
      case 'error':
        return { kind: 'failed', error: outcome.error };
      case 'refused':
        return { kind: 'refused', refusal: { feature, error: { code: outcome.admission.code }, running: outcome.admission.active } };
      case 'started': {
        // Б1: the tone went with this request and is gone.
        if (rule.tone) this.ui(chat.key).tone = toneAfterStart();
        const record = this.ops.get(outcome.opId);
        if (record !== null) for (const listener of [...this.startListeners]) listener(record);
        this.bump();
        return outcome;
      }
    }
  }

  /** The operation running in a chat, as far as this tab knows. */
  running(key: ChatKey): OpRecord | null {
    return this.ops.runningIn(key);
  }

  // ── inserts ──────────────────────────────────────────────────────────────

  private insertContext(record: OpRecord): InsertContext {
    const situation = this.situation();
    const sameChat = situation.chat !== null && situation.chat.key === chatKeyOf(record.view.target.chat);
    const session = this.env.session;
    const pageId = record.view.target.binding.pageId;
    const persona = this.env.persona(pageId);
    return {
      current: {
        signInEpoch: session?.epoch ?? null,
        bindingRevision: this.env.page(pageId)?.bindingRevision ?? null,
        personaDefinitionId: persona.definitionId,
      },
      blocked: sameChat ? situation.copyOnly : null,
      editorObserved: situation.host.contract.capabilities.draftRead.state === 'on',
      fanScript: () => this.fanScript(chatKeyOf(record.view.target.chat)),
    };
  }

  // ── the page tail (the archive lag, the language gate) ───────────────────

  /**
   * The visible tail of the open chat, read from page memory only when a
   * view needs it (the archive lag, the language of the fan) and again after
   * the chat's cache changed. Never sent anywhere from here.
   */
  pageTail(key: ChatKey): LiveTextTail | null {
    let entry = this.tails.get(key);
    if (entry === undefined) {
      entry = { tail: null, dirty: true, reading: false, known: false };
      this.tails.set(key, entry);
    }
    const chat = this.situation().chat;
    if (entry.dirty && !entry.reading && chat !== null && chat.key === key && chat.identity !== null) {
      const slot = entry;
      slot.reading = true;
      slot.dirty = false;
      void this.ports.host
        .readVisibleTail(chat.identity, LIVE_TEXT_LIMITS.maxItems)
        .catch(() => null)
        .then((tail) => {
          slot.reading = false;
          slot.known = true;
          slot.tail = tail;
          this.bump();
        });
    }
    return entry.tail;
  }

  fanScript(key: ChatKey): FanScript {
    return fanScriptOf(this.pageTail(key));
  }

  /**
   * NEW-02: how far an archive point is behind the page of this chat; null —
   * not behind, or nothing can be said. Nothing is said before the page was
   * looked at once: a lag is never guessed and then taken back.
   */
  archiveLag(point: ArchivePoint | null, key: ChatKey): ArchiveLag | null {
    if (point === null) return null;
    const tail = this.pageTail(key);
    if (this.tails.get(key)?.known !== true) return null;
    return archiveLag(point, { tail, window: this.situation().window });
  }

  // ── recaps ───────────────────────────────────────────────────────────────

  /** Whose recaps the open chat's are: the page, the fan and the persona definition. */
  slotKey(ready: ReadyTarget): RecapSlotKey {
    return { hubOrigin: ready.target.binding.hubOrigin, pageId: ready.page.pageId, fanRef: ready.target.fanRef, personaDefinitionId: ready.persona.definitionId };
  }

  recapOwner(ready: ReadyTarget): RecapOwner {
    return { key: this.slotKey(ready), chatKey: chatKeyOf(ready.target.chat) };
  }

  // ── copies ───────────────────────────────────────────────────────────────

  copyState(handle: string): CopyState {
    return this.copies.get(handle) ?? 'idle';
  }

  /** The text an artifact handle names; null — nothing copyable under it (any more). */
  private artifactText(artifact: Artifact): { readonly text: string; readonly opId: string | null; readonly part: PartRef | null } | null {
    switch (artifact.kind) {
      case 'part': {
        const record = this.ops.get(artifact.opId);
        if (record === null) return null;
        const part: PartRef = artifact.variant === null ? { index: artifact.index } : { variant: artifact.variant, index: artifact.index };
        const text = partText(record, part);
        return text === null ? null : { text, opId: artifact.opId, part };
      }
      case 'review': {
        const record = this.ops.get(artifact.opId);
        const result = record?.view.result;
        return result === undefined || result.kind !== 'review' ? null : { text: reviewCopyText(result.raw), opId: artifact.opId, part: null };
      }
      case 'recap': {
        const copy = this.recaps.slots.byLocalId(artifact.localId);
        return copy === null ? null : { text: copy.markdown, opId: copy.opId, part: null };
      }
    }
  }

  /** «Копировать»: `copied` is reported only after the clipboard write succeeded (TL-006, Б14). */
  async copy(handle: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: CgErrorWire }> {
    const artifact = readArtifactHandle(handle);
    const found = artifact === null ? null : this.artifactText(artifact);
    if (found === null) return { ok: false, error: { code: 'CG-CLIPBOARD' } };
    let written: boolean;
    try {
      written = (await this.ports.clipboard.writeText(found.text)).ok;
    } catch {
      written = false;
    }
    if (!written) {
      this.copies.set(handle, 'failed');
      this.bump();
      return { ok: false, error: { code: 'CG-CLIPBOARD' } };
    }
    this.copies.set(handle, 'done');
    const { clock, rpc } = this.ports;
    const timer = clock.setTimer(COPIED_MARK_MS, () => {
      this.timers.delete(timer);
      if (this.copies.get(handle) === 'done') this.copies.delete(handle);
      this.bump();
    });
    this.timers.add(timer);
    if (found.opId !== null) void rpc.request('op.reportCopy', found.part === null ? { opId: found.opId } : { opId: found.opId, part: found.part });
    this.bump();
    return { ok: true };
  }

  partHandle(opId: string, part: PartRef): string {
    return artifactHandle({ kind: 'part', opId, variant: part.variant ?? null, index: part.index });
  }

  // ── acceptance telemetry ─────────────────────────────────────────────────

  /** The result was really visible (RenderMarks.resultShown): `shown`, once per operation (§9.6). */
  resultShown(opId: string): void {
    if (this.shown.has(opId)) return;
    const record = this.ops.get(opId);
    if (record === null || record.view.state !== 'done') return;
    this.shown.add(opId);
    void this.ports.rpc.request('op.reportShown', { opId });
  }

  /**
   * §6.6: the person pressed ChatSpace's Send. `sent` exists only when the
   * host proved the message id and the draft descends from one of our
   * inserts; `edited` is the host's reading of the revision chain.
   */
  private humanSent(fact: Extract<Parameters<Parameters<AiPorts['host']['subscribe']>[0]>[0], { type: 'humanSend' }>['fact']): void {
    const { draft, platformMessageId } = fact;
    if (platformMessageId === null || draft.insertIntentId === null || draft.editedSinceInsert === null) return;
    const origin = this.inserts.intent(draft.insertIntentId);
    if (origin === null) return;
    void this.ports.rpc.request('op.reportSent', { opId: origin.opId, part: origin.part, pendingId: fact.pendingId, platformMessageId, edited: draft.editedSinceInsert });
  }

  // ── reactions ────────────────────────────────────────────────────────────

  private routeChanged(): void {
    const route = this.ports.host.current().route;
    const key = route.name === 'chat' && route.chat !== null ? chatKeyOf(route.chat) : null;
    if (key !== null) {
      const tail = this.tails.get(key);
      if (tail !== undefined) tail.dirty = true;
      // What the background knows about this chat: a result of the last half hour, a run of another tab.
      // Asked once per visit, and only once somebody is signed in.
      if (key !== this.syncedChat && this.env.session) {
        this.syncedChat = key;
        void this.ops.syncChat(key);
      }
    } else this.syncedChat = null;
    this.bump();
  }

  private onOp(event: OpStoreEvent): void {
    if (event.kind === 'done') {
      const { view } = event.record;
      // A canceled draft closes its sheet (ui-design §8.2); its chat keeps nothing of it.
      if (view.state === 'canceled') {
        const key = chatKeyOf(view.target.chat);
        const sheet = this.sheet(key);
        if (sheet !== null && sheet.kind === 'draft' && sheet.opId === view.opId) this.ui(key).sheet = null;
      }
      const wire = view.error;
      if (wire?.retryAt !== undefined) this.wakeAt(wire.retryAt);
      // A finished recap is the shared artifact now: the slot holds its copy whichever surface asked for it.
      if (view.state === 'done' && (view.feature === 'recap' || view.feature === 'recap-short')) this.recaps.generated(event.record);
    }
    for (const listener of [...this.opListeners]) listener(event);
    this.bump();
  }

  private onEnvironment(change: EnvironmentChange): void {
    if (change === 'connection') {
      const state = this.env.connection;
      if (state === 'reconnecting' || state === 'lost') this.portWasDown = true;
      else if (state === 'ready' && this.portWasDown) {
        this.portWasDown = false;
        // What ended while the port was down said nothing to this tab.
        void this.ops.resync();
        this.recaps.resume();
      }
    }
    if (change === 'session') {
      const session = this.env.session;
      const signIn = session === undefined ? undefined : session === null ? null : `${session.hubOrigin}\u0000${session.userId}\u0000${session.epoch}`;
      // The same sign-in read again (a reconnect, «Повторить»): nothing of it is dropped.
      if (signIn !== undefined && signIn !== this.signIn) {
        this.signIn = signIn;
        // AI-126: results never cross a sign-in.
        const stale = (record: OpRecord): boolean =>
          !session || record.view.target.binding.loginEpoch !== session.epoch || record.view.target.binding.principalId !== session.userId || record.view.target.binding.hubOrigin !== session.hubOrigin;
        this.forget(this.ops.drop(stale));
        this.recaps.reset(!session);
        if (!session) {
          this.chats.clear();
          this.syncedChat = null;
        }
        this.reset(() => true);
        if (session) this.routeChanged();
      }
    }
    if (change === 'settings') {
      const next = this.env.settings?.settings.personas.byPageId ?? {};
      const before = this.personas;
      this.personas = next;
      const changed = new Set<number>();
      for (const pageId of new Set([...Object.keys(before), ...Object.keys(next)])) {
        const a = before[pageId];
        const b = next[pageId];
        if (a !== undefined && (b === undefined || a.key !== b.key || a.definitionId !== b.definitionId)) changed.add(Number(pageId));
      }
      if (changed.size > 0) {
        // AI-126: a persona change drops the results and the Coach dialogs of that page.
        this.forget(this.ops.drop((record) => changed.has(record.view.target.binding.pageId) && isTerminalOpState(record.view.state)));
        this.reset((_key, pageId) => changed.has(pageId));
      }
    }
    this.bump();
  }

  private forget(opIds: readonly string[]): void {
    for (const opId of opIds) {
      this.inserts.dropOp(opId);
      this.expanded.delete(opId);
      for (const ui of this.chats.values()) if (ui.sheet !== null && ui.sheet.kind === 'draft' && ui.sheet.opId === opId) ui.sheet = null;
    }
  }

  private reset(affected: (chatKey: ChatKey, pageId: number) => boolean): void {
    for (const listener of [...this.resetListeners]) listener(affected);
  }
}
