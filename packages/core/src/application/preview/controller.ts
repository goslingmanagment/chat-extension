// A fan's preview without opening the chat (architecture.md §6.5, §6.7, §7
// «Превью и «Новые»», §10.2 PreviewVM; SP-050…SP-056, AI-038, NEW-10,
// CS-030, DB-026). The feed is the hub archive only — opening a chat marks it
// read on OnlyFans, so nothing is read from ChatSpace and the chat stays
// unread. Generation runs on the hub's context (surface `preview` or
// `newcomers`, no fresh page text) with the freshness checkpoint taken at the
// Generate click. A result leaves the preview in two ways, each on a human
// click of one part: «Отправить» through the R10 send coordinator, and
// «Открыть и вставить» — one navigation with one deferred insert that has a
// deadline and can be canceled. Nothing is sent, inserted or repeated by
// itself; an unknown outcome offers only «Открыть чат для проверки».
//
// What holds a send holds the FAN, not one result (§6.7.8, §6.7.9): while a
// part to the fan is on its way, no feature generates for the fan, «Ещё раз»
// is off and no part is offered for «Открыть и вставить» — whichever result
// is on the card, and after a tab reload too (the background's journal is
// read back with `send.list`). An unknown outcome holds nothing (2026-10-20
// audit, row 2): the person checks the chat and may send again by a click.
//
// «Открыть и вставить» closes the board and opens the fan's chat. From then
// on the rest of the result is worked with in that chat's dock (§6.5): the
// result is handed over (`handover`) and this controller keeps saying what
// it knows of its parts (`results`) — which are delivered, what holds the
// fan — for as long as it keeps the result. The dock inserts under its own
// rules; nothing is inserted or sent from here by that.

import { type CgCode, type CgErrorWire, type I18nKey } from '@cg/contracts/errors';
import { TONES, type FeatureId, type Surface, type Tone } from '@cg/contracts/features';
import { type HostEvent, type HostPort, type NavigationReceipt } from '@cg/contracts/host';
import { type SpenderDetail } from '@cg/contracts/hub';
import { CHAT_IS_FAN, chatKeyOf, type ChatRef, type PartRef, type Platform, type Target } from '@cg/contracts/ids';
import { MEDIA_LIMITS, OP_LIMITS, SEND_LIMITS, STORAGE_LIMITS } from '@cg/contracts/limits';
import { type OpView, type StartOp } from '@cg/contracts/ops';
import { type FreshnessCheckpoint, type PreviewSendPreflight, type PreviewSendRequest, type SendAttemptView, type SendGroup } from '@cg/contracts/send';
import { type SendListItem, type TabEventPayload } from '@cg/contracts/tab-messages';
import {
  type ActionReceipt,
  type DockActionVM,
  type FeedItemVM,
  type I18n,
  type NewcomerRowSendVM,
  type PartialGap,
  type PreviewActionId,
  type PreviewSendView,
  type PreviewSource,
  type PreviewVM,
  type ReasonVM,
  type RunningOpVM,
  SEND_REASON_KEYS,
  type TargetHandle,
  type UiAction,
  type UiActionType,
  type UserOptions,
  type VmView,
  OUTREACH_MEDIA_HANDLE,
  type MediaPickerVM,
  type OutreachMediaVM,
} from '@cg/contracts/vm';
import { type MediaFanState } from '@cg/contracts/media';

import { MIN_MESSAGES_FOR_PING } from '../../domain/features/policy';
import { DeferredInsertSlot, type DeferredOutcome } from '../../domain/insert/deferred';
import { buildDeferredInsert, buildOpenAndInsert } from '../../domain/insert/intent';
import { EMPTY_DRAFTS, changedDraftKeys, draftKey, draftUserPrefix, findDraft, keepOnly, mergeDraftStores, putDraft, readDraftStore, removeDraft, sameDraftStore, type DraftStore } from '../../domain/newcomers/drafts';
import { greetingOutputProblem } from '../../domain/newcomers/greeting';
import { digestHex } from '../../domain/ops/digest';
import { applyOpDone, applyOpUpdate, mirrorFromView, newMirror, type OpMirror } from '../../domain/ops/mirror';
import { messageWindowFor } from '../../domain/ops/request';
import { isTerminalOpState } from '../../domain/ops/states';
import { previewSendWaitsForChat } from '../../domain/host';
import { attemptReachable } from '../../domain/send/attempt';
import { servedContextHold } from '../../domain/send/freshness';
import { archiveLag, feedRows, firstFeedPage, keepFeed, olderFeedPage, type FeedState, type KeptFeed } from '../../domain/spenders/feed';
import { type BoardHandover, type BoardPartFacts, type BoardResults, type BoardSync } from '../board-handover';
import { type PageContextPort, type PageContextState, flagFailure, pageFlag, pageFlagOf } from '../boards/context';
import { fanHandle, parseFanHandle, parsePartHandle } from '../boards/handles';
import { flagReasonVm } from '../flag-reason';
import { boardOpenRefusal, issueCause, type BoardSwitch, type ChatNavigator } from '../boards/navigate';
import { noteBatchOp, type BatchOutcome, type BatchSendState, type OutreachCardRow } from '../boards/batch';
import { type BoardsClock, type BoardsNotifier, type ClipboardWriter, type DraftStorePort, type IdSource, type PreviewSendClick, type PreviewSender, type TabRpc } from '../boards/ports';
import { type GreetingDesk, type PreviewDirectory, type PreviewTargetInfo, type Surfaces } from '../boards/shared';
import { ViewCell, done, refused, type SurfaceController } from '../boards/surface';
import { button, dataView, errorOf, failureClass, failureView, loadingView, localError, msg, reason, reasonCode, stamp, type BoardReasonId } from '../boards/views';
import { EMPTY_ATTACHMENT, attachmentProblem, parsePrice, type Attachment } from '../../domain/media/attachment';
import { MediaDesk, OUTREACH_PICKER_FAN, PRICE_PROBLEM_KEYS } from './media';
import { SeenDesk, hostChatReadPort, type ChatReadPort } from './seen';
import { partsOfResult, previewResult, type PartRows } from './result';
import { clickable, fanAttempts, fanSendsOf, inFlight, openInsertRow, partKey, partOrder, progressOf, refusal, sendRow, type FanSendFact, type FanSends, type PartAttempt } from './send-rows';

/** Rows of one feed page (the hub's default; never above `limits.feedMax`). */
export const FEED_PAGE_SIZE = 50;
/** How long «✓» stays on a copy button. */
export const COPY_MARK_MS = 2000;
/** Results the tab keeps track of (the background keeps their texts, §9.4). */
const TRACKS_MAX = STORAGE_LIMITS.resultsPerTab;
/** A syntactically valid stand-in for the cause of a display-only preflight: MAIN never receives a token (§14). */
const DISPLAY_CAUSE = { kind: 'click', actionToken: 'preflight-display-only' } as const;
/** Past the insert's own deadline, for the host's answer to arrive first. */
const DEFERRED_GRACE_MS = 1500;
/** After the port came back: how long until the background's list of operations is asked once more when it did not answer. */
export const RESYNC_RETRY_MS = 2_000;
/**
 * How long a part stays off after the hub's `preview_send_rate_limited`. The
 * hub counts sends per minute (`limits.previewSendPerMinute`) and an attempt
 * view carries no deadline of its own, so the hold is one such minute.
 */
export const RATE_LIMIT_HOLD_MS = 60_000;
/**
 * After a click of «Отправить» on a card or a row, every other one of the tab is off this long: the drafts of a batch
 * never go to the fans in one burst of clicks (the owner, 2026-10-24: half a second is enough for ChatSpace).
 */
export const SEND_PACE_MS = 500;

const SOURCES = ['spenders', 'newcomers', 'palette', 'outreach', 'online'] as const satisfies readonly PreviewSource[];
/** «Рассылка» and «Онлайн»: their windows write and send each fan's one message; the card has no Generate of its own. */
const WINDOW_SOURCES: readonly PreviewSource[] = ['outreach', 'online'];
const fromWindow = (source: PreviewSource): boolean => WINDOW_SOURCES.includes(source);
const DRAFT_FEATURES = ['reply', 'fix', 'hi', 'ping'] as const satisfies readonly PreviewActionId[];
const ONLINE_FEATURES = ['reply', 'fix', 'hi', 'ping'] as const satisfies readonly PreviewActionId[];
const CLOSE_PREVIEW: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } };
/** The fan's name as the list shows it, when it is a name and not the bare id. */
function fanLabelOf(info: PreviewTargetInfo): string | null {
  const name = info.name.trim();
  return name === '' || name === info.fanRef ? null : name.slice(0, 256);
}

/** The words in the empty draft field: a Fix source in a preview, the greeting's own draft on a «Новые» card (NF-012). */
const draftPlaceholder = (source: PreviewSource): I18nKey => (source === 'newcomers' ? 'newcomers.greetingDraft.placeholder' : 'preview.draft.placeholder');

interface OpTrack {
  readonly opId: string;
  readonly handle: TargetHandle;
  readonly source: PreviewSource;
  readonly pageId: number;
  readonly fanRef: string;
  readonly feature: FeatureId;
  readonly surface: Surface;
  target: Target;
  mirror: OpMirror;
  /** The highest batch number seen, for resyncing a mirror after a gap. */
  lastSeq: number;
  readonly startedAt: number;
  /** The freshness checkpoint of the Generate click; null — MAIN gave none: the result can be inserted, never sent. */
  readonly checkpoint: FreshnessCheckpoint | null;
  /** Revision of the local draft at Generate; a Fix whose draft moved on says so, and its send keeps the new draft. */
  readonly previewRevision: number;
  readonly fixSource: string | null;
  toneUsed: Tone | null;
  splitRequested: boolean;
  /** Follows the page's choice when the owner edits the persona (its key stays): the same persona. */
  personaDefinitionId: string | null;
  hidden: boolean;
  expanded: boolean;
  cachedAt: number | null;
  readonly attempts: Map<string, PartAttempt>;
  /** Parts whose click is with the coordinator and has no attempt id yet. */
  readonly clicked: Set<string>;
  readonly copy: Map<string, 'done' | 'failed'>;
  /** MAIN's side-effect-free answer for the button; null — not asked yet. */
  preflight: PreviewSendPreflight | null;
  preflightRun: number;
  /** This tab saw a fan message after the checkpoint. */
  fanWrote: boolean;
  fanWroteAt: string | null;
  /** «Открыть и вставить» in flight: the part and its deadline. */
  openInsert: { readonly key: string; readonly until: number } | null;
  /** Timers that lift a hub rate-limit hold, by part. */
  readonly holdTimers: Map<string, number>;
  /** Parts the person edited (audit 2026-10-20, row 1), by part key: the text that goes, and its revision (the hub's `textRevision`). */
  readonly edits: Map<string, { readonly text: string; readonly revision: number }>;
  /** The person's own text from the draft field, not a generation: the hub's manual group (row 1). */
  readonly manual: { readonly textFingerprint: string } | null;
  /** Chat Memory week 1: «Отправить всё равно» passed the «в разговоре» warning of this fan, for this result. */
  talkAccepted?: true;
  /**
   * The text this result took out of the draft field at its click (2026-10-23 audit): it goes back to the field (when
   * the field is still empty) once the send is refused for sure; null once given back, or once it may have gone.
   */
  fromDraft: string | null;
}

interface TargetState {
  readonly handle: TargetHandle;
  readonly source: PreviewSource;
  readonly pageId: number;
  readonly fanRef: string;
  info: PreviewTargetInfo;
  feed: FeedState | null;
  /**
   * R20 F6b: the conversation the feed's walk reads (the list's, when it is not the fan); its older pages keep it.
   * null — no conversation of the fan is known (R20 P8a): no page is read.
   */
  feedConversation: { readonly conversationRef?: string } | null;
  feedLoading: boolean;
  feedError: CgErrorWire | null;
  feedRun: number;
  feedSince: number | null;
  feedLoadedAt: number | null;
  olderLoading: boolean;
  olderError: CgErrorWire | null;
  /** `fan.card` over 30 days: the header's money and the page subscription (X8 condition 9). */
  card: SpenderDetail | null;
  cardRun: number;
  tone: Tone | null;
  /** Polling the archive while a held send waits for the fan's new message to reach it (§6.7.5). */
  poll: { timer: number; readonly until: number; readonly head: string | null } | null;
  rows: { readonly feed: FeedState; readonly language: string; readonly items: FeedItemVM[] } | null;
}

interface PendingInsert {
  readonly navigationId: string;
  readonly track: OpTrack;
  readonly key: string;
  readonly abort: AbortFlag;
  timer: number | null;
  /** The person's words go in (an edited part, their own text), not the AI's: no dock takes them over. */
  readonly own: boolean;
}

/** The part of AbortSignal HostPort.navigate uses (contracts carry no DOM types). */
class AbortFlag {
  aborted = false;
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: 'abort', listener: () => void): void {
    if (this.aborted) listener();
    else this.listeners.add(listener);
  }

  removeEventListener(_type: 'abort', listener: () => void): void {
    this.listeners.delete(listener);
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    for (const listener of [...this.listeners]) listener();
    this.listeners.clear();
  }
}

/**
 * R20 P8a (FS-IDN-6): the conversation a preview works on — the one its list named (on Fansly the group the list
 * resolved for the fan; never the route of the chat on screen) or, where a chat is its fan (OnlyFans), the fan. null —
 * the list knows no conversation of the fan on a platform where a chat has an id of its own (or the binding, and so
 * the platform, is not known yet): nothing of that chat is asked, and never by the fan's id in its place.
 */
function conversationOfTarget(info: PreviewTargetInfo, platform: Platform | null): string | null {
  if (info.conversationRef !== undefined) return info.conversationRef;
  return platform !== null && CHAT_IS_FAN[platform] ? info.fanRef : null;
}

/** What a read of the preview names (R20 F6b): `{}` — the conversation is the fan (ChatSpace); null — none is known (P8a). */
function feedConversationOf(info: PreviewTargetInfo, platform: Platform | null): { readonly conversationRef?: string } | null {
  const conversation = conversationOfTarget(info, platform);
  return conversation === null ? null : conversation === info.fanRef ? {} : { conversationRef: conversation };
}

export interface PreviewControllerDeps {
  readonly previewSend?: boolean;
  readonly rpc: TabRpc;
  readonly host: HostPort;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly ids: IdSource;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
  readonly navigator: ChatNavigator;
  /** Who a handle is, per list. */
  readonly directories: Readonly<Record<PreviewSource, PreviewDirectory | null>>;
  /** «Новые»: the greeting lease and status of the fan on the card. */
  readonly greeting: GreetingDesk | null;
  /** The tab side of the R10 send coordinator; null — no send in this build. */
  readonly sender: PreviewSender | null;
  readonly drafts: DraftStorePort | null;
  readonly clipboard: ClipboardWriter | null;
  readonly notifier: BoardsNotifier | null;
  /** §6.5: «Открыть и вставить» opened the chat — the result goes on in that chat's dock. Absent — no dock takes it. */
  readonly handover?: ((handover: BoardHandover) => void) | null;
  /**
   * sha256 of a text's UTF-8 bytes, lower-case hex: the hub's key of the person's own text (a manual group, audit
   * 2026-10-20, row 1). Absent — the draft field sends nothing.
   */
  readonly sha256?: (text: string) => Promise<string>;
  /**
   * Whether the fan read our newest message, read live from the site (Fansly's, by its background); absent — the
   * host's own chat list where it has one (ChatSpace), null — none.
   */
  readonly readState?: ChatReadPort | null;
  /**
   * Chat Memory week 1: «в разговоре» — another chatter's mark on a fan's chat (the tab's `talking` view): a send to
   * such a fan is a warning «Отправить всё равно» passes. Absent — no warning.
   */
  readonly talking?: { mark(chatKey: string): { readonly names: readonly string[]; readonly lastSentAt: string } | null; onChange(listener: () => void): () => void } | null;
}

/** 2026-10-29, «Hi» inside a greeting reminder's toast: `again` — another variant of the result there is; `single` — one part. */
export interface BatchStartOptions {
  readonly again?: boolean;
  readonly single?: boolean;
}

/** A ready result's next part as a greeting reminder's toast shows it (2026-10-29). */
export interface BatchNext {
  readonly opId: string;
  /** The next part not sent; null — every part went. */
  readonly part: number | null;
  /** That part's text (every part went: the first). */
  readonly text: string | null;
  /** How that part's send stands; null — every part went, or the card's send has nothing to say yet. */
  readonly send: PreviewSendView | null;
  /** An earlier part of it is still on its way: this one waits its turn. */
  readonly waits: boolean;
}

export interface PreviewController extends SurfaceController<'preview'> {
  /** The local drafts are read; resolves once (tests, a first paint that wants the draft). */
  ready(): Promise<void>;
  /** Whether a saved draft exists for a fan of a list, and the thread it was written on (the «Новые» rows). */
  draftOf(source: PreviewSource, pageId: number, fanRef: string): { readonly text: string; readonly threadRevision: string | null } | null;
  /** A draft was written, cleared or read from storage: the lists that show «есть черновик» follow. */
  onDrafts(listener: () => void): () => void;
  /** What this controller knows of the parts of the results it handed to the dock (§6.5). */
  readonly results: BoardResults;
  /**
   * 1.32.0: one fan of a list's batch — the preview's own Generate on the fan's card, open or not; resolves when the
   * generation ended (or did not start). The result stays on the fan's card, for the person's own «Отправить».
   */
  batchStart(source: 'spenders' | 'newcomers' | 'outreach' | 'online', handle: TargetHandle, feature: PreviewActionId, outreach?: { readonly draft: string }, opts?: BatchStartOptions): Promise<BatchOutcome>;
  /** The fan's result as the preview has it now: its first part, and whether it all went out; null — none. */
  batchLive(handle: TargetHandle): { readonly text: string | null; readonly sent: boolean } | null;
  /**
   * 2026-10-29, «Hi» inside a greeting reminder's toast: the fan's ready result as the toast shows it — its next part
   * not sent and how that part's send stands (`part` null — every part went); null — no ready result.
   */
  batchNext(handle: TargetHandle): BatchNext | null;
  /** A result a batch made moved on (it ended, a part went out). */
  onBatch(listener: () => void): () => void;
  /** A batch started this generation: its end is said by its row, not by a toast. */
  fromBatch(opId: string): boolean;
  /**
   * 2026-10-25, «Hi» of a greeting reminder's toast: resolves once the operation's result is on its card — true when it
   * is done, false when it failed, went or did not end within `ms`.
   */
  ended(opId: string, ms: number): Promise<boolean>;
  /**
   * X59 on a hub's «Новые»: the row's own «Отправить» of the fan's greeting — can the result's next part go now by
   * the card's own send, and why the last click on it was refused; null — no part of a «Новые» result waits.
   */
  batchSend(handle: TargetHandle): NewcomerRowSendVM | null;
  /** «Отправить всем» of a hub's «Новые» (the owner, 2026-10-27): how the fan's greeting stands for the run. */
  batchSendState(handle: TargetHandle): BatchSendState;
  /** «Отправить всем»: the row's own «Отправить» of the greeting's next part, as its click sends it. */
  batchSendNow(handle: TargetHandle): Promise<ActionReceipt>;
  /**
   * «Рассылка» on a site whose cards send (X8): on — the versions of its fans go by their cards' own send, and each fan's
   * card takes the outreach's media unless the person picked the fan's own. True — the cards send here and the site has a
   * vault to pick the outreach's media from.
   */
  setOutreach(on: boolean): boolean;
  /** The outreach's media as picked in its sheet (valid or not); null — none: text only. */
  outreachMedia(): OutreachMediaVM | null;
  /** The outreach's media sheet while it is open; null — closed (or no such send here). */
  outreachPicker(): MediaPickerVM | null;
  /** The fan's version on their card: its text, how its «Отправить» stands, its media; null — no version there. */
  outreachRow(handle: TargetHandle): OutreachCardRow | null;
  /** The card's own send of the fan's version (X8) with the fan's media, by this click. */
  outreachSend(type: UiActionType, handle: TargetHandle, anyway: boolean): Promise<ActionReceipt>;
  /** The person's words for the fan's version (null — Fix's again); false — it cannot change now. */
  outreachEdit(handle: TargetHandle, text: string | null): boolean;
  /** What these fans got of these media, as the vault says; null — no vault here. */
  outreachStates(fans: readonly string[], ids: readonly string[]): Promise<ReadonlyMap<string, readonly MediaFanState[]> | null>;
  /** «Онлайн»: a text of the team's guide becomes the open card's result, for its «Отправить →»; false — not now. */
  onlineText(handle: TargetHandle, text: string): Promise<boolean>;
  /** «Онлайн»: the fan's draft emptied — its words became the card's text («Свой текст»'s «Отправить»). */
  clearDraft(handle: TargetHandle): void;
}

