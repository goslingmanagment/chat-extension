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
import type { AdmissionAction } from '@cg/contracts/features/types';
import { type ChatWindow, type HostSnapshot, type LiveTextTail } from '@cg/contracts/host';
import { type Bootstrap, type BootstrapPage, type ClientFeatureFlag } from '@cg/contracts/hub';
import { HOST_PLATFORM } from '@cg/contracts/hosts';
import { CHAT_IS_FAN, chatKeyOf, type ChatKey, type ChatRef, type HostAccount, type HostIdentity, type HumanCause, type PartRef, type Target } from '@cg/contracts/ids';
import { LIVE_TEXT_LIMITS } from '@cg/contracts/limits';
import { type AnyActiveOpSummary, type CoachTurn } from '@cg/contracts/ops';
import { type SettingsV1 } from '@cg/contracts/settings';
import { type SettingsExt } from '@cg/contracts/settings-ext';
import { type AiQuotaSnapshot, type TabRequestPayload } from '@cg/contracts/tab-messages';
import { type DockStatus, type ReasonVM, type TargetHandle, type UiAction, type UnavailableReasonId, type UserOptions } from '@cg/contracts/vm';

import { admittedOn, fanScriptOf, featureGate, freshTextAdmitted, freshTextLimits, planStart, policyOf, remembersTone, toneAfterStart, toneForRegenerate, toneOnLeave, windowFor, type FanScript, type GateFacts } from '../../domain/features';
import { routeChangeEntry } from '../../domain/insert';
import { clientOutdated, flagRefusal, flagStateOf, flagUsable, isTerminalOpState, pageSwitchedOff, starFlag, type FlagState } from '../../domain/ops';
import { reviewCopyText } from '../../domain/output';
import { archiveLag, type ArchiveLag, type ArchivePoint, type RecapSlotKey } from '../../domain/recap';
import { type BoardHandover, type BoardPartFacts, type BoardResults } from '../board-handover';
import { PAGE_OFF_REASON, flagReasonVm } from '../flag-reason';
import { TabEnvironment, type EnvironmentChange, type PersonaState } from './environment';
import { artifactHandle, readArtifactHandle, targetHandle, type Artifact } from './handles';
import { InsertService, partText, type InsertContext, type PartBlock } from './insert-service';
import { OpStore, type OpRecord, type OpStoreEvent, type PersonaFollow } from './op-store';
import { type AiPorts, type RpcAnswer } from './ports';
import { RecapBook, type RecapOwner } from './recap-book';

/** What the dock's sheet shows in one chat; the latest action of the person decides. */
export type Sheet =
  | { readonly kind: 'draft'; readonly opId: string }
  | { readonly kind: 'recap' }
  | { readonly kind: 'review' }
  | { readonly kind: 'refusal'; readonly refusal: RefusalState };

/**
 * A start that was not admitted: no operation exists (ui-design §4.9). Either
 * the background refused it and named what runs (the fourth generation, a busy
 * chat), or the start failed before any admission — a gate, no token, a
 * background that could not write its journal or did not answer: `running` is
 * empty then.
 */
export interface RefusalState {
  readonly feature: FeatureId;
  readonly error: CgErrorWire;
  readonly running: readonly AnyActiveOpSummary[];
  /** When it was refused: a start refused again is another refusal, and is shown again after «Скрыть». */
  readonly at?: number;
  /**
   * The same start once more (X45): the action the card's «Повторить» dispatches where the registry lets a new click
   * repeat the code. Only a start that failed before admission has one — nothing was generated, sent or written.
   */
  readonly retry?: UiAction;
}

interface ChatUi {
  /** The tone of the next Reply in this chat: kept while the chat is open (X45), or one-off (Б1) — `remembersTone`. */
  tone: Tone | null;
  sheet: Sheet | null;
  /** The hub page of the chat when its sheet was set; null — not known then. */
  pageId: number | null;
}

export interface OpenChat {
  readonly chat: ChatRef;
  /**
   * The host's conversation of the chat, from the route (1.15.0): on Fansly the group id of the address; absent on
   * the route — the conversation is the fan (ChatSpace). Never another chat's, and never the fan's id where a chat has
   * an id of its own (R20 P8a, FS-IDN-6): a route of such a site that names no conversation opens no chat for the AI.
   */
  readonly conversationRef: string;
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
  /**
   * Nothing of ours runs on the page of the open chat, and why: the owner's master switch is off (it is one for
   * the whole hub: every feature of every page reads `disabled`), or this build is too old for the hub
   * (`minVersion`, or every feature reads `client_outdated`). The dock stays `ready` and says so in one line;
   * every AI action — «Ещё раз» of an earlier result included — is off with that reason (`off` is set), parts
   * can only be copied: nothing is offered that the hub would refuse after the click. null — the page works.
   */
  readonly pageOff: PageOff | null;
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
  /**
   * AI-096: the recap a Coach turn builds before its question. One start, one
   * token of the click: the background runs both steps under one admission.
   * Dropped when the conversation allows no such recap (too little history)
   * — the question then simply goes.
   */
  readonly autoRecap?: 'short' | 'full';
}

