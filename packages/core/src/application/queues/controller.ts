// «Очереди» (2026-10-29, the owner's prototype became the window; view `queues`): the page's fan queues a person
// works. A queue is made on someone's word through Gengar — a rule the hub evaluates or a list — and handed out in
// portions of up to ten (`queues.take`); the hub re-checks each fan as it hands him out and leases the portion to the
// person for half an hour, renewed while the window is open. The window is «Онлайн»'s twin, and its fan's card is
// «Онлайн»'s own card (the preview from `queue`): its Reply, Hi, Ping, «Шаблон», Fix, «Свой текст» and «Отправить →»
// are «Онлайн»'s actions with the card's `queue:` handle. This pass mirrors «Онлайн»'s (application/online/controller.ts)
// on purpose: the same way to write and to send on both sites — one click, one message, one attempt; an unknown
// outcome is never sent again by our button. A queue's template stands at once (no AI); Ping, Hi and Reply are written
// only by the card's click (2026-10-26, the owner).
//
// What the hub hears: each fan's outcome, once (`queues.done`) — a message went (with what, the template, an unknown
// outcome too: the safe side) or the person skipped him with a reason («Не подходит», «Позже», «Уже общаемся»,
// «Не предлагать»). A fan who answered a message from a queue comes up on top under «Ответили» with Reply advised.
// «Отправить всем» of a template queue (the owner's «2 да», 2026-10-29) goes through the portion one fan at a time,
// each by the card's own send, a second apart and never faster than the hub's minute — the «Новые» batch's rules.
// The day's portion is a target, never a block: «На сегодня всё» offers «Ещё 10».

import { type CgErrorWire } from '@cg/contracts/errors';
import { type FanQueueAnswered, type FanQueueItem, type FanQueues, type FanQueueSentAct, type FanQueueSummary, type FanQueueTake, type OnlineTemplate, type SendAttributionComposedWith } from '@cg/contracts/hub';
import { CHAT_IS_FAN, FAN_QUEUES_CAPABILITY } from '@cg/contracts/ids';
import { type IsoTimestamp } from '@cg/contracts/primitives';
import {
  BATCH_LIMITS,
  ONLINE_CHOICES,
  QUEUE_SKIP_REASONS,
  type ActionReceipt,
  type I18n,
  type OnlineAct,
  type OnlineCardVM,
  type OnlineChoice,
  type OnlineFanState,
  type OnlineReasonVM,
  type OnlineRowVM,
  type OutreachMediaVM,
  type OutreachSendVM,
  type OutreachWarningVM,
  type QueueBatchVM,
  type QueueChipVM,
  type QueueEndVM,
  type QueueHowVM,
  type QueueLineVM,
  type QueueSkipReason,
  type QueuesWindowVM,
  type TargetHandle,
  type UiAction,
  type UiActionType,
  type VmView,
} from '@cg/contracts/vm';

import { createBatch, type BatchPreviewPort, type OutreachCardRow } from '../boards/batch';
import { type PageContextPort, type PageContextState, flagFailure, pageFlag } from '../boards/context';
import { fanHandle, parseFanHandle } from '../boards/handles';
import { boardOpenRefusal, issueCause, type ChatNavigator } from '../boards/navigate';
import { type BoardsClock, type TabRpc } from '../boards/ports';
import { type PreviewDirectory, type PreviewTargetInfo, type Surfaces } from '../boards/shared';
import { ViewCell, done, refused, type SurfaceController } from '../boards/surface';
import { dataView, errorOf, failureView, loadingView, localError, msg, stamp } from '../boards/views';
import { fillTemplate, type OnlineOwnChannel, type OnlineSendAnswer } from '../online/controller';

/** The list is read again this often while the window is open and the tab is on screen; the portion's lease is renewed with it. */
export const QUEUES_POLL_MS = 60_000;
/** Fans one take asks for: the portion. */
export const QUEUES_PORTION = 10;
/** The keys stopped on a fan this long: their card opens (nothing is written). */
export const QUEUES_SETTLE_MS = 300;
/** After a send went, the next fan's card opens this much later: the person sees «Отправлено» first. */
export const QUEUES_ADVANCE_MS = 800;
/** One «Отправить» of the tab each half second (#343, #349): a run of clicks never goes out in one burst. */
export const QUEUES_PACE_MS = 500;
/** ChatSpace: the person's words for a template go onto the card this long after the last key. */
export const QUEUES_EDIT_SETTLE_MS = 500;
/** ChatSpace: a template that did not go onto the open card is tried again this much later. */
export const QUEUES_MANUAL_RETRY_MS = 3_000;
/** «Отправить всем»: how long one fan of the run may take to be ready, then to go, before the run leaves him to his card. */
export const QUEUES_BATCH_STEP_MS = 20_000;
/** «Отправить всем»: how often the run looks at the fan it waits for. */
const BATCH_LOOK_MS = 250;
/** The hub counts a minute; a little room over it. */
const MINUTE_MS = 61_000;
/** One text at most (the preview's draft limit). */
export const QUEUES_TEXT_MAX = 5_000;
/** A start the person's click gave no token for: nothing was written, a click on the card writes it. */
const NO_TOKEN = 'CG-UI-FAILED';

export interface QueuesControllerDeps {
  readonly rpc: TabRpc;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
  readonly navigator: ChatNavigator;
  /** Fansly: the site sends the texts itself (the background's send, «Онлайн»'s channel); absent — the fan's card sends them (ChatSpace, X8). */
  readonly own?: Pick<OnlineOwnChannel, 'group' | 'send'>;
  /** The tab is on screen: the list is read every minute only then. Absent — always. */
  readonly visible?: () => boolean;
  /** The fan whose chat is open on the page: the pass does not go there by itself. */
  readonly openChat?: () => string | null;
}

export interface QueuesController extends SurfaceController<'queues'> {
  /** Who a `queue:` handle is, and the neighbours in the window's order (the preview from `queue`). */
  readonly directory: PreviewDirectory;
  /** The preview, made after the lists: until then the window writes no texts. */
  attachBatch(port: BatchPreviewPort): void;
}

/** A send of the site's own channel (Fansly): where it stands. */
interface OwnSend {
  state: 'sending' | 'sent' | 'uncertain' | 'failed';
  code: string | null;
  readonly clickedAt: number;
  at: number | null;
}

/** What text a fan gets now. */
interface How {
  readonly act: OnlineAct;
  /** The AI's feature; null — the template, the person's own words, or nothing. */
  readonly feature: 'reply' | 'hi' | 'ping' | 'fix' | null;
  readonly template: OnlineTemplate | null;
}

interface TextOp {
  readonly opId: string;
  readonly key: string;
  readonly text: string;
}

/** A fan of this pass: what the person did and what went. */
interface PassFan {
  /** The person skipped the fan, and the hub took it: why (never undone here). */
  skipped: QueueSkipReason | null;
  /** The skip is on its way to the hub. */
  skipping: boolean;
  /** The template's turn: «Другой шаблон» moves it on. */
  template: number | null;
  chosen: OnlineChoice | 'own' | null;
  textOp: TextOp | null;
  making: boolean;
  edit: string | null;
  own: OwnSend | null;
  ownText: string | null;
  sent: { readonly text: string; readonly act: OnlineAct; readonly templateId: string | null; readonly at: number; readonly opId: string | null } | null;
  clickedAt: number | null;
  advanced: boolean;
  /** The hub heard of the send (`queues.done`), once. */
  reported: boolean;
  group: string | null;
  aiKey: string | null;
  manualFailedAt: number | null;
  clickAct: { readonly act: OnlineAct; readonly templateId: string | null } | null;
}

interface Facts {
  readonly state: OnlineFanState;
  readonly version: string | null;
  readonly edited: boolean;
  readonly editable: boolean;
  readonly send: OutreachSendVM | null;
  readonly warning: OutreachWarningVM | null;
  readonly media: OutreachMediaVM | null;
  readonly sentAt: IsoTimestamp | null;
  readonly clickedAt: IsoTimestamp | null;
  readonly failedAt: IsoTimestamp | null;
  readonly code: string | null;
  readonly archiveAt: IsoTimestamp | null;
}

/** A fan the window knows: of the portion (`portion`), or one who answered a message from a queue (`answered`). */
interface Known {
  readonly item: FanQueueItem;
  readonly answered: FanQueueAnswered | null;
  /** Known only by the hub's list of answers: his money and his subscription are not known. */
  readonly factless?: true;
}

/** «Отправить всем»'s run. */
interface Run {
  running: boolean;
  held: boolean;
  readonly total: number;
  done: number;
}

const QUEUES_SELECTOR = { of: 'queues' } as const;
const RETRY: UiAction = { type: 'ReloadView', selector: QUEUES_SELECTOR };
const WENT: readonly OnlineFanState[] = ['sent', 'uncertain'];
const MOVING: readonly OnlineFanState[] = ['sending', 'accepted'];
const iso = (ms: number | null): IsoTimestamp | null => (ms === null ? null : new Date(ms).toISOString());
const timeOf = (at: string | null): number | null => {
  if (at === null) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * A prepared text with the fan's name (2026-10-29, the owner): the queue's own message names him where it says `{name}`
 * (every one), the guide's where it says «love» (the first one). No name: `{name}` goes away cleanly with its comma or
 * space, «love» stays.
 */
export function fillQueueText(text: string, name: string | null): string {
  const named = name === null ? '' : name.trim();
  if (!text.includes('{name}')) return fillTemplate(text, named === '' ? null : named);
  if (named !== '') return text.replace(/\{name\}/g, named);
  return text
    .replace(/^\s*\{name\}\s*[,!.:]?\s*/, '')
    .replace(/[ \t]*\{name\}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,!?.])/g, '$1')
    .trim();
}