export function createPreviewController(deps: PreviewControllerDeps): PreviewController {
  const { rpc, host, i18n, clock, ids, context, surfaces, navigator } = deps;
  // A host without preview-send has no X8 journal. Its gesture-linked humanSend
  // still names the insert: remember that provenance before navigation can write.
  const manualInserts = new Map<string, { readonly opId: string; readonly part: PartRef }>();

  const targets = new Map<TargetHandle, TargetState>();
  let kept: KeptFeed[] = [];
  const tracks = new Map<string, OpTrack>();
  const currentOp = new Map<TargetHandle, string>();
  const attemptOwner = new Map<string, { readonly opId: string; readonly key: string }>();
  /** Views of attempts whose id the click has not learned yet. */
  const unclaimed = new Map<string, SendAttemptView>();
  /**
   * What the background's journal knows of the sends to a fan (`send.list`),
   * by page and fan: attempts another result made, or this tab before a reload.
   */
  const listed = new Map<string, { readonly pageId: number; readonly fanRef: string; readonly items: Map<string, SendListItem> }>();
  const fanKey = (pageId: number, fanRef: string): string => `${pageId}|${fanRef}`;
  let pruneTimer: number | null = null;
  /** The port to the background was down since this tab last heard everything. */
  let portWasDown = false;
  let drafts: DraftStore = EMPTY_DRAFTS;
  const draftListeners = new Set<() => void>();
  const draftsChanged = (): void => {
    for (const listener of [...draftListeners]) listener();
  };
  const revisions = new Map<string, number>();
  const slot = new DeferredInsertSlot();
  let pendingInsert: PendingInsert | null = null;
  /** Results handed to the dock of their chat (§6.5): the sends of their fans are followed while they are kept. */
  const docked = new Set<string>();
  const dockListeners = new Set<() => void>();
  const dockChanged = (): void => {
    if (docked.size > 0) for (const listener of [...dockListeners]) listener();
  };
  /** 1.32.0: fans a batch started, with what their rows last showed; the cards a batch opened unseen; their ends. */
  const batched = new Map<TargetHandle, string>();
  const shadows = new Set<TargetHandle>();
  const batchWaiters = new Map<string, (outcome: BatchOutcome) => void>();
  /** `ended`: who waits for an operation's result, by operation. */
  const endWaiters = new Map<string, Set<(ok: boolean) => void>>();
  const batchListeners = new Set<() => void>();
  /** «Рассылка» exists (X8 sites only): the versions of its fans go by their cards' own send. */
  let outreachOn = false;
  /** The media every fan of the outreach takes: what its sheet holds now (the outreach picker's attachment). */
  let outreachMedia: Attachment = EMPTY_ATTACHMENT;
  /** What the outreach gave each fan, by chat: replaced when its media change, never a fan's own picks. */
  const adopted = new Map<string, Attachment>();
  const batchOps = new Set<string>();
  /** The boards are closing because a chat is being opened by us: not the person closing the preview. */
  let closingForNavigation = false;
  let epoch = context.current().epoch;
  let persona = context.current().persona;
  let disposed = false;
  /** Until when every «Отправить» rests after the last click (SEND_PACE_MS), and the timer that lifts it. */
  let pacedUntil = 0;
  let paceTimer: number | null = null;
  let saveChain: Promise<void> = Promise.resolve();
  /**
   * Decision X53: the media picker of the previews — the vault's media a part takes along. Its changes draw every
   * open card again (a fan's picks show on each of its cards); a chat's picks outlive its cards (2026-10-23).
   */
  const media = new MediaDesk({
    port: host.media,
    clock,
    i18n,
    changed: (chat) => {
      changed();
      // The outreach's sheet is drawn by its window: what it holds is the outreach's media at once, for every fan.
      if (chat.platformFanId === OUTREACH_PICKER_FAN) syncOutreach();
      else if (outreachOn) for (const listener of [...batchListeners]) listener();
    },
    shown: (chat) => (chat.platformFanId === OUTREACH_PICKER_FAN ? outreachOn : [...targets.values()].some((target) => target.fanRef === chat.platformFanId && chatOf(target)?.hostAccountId === chat.hostAccountId)),
  });

  /** The outreach's own media window picks in this «chat»: the page's account, no fan. */
  const outreachChat = (): ChatRef | null => {
    const binding = context.current().binding;
    return binding === null ? null : { host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: OUTREACH_PICKER_FAN };
  };
  /**
   * Sends that took media, by attempt: the picks left the picker with the click, and come back to it only when the send
   * proved it never reached the platform (held, not queued, refused).
   */
  const mediaAttempts = new Map<string, { readonly chat: ChatRef; readonly taken: Attachment }>();
  /** Whether the fan read our newest message, by page and fan; its answers draw the fan's cards again. */
  const seen = new SeenDesk({
    port: deps.readState === undefined ? hostChatReadPort(host) : deps.readState,
    clock,
    changed: (key) => {
      for (const target of targets.values()) if (fanKey(target.pageId, target.fanRef) === key) changedFor(target.handle);
    },
  });

  const cells: Record<PreviewSource, ViewCell<PreviewVM>> = {
    spenders: new ViewCell(() => build('spenders')),
    newcomers: new ViewCell(() => build('newcomers')),
    palette: new ViewCell(() => build('palette')),
    outreach: new ViewCell(() => build('outreach')),
    online: new ViewCell(() => build('online')),
  };
  const changed = (source?: PreviewSource): void => {
    if (disposed) return;
    if (source === undefined) for (const s of SOURCES) cells[s].invalidate();
    else cells[source].invalidate();
    dockChanged();
  };
  /** The card of `handle` and every other open card of the same fan: a result of the fan may stand on any of them. */
  const changedFor = (handle: TargetHandle): void => {
    const fan = parseFanHandle(handle);
    for (const s of SOURCES) {
      const open = surfaces.current().preview[s];
      if (open === null) continue;
      const other = open === handle ? null : parseFanHandle(open);
      if (open === handle || (fan !== null && other !== null && other.pageId === fan.pageId && other.fanRef === fan.fanRef)) cells[s].invalidate();
    }
    dockChanged();
    batchChanged(handle);
  };

  const nowIso = (): string => new Date(clock.now()).toISOString();
  /** The fan's chat on the page's bound account; null — no binding yet. */
  const chatOf = (state: Pick<TargetState, 'fanRef'>): ChatRef | null => {
    const binding = context.current().binding;
    return binding === null ? null : { host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: state.fanRef };
  };
  const surfaceOf = (source: PreviewSource): Surface => (source === 'newcomers' ? 'newcomers' : 'preview');
  const purposeOf = (source: PreviewSource): 'greeting' | 'preview-reply' => (source === 'newcomers' ? 'greeting' : 'preview-reply');
  /**
   * «Новые» greet; «Рассылка»'s card writes its fan's version alone (Fix of the common text, by the window's batch); the
   * card of «Онлайн» — Reply, Hi or Ping, by the window.
   */
  const featuresOf = (source: PreviewSource): readonly PreviewActionId[] => (source === 'newcomers' ? ['hi'] : source === 'outreach' ? ['fix'] : source === 'online' ? ONLINE_FEATURES : DRAFT_FEATURES);

  // ── drafts ──

  const ownerKey = (source: PreviewSource, pageId: number, fanRef: string): string | null => {
    const session = context.current().session;
    // The cards of «Рассылка» and «Онлайн» keep no draft of their own: the fan's Spenders draft is the one a Fix of theirs would read.
    return session === null ? null : draftKey({ hubOrigin: session.hubOrigin, userId: session.userId, pageId, list: source === 'outreach' || source === 'online' ? 'spenders' : source, fanRef });
  };
  const draftText = (state: Pick<TargetState, 'source' | 'pageId' | 'fanRef'>): string => {
    const key = ownerKey(state.source, state.pageId, state.fanRef);
    return key === null ? '' : (findDraft(drafts, key, clock.now())?.text ?? '');
  };
  const draftRevision = (state: Pick<TargetState, 'source' | 'pageId' | 'fanRef'>): number => {
    const key = ownerKey(state.source, state.pageId, state.fanRef);
    return key === null ? 0 : (revisions.get(key) ?? findDraft(drafts, key, clock.now())?.revision ?? 0);
  };
  /**
   * Whose drafts this tab may hold: the signed-in user's, nobody's once the
   * background says nobody is signed in (§9.4: a sign-out clears everything
   * of the user), and — while the sign-in is still being read — no filter.
   */
  const draftScope = (state: PageContextState): { readonly id: string; readonly keep: (key: string) => boolean } | null => {
    const session = state.session;
    if (session !== null) {
      const prefix = draftUserPrefix(session.hubOrigin, session.userId);
      return { id: `user:${prefix}`, keep: (key) => key.startsWith(prefix) };
    }
    const code = state.blocker?.code;
    return state.phase === 'blocked' && (code === 'CG-AUTH-REQUIRED' || code === 'CG-AUTH-REVOKED' || code === 'CG-AUTH-EXPIRED') ? { id: 'nobody', keep: () => false } : null;
  };
  const scoped = (store: DraftStore): DraftStore => {
    const scope = draftScope(context.current());
    return scope === null ? store : keepOnly(store, scope.keep);
  };
  /** The scope last applied to memory and storage. */
  let appliedScope: string | null = null;
  let saveFailed = false;

  /** What another tab wrote (or this tab merged) becomes what this tab shows; a draft changed elsewhere voids a Fix made from the old text. */
  function adoptDrafts(next: DraftStore): void {
    if (sameDraftStore(next, drafts)) return;
    for (const key of changedDraftKeys(drafts, next)) {
      const local = revisions.get(key);
      if (local !== undefined) revisions.set(key, Math.max(local + 1, findDraft(next, key, clock.now())?.revision ?? 0));
    }
    drafts = next;
    changed();
    draftsChanged();
  }

  /** One step after another on the shared key; a failure is said once, until a write succeeds again. */
  function onStore(step: (port: DraftStorePort) => Promise<void>): Promise<void> {
    const port = deps.drafts;
    if (port === null) return saveChain;
    saveChain = saveChain
      .then(() => (disposed ? undefined : step(port)))
      .then(
        () => {
          saveFailed = false;
        },
        () => {
          if (!saveFailed && !disposed) deps.notifier?.notify('CG-STORAGE-WRITE', 'preview:drafts');
          saveFailed = true;
        },
      );
    return saveChain;
  }

  /** Reads the key, merges it draft by draft with what this tab holds, adopts the result and writes it when the key lacks it. */
  const saveDrafts = (): void => {
    void onStore(async (port) => {
      const stored = readDraftStore(await port.load(), clock.now());
      const merged = scoped(mergeDraftStores(drafts, stored, clock.now()));
      adoptDrafts(merged);
      if (!sameDraftStore(merged, stored)) await port.save(merged);
    });
  };

  /** The sign-in changed: other users' drafts leave memory and the key (not merged back: they are gone for good). */
  function applyDraftScope(state: PageContextState): void {
    const scope = draftScope(state);
    if (scope === null || scope.id === appliedScope) return;
    appliedScope = scope.id;
    for (const key of [...revisions.keys()]) if (!scope.keep(key)) revisions.delete(key);
    adoptDrafts(keepOnly(drafts, scope.keep));
    void onStore(async (port) => {
      const stored = readDraftStore(await port.load(), clock.now());
      const kept = keepOnly(stored, scope.keep);
      if (!sameDraftStore(kept, stored)) await port.save(kept);
    });
  }

  const readyPromise: Promise<void> = onStore(async (port) => {
    const stored = readDraftStore(await port.load(), clock.now());
    // Drafts typed before the store answered are newer than what was stored for the same fan.
    adoptDrafts(scoped(mergeDraftStores(drafts, stored, clock.now())));
  });
  const offStore =
    deps.drafts?.onChanged?.((raw) => {
      if (disposed) return;
      const stored = readDraftStore(raw, clock.now());
      const merged = scoped(mergeDraftStores(drafts, stored, clock.now()));
      adoptDrafts(merged);
      // This tab holds a newer entry than the one just written elsewhere: it goes back into the key.
      if (!sameDraftStore(merged, stored)) saveDrafts();
    }) ?? null;
  applyDraftScope(context.current());

  // ── targets and the feed ──

  const feedLimit = (): number => Math.max(1, Math.min(FEED_PAGE_SIZE, context.current().bootstrap?.limits.feedMax ?? FEED_PAGE_SIZE));

  /** What the list knows of the fan now — it may have resolved the fan's chat since the card opened (R20 F6a). */
  function infoNow(state: TargetState): PreviewTargetInfo {
    state.info = deps.directories[state.source]?.resolve(state.handle) ?? state.info;
    return state.info;
  }
  /** The conversation the card works on, read at the moment it is needed (R20 P8a); null — none is known. */
  const conversationNow = (state: TargetState): string | null => conversationOfTarget(infoNow(state), context.current().binding?.platform ?? null);

  async function loadFeed(state: TargetState): Promise<void> {
    const ctx = context.current();
    if (ctx.phase !== 'ready' || !pageFlag(ctx, 'preview')) return;
    const run = ++state.feedRun;
    const atEpoch = epoch;
    // A new walk reads the conversation the list knows now (on Fansly the group it resolved), never the chat on screen.
    const conversation = feedConversationOf(infoNow(state), ctx.binding?.platform ?? null);
    if (conversation === null || conversation.conversationRef !== state.feedConversation?.conversationRef) {
      // Neither rows nor a cursor survive losing or changing the conversation, including a failed new read.
      state.feed = null;
      state.feedConversation = null;
      state.feedLoadedAt = null;
      state.olderError = null;
      kept = kept.filter((entry) => entry.key !== state.handle);
      stopPoll(state);
    }
    // A new first-page run invalidates any older page still in flight.
    state.olderLoading = false;
    if (conversation === null) {
      // R20 P8a: the list knows no chat of the fan — nothing is read, and the card says so with «Повторить».
      state.feedLoading = false;
      state.feedSince = null;
      state.feedError = { code: 'CG-DATA-NOT-READY' };
      return changedFor(state.handle);
    }
    state.feedLoading = true;
    state.feedSince = clock.now();
    changedFor(state.handle);
    const pingWindow = ctx.settings?.generation.windows.ping;
    const answer = await rpc.request('feed.read', {
      pageId: state.pageId,
      fanRef: state.fanRef,
      cursor: null,
      limit: feedLimit(),
      ...(pingWindow === undefined ? {} : { summaryWindow: pingWindow }),
      ...conversation,
    });
    if (disposed || atEpoch !== epoch || state.feedRun !== run || targets.get(state.handle) !== state) return;
    state.feedLoading = false;
    state.feedSince = null;
    if (answer.ok) {
      state.feed = firstFeedPage(answer.payload);
      state.feedConversation = conversation;
      state.feedError = null;
      state.olderError = null;
      state.feedLoadedAt = clock.now();
      const poll = state.poll;
      // The archive moved past the head the held send was waiting on: stop asking.
      if (poll !== null && (state.feed.head?.messageRef ?? null) !== poll.head) stopPoll(state);
    } else state.feedError = answer.error;
    changedFor(state.handle);
  }

  async function loadOlder(state: TargetState): Promise<void> {
    const feed = state.feed;
    const cursor = feed?.nextOlderCursor ?? null;
    const conversation = state.feedConversation;
    if (feed === null || cursor === null || conversation === null || state.olderLoading) return;
    if (conversationNow(state) !== (conversation.conversationRef ?? state.fanRef)) return;
    const run = state.feedRun;
    const atEpoch = epoch;
    state.olderLoading = true;
    state.olderError = null;
    changedFor(state.handle);
    const answer = await rpc.request('feed.read', { pageId: state.pageId, fanRef: state.fanRef, cursor, limit: feedLimit(), ...conversation });
    // A first page was read meanwhile: this page belongs to the walk it replaced.
    if (disposed || atEpoch !== epoch || targets.get(state.handle) !== state || state.feedRun !== run || state.feed === null) return;
    state.olderLoading = false;
    if (answer.ok) {
      const step = olderFeedPage(state.feed, cursor, answer.payload);
      if (step.kind === 'appended') state.feed = step.state;
      // Another snapshot answered the cursor: the pass starts over from the first page (a safe read).
      else if (step.reason === 'snapshot') void loadFeed(state);
    } else if (answer.error.code === 'CG-HUB-REQUEST') {
      // The cursor is no longer valid (the archive was rebuilt): a new pass from the first page.
      void loadFeed(state);
    } else state.olderError = answer.error;
    changedFor(state.handle);
  }

  async function loadCard(state: TargetState): Promise<void> {
    if (state.source === 'newcomers' || context.current().phase !== 'ready') return;
    const run = ++state.cardRun;
    const atEpoch = epoch;
    const answer = await rpc.request('fan.card', { pageId: state.pageId, fanRef: state.fanRef, period: '30d' });
    if (disposed || atEpoch !== epoch || state.cardRun !== run || targets.get(state.handle) !== state) return;
    state.card = answer.ok ? answer.payload : null;
    changedFor(state.handle);
    const opId = currentOp.get(state.handle);
    const track = opId === undefined ? undefined : tracks.get(opId);
    if (track !== undefined) void refreshPreflight(track);
  }

  function stopPoll(state: TargetState): void {
    if (state.poll === null) return;
    clock.clearTimer(state.poll.timer);
    state.poll = null;
  }

  /** While a send is held for the fan's new message, the archive is asked every 5 s for up to 2 min. */
  function startPoll(state: TargetState): void {
    if (state.poll !== null) return;
    const until = clock.now() + SEND_LIMITS.archivePollMaxMs;
    const head = state.feed?.head?.messageRef ?? null;
    const tick = (): void => {
      const poll = state.poll;
      if (poll === null || disposed || targets.get(state.handle) !== state) return;
      if (clock.now() >= poll.until) return stopPoll(state);
      poll.timer = clock.setTimer(SEND_LIMITS.archivePollMs, tick);
      if (!state.feedLoading) void loadFeed(state);
    };
    state.poll = { timer: clock.setTimer(SEND_LIMITS.archivePollMs, tick), until, head };
  }

  function newTarget(source: PreviewSource, handle: TargetHandle): TargetState | null {
    const info = deps.directories[source]?.resolve(handle) ?? null;
    if (info === null) return null;
    const conversation = feedConversationOf(info, context.current().binding?.platform ?? null);
    kept = kept.filter((entry) => entry.key !== handle || (conversation !== null && entry.conversationRef === (conversation.conversationRef ?? info.fanRef)));
    const saved = kept.find((entry) => entry.key === handle) ?? null;
    const state: TargetState = {
      handle,
      source,
      pageId: info.pageId,
      fanRef: info.fanRef,
      info,
      feed: saved?.first ?? null,
      feedConversation: saved === null ? null : conversation,
      feedLoading: false,
      feedError: null,
      feedRun: 0,
      feedSince: null,
      feedLoadedAt: saved?.keptAt ?? null,
      olderLoading: false,
      olderError: null,
      card: null,
      cardRun: 0,
      tone: null,
      poll: null,
      rows: null,
    };
    return state;
  }

  /** The card rests on the fan: whether the fan read our newest message is read (`force` — «Обновить»). */
  function wantSeen(state: TargetState, force = false): void {
    seen.want(
      fanKey(state.pageId, state.fanRef),
      () => {
        const ctx = context.current();
        const chat = chatOf(state);
        // A card a batch opened unseen asks nothing: only the one the person looks at.
        if (disposed || targets.get(state.handle) !== state || shadows.has(state.handle) || ctx.phase !== 'ready' || !pageFlag(ctx, 'preview') || chat === null) return null;
        const info = infoNow(state);
        return { pageId: state.pageId, chat, username: info.username, conversationRef: conversationNow(state) };
      },
      force,
    );
  }

  function openTarget(source: PreviewSource, handle: TargetHandle): void {
    shadows.delete(handle);
    const state = newTarget(source, handle);
    if (state === null) return;
    const info = state.info;
    targets.set(handle, state);
    // Opening the card is the person working with the fan (the lease of «Новые» renews only while they do).
    if (source === 'newcomers') deps.greeting?.touch(info.fanRef, busyOf(info.pageId, info.fanRef));
    void loadFeed(state);
    void loadCard(state);
    void restoreOp(state);
    wantSeen(state);
    // The page conditions may have moved while the card was closed: its result asks MAIN again.
    const shown = tracks.get(currentOp.get(handle) ?? '');
    if (shown !== undefined) void refreshPreflight(shown);
    // 1.32.0: a greeting a batch made while nobody looked: opening it is the person working with the fan, and the
    // lease that ran out meanwhile is taken again (a colleague's stays theirs), so its parts can be sent.
    if (source === 'newcomers' && shown !== undefined && shown.feature === 'hi' && shown.mirror.done?.state === 'done' && progress(shown) === null) deps.greeting?.reclaim?.(info.fanRef);
  }

  function closeTarget(handle: TargetHandle): void {
    const state = targets.get(handle);
    if (state === undefined) return;
    stopPoll(state);
    if (![...targets.values()].some((other) => other !== state && other.pageId === state.pageId && other.fanRef === state.fanRef)) seen.leave(fanKey(state.pageId, state.fanRef));
    if (state.feed !== null && state.feedConversation !== null) kept = keepFeed(kept, { key: handle, conversationRef: state.feedConversation.conversationRef ?? state.fanRef, first: state.feed, keptAt: state.feedLoadedAt ?? clock.now() });
    targets.delete(handle);
    // Decision X53, the owner's rule of 2026-10-23 (it was «the picks are the open card's»): closing a window never
    // throws away the chatter's work. The last card of the fan closed, the panel closes; the picks and the price stay the
    // chat's until they are sent or cleared, and the next card of the chat shows them.
    const chat = chatOf(state);
    if (chat !== null && ![...targets.values()].some((other) => other.pageId === state.pageId && other.fanRef === state.fanRef)) media.leave(chat);
    // The person closed the preview before the chat opened: the pending insert is given up (§6.5).
    if (pendingInsert !== null && pendingInsert.track.handle === handle && !closingForNavigation) cancelInsert('preview-closed');
    // What the journal listed for the fan is read again when a card of the fan opens.
    if (!followed(state.pageId, state.fanRef)) listed.delete(fanKey(state.pageId, state.fanRef));
    pruneTracks();
  }

  // ── operations ──

  /**
   * The open card that shows the result: its own, or another card of the same fan that took it up — the
   * previews are one window at a time, so a result made in Spenders stands alone in the palette's window of the
   * fan, and the other way round (X24). null — no open card shows it.
   */
  function shownOn(track: OpTrack): TargetState | null {
    if (currentOp.get(track.handle) === track.opId) {
      const own = targets.get(track.handle);
      if (own !== undefined) return own;
    }
    for (const [handle, opId] of currentOp) {
      if (opId !== track.opId) continue;
      const state = targets.get(handle);
      if (state !== undefined) return state;
    }
    return null;
  }

  /** A part of this result is on its way or its outcome is unknown: the result holds its fan and is neither hidden nor dropped. */
  function holdsFan(track: OpTrack): boolean {
    if (track.clicked.size > 0) return true;
    return [...track.attempts.values()].some((attempt) => attempt.resolved === undefined && (attempt.view.state === 'uncertain' || inFlight(attempt.view.state)));
  }

  function dropTrack(track: OpTrack): void {
    settleBatch(track, { s: 'failed', code: 'CG-OP-INTERRUPTED' });
    clearHoldTimers(track);
    tracks.delete(track.opId);
    docked.delete(track.opId);
    if (currentOp.get(track.handle) === track.opId) currentOp.delete(track.handle);
    for (const attempt of track.attempts.values()) if (attemptOwner.get(attempt.attemptId)?.opId === track.opId) attemptOwner.delete(attempt.attemptId);
  }

  /**
   * §9.4: at most `resultsPerTab` results, each for `resultTtlMs` after it
   * ended. A result on an open card stays while the card is open, one that
   * holds its fan stays until the hold ends; a closed card's result ages out
   * like any other (the background keeps its text for a reopen).
   */
  function pruneTracks(): void {
    const now = clock.now();
    const kept = (track: OpTrack): boolean => holdsFan(track) || shownOn(track) !== null || pendingInsert?.track === track;
    for (const track of [...tracks.values()]) {
      const ended = track.mirror.done?.endedAt ?? null;
      if (!kept(track) && ended !== null && now - ended > OP_LIMITS.resultTtlMs) dropTrack(track);
    }
    while (tracks.size > TRACKS_MAX) {
      const oldest = [...tracks.values()].filter((track) => !kept(track) && isTerminalOpState(track.mirror.state)).sort((a, b) => a.startedAt - b.startedAt)[0];
      if (oldest === undefined) break;
      dropTrack(oldest);
    }
    // A draft's revision is kept only while the draft or its removal mark is.
    for (const key of [...revisions.keys()]) if (!drafts.drafts.some((d) => d.key === key) && !(drafts.removed ?? []).some((mark) => mark.key === key)) revisions.delete(key);
    schedulePrune();
  }

  /** One timer: when the next closed result runs out of its time. */
  function schedulePrune(): void {
    if (pruneTimer !== null) clock.clearTimer(pruneTimer);
    pruneTimer = null;
    if (disposed) return;
    let next: number | null = null;
    for (const track of tracks.values()) {
      const ended = track.mirror.done?.endedAt ?? null;
      if (ended !== null) next = Math.min(next ?? Infinity, ended + OP_LIMITS.resultTtlMs + 1);
    }
    if (next === null) return;
    pruneTimer = clock.setTimer(Math.max(1000, next - clock.now()), () => {
      pruneTimer = null;
      pruneTracks();
    });
  }

  function trackOf(view: OpView, state: TargetState, extra: Partial<Pick<OpTrack, 'checkpoint' | 'previewRevision' | 'fixSource' | 'splitRequested' | 'personaDefinitionId'>> = {}): OpTrack {
    return {
      opId: view.opId,
      handle: state.handle,
      source: state.source,
      pageId: state.pageId,
      fanRef: state.fanRef,
      feature: view.feature,
      surface: view.surface,
      target: view.target,
      mirror: mirrorFromView(view),
      lastSeq: 0,
      startedAt: view.startedAt,
      checkpoint: extra.checkpoint ?? null,
      previewRevision: extra.previewRevision ?? draftRevision(state),
      fixSource: extra.fixSource ?? null,
      toneUsed: view.toneUsed,
      splitRequested: extra.splitRequested ?? (view.result?.kind === 'parts' ? view.result.splitRequested : false),
      personaDefinitionId: extra.personaDefinitionId ?? null,
      hidden: false,
      expanded: false,
      cachedAt: null,
      attempts: new Map(),
      clicked: new Set(),
      copy: new Map(),
      preflight: null,
      preflightRun: 0,
      fanWrote: false,
      fanWroteAt: null,
      openInsert: null,
      holdTimers: new Map(),
      edits: new Map(),
      manual: null,
      fromDraft: null,
    };
  }

  // ── the fan's sends, over every result ──

  /** Every attempt to a fan this tab knows: those its results track, and those only the background's journal lists. */
  function fanFacts(pageId: number, fanRef: string): FanSendFact[] {
    const facts: FanSendFact[] = [];
    const tracked = new Set<string>();
    for (const track of tracks.values()) {
      if (track.pageId !== pageId || track.fanRef !== fanRef) continue;
      const total = (variant: number, index: number): number => groupOf(track, variant)?.partCount ?? index + 1;
      for (const [key, attempt] of track.attempts) {
        const [variant, index] = key.split(':').map(Number) as [number, number];
        tracked.add(attempt.attemptId);
        facts.push({ opId: track.opId, attemptId: attempt.attemptId, part: index, total: total(variant, index), state: attempt.view.state, tracked: true, ...(attempt.resolved === undefined ? {} : { resolved: attempt.resolved }) });
      }
      for (const key of track.clicked) {
        if (track.attempts.has(key)) continue;
        const [variant, index] = key.split(':').map(Number) as [number, number];
        facts.push({ opId: track.opId, attemptId: `click:${key}`, part: index, total: total(variant, index), state: 'preparing', tracked: true });
      }
    }
    for (const item of listed.get(fanKey(pageId, fanRef))?.items.values() ?? []) {
      if (tracked.has(item.view.attemptId)) continue;
      facts.push({ opId: item.opId, attemptId: item.view.attemptId, part: item.partIndex, total: item.group.partCount, state: item.view.state, tracked: false, ...(item.resolved === undefined ? {} : { resolved: item.resolved }) });
    }
    return facts;
  }

  const fanSends = (pageId: number, fanRef: string, preferOp: string | null = null): FanSends => fanSendsOf(fanFacts(pageId, fanRef), preferOp);

  /** Something of this fan is in flight: a generation, a part on its way, a pending «Открыть и вставить». */
  function busyOf(pageId: number, fanRef: string): boolean {
    if (pendingInsert !== null && pendingInsert.track.pageId === pageId && pendingInsert.track.fanRef === fanRef) return true;
    for (const track of tracks.values()) {
      if (track.pageId === pageId && track.fanRef === fanRef && !isTerminalOpState(track.mirror.state)) return true;
    }
    return fanSends(pageId, fanRef).inFlight;
  }

  /** «Новые»: the person did something with the fan, and whether something of the fan is in flight (the lease renews only then). */
  function touchDesk(of: Pick<OpTrack, 'source' | 'pageId' | 'fanRef'>): void {
    if (of.source === 'newcomers') deps.greeting?.touch(of.fanRef, busyOf(of.pageId, of.fanRef));
  }

  const isoOf = (ms: number): string => new Date(ms).toISOString();
  /** Which of two attempts of one part stands: one that holds the fan, then a delivered one, then any other. */
  const weight = (state: SendAttemptView['state'], resolved: 'sent' | undefined): number => (resolved === 'sent' || state === 'sentObserved' ? 2 : state === 'uncertain' || inFlight(state) ? 3 : 1);

  /**
   * The listed attempts of a fan become the attempts of the results that
   * made them: a part with an unknown outcome is shown as such again after a
   * reload, a sent part stays sent, and a hub resolve is taken (§6.7.8).
   * `settled` — attempts this tab held as uncertain when the list was asked
   * for and that a whole list no longer names: the hub resolved them.
   */
  function adoptSends(pageId: number, fanRef: string, settled: ReadonlySet<string>): void {
    const entry = listed.get(fanKey(pageId, fanRef));
    if (entry === undefined) return;
    const touched = new Set<OpTrack>();
    for (const item of entry.items.values()) {
      const track = tracks.get(item.opId);
      if (track === undefined || track.pageId !== pageId || track.fanRef !== fanRef) continue;
      const key = partKey(item.group.variant, item.partIndex);
      const id = item.view.attemptId;
      const current = track.attempts.get(key);
      if (item.resolved === 'not-sent') {
        // Resolved «не ушло»: the part is free again, for a new click.
        if (current?.attemptId === id) {
          track.attempts.delete(key);
          attemptOwner.delete(id);
          touched.add(track);
        }
        continue;
      }
      const resolved = item.resolved === 'sent' ? ('sent' as const) : undefined;
      const sameAttempt = current?.attemptId === id;
      if (current !== undefined && sameAttempt && current.resolved === resolved && !attemptReachable(current.view.state, item.view.state)) continue;
      if (current !== undefined && !sameAttempt && weight(item.view.state, resolved) <= weight(current.view.state, current.resolved)) continue;
      const at = isoOf(item.updatedAt);
      track.attempts.set(key, {
        attemptId: id,
        view: item.view,
        sentAt: resolved === 'sent' || item.view.state === 'sentObserved' ? ((sameAttempt ? current?.sentAt : null) ?? at) : null,
        uncertainSince: item.view.state === 'uncertain' ? ((sameAttempt ? current?.uncertainSince : null) ?? at) : null,
        ...(resolved === undefined ? {} : { resolved }),
      });
      if (current !== undefined && !sameAttempt) attemptOwner.delete(current.attemptId);
      attemptOwner.set(id, { opId: track.opId, key });
      touched.add(track);
    }
    for (const track of tracks.values()) {
      if (track.pageId !== pageId || track.fanRef !== fanRef) continue;
      for (const [key, attempt] of track.attempts) {
        if (!settled.has(attempt.attemptId) || entry.items.has(attempt.attemptId) || attempt.view.state !== 'uncertain') continue;
        track.attempts.delete(key);
        attemptOwner.delete(attempt.attemptId);
        touched.add(track);
      }
    }
    for (const track of touched) reportProgress(track);
  }

  /** A card of the fan is open in this tab. */
  const cardOpen = (pageId: number, fanRef: string): boolean => [...targets.values()].some((target) => target.pageId === pageId && target.fanRef === fanRef);
  /** The fan's sends are this tab's to follow: a card of the fan is open, or the dock shows a result made for the fan (§6.5). */
  const followed = (pageId: number, fanRef: string): boolean =>
    cardOpen(pageId, fanRef) || [...docked].some((opId) => tracks.get(opId)?.pageId === pageId && tracks.get(opId)?.fanRef === fanRef);

  /** Reads what the background's journal knows of the sends to a fan; false — it did not answer (or the fan's card is gone). */
  async function loadSends(pageId: number, fanRef: string): Promise<boolean> {
    if (deps.previewSend === false) return true;
    const atEpoch = epoch;
    const uncertainNow = new Set<string>();
    for (const track of tracks.values()) {
      if (track.pageId !== pageId || track.fanRef !== fanRef) continue;
      for (const attempt of track.attempts.values()) if (attempt.view.state === 'uncertain' && attempt.resolved === undefined) uncertainNow.add(attempt.attemptId);
    }
    const answer = await rpc.request('send.list', { pageId, fanRef });
    // The list is kept only while a card of the fan is open (it is read again when one opens) or the dock shows its result.
    if (disposed || atEpoch !== epoch || !answer.ok || !followed(pageId, fanRef)) return false;
    const before = listed.get(fanKey(pageId, fanRef))?.items;
    const items = new Map<string, SendListItem>();
    for (const item of answer.payload.attempts) {
      const held = before?.get(item.view.attemptId);
      // A state this tab already saw further along stays: a late answer never moves an attempt back.
      items.set(item.view.attemptId, held !== undefined && item.resolved === undefined && attemptReachable(item.view.state, held.view.state) ? { ...item, view: held.view, updatedAt: held.updatedAt } : item);
    }
    listed.set(fanKey(pageId, fanRef), { pageId, fanRef, items });
    adoptSends(pageId, fanRef, answer.payload.truncated ? new Set() : uncertainNow);
    changed();
    return true;
  }

  /**
   * The fan's sends as the journal has them at this click; the code to refuse
   * the click with when it does not tell (another identity meanwhile, or no
   * answer), null — they are known.
   */
  async function sendsNow(pageId: number, fanRef: string): Promise<CgCode | null> {
    const atStart = epoch;
    // 2026-10-29: a result whose card is closed (what a reminder's toast wrote) — the journal is looked at once, not kept.
    if (!followed(pageId, fanRef)) return heldNow(pageId, fanRef);
    const known = await loadSends(pageId, fanRef);
    if (disposed || atStart !== epoch) return 'CG-CONTEXT-CHANGED';
    return known ? null : 'CG-RUNTIME-UNREACHABLE';
  }

  /**
   * One look at the journal for a fan no card of this tab follows: a part whose outcome is unknown, or one on its way,
   * holds the fan (§6.7.8) — the click is refused, as an open card's would be; nothing of the answer is kept.
   */
  async function heldNow(pageId: number, fanRef: string): Promise<CgCode | null> {
    if (deps.previewSend === false) return null;
    const atStart = epoch;
    const answer = await rpc.request('send.list', { pageId, fanRef });
    if (disposed || atStart !== epoch) return 'CG-CONTEXT-CHANGED';
    if (!answer.ok) return 'CG-RUNTIME-UNREACHABLE';
    const open = answer.payload.attempts.filter((item) => item.resolved === undefined);
    if (open.some((item) => item.view.state === 'uncertain')) return 'CG-SEND-UNCERTAIN';
    return open.some((item) => inFlight(item.view.state)) ? 'CG-SEND-BUSY' : null;
  }

  /**
   * The newest result of this chat that a preview made, after a reopen or a
   * tab reload. The fan's sends are read first: a result comes back with the
   * state of its parts, or not at all.
   */
  async function restoreOp(state: TargetState): Promise<void> {
    const atEpoch = epoch;
    const known = await loadSends(state.pageId, state.fanRef);
    if (disposed || atEpoch !== epoch || targets.get(state.handle) !== state || currentOp.has(state.handle) || !known) return;
    const binding = context.current().binding;
    if (binding === null) return;
    const chatKey = chatKeyOf({ host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: state.fanRef });
    const answer = await rpc.request('op.list', { scope: 'tab', chatKey });
    if (disposed || atEpoch !== epoch || !answer.ok || currentOp.has(state.handle) || targets.get(state.handle) !== state) return;
    const view = answer.payload.ops.find((op) => op.surface === surfaceOf(state.source));
    if (view === undefined) return;
    // The checkpoint of that generation stayed with the background: such a result can be inserted, not sent.
    const track = tracks.get(view.opId) ?? trackOf(view, state);
    tracks.set(view.opId, track);
    currentOp.set(state.handle, view.opId);
    adoptSends(state.pageId, state.fanRef, new Set());
    schedulePrune();
    changedFor(state.handle);
  }

  /**
   * Reads the operation as the background has it now. `lost` — it is asked because the port was down and the
   * events of the meantime are gone (`resync`): a run the background's list no longer names ended without a word
   * and is interrupted here, so its card does not show «генерация» for ever. false — the list was not read.
   */
  async function syncOp(track: OpTrack, lost = false): Promise<boolean> {
    const answer = await rpc.request('op.list', { scope: 'tab', chatKey: chatKeyOf(track.target.chat) });
    if (disposed || tracks.get(track.opId) !== track) return true;
    if (!answer.ok) return false;
    const view = answer.payload.ops.find((op) => op.opId === track.opId);
    if (view === undefined) {
      if (lost && !isTerminalOpState(track.mirror.state)) {
        const now = clock.now();
        finish(track, { opId: track.opId, feature: track.feature, surface: track.surface, target: track.target, state: 'interrupted', phase: { name: 'settled', since: now }, startedAt: track.startedAt, toneUsed: track.toneUsed, endedAt: now, error: { code: 'CG-OP-INTERRUPTED' } });
      }
      return true;
    }
    if (isTerminalOpState(view.state)) {
      finish(track, view);
      return true;
    }
    const ahead = (view.text ?? '').length > track.mirror.text.length || view.state !== track.mirror.state;
    if (ahead && track.mirror.done === null) {
      // After a lost port the batches of the new tab session count from this view on.
      track.mirror = { ...mirrorFromView(view), seq: lost ? 0 : track.lastSeq };
      if (lost) track.lastSeq = 0;
      changedFor(track.handle);
    }
    return true;
  }

  /**
   * The port to the background came back (the event page restarted, or the tab got a new session): what the
   * background said meanwhile is lost for this tab. Every result still shown as running is read again — one that
   * ended is shown as it ended, one the background no longer knows is interrupted — and so are the sends of every
   * fan this tab follows (an open card, a result in the dock): a part sent, held or resolved during the outage is
   * what the journal says now. The page context reads itself again (boards/context.ts). Nothing is generated,
   * inserted or sent from here.
   */
  let resyncTimer: number | null = null;
  async function resync(retry = true): Promise<void> {
    if (resyncTimer !== null) clock.clearTimer(resyncTimer);
    resyncTimer = null;
    let unread = false;
    for (const track of [...tracks.values()]) {
      if (isTerminalOpState(track.mirror.state)) continue;
      if (!(await syncOp(track, true))) unread = true;
      if (disposed) return;
    }
    const fans = new Map<string, { readonly pageId: number; readonly fanRef: string }>();
    for (const of of [...targets.values(), ...[...docked].flatMap((opId) => tracks.get(opId) ?? [])]) fans.set(fanKey(of.pageId, of.fanRef), of);
    for (const fan of fans.values()) void loadSends(fan.pageId, fan.fanRef);
    // The background's own list could not be read: once more after a moment, so a run whose end was lost with the
    // port does not keep spinning until the next reconnect.
    if (unread && retry && !disposed) {
      resyncTimer = clock.setTimer(RESYNC_RETRY_MS, () => {
        resyncTimer = null;
        void resync(false);
      });
    }
  }

  function onUpdate(update: TabEventPayload<'op.update'>): void {
    const track = tracks.get(update.opId);
    if (track === undefined) return;
    track.lastSeq = Math.max(track.lastSeq, update.seq);
    const step = applyOpUpdate(track.mirror, update);
    if (step.outcome === 'applied') {
      track.mirror = step.mirror;
      changedFor(track.handle);
    } else if (step.outcome === 'gap') void syncOp(track);
  }

  /** The terminal view; the button's preflight is asked first, so a finished result never flashes a wrong «Отправить». */
  function finish(track: OpTrack, view: OpView): void {
    const apply = (): void => {
      if (tracks.get(track.opId) !== track) return;
      const step = applyOpDone(track.mirror, view);
      if (step.outcome !== 'applied') return;
      track.mirror = step.mirror;
      settleBatch(track);
      track.toneUsed = view.toneUsed;
      if (view.result?.kind === 'parts') track.splitRequested = view.result.splitRequested;
      touchDesk(track);
      if (view.stale?.reason === 'fan-wrote') markFanWrote(track, view.stale.at);
      schedulePrune();
      changedFor(track.handle);
      const waiters = endWaiters.get(track.opId);
      endWaiters.delete(track.opId);
      for (const wake of waiters ?? []) wake(view.state === 'done');
    };
    if (view.state !== 'done' || track.mirror.done !== null || localGate(track, view).ok === false) return apply();
    refreshPreflight(track, view).then(apply, apply);
  }

  function markFanWrote(track: OpTrack, at: string | null): void {
    track.fanWrote = true;
    track.fanWroteAt = at ?? track.fanWroteAt;
    const state = targets.get(track.handle) ?? shownOn(track);
    if (state !== null && state !== undefined) startPoll(state);
  }

  // ── the send gate ──

  function groupOf(track: OpTrack, variant: number, view: OpView | null = track.mirror.done): SendGroup | null {
    const texts = partsOfResult(view?.result, variant);
    const ref = view?.generationRef;
    return texts === null || ref === undefined ? null : { generationRef: ref, variant, partCount: texts.length };
  }

  /**
   * NF-016, §6.4 row 2: the sign-in, the binding or the persona is no longer
   * the one the operation was frozen for — its text is neither sent nor inserted.
   */
  function identityChanged(track: OpTrack): boolean {
    const ctx = context.current();
    const binding = ctx.binding;
    const frozen = track.target.binding;
    if (ctx.phase !== 'ready' || binding === null || binding.pageId !== frozen.pageId || binding.bindingRevision !== frozen.bindingRevision || binding.loginEpoch !== frozen.loginEpoch || binding.hubOrigin !== frozen.hubOrigin) {
      return true;
    }
    return track.personaDefinitionId !== null && ctx.persona?.definitionId !== track.personaDefinitionId;
  }

  /** The controller's own conditions, in the order of §6.7.4; MAIN's preflight covers the page's. */
  function localGate(track: OpTrack, view: OpView | null = track.mirror.done): PreviewSendPreflight {
    const ctx = context.current();
    if (deps.sender === null) return refusal('CG-SEND-HOST');
    if (view === null || view.state !== 'done' || view.generationRef === undefined) return refusal('CG-SEND-PART');
    const first = partsOfResult(view.result, 0);
    if (first === null) return refusal('CG-SEND-PART');
    if (identityChanged(track)) return refusal('CG-CONTEXT-CHANGED');
    if (!pageFlag(ctx, 'previewSend') || (track.source === 'newcomers' && !pageFlag(ctx, 'newcomers'))) return refusal('CG-SEND-OFF');
    if ((ctx.bootstrap?.limits.previewSendReceiptProfiles.length ?? 0) === 0) return refusal('CG-SEND-RECEIPT');
    if (host.previewSend === null) return refusal('CG-SEND-HOST');
    const route = host.current().route;
    if (route.chat !== null && chatKeyOf(route.chat) === chatKeyOf(track.target.chat)) return refusal('CG-SEND-ACTIVE-CHAT');
    // No subscription check of ours (2026-10-20 audit, row 16): OnlyFans refuses a fan who left, and MAIN refuses what the page knows forbids.
    // A Fix whose draft moved on since is still the person's to send (2026-10-22): the result says so (`draftMoved`).
    // The send path lives in the tap script (the receipt observer, §6.7.6), and the tap is the page's own switch: the
    // adapter keeps one tap for the whole tab (on while any page has it), so a page whose `wsTap` is off sends nothing.
    if (!pageFlag(ctx, 'wsTap')) return refusal('CG-SEND-OFF');
    // The person's own text was written looking at the chat: no generation to be stale.
    if (track.manual !== null) return { ok: true };
    // Freshness (§6.7.5) is a warning the person may pass with «Отправить всё равно» (audit rows 3–4).
    if (track.fanWrote || view.stale?.reason === 'fan-wrote') return { ok: true, warn: 'CG-SEND-STALE' };
    if (track.checkpoint === null) return { ok: true, warn: 'CG-SEND-FRESHNESS' };
    const served = servedContextHold(track.checkpoint, view.servedContext);
    return served === null ? { ok: true } : { ok: true, warn: served === 'CG-SEND-STALE' ? 'CG-SEND-STALE' : 'CG-SEND-FRESHNESS' };
  }

  /** A part of another variant of this result reached ChatSpace's queue: this one's parts are not sent (X5, one greeting). */
  function otherVariantStarted(track: OpTrack, variant: number): boolean {
    const started = [...track.attempts].filter(([, attempt]) => attempt.view.state !== 'held' && attempt.view.state !== 'notEnqueued' && attempt.view.state !== 'ready').map(([key]) => Number(key.split(':')[0]));
    return started.length > 0 && !started.includes(variant);
  }

  /** The gate of one part: the result's own, the usable output of its variant, the «Новые» lease, then MAIN's answer. */
  function gateOf(track: OpTrack, variant: number): PreviewSendPreflight {
    const local = localGate(track);
    if (!local.ok) return local;
    const texts = partsOfResult(track.mirror.done?.result, variant);
    if (texts === null || greetingOutputProblem(texts) !== null) return refusal('CG-SEND-PART');
    // Parts of another variant are not sent once a part of one variant reached ChatSpace's queue.
    if (otherVariantStarted(track, variant)) return refusal('CG-SEND-PART');
    // «Новые»: no lease to hold (2026-10-20 audit, row 11) — the hub claims the fan at the send and says when a colleague greeted.
    const main = track.preflight ?? { ok: true };
    if (!main.ok) return main;
    if (track.manual !== null) return { ok: true };
    // The fan wrote, said by either side, is the warning shown over «cannot be checked».
    const warn = local.warn === 'CG-SEND-STALE' || main.warn === 'CG-SEND-STALE' ? 'CG-SEND-STALE' : (local.warn ?? main.warn);
    return warn === undefined ? { ok: true } : { ok: true, warn };
  }

  function requestOf(track: OpTrack, view: OpView, variant: number, index: number, text: string, attemptId: string, checkpoint: FreshnessCheckpoint): PreviewSendRequest | null {
    if (view.generationRef === undefined) return null;
    return {
      attemptId,
      target: track.target,
      generationRef: view.generationRef,
      part: partRef(track, variant, index),
      previewRevision: track.previewRevision,
      plainText: text,
      isAiGenerated: pageFlag(context.current(), 'previewSendMarkAiGenerated'),
      checkpoint,
      cause: DISPLAY_CAUSE,
    };
  }

  /** Asks MAIN, without side effects, whether the first unsent part could go now: the reason for the button. */
  async function refreshPreflight(track: OpTrack, view: OpView | null = track.mirror.done): Promise<void> {
    const port = host.previewSend;
    if (port === null || view === null || view.state !== 'done' || !localGate(track, view).ok) return;
    // A result restored after a reload has no checkpoint of its Generate: the page's other conditions are asked with one taken now.
    const checkpoint = track.checkpoint ?? (await host.checkpoint(track.target.chat).catch(() => null));
    if (checkpoint === null || disposed) return;
    const variant = Number([...track.attempts.keys()][0]?.split(':')[0] ?? 0);
    const texts = partsOfResult(view.result, variant) ?? [];
    const index = Math.max(
      0,
      texts.findIndex((_, i) => track.attempts.get(partKey(variant, i))?.view.state !== 'sentObserved'),
    );
    const text = texts[index];
    if (text === undefined) return;
    const request = requestOf(track, view, variant, index, text, ids.uuid(), checkpoint);
    if (request === null) return;
    const run = ++track.preflightRun;
    let answer: PreviewSendPreflight;
    try {
      answer = await port.preflight(request);
    } catch {
      answer = refusal('CG-SEND-HOST');
    }
    if (disposed || track.preflightRun !== run) return;
    track.preflight = answer;
    if ((answer.ok ? answer.warn : answer.code) === 'CG-SEND-STALE') markFanWrote(track, null);
    changedFor(track.handle);
  }

  const partRef = (track: OpTrack, variant: number, index: number): PartRef => (track.mirror.done?.result?.kind === 'variants' ? { variant, index } : { index });

  // ── part rows ──

  /**
   * Why a part of this result is not put into the fan's chat, by what is
   * known of the fan. §6.7.8, §6.7.9: one uncertain part holds the fan —
   * nothing of the fan is offered for insertion while it stands, whichever
   * result made it; one part is in work at a time. NF-017: an answer that
   * cannot be a message is copy-only. §6.5: a greeting of «Новые» needs its
   * lease until the first part is confirmed.
   */
  function fanHold(track: OpTrack, variant: number, sends: FanSends): ReasonVM | null {
    // An unknown outcome holds nothing (2026-10-20 audit, row 2); «Новые» needs no lease (row 11).
    if (sends.inFlight) return reason('parts-sending');
    const texts = partsOfResult(track.mirror.done?.result, variant);
    if (texts === null || greetingOutputProblem(texts) !== null) return reason('unparsed');
    return null;
  }

  /** Why a part of this result cannot be opened and inserted: the page, the switch and the host first, then what holds the fan. */
  function openInsertBlock(track: OpTrack, variant: number, sends: FanSends): ReasonVM | null {
    const ctx = context.current();
    if (ctx.phase !== 'ready') return reason('feature-disabled');
    if (!pageFlag(ctx, 'insertion')) return flagReasonVm(pageFlagOf(ctx, 'insertion'));
    const capabilities = host.current().contract.capabilities;
    if (capabilities.navigate.state !== 'on' || capabilities.insert.state !== 'on') return reason('host-degraded');
    return fanHold(track, variant, sends);
  }

  /** §6.5: what the dock that shows a result of this controller is told of one of its parts. */
  function dockedPart(opId: string, part: PartRef): BoardPartFacts | null {
    const track = tracks.get(opId);
    if (track === undefined || !docked.has(opId)) return null;
    const variant = part.variant ?? 0;
    const attempt = track.attempts.get(partKey(variant, part.index));
    if (attempt !== undefined && (attempt.resolved === 'sent' || attempt.view.state === 'sentObserved')) return { sentAt: attempt.sentAt ?? nowIso(), hold: null };
    return { sentAt: null, hold: fanHold(track, variant, fanSends(track.pageId, track.fanRef, track.opId)) };
  }

  /** `unpaced` — the row as it would be without the pause after a send (a warning keeps its words while the pause holds it). */
  function rowsOf(track: OpTrack, variant: number | null, index: number, unpaced = false): PartRows {
    const v = variant ?? 0;
    const key = partKey(v, index);
    const group = groupOf(track, v);
    const attempts = group === null ? [] : fanAttempts(track.attempts, purposeOf(track.source), group, track.clicked);
    const sends = fanSends(track.pageId, track.fanRef, track.opId);
    let row = sendRow({
      attempt: track.attempts.get(key) ?? null,
      clicked: track.clicked.has(key),
      gate: gateOf(track, v),
      staleAt: track.fanWroteAt ?? track.mirror.done?.stale?.at ?? null,
      nowIso: nowIso(),
      hostWaitsForChat: previewSendWaitsForChat(host.current().contract),
    });
    // Another variant went: the block stays (X5), said as what it is, not as a part gone stale.
    if (row.s === 'unavailable' && row.code === 'CG-SEND-PART' && otherVariantStarted(track, v)) row = { ...row, reason: msg('send.reason.otherVariant') };
    // A part of another result on its way: one part of the fan goes at a time (an unknown outcome holds nothing, row 2).
    if ((row.s === 'available' || row.s === 'held-stale' || row.s === 'unverified') && sends.inFlight && !attempts.some((attempt) => inFlight(attempt.state))) row = { s: 'unavailable', code: 'CG-SEND-BUSY', reason: msg(SEND_REASON_KEYS['CG-SEND-BUSY']) };
    // A send was clicked a moment ago (SEND_PACE_MS): the drafts of a batch never go out in one burst of clicks.
    if ((row.s === 'available' || row.s === 'held-stale' || row.s === 'unverified') && paced() && !unpaced) row = { s: 'unavailable', code: 'CG-SEND-BUSY', reason: msg('send.reason.pace') };
    // Decision X53: picked media that cannot go yet (the price, the release forms) hold the part's «Отправить».
    if (row.s === 'available' || row.s === 'held-stale' || row.s === 'unverified') {
      const attached = media.attachment(track.target.chat);
      if (attached.kind === 'blocked') row = { s: 'unavailable', code: 'CG-SEND-MEDIA', reason: attached.reason };
    }
    // An edit with nothing in it cannot go (MAIN refuses an empty text the same way).
    const edit = track.edits.get(key);
    if (edit !== undefined && edit.text.trim() === '' && (row.s === 'available' || row.s === 'held-stale' || row.s === 'unverified')) row = { s: 'unavailable', code: 'CG-SEND-PART', reason: msg(SEND_REASON_KEYS['CG-SEND-PART']) };
    // Chat Memory week 1: another chatter wrote to the fan in the last 15 minutes — a warning over what the row would be,
    // «Отправить всё равно» passes it (the warnings under it still ask for themselves after). Never a block.
    if ((row.s === 'available' || row.s === 'held-stale' || row.s === 'unverified') && track.talkAccepted !== true) {
      const talking = deps.talking?.mark(`page:${String(track.pageId)}:${track.fanRef}`) ?? deps.talking?.mark(chatKeyOf(track.target.chat)) ?? null;
      if (talking !== null) row = { s: 'held-talking', names: talking.names, at: talking.lastSentAt };
    }
    const settled = row.s === 'sent' || row.s === 'uncertain' || row.s === 'queued' || row.s === 'sending' || row.s === 'accepted';
    const order = group === null || settled ? null : partOrder(group, index, attempts);
    return {
      ...(deps.previewSend === false && row.s !== 'sent' ? {} : { send: row }),
      order,
      // «Открыть и вставить» puts the part as the card shows it into the chat: the person's edit, or their own text, goes as it is (2026-10-22).
      openInsert: edit !== undefined && edit.text.trim() === '' ? { s: 'hidden' } : openInsertRow({ row, waitingUntil: track.openInsert?.key === key ? track.openInsert.until : null, blocked: openInsertBlock(track, v, sends) }),
      editable: deps.previewSend !== false && track.manual === null && order === null && (row.s === 'available' || row.s === 'unavailable' || row.s === 'held-stale' || row.s === 'unverified' || row.s === 'held-talking' || (row.s === 'rejected' && row.canRetry)),
      ...(edit === undefined ? {} : { edit: edit.text }),
    };
  }

  function progress(track: OpTrack): { readonly variant: number; readonly sent: number; readonly total: number; readonly uncertainPart: number | null; readonly inFlight: boolean; readonly sentAt: string | null } | null {
    const variant = [...track.attempts.keys(), ...track.clicked].map((key) => Number(key.split(':')[0]))[0];
    if (variant === undefined) return null;
    const group = groupOf(track, variant);
    if (group === null) return null;
    const attempts = fanAttempts(track.attempts, purposeOf(track.source), group, track.clicked);
    const counts = progressOf(group, attempts);
    const uncertain = attempts.filter((attempt) => attempt.state === 'uncertain' && attempt.resolved === undefined).map((attempt) => attempt.partIndex).sort((a, b) => a - b)[0];
    const sentAt = [...track.attempts.values()].map((attempt) => attempt.sentAt).filter((at): at is string => at !== null).sort()[0] ?? null;
    return { variant, sent: counts.sent, total: counts.total, uncertainPart: uncertain ?? null, inFlight: attempts.some((attempt) => attempt.resolved === undefined && inFlight(attempt.state)), sentAt };
  }

  function reportProgress(track: OpTrack): void {
    if (track.source !== 'newcomers') return;
    batchChanged(track.handle);
    if (deps.greeting === null) return;
    const p = progress(track);
    deps.greeting.noteProgress(track.fanRef, p === null ? null : { sent: p.sent, total: p.total, uncertainPart: p.uncertainPart, inFlight: p.inFlight, sentAt: p.sentAt });
    touchDesk(track);
  }

  /** A state of an attempt, from the click's answer, the driver or the background. */
  function onAttemptView(view: SendAttemptView): void {
    const owner = attemptOwner.get(view.attemptId);
    if (owner === undefined) {
      // An attempt this tab knows only from the journal's list (another result's, or its own before a reload) moves on.
      for (const entry of listed.values()) {
        const item = entry.items.get(view.attemptId);
        if (item === undefined) continue;
        if (attemptReachable(item.view.state, view.state)) {
          entry.items.set(view.attemptId, { ...item, view, updatedAt: clock.now() });
          changed();
        } else if (item.view.state === view.state && view.state === 'uncertain') void loadSends(entry.pageId, entry.fanRef);
        return;
      }
      if (unclaimed.size > 64) unclaimed.clear();
      const before = unclaimed.get(view.attemptId);
      if (before === undefined || attemptReachable(before.state, view.state)) unclaimed.set(view.attemptId, view);
      // A delivered part nobody here began and no list names: the person sent it with ChatSpace's own Send after
      // «Открыть и вставить» (§6.6) — in this tab or in another. The journal says whose part it is: the open
      // cards read it. A click of this tab still on its way to the coordinator may be what is told; its own
      // answer brings the state then.
      if (view.state === 'sentObserved' && before === undefined && ![...tracks.values()].some((track) => track.clicked.size > 0)) {
        const fans = new Map<string, { readonly pageId: number; readonly fanRef: string }>();
        for (const of of [...targets.values(), ...[...docked].flatMap((opId) => tracks.get(opId) ?? [])]) fans.set(fanKey(of.pageId, of.fanRef), of);
        for (const fan of fans.values()) void loadSends(fan.pageId, fan.fanRef);
      }
      return;
    }
    const track = tracks.get(owner.opId);
    const current = track?.attempts.get(owner.key);
    if (track === undefined || current === undefined || current.attemptId !== view.attemptId) return;
    const moved = attemptReachable(current.view.state, view.state);
    const sameWithId = current.view.state === view.state && view.platformMessageId !== undefined && current.view.platformMessageId === undefined;
    // The same state again may bring the receipt's message id; anything else that is not ahead is late (RB-020).
    if (!moved && !sameWithId) {
      // An unknown outcome told again, unchanged: the background says so when the hub resolved it — the journal knows how.
      if (current.view.state === 'uncertain' && view.state === 'uncertain' && current.resolved === undefined) void loadSends(track.pageId, track.fanRef);
      return;
    }
    track.attempts.set(owner.key, {
      attemptId: view.attemptId,
      view,
      sentAt: view.state === 'sentObserved' ? (current.sentAt ?? nowIso()) : current.sentAt,
      uncertainSince: view.state === 'uncertain' ? (current.uncertainSince ?? nowIso()) : current.uncertainSince,
    });
    afterAttempt(track, view);
  }

  /**
   * A hold only the background could see ends (the hub's minute of the rate
   * limit passed, the greeting lease was taken again): the held attempt is
   * dropped and the row is the gate's again. Nothing reached ChatSpace under
   * a held attempt, so nothing is repeated — the next send is a new click.
   */
  function dropHold(track: OpTrack, key: string, code: CgCode): void {
    const attempt = track.attempts.get(key);
    if (attempt === undefined || attempt.view.state !== 'held' || attempt.view.code !== code) return;
    track.attempts.delete(key);
    reportProgress(track);
    changed();
    void refreshPreflight(track);
  }

  function clearHoldTimers(track: OpTrack): void {
    for (const timer of track.holdTimers.values()) clock.clearTimer(timer);
    track.holdTimers.clear();
  }

  function afterAttempt(track: OpTrack, view: SendAttemptView): void {
    // Decision X53: picks that went with this send are given back only when it proved it never reached the platform — also
    // to a chat whose card was closed meanwhile; a send that did, or may have, keeps them — they never go twice.
    const picked = mediaAttempts.get(view.attemptId);
    if (picked !== undefined && (view.state === 'rejected' || view.state === 'held' || view.state === 'notEnqueued')) {
      mediaAttempts.delete(view.attemptId);
      media.restore(picked.chat, picked.taken);
    } else if (picked !== undefined && (view.state === 'nativeAccepted' || view.state === 'sentObserved' || view.state === 'uncertain')) mediaAttempts.delete(view.attemptId);
    // The person's own text left the draft field at the click (2026-10-23 audit): by the same rule as the picks, a send
    // that proved it never reached the platform gives it back to the field; one that did, or may have, never does.
    if (track.fromDraft !== null) {
      if (view.state === 'rejected' || view.state === 'held' || view.state === 'notEnqueued') giveDraftBack(track);
      else if (view.state === 'nativeAccepted' || view.state === 'sentObserved' || view.state === 'uncertain') track.fromDraft = null;
    }
    if (view.state === 'held' && view.code === 'CG-SEND-STALE') markFanWrote(track, null);
    if (view.code === 'CG-CLAIM-EXPIRED' || view.code === 'CG-CLAIM-BUSY') deps.greeting?.noteRefusal(track.fanRef, view.code);
    if (view.state === 'held' && view.code === 'CG-HUB-RATE-LIMIT') {
      const key = attemptOwner.get(view.attemptId)?.key;
      if (key !== undefined && !track.holdTimers.has(key)) {
        track.holdTimers.set(
          key,
          clock.setTimer(RATE_LIMIT_HOLD_MS, () => {
            track.holdTimers.delete(key);
            if (!disposed && tracks.get(track.opId) === track) dropHold(track, key, 'CG-HUB-RATE-LIMIT');
          }),
        );
      }
    }
    // NF-012, decision X47: a draft lives until it is sent or cleared. The greeting draft has done its work once a
    // part is confirmed; the draft a Fix was made from — once every part of that Fix is (earlier, the parts still to go
    // would lose the revision they answer).
    // A draft the person changed after the Fix is their new text: it stays.
    if (view.state === 'sentObserved' && (track.source === 'newcomers' || (track.feature === 'fix' && draftRevision(track) === track.previewRevision && fixSent(track, view.attemptId)))) {
      const key = ownerKey(track.source, track.pageId, track.fanRef);
      if (key !== null && findDraft(drafts, key, clock.now()) !== null) {
        drafts = removeDraft(drafts, key, clock.now());
        saveDrafts();
        draftsChanged();
      }
    }
    // Our message is the newest now: whether the fan read it is read again (after the rest, so the list shows it).
    if (view.state === 'sentObserved') {
      seen.drop(fanKey(track.pageId, track.fanRef));
      const state = shownOn(track);
      if (state !== null) wantSeen(state);
    }
    reportProgress(track);
    // A send holds the fan on every card of the fan, not only on the one of this result.
    changed();
    if (!inFlight(view.state)) void refreshPreflight(track);
  }

  /** Every part of the variant this attempt belongs to is confirmed sent (a Fix whose draft has done its work). */
  function fixSent(track: OpTrack, attemptId: string): boolean {
    const owner = attemptOwner.get(attemptId)?.key ?? [...track.attempts].find(([, attempt]) => attempt.attemptId === attemptId)?.[0];
    if (owner === undefined) return false;
    const variant = Number(owner.split(':')[0] ?? 0);
    const texts = partsOfResult(track.mirror.done?.result, variant);
    return texts !== null && texts.length > 0 && texts.every((_, index) => {
      const attempt = track.attempts.get(partKey(variant, index));
      return attempt !== undefined && (attempt.view.state === 'sentObserved' || attempt.resolved === 'sent');
    });
  }

  /** Receipt and echo already proved this human send; no dispatch or X8 read. */
  function manualSent(opId: string, part: PartRef, platformMessageId: string): void {
    if (disposed || deps.previewSend !== false) return;
    const track = tracks.get(opId);
    if (track === undefined || identityChanged(track) || partsOfResult(track.mirror.done?.result, part.variant ?? 0)?.[part.index] === undefined) return;
    const key = partKey(part.variant ?? 0, part.index);
    if (track.attempts.get(key)?.view.state === 'sentObserved') return;
    const attemptId = ids.uuid();
    const view: SendAttemptView = { attemptId, state: 'sentObserved', platformMessageId };
    track.attempts.set(key, { attemptId, view, sentAt: nowIso(), uncertainSince: null });
    afterAttempt(track, view);
  }

  // ── view model ──

  function feedItems(state: TargetState): FeedItemVM[] {
    const feed = state.feed;
    if (feed === null) return [];
    if (state.rows === null || state.rows.feed !== feed || state.rows.language !== i18n.language) {
      state.rows = { feed, language: i18n.language, items: feedRows(feed, (at) => i18n.formatTime(at, 'day'), i18n.t('preview.feed.deleted')) };
    }
    return state.rows.items;
  }

  function contextBlock(ctx: PageContextState, state: TargetState | null): VmView | null {
    const retry: UiAction | null = state === null ? null : { type: 'RefreshArchive', targetHandle: state.handle };
    if (ctx.phase === 'loading') return loadingView(null);
    if (ctx.phase === 'blocked') return failureView(ctx.blocker ?? { code: 'CG-UNKNOWN' }, i18n, retry);
    if (!pageFlag(ctx, 'preview')) return failureView(flagFailure(ctx, 'preview'), i18n, retry);
    return null;
  }

  /** `draftSource` — the text a Fix rewrites when it is not the card's draft («Рассылка»: the common text). */
  function gateReason(state: TargetState, feature: PreviewActionId, otherRunning: boolean, draftSource?: string): ReasonVM | null {
    const ctx = context.current();
    if (ctx.phase !== 'ready') {
      const code = ctx.blocker?.code;
      const id: BoardReasonId = code === 'CG-AUTH-REQUIRED' || code === 'CG-AUTH-REVOKED' || code === 'CG-AUTH-EXPIRED' ? 'not-signed-in' : code === 'CG-BINDING-NOT-GRANTED' ? 'not-granted' : code === 'CG-BINDING-MISSING' || code === 'CG-BINDING-AMBIGUOUS' ? 'no-binding' : 'hub-down';
      return reason(id);
    }
    if (!pageFlag(ctx, 'preview')) return flagReasonVm(pageFlagOf(ctx, 'preview'));
    if (ctx.persona === null) return reason('no-persona');
    // R20 P8a (FS-IDN-6): no chat of the fan is known — nothing starts on the fan's id in its place.
    if (conversationNow(state) === null) return reason('conversation-unknown');
    if (otherRunning) return reason('chat-busy');
    // One part is in work at a time: a new generation would take the result whose part is on its way off the card. An
    // unknown outcome holds nothing (2026-10-20 audit, row 2): the person looks at the chat and goes on.
    const sends = fanSends(state.pageId, state.fanRef, currentOp.get(state.handle) ?? null);
    if (sends.inFlight) return reason('parts-sending');
    if (feature === 'fix' && (draftSource ?? draftText(state)).trim().length === 0) return reason('needs-draft');
    // Hi has no message limit (the owner, 2026-10-21): only the fan's greeting holds it.
    if (feature === 'hi' && state.source === 'newcomers') {
      const blocked = deps.greeting?.hiBlocked(state.fanRef) ?? null;
      if (blocked !== null) return blocked;
    }
    // Ping only from ten messages (2026-10-21): the archive's whole thread, read to its start, is shorter. The count is
    // the hub's own (`gate_min_messages`): every stored message, the rows of the feed as they came.
    if (feature === 'ping' && state.feed !== null && state.feed.nextOlderCursor === null && state.feed.items.length < MIN_MESSAGES_FOR_PING) return reason('ping-few');
    return null;
  }

  function barOf(state: TargetState, track: OpTrack | null): PreviewVM['bar'] {
    const running = track !== null && !isTerminalOpState(track.mirror.state);
    const actions: Partial<Record<PreviewActionId, DockActionVM>> = {};
    for (const feature of featuresOf(state.source)) {
      const busy = running && track.feature === feature;
      const why = busy ? null : gateReason(state, feature, running);
      actions[feature] = { enabled: why === null, busy, active: track !== null && track.feature === feature && !track.hidden && !running, reason: why, hotkey: null, badge: null };
    }
    const locked = running ? reason('locked-during-generation') : null;
    return { actions, tone: state.tone, tones: TONES, split: context.current().settings?.generation.split ?? false, locked: running, toneReason: locked, splitReason: locked };
  }

  function closedVM(source: PreviewSource): PreviewVM {
    const off = reason('send-unavailable');
    return {
      view: { s: 'empty', why: msg('preview.empty') },
      from: source,
      handle: null,
      header: null,
      openChat: button('common.openChat', CLOSE_PREVIEW, { enabled: false, reason: off }),
      close: CLOSE_PREVIEW,
      unread: 'kept',
      archive: { stamp: stamp(null, 'unknown'), lagMinutes: null, refreshing: false, refresh: button('common.refreshArchive', CLOSE_PREVIEW, { enabled: false, reason: off }) },
      fanWroteNew: false,
      seen: null,
      feed: { items: [], hasOlder: false, loadingOlder: false, olderError: null },
      ping: null,
      draft: { text: '', maxChars: SEND_LIMITS.previewDraftMaxChars, placeholder: msg(draftPlaceholder(source)) },
      bar: { actions: {}, tone: null, tones: TONES, split: false, locked: false, toneReason: null, splitReason: null },
      result: null,
      media: null,
      idleHint: null,
      neighbors: { previous: null, next: null },
      claim: null,
      greeting: null,
      stoppedNote: null,
    };
  }

  /** Decision X53: the picker where a part may be sent from this card — the page's preview send, a host with a vault. */
  function mediaVm(state: TargetState): PreviewVM['media'] {
    const chat = chatOf(state);
    if (chat === null || deps.sender === null || deps.previewSend === false || !media.available || !pageFlag(context.current(), 'previewSend')) return null;
    return media.vm(chat);
  }

  function build(source: PreviewSource): PreviewVM {
    const handle = surfaces.current().preview[source];
    const state = handle === null ? undefined : targets.get(handle);
    if (handle === null || state === undefined) return closedVM(source);
    const ctx = context.current();
    const info = infoNow(state);
    const feed = state.feed;
    const opId = currentOp.get(handle);
    const track = opId === undefined ? null : (tracks.get(opId) ?? null);
    const lag = feed === null ? null : archiveLag(feed);

    let view: VmView;
    const blocked = contextBlock(ctx, state);
    if (blocked !== null) view = blocked;
    else if (feed === null) view = state.feedError !== null ? failureView(state.feedError, i18n, { type: 'RefreshArchive', targetHandle: handle }) : loadingView(state.feedSince);
    else {
      const gaps: PartialGap[] = [];
      if (feed.coverage !== 'complete') gaps.push({ kind: 'coverage', level: feed.coverage });
      if (lag !== null) gaps.push({ kind: 'archive-lag', messages: null, minutes: lag.minutes });
      if (feed.truncated) gaps.push({ kind: 'truncated', shown: feed.items.length, total: null });
      if (state.feedLoading) gaps.push({ kind: 'stale-cache', asOf: feed.asOf });
      if (state.feedError !== null) {
        view = failureClass(state.feedError.code) === 'error' ? dataView([...gaps, { kind: 'source-failed', source: 'feed', code: state.feedError.code }]) : failureView(state.feedError, i18n, { type: 'RefreshArchive', targetHandle: handle }, state.feedLoadedAt);
      } else if (feed.items.length === 0 && gaps.length === 0) {
        view = { s: 'empty', why: info.newcomer === null ? msg('preview.feed.empty') : msg('preview.feed.emptySubscribed', { name: info.name, age: { age: info.newcomer.subscribedAt } }) };
      } else view = dataView(gaps);
    }

    const card = state.card;
    const shown = track !== null && !track.hidden ? track : null;
    const p = shown === null ? null : progress(shown);
    const sendStarted = shown !== null && (shown.clicked.size > 0 || [...shown.attempts.values()].some((attempt) => attempt.view.state !== 'ready' && attempt.view.state !== 'held'));
    const result =
      shown === null
        ? null
        : previewResult({
            mirror: shown.mirror,
            feature: shown.feature,
            surface: shown.surface,
            startedAt: shown.startedAt,
            now: clock.now(),
            targetName: info.name,
            toneUsed: shown.toneUsed,
            splitRequested: shown.splitRequested,
            expanded: shown.expanded,
            cachedAt: shown.cachedAt,
            fixSource: shown.fixSource,
            unusable: unusable(shown),
            i18n,
            rows: (variant, index) => rowsOf(shown, variant, index),
            copy: (variant, index) => shown.copy.get(partKey(variant, index)) ?? 'idle',
            progress: p !== null && p.sent > 0 ? { sent: p.sent, total: p.total } : null,
            sendStarted,
            regenerate: regenerateRule(shown),
            own: shown.manual !== null,
            draftMoved: shown.feature === 'fix' && draftRevision(shown) !== shown.previewRevision,
          });
    // The fan's sends over every result made for the fan, not only the one on the card.
    const sends = fanSends(state.pageId, state.fanRef, shown?.opId ?? null);

    const around = deps.directories[source]?.neighbours(handle) ?? { previous: null, next: null };
    const openChat: UiAction = { type: 'Navigate', to: { kind: 'chat', targetHandle: handle } };
    // R20 P8a: a chat nobody knows cannot be opened — the fan's id names none on Fansly.
    const chatUnknown = ctx.phase === 'ready' && conversationOfTarget(info, ctx.binding?.platform ?? null) === null;
    return {
      view,
      from: source,
      handle,
      header: {
        name: info.name,
        username: info.username,
        lifetime: info.lifetime ?? card?.metrics.lifetime.scopeGrossAmountMills ?? null,
        period30: info.period30 ?? card?.metrics.window?.grossAmountMills ?? null,
        weWroteAt: info.weWroteAt,
        fanWroteAt: info.fanWroteAt,
        newcomer: info.newcomer,
        badges: info.badges ?? null,
      },
      openChat: button('common.openChat', openChat, chatUnknown && deps.directories[source]?.canResolve !== true ? { enabled: false, reason: reason('conversation-unknown') } : {}),
      close: CLOSE_PREVIEW,
      unread: seen.raced(fanKey(state.pageId, state.fanRef)) ? 'read-by-check' : sendStarted || sends.started ? 'read-after-send' : 'kept',
      archive: {
        stamp: stamp(feed?.asOf ?? null, feed?.coverage ?? 'unknown'),
        lagMinutes: lag?.minutes ?? null,
        refreshing: state.feedLoading,
        refresh: button('common.refreshArchive', { type: 'RefreshArchive', targetHandle: handle }, { enabled: !state.feedLoading }),
      },
      fanWroteNew: shown !== null && (shown.fanWrote || shown.mirror.done?.stale?.reason === 'fan-wrote'),
      seen: blocked === null ? seen.vm(fanKey(state.pageId, state.fanRef), feedItems(state)) : null,
      feed: {
        items: feedItems(state),
        hasOlder: !chatUnknown && feed !== null && feed.nextOlderCursor !== null,
        loadingOlder: state.olderLoading,
        olderError: state.olderError === null ? null : errorOf(state.olderError, i18n),
      },
      ping: source === 'newcomers' || feed === null || feed.ping === null ? null : { segment: feed.ping.segment, fanSilenceDays: feed.ping.fanSilenceDays },
      draft: { text: draftText(state), maxChars: SEND_LIMITS.previewDraftMaxChars, placeholder: msg(draftPlaceholder(source)), ...draftSendOf(state, shown) },
      bar: barOf(state, track),
      result,
      media: mediaVm(state),
      // «Новые» offers Hi alone: its hint names only Hi.
      idleHint: result === null && feed !== null && blocked === null ? msg(source === 'newcomers' ? 'preview.emptyNewcomers' : 'preview.empty') : null,
      neighbors: {
        previous: around.previous === null ? null : { type: 'OpenPreview', targetHandle: around.previous },
        next: around.next === null ? null : { type: 'OpenPreview', targetHandle: around.next },
      },
      claim: source === 'newcomers' && deps.greeting !== null ? deps.greeting.claim(state.fanRef) : null,
      greeting: source === 'newcomers' && deps.greeting !== null ? deps.greeting.greeting(state.fanRef) : null,
      // An unknown outcome stops nothing (row 2): its own part says it, with «Открыть чат» and «Отправить ещё раз».
      stoppedNote: null,
    };
  }

  /** NF-017: the parts of the variant in work (or the first one) cannot be sent as they are. */
  function unusable(track: OpTrack): boolean {
    const result = track.mirror.done?.result;
    if (result === undefined) return false;
    if (result.kind === 'parts') return greetingOutputProblem(result.parts) !== null;
    if (result.kind === 'variants') return result.variants.every((texts) => greetingOutputProblem(texts) !== null);
    return false;
  }

  /**
   * «Ещё раз» (ui-design §4.2): off while a part to the fan is on its way or
   * its outcome is unknown — by any result of the fan — and, in «Новые»,
   * once a part of the greeting is confirmed: another generation would be a
   * second greeting (§6.7.9).
   */
  function regenerateRule(track: OpTrack): { readonly allowed: boolean; readonly reason: ReasonVM | null } {
    // The person's own text has no generation to make again.
    if (track.manual !== null) return { allowed: false, reason: null };
    const sends = fanSends(track.pageId, track.fanRef, track.opId);
    if (sends.inFlight) return { allowed: false, reason: reason('parts-sending') };
    if (track.source === 'newcomers') {
      const blocked = deps.greeting?.hiBlocked(track.fanRef) ?? null;
      if (blocked !== null) return { allowed: false, reason: blocked };
    }
    return { allowed: true, reason: null };
  }

  // ── actions: generation ──

  function runningVMs(active: readonly { readonly opId: string; readonly feature: string; readonly chat: Target['chat']; readonly fanLabel: string | null; readonly startedAt: number; readonly inThisTab: boolean }[]): RunningOpVM[] {
    const binding = context.current().binding;
    return active.map((op) => ({
      opId: op.opId,
      feature: op.feature,
      fanLabel: op.fanLabel,
      startedAt: op.startedAt,
      inThisTab: op.inThisTab,
      // A running chat of this account opens by its handle; one of another account is reached from the palette.
      go:
        binding !== null && op.chat.hostAccountId === binding.hostAccountId
          ? { type: 'Navigate', to: { kind: 'chat', targetHandle: fanHandle('spenders', binding.pageId, op.chat.platformFanId) } }
          : { type: 'Navigate', to: { kind: 'surface', surface: 'palette', open: true } },
      cancel: { type: 'CancelGeneration', operationId: op.opId },
    }));
  }

  /**
   * `outreach` — «Рассылка»'s Fix of a batch: the common text is the draft (the card's own draft stays as it is), the hub
   * makes it personal for this fan (`draftPurpose: 'outreach'`), one message, never split. `windowed` — the window of the
   * card's list asked for it («Рассылка», «Онлайн»): their cards start nothing of their own.
   */
  async function generate(type: UiActionType, state: TargetState, feature: FeatureId, options: UserOptions, regenerateOf: OpTrack | null, outreach: { readonly draft: string } | null = null, windowed = outreach !== null): Promise<ActionReceipt> {
    // §6.7.8: a part with an unknown outcome holds the fan even when this tab does not remember it (a reload) or never
    // made it (another tab). So every Generate asks the background's journal for the fan's sends first — one local read —
    // and nothing is generated for a fan whose sends it did not tell.
    const journal = await sendsNow(state.pageId, state.fanRef);
    if (journal !== null || targets.get(state.handle) !== state) return refused(type, localError(journal ?? 'CG-CONTEXT-CHANGED', i18n));
    const ctx = context.current();
    const allowed = featuresOf(state.source);
    const known = allowed.find((f) => f === feature);
    // On the cards of «Рассылка» and «Онлайн» only the window writes (the outreach's Fix of the common text; Reply, Hi or
    // Ping of «Онлайн»): no key or button of the card starts another.
    if (known === undefined || (state.source === 'outreach' && outreach === null) || (fromWindow(state.source) && !windowed)) return refused(type, localError('CG-FEATURE-DISABLED', i18n));
    const existing = currentOp.get(state.handle);
    const current = existing === undefined ? null : (tracks.get(existing) ?? null);
    if (current !== null && !isTerminalOpState(current.mirror.state)) {
      // A click while this chat generates shows what is running; nothing new starts (§7).
      if (current.feature === feature) {
        current.hidden = false;
        changedFor(state.handle);
        return done(type, 'noop', { opId: current.opId });
      }
      return refused(type, localError('CG-OP-CHAT-BUSY', i18n));
    }
    const why = gateReason(state, known, false, outreach?.draft);
    if (why !== null) return refused(type, localError(reasonCode(why), i18n));
    const binding = ctx.binding;
    const settings = ctx.settings;
    const bootstrap = ctx.bootstrap;
    if (binding === null || settings === null || bootstrap === null) return refused(type, localError('CG-HUB-UNAVAILABLE', i18n));

    const chat = { host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: state.fanRef };
    // The fan's conversation as its list resolved it (on Fansly the group id), never the route of the chat on screen,
    // and never the fan's id where a chat has an id of its own (R20 P8a, FS-IDN-6; the gate above said so already).
    const conversationRef = conversationOfTarget(state.info, binding.platform);
    if (conversationRef === null) return refused(type, localError('CG-DATA-NOT-READY', i18n));
    const target: Target = { binding, chat, fanRef: state.fanRef, conversationRef };
    const atEpoch = epoch;
    // The click is the person working with the fan. «Something is in flight» is said only once an operation
    // really started: a refused Generate must not keep the greeting lease renewing with nobody at the card (NF-021).
    touchDesk(state);
    let leaseTaken = false;
    /** The Generate was refused after the lease: a lease this very click took goes back, and nothing is left «in flight». */
    const refusedAfterLease = (receipt: ActionReceipt): ActionReceipt => {
      if (leaseTaken) deps.greeting?.giveBack(state.fanRef);
      touchDesk(state);
      return receipt;
    };
    // §6.7.5: the checkpoint is taken at the click — before the lease and before the hub request.
    const checkpoint: FreshnessCheckpoint | null = await host.checkpoint(chat).catch(() => null);
    if (state.source === 'newcomers' && deps.greeting !== null) {
      const lease = await deps.greeting.claimForGenerate(state.fanRef);
      if (!lease.ok) return refused(type, lease.error);
      leaseTaken = lease.taken;
    }
    const issued = await issueCause(rpc, 'generate', surfaceOf(state.source));
    // Another sign-in, hub or account meanwhile: the leases of the old identity are already dropped.
    if (disposed || atEpoch !== epoch) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    if (!issued.ok) return refusedAfterLease(refused(type, localError(issued.code, i18n)));

    const source = outreach?.draft ?? draftText(state);
    const tone = feature === 'reply' ? (regenerateOf !== null ? regenerateOf.toneUsed : options.tone !== undefined ? options.tone : state.tone) : null;
    // A window's text is one message, never split: one click sends it whole.
    const split = windowed ? false : regenerateOf !== null ? regenerateOf.splitRequested : (options.split ?? settings.generation.split);
    const start: StartOp = {
      feature,
      surface: surfaceOf(state.source),
      target,
      cause: issued.cause,
      tone,
      split,
      window: options.window ?? messageWindowFor(feature, settings.generation.windows, bootstrap.limits.deepMax),
      ...(feature === 'fix' ? { draft: { text: source, revision: draftRevision(state), digest: digestHex(source) } } : {}),
      ...(feature === 'fix' && outreach !== null ? { draftPurpose: 'outreach' as const } : {}),
      ...(feature === 'hi' ? { variantCount: state.source === 'newcomers' || state.source === 'online' ? (1 as const) : (options.variants ?? 3) } : {}),
      ...(checkpoint === null ? {} : { checkpoint }),
      ...(regenerateOf === null ? {} : { regenerateOf: regenerateOf.opId, force: true }),
      // 1.20.0 (X47): the name the list already shows, for «Идут сейчас» — display only, never sent to the hub.
      ...(fanLabelOf(state.info) === null ? {} : { fanLabel: fanLabelOf(state.info) as string }),
    };
    const admission = await rpc.request('op.start', start);
    if (disposed || atEpoch !== epoch) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    if (!admission.ok) return refusedAfterLease(refused(type, errorOf(admission.error, i18n)));
    if (!admission.payload.ok) {
      return refusedAfterLease({ ok: false, type, code: admission.payload.code, error: localError(admission.payload.code, i18n), running: runningVMs([...admission.payload.active, ...(admission.payload.siteActive ?? [])].sort((a, b) => a.startedAt - b.startedAt)) });
    }
    const opId = admission.payload.opId;
    if (type === 'GenerateBatch') noteBatchOp(batchOps, opId);
    // The tone was for this one Reply (Б1).
    if (feature === 'reply') state.tone = null;
    let track = tracks.get(opId);
    if (track === undefined) {
      const now = clock.now();
      track = {
        ...trackOf({ opId, feature, surface: start.surface, target, state: 'admitted', phase: { name: 'admitted', since: now }, startedAt: now, toneUsed: tone }, state, {
          checkpoint,
          previewRevision: draftRevision(state),
          fixSource: feature === 'fix' ? source : null,
          splitRequested: split,
          personaDefinitionId: ctx.persona?.definitionId ?? null,
        }),
        mirror: newMirror(opId, { name: 'admitted', since: now }),
      };
      tracks.set(opId, track);
      // The same request may have reopened a finished result: nothing more would arrive for it.
      void syncOp(track);
    } else {
      track.hidden = false;
      track.cachedAt = track.mirror.done?.endedAt ?? null;
    }
    currentOp.set(state.handle, opId);
    // An operation runs now: the lease of «Новые» renews for as long as it does.
    touchDesk(state);
    pruneTracks();
    changedFor(state.handle);
    return done(type, 'started', { opId });
  }

  // ── a batch of a list (1.32.0) ──

  /** The first part of a finished result, as its card shows it. */
  function firstPart(view: OpView | null): string | null {
    const result = view?.result;
    if (result?.kind === 'parts') return result.parts[0] ?? null;
    if (result?.kind === 'variants') return result.variants[0]?.[0] ?? null;
    return null;
  }

  /** The batch that waits for this result hears how it ended. */
  function settleBatch(track: OpTrack, outcome?: BatchOutcome): void {
    const settle = batchWaiters.get(track.opId);
    const view = track.mirror.done;
    if (settle === undefined || (outcome === undefined && view === null)) return;
    batchWaiters.delete(track.opId);
    // «Рассылка»: a fan whose version is ready takes the outreach's media now, so its release forms are read before the click.
    if (view?.state === 'done' && track.source === 'outreach') adoptOutreach(track.target.chat);
    settle(outcome ?? (view?.state === 'done' ? { s: 'ready', text: firstPart(view) } : { s: 'failed', code: view?.error?.code ?? 'CG-OP-INTERRUPTED' }));
  }

  /** The outreach's media into this fan's picker, unless the person picked the fan's own there. */
  function adoptOutreach(chat: ChatRef): void {
    if (!outreachOn) return;
    const key = chatKeyOf(chat);
    if (media.adopt(chat, outreachMedia, adopted.get(key) ?? null)) adopted.set(key, outreachMedia);
  }

  /** The outreach's sheet changed: its media are every fan's of the outreach whose picks are not their own. */
  function syncOutreach(): void {
    const chat = outreachChat();
    const next = chat === null ? EMPTY_ATTACHMENT : media.current(chat);
    if (next !== outreachMedia) {
      outreachMedia = next;
      outreachChanged();
    } else for (const listener of [...batchListeners]) listener();
  }

  /** The outreach's media go to every fan of its batch whose version is ready; the rows and the window say so. */
  function outreachChanged(): void {
    for (const handle of batched.keys()) {
      const track = tracks.get(currentOp.get(handle) ?? '');
      if (track !== undefined && track.source === 'outreach' && track.mirror.done?.state === 'done') adoptOutreach(track.target.chat);
    }
    changed();
    for (const listener of [...batchListeners]) listener();
  }

  /** The outreach's (or a fan's) picks as the window shows them: the media in order, the price, what is wrong. */
  function outreachMediaOf(attachment: Attachment): OutreachMediaVM | null {
    if (attachment.picks.length === 0) return null;
    const price = parsePrice(attachment.price);
    const problem = attachmentProblem(attachment);
    return {
      items: attachment.picks.map((pick) => ({ id: pick.id, type: pick.type, duration: pick.duration, thumb: pick.thumb, free: pick.free })),
      posts: 0,
      priceCents: price.ok ? price.cents : 0,
      problem: problem === null ? null : problem.kind === 'all-free' ? msg('preview.media.allFree') : msg(PRICE_PROBLEM_KEYS[problem.problem]),
    };
  }

  /**
   * The fan's text on their card of a window (one message, never split): «Рассылка»'s version, or what «Онлайн» wrote
   * (Reply, Hi, Ping, a text of the team's guide) — the text that goes, its send, its media.
   */
  function outreachRow(handle: TargetHandle): OutreachCardRow | null {
    const track = tracks.get(currentOp.get(handle) ?? '');
    if (track === undefined || !fromWindow(track.source) || track.hidden || track.mirror.done?.state !== 'done') return null;
    const first = partsOfResult(track.mirror.done.result, 0)?.[0];
    if (first === undefined) return null;
    // The row before the pause after a send: the pause holds the button, it does not change what the button says.
    const rows = rowsOf(track, 0, 0, true);
    const edit = track.edits.get(partKey(0, 0));
    const chat = track.target.chat;
    const current = media.current(chat);
    // «Онлайн» has no media of its own: what goes with its text is what the person picked for the fan, if anything.
    const ownMedia = current.picks.length > 0 && (track.source === 'online' || current !== adopted.get(chatKeyOf(chat)));
    const send = rows.send ?? null;
    const goes = send !== null && (send.s === 'available' || send.s === 'unverified' || send.s === 'held-stale' || send.s === 'held-talking' || (send.s === 'rejected' && send.canRetry));
    const paused = goes && paced();
    const state = targets.get(handle) ?? null;
    return {
      opId: track.opId,
      text: edit?.text ?? first,
      edited: edit !== undefined,
      editable: rows.editable === true,
      send,
      can: send?.s === 'available' && rows.order === null && !paused,
      paused,
      // Before the fan's picks take the outreach's (the version is not ready yet), what will go is the outreach's.
      media: outreachMediaOf(current.picks.length > 0 || ownMedia || track.source === 'online' ? current : outreachMedia),
      ownMedia,
      archiveAt: state?.feed?.asOf ?? null,
    };
  }

  function batchLive(handle: TargetHandle): { readonly text: string | null; readonly sent: boolean } | null {
    const track = tracks.get(currentOp.get(handle) ?? '');
    if (track === undefined || track.mirror.done === null) return null;
    const sent = progress(track);
    return { text: firstPart(track.mirror.done), sent: sent !== null && sent.total > 0 && sent.sent >= sent.total };
  }

  function batchNext(handle: TargetHandle): BatchNext | null {
    const track = tracks.get(currentOp.get(handle) ?? '');
    if (track === undefined || track.hidden || track.mirror.done?.state !== 'done') return null;
    const next = rowPart(handle);
    if (next === null) return { opId: track.opId, part: null, text: firstPart(track.mirror.done), send: null, waits: false };
    const parts = partsOfResult(track.mirror.done.result, 0) ?? [];
    return { opId: track.opId, part: next.index, text: parts[next.index] ?? null, send: next.rows.send ?? null, waits: next.rows.order !== null };
  }

  /**
   * The part a «Новые» row's «Отправить» sends (X59 on a hub's list): the next part of the fan's greeting that has not
   * gone, as the card's «Отправить →» holds it; null — none waits.
   */
  function rowPart(handle: TargetHandle): { readonly track: OpTrack; readonly index: number; readonly rows: PartRows } | null {
    const track = tracks.get(currentOp.get(handle) ?? '');
    // X59 on a hub's «Новые»; «Рассылка» while its window exists; «Онлайн».
    if (track === undefined || (track.source !== 'newcomers' && track.source !== 'online' && !(outreachOn && track.source === 'outreach')) || track.hidden || track.mirror.done?.state !== 'done') return null;
    const parts = partsOfResult(track.mirror.done.result, 0) ?? [];
    for (let index = 0; index < parts.length; index += 1) {
      const rows = rowsOf(track, 0, index);
      if (rows.send?.s !== 'sent') return { track, index, rows };
    }
    return null;
  }

  function batchSend(handle: TargetHandle): NewcomerRowSendVM | null {
    const next = rowPart(handle);
    const send = next?.rows.send;
    if (next === null || send === undefined) return null;
    // Only what the card would send by one plain click: a warning («фан написал новое») or a part in work is the card's.
    const can = send.s === 'available' && next.rows.order === null;
    // «Рассылка»: a version made with the chat closed is unverified; its row may pass that, as the card's «Отправить всё равно».
    const anyway = next.track.source === 'outreach' && send.s === 'unverified' && next.rows.order === null && !paced();
    const refusedNow = send.s === 'rejected' && !send.canRetry ? { code: send.code, retryAt: null } : null;
    // The pause after a send (SEND_PACE_MS) is no fault of this draft: the row says so, not «откройте фана».
    const base = anyway ? { can, refused: refusedNow, anyway: true } : { can, refused: refusedNow };
    return send.s === 'unavailable' && send.reason.key === 'send.reason.pace' ? { ...base, paused: true } : base;
  }

  /**
   * «Отправить всем» of «Новые»: the greeting's next part would go now by its row's click; it waits (the pause, the
   * hub's minute, an earlier part on its way); every part went or is on its way; or it cannot go by a plain click (a
   * warning, a refusal, an unknown outcome — never passed or sent again by the run).
   */
  function batchSendState(handle: TargetHandle): BatchSendState {
    if (deps.previewSend === false) return 'no';
    const track = tracks.get(currentOp.get(handle) ?? '');
    if (track === undefined || track.source !== 'newcomers' || track.hidden || track.mirror.done?.state !== 'done') return 'no';
    const parts = partsOfResult(track.mirror.done.result, 0) ?? [];
    let going = false;
    for (let index = 0; index < parts.length; index += 1) {
      const rows = rowsOf(track, 0, index);
      const send = rows.send;
      if (send === undefined) return 'no';
      if (send.s === 'sent') continue;
      if (send.s === 'queued' || send.s === 'sending' || send.s === 'accepted') {
        going = true;
        continue;
      }
      if (going) return 'wait';
      if (send.s === 'available') return rows.order === null ? 'now' : 'wait';
      if (send.s === 'unavailable' && (send.reason.key === 'send.reason.pace' || send.code === 'CG-HUB-RATE-LIMIT' || send.code === 'CG-SEND-BUSY')) return 'wait';
      return 'no';
    }
    return 'done';
  }

  function batchSendNow(handle: TargetHandle): Promise<ActionReceipt> {
    const type = 'SendNewcomerGreeting';
    const next = rowPart(handle);
    if (next === null) return Promise.resolve(refused(type, localError('CG-SEND-PART', i18n)));
    return deps.previewSend === false ? Promise.resolve(refused(type, localError('CG-FEATURE-DISABLED', i18n))) : sendPart(type, next.track, 0, next.index);
  }

  /** A row of a batch follows its fan's result only when what it shows changes — never on every streamed word. */
  function batchChanged(handle: TargetHandle): void {
    const last = batched.get(handle);
    if (last === undefined) return;
    const live = batchLive(handle);
    const send = batchSend(handle);
    const now = live === null ? '' : `${live.sent ? 1 : 0}${send === null ? '-' : `${send.can ? 1 : 0}${send.paused === true ? 'p' : ''}${send.anyway === true ? 'a' : ''}${send.refused?.code ?? ''}`}${live.text ?? ''}`;
    if (now === last) return;
    batched.set(handle, now);
    for (const listener of [...batchListeners]) listener();
  }

  async function batchStart(source: 'spenders' | 'newcomers' | 'outreach' | 'online', handle: TargetHandle, feature: PreviewActionId, outreach?: { readonly draft: string }, opts?: BatchStartOptions): Promise<BatchOutcome> {
    if (disposed) return { s: 'failed', code: 'CG-CONTEXT-CHANGED' };
    // «Ещё вариант» of a reminder's toast (2026-10-29): another variant of the result there is, as the card's own would ask.
    const previous = opts?.again === true ? (tracks.get(currentOp.get(handle) ?? '') ?? null) : null;
    if (previous !== null) {
      const rule = regenerateRule(previous);
      if (!rule.allowed) return { s: 'failed', code: rule.reason === null ? 'CG-SEND-BUSY' : reasonCode(rule.reason) };
    }
    const shown = (): boolean => SOURCES.some((s) => surfaces.current().preview[s] === handle);
    let state = targets.get(handle) ?? null;
    let shadow: TargetState | null = null;
    if (state === null) {
      // The fan's card, opened unseen for this one Generate: what a click on the card checks, the batch checks too.
      await deps.directories[source]?.prepare?.(handle).catch(() => undefined);
      if (disposed) return { s: 'failed', code: 'CG-CONTEXT-CHANGED' };
      state = targets.get(handle) ?? newTarget(source, handle);
      if (state === null) return { s: 'failed', code: 'CG-GATE-FAN-UNKNOWN' };
      if (!targets.has(handle)) {
        targets.set(handle, state);
        shadows.add(handle);
        shadow = state;
      }
    }
    let receipt: ActionReceipt;
    try {
      // NF-015: a dialogue gets no Hi — the archive's count is read first, as an open card has it.
      if (feature === 'hi' && state.feed === null) await loadFeed(state);
      receipt = await generate('GenerateBatch', state, feature, opts?.single === true ? { split: false } : {}, previous, outreach ?? null, outreach !== undefined || source === 'online');
    } finally {
      if (shadow !== null && targets.get(handle) === shadow && !shown()) closeTarget(handle);
      shadows.delete(handle);
    }
    if (!receipt.ok) {
      if (receipt.code === 'CG-OP-TAB-LIMIT') return { s: 'busy' };
      // No token: the click's grant is spent, or the list is no longer on screen.
      if (receipt.code === 'CG-UI-FAILED') return { s: 'spent', code: receipt.code };
      return { s: 'failed', code: receipt.code };
    }
    const track = receipt.opId === undefined ? undefined : tracks.get(receipt.opId);
    if (track === undefined) return { s: 'failed', code: 'CG-OP-INTERRUPTED' };
    batched.set(handle, '');
    return new Promise<BatchOutcome>((resolve) => {
      batchWaiters.set(track.opId, resolve);
      // The same request may have reopened a result that already ended.
      if (track.mirror.done !== null) settleBatch(track);
    });
  }

  // ── actions: send ──

  const paced = (): boolean => clock.now() < pacedUntil;

  /**
   * A send was clicked: every «Отправить» of the tab rests SEND_PACE_MS; the cards and a batch's rows say so, then lift it.
   * Returns the deadline, so the click can lift its own pause when it went nowhere (`unpace`).
   */
  function pace(): number {
    pacedUntil = clock.now() + SEND_PACE_MS;
    armPace();
    paceChanged();
    return pacedUntil;
  }

  function armPace(): void {
    if (paceTimer !== null) clock.clearTimer(paceTimer);
    // A timer may fire a hair before the clock reaches the deadline: then it waits out the rest, or the rows stay off.
    paceTimer = clock.setTimer(Math.max(1, pacedUntil - clock.now()), () => {
      paceTimer = null;
      if (disposed) return;
      if (paced()) armPace();
      else paceChanged();
    });
  }

  /** The click that set `until` reached no queue of ChatSpace's: nothing went, so nothing rests behind it. */
  function unpace(until: number): void {
    if (pacedUntil !== until) return;
    pacedUntil = 0;
    if (paceTimer !== null) clock.clearTimer(paceTimer);
    paceTimer = null;
    paceChanged();
  }

  function paceChanged(): void {
    changed();
    for (const handle of [...batched.keys()]) batchChanged(handle);
  }

  /** `anyway` — «Отправить всё равно» on a freshness warning (2026-10-20 audit, rows 3–4). */
  async function sendPart(type: UiActionType, track: OpTrack, variant: number, index: number, anyway = false): Promise<ActionReceipt> {
    const sender = deps.sender;
    const view = track.mirror.done;
    const texts = partsOfResult(view?.result, variant);
    const key = partKey(variant, index);
    // The person's edit of the part goes instead of the AI's text (audit 2026-10-20, row 1).
    const edit = track.edits.get(key);
    const original = texts?.[index];
    const text = edit?.text ?? original;
    const group = groupOf(track, variant);
    if (sender === null || view === null || text === undefined || group === null) return refused(type, localError('CG-SEND-PART', i18n));
    const rows = rowsOf(track, variant, index);
    if (rows.send === undefined) return refused(type, localError('CG-FEATURE-DISABLED', i18n));
    // Chat Memory week 1: «Отправить всё равно» on «в разговоре» passes that warning alone; what the row is under it
    // (stale, unverified) is asked again by the same click's rules.
    if (rows.send.s === 'held-talking' && rows.order === null) {
      if (!anyway) return refused(type, localError('CG-SEND-BUSY', i18n));
      track.talkAccepted = true;
      changed();
      return sendPart(type, track, variant, index, false);
    }
    if (!clickable(rows.send, rows.order, anyway)) {
      const code: CgCode = rows.order !== null ? 'CG-SEND-BUSY' : rows.send.s === 'unavailable' || rows.send.s === 'rejected' ? rows.send.code : rows.send.s === 'held-stale' ? 'CG-SEND-STALE' : rows.send.s === 'unverified' ? 'CG-SEND-FRESHNESS' : rows.send?.s === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-SEND-BUSY';
      return refused(type, localError(code, i18n));
    }
    // The person's own text passes no freshness warning: it was written looking at the chat. A text of the team's guide
    // «Онлайн» put on the card when it opened was not: what the fan wrote since warns, as for an AI's text.
    const accept = anyway || (track.manual !== null && track.source !== 'online');
    // Sent anyway, a result restored after a reload goes with a checkpoint taken now: the page's own document and chat.
    const checkpoint = track.checkpoint ?? (accept ? await host.checkpoint(track.target.chat).catch(() => null) : null);
    if (checkpoint === null) return refused(type, localError('CG-SEND-FRESHNESS', i18n));
    // One «Отправить» a SEND_PACE_MS, a retry too: checked after the last wait, so two quick clicks never both pass.
    if (paced()) return refused(type, localError('CG-SEND-BUSY', i18n));
    // Decision X53: the picked media go with this part, as they are at the click. They leave the picker with it: what the
    // person does in the picker meanwhile neither changes nor repeats what goes.
    const chat = track.target.chat;
    const attached = media.attachment(chat);
    if (attached.kind === 'blocked') return refused(type, localError('CG-SEND-MEDIA', i18n));
    const taken = attached.kind === 'media' ? media.take(chat) : null;
    // The button is off from the first click, before anything answers (§6.7.7, lock 1).
    track.clicked.add(key);
    const until = pace();
    reportProgress(track);
    changed();
    const settle = (): void => {
      track.clicked.delete(key);
    };
    const issued = await issueCause(rpc, 'send', track.surface);
    if (!issued.ok) {
      settle();
      unpace(until);
      if (taken !== null) media.restore(chat, taken);
      reportProgress(track);
      changed();
      return refused(type, localError(issued.code, i18n));
    }
    const leaseToken = track.source === 'newcomers' ? (deps.greeting?.leaseToken(track.fanRef) ?? null) : null;
    const click: PreviewSendClick = {
      opId: track.opId,
      target: track.target,
      purpose: purposeOf(track.source),
      group,
      part: partRef(track, variant, index),
      previewRevision: track.previewRevision,
      textRevision: edit?.revision ?? 0,
      checkpoint,
      documentEpoch: checkpoint.documentEpoch,
      ...(accept ? { acceptFreshness: true as const } : {}),
      ...(track.manual === null ? {} : { manual: track.manual }),
      cause: issued.cause,
      ...(leaseToken === null ? {} : { leaseToken }),
      // The build the fuse is held by (decision X25): the background holds the click while a tripped fuse names it.
      hostBuild: host.current().contract.build,
      plainText: text,
      // ChatSpace's «from AI» mark only on the AI's own words (§6.7.1).
      isAiGenerated: pageFlag(context.current(), 'previewSendMarkAiGenerated') && track.manual === null && text === original,
      ...(attached.kind === 'media' ? { media: attached.media } : {}),
    };
    let answered: SendAttemptView;
    try {
      answered = await sender.send(click);
    } catch {
      settle();
      unpace(until);
      if (taken !== null) media.restore(chat, taken);
      reportProgress(track);
      changed();
      // The click never reached the coordinator's journal: nothing was sent.
      return refused(type, localError('CG-SEND-HOST', i18n));
    }
    settle();
    // States that arrived before the click's own answer are the same attempt's: the most advanced one stands.
    const early = unclaimed.get(answered.attemptId);
    unclaimed.delete(answered.attemptId);
    const latest = early !== undefined && attemptReachable(answered.state, early.state) ? early : answered;
    // «Отправить ещё раз» of a part whose outcome is unknown, stopped before ChatSpace's queue (a busy queue, a page
    // condition): the row keeps the unknown outcome, and the click's answer says why. The hub's refusal while the first
    // one is still inside its ticket (CG-SEND-UNCERTAIN, its `custody_held`) is the row's to say instead — wait a few
    // seconds, then the next click (2026-10-23 audit); the first one stays unknown in the journal all the same.
    const before = track.attempts.get(key);
    if (latest.state === 'held' && latest.code !== 'CG-SEND-UNCERTAIN' && before !== undefined && before.view.state === 'uncertain') {
      unpace(until);
      if (taken !== null) media.restore(chat, taken);
      reportProgress(track);
      changed();
      return refused(type, localError(latest.code ?? 'CG-SEND-BUSY', i18n));
    }
    attemptOwner.set(latest.attemptId, { opId: track.opId, key });
    if (taken !== null) mediaAttempts.set(latest.attemptId, { chat, taken });
    track.attempts.set(key, {
      attemptId: latest.attemptId,
      view: latest,
      sentAt: latest.state === 'sentObserved' ? nowIso() : null,
      uncertainSince: latest.state === 'uncertain' ? nowIso() : null,
    });
    afterAttempt(track, latest);
    // Held before ChatSpace's queue, or refused by it: nothing went, the next click (this fan's or another's) is free.
    if (latest.state === 'held' || latest.state === 'notEnqueued') unpace(until);
    return done(type, 'started', { attemptId: latest.attemptId });
  }

  // ── actions: open and insert ──

  function finishInsert(outcome: DeferredOutcome | null): ActionReceipt | null {
    const pending = pendingInsert;
    if (outcome === null || pending === null || outcome.insert.navigationId !== pending.navigationId) return null;
    pendingInsert = null;
    if (pending.timer !== null) clock.clearTimer(pending.timer);
    pending.track.openInsert = null;
    touchDesk(pending.track);
    changedFor(pending.track.handle);
    // The person's own words met a text already in the chat's field: nothing was written, and no dock asks about them
    // (it knows the AI's text only) — the toast says so; the part stays on the card for another click.
    if (outcome.kind === 'needs-confirm' && pending.own) {
      deps.notifier?.notify('CG-INSERT-FAILED', `preview:${pending.track.handle}`);
      return refused('OpenAndInsertPart', localError('CG-INSERT-FAILED', i18n));
    }
    if (outcome.kind === 'inserted' || outcome.kind === 'needs-confirm') {
      // §6.5: the chat is open — the rest of the result, and the question about the person's own text, are its dock's.
      const { track } = pending;
      const hand = deps.handover ?? null;
      // The person's own text from the draft field is no operation the background knows: the dock has nothing to take.
      if (hand !== null && track.manual === null) {
        if (track.personaDefinitionId !== null) docked.add(track.opId);
        hand({ opId: track.opId, chat: track.target.chat, personaDefinitionId: track.personaDefinitionId, split: track.splitRequested, part: outcome.insert.part, outcome: outcome.kind });
      }
      return done('OpenAndInsertPart', outcome.kind === 'inserted' ? 'opened' : 'needs-confirm', { opId: track.opId });
    }
    // The preview is gone by now: the person hears it as a toast («Вставка отменена», «Чат не готов…»).
    deps.notifier?.notify(outcome.code, `preview:${pending.track.handle}`);
    return refused('OpenAndInsertPart', localError(outcome.code, i18n));
  }

  /** SP-035: the chat opened — the boards get out of its way. This is not the person closing the preview. */
  function closeForNavigation(): void {
    closingForNavigation = true;
    surfaces.closeBoards();
    closingForNavigation = false;
  }

  function cancelInsert(why: 'human-navigation' | 'preview-closed' | 'session' | 'persona'): void {
    const pending = pendingInsert;
    if (pending === null) return;
    pending.abort.abort();
    finishInsert(slot.cancel(why));
  }

  async function openAndInsert(type: UiActionType, track: OpTrack, variant: number, index: number): Promise<ActionReceipt> {
    // The part as the card shows it: the person's edit goes instead of the AI's text (2026-10-22, as «Отправить» does).
    const edited = track.edits.get(partKey(variant, index))?.text;
    const own = edited !== undefined || track.manual !== null;
    const text = edited ?? partsOfResult(track.mirror.done?.result, variant)?.[index];
    if (text === undefined || text.trim() === '') return refused(type, localError('CG-INSERT-FAILED', i18n));
    // The click puts a text into the fan's chat: the fan's sends are asked of the journal first (another tab may hold the fan, §6.7.8).
    const journal = await sendsNow(track.pageId, track.fanRef);
    if (journal !== null || tracks.get(track.opId) !== track) return refused(type, localError(journal ?? 'CG-CONTEXT-CHANGED', i18n));
    const rows = rowsOf(track, variant, index);
    if (rows.openInsert.s !== 'available') {
      const code: CgCode = rows.openInsert.s === 'unavailable' ? reasonCode(rows.openInsert.reason) : rows.send?.s === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-INSERT-FAILED';
      return refused(type, localError(code, i18n));
    }
    // The text was written for another sign-in, binding or persona: it is not put into a chat (the click says why).
    if (identityChanged(track)) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    const identity = host.current().identity;
    if (identity === null) return refused(type, localError('CG-HOST-NOT-READY', i18n));
    // The person's click on this part: the preview's own switch and `insertion` on ITS page — never `navigation`.
    const switchedOff = boardOpenRefusal(context.current(), boardsOf(track.source), true);
    if (switchedOff !== null) return refused(type, errorOf(switchedOff, i18n));
    const issued = await issueCause(rpc, 'navigate', track.surface);
    if (!issued.ok) return refused(type, localError(issued.code, i18n));
    if (identityChanged(track)) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    const now = clock.now();
    const timeoutMs = (context.current().bootstrap?.limits.navInsertTimeoutSec ?? 20) * 1000;
    const chat = track.target.chat;
    const part = partRef(track, variant, index);
    const insert = buildDeferredInsert({ intentId: ids.uuid(), operationId: track.opId, part, target: chat, text, documentEpoch: identity.documentEpoch, now, timeoutMs });
    if (!insert.ok) return refused(type, localError(insert.code, i18n));
    const navigation = buildOpenAndInsert({ intentId: ids.uuid(), cause: issued.cause, insert: insert.intent, conversationRef: track.target.conversationRef });
    if (!navigation.ok) return refused(type, localError(navigation.code, i18n));

    // A newer «Открыть и вставить» replaces the one still waiting.
    const previous = pendingInsert;
    const displaced = slot.begin({ navigationId: navigation.intent.intentId, insertIntentId: insert.intent.intentId, opId: track.opId, part, chat, expiresAt: insert.intent.expiresAt });
    if (previous !== null) {
      previous.abort.abort();
      finishInsert(displaced);
    }
    const abort = new AbortFlag();
    const pending: PendingInsert = { navigationId: navigation.intent.intentId, track, key: partKey(variant, index), abort, timer: null, own };
    pendingInsert = pending;
    pending.timer = clock.setTimer(timeoutMs + DEFERRED_GRACE_MS, () => {
      if (pendingInsert !== pending) return;
      pending.timer = null;
      pending.abort.abort();
      finishInsert(slot.expire(clock.now()));
    });
    track.openInsert = { key: pending.key, until: insert.intent.expiresAt };
    touchDesk(track);
    changedFor(track.handle);

    if (deps.previewSend === false) {
      manualInserts.set(insert.intent.intentId, { opId: track.opId, part });
      if (manualInserts.size > 64) manualInserts.delete(manualInserts.keys().next().value ?? '');
    }
    // A bridge failure of a write may have run: the navigation failed, the insert's outcome is unknown and is never repeated.
    const receipt = await host.navigate(navigation.intent, { signal: abort }).catch((): NavigationReceipt => ({ state: 'failed', code: 'CG-NAV-FAILED', insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } }));
    if (receipt.insert === null || receipt.insert.state === 'rejected') manualInserts.delete(insert.intent.intentId);
    if (receipt.state === 'navigated') closeForNavigation();
    const applied = receipt.insert;
    // `inserted` is reported of the AI's own words only (as `copied` is).
    if (applied !== null && !own) void rpc.request('op.reportInsert', { opId: track.opId, part, receipt: applied });
    return finishInsert(slot.settle(navigation.intent.intentId, receipt)) ?? refused(type, localError('CG-INSERT-CANCELED', i18n));
  }

  // ── actions: the rest ──

  async function copy(type: UiActionType, track: OpTrack, variant: number, index: number): Promise<ActionReceipt> {
    const key = partKey(variant, index);
    const edit = track.edits.get(key);
    const text = edit?.text ?? partsOfResult(track.mirror.done?.result, variant)?.[index];
    const wrote = text !== undefined && deps.clipboard !== null && (await deps.clipboard.writeText(text).catch(() => false));
    track.copy.set(key, wrote ? 'done' : 'failed');
    changedFor(track.handle);
    if (!wrote) return refused(type, localError('CG-CLIPBOARD', i18n));
    // `copied` is reported only after the clipboard took the text (Б14), and only of the AI's own words.
    if (edit === undefined && track.manual === null) void rpc.request('op.reportCopy', { opId: track.opId, part: partRef(track, variant, index) });
    clock.setTimer(COPY_MARK_MS, () => {
      if (track.copy.get(key) !== 'done') return;
      track.copy.delete(key);
      changedFor(track.handle);
    });
    return done(type);
  }

  /** The switches a click in a preview answers to on its page: the preview's own, and the list's for a card of «Новые». */
  const boardsOf = (source: PreviewSource): readonly BoardSwitch[] => (source === 'newcomers' ? ['preview', 'newcomers'] : ['preview']);

  async function openChat(type: UiActionType, fanRef: string, surface: Surface, source: PreviewSource, conversationRef: string | undefined): Promise<ActionReceipt> {
    const binding = context.current().binding;
    if (binding === null) return refused(type, localError('CG-BINDING-MISSING', i18n));
    const receipt = await navigator.open({ host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: fanRef }, surface, boardsOf(source), conversationRef);
    if (receipt.state === 'failed') return refused(type, localError(receipt.code, i18n));
    surfaces.closeBoards();
    return done(type, 'opened');
  }

  /** The result the card shows now; null — none. */
  const shownTrackOf = (state: TargetState): OpTrack | null => {
    const opId = currentOp.get(state.handle);
    return opId === undefined ? null : (tracks.get(opId) ?? null);
  };

  /** Why «Отправить» of the draft field cannot send now (audit 2026-10-20, row 1); null — it can. */
  function draftSendBlock(state: TargetState, shown: OpTrack | null): ReasonVM | null {
    if (draftText(state).trim() === '') return reason('draft-empty');
    if (shown !== null && !isTerminalOpState(shown.mirror.state)) return reason('chat-busy');
    const sends = fanSends(state.pageId, state.fanRef, shown?.opId ?? null);
    if (sends.inFlight) return reason('parts-sending');
    const binding = context.current().binding;
    const route = host.current().route;
    if (binding !== null && route.chat !== null && chatKeyOf(route.chat) === chatKeyOf({ host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: state.fanRef })) return reason('chat-open');
    if (state.source === 'newcomers' && deps.greeting !== null) {
      // A part on its way holds the person's own greeting as it holds Hi; «уже поздоровались» is the AI's rule only (the hub
      // admits the rest of the owner's own group and refuses a second greeting itself).
      const blocked = deps.greeting.hiBlocked(state.fanRef);
      if (blocked !== null && blocked.id !== 'hi-greeted') return blocked;
    }
    return null;
  }

  /** «Отправить» of the draft field, where this page sends from a preview. */
  function draftSendOf(state: TargetState, shown: OpTrack | null): { readonly send?: { readonly enabled: boolean; readonly reason: ReasonVM | null } } {
    const ctx = context.current();
    if (deps.previewSend === false || deps.sha256 === undefined || deps.sender === null || ctx.phase !== 'ready') return {};
    if (!pageFlag(ctx, 'previewSend') || (state.source === 'newcomers' && !pageFlag(ctx, 'newcomers'))) return {};
    const why = draftSendBlock(state, shown);
    return { send: { enabled: why === null, reason: why } };
  }

  /**
   * «Отправить» of the draft field (audit 2026-10-20, row 1): the person's own text to the fan, one message, by this
   * click. It becomes the card's result — one part of no generation, the hub's manual group by the text's sha256 —
   * so its send shows, ends and holds the fan like any part's. The field is empty for the next one.
   */
  async function sendDraft(type: UiActionType, state: TargetState): Promise<ActionReceipt> {
    const sha256 = deps.sha256;
    if (sha256 === undefined || deps.sender === null || deps.previewSend === false) return refused(type, localError('CG-FEATURE-DISABLED', i18n));
    // A send was clicked a moment ago (SEND_PACE_MS): no result is made for a click that cannot go.
    if (paced()) return refused(type, localError('CG-SEND-BUSY', i18n));
    const text = draftText(state).trim();
    const why = draftSendBlock(state, shownTrackOf(state));
    if (why !== null) return refused(type, localError(why.id === 'draft-empty' ? 'CG-SEND-PART' : why.id === 'chat-open' ? 'CG-SEND-ACTIVE-CHAT' : reasonCode(why), i18n));
    const journal = await sendsNow(state.pageId, state.fanRef);
    if (journal !== null || targets.get(state.handle) !== state) return refused(type, localError(journal ?? 'CG-CONTEXT-CHANGED', i18n));
    const binding = context.current().binding;
    if (binding === null) return refused(type, localError('CG-HUB-UNAVAILABLE', i18n));
    const chat = { host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: state.fanRef };
    const conversationRef = conversationOfTarget(state.info, binding.platform);
    if (conversationRef === null) return refused(type, localError('CG-DATA-NOT-READY', i18n));
    const target: Target = { binding, chat, fanRef: state.fanRef, conversationRef };
    const atEpoch = epoch;
    let textFingerprint: string;
    try {
      textFingerprint = await sha256(text);
    } catch {
      return refused(type, localError('CG-SEND-HOST', i18n));
    }
    const checkpoint = await host.checkpoint(chat).catch(() => null);
    if (disposed || atEpoch !== epoch || targets.get(state.handle) !== state) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    const now = clock.now();
    const opId = ids.uuid();
    const view: OpView = {
      opId,
      feature: state.source === 'newcomers' ? 'hi' : 'reply',
      surface: surfaceOf(state.source),
      target,
      state: 'done',
      phase: { name: 'settled', since: now },
      startedAt: now,
      endedAt: now,
      toneUsed: null,
      generationRef: ids.uuid(),
      result: { kind: 'parts', parts: [text], splitRequested: false },
    };
    const track: OpTrack = { ...trackOf(view, state, { checkpoint }), manual: { textFingerprint }, fromDraft: text };
    tracks.set(opId, track);
    currentOp.set(state.handle, opId);
    setDraft(state, '');
    pruneTracks();
    changedFor(state.handle);
    const receipt = await sendPart(type, track, 0, 0, true);
    // Refused before the click reached the background (ChatSpace's send is off, no checkpoint, no token): nothing went,
    // and the card's row may not say why — the toast does, and the text is the field's again.
    if (!receipt.ok && !track.attempts.has(partKey(0, 0))) {
      giveDraftBack(track);
      deps.notifier?.notify(receipt.code, `preview:${state.handle}`);
    }
    return receipt;
  }

  /**
   * The text a result of the person's own took out of the draft field goes back to it (2026-10-23 audit): a refusal
   * proved nothing reached the fan. A text the person has written in the field since stays; given back once at most.
   */
  function giveDraftBack(track: OpTrack): void {
    const text = track.fromDraft;
    track.fromDraft = null;
    if (text === null || draftText(track).trim() !== '') return;
    setDraft(track, text);
  }

  /**
   * «Онлайн»: a text of the team's guide on the fan's open card of the window, for its «Отправить →» — one part of no
   * generation, the hub's manual group by the text's sha256 (as the draft field's own text), so its send shows, ends
   * and holds the fan like any part's. It takes the card's place of the result; nothing is sent. False — not now: no
   * open card of the fan, something of the fan is in flight, or this page sends nothing from a preview.
   */
  function clearDraft(handle: TargetHandle): void {
    const state = targets.get(handle) ?? null;
    if (state !== null && draftText(state) !== '') setDraft(state, '');
  }

  async function onlineText(handle: TargetHandle, text: string): Promise<boolean> {
    const sha256 = deps.sha256;
    const state = targets.get(handle) ?? null;
    const body = text.trim();
    if (sha256 === undefined || deps.sender === null || deps.previewSend === false || state === null || state.source !== 'online' || body === '') return false;
    if (busyOf(state.pageId, state.fanRef)) return false;
    const binding = context.current().binding;
    if (binding === null) return false;
    const conversationRef = conversationOfTarget(state.info, binding.platform);
    if (conversationRef === null) return false;
    const chat = { host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: state.fanRef };
    const target: Target = { binding, chat, fanRef: state.fanRef, conversationRef };
    const atEpoch = epoch;
    let textFingerprint: string;
    try {
      textFingerprint = await sha256(body);
    } catch {
      return false;
    }
    // The text is the person's choice of this moment: what the fan writes after it holds its send, as a Generate's would.
    const checkpoint = await host.checkpoint(chat).catch(() => null);
    if (disposed || atEpoch !== epoch || targets.get(handle) !== state || busyOf(state.pageId, state.fanRef)) return false;
    const now = clock.now();
    const view: OpView = {
      opId: ids.uuid(),
      feature: 'reply',
      surface: surfaceOf(state.source),
      target,
      state: 'done',
      phase: { name: 'settled', since: now },
      startedAt: now,
      endedAt: now,
      toneUsed: null,
      generationRef: ids.uuid(),
      result: { kind: 'parts', parts: [body], splitRequested: false },
    };
    const track: OpTrack = { ...trackOf(view, state, { checkpoint }), manual: { textFingerprint } };
    tracks.set(view.opId, track);
    currentOp.set(handle, view.opId);
    pruneTracks();
    changedFor(handle);
    // MAIN's word on the send before the click (a newer message of the fan, the open chat), as for a generation's result.
    void refreshPreflight(track);
    return true;
  }

  /** «Править» / the editor of a part / «Вернуть текст AI» (audit 2026-10-20, row 1). Local only. */
  function editPart(type: UiActionType, track: OpTrack, variant: number, index: number, text: string | null): ActionReceipt {
    const key = partKey(variant, index);
    if (partsOfResult(track.mirror.done?.result, variant)?.[index] === undefined) return refused(type, localError('CG-SEND-PART', i18n));
    if (text === null) track.edits.delete(key);
    else {
      if (track.edits.get(key) === undefined && rowsOf(track, variant, index).editable !== true) return refused(type, localError('CG-SEND-PART', i18n));
      track.edits.set(key, { text, revision: (track.edits.get(key)?.revision ?? 0) + 1 });
    }
    changedFor(track.handle);
    return done(type);
  }

  function setDraft(state: Pick<TargetState, 'handle' | 'source' | 'pageId' | 'fanRef'>, text: string): void {
    const key = ownerKey(state.source, state.pageId, state.fanRef);
    if (key === null) return;
    const before = revisions.get(key) ?? findDraft(drafts, key, clock.now())?.revision ?? 0;
    const put = putDraft(drafts, key, text, clock.now(), state.source === 'newcomers' ? (deps.greeting?.threadRevision(state.fanRef) ?? null) : null);
    drafts = put.store;
    revisions.set(key, Math.max(before + 1, put.revision));
    touchDesk(state);
    saveDrafts();
    changedFor(state.handle);
    draftsChanged();
  }

  const stateOf = (handle: TargetHandle): TargetState | null => {
    const state = targets.get(handle);
    return state !== undefined && SOURCES.some((s) => surfaces.current().preview[s] === handle) ? state : null;
  };

  type MediaAction = Extract<UiAction, { type: 'SetMediaOpen' | 'ChooseMediaFolder' | 'LoadMoreMedia' | 'PickMedia' | 'SetMediaPrice' | 'ClearMedia' | 'RetryMedia' }>;
  const isMediaAction = (action: UiAction): action is MediaAction =>
    action.type === 'SetMediaOpen' ||
    action.type === 'ChooseMediaFolder' ||
    action.type === 'LoadMoreMedia' ||
    action.type === 'PickMedia' ||
    action.type === 'SetMediaPrice' ||
    action.type === 'ClearMedia' ||
    action.type === 'RetryMedia';

  /** Decision X53: one move of the person in the picker; false — nothing changed. */
  function mediaAction(action: MediaAction, chat: ChatRef): boolean {
    switch (action.type) {
      case 'SetMediaOpen':
        media.setOpen(chat, action.open);
        return true;
      case 'ChooseMediaFolder':
        media.chooseFolder(chat, action.folder);
        return true;
      case 'LoadMoreMedia':
        media.more(chat, action.what);
        return true;
      case 'PickMedia':
        return media.pick(chat, action.mediaId, action.free);
      case 'SetMediaPrice':
        media.setPrice(chat, action.text);
        return true;
      case 'ClearMedia':
        media.clear(chat);
        return true;
      case 'RetryMedia':
        media.retry(chat);
        return true;
    }
  }

  let previewOpenRun = 0;
  function dispatch(action: UiAction): Promise<ActionReceipt> | null {
    const type = action.type;
    if (action.type === 'OpenPreview') {
      const parsed = parseFanHandle(action.targetHandle);
      if (parsed === null) return null;
      const info = deps.directories[parsed.source]?.resolve(action.targetHandle) ?? null;
      if (info === null) return Promise.resolve(refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n)));
      const atEpoch = epoch;
      const run = ++previewOpenRun;
      const directory = deps.directories[parsed.source];
      if (directory?.prepare === undefined) {
        surfaces.setPreview(parsed.source, action.targetHandle);
        return Promise.resolve(done(type, 'opened'));
      }
      return directory.prepare(action.targetHandle).catch(() => undefined).then(() => {
        if (disposed || epoch !== atEpoch || run !== previewOpenRun) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
        surfaces.setPreview(parsed.source, action.targetHandle);
        return done(type, 'opened');
      });
    }
    if (action.type === 'Navigate') {
      const to = action.to;
      if (to.kind === 'surface' && to.surface === 'preview') {
        if (to.open) return Promise.resolve(done(type, 'noop'));
        for (const s of SOURCES) surfaces.setPreview(s, null);
        return Promise.resolve(done(type));
      }
      if (to.kind === 'chat') {
        const parsed = parseFanHandle(to.targetHandle);
        // A list answers for its own handles; the palette's fans have no list.
        return parsed !== null && parsed.source === 'palette' && parsed.pageId === context.current().binding?.pageId
          ? openChat(type, parsed.fanRef, 'preview', 'palette', deps.directories.palette?.resolve(to.targetHandle)?.conversationRef)
          : null;
      }
      return null;
    }
    if (action.type === 'RefreshArchive' || action.type === 'LoadOlder' || action.type === 'SetPreviewDraft' || action.type === 'SetTone' || action.type === 'Generate') {
      if (parseFanHandle(action.targetHandle) === null) return null;
      const state = stateOf(action.targetHandle);
      if (state === null) return Promise.resolve(refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n)));
      if (action.type === 'RefreshArchive') {
        wantSeen(state, true);
        const reads = context.current().phase === 'ready' ? Promise.resolve() : context.refresh();
        return reads.then(() => Promise.all([loadFeed(state), loadCard(state), loadSends(state.pageId, state.fanRef)])).then(() => done(type));
      }
      if (action.type === 'LoadOlder') return loadOlder(state).then(() => done(type));
      if (action.type === 'SetPreviewDraft') {
        setDraft(state, action.text);
        return Promise.resolve(done(type));
      }
      if (action.type === 'SetTone') {
        state.tone = action.tone;
        changedFor(state.handle);
        return Promise.resolve(done(type));
      }
      return generate(type, state, action.feature, action.options, null);
    }
    if (isMediaAction(action) && action.targetHandle === OUTREACH_MEDIA_HANDLE) {
      // «+ Добавить медиа» of «Рассылка»: its own sheet, for no fan; what it holds is the outreach's media at once.
      const chat = outreachChat();
      if (!outreachOn || deps.sender === null || chat === null || !media.available) return Promise.resolve(refused(type, localError('CG-FEATURE-DISABLED', i18n)));
      return Promise.resolve(mediaAction(action, chat) ? done(type) : done(type, 'noop'));
    }
    if (isMediaAction(action)) {
      if (parseFanHandle(action.targetHandle) === null) return null;
      const state = stateOf(action.targetHandle);
      const chat = state === null ? null : chatOf(state);
      if (state === null || chat === null || mediaVm(state) === null) return Promise.resolve(refused(type, localError('CG-FEATURE-DISABLED', i18n)));
      return Promise.resolve(mediaAction(action, chat) ? done(type) : done(type, 'noop'));
    }
    if (action.type === 'Copy') {
      const part = parsePartHandle(action.artifactHandle);
      const track = part === null ? undefined : tracks.get(part.opId);
      return part === null || track === undefined ? null : copy(type, track, part.variant, part.index);
    }
    if (action.type === 'OpenChatToVerify') {
      const owner = attemptOwner.get(action.attemptId);
      const track = owner === undefined ? undefined : tracks.get(owner.opId);
      // §6.7.8: the only way on from an unknown outcome — look at the chat. Nothing is sent or inserted.
      return track === undefined ? null : openChat(type, track.fanRef, track.surface, track.source, track.target.conversationRef);
    }
    if (action.type === 'EditPart') {
      const track = tracks.get(action.operationId);
      return track === undefined ? null : Promise.resolve(editPart(type, track, action.variant ?? 0, action.part, action.text));
    }
    if (action.type === 'SendDraft') {
      const state = stateOf(action.targetHandle);
      return state === null ? null : sendDraft(type, state);
    }
    if (action.type === 'ClearOutreachMedia') {
      // «Убрать» of the outreach's media: text alone from now on; every fan whose picks were the outreach's has none.
      const chat = outreachChat();
      if (!outreachOn || deps.sender === null || chat === null) return null;
      media.clear(chat);
      media.setOpen(chat, false);
      syncOutreach();
      return Promise.resolve(done(type));
    }
    if (action.type === 'ResetOutreachMedia') {
      // «Вернуть общее»: the fan takes the outreach's media again instead of their own picks.
      const state = stateOf(action.targetHandle);
      const chat = state === null ? null : chatOf(state);
      if (!outreachOn || deps.sender === null || state === null || chat === null || state.source !== 'outreach') return null;
      media.clear(chat);
      media.setOpen(chat, false);
      adopted.delete(chatKeyOf(chat));
      if (media.adopt(chat, outreachMedia, null)) adopted.set(chatKeyOf(chat), outreachMedia);
      for (const listener of [...batchListeners]) listener();
      return Promise.resolve(done(type));
    }
    if (action.type === 'SendNewcomerGreeting') {
      // X59 on a hub's «Новые»: the row's «Отправить» is the card's own send of the greeting's next part, by this click.
      const next = rowPart(action.targetHandle);
      if (next === null) return null;
      return deps.previewSend === false ? Promise.resolve(refused(type, localError('CG-FEATURE-DISABLED', i18n))) : sendPart(type, next.track, 0, next.index);
    }
    if (action.type === 'Regenerate' || action.type === 'CancelGeneration' || action.type === 'HideResult' || action.type === 'ExpandResult' || action.type === 'SendPart' || action.type === 'OpenAndInsertPart') {
      const track = tracks.get(action.operationId);
      if (track === undefined) return null;
      if (action.type === 'CancelGeneration') {
        return rpc.request('op.cancel', { opId: track.opId }).then((answer) => (answer.ok ? done(type) : refused(type, errorOf(answer.error, i18n))));
      }
      if (action.type === 'HideResult') {
        // A result whose part is on its way or has an unknown outcome stays on the card: its row is the only place that says so (§6.7.8).
        if (holdsFan(track)) {
          const uncertain = [...track.attempts.values()].some((attempt) => attempt.view.state === 'uncertain' && attempt.resolved === undefined);
          return Promise.resolve(refused(type, localError(uncertain ? 'CG-SEND-UNCERTAIN' : 'CG-SEND-BUSY', i18n)));
        }
        track.hidden = true;
        changedFor(track.handle);
        return Promise.resolve(done(type));
      }
      if (action.type === 'ExpandResult') {
        track.expanded = action.expanded;
        changedFor(track.handle);
        return Promise.resolve(done(type));
      }
      if (action.type === 'Regenerate') {
        const state = stateOf(track.handle) ?? shownOn(track);
        if (state === null) return Promise.resolve(refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n)));
        const rule = regenerateRule(track);
        if (!rule.allowed) return Promise.resolve(refused(type, localError(rule.reason === null ? 'CG-SEND-BUSY' : reasonCode(rule.reason), i18n)));
        return generate(type, state, track.feature, {}, track);
      }
      if (action.type === 'SendPart') return deps.previewSend === false ? Promise.resolve(refused(type, localError('CG-FEATURE-DISABLED', i18n))) : sendPart(type, track, action.variant ?? 0, action.part, action.anyway === true);
      return openAndInsert(type, track, action.variant ?? 0, action.part);
    }
    if (action.type === 'ReloadView') {
      if (action.selector.of !== 'preview') return null;
      const handle = surfaces.current().preview[action.selector.from];
      const state = handle === null ? null : stateOf(handle);
      return context.refresh().then(async () => {
        if (state !== null) await Promise.all([loadFeed(state), loadCard(state), loadSends(state.pageId, state.fanRef)]);
        return done(type);
      });
    }
    return null;
  }

  // ── subscriptions ──

  const offs: (() => void)[] = [];
  // Chat Memory week 1: a mark that comes or goes changes the rows of its fan's results.
  if (deps.talking) offs.push(deps.talking.onChange(() => changed()));
  offs.push(
    surfaces.subscribe((state, previous) => {
      if ((!state.spenders && previous.spenders) || (!state.newcomers && previous.newcomers)) previewOpenRun++;
      for (const s of SOURCES) {
        const before = previous.preview[s];
        const after = state.preview[s];
        if (before === after) continue;
        if (before !== null && !SOURCES.some((other) => state.preview[other] === before)) closeTarget(before);
        // A card a batch opened unseen is opened for real: it reads what an open card reads.
        if (after !== null && (!targets.has(after) || shadows.has(after))) openTarget(s, after);
        cells[s].invalidate();
      }
    }),
    context.subscribe((state) => {
      const before = persona;
      persona = state.persona;
      // The owner edited the persona (its key stays): the page's choice followed its new definition, and so do the
      // generations made under the old one — the same persona's, inserted and sent as before.
      if (state.epoch === epoch && before !== null && state.persona !== null && before.key === state.persona.key && before.definitionId !== state.persona.definitionId) {
        for (const track of tracks.values()) if (track.personaDefinitionId === before.definitionId) track.personaDefinitionId = state.persona.definitionId;
      }
      if (state.epoch !== epoch) {
        // Another sign-in, hub or account: nothing of the old identity is shown, inserted or kept.
        epoch = state.epoch;
        cancelInsert('session');
        for (const target of targets.values()) stopPoll(target);
        for (const track of tracks.values()) clearHoldTimers(track);
        targets.clear();
        media.reset();
        seen.reset();
        mediaAttempts.clear();
        kept = [];
        for (const settle of [...batchWaiters.values()]) settle({ s: 'failed', code: 'CG-CONTEXT-CHANGED' });
        batchWaiters.clear();
        batched.clear();
        shadows.clear();
        tracks.clear();
        docked.clear();
        currentOp.clear();
        attemptOwner.clear();
        manualInserts.clear();
        unclaimed.clear();
        listed.clear();
        for (const s of SOURCES) surfaces.setPreview(s, null);
      } else if (pendingInsert !== null && pendingInsert.track.personaDefinitionId !== null && state.persona?.definitionId !== pendingInsert.track.personaDefinitionId) {
        cancelInsert('persona');
      }
      // A sign-out or another user: the drafts of whoever is not signed in now leave memory and storage (§9.4).
      applyDraftScope(state);
      for (const target of targets.values()) if (target.feed === null && !target.feedLoading && target.feedError === null) void loadFeed(target);
      changed();
      draftsChanged();
    }),
    i18n.subscribe(() => changed()),
    rpc.onEvent('op.update', onUpdate),
    rpc.onEvent('op.done', ({ view }) => {
      const track = tracks.get(view.opId);
      if (track !== undefined) finish(track, view);
    }),
    rpc.onEvent('send.state', ({ view }) => onAttemptView(view)),
    rpc.onState?.((connection) => {
      if (connection === 'ready') {
        if (!portWasDown) return;
        portWasDown = false;
        void resync();
      } else if (connection !== 'connecting') portWasDown = true;
    }) ?? ((): void => undefined),
    host.subscribe((event: HostEvent) => {
      if (event.type === 'humanSend' && deps.previewSend === false) {
        const { draft, platformMessageId, chat } = event.fact;
        if (platformMessageId === null || draft.insertIntentId === null || draft.editedSinceInsert === null) return;
        const origin = manualInserts.get(draft.insertIntentId);
        const track = origin === undefined ? undefined : tracks.get(origin.opId);
        if (origin === undefined || track === undefined || chatKeyOf(track.target.chat) !== chatKeyOf(chat)) return;
        manualInserts.delete(draft.insertIntentId);
        manualSent(origin.opId, origin.part, platformMessageId);
        return;
      }
      if (event.type === 'route') {
        const pending = pendingInsert;
        if (pending !== null && event.route.chat !== null) {
          // Our chat opened: the board closes while the insert waits for the composer. Another chat: the person went elsewhere, the insert is given up (§6.5).
          if (chatKeyOf(event.route.chat) === chatKeyOf(pending.track.target.chat)) closeForNavigation();
          else cancelInsert('human-navigation');
        }
        // A fan's chat opened: the person sees what the fan wrote, and a read's race of that fan is told no more.
        const binding = context.current().binding;
        const opened = event.route.chat;
        if (opened !== null && binding !== null && opened.host === binding.host && opened.hostAccountId === binding.hostAccountId) seen.open(fanKey(binding.pageId, opened.platformFanId));
        // Only a result on an open card asks MAIN again: a closed card costs no bridge call.
        for (const track of tracks.values()) if (track.mirror.done !== null && shownOn(track) !== null) void refreshPreflight(track);
        changed();
        return;
      }
      if (event.type === 'incoming') {
        const fact = event.fact;
        if (!fact.fromFan) return;
        for (const track of tracks.values()) {
          if (track.target.chat.hostAccountId !== fact.hostAccountId || track.fanRef !== fact.platformFanId || track.fanWrote) continue;
          // A fan message after the checkpoint holds every send of this result; its text never enters the preview (§6.7.5).
          if (track.checkpoint !== null && track.checkpoint.knownFanMessageIds.includes(fact.platformMessageId)) continue;
          markFanWrote(track, fact.sentAt);
          changedFor(track.handle);
        }
        return;
      }
      if (event.type === 'coverage' || event.type === 'accounts') {
        for (const track of tracks.values()) if (track.mirror.done !== null && shownOn(track) !== null) void refreshPreflight(track);
      }
    }),
    // What the host can do changed (a store ChatSpace created with the first chat, a receipt profile that matched): the
    // «Отправить» rows on screen are judged again — their reason, or a send that became possible.
    host.onContract(() => {
      for (const track of tracks.values()) if (track.mirror.done !== null && shownOn(track) !== null) void refreshPreflight(track);
      changed();
    }),
  );
  if (deps.sender !== null) offs.push(deps.sender.onView(onAttemptView));
  const desk = deps.greeting;
  if (desk !== null) {
    offs.push(
      desk.subscribe(() => {
        // The lease was taken again: a part the hub held for an expired lease may be sent by a new click.
        for (const track of tracks.values()) {
          if (track.source !== 'newcomers' || desk.leaseToken(track.fanRef) === null) continue;
          for (const key of [...track.attempts.keys()]) dropHold(track, key, 'CG-CLAIM-EXPIRED');
        }
        changed('newcomers');
      }),
    );
  }
  for (const s of SOURCES) {
    const directory = deps.directories[s];
    if (directory !== null) offs.push(directory.subscribe(() => cells[s].invalidate()));
  }

  return {
    kinds: ['preview'],
    getSnapshot: (selector) => cells[selector.from].get(),
    subscribe: (selector, listener) => cells[selector.from].subscribe(listener),
    dispatch,
    ready: () => readyPromise,
    draftOf(source, pageId, fanRef) {
      const key = ownerKey(source, pageId, fanRef);
      const draft = key === null ? null : findDraft(drafts, key, clock.now());
      return draft === null ? null : { text: draft.text, threadRevision: draft.threadRevision };
    },
    onDrafts(listener) {
      draftListeners.add(listener);
      return () => {
        draftListeners.delete(listener);
      };
    },
    batchStart,
    ended(opId, ms) {
      const track = tracks.get(opId);
      if (disposed || track === undefined) return Promise.resolve(false);
      if (track.mirror.done !== null) return Promise.resolve(track.mirror.done.state === 'done');
      return new Promise<boolean>((resolve) => {
        const wake = (ok: boolean): void => {
          clock.clearTimer(timer);
          endWaiters.get(opId)?.delete(wake);
          resolve(ok);
        };
        const timer = clock.setTimer(ms, () => wake(false));
        endWaiters.set(opId, (endWaiters.get(opId) ?? new Set()).add(wake));
      });
    },
    batchLive,
    batchNext,
    batchSend,
    batchSendState,
    batchSendNow,
    setOutreach(on) {
      if (deps.sender === null) return false;
      if (on !== outreachOn) {
        outreachOn = on;
        outreachChanged();
      }
      return media.available && deps.previewSend !== false;
    },
    outreachPicker() {
      const chat = outreachChat();
      if (!outreachOn || deps.sender === null || chat === null || !pageFlag(context.current(), 'previewSend')) return null;
      const vm = media.vm(chat);
      return vm === null || !vm.open ? null : vm;
    },
    outreachMedia: () => (outreachOn ? outreachMediaOf(outreachMedia) : null),
    outreachRow,
    outreachSend(type, handle, anyway) {
      // The card's own send of the fan's version, with the fan's media (the outreach's, unless the person picked the fan's own);
      // «Онлайн»'s text with what the person picked for the fan, if anything.
      const online = parseFanHandle(handle)?.source === 'online';
      if (deps.sender === null || (!outreachOn && !online)) return Promise.resolve(refused(type, localError('CG-FEATURE-DISABLED', i18n)));
      const next = rowPart(handle);
      if (next === null) return Promise.resolve(refused(type, localError('CG-SEND-PART', i18n)));
      // Only «Рассылка»'s fans take its media: «Онлайн»'s text goes with what its card shows (the fan's own picks), nothing else.
      if (next.track.source === 'outreach') adoptOutreach(next.track.target.chat);
      return deps.previewSend === false ? Promise.resolve(refused(type, localError('CG-FEATURE-DISABLED', i18n))) : sendPart(type, next.track, 0, next.index, anyway);
    },
    outreachEdit(handle, text) {
      const track = tracks.get(currentOp.get(handle) ?? '');
      if (track === undefined || !fromWindow(track.source)) return false;
      return editPart(track.source === 'online' ? 'EditOnline' : 'EditOutreach', track, 0, 0, text).ok;
    },
    onlineText,
    clearDraft,
    async outreachStates(fans, ids) {
      const port = host.media;
      const binding = context.current().binding;
      if (port === undefined || binding === null || ids.length === 0) return null;
      const states = new Map<string, readonly MediaFanState[]>();
      for (const fanRef of fans) {
        const read = await port.fanStates({ host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: fanRef }, ids.slice(0, MEDIA_LIMITS.idsPerRequest));
        if (!read.ok) return null;
        states.set(fanRef, read.value);
      }
      return states;
    },
    fromBatch: (opId) => batchOps.has(opId),
    onBatch(listener) {
      batchListeners.add(listener);
      return () => {
        batchListeners.delete(listener);
      };
    },
    results: {
      part: dockedPart,
      manualSent,
      async sync(opId): Promise<BoardSync> {
        const track = tracks.get(opId);
        if (track === undefined || !docked.has(opId)) return 'gone';
        const journal = await sendsNow(track.pageId, track.fanRef);
        // Another identity, or the result aged out, while the journal was read.
        if (tracks.get(opId) !== track || !docked.has(opId)) return 'gone';
        return journal === null ? 'read' : 'unread';
      },
      showing(opId) {
        const track = tracks.get(opId);
        return track !== undefined && !track.hidden && shownOn(track) !== null;
      },
      subscribe(listener) {
        dockListeners.add(listener);
        return () => {
          dockListeners.delete(listener);
        };
      },
    },
    dispose() {
      disposed = true;
      dockListeners.clear();
      batchListeners.clear();
      for (const settle of [...batchWaiters.values()]) settle({ s: 'failed', code: 'CG-CONTEXT-CHANGED' });
      batchWaiters.clear();
      for (const wake of [...endWaiters.values()].flatMap((waiters) => [...waiters])) wake(false);
      endWaiters.clear();
      offStore?.();
      draftListeners.clear();
      manualInserts.clear();
      for (const off of offs) off();
      for (const target of targets.values()) stopPoll(target);
      seen.dispose();
      for (const track of tracks.values()) clearHoldTimers(track);
      if (pruneTimer !== null) clock.clearTimer(pruneTimer);
      pruneTimer = null;
      if (resyncTimer !== null) clock.clearTimer(resyncTimer);
      resyncTimer = null;
      if (paceTimer !== null) clock.clearTimer(paceTimer);
      paceTimer = null;
      if (pendingInsert !== null) {
        pendingInsert.abort.abort();
        if (pendingInsert.timer !== null) clock.clearTimer(pendingInsert.timer);
        pendingInsert = null;
      }
      for (const s of SOURCES) cells[s].clear();
    },
  };
}