export type StartResult =
  | { readonly kind: 'started'; readonly opId: string; readonly reopened: boolean }
  | { readonly kind: 'refused'; readonly refusal: RefusalState }
  | { readonly kind: 'failed'; readonly error: CgErrorWire };

export type CopyState = 'idle' | 'done' | 'failed';

/**
 * Whose operation it is: the dock, Recap, Review and Coach controllers answer
 * for operations of the open chat's surfaces; previews and «Новые» have
 * their own controllers (R12), which the router asks after these.
 */
export const isOwnSurface = (surface: Surface): boolean => surface !== 'preview' && surface !== 'newcomers';

/** How long «Скопировано» stays on a part (ui-design §4.3). */
export const COPIED_MARK_MS = 2_000;

/**
 * §6.5 п. 4: how long the dock of a chat a board has just opened is asked again for the Б2 question while it does
 * not see that chat's field yet, and how often. ChatSpace shows the chat first; the dock's reading follows.
 */
export const BOARD_QUESTION_WAIT_MS = 5_000;
export const BOARD_QUESTION_STEP_MS = 100;
/**
 * §6.6: how many times one human-send report is said before it is given up, and how many wait for the port. The
 * report is the only word the background (and through it the hub) gets of that send, so a port lost under the
 * request is not the end of it — the same discipline as the boards' own reports (the tab's host facts).
 */
export const SENT_REPORT_TRIES = 4;
const SENT_REPORTS_KEPT = 32;
type SentReport = TabRequestPayload<'op.reportSent'>;
/** A part of a board's result the board no longer answers for: «часть устарела — обновите ответ» (CG-SEND-PART). */
const STALE_BOARD_PART: PartBlock = { reason: 'send-unavailable', code: 'CG-SEND-PART', view: { id: 'send-unavailable', code: 'CG-SEND-PART', text: { key: 'send.reason.part' } } };
/** «Cannot ask yet»: the field of the chat is not seen (not ready, or the host's identity is still on its way). */
const FIELD_NOT_SEEN_YET: readonly CgCode[] = ['CG-HOST-COMPOSER-MISSING', 'CG-HOST-NOT-READY'];
/** Chats whose tone or open sheet the tab remembers. */
export const CHAT_UI_MAX = 64;
/** UI-031: «AI: осталось N» from this many requests down. */
export const QUOTA_LOW_AT = 25;

/** What a start, a view or a card says of a page the owner switched off: the hub's own reason in the technical line. */
export const PAGE_OFF_ERROR: CgErrorWire = { code: 'CG-FEATURE-DISABLED', detail: 'disabled' };

/** Why nothing of ours runs on a page (`Situation.pageOff`). */
export interface PageOff {
  /** The hub's reason token. */
  readonly why: 'disabled' | 'client_outdated';
  /** What every AI action and «Ещё раз» says. */
  readonly reason: ReasonVM;
  /** What a start refused by it answers with. */
  readonly error: CgErrorWire;
}