/** How a queue writes, as its line and its chip read it. */
export function howOfQueue(queue: FanQueueSummary): QueueHowVM {
  const scenario = queue.scenario;
  const action = (['auto', 'hi', 'ping', 'reply', 'template', 'own'] as const).find((one) => one === scenario.action) ?? 'auto';
  const group = scenario.templates === 'a' || scenario.templates === 'b' ? scenario.templates : null;
  const own = action === 'template' && (scenario.texts?.length ?? 0) > 0;
  return { action, group: own ? null : group, own, batch: action === 'template' && scenario.sendMode === 'batch' };
}

/**
 * The item an answered fan's card reads: the fan's last item of this window when there is one (his facts, his money),
 * else what the hub said of the answer — he waits for a Reply.
 */
function answeredItem(answer: FanQueueAnswered, known: FanQueueItem | undefined): FanQueueItem {
  const base: FanQueueItem = known ?? {
    fanRef: answer.fanRef,
    conversationRef: answer.conversationRef,
    username: answer.username,
    displayName: answer.displayName,
    alias: answer.alias,
    greetingName: null,
    lifetimeGrossMills: 0,
    last30dGrossMills: 0,
    seenAt: null,
    onlineSince: null,
    seenSource: null,
    reason: 'waiting',
    reasonAt: answer.answeredAt,
    act: 'reply',
    aside: null,
    asideAt: null,
    asideBy: null,
    messageCount: 10,
    lastFanMessageAt: answer.answeredAt,
    lastPageMessageAt: answer.sentAt,
    subscription: { isSubscriber: false, startedAt: null, endsAt: null, autoRenew: null },
    itemId: answer.itemId,
    queueId: answer.queueId,
    why: null,
    leaseUntil: answer.answeredAt,
    templateId: null,
    followedAt: null,
    massLast90d: { count: 0, lastAt: null },
  };
  // He was there when he answered: his last activity is that, unless the hub saw him later.
  const seenAt = base.seenAt !== null && (timeOf(base.seenAt) ?? 0) > (timeOf(answer.answeredAt) ?? 0) ? base.seenAt : answer.answeredAt;
  return { ...base, itemId: answer.itemId, queueId: answer.queueId, reason: 'waiting', reasonAt: answer.answeredAt, act: 'reply', seenAt, lastFanMessageAt: answer.answeredAt, lastPageMessageAt: answer.sentAt, conversationRef: answer.conversationRef ?? base.conversationRef };
}