/** The owner's master switch. */
export const MASTER_OFF: PageOff = { why: 'disabled', reason: PAGE_OFF_REASON, error: PAGE_OFF_ERROR };
/** A build below the hub's `minVersion`. */
export const CLIENT_OUTDATED: PageOff = { why: 'client_outdated', reason: flagReasonVm({ reason: 'client_outdated' }), error: { code: 'CG-HUB-OUTDATED', detail: 'client_outdated' } };

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
  private readonly tails = new Map<ChatKey, { tail: LiveTextTail | null; dirty: boolean; reading: boolean; known: boolean; script: FanScript | null }>();
  /** What the views read of the composer: a keystroke that changes none of it rebuilds nothing. */
  private composerSeen = '';
  private readonly listeners = new Set<() => void>();
  private readonly opListeners = new Set<(event: OpStoreEvent) => void>();
  private readonly startListeners = new Set<(record: OpRecord) => void>();
  private readonly insertListeners = new Set<(record: OpRecord, part: PartRef) => void>();
  private readonly resetListeners = new Set<(filter: (chatKey: ChatKey, pageId: number) => boolean) => void>();
  private readonly followListeners = new Set<(moves: readonly PersonaFollow[]) => void>();
  /** Results a board made that the dock shows in their own chat (§6.5). */
  private readonly boardOps = new Set<string>();
  private boards: BoardResults | null = null;
  private offBoards: (() => void) | null = null;
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
  /** Human-send reports nobody answered, waiting for the port to come back. */
  private readonly unsaidSends: { readonly report: SentReport; readonly tries: number }[] = [];
  private disposed = false;

  constructor(readonly ports: AiPorts) {
    this.env = new TabEnvironment(ports.rpc);
    this.ops = new OpStore(ports.rpc, ports.clock, (pageId) => this.env.assignedDefinition(pageId));
    this.recaps = new RecapBook({
      ports,
      changed: () => this.bump(),
      openChat: () => this.situation().chat?.key ?? null,
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
      hold: (record, part) => this.boardHold(record, part),
      recheck: (record, part) => this.boardHoldNow(record, part),
    });
  }

  /** Subscribes to the host and the background and reads the first state. */
  start(): void {
    const { host, i18n, rpc } = this.ports;
    const stopWatching = this.ports.policy.watch?.(host, () => {
      for (const record of this.ops.all()) this.recaps.generated(record, true);
      this.bump();
    });
    if (stopWatching !== undefined) this.offs.push(stopWatching);
    this.offs.push(
      this.env.subscribe((change) => this.onEnvironment(change)),
      this.ops.subscribe((event) => this.onOp(event)),
      // A result that left the store by age or by the tab's cap takes what was kept for it along.
      this.ops.onDropped((opIds) => {
        this.forget(opIds);
        this.bump();
      }),
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
          case 'composer': {
            // Views read whether there is a composer for the chat, whether it is ready and shown, and whether
            // the draft is empty, human or ours — never its text or revision. A keystroke that changes none of
            // that rebuilds no view (§11: typing must not cost a redraw of our panels).
            const composer = event.composer;
            const seen = composer === null ? 'none' : [chatKeyOf(composer.chat), composer.instanceId, composer.ready, composer.hidden, composer.draft.provenance].join('|');
            // The next look at the situation still reads the host afresh.
            this.situationCache = null;
            if (seen === this.composerSeen) break;
            this.composerSeen = seen;
            this.bump();
            break;
          }
          case 'accounts':
          case 'incoming':
          case 'coverage':
            this.bump();
            break;
          // The X8 fuse (decision X25) is the tab's to report; what it turns off comes with the host contract.
          case 'sendFuse':
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
    this.offBoards?.();
    this.offBoards = null;
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

  /** The owner edited a page's persona (its key stays): what is held under the old definition is the same persona's. */
  onPersonaFollowed(listener: (moves: readonly PersonaFollow[]) => void): () => void {
    this.followListeners.add(listener);
    return () => {
      this.followListeners.delete(listener);
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
    const conversationRef = chatRef === null ? undefined : (route.conversationRef ?? (CHAT_IS_FAN[HOST_PLATFORM[chatRef.host]] ? chatRef.platformFanId : undefined));
    const chat: OpenChat | null =
      chatRef === null || conversationRef === undefined
        ? null
        : {
            chat: chatRef,
            conversationRef,
            key: chatKeyOf(chatRef),
            handle: targetHandle('dock', chatRef),
            account: route.account,
            identity: snapshot.identity,
            routeEpoch: route.epoch,
          };
    const base = { host: snapshot, chat, window: null, fanName: null, quota: null, quotaZero: false, persona: null, pageName: null, ready: null, copyOnly: null, pageOff: null } as const;
    const off = (status: DockStatus, reason: UnavailableReasonId, error: CgErrorWire | null): Situation => ({ ...base, status, statusError: error, off: reason });

    if (this.hostReload || this.env.reloadNeeded) return off('reload-needed', 'reload-needed', { code: 'CG-RUNTIME-RELOADED' });
    // The port is lost and its quick reconnects failed, but the extension is the same instance — nothing was
    // updated, so this is not «перезагрузите вкладку». What the tab remembers of the sign-in still reads «ready»,
    // yet nothing would start: the dock says «Расширение не отвечает» in the line of a service that is away, with
    // «Повторить»; the tab keeps asking the background by itself and the dock comes back when it answers.
    if (this.env.unreachable) return off('hub-down', 'runtime-unreachable', { code: 'CG-RUNTIME-UNREACHABLE' });
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

    // UI-011: without the host's identity the account is not known — nothing sensitive runs. It is the
    // «ChatSpace обновился» banner («вставка недоступна — только Копировать»), so parts are copy-only too:
    // what was generated before can still be copied, nothing new starts (the buttons say why).
    const identityOn = snapshot.contract.capabilities.identity.state === 'on' && snapshot.contract.capabilities.route.state === 'on';
    if (!identityOn) return { ...off('host-degraded', 'host-degraded', { code: 'CG-HOST-CONTRACT' }), copyOnly: { reason: 'host-degraded', code: 'CG-HOST-CONTRACT' } };
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
    // The owner's master switch is off for this page: whatever else is missing (a persona, the chat's history),
    // nothing of ours would run here — the hub refuses every AI call of this client on the page. One line says
    // so; what was generated before can still be copied.
    // An outdated build is the same kind of state: the hub refuses it whatever is asked, so the buttons say it first.
    const pageOff = pageSwitchedOff(page) ? MASTER_OFF : clientOutdated(bootstrap.value, page, this.ports.extensionVersion) ? CLIENT_OUTDATED : null;
    if (pageOff !== null) {
      return { ...named, status: 'ready', statusError: null, off: 'feature-disabled', pageOff, copyOnly: { reason: 'feature-disabled', code: pageOff.error.code, view: pageOff.reason } };
    }
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
    const target: Target = { binding: binding.value, chat: chat.chat, fanRef: chat.chat.platformFanId, conversationRef: chat.conversationRef };
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
    // Whether a draft may be put into the field on THIS page: the insert of Reply by the site's manifest — the
    // owner's `insertion` switch of the page (its own feature, never the top-level `flags`). It closes nothing
    // else: a generation is admitted on its own, and its parts can be copied.
    const insertion = this.admitted(snapshot, ready, 'reply', 'insert');
    const copyOnly: PartBlock | null = insertion.usable ? null : { reason: 'feature-disabled', code: flagRefusal(insertion).code, view: flagReasonVm(insertion) };
    return { ...known, status: 'ready', statusError: null, off: null, copyOnly };
  }

  /**
   * What the site's slice of the feature manifest says, on the page of the open chat, of a feature (`action: null`)
   * or of one thing done with it — its generation, an insert, a send — in the shape of a switch: usable, or the
   * reason in the hub's words. The site's own capabilities are read from its report.
   */
  admitted(host: Pick<HostSnapshot, 'contract'>, ready: Pick<ReadyTarget, 'bootstrap' | 'page'>, id: string, action: AdmissionAction | null): FlagState {
    return admittedOn(this.ports.features, id, action, ready.bootstrap, ready.page, host.contract.capabilities);
  }

  /**
   * An owner switch on the page of the open chat: the page's own feature and the capabilities it needs
   * (domain/ops/flags.ts). Before the chat is ready the answer is «not usable» with the reason of the wait.
   */
  flagState(flag: ClientFeatureFlag): FlagState {
    const situation = this.situation();
    if (situation.pageOff !== null) return { usable: false, reason: situation.pageOff.why };
    const ready = situation.ready;
    return ready === null ? { usable: false, reason: 'hub_not_ready' } : flagStateOf(ready.bootstrap, ready.page.pageId, flag);
  }

  /** Whether an owner switch is usable on the open chat's page. */
  flag(flag: ClientFeatureFlag): boolean {
    return this.flagState(flag).usable;
  }

  /**
   * An owner switch for a host account of this tab — what our navigation asks before it goes into the account
   * (opening a chat marks it read on OnlyFans, so the answer is never a guess). Read once the account's binding
   * is: the feature of the hub page the account is bound to. Only an account the hub DEFINITELY binds to no
   * page (`CG-BINDING-MISSING`) has no page row to ask, and only there the owner's `"*"` value decides — so does
   * `null`, no account on screen. Everything in between fails closed, `false`: the binding is ambiguous, could
   * not be read (the hub or the background did not answer, the data is not ready), or ChatSpace has not listed
   * the account yet — its page may well say «off». So does a sign-in whose switches are not in hand: the
   * bootstrap is not read yet, is being read again after the port was down, or could not be read — the page may
   * say «off», and what was known before an outage is not what it says now. null — unknown — is left for the
   * one case that needs no hub: nobody is signed in (ChatSpace's own list goes on, §6.9).
   */
  async accountFlag(hostAccountId: string | null, flag: ClientFeatureFlag): Promise<boolean | null> {
    if (this.env.bootstrap.s !== 'ready') return this.env.session === null ? null : false;
    if (hostAccountId === null) return starFlag(this.env.bootstrap.value, flag);
    const account = this.ports.host.current().accounts.find((candidate) => candidate.hostAccountId === hostAccountId) ?? null;
    if (account === null) return false;
    const binding = await this.env.bindingRead(account);
    // The bootstrap may have been read again (or lost with the sign-in) while the binding was.
    const bootstrap = this.env.bootstrap;
    if (bootstrap.s !== 'ready' || binding.s === 'idle') return this.env.session === null ? null : false;
    if (binding.s === 'ready') return flagUsable(bootstrap.value, binding.value.pageId, flag);
    return binding.s === 'error' && binding.error.code === 'CG-BINDING-MISSING' ? starFlag(bootstrap.value, flag) : false;
  }

  /** Why every AI action of the open chat is off, in the words of a tooltip; null — actions are decided one by one. */
  offReason(situation: Situation = this.situation()): ReasonVM | null {
    if (situation.off === null) return null;
    return situation.pageOff?.reason ?? this.ports.catalog.reason(situation.off);
  }

  /** The error of a chat that is not `ready`: its status' own, the page being switched off, or «чат ещё грузится». */
  blockedError(situation: Situation = this.situation()): CgErrorWire {
    return situation.statusError ?? situation.pageOff?.error ?? { code: 'CG-GATE-CHAT-LOADING' };
  }

  // ── per-chat UI state ────────────────────────────────────────────────────

  private ui(key: ChatKey): ChatUi {
    let ui = this.chats.get(key);
    if (ui === undefined) {
      ui = { tone: null, sheet: null, pageId: null };
      this.chats.set(key, ui);
      // A sheet left open in a chat visited long ago is not kept for ever: the oldest go.
      while (this.chats.size > CHAT_UI_MAX) {
        const oldest = this.chats.keys().next().value;
        if (oldest === undefined || oldest === key) break;
        this.chats.delete(oldest);
      }
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
    const ui = this.ui(key);
    ui.sheet = sheet;
    const situation = this.situation();
    if (situation.chat?.key === key && situation.ready !== null) ui.pageId = situation.ready.page.pageId;
    this.bump();
  }

  /** A start that was not admitted takes the chat's sheet, whichever controller asked (ui-design §4.9). */
  showRefusal(key: ChatKey, refusal: RefusalState): void {
    this.setSheet(key, { kind: 'refusal', refusal: { ...refusal, at: this.ports.clock.now() } });
  }

  /**
   * A start that failed before any admission is said where the person looks —
   * the chat's sheet, with its code (§9.5 «каждый отказ виден»): a click or a
   * key that did nothing must never look like a dock that is ready. Only a
   * click that was for a chat the person has already left stays quiet.
   */
  startFailed(key: ChatKey, feature: FeatureId, error: CgErrorWire, retry?: UiAction): void {
    if (error.code === 'CG-CONTEXT-CHANGED') return;
    this.showRefusal(key, { feature, error, running: [], ...(retry === undefined ? {} : { retry }) });
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

  /** The site's deep-window preference, or the v1 window when the port is absent or fails. */
  async windows(): Promise<SettingsExt['windows'] | undefined> {
    try {
      return (await this.ports.policy.windows?.()) ?? undefined;
    } catch {
      // No preference: the planner uses the v1 window.
    }
  }

  /**
   * Starts a feature in the open chat: the gates, the draft and the site's
   * proof (on ChatSpace the fresh tail it may carry), the token, the plan,
   * the admission. Nothing is spent on a refusal; what was typed stays with
   * the person.
   */
  async startFeature(request: StartRequest): Promise<StartResult> {
    const situation = this.situation();
    const { chat, ready } = situation;
    if (chat === null || chat.identity === null) return failed('CG-GATE-CHAT-LOADING');
    if (ready === null) return { kind: 'failed', error: this.blockedError(situation) };
    const { bootstrap, settings } = ready;
    const { feature, surface } = request;
    const rule = policyOf(feature);
    if (situation.quotaZero) return failed('CG-QUOTA-DAILY', situation.quota === null ? {} : { retryAt: Date.parse(situation.quota.resetsAt) });
    // What the feature needs on this page to be generated; the hub's reason picks the code and goes into the technical line.
    const admitted = this.admitted(situation.host, ready, rule.dockAction, 'generate');
    if (!admitted.usable) return { kind: 'failed', error: flagRefusal(admitted) };

    const original = request.regenerateOf;
    const source = original?.memo.fixSource ?? null;
    const composer = situation.host.composer;
    const { host, policy } = this.ports;
    const facts: GateFacts = {
      window: situation.window,
      // Fix again rewrites the same source, whatever the field holds now.
      draftEmpty: source !== null ? false : composer === null ? null : composer.draft.provenance === 'empty',
    };
    const gate = featureGate(feature, facts, policy);
    if (gate !== null) return failed(gate.code);
    // The recap step of a composite Coach turn is asked for only when the conversation allows one (AI-051
    // «мало истории»): its gate never costs the person the question. Its owner switch is the caller's and
    // the background's to check.
    let autoRecap = feature === 'coach' ? request.autoRecap : undefined;
    if (autoRecap !== undefined && featureGate(autoRecap === 'full' ? 'recap' : 'recap-short', { window: situation.window, draftEmpty: null }, policy) !== null) autoRecap = undefined;

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
    const limits = freshTextLimits(feature, surface, bootstrap, freshTextAdmitted(this.ports.features, bootstrap, ready.page.pageId));
    // The person's deep window kept by the site, asked only by a start of the deep window (R20 §12).
    const extended = rule.window === 'deep' || autoRecap === 'full' ? await this.windows() : undefined;
    // The site's proof of the open chat (R20 F10): on ChatSpace the visible tail, read only when the start may carry
    // fresh text. A proof that fails is no proof: the start goes on without one.
    let proof: unknown = null;
    try {
      proof = await policy.proof(host, {
        feature,
        surface,
        identity: chat.identity,
        fresh: limits,
        // X54: the open chat's PPV state rides where fresh text does, to a hub that takes it.
        // (A plain read of the list: the hub contracts' helpers would carry their module into this layer.)
        livePpv: limits !== null && bootstrap.capabilities.includes('live-ppv-v1'),
        messageCount: windowFor(feature, request.options.window, settings, bootstrap, extended),
      });
    } catch {
      // A missing or rejected proof leaves the start unverified.
    }
    // The site's pre-check once more, now with the proof: a site whose rule needs it refuses here, before the token.
    const late = featureGate(feature, { ...facts, proof }, policy);
    if (late !== null) return failed(late.code);
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
      settings,
      bootstrap,
      tone: original !== undefined ? toneForRegenerate(original.view) : this.tone(chat.key),
      draft,
      fields: policy.fields(proof),
      freshText: limits !== null,
      coachHistory: request.coachHistory,
      autoRecap,
      extendedWindows: extended,
      regenerateOf: original?.view.opId,
      splitWanted: original?.memo.split,
      force: request.force === true,
    });
    if (!plan.ok) return failed(plan.code);

    const outcome = await this.ops.start(plan.start, {
      fixSource: plan.start.draft !== undefined && feature === 'fix' ? plan.start.draft : null,
      personaDefinitionId: ready.persona.definitionId,
      fingerprint: policy.fingerprint(proof),
    });
    switch (outcome.kind) {
      case 'error':
        return { kind: 'failed', error: outcome.error };
      case 'refused':
        return { kind: 'refused', refusal: { feature, error: { code: outcome.admission.code }, running: [...outcome.admission.active, ...(outcome.admission.siteActive ?? [])].sort((a, b) => a.startedAt - b.startedAt) } };
      case 'started': {
        // The tone went with this request: it stays for the chat (X45, «Помнить тон в чате»), or is gone (Б1).
        if (rule.tone) this.ui(chat.key).tone = toneAfterStart(plan.start.tone, remembersTone(settings));
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
        // X45: with the hub silent the result already made is checked against the binding last read in this sign-in.
        bindingRevision: (this.env.page(pageId) ?? this.env.pageWhileHubSilent(pageId))?.bindingRevision ?? null,
        personaDefinitionId: persona.definitionId,
      },
      blocked: sameChat ? situation.copyOnly : null,
      editorObserved: situation.host.contract.capabilities.draftRead.state === 'on',
      fanScript: () => this.fanScript(chatKeyOf(record.view.target.chat)),
    };
  }

  // ── a board's result in the dock (§6.5) ──────────────────────────────────

  /** The boards' side of the results the dock shows, once the boards are loaded (the tab's composition root binds it). */
  bindBoards(boards: BoardResults | null): void {
    this.offBoards?.();
    this.boards = boards;
    this.offBoards =
      boards?.subscribe(() => {
        if (this.boardOps.size > 0) this.bump();
      }) ?? null;
  }

  /**
   * §6.5: «Открыть и вставить» opened the chat of a board's result — from now on the rest of that result is
   * worked with here, in the chat's dock: the part that went into the composer reads «вставлено», the others
   * are inserted one click each under the dock's own rules (§6.4), and where the composer held the person's own
   * text the Б2 question about the part stands in the dock (п. 4). Nothing is written here.
   *
   * false — the dock did not take it: the person is already in another chat, the result is not known to this
   * tab or not of a persona it can vouch for, or the question could not be asked.
   */
  async adoptBoardResult(handover: BoardHandover): Promise<boolean> {
    const key = chatKeyOf(handover.chat);
    const here = (): boolean => this.situation().chat?.key === key;
    const persona = handover.personaDefinitionId;
    if (persona === null || !this.env.session || !here()) return false;
    if (this.ops.get(handover.opId) === null) await this.ops.syncChat(key);
    const record = here() ? this.ops.vouch(handover.opId, key, persona, handover.split) : null;
    if (record === null) return false;
    this.boardOps.add(handover.opId);
    if (handover.outcome === 'inserted') this.inserts.noteInserted(record, handover.part);
    this.setSheet(key, { kind: 'draft', opId: handover.opId });
    return handover.outcome === 'inserted' || (await this.askAboutBoardPart(handover.opId, handover.part, here));
  }

  /**
   * §6.5 п. 4: the Б2 question about a board's part, in the dock of the chat the board opened. The board's
   * navigation ends the moment ChatSpace shows the chat; the dock's own reading of that chat's field may be a step
   * behind, and a dock that does not see the field yet cannot ask. So it is asked again until it can be — for a
   * few seconds, while this is still the open chat and the dock still holds the result. Only ever a question:
   * nothing is written here. false — it could not be asked (the composition says it as a toast instead).
   */
  private async askAboutBoardPart(opId: string, part: PartRef, here: () => boolean): Promise<boolean> {
    const { clock } = this.ports;
    const deadline = clock.now() + BOARD_QUESTION_WAIT_MS;
    for (;;) {
      const outcome = await this.inserts.askAbout(opId, part);
      // Asked; or the field needs no question any more; or the person's own click on this result is at work.
      if (outcome.kind !== 'failed') return true;
      if (!FIELD_NOT_SEEN_YET.includes(outcome.error.code) || clock.now() + BOARD_QUESTION_STEP_MS > deadline) return false;
      await new Promise<void>((resolve) => {
        const timer = clock.setTimer(BOARD_QUESTION_STEP_MS, () => {
          this.timers.delete(timer);
          resolve();
        });
        this.timers.add(timer);
      });
      if (this.disposed || !here() || !this.boardOps.has(opId)) return false;
    }
  }

  /** A result a board made and the dock shows (§6.5). */
  isBoardResult(opId: string): boolean {
    return this.boardOps.has(opId);
  }

  /** What the board says of a part of such a result; null — not a board's result, or the board no longer holds it. */
  boardPart(opId: string, part: PartRef): BoardPartFacts | null {
    return this.boardOps.has(opId) ? (this.boards?.part(opId, part) ?? null) : null;
  }

  /**
   * Whether an action on an operation is the dock's to take: an operation of the open chat's own surfaces, or a
   * board's result the dock shows — unless a card shows that result right now: its buttons are the card's then.
   */
  answersFor(record: OpRecord): boolean {
    return isOwnSurface(record.view.surface) || (this.boardOps.has(record.view.opId) && this.boards?.showing(record.view.opId) !== true);
  }

  private boardHold(record: OpRecord, part: PartRef): PartBlock | null {
    if (!this.boardOps.has(record.view.opId)) return null;
    const facts = this.boards?.part(record.view.opId, part) ?? null;
    // The board no longer holds the result (it aged out there, or the boards are not bound): which parts were sent
    // and what holds the fan is not known any more. Such a part is never «insertable as if nothing were known» —
    // it says it is out of date; copying is still there.
    if (facts === null) return STALE_BOARD_PART;
    // A delivered part is never put into a composer again (ui-design §3.2); a held fan says why.
    if (facts.sentAt !== null) return { reason: 'send-unavailable', code: 'CG-SEND-PART' };
    return facts.hold === null ? null : { reason: facts.hold.id, code: facts.hold.code ?? 'CG-SEND-BUSY', view: facts.hold };
  }

  /**
   * The same at the person's click in the dock — «Вставить» of a board's part, or an answer to its Б2 question:
   * the journal of the fan's sends is read first, as the board's own «Открыть и вставить» reads it (§6.7.8). What
   * `boardHold` answers between clicks is what this tab last heard; an uncertain send another tab began since
   * the hand-over holds the fan from this read on. A journal that does not answer is not «nothing holds it».
   */
  private async boardHoldNow(record: OpRecord, part: PartRef): Promise<PartBlock | null> {
    const opId = record.view.opId;
    if (!this.boardOps.has(opId)) return null;
    const read = this.boards === null ? 'gone' : await this.boards.sync(opId);
    if (read === 'unread') return { reason: 'runtime-unreachable', code: 'CG-RUNTIME-UNREACHABLE' };
    return this.boardHold(record, part);
  }

  // ── the page tail (the archive lag, the language gate) ───────────────────

  /**
   * The visible tail of the open chat, read from page memory only when a
   * view needs it (the archive lag, the language of the fan) and again after
   * the chat's cache changed. Never sent anywhere from here, and kept only
   * while that chat is open (it is text of the conversation).
   */
  pageTail(key: ChatKey): LiveTextTail | null {
    const chat = this.situation().chat;
    // Only the open chat has a page to read; nothing is kept for any other.
    if (chat === null || chat.key !== key) return null;
    let entry = this.tails.get(key);
    if (entry === undefined) {
      entry = { tail: null, dirty: true, reading: false, known: false, script: null };
      this.tails.set(key, entry);
    }
    if (entry.dirty && !entry.reading && chat.identity !== null) {
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
          slot.script = null;
          this.bump();
        });
    }
    return entry.tail;
  }

  /**
   * The script the fan writes in, told from the page tail once per read of it — or, where the host keeps the open
   * chat's window itself, as that window says it (Fansly: MAIN's `fanScript`, R20 §7.7; no copy of a text in the tab).
   */
  fanScript(key: ChatKey): FanScript {
    const { chat, window } = this.situation();
    if (chat !== null && chat.key === key && window?.fanScript !== undefined) return window.fanScript;
    const tail = this.pageTail(key);
    const entry = this.tails.get(key);
    if (entry === undefined) return fanScriptOf(tail);
    entry.script ??= fanScriptOf(tail);
    return entry.script;
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
    const { fanRef, conversationRef } = ready.target;
    // R20 F6b: the conversation goes into the key, and into the hub's recap reads, only when it is not the fan.
    return { hubOrigin: ready.target.binding.hubOrigin, pageId: ready.page.pageId, fanRef, ...(conversationRef === fanRef ? {} : { conversationRef }), personaDefinitionId: ready.persona.definitionId };
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

  /** Whether a handle names something these controllers hold now: a part or a Review of their own operation, a recap copy. */
  holds(handle: string): boolean {
    const artifact = readArtifactHandle(handle);
    if (artifact === null) return false;
    if (artifact.kind === 'recap') return this.recaps.slots.byLocalId(artifact.localId) !== null;
    const record = this.ops.get(artifact.opId);
    return record !== null && this.answersFor(record);
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
    if (this.boardOps.has(origin.opId)) this.boards?.manualSent?.(origin.opId, origin.part, platformMessageId);
    this.reportSent({ opId: origin.opId, part: origin.part, pendingId: fact.pendingId, platformMessageId, edited: draft.editedSinceInsert });
  }

  /**
   * Says a human send to the background until it is heard: acknowledged, or refused in the background's own
   * words. Only «nobody answered» (the port was lost under the request) is said again, when the port is back, a
   * bounded number of times; the background takes a repeat as the same fact (the registration is keyed by the
   * operation, the part and the message's id). A report of what already happened — it never sends anything.
   */
  private reportSent(report: SentReport, tries = 1): void {
    void this.ports.rpc.request('op.reportSent', report).then((answer) => {
      if (this.disposed || answer.ok || answer.error.code !== 'CG-RUNTIME-UNREACHABLE' || tries >= SENT_REPORT_TRIES) return;
      this.unsaidSends.push({ report, tries: tries + 1 });
      if (this.unsaidSends.length > SENT_REPORTS_KEPT) this.unsaidSends.shift();
      // The port is already back (the request itself outlived a reconnect): no state change will come.
      if (this.env.connection === 'ready') this.flushSentReports();
    });
  }

  private flushSentReports(): void {
    for (const { report, tries } of this.unsaidSends.splice(0)) this.reportSent(report, tries);
  }

  // ── reactions ────────────────────────────────────────────────────────────

  private routeChanged(): void {
    const route = this.ports.host.current().route;
    const key = route.name === 'chat' && route.chat !== null ? chatKeyOf(route.chat) : null;
    // The page tail is kept for the open chat only: a chat that was left is read again when it is opened.
    for (const other of [...this.tails.keys()]) if (other !== key) this.tails.delete(other);
    const remember = remembersTone(this.env.settings?.settings);
    for (const [other, ui] of this.chats) {
      if (other === key) continue;
      // A tone kept in the chat lasts until the chat switches, as in the desktop (X45); a one-off one waits for its Reply.
      ui.tone = toneOnLeave(ui.tone, remember);
      // A start that failed before admission names no run that could end it: its card stays only while the
      // person stays in the chat.
      if (ui.sheet !== null && ui.sheet.kind === 'refusal' && ui.sheet.refusal.running.length === 0) ui.sheet = null;
      // A chat without a chosen tone or an open sheet keeps nothing.
      if (ui.tone === null && ui.sheet === null) this.chats.delete(other);
    }
    if (key !== null) {
      const tail = this.tails.get(key);
      if (tail !== undefined) tail.dirty = true;
      // What the background knows about this chat: a result of the last half hour, a run of another tab.
      // Asked once per visit, and only once somebody is signed in.
      if (key !== this.syncedChat && this.env.session) {
        this.syncedChat = key;
        void this.ops.syncChat(key);
        // A new visit may ask again what failed before (never by itself while the person stays).
        this.recaps.retryFailedStatuses();
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
      // «Идут сейчас» is about what ran then: once one of them ended the person may simply click again.
      for (const ui of this.chats.values()) {
        if (ui.sheet !== null && ui.sheet.kind === 'refusal' && ui.sheet.refusal.running.some((running) => running.opId === view.opId)) ui.sheet = null;
      }
      const wire = view.error;
      if (wire?.retryAt !== undefined) this.wakeAt(wire.retryAt);
      // A finished recap is the shared artifact now: the slot holds its copy whichever surface asked for it.
      if (view.state === 'done') this.recaps.generated(event.record);
    }
    for (const listener of [...this.opListeners]) listener(event);
    this.bump();
  }

  private onEnvironment(change: EnvironmentChange): void {
    if (change === 'connection') {
      const state = this.env.connection;
      if (state === 'ready') this.flushSentReports();
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
          this.tails.clear();
          this.copies.clear();
          this.shown.clear();
          this.expanded.clear();
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
      const followed: PersonaFollow[] = [];
      for (const pageId of new Set([...Object.keys(before), ...Object.keys(next)])) {
        const a = before[pageId];
        const b = next[pageId];
        if (a === undefined || (b !== undefined && a.key === b.key && a.definitionId === b.definitionId)) continue;
        // The owner edited the persona: its key stays, the choice followed its new definition — the same persona.
        if (b !== undefined && a.key === b.key) followed.push({ pageId: Number(pageId), from: a.definitionId, to: b.definitionId });
        else changed.add(Number(pageId));
      }
      if (followed.length > 0) {
        this.ops.followPersona(followed);
        for (const listener of [...this.followListeners]) listener(followed);
      }
      if (changed.size > 0) {
        // AI-126: a persona change drops the results and the Coach dialogs of that page.
        this.forget(this.ops.drop((record) => changed.has(record.view.target.binding.pageId) && isTerminalOpState(record.view.state)));
        // A Recap or Review sheet of that page showed the old persona's: it closes (a page not known then — to be safe, too).
        for (const ui of this.chats.values()) {
          if (ui.sheet !== null && ui.sheet.kind !== 'draft' && (ui.pageId === null || changed.has(ui.pageId))) ui.sheet = null;
        }
        this.reset((_key, pageId) => changed.has(pageId));
      }
    }
    this.bump();
  }

  /** Operations that left the store: every per-operation state the tab kept for them goes too. */
  private forget(opIds: readonly string[]): void {
    for (const opId of opIds) {
      this.inserts.dropOp(opId);
      this.boardOps.delete(opId);
      this.expanded.delete(opId);
      this.shown.delete(opId);
      for (const handle of [...this.copies.keys()]) if (readArtifactHandle(handle)?.kind !== 'recap' && handle.includes(opId)) this.copies.delete(handle);
      for (const ui of this.chats.values()) if (ui.sheet !== null && ui.sheet.kind === 'draft' && ui.sheet.opId === opId) ui.sheet = null;
    }
  }

  private reset(affected: (chatKey: ChatKey, pageId: number) => boolean): void {
    for (const listener of [...this.resetListeners]) listener(affected);
  }
}