export function createQueuesController(deps: QueuesControllerDeps): QueuesController {
  const { rpc, i18n, clock, context, surfaces, navigator } = deps;
  const own = deps.own ?? null;
  const visible = deps.visible ?? ((): boolean => true);

  // ── the hub's list and the chosen queue's portion ──
  let list: FanQueues | null = null;
  let listError: CgErrorWire | null = null;
  let loadedAt: number | null = null;
  let reads = 0;
  let pollTimer: number | null = null;
  let chosen: number | null = null;
  let take: FanQueueTake | null = null;
  /** The portion's fans in the order they came, done ones kept until the next portion. */
  let order: string[] = [];
  /** Every fan of the window: the portion's, and the answered ones'. */
  let known = new Map<string, Known>();
  /** The last item of each fan the window saw (an answered fan's card reads it). */
  const seen = new Map<string, FanQueueItem>();
  let taking = false;
  let takeError: CgErrorWire | null = null;
  /** The chosen queue's portion was done in this window: «Порция пройдена» until the next take. */
  let portionDone = false;
  /** Sent and skipped in this portion. */
  let tally = { sent: 0, skipped: 0 };

  // ── the person's moves ──
  let pending: string | null = null;
  let settleTimer: number | null = null;
  let advanceTimer: number | null = null;
  let manualTimer: number | null = null;
  let startPending = false;
  let opening = 0;
  let lastCard: string | null = null;

  // ── the pass: one per hub, person and page ──
  const passes = new Map<string, Map<string, PassFan>>();
  const passOfContext = (state: PageContextState): Map<string, PassFan> => {
    const key = `${state.session?.hubOrigin ?? ''}|${state.session?.userId ?? ''}|${state.binding?.pageId ?? ''}`;
    let found = passes.get(key);
    if (found === undefined) {
      found = new Map();
      passes.set(key, found);
    }
    return found;
  };
  let pass = passOfContext(context.current());
  let pacedUntil = 0;
  let paceTimer: number | null = null;
  let run: Run | null = null;

  let batchPort: BatchPreviewPort | null = null;
  let offBatch: (() => void) | null = null;
  let epoch = context.current().epoch;
  let disposed = false;

  const pageId = (): number | null => context.current().binding?.pageId ?? null;
  const handleOf = (fanRef: string): TargetHandle => fanHandle('queue', pageId() ?? 0, fanRef);
  const fanOf = (handle: TargetHandle): string | null => {
    const parsed = parseFanHandle(handle);
    return parsed !== null && parsed.source === 'queue' && parsed.pageId === pageId() ? parsed.fanRef : null;
  };
  const openFan = (): string | null => {
    const handle = surfaces.current().preview.queue;
    return handle === null ? null : fanOf(handle);
  };
  const passOf = (fanRef: string): PassFan => {
    let fan = pass.get(fanRef);
    if (fan === undefined) {
      fan = { skipped: null, skipping: false, template: null, chosen: null, textOp: null, making: false, edit: null, own: null, ownText: null, sent: null, clickedAt: null, advanced: false, reported: false, group: null, aiKey: null, manualFailedAt: null, clickAct: null };
      pass.set(fanRef, fan);
    }
    return fan;
  };
  const itemOf = (fanRef: string): FanQueueItem | undefined => known.get(fanRef)?.item;
  const queueOf = (queueId: number | null): FanQueueSummary | null => (queueId === null ? null : (list?.queues.find((queue) => queue.queueId === queueId) ?? null));

  const batch = createBatch({
    clock,
    // Each Reply, Hi or Ping is its own click: it starts at once (the click's token lives seconds).
    parallel: Number.POSITIVE_INFINITY,
    async start(handle) {
      const fanRef = fanOf(handle);
      const item = fanRef === null ? undefined : itemOf(fanRef);
      const port = batchPort;
      if (port === null || fanRef === null || item === undefined) return { s: 'failed', code: 'CG-CONTEXT-CHANGED' };
      const how = howOf(fanRef, item);
      if (how.feature === null) return { s: 'failed', code: 'CG-FEATURE-DISABLED' };
      const fan = passOf(fanRef);
      fan.aiKey = keyOf(how);
      const outcome = await port.batchStart('queue', handle, how.feature);
      if (outcome.s === 'busy') return { s: 'failed', code: 'CG-OP-TAB-LIMIT' };
      if (outcome.s === 'ready' && own === null) {
        const row = port.outreachRow?.(handle) ?? null;
        fan.textOp = row === null ? null : { opId: row.opId, key: keyOf(how), text: row.text };
      }
      return outcome;
    },
    live: (handle) => batchPort?.batchLive(handle) ?? null,
    changed: () => changed(),
  });

  // ── who and why ──

  const usable = (ctx: PageContextState): boolean => ctx.phase === 'ready' && pageFlag(ctx, 'preview') && ctx.bootstrap?.capabilities.includes(FAN_QUEUES_CAPABILITY) === true;

  /** The fan wrote after a text went from here: he waits for an answer again (his card advises Reply). */
  const answeredNow = (fanRef: string): boolean => {
    const entry = known.get(fanRef);
    if (entry === undefined) return false;
    if (entry.answered !== null) {
      const fan = pass.get(fanRef);
      // A Reply from here after the answer: he is answered, until the hub says otherwise.
      return fan?.sent === null || fan?.sent === undefined || fan.sent.at < (timeOf(entry.answered.answeredAt) ?? 0);
    }
    return false;
  };

  function reasonOf(fanRef: string, item: FanQueueItem): OnlineReasonVM {
    const entry = known.get(fanRef);
    if (entry?.answered !== null && entry?.answered !== undefined) return { kind: 'answered', at: entry.answered.answeredAt };
    const queue = queueOf(item.queueId);
    const noHistory = item.lastFanMessageAt === null && item.massLast90d.count > 0;
    return {
      kind: 'queue',
      queue: queue?.name ?? '',
      why: item.why,
      goal: queue?.goal ?? null,
      mass: noHistory ? { count: item.massLast90d.count, lastAt: item.massLast90d.lastAt } : null,
    };
  }

  /** The templates of a group: the guide's (`a`, `b`) or the queue's own (`q<queueId>`), in the hub's order. */
  const templatesOf = (group: string): OnlineTemplate[] => (list?.templates ?? []).filter((one) => one.group === group);

  /** The template group of a fan: the queue's own texts, else the hub's act (A or B), else B for a fan who never wrote. */
  function groupFor(item: FanQueueItem): string {
    if (item.act === 'template_q') return `q${item.queueId}`;
    if (item.act === 'template_a') return 'a';
    if (item.act === 'template_b') return 'b';
    return item.messageCount > 0 ? 'a' : 'b';
  }

  /** The template a fan gets: the hub's pick for him first (neighbours differ), «Другой шаблон» the next. */
  function templateFor(fanRef: string, item: FanQueueItem): OnlineTemplate | null {
    const texts = templatesOf(groupFor(item));
    if (texts.length === 0) return null;
    const fan = passOf(fanRef);
    if (fan.template === null) {
      const picked = item.templateId === null ? -1 : texts.findIndex((one) => one.id === item.templateId);
      fan.template = picked >= 0 ? picked : Math.max(0, item.itemId) % texts.length;
    }
    return texts[fan.template % texts.length] ?? null;
  }

  /** The hub's advice for the fan now: Reply to one who answered; a template; Ping, Hi or Reply; null — the person writes. */
  function adviceOf(fanRef: string, item: FanQueueItem): OnlineChoice | null {
    if (answeredNow(fanRef)) return 'reply';
    if (item.act === 'reply' || item.act === 'hi' || item.act === 'ping') return item.act;
    return item.act === 'template_a' || item.act === 'template_b' || item.act === 'template_q' ? 'template' : null;
  }

  const NO_TEXT: How = { act: 'none', feature: null, template: null };
  const OWN_TEXT: How = { act: 'own', feature: null, template: null };

  function howOf(fanRef: string, item: FanQueueItem): How {
    const chosenNow = pass.get(fanRef)?.chosen ?? null;
    if (chosenNow === null) return NO_TEXT;
    if (chosenNow === 'own') return OWN_TEXT;
    if (chosenNow !== 'template') return { act: chosenNow, feature: chosenNow, template: null };
    const template = templateFor(fanRef, item);
    return template === null ? NO_TEXT : { act: 'template', feature: null, template };
  }

  const actOf = (fanRef: string, item: FanQueueItem): OnlineAct => {
    const how = howOf(fanRef, item);
    return how.act !== 'none' ? how.act : (adviceOf(fanRef, item) ?? 'none');
  };

  const keyOf = (how: How): string => (how.template !== null ? `t:${how.template.id}` : how.act === 'own' ? 'own' : `a:${how.feature ?? ''}`);
  const templateText = (item: FanQueueItem, template: OnlineTemplate): string => fillQueueText(template.text, item.greetingName);
  const manual = (how: How): boolean => how.template !== null || how.act === 'own';
  const manualText = (fan: PassFan | undefined, item: FanQueueItem, how: How): string => fan?.edit ?? (how.template === null ? '' : templateText(item, how.template));

  // ── each fan's text and send, one shape for both sites («Онлайн»'s) ──

  const paced = (): boolean => clock.now() < pacedUntil;
  const ownSending = (): boolean => [...pass.values()].some((fan) => fan.own?.state === 'sending');

  function pace(): void {
    pacedUntil = clock.now() + QUEUES_PACE_MS;
    if (paceTimer !== null) clock.clearTimer(paceTimer);
    paceTimer = clock.setTimer(QUEUES_PACE_MS, () => {
      paceTimer = null;
      changed();
    });
  }

  const NONE: Facts = { state: 'idle', version: null, edited: false, editable: false, send: null, warning: null, media: null, sentAt: null, clickedAt: null, failedAt: null, code: null, archiveAt: null };

  function cardFacts(fan: PassFan, row: OutreachCardRow): Facts {
    const send = row.send;
    const clicked = iso(fan.clickedAt);
    const base = { ...NONE, version: row.text, edited: row.edited, editable: row.editable, media: row.media, archiveAt: row.archiveAt };
    if (send === null) return { ...base, state: 'ready' };
    switch (send.s) {
      case 'available':
        return { ...base, state: 'ready', send: { can: row.can, kind: 'send', paused: row.paused, reason: null } };
      case 'unverified':
        return { ...base, state: 'ready', send: { can: !row.paused, kind: 'anyway', paused: row.paused, reason: null }, warning: { kind: 'archive' } };
      case 'held-stale':
        return { ...base, state: 'ready', send: { can: !row.paused, kind: 'anyway', paused: row.paused, reason: null }, warning: { kind: 'stale', at: send.at } };
      case 'held-talking':
        return { ...base, state: 'ready', send: { can: !row.paused, kind: 'anyway', paused: row.paused, reason: null }, warning: { kind: 'talking', names: send.names, at: send.at } };
      case 'unavailable':
        return { ...base, state: 'ready', send: { can: false, kind: 'send', paused: row.paused, reason: row.paused ? null : send.reason } };
      case 'queued':
      case 'sending':
        return { ...base, state: 'sending', editable: false, clickedAt: clicked };
      case 'accepted':
        return { ...base, state: 'accepted', editable: false, clickedAt: clicked };
      case 'sent':
        return { ...base, state: 'sent', editable: false, sentAt: send.at, clickedAt: clicked };
      case 'rejected':
        return { ...base, state: 'failed', code: send.code, failedAt: clicked, send: send.canRetry ? { can: !row.paused, kind: 'retry', paused: row.paused, reason: null } : null };
      case 'uncertain':
        return { ...base, state: 'uncertain', editable: false, clickedAt: send.since };
    }
  }

  function factsOf(fanRef: string, item: FanQueueItem): Facts {
    const handle = handleOf(fanRef);
    const fan = pass.get(fanRef);
    const how = howOf(fanRef, item);
    const again = answeredNow(fanRef) && fan?.sent !== null && fan?.sent !== undefined;
    if (own === null) {
      const card = batchPort?.outreachRow?.(handle) ?? null;
      if (card !== null && fan !== undefined && fan.clickedAt !== null && !(again && card.opId === fan.sent?.opId)) {
        const facts = cardFacts(fan, card);
        if (MOVING.includes(facts.state) || WENT.includes(facts.state) || facts.state === 'failed') return facts;
      }
      if (how.act === 'none') return NONE;
      const key = keyOf(how);
      const op = fan?.textOp ?? null;
      const ours = card !== null && fan !== undefined && op !== null && card.opId === op.opId && op.key === key && !(again && card.opId === fan.sent?.opId);
      if (manual(how)) {
        const wanted = manualText(fan, item, how);
        const edited = how.template !== null && (fan?.edit ?? null) !== null;
        if (ours && op.text === wanted) {
          const facts = cardFacts(fan, card);
          return facts.state === 'ready' || facts.state === 'failed' ? { ...facts, version: wanted, edited, editable: true } : facts;
        }
        const making = fan?.making === true || ours;
        const reason = making ? 'online.reason.making' : (fan?.manualFailedAt ?? null) !== null ? 'online.reason.retry' : 'online.reason.openCard';
        return { ...NONE, state: 'ready', version: wanted, edited, editable: true, send: { can: false, kind: 'send', paused: false, reason: msg(reason) } };
      }
      if (ours) return cardFacts(fan, card);
      return aiFacts(fanRef, handle, key);
    }
    // The site's own send (Fansly).
    const sent = fan?.own;
    if (sent !== null && sent !== undefined && sent.state !== 'failed' && fan?.ownText !== null && fan?.ownText !== undefined && !again) {
      const base = { ...NONE, version: fan.ownText, clickedAt: iso(sent.clickedAt) };
      if (sent.state === 'sending') return { ...base, state: 'sending' };
      if (sent.state === 'sent') return { ...base, state: 'sent', sentAt: iso(sent.at) };
      return { ...base, state: 'uncertain' };
    }
    if (how.act === 'none') return NONE;
    let version: string | null;
    if (manual(how)) version = manualText(fan, item, how);
    else {
      const ai = aiFacts(fanRef, handle, keyOf(how));
      if (ai.state !== 'ready') return ai;
      version = fan?.edit ?? ai.version;
    }
    const empty = version === null || version.trim().length === 0;
    const resting = paced() || ownSending();
    const failed = sent?.state === 'failed';
    return {
      ...NONE,
      state: failed ? 'failed' : 'ready',
      version,
      edited: how.act !== 'own' && fan?.edit !== null && fan?.edit !== undefined,
      editable: true,
      code: failed ? sent.code : null,
      failedAt: failed ? iso(sent.at) : null,
      send: { can: !resting && !empty, kind: failed ? 'retry' : 'send', paused: resting && !empty, reason: empty ? msg('online.reason.empty') : null },
    };
  }

  function aiFacts(fanRef: string, handle: TargetHandle, key: string): Facts {
    if (batchPort === null) return NONE;
    if (pass.get(fanRef)?.aiKey !== key) return NONE;
    const row = batch.row(handle);
    switch (row.state) {
      case null:
        return NONE;
      case 'queued':
      case 'generating':
        return { ...NONE, state: 'writing' };
      case 'failed':
        return row.failure?.code === NO_TOKEN ? NONE : { ...NONE, state: 'unwritten', code: row.failure?.code ?? null };
      case 'ready':
      case 'sent':
        return { ...NONE, state: 'ready', version: row.text };
    }
  }

  /** Done in this pass: it went (and the fan has not answered), it may have, or the hub took his skip. */
  function doneOf(fanRef: string, fan: PassFan | undefined, facts: Facts): boolean {
    if (fan?.skipped !== null && fan?.skipped !== undefined) return true;
    if (answeredNow(fanRef)) return false;
    return WENT.includes(facts.state) || MOVING.includes(facts.state);
  }

  // ── view models ──

  interface Entry {
    readonly fanRef: string;
    readonly item: FanQueueItem;
    readonly fan: PassFan | undefined;
    readonly facts: Facts;
    readonly reason: OnlineReasonVM;
    readonly done: boolean;
    readonly name: string;
    readonly answered: boolean;
  }

  const nameOf = (item: FanQueueItem): string => item.alias ?? item.displayName ?? item.username ?? `#${item.fanRef}`;

  function entryOf(fanRef: string): Entry | null {
    const entry = known.get(fanRef);
    if (entry === undefined) return null;
    const item = entry.item;
    const fan = pass.get(fanRef);
    const facts = factsOf(fanRef, item);
    return { fanRef, item, fan, facts, reason: reasonOf(fanRef, item), done: doneOf(fanRef, fan, facts), name: nameOf(item), answered: entry.answered !== null };
  }

  /** «Ответили» first (the newest answer on top), then the portion in the queue's order. */
  function entriesOf(): { readonly answered: Entry[]; readonly portion: Entry[] } {
    const answered: Entry[] = [];
    for (const answer of list?.answered ?? []) {
      const entry = entryOf(answer.fanRef);
      if (entry !== null && entry.answered) answered.push(entry);
    }
    const portion: Entry[] = [];
    for (const fanRef of order) {
      if (answered.some((entry) => entry.fanRef === fanRef)) continue;
      const entry = entryOf(fanRef);
      if (entry !== null) portion.push(entry);
    }
    return { answered, portion };
  }

  const all = (entries: { readonly answered: Entry[]; readonly portion: Entry[] }): Entry[] => [...entries.answered, ...entries.portion];

  /** The next fan after `from`: whoever answered first, then the next one down the portion — never the fan whose chat is open. */
  function nextTodo(from: string | null, entries: { readonly answered: Entry[]; readonly portion: Entry[] }): string | null {
    const here = deps.openChat?.() ?? null;
    const ok = (entry: Entry): boolean => !entry.done && entry.fanRef !== from && entry.fanRef !== here && entry.fan?.skipping !== true;
    const waiting = entries.answered.find(ok);
    if (waiting !== undefined) return waiting.fanRef;
    const sequence = all(entries).map((entry) => entry.fanRef);
    const at = from === null ? -1 : sequence.indexOf(from);
    const todo = all(entries).filter(ok);
    for (let index = at + 1; index < sequence.length; index += 1) {
      const fanRef = sequence[index];
      if (todo.some((entry) => entry.fanRef === fanRef)) return fanRef ?? null;
    }
    return todo[0]?.fanRef ?? null;
  }

  function rowOf(entry: Entry, open: string | null): OnlineRowVM {
    const { item, fan, facts } = entry;
    const answer = known.get(entry.fanRef)?.answered ?? null;
    return {
      handle: handleOf(entry.fanRef),
      name: entry.name,
      username: item.username,
      lifetime: item.lifetimeGrossMills > 0 ? item.lifetimeGrossMills : null,
      seenAt: item.seenAt,
      onlineSince: item.onlineSince,
      live: false,
      presence: presenceOf(item),
      reason: entry.reason,
      aside: null,
      act: actOf(entry.fanRef, item),
      state: facts.state,
      version: facts.version,
      sentAct: fan?.sent?.act ?? (answer === null ? null : sentActOf(answer.act)),
      sentAt: fan?.sent === null || fan?.sent === undefined ? null : iso(fan.sent.at),
      skipped: fan?.skipped !== null && fan?.skipped !== undefined,
      selected: entry.fanRef === (pending ?? open),
      arrived: false,
      replied: answer === null || !answeredNow(entry.fanRef) ? null : { at: answer.answeredAt, text: answer.answerText },
      code: facts.code,
      ...(known.get(entry.fanRef)?.factless === true ? { moneyUnknown: true as const } : {}),
    };
  }

  /** How fresh the fan's presence is: within 3 hours green, within two days amber, older grey (the queue's fans are not «online»). */
  function presenceOf(item: FanQueueItem): OnlineRowVM['presence'] {
    const at = timeOf(item.seenAt);
    if (at === null) return 'gone';
    const age = clock.now() - at;
    return age <= 3 * 60 * 60_000 ? 'now' : age <= 48 * 60 * 60_000 ? 'fading' : 'gone';
  }

  const sentActOf = (act: string | null): OnlineAct | null => (act === 'reply' || act === 'hi' || act === 'ping' || act === 'template' || act === 'own' || act === 'fix' ? act : null);

  function cardOf(entry: Entry, entries: { readonly answered: Entry[]; readonly portion: Entry[] }): OnlineCardVM {
    const { item, fan, facts } = entry;
    const how = howOf(entry.fanRef, item);
    const nextRef = nextTodo(entry.fanRef, entries);
    const next = nextRef === null ? null : (all(entries).find((other) => other.fanRef === nextRef) ?? null);
    const writing = facts.state === 'writing';
    const went = WENT.includes(facts.state) || MOVING.includes(facts.state);
    const advice = adviceOf(entry.fanRef, item);
    const hasTemplates = templatesOf(groupFor(item)).length > 0;
    const choices =
      batchPort === null || went || fan?.skipped !== null && fan?.skipped !== undefined
        ? []
        : ONLINE_CHOICES.filter((choice) => choice !== 'template' || hasTemplates).map((choice) => ({ act: choice, suggested: choice === advice, current: choice === fan?.chosen && facts.state !== 'idle' }));
    const group = how.template?.group ?? null;
    // The queue's own message (group `q<queueId>`): «Сообщение очереди», its variant of the queue's texts.
    const ownTexts = how.template !== null && group !== null && group.startsWith('q') ? templatesOf(group) : null;
    const template =
      how.template === null
        ? null
        : {
            id: how.template.id,
            group: group === 'a' ? ('a' as const) : ('b' as const),
            named: /\blove\b|\{name\}/.test(how.template.text) ? item.greetingName !== null : null,
            greeting: item.greetingName,
            ...(ownTexts === null ? {} : { own: { n: Math.max(1, ownTexts.findIndex((one) => one.id === how.template?.id) + 1), of: ownTexts.length } }),
          };
    const noChat = own !== null && item.conversationRef === null && (fan?.group ?? null) === null;
    const answer = known.get(entry.fanRef)?.answered ?? null;
    return {
      handle: handleOf(entry.fanRef),
      name: entry.name,
      username: item.username,
      lifetime: item.lifetimeGrossMills > 0 ? item.lifetimeGrossMills : null,
      last30: item.last30dGrossMills > 0 ? item.last30dGrossMills : null,
      seenAt: item.seenAt,
      onlineSince: item.onlineSince,
      live: false,
      presence: presenceOf(item),
      subscription: item.subscription.isSubscriber ? { startedAt: item.subscription.startedAt, endsAt: item.subscription.endsAt, autoRenew: item.subscription.autoRenew } : null,
      reason: entry.reason,
      aside: null,
      act: actOf(entry.fanRef, item),
      advice,
      choices,
      template,
      state: facts.state,
      version: facts.version,
      edited: facts.edited,
      editable: facts.editable && !writing,
      rewrite: batchPort !== null && !writing && !went && (how.feature !== null ? facts.state !== 'idle' : how.template !== null && templatesOf(how.template.group).length > 1),
      send: facts.send,
      warning: facts.warning,
      media: facts.media,
      archiveAt: facts.archiveAt,
      sentAt: facts.sentAt,
      clickedAt: facts.clickedAt,
      failedAt: facts.failedAt,
      code: facts.code,
      replied: answer === null || !answeredNow(entry.fanRef) ? null : { at: answer.answeredAt, text: answer.answerText },
      skipped: fan?.skipped !== null && fan?.skipped !== undefined,
      dismiss: 'dismiss',
      noChat,
      next: next === null ? null : { handle: handleOf(next.fanRef), name: next.name },
      queue: { skips: entry.answered ? [] : QUEUE_SKIP_REASONS, skipped: fan?.skipped ?? null },
      ...(known.get(entry.fanRef)?.factless === true ? { moneyUnknown: true as const } : {}),
    };
  }

  function viewOf(ctx: PageContextState): VmView {
    if (ctx.phase === 'loading') return loadingView(null);
    if (ctx.phase === 'blocked') return failureView(ctx.blocker ?? { code: 'CG-UNKNOWN' }, i18n, RETRY);
    if (!pageFlag(ctx, 'preview')) return failureView(flagFailure(ctx, 'preview'), i18n, RETRY);
    if (ctx.bootstrap?.capabilities.includes(FAN_QUEUES_CAPABILITY) !== true) return { s: 'forbidden', error: localError('CG-FEATURE-DISABLED', i18n), remedy: null };
    if (list === null) return listError !== null ? failureView(listError, i18n, RETRY) : loadingView(null);
    if (list.queues.length === 0 && list.answered.length === 0) return { s: 'empty', why: msg('queues.empty') };
    if (listError !== null) return dataView([{ kind: 'source-failed', source: 'queues', code: listError.code }]);
    if (takeError !== null) return dataView([{ kind: 'source-failed', source: 'queues', code: takeError.code }]);
    return dataView([]);
  }

  function chipsOf(): QueueChipVM[] {
    return (list?.queues ?? []).map((queue) => ({
      queueId: queue.queueId,
      name: queue.name,
      standing: queue.kind === 'standing',
      mine: queue.mineOnly,
      paused: queue.status === 'paused',
      today: queue.today.mine,
      perPerson: queue.perPerson,
      done: queue.perPerson !== null && queue.today.mine >= queue.perPerson,
      selected: queue.queueId === chosen,
    }));
  }

  function lineOf(queue: FanQueueSummary | null): QueueLineVM | null {
    if (queue === null) return null;
    return { goal: queue.goal, rule: queue.ruleText, how: howOfQueue(queue), people: queue.distribution === 'people', requestedBy: queue.requestedBy };
  }

  /** The fans of the portion whose template would go by «Отправить всем» now. */
  function batchable(entries: { readonly portion: Entry[] }): Entry[] {
    return entries.portion.filter((entry) => !entry.done && entry.fan?.skipping !== true && (entry.fan?.chosen ?? 'template') === 'template' && templatesOf(groupFor(entry.item)).length > 0);
  }

  function batchOf(queue: FanQueueSummary | null, entries: { readonly portion: Entry[] }): QueueBatchVM | null {
    if (queue === null || !howOfQueue(queue).batch || queue.status !== 'active') return null;
    const ready = batchable(entries).length;
    if (run?.running === true) return { ready, running: { done: run.done, total: run.total, held: run.held }, reason: null };
    const reason = batchPort === null ? msg('online.reason.openCard') : ready === 0 ? msg('queues.batch.went') : null;
    return { ready, running: null, reason };
  }

  function endOf(queue: FanQueueSummary | null, entries: { readonly portion: Entry[] }): QueueEndVM {
    if (queue === null) return { kind: 'pick' };
    if (queue.status === 'paused') return { kind: 'paused', by: queue.pausedBy, at: queue.pausedAt, pending: queue.pending };
    const left = entries.portion.filter((entry) => !entry.done).length;
    if (left > 0) return { kind: 'pick' };
    const stopped = take?.stopped ?? null;
    const day = queue.today;
    if (queue.perPerson !== null && day.mine >= queue.perPerson && (stopped === 'portion_done' || portionDone || entries.portion.length === 0)) {
      const room = queue.dailyLimit === null ? null : Math.max(0, queue.dailyLimit - day.page);
      return { kind: 'day', today: day.mine, perPerson: queue.perPerson, room, dailyLimit: queue.dailyLimit };
    }
    if (stopped === 'limit_reached') return { kind: 'limit', dailyLimit: queue.dailyLimit };
    if (entries.portion.length === 0 && (stopped === 'empty' || queue.pending === 0)) return { kind: 'empty' };
    return { kind: 'portion', sent: tally.sent, skipped: tally.skipped, today: day.mine, perPerson: queue.perPerson, page: day.page, dailyLimit: queue.dailyLimit, pending: queue.pending };
  }

  function build(): QueuesWindowVM {
    const ctx = context.current();
    const open = openFan();
    const entries = entriesOf();
    const queue = queueOf(chosen);
    const openEntry = open === null ? null : (all(entries).find((entry) => entry.fanRef === open) ?? null);
    const card = openEntry === null ? null : cardOf(openEntry, entries);
    const me = ctx.session?.login ?? null;
    return {
      view: viewOf(ctx),
      pageName: ctx.page?.title ?? null,
      creator: ctx.account?.username ?? null,
      me,
      stamp: stamp(iso(loadedAt), list === null ? 'unknown' : 'complete'),
      chips: chipsOf(),
      line: lineOf(queue),
      answered: entries.answered.map((entry) => rowOf(entry, open)),
      portion: entries.portion.map((entry) => rowOf(entry, open)),
      left: entries.portion.filter((entry) => !entry.done).length,
      taking,
      day: queue === null ? null : { mine: queue.today.mine, perPerson: queue.perPerson, page: queue.today.page, dailyLimit: queue.dailyLimit, pending: queue.pending },
      batch: batchOf(queue, entries),
      card,
      end: card === null ? endOf(queue, entries) : null,
    };
  }

  const cell = new ViewCell(build);

  function changed(light = false): void {
    if (disposed) return;
    if (!light) followSends();
    cell.invalidate();
    if (!light) for (const listener of [...directoryListeners]) listener();
  }

  /** What went from here is told to the hub once (`queues.done`, never repeated); once the open card's text went the next card opens. */
  function followSends(): void {
    const open = openFan();
    for (const [fanRef, fan] of pass) {
      if (fan.clickedAt === null || (fan.reported && fan.advanced)) continue;
      const item = itemOf(fanRef);
      if (item === undefined) continue;
      const facts = factsOf(fanRef, item);
      const went = facts.state === 'sent' || facts.state === 'accepted' || facts.state === 'uncertain';
      if (!went) continue;
      if (fan.sent === null || fan.sent.at < fan.clickedAt) {
        const how = howOf(fanRef, item);
        const act = fan.clickAct ?? { act: how.act, templateId: how.template?.id ?? null };
        fan.sent = { text: facts.version ?? '', act: act.act, templateId: act.templateId, at: timeOf(facts.sentAt) ?? clock.now(), opId: own === null ? (batchPort?.outreachRow?.(handleOf(fanRef))?.opId ?? null) : null };
      }
      if (!fan.reported) {
        fan.reported = true;
        report(pageId(), fanRef, item, fan.sent, facts.state === 'uncertain');
      }
      if (!fan.advanced) {
        fan.advanced = true;
        if (fanRef === open && facts.state !== 'uncertain' && run?.running !== true) scheduleAdvance(fanRef);
      }
    }
  }

  /**
   * The hub's record of a send, for the page it went from: once, never repeated. A Reply to a fan who answered goes
   * on record by the hub's archive alone: his queue's fan was reported when the first message went.
   */
  function report(id: number | null, fanRef: string, item: FanQueueItem, sent: NonNullable<PassFan['sent']>, uncertain: boolean): void {
    if (id === null || known.get(fanRef)?.answered !== null) return;
    const act: FanQueueSentAct = sent.act === 'reply' || sent.act === 'hi' || sent.act === 'ping' || sent.act === 'template' ? sent.act : 'own';
    tally = { ...tally, sent: tally.sent + 1 };
    void rpc
      .request('queues.done', {
        pageId: id,
        itemId: item.itemId,
        outcome: 'sent',
        act,
        ...(sent.templateId === null || act !== 'template' ? {} : { templateId: sent.templateId }),
        ...(uncertain ? { uncertain: true } : {}),
      })
      .then((answer) => {
        if (answer.ok) dayFrom(item.queueId, answer.payload.today);
      })
      .catch(() => undefined);
  }

  /** The hub's word on the day after a report: the chip and the foot follow without a new read. */
  function dayFrom(queueId: number, today: { readonly mine: number; readonly page: number }): void {
    if (list === null) return;
    list = { ...list, queues: list.queues.map((queue) => (queue.queueId === queueId ? { ...queue, today } : queue)) };
    changed(true);
  }

  function scheduleAdvance(from: string): void {
    if (advanceTimer !== null) clock.clearTimer(advanceTimer);
    advanceTimer = clock.setTimer(QUEUES_ADVANCE_MS, () => {
      advanceTimer = null;
      if (disposed || openFan() !== from || pending !== null) return;
      advance(from);
    });
  }

  function advance(from: string): void {
    const next = nextTodo(from, entriesOf());
    if (next === null) {
      if (entriesOf().portion.every((entry) => entry.done)) portionDone = true;
      surfaces.setPreview('queue', null);
      changed();
      return;
    }
    void openCard(next);
  }

  // ── reads ──

  async function read(): Promise<void> {
    const ctx = context.current();
    const binding = ctx.binding;
    if (!usable(ctx) || binding === null) return;
    const atRead = ++reads;
    const atEpoch = epoch;
    const answer = await rpc.request('queues.list', { pageId: binding.pageId }).catch(() => null);
    if (disposed || atRead !== reads || atEpoch !== epoch) return;
    if (answer === null) listError = { code: 'CG-RUNTIME-UNREACHABLE' };
    else if (!answer.ok) listError = answer.error;
    else {
      listError = null;
      took(answer.payload);
    }
    loadedAt = clock.now();
    changed();
    if (list !== null) {
      const current = queueOf(chosen);
      if (current === null) {
        // The first queue with work is chosen once the list is there (or the chosen one is gone from it).
        const first = list.queues.find((queue) => queue.status === 'active' && (queue.perPerson === null || queue.today.mine < queue.perPerson) && (queue.pending > 0 || queue.leasedToMe > 0)) ?? list.queues[0] ?? null;
        if (first !== null) await choose(first.queueId, false);
      } else if (take === null) await choose(current.queueId, false);
      else await renew();
    }
    tryStart();
  }

  /** A new list: the answered fans join the window; a fan answered by a Reply from here leaves «Ответили». */
  function took(next: FanQueues): void {
    list = next;
    const fresh = new Map<string, Known>();
    for (const fanRef of order) {
      const entry = known.get(fanRef);
      if (entry !== undefined && entry.answered === null) fresh.set(fanRef, entry);
    }
    for (const answer of next.answered) {
      const before = seen.get(answer.fanRef);
      fresh.set(answer.fanRef, { item: answeredItem(answer, before), answered: answer, ...(before === undefined ? { factless: true as const } : {}) });
      // He waits for an answer again: Reply is advised (written by a click on his card), the old text is history.
      const fan = pass.get(answer.fanRef);
      if (fan !== undefined && fan.sent !== null && fan.sent.at < (timeOf(answer.answeredAt) ?? 0) && fan.clickedAt !== null && fan.clickedAt < (timeOf(answer.answeredAt) ?? 0)) {
        fan.chosen = null;
        fan.edit = null;
        fan.own = null;
        fan.ownText = null;
        fan.clickedAt = null;
        fan.advanced = false;
        fan.textOp = null;
        fan.aiKey = null;
        fan.clickAct = null;
        batch.drop([handleOf(answer.fanRef)]);
      }
    }
    known = fresh;
  }

  /** The portion of a queue: the kept fans first, then the new ones; `more` — past the day's portion. */
  async function takePortion(queueId: number, more: boolean, fresh: boolean): Promise<void> {
    const binding = context.current().binding;
    if (binding === null) return;
    const atEpoch = epoch;
    taking = true;
    changed(true);
    const answer = await rpc.request('queues.take', { pageId: binding.pageId, queueId, count: QUEUES_PORTION, more }).catch(() => null);
    taking = false;
    if (disposed || atEpoch !== epoch || chosen !== queueId) return;
    if (answer === null) takeError = { code: 'CG-RUNTIME-UNREACHABLE' };
    else if (!answer.ok) takeError = answer.error;
    else {
      takeError = null;
      portionFrom(answer.payload, fresh);
    }
    changed();
  }

  /** A take's answer: a fresh portion replaces the done one; a renewal keeps what this portion did. */
  function portionFrom(next: FanQueueTake, fresh: boolean): void {
    take = next;
    if (fresh) {
      for (const fanRef of order) if (known.get(fanRef)?.answered === null) known.delete(fanRef);
      order = [];
      portionDone = false;
      tally = { sent: 0, skipped: 0 };
    } else {
      // A fan the hub no longer holds for the person (the lease ran out while the tab was hidden, and someone else took
      // him): out of the portion, unless something was done to him here — his own card says what.
      const held = new Set(next.items.map((item) => item.fanRef));
      order = order.filter((fanRef) => {
        if (held.has(fanRef)) return true;
        const fan = pass.get(fanRef);
        const touched = fan !== undefined && (fan.clickedAt !== null || fan.skipped !== null || fan.skipping || fan.sent !== null);
        if (!touched && known.get(fanRef)?.answered === null) known.delete(fanRef);
        return touched;
      });
    }
    for (const item of next.items) {
      seen.set(item.fanRef, item);
      if ((known.get(item.fanRef)?.answered ?? null) === null) known.set(item.fanRef, { item, answered: null });
      if (!order.includes(item.fanRef)) order.push(item.fanRef);
      const fan = passOf(item.fanRef);
      // A template queue's text stands at once: nothing is written, the guide's (or the asker's) words are there.
      if (fan.chosen === null && fan.clickedAt === null && (item.act === 'template_a' || item.act === 'template_b' || item.act === 'template_q') && templatesOf(groupFor(item)).length > 0) fan.chosen = 'template';
    }
    if (list !== null) list = { ...list, queues: list.queues.map((queue) => (queue.queueId === next.queueId ? { ...queue, today: next.today, pending: next.pending, leasedToMe: next.items.length } : queue)) };
  }

  /** The lease of the portion renewed with each minute's read (nothing new is taken: only the fans in hand). */
  async function renew(): Promise<void> {
    const queueId = chosen;
    const binding = context.current().binding;
    if (queueId === null || binding === null) return;
    const inHand = entriesOf().portion.filter((entry) => !entry.done).length;
    if (inHand === 0) return;
    const answer = await rpc.request('queues.take', { pageId: binding.pageId, queueId, count: Math.min(QUEUES_PORTION, inHand), more: true }).catch(() => null);
    if (disposed || chosen !== queueId || answer === null || !answer.ok) return;
    portionFrom(answer.payload, false);
    changed();
  }

  function schedulePoll(): void {
    if (pollTimer !== null) clock.clearTimer(pollTimer);
    pollTimer = clock.setTimer(QUEUES_POLL_MS, () => {
      pollTimer = null;
      if (!surfaces.current().queues) return;
      if (visible()) void read();
      schedulePoll();
    });
  }

  // ── the texts ──

  async function ensureManual(fanRef: string): Promise<void> {
    const item = itemOf(fanRef);
    const port = batchPort;
    if (own !== null || item === undefined || port?.onlineText === undefined) {
      changed();
      return;
    }
    const fan = passOf(fanRef);
    const how = howOf(fanRef, item);
    const handle = handleOf(fanRef);
    if (!manual(how) || fan.making || surfaces.current().preview.queue !== handle) {
      changed();
      return;
    }
    const key = keyOf(how);
    const wanted = manualText(fan, item, how);
    const card = port.outreachRow?.(handle) ?? null;
    if (fan.textOp !== null && fan.textOp.key === key && fan.textOp.text === wanted && card !== null && card.opId === fan.textOp.opId) return;
    fan.making = true;
    changed();
    const atEpoch = epoch;
    const ok = await port.onlineText(handle, wanted).catch(() => false);
    fan.making = false;
    if (disposed || atEpoch !== epoch) return;
    const row = ok ? (port.outreachRow?.(handle) ?? null) : null;
    if (row !== null) {
      fan.textOp = { opId: row.opId, key, text: wanted };
      fan.manualFailedAt = null;
      if ((fan.edit ?? wanted) !== wanted) scheduleManual(fanRef, QUEUES_EDIT_SETTLE_MS);
    } else {
      fan.manualFailedAt = clock.now();
      scheduleManual(fanRef, QUEUES_MANUAL_RETRY_MS);
    }
    changed();
  }

  function scheduleManual(fanRef: string, ms: number): void {
    if (manualTimer !== null) clock.clearTimer(manualTimer);
    manualTimer = clock.setTimer(ms, () => {
      manualTimer = null;
      if (!disposed && openFan() === fanRef) void ensureManual(fanRef);
    });
  }

  // ── the directory of the preview from `queue` ──

  const directoryListeners = new Set<() => void>();

  function infoOf(fanRef: string, id: number, handle: TargetHandle): PreviewTargetInfo | null {
    const item = itemOf(fanRef);
    if (item === undefined) return null;
    const platform = context.current().binding?.platform ?? null;
    const conversation = platform !== null && !CHAT_IS_FAN[platform] ? (item.conversationRef ?? pass.get(fanRef)?.group ?? null) : null;
    return {
      handle,
      source: 'queue',
      pageId: id,
      fanRef,
      ...(conversation === null ? {} : { conversationRef: conversation }),
      name: nameOf(item),
      username: item.username,
      lifetime: item.lifetimeGrossMills,
      period30: item.last30dGrossMills,
      weWroteAt: item.lastPageMessageAt,
      fanWroteAt: item.lastFanMessageAt,
      newcomer: null,
    };
  }

  const directory: PreviewDirectory = {
    canResolve: own !== null,
    async prepare(handle) {
      const fanRef = fanOf(handle);
      const binding = context.current().binding;
      const item = fanRef === null ? undefined : itemOf(fanRef);
      if (own === null || fanRef === null || binding === null || item === undefined || item.conversationRef !== null) return;
      const fan = passOf(fanRef);
      if (fan.group !== null) return;
      const group = await own.group(binding.platformAccountId, { fanRef, username: item.username, displayName: item.displayName }, false).catch(() => null);
      if (group !== null) {
        fan.group = group;
        changed();
      }
    },
    resolve(handle) {
      const fanRef = fanOf(handle);
      const id = pageId();
      return fanRef === null || id === null ? null : infoOf(fanRef, id, handle);
    },
    neighbours(handle) {
      const fanRef = fanOf(handle);
      if (fanRef === null) return { previous: null, next: null };
      const sequence = all(entriesOf()).map((entry) => entry.fanRef);
      const at = sequence.indexOf(fanRef);
      return { previous: at > 0 ? handleOf(sequence[at - 1] as string) : null, next: at >= 0 && at < sequence.length - 1 ? handleOf(sequence[at + 1] as string) : null };
    },
    subscribe(listener) {
      directoryListeners.add(listener);
      return () => {
        directoryListeners.delete(listener);
      };
    },
  };

  // ── actions ──

  function open(type: UiActionType): ActionReceipt {
    surfaces.setList('queues', true);
    schedulePoll();
    startPending = true;
    const stale = loadedAt === null || clock.now() - loadedAt > QUEUES_POLL_MS / 3;
    if (stale) void read();
    else tryStart();
    changed();
    return done(type, 'opened');
  }

  /** The person closed the window: the untouched portion goes back to the queue for the others. */
  function close(type: UiActionType): ActionReceipt {
    surfaces.setList('queues', false);
    const binding = context.current().binding;
    if (binding !== null && chosen !== null && run?.running !== true) {
      const queueId = chosen;
      const inHand = entriesOf().portion.some((entry) => !entry.done);
      if (inHand) void rpc.request('queues.release', { pageId: binding.pageId, queueId }).catch(() => undefined);
    }
    return done(type);
  }

  function tryStart(): void {
    if (!startPending || disposed || list === null || !surfaces.current().queues || openFan() !== null || pending !== null || taking) return;
    const entries = entriesOf();
    if (all(entries).length === 0 && chosen !== null && take === null) return;
    startPending = false;
    const back = lastCard !== null && all(entries).some((entry) => entry.fanRef === lastCard && !entry.done) ? lastCard : null;
    const start = back ?? nextTodo(null, entries);
    if (start !== null) void openCard(start);
  }

  async function openCard(fanRef: string): Promise<void> {
    if (settleTimer !== null) clock.clearTimer(settleTimer);
    settleTimer = null;
    pending = null;
    startPending = false;
    const at = ++opening;
    const handle = handleOf(fanRef);
    const atEpoch = epoch;
    await directory.prepare?.(handle).catch(() => undefined);
    if (disposed || atEpoch !== epoch || at !== opening || !surfaces.current().queues || pending !== null) return;
    surfaces.setPreview('queue', handle);
    const chosenNow = pass.get(fanRef)?.chosen ?? null;
    if (chosenNow === 'template' || chosenNow === 'own') void ensureManual(fanRef);
    changed();
  }

  function select(type: UiActionType, fanRef: string, keys: boolean): ActionReceipt {
    if (!known.has(fanRef)) return refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n));
    if (advanceTimer !== null) clock.clearTimer(advanceTimer);
    advanceTimer = null;
    if (settleTimer !== null) clock.clearTimer(settleTimer);
    settleTimer = null;
    if (!keys) {
      void openCard(fanRef);
      changed(true);
      return done(type, 'opened');
    }
    pending = fanRef;
    settleTimer = clock.setTimer(QUEUES_SETTLE_MS, () => {
      settleTimer = null;
      void openCard(fanRef);
    });
    changed(true);
    return done(type);
  }

  async function send(type: UiActionType, fanRef: string, anyway: boolean): Promise<ActionReceipt> {
    const item = itemOf(fanRef);
    if (item === undefined) return refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n));
    const facts = factsOf(fanRef, item);
    if (facts.state !== 'ready' && facts.state !== 'failed') return refused(type, localError(facts.state === 'sending' || facts.state === 'accepted' ? 'CG-SEND-BUSY' : 'CG-SEND-PART', i18n));
    if (facts.send === null || !facts.send.can) return refused(type, localError(facts.send?.paused === true ? 'CG-SEND-BUSY' : 'CG-SEND-PART', i18n));
    const fan = passOf(fanRef);
    if (own === null) {
      const port = batchPort;
      if (port?.outreachSend === undefined) return refused(type, localError('CG-FEATURE-DISABLED', i18n));
      const how = howOf(fanRef, item);
      fan.clickedAt = clock.now();
      fan.clickAct = { act: how.act, templateId: how.template?.id ?? null };
      fan.advanced = false;
      fan.reported = false;
      const receipt = await port.outreachSend(type, handleOf(fanRef), anyway || facts.send.kind === 'anyway');
      changed();
      return receipt;
    }
    return sendOwn(type, fanRef, item, fan, facts);
  }

  async function sendWords(type: UiActionType, fanRef: string, words: string): Promise<ActionReceipt> {
    const item = itemOf(fanRef);
    if (item === undefined) return refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n));
    const text = words.trim().slice(0, QUEUES_TEXT_MAX);
    if (text.length === 0) return refused(type, localError('CG-SEND-PART', i18n));
    const fan = passOf(fanRef);
    const before = factsOf(fanRef, item);
    if (MOVING.includes(before.state) || before.state === 'writing') return refused(type, localError('CG-SEND-BUSY', i18n));
    if (WENT.includes(before.state) && !answeredNow(fanRef)) return refused(type, localError('CG-SEND-PART', i18n));
    fan.chosen = 'own';
    fan.edit = text;
    fan.aiKey = null;
    fan.manualFailedAt = null;
    if (fan.own?.state === 'failed') fan.own = null;
    batch.drop([handleOf(fanRef)]);
    batchPort?.clearDraft?.(handleOf(fanRef));
    if (own === null) await ensureManual(fanRef);
    changed();
    const now = itemOf(fanRef);
    if (disposed || now === undefined) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    if (factsOf(fanRef, now).send?.kind === 'anyway') return done(type, 'started');
    return send(type, fanRef, false);
  }

  async function sendOwn(type: UiActionType, fanRef: string, item: FanQueueItem, fan: PassFan, facts: Facts): Promise<ActionReceipt> {
    const binding = context.current().binding;
    const channel = own;
    if (binding === null || channel === null) return refused(type, localError('CG-BINDING-MISSING', i18n));
    if (paced() || ownSending()) return refused(type, localError('CG-SEND-BUSY', i18n));
    const body = (facts.version ?? '').trim().slice(0, QUEUES_TEXT_MAX);
    if (body.length === 0) return refused(type, localError('CG-SEND-PART', i18n));
    const how = howOf(fanRef, item);
    const sending: OwnSend = { state: 'sending', code: null, clickedAt: clock.now(), at: null };
    fan.own = sending;
    fan.ownText = body;
    fan.clickedAt = sending.clickedAt;
    fan.advanced = false;
    fan.reported = false;
    const sentNow = { text: body, act: how.act, templateId: how.template?.id ?? null, opId: null };
    fan.clickAct = { act: how.act, templateId: sentNow.templateId };
    const pageAt = binding.pageId;
    pace();
    changed();
    const end = (state: OwnSend['state'], code: string | null): ActionReceipt => {
      if (fan.own === sending) {
        sending.state = state;
        sending.code = code;
        sending.at = clock.now();
        if (state !== 'failed') {
          const sent = { ...sentNow, at: sending.at };
          fan.sent = sent;
          if (!fan.reported) {
            fan.reported = true;
            report(pageAt, fanRef, item, sent, state === 'uncertain');
          }
        }
        changed();
      }
      return state === 'sent' ? done(type) : refused(type, localError(state === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-SEND-REJECTED', i18n, code ?? undefined));
    };
    const cause = await issueCause(rpc, 'send', 'preview');
    if (!cause.ok) return end('failed', cause.code);
    const group = item.conversationRef ?? fan.group ?? (await channel.group(binding.platformAccountId, { fanRef, username: item.username, displayName: item.displayName }, true).catch(() => null));
    if (group === null) return end('failed', 'CG-HOST-CHAT-NOT-FOUND');
    fan.group = group;
    const composedWith: SendAttributionComposedWith = fan.edit !== null || how.template !== null ? 'hand' : how.feature ?? 'hand';
    const answer = await channel.send({ hostAccountId: binding.platformAccountId, fanRef, groupId: group, text: body, cause: cause.cause, composedWith }).catch((): OnlineSendAnswer => ({ ok: false, code: 'CG-SEND-UNCERTAIN' }));
    if (answer.ok) return end('sent', null);
    return end(answer.code === 'CG-SEND-UNCERTAIN' ? 'uncertain' : 'failed', answer.code);
  }

  function rewrite(type: UiActionType, fanRef: string, act: OnlineChoice | undefined): ActionReceipt {
    const item = itemOf(fanRef);
    if (item === undefined || batchPort === null) return refused(type, localError('CG-DATA-NOT-READY', i18n));
    const fan = passOf(fanRef);
    const before = factsOf(fanRef, item);
    if (MOVING.includes(before.state) || before.state === 'writing') return refused(type, localError('CG-SEND-BUSY', i18n));
    if (WENT.includes(before.state) && !answeredNow(fanRef)) return refused(type, localError('CG-SEND-PART', i18n));
    const pick = act ?? fan.chosen;
    if (pick === null || pick === 'own') return refused(type, localError('CG-SEND-PART', i18n));
    if (pick === 'template' && fan.chosen === 'template' && fan.template !== null) fan.template += 1;
    fan.chosen = pick;
    const how = howOf(fanRef, item);
    if (how.act === 'none') return refused(type, localError('CG-DATA-NOT-READY', i18n));
    fan.edit = null;
    fan.manualFailedAt = null;
    if (fan.own?.state === 'failed') fan.own = null;
    if (how.feature !== null) {
      fan.aiKey = keyOf(how);
      batch.queue([handleOf(fanRef)]);
    } else {
      fan.aiKey = null;
      batch.drop([handleOf(fanRef)]);
      void ensureManual(fanRef);
    }
    changed();
    return done(type, 'started');
  }

  function edit(type: UiActionType, fanRef: string, words: string | null): ActionReceipt {
    const item = itemOf(fanRef);
    if (item === undefined) return refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n));
    const facts = factsOf(fanRef, item);
    if (!facts.editable) return refused(type, localError('CG-SEND-PART', i18n));
    const text = words === null ? null : words.slice(0, QUEUES_TEXT_MAX);
    const how = howOf(fanRef, item);
    if (own === null && !manual(how)) {
      const ok = batchPort?.outreachEdit?.(handleOf(fanRef), text) ?? false;
      changed();
      return ok ? done(type) : refused(type, localError('CG-SEND-PART', i18n));
    }
    passOf(fanRef).edit = text;
    if (own === null) scheduleManual(fanRef, QUEUES_EDIT_SETTLE_MS);
    changed();
    return done(type);
  }

  /** «Пропустить ▾»: one report to the hub, never repeated; the skip stands once the hub took it, and the next card opens. */
  async function skip(type: UiActionType, fanRef: string, reason: QueueSkipReason): Promise<ActionReceipt> {
    const id = pageId();
    const item = itemOf(fanRef);
    if (id === null || item === undefined || known.get(fanRef)?.answered !== null) return refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n));
    const fan = passOf(fanRef);
    if (MOVING.includes(factsOf(fanRef, item).state) || fan.skipping || fan.skipped !== null) return refused(type, localError('CG-SEND-BUSY', i18n));
    fan.skipping = true;
    if (openFan() === fanRef) advance(fanRef);
    changed();
    const answer = await rpc.request('queues.done', { pageId: id, itemId: item.itemId, outcome: 'skipped', skipReason: reason }).catch(() => null);
    fan.skipping = false;
    if (answer !== null && answer.ok) {
      fan.skipped = reason;
      tally = { ...tally, skipped: tally.skipped + 1 };
      dayFrom(item.queueId, answer.payload.today);
      if (entriesOf().portion.every((entry) => entry.done) && openFan() === null) portionDone = true;
      changed();
      return done(type);
    }
    changed();
    return refused(type, answer === null ? localError('CG-RUNTIME-UNREACHABLE', i18n) : errorOf(answer.error, i18n));
  }

  async function openChat(type: UiActionType, fanRef: string): Promise<ActionReceipt> {
    const ctx = context.current();
    const binding = ctx.binding;
    const item = itemOf(fanRef);
    if (binding === null || item === undefined) return refused(type, localError('CG-BINDING-MISSING', i18n));
    const admission = boardOpenRefusal(ctx, ['preview']);
    if (admission !== null) return refused(type, errorOf(admission, i18n));
    let conversation: string | undefined;
    if (!CHAT_IS_FAN[binding.platform]) {
      const fan = passOf(fanRef);
      const found = item.conversationRef ?? fan.group ?? (own === null ? null : await own.group(binding.platformAccountId, { fanRef, username: item.username, displayName: item.displayName }, true).catch(() => null));
      if (found === null) return refused(type, localError('CG-HOST-CHAT-NOT-FOUND', i18n));
      fan.group = found;
      conversation = found;
    }
    const receipt = await navigator.open({ host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: fanRef }, 'preview', ['preview'], conversation);
    if (receipt.state === 'failed') return refused(type, localError(receipt.code, i18n));
    surfaces.closeBoards();
    return done(type, 'opened');
  }

  /** A queue's chip: its portion is taken (the kept fans first); nothing is written. */
  async function choose(queueId: number, user: boolean): Promise<void> {
    if (chosen === queueId && take !== null && !user) return;
    if (run?.running === true) return;
    const before = chosen;
    chosen = queueId;
    if (before !== queueId) {
      // Another queue's portion leaves the window: what is untouched of it goes back to that queue for the others.
      const binding = context.current().binding;
      if (before !== null && binding !== null && entriesOf().portion.some((entry) => !entry.done)) void rpc.request('queues.release', { pageId: binding.pageId, queueId: before }).catch(() => undefined);
      for (const fanRef of order) if (known.get(fanRef)?.answered === null) known.delete(fanRef);
      order = [];
      take = null;
      portionDone = false;
      tally = { sent: 0, skipped: 0 };
      if (openFan() !== null && known.get(openFan() as string) === undefined) surfaces.setPreview('queue', null);
    }
    changed();
    const queue = queueOf(queueId);
    if (queue === null || queue.status !== 'active') return;
    await takePortion(queueId, false, true);
    startPending = true;
    tryStart();
  }

  /** «Взять ещё 10» once the portion is done, «Ещё 10» past the day's portion. */
  async function more(type: UiActionType): Promise<ActionReceipt> {
    const queueId = chosen;
    if (queueId === null || run?.running === true) return refused(type, localError('CG-DATA-NOT-READY', i18n));
    const queue = queueOf(queueId);
    const past = queue !== null && queue.perPerson !== null && queue.today.mine >= queue.perPerson;
    await takePortion(queueId, past, true);
    startPending = true;
    tryStart();
    return done(type, 'started');
  }

  /**
   * «Отправить всем»: the portion's templates go one fan at a time, each by the card's own send (its card opens first:
   * on ChatSpace the card is what sends), a second apart and never faster than the hub's minute. A refusal or an
   * unknown outcome stays on the fan's card for the person; a run without a token of the click stops.
   */
  function sendAll(type: UiActionType): ActionReceipt {
    const queue = queueOf(chosen);
    if (queue === null || !howOfQueue(queue).batch || run?.running === true || batchPort === null) return refused(type, localError('CG-SEND-PART', i18n));
    const fans = batchable(entriesOf()).map((entry) => entry.fanRef);
    if (fans.length === 0) return refused(type, localError('CG-SEND-PART', i18n));
    const mine: Run = { running: true, held: false, total: fans.length, done: 0 };
    run = mine;
    changed();
    void runAll(mine, fans);
    return done(type, 'started');
  }

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => void clock.setTimer(ms, resolve));

  async function runAll(mine: Run, fans: readonly string[]): Promise<void> {
    const sentAt: number[] = [];
    let nextAt = 0;
    for (const fanRef of fans) {
      if (!mine.running || disposed) break;
      const item = itemOf(fanRef);
      const fan = pass.get(fanRef);
      if (item === undefined || fan?.skipped !== null || fan.skipping) continue;
      if (fan.chosen === null) fan.chosen = 'template';
      await openCard(fanRef);
      // Wait until the fan's text would go (on ChatSpace the template goes onto his card first).
      let waited = 0;
      while (mine.running && !disposed && waited < QUEUES_BATCH_STEP_MS) {
        const facts = factsOf(fanRef, item);
        if (facts.state === 'ready' && facts.send?.can === true) break;
        if (facts.state !== 'ready' && facts.state !== 'idle') break;
        await sleep(BATCH_LOOK_MS);
        waited += BATCH_LOOK_MS;
      }
      const facts = factsOf(fanRef, item);
      if (facts.state !== 'ready' || facts.send?.can !== true || facts.send.kind !== 'send') {
        // A warning, a refusal or no card: the fan stays for the person's own click.
        mine.done += 1;
        changed();
        continue;
      }
      // The gap after the last send, and the hub's minute.
      const now = clock.now();
      if (now < nextAt) await sleep(nextAt - now);
      while (sentAt.length > 0 && (sentAt[0] ?? 0) <= clock.now() - MINUTE_MS) sentAt.shift();
      const perMinute = Math.max(1, context.current().bootstrap?.limits.previewSendPerMinute ?? 30);
      if (sentAt.length >= perMinute) {
        mine.held = true;
        changed();
        await sleep((sentAt[0] ?? clock.now()) + MINUTE_MS - clock.now());
        mine.held = false;
      }
      if (!mine.running || disposed) break;
      sentAt.push(clock.now());
      nextAt = clock.now() + BATCH_LIMITS.sendGapMs;
      const receipt = await send('SendOnline', fanRef, false).catch((): null => null);
      mine.done += 1;
      changed();
      // No token is left of the click: the run is over, the rest wait for a click.
      if (receipt !== null && !receipt.ok && receipt.code === NO_TOKEN) break;
      // Wait for this one to go before the next card opens: one at a time.
      let going = 0;
      while (!disposed && going < QUEUES_BATCH_STEP_MS) {
        const state = factsOf(fanRef, item).state;
        if (state !== 'sending' && state !== 'accepted') break;
        await sleep(BATCH_LOOK_MS);
        going += BATCH_LOOK_MS;
      }
    }
    mine.running = false;
    mine.held = false;
    if (disposed) return;
    if (entriesOf().portion.every((entry) => entry.done)) {
      portionDone = true;
      surfaces.setPreview('queue', null);
    }
    changed();
  }

  function stopAll(type: UiActionType): ActionReceipt {
    if (run?.running !== true) return done(type, 'noop');
    run.running = false;
    changed();
    return done(type);
  }

  function setQueues(action: Extract<UiAction, { type: 'SetQueues' }>): Promise<ActionReceipt> | ActionReceipt {
    if (action.open === true) {
      // ⌘K's row of a queue: the window opens on it.
      if (action.queue !== undefined && action.queue !== chosen) void choose(action.queue, true);
      return open(action.type);
    }
    if (action.open === false) return close(action.type);
    if (action.queue !== undefined) {
      void choose(action.queue, true);
      return done(action.type);
    }
    if (action.more === true) return more(action.type);
    if (action.refresh === true) void read();
    changed();
    return done(action.type);
  }

  function dispatch(action: UiAction): Promise<ActionReceipt> | null {
    if (action.type === 'Navigate') {
      const to = action.to;
      if (to.kind === 'surface' && to.surface === 'queues') return Promise.resolve(to.open ? open(action.type) : close(action.type));
      if (to.kind !== 'chat') return null;
      const fanRef = fanOf(to.targetHandle);
      return fanRef === null ? null : openChat(action.type, fanRef);
    }
    if (action.type === 'SetQueues') return Promise.resolve(setQueues(action));
    if (action.type === 'SendBatch' && action.list === 'queue') return Promise.resolve(sendAll(action.type));
    if (action.type === 'StopBatchSend' && action.list === 'queue') return Promise.resolve(stopAll(action.type));
    if (action.type === 'SkipQueue') {
      const fanRef = fanOf(action.targetHandle);
      return fanRef === null ? null : skip(action.type, fanRef, action.reason);
    }
    // The card of «Очереди» is «Онлайн»'s own: its actions with a `queue:` handle are ours.
    if (action.type === 'SelectOnline') {
      const fanRef = fanOf(action.targetHandle);
      return fanRef === null ? null : Promise.resolve(select(action.type, fanRef, action.keys === true));
    }
    if (action.type === 'SendOnline' || action.type === 'RewriteOnline' || action.type === 'EditOnline' || action.type === 'SkipOnline' || action.type === 'DismissOnline') {
      const fanRef = fanOf(action.targetHandle);
      if (fanRef === null) return null;
      if (action.type === 'SendOnline') return action.own === undefined ? send(action.type, fanRef, action.anyway === true) : sendWords(action.type, fanRef, action.own);
      if (action.type === 'RewriteOnline') return Promise.resolve(rewrite(action.type, fanRef, action.act));
      if (action.type === 'EditOnline') return Promise.resolve(edit(action.type, fanRef, action.text));
      // «Пропустить» (S) of the card is «Позже» here, «Не предлагать» the team's mark: both are a skip of the queue.
      if (action.type === 'SkipOnline') return action.skip ? skip(action.type, fanRef, 'later') : Promise.resolve(done(action.type, 'noop'));
      return action.dismiss ? skip(action.type, fanRef, 'dismiss') : Promise.resolve(done(action.type, 'noop'));
    }
    if (action.type === 'ReloadView') {
      if (action.selector.of !== 'queues') return null;
      return (context.current().phase === 'ready' ? Promise.resolve() : context.refresh()).then(async () => {
        await read();
        return done(action.type);
      });
    }
    return null;
  }

  // ── life ──

  function reset(state: PageContextState): void {
    batch.reset();
    list = null;
    listError = null;
    takeError = null;
    loadedAt = null;
    reads += 1;
    chosen = null;
    take = null;
    order = [];
    known = new Map();
    taking = false;
    portionDone = false;
    tally = { sent: 0, skipped: 0 };
    pass = passOfContext(state);
    pending = null;
    startPending = false;
    lastCard = null;
    if (run !== null) run.running = false;
    run = null;
    for (const timer of [settleTimer, advanceTimer, manualTimer]) if (timer !== null) clock.clearTimer(timer);
    settleTimer = null;
    advanceTimer = null;
    manualTimer = null;
  }

  const offContext = context.subscribe((state) => {
    if (state.epoch !== epoch) {
      epoch = state.epoch;
      reset(state);
      surfaces.setList('queues', false);
    } else if (surfaces.current().queues && list === null && usable(state)) void read();
    changed();
  });
  const offSurfaces = surfaces.subscribe((state, previous) => {
    if (state.queues) lastCard = state.preview.queue === null ? lastCard : fanOf(state.preview.queue);
    if (!state.queues && previous.queues) {
      if (pollTimer !== null) clock.clearTimer(pollTimer);
      pollTimer = null;
      if (settleTimer !== null) clock.clearTimer(settleTimer);
      settleTimer = null;
      pending = null;
      startPending = false;
    }
    if (state.queues !== previous.queues || state.preview.queue !== previous.preview.queue) changed();
  });
  const offLanguage = i18n.subscribe(() => changed(true));

  return {
    kinds: ['queues'],
    getSnapshot: () => cell.get(),
    subscribe: (_selector, listener) => cell.subscribe(listener),
    dispatch,
    directory,
    attachBatch(port) {
      offBatch?.();
      batchPort = port;
      offBatch = port.onBatch(() => changed());
      changed();
    },
    dispose() {
      disposed = true;
      if (run !== null) run.running = false;
      offBatch?.();
      batch.dispose();
      offContext();
      offSurfaces();
      offLanguage();
      for (const timer of [pollTimer, settleTimer, advanceTimer, paceTimer, manualTimer]) if (timer !== null) clock.clearTimer(timer);
      directoryListeners.clear();
      cell.clear();
    },
  };
}
