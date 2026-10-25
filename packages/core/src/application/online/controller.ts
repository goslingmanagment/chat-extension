// «Онлайн» (2026-10-26, the owner's demo became the window; view `online`): the page's fans who came online, why to
// write to each now, and a fast pass through them — one click per fan. Who is online and why is the hub's
// (`clientOnline`, `online-v1`): OnlyFansAPI's presence on OnlyFans; on Fansly the creator's followers the tab saw
// active (`fansly.online.seen`, at most once a minute per creator, the background's), reported to the hub first.
// ChatSpace's own dot says «в сети» where it shows one; OnlyFansAPI's word is «зашёл N мин назад» (its «offline» comes
// ~30 minutes late). The list is read when the window opens and every minute while it is open and the tab is on screen.
//
// Each fan gets one text: Reply, Hi or Ping written by the AI through the fan's card (the preview from `online`), or a
// text of the team's guide word for word — A where they talked before but the chat is too short for Ping, B where the
// fan never wrote — with the fan's name in place of «love», the neighbours on different texts. The AI writes for the
// card the person stopped on and for the next one, never for the whole list. «Отправить →» sends the text: on
// ChatSpace the card's own send (X8), on Fansly our background's send; one click, one message, one attempt; an
// unknown outcome is never sent again by our button. A moment after a send went the next card opens by itself: whoever
// waits for an answer first, then the next one down the list.
//
// Set aside, never hidden: a fan another chatter talks to, one the page wrote to lately, one written to from here in
// the last three weeks, one marked «Не предлагать» stand under «Все онлайн», and a click may still write to them.
// «Пропустить» is this pass's only; «Не предлагать» is the team's (the hub keeps it, `online.attempt`).

import { type CgErrorWire } from '@cg/contracts/errors';
import { type OnlineItem, type OnlineList, type OnlineTemplate, type SendAttributionComposedWith } from '@cg/contracts/hub';
import { CHAT_IS_FAN, ONLINE_CAPABILITY } from '@cg/contracts/ids';
import { type IsoTimestamp } from '@cg/contracts/primitives';
import {
  ONLINE_GROUPS,
  ONLINE_PERIODS,
  type ActionReceipt,
  type I18n,
  type OnlineAct,
  type OnlineAsideVM,
  type OnlineCardVM,
  type OnlineEndVM,
  type OnlineFanState,
  type OnlineGroupId,
  type OnlineGroupVM,
  type OnlinePeriod,
  type OnlinePresence,
  type OnlineReasonVM,
  type OnlineRowVM,
  type OnlineTab,
  type OnlineWindowVM,
  type OutreachMediaVM,
  type OutreachSendVM,
  type OutreachWarningVM,
  type TargetHandle,
  type UiAction,
  type UiActionType,
  type VmView,
} from '@cg/contracts/vm';

import { MIN_MESSAGES_FOR_PING } from '../../domain/features/policy';
import { normalizeSearch } from '../../domain/spenders/rows';
import { createBatch, type BatchPreviewPort, type OutreachCardRow } from '../boards/batch';
import { type PageContextPort, type PageContextState, flagFailure, pageFlag } from '../boards/context';
import { fanHandle, parseFanHandle } from '../boards/handles';
import { boardOpenRefusal, issueCause, type ChatNavigator } from '../boards/navigate';
import { type BoardsClock, type TabRpc } from '../boards/ports';
import { type PreviewDirectory, type PreviewTargetInfo, type Surfaces } from '../boards/shared';
import { ViewCell, done, refused, type SurfaceController } from '../boards/surface';
import { dataView, errorOf, failureView, loadingView, localError, msg, stamp } from '../boards/views';

/** The list is read again this often while the window is open and the tab is on screen. */
export const ONLINE_POLL_MS = 60_000;
/** The hub is asked for the longest «Зашли за»: the window cuts the list by the person's choice without a new read. */
export const ONLINE_READ_MINUTES = 120;
/** «Зашли за» the window opens with. */
export const ONLINE_DEFAULT_MINUTES: OnlinePeriod = 30;
/** Active within this many minutes: «сейчас», first in their group. */
export const ONLINE_FRESH_MINUTES = 10;
/** Older than this the fan's dot is grey. */
export const ONLINE_FADING_MINUTES = 30;
/** The keys stopped on a fan this long: their card opens and their text is written (and the next one's). */
export const ONLINE_SETTLE_MS = 300;
/** After a send went, the next fan's card opens this much later: the person sees «Отправлено» first. */
export const ONLINE_ADVANCE_MS = 800;
/** One «Отправить» of the tab each half second (#343, #349): a run of clicks never goes out in one burst. */
export const ONLINE_PACE_MS = 500;
/** A fan who came online while the window was open lights up this long. */
export const ONLINE_ARRIVED_MS = 30_000;
/** The search waits this long after the last keystroke. */
export const ONLINE_SEARCH_DEBOUNCE_MS = 150;
/** One text at most (the preview's draft limit). */
export const ONLINE_TEXT_MAX = 5_000;
/** What the AI's refusal says when it cannot write here: no chat of the fan is known (Fansly), or the chat is short. */
const FALLBACK_CODES: readonly string[] = ['CG-DATA-NOT-READY', 'CG-GATE-HISTORY'];
/** A start the person's click gave no token for: nothing was written, a click on the card writes it. */
const NO_TOKEN = 'CG-UI-FAILED';

/** What goes to one fan by the site's own send (Fansly): the background's `fansly.spenders.outreach`, no media. */
export interface OnlineSendRequest {
  readonly hostAccountId: string;
  readonly fanRef: string;
  readonly groupId: string;
  readonly text: string;
  readonly cause: { readonly kind: 'click' | 'key'; readonly actionToken: string };
  /** How the text was written, for the hub's record of who sent it. */
  readonly composedWith: SendAttributionComposedWith;
}

export type OnlineSendAnswer = { readonly ok: true; readonly messageId: string } | { readonly ok: false; readonly code: string };

/** A site that reads who is active and sends the texts itself (Fansly). */
export interface OnlineOwnChannel {
  /** The creator's followers seen active lately, reported to the hub; the background asks the site at most once a minute. */
  seen(pageId: number, hostAccountId: string): Promise<void>;
  /**
   * The fan's chat: the page's memory; `active` — on the person's click, the inbox search and, with none, a new chat
   * (Fansly makes one when the first message goes). null — none found.
   */
  group(hostAccountId: string, fan: { readonly fanRef: string; readonly username: string | null; readonly displayName: string | null }, active: boolean): Promise<string | null>;
  send(request: OnlineSendRequest): Promise<OnlineSendAnswer>;
}

export interface OnlineControllerDeps {
  readonly rpc: TabRpc;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
  readonly navigator: ChatNavigator;
  /** Fansly: the site reads who is active and sends the texts itself; absent — the fan's card sends them (ChatSpace, X8). */
  readonly own?: OnlineOwnChannel;
  /** Who the site itself shows online right now (ChatSpace's dots of the chats it loaded); absent — none. */
  readonly live?: { online(): ReadonlySet<string>; subscribe(listener: () => void): () => void };
  /** The tab is on screen: the list is read every minute only then. Absent — always. */
  readonly visible?: () => boolean;
}

export interface OnlineController extends SurfaceController<'online'> {
  /** Who an `online:` handle is, and the neighbours in the window's order (the preview from `online`). */
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
  /** The AI's feature; null — the guide's text, or nothing. */
  readonly feature: 'reply' | 'hi' | 'ping' | null;
  readonly template: OnlineTemplate | null;
}

/** The card's result this window made for the fan: which text it is, by the card's operation. */
interface TextOp {
  readonly opId: string;
  readonly key: string;
}

/** A fan of this pass: what the person did and what went. */
interface PassFan {
  skipped: boolean;
  /** «Не предлагать» or «Вернуть» of this person, until the hub's list says the same. */
  dismiss: { readonly to: 'dismissed' | 'restored'; readonly at: number } | null;
  /** The guide's text of the fan in its group's turn; «Другой шаблон» moves it on. */
  template: number | null;
  /** «Написать Ping» of a fan with nothing to write about. */
  write: boolean;
  /** The AI could not write here (no chat of the fan known, a short chat): the guide's text instead. */
  fallback: boolean;
  /** ChatSpace: the card's result this window made (the AI's or the guide's text). */
  textOp: TextOp | null;
  /** ChatSpace: the guide's text is being put on the card. */
  making: boolean;
  /** Fansly: the person's own words for the text. */
  edit: string | null;
  /** Fansly: the background's send, and the words it took. */
  own: OwnSend | null;
  ownText: string | null;
  /** What went from this window: the words, what wrote them, when, and the card's operation that held them. */
  sent: { readonly text: string; readonly act: OnlineAct; readonly templateId: string | null; readonly at: number; readonly opId: string | null } | null;
  /** «Отправить» was clicked: when; the next card follows once it went. */
  clickedAt: number | null;
  advanced: boolean;
  /** The hub heard of the send (`online.attempt`), once. */
  reported: boolean;
  /** The fan wrote after a send: when, and the send it answered (its `sent.at`); they wait for an answer again. */
  replied: { readonly at: IsoTimestamp; readonly to: number } | null;
  /** Fansly: the fan's chat the page's memory or the inbox search found. */
  group: string | null;
  /** Came online while the window was open: when this tab first saw them. */
  arrivedAt: number | null;
}

/** A fan as the rows and the card see them. */
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

const ONLINE_SELECTOR = { of: 'online' } as const;
const RETRY: UiAction = { type: 'ReloadView', selector: ONLINE_SELECTOR };
/** The groups «К разбору» holds; `none` and `aside` are under «Все онлайн» only. */
const TODO_GROUPS: readonly OnlineGroupId[] = ['waiting', 'new', 'expiring', 'silent', 'quiet', 'never'];
const WENT: readonly OnlineFanState[] = ['sent', 'uncertain'];
const MOVING: readonly OnlineFanState[] = ['sending', 'accepted'];
const iso = (ms: number | null): IsoTimestamp | null => (ms === null ? null : new Date(ms).toISOString());
const timeOf = (at: string | null): number | null => {
  if (at === null) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
};

/** The guide's text for a fan: their name in place of «love»; no name — «love» stays. */
export function fillTemplate(text: string, name: string | null): string {
  return name === null || name.trim() === '' ? text : text.replace(/\blove\b/, name.trim());
}

export function createOnlineController(deps: OnlineControllerDeps): OnlineController {
  const { rpc, i18n, clock, context, surfaces, navigator } = deps;
  const own = deps.own ?? null;
  const visible = deps.visible ?? ((): boolean => true);

  // ── the hub's list ──
  let list: OnlineList | null = null;
  let items = new Map<string, OnlineItem>();
  let listError: CgErrorWire | null = null;
  let loading = false;
  let loadedAt: number | null = null;
  let reads = 0;
  let pollTimer: number | null = null;
  /** The fans of the last read: a fan absent from it who shows up in the next one came online meanwhile. */
  let present: ReadonlySet<string> | null = null;

  // ── the person's choices ──
  let minutes: OnlinePeriod = ONLINE_DEFAULT_MINUTES;
  let tab: OnlineTab = 'todo';
  let typed = '';
  let applied = '';
  let searchTimer: number | null = null;
  /** The row the keys are on before its card opens. */
  let pending: string | null = null;
  let settleTimer: number | null = null;
  let advanceTimer: number | null = null;
  /** The card open when the window last closed: it opens again with the window while its fan is online. */
  let lastCard: string | null = null;

  // ── the pass ──
  const pass = new Map<string, PassFan>();
  /** The next guide text of each group: neighbours get different ones. */
  const turns: Record<'a' | 'b', number> = { a: 0, b: 0 };
  let pacedUntil = 0;
  let paceTimer: number | null = null;

  let batchPort: BatchPreviewPort | null = null;
  let offBatch: (() => void) | null = null;
  let epoch = context.current().epoch;
  let disposed = false;

  const pageId = (): number | null => context.current().binding?.pageId ?? null;
  const handleOf = (fanRef: string): TargetHandle => fanHandle('online', pageId() ?? 0, fanRef);
  const fanOf = (handle: TargetHandle): string | null => {
    const parsed = parseFanHandle(handle);
    return parsed !== null && parsed.source === 'online' && parsed.pageId === pageId() ? parsed.fanRef : null;
  };
  const openFan = (): string | null => {
    const handle = surfaces.current().preview.online;
    return handle === null ? null : fanOf(handle);
  };
  const passOf = (fanRef: string): PassFan => {
    let fan = pass.get(fanRef);
    if (fan === undefined) {
      fan = { skipped: false, dismiss: null, template: null, write: false, fallback: false, textOp: null, making: false, edit: null, own: null, ownText: null, sent: null, clickedAt: null, advanced: false, reported: false, replied: null, group: null, arrivedAt: null };
      pass.set(fanRef, fan);
    }
    return fan;
  };

  const batch = createBatch({
    clock,
    async start(handle) {
      const fanRef = fanOf(handle);
      const item = fanRef === null ? undefined : items.get(fanRef);
      const port = batchPort;
      if (port === null || fanRef === null || item === undefined) return { s: 'failed', code: 'CG-CONTEXT-CHANGED' };
      const how = howOf(fanRef, item);
      if (how.feature === null) return { s: 'failed', code: 'CG-FEATURE-DISABLED' };
      const outcome = await port.batchStart('online', handle, how.feature);
      const fan = passOf(fanRef);
      if (outcome.s === 'failed' && FALLBACK_CODES.includes(outcome.code)) {
        // The AI cannot write for this fan here: the guide's text goes instead (made at once, no AI).
        fan.fallback = true;
        void ensureManual(fanRef);
      } else if (outcome.s === 'ready' && own === null) {
        const row = port.outreachRow?.(handle) ?? null;
        fan.textOp = row === null ? null : { opId: row.opId, key: keyOf(how) };
      }
      return outcome;
    },
    live: (handle) => batchPort?.batchLive(handle) ?? null,
    changed: () => changed(),
  });

  // ── who and why ──

  const usable = (ctx: PageContextState): boolean => ctx.phase === 'ready' && pageFlag(ctx, 'preview') && ctx.bootstrap?.capabilities.includes(ONLINE_CAPABILITY) === true;
  const liveNow = (): ReadonlySet<string> => deps.live?.online() ?? new Set<string>();

  /** When the fan was last active as far as anyone knows: OnlyFansAPI's «online» since, else the hub's last activity. */
  const activeAt = (item: OnlineItem): number | null => timeOf(item.onlineSince) ?? timeOf(item.seenAt);
  const ageMinutes = (item: OnlineItem): number | null => {
    const at = activeAt(item);
    return at === null ? null : Math.max(0, (clock.now() - at) / 60_000);
  };
  /** The fan is online within `period` minutes: the site's dot, OnlyFansAPI's «online», or activity within the period. */
  function inPeriod(item: OnlineItem, period: number, live: ReadonlySet<string>): boolean {
    if (live.has(item.fanRef) || item.onlineSince !== null) return true;
    const age = ageMinutes(item);
    return age !== null && age <= period;
  }
  function presenceOf(item: OnlineItem, live: ReadonlySet<string>): OnlinePresence {
    if (live.has(item.fanRef)) return 'now';
    const age = ageMinutes(item);
    if (age !== null && age <= ONLINE_FRESH_MINUTES) return 'now';
    if (item.onlineSince !== null || (age !== null && age <= ONLINE_FADING_MINUTES)) return 'fading';
    return 'gone';
  }
  const fresh = (item: OnlineItem, live: ReadonlySet<string>): boolean => presenceOf(item, live) === 'now';

  /** The fan wrote after a text went from here: they wait for an answer again. */
  const answered = (item: OnlineItem, fan: PassFan | undefined): boolean => {
    if (fan?.sent === null || fan?.sent === undefined) return false;
    const wrote = timeOf(item.lastFanMessageAt);
    return wrote !== null && wrote > fan.sent.at;
  };

  function reasonOf(item: OnlineItem, fan: PassFan | undefined): OnlineReasonVM {
    if (answered(item, fan)) return { kind: 'answered', at: item.lastFanMessageAt };
    switch (item.reason) {
      case 'waiting':
        return { kind: 'waiting', since: item.reasonAt ?? item.lastFanMessageAt };
      case 'new_unattended':
        return { kind: 'new', subscribedAt: item.subscription.startedAt };
      case 'expiring':
        return { kind: 'expiring', endsAt: item.subscription.endsAt };
      case 'silent':
        return { kind: 'silent', since: item.lastFanMessageAt, lifetime: item.lifetimeGrossMills };
      case 'quiet':
        return { kind: 'quiet', since: item.lastFanMessageAt };
      case 'never_wrote':
        return { kind: 'never', subscribedAt: item.subscription.startedAt };
      default:
        return { kind: 'none', lastAt: item.lastPageMessageAt ?? item.lastFanMessageAt };
    }
  }

  function asideOf(item: OnlineItem, fan: PassFan | undefined): OnlineAsideVM | null {
    // The person's own «Не предлагать» / «Вернуть» stands until the hub's list says the same.
    if (fan?.dismiss?.to === 'dismissed') return { kind: 'dismissed', by: null, at: iso(fan.dismiss.at) };
    const hub = item.aside;
    if (fan?.dismiss?.to === 'restored' && hub === 'dismissed') return null;
    // An answer to a text from here lifts the fan out of «писали недавно».
    if (answered(item, fan) && (hub === 'attempted_recently' || hub === 'wrote_recently')) return null;
    switch (hub) {
      case 'in_conversation':
        return { kind: 'talking', names: item.asideBy ?? '', at: item.asideAt };
      case 'wrote_recently':
        return { kind: 'wrote', at: item.asideAt };
      case 'attempted_recently':
        return { kind: 'tried', at: item.asideAt };
      case 'dismissed':
        return { kind: 'dismissed', by: item.asideBy, at: item.asideAt };
      case 'unreachable':
        return { kind: 'unreachable' };
      default:
        return null;
    }
  }

  function groupOf(reason: OnlineReasonVM, aside: OnlineAsideVM | null): OnlineGroupId {
    if (aside !== null) return 'aside';
    return reason.kind === 'answered' ? 'waiting' : reason.kind;
  }

  /** The texts of the guide's group, in the hub's order. */
  const templatesOf = (group: 'a' | 'b'): OnlineTemplate[] => (list?.templates ?? []).filter((one) => one.group === group);

  /** The guide's text the fan gets in its group: their own turn, so neighbours get different ones. */
  function templateFor(fanRef: string, group: 'a' | 'b'): OnlineTemplate | null {
    const texts = templatesOf(group);
    if (texts.length === 0) return null;
    const fan = passOf(fanRef);
    if (fan.template === null) {
      fan.template = turns[group];
      turns[group] += 1;
    }
    return texts[fan.template % texts.length] ?? null;
  }

  /** What writes the fan's text now: the hub's act; the guide's text where the AI cannot write; «Написать Ping». */
  function howOf(fanRef: string, item: OnlineItem): How {
    const fan = pass.get(fanRef);
    const ai = answered(item, fan) ? 'reply' : item.act === 'reply' || item.act === 'hi' || item.act === 'ping' ? item.act : null;
    if (ai !== null && fan?.fallback !== true) return { act: ai, feature: ai, template: null };
    let group: 'a' | 'b' | null = item.act === 'template_a' ? 'a' : item.act === 'template_b' ? 'b' : null;
    if (ai !== null) group = item.messageCount > 0 ? 'a' : 'b';
    if (group === null) {
      // Nothing to write about (or an act this client does not know): only «Написать Ping» writes — Ping where the
      // chat has ten messages, else the guide's text.
      if (fan?.write !== true) return { act: 'none', feature: null, template: null };
      if (item.messageCount >= MIN_MESSAGES_FOR_PING && !fan.fallback) return { act: 'ping', feature: 'ping', template: null };
      group = item.messageCount > 0 ? 'a' : 'b';
    }
    const template = templateFor(fanRef, group);
    return template === null ? { act: 'none', feature: null, template: null } : { act: 'template', feature: null, template };
  }

  const keyOf = (how: How): string => (how.template !== null ? `t:${how.template.id}` : `a:${how.feature ?? ''}`);
  const templateText = (item: OnlineItem, template: OnlineTemplate): string => fillTemplate(template.text, item.greetingName);

  // ── each fan's text and send, one shape for both sites ──

  const paced = (): boolean => clock.now() < pacedUntil;
  const ownSending = (): boolean => [...pass.values()].some((fan) => fan.own?.state === 'sending');

  function pace(): void {
    pacedUntil = clock.now() + ONLINE_PACE_MS;
    if (paceTimer !== null) clock.clearTimer(paceTimer);
    paceTimer = clock.setTimer(ONLINE_PACE_MS, () => {
      paceTimer = null;
      changed();
    });
  }

  const NONE: Facts = { state: 'idle', version: null, edited: false, editable: false, send: null, warning: null, media: null, sentAt: null, clickedAt: null, failedAt: null, code: null, archiveAt: null };

  /** The card's send of the text, as its row says it (ChatSpace, X8). */
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

  function factsOf(fanRef: string, item: OnlineItem): Facts {
    const handle = handleOf(fanRef);
    const fan = pass.get(fanRef);
    const how = howOf(fanRef, item);
    const again = answered(item, fan);
    if (own === null) {
      const card = batchPort?.outreachRow?.(handle) ?? null;
      // What went, or may have, stands whatever the fan's act is now — until the fan answered it.
      if (card !== null && fan !== undefined && fan.clickedAt !== null && !(again && card.opId === fan.sent?.opId)) {
        const facts = cardFacts(fan, card);
        if (MOVING.includes(facts.state) || WENT.includes(facts.state) || facts.state === 'failed') return facts;
      }
      if (how.act === 'none') return NONE;
      if (card !== null && fan?.textOp !== null && fan?.textOp !== undefined && card.opId === fan.textOp.opId && fan.textOp.key === keyOf(how) && !(again && card.opId === fan.sent?.opId)) return cardFacts(fan, card);
      if (how.template !== null) {
        // The guide's text is the card's result once its card opened; until then the row shows it as it will go.
        const text = templateText(item, how.template);
        return { ...NONE, state: 'ready', version: text, send: { can: false, kind: 'send', paused: false, reason: msg(fan?.making === true ? 'online.reason.making' : 'online.reason.openCard') } };
      }
      return aiFacts(handle);
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
    if (how.template !== null) version = fan?.edit ?? templateText(item, how.template);
    else {
      const ai = aiFacts(handle);
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
      edited: fan?.edit !== null && fan?.edit !== undefined,
      editable: true,
      code: failed ? sent.code : null,
      failedAt: failed ? iso(sent.at) : null,
      send: { can: !resting && !empty, kind: failed ? 'retry' : 'send', paused: resting && !empty, reason: empty ? msg('online.reason.empty') : null },
    };
  }

  /** The AI's text as the window's batch has it: not started, written, or why not. */
  function aiFacts(handle: TargetHandle): Facts {
    if (batchPort === null) return NONE;
    const row = batch.row(handle);
    switch (row.state) {
      case null:
        return NONE;
      case 'queued':
      case 'generating':
        return { ...NONE, state: 'writing' };
      case 'failed':
        // No token of a click: nothing was written — the card's button writes it.
        return row.failure?.code === NO_TOKEN ? NONE : { ...NONE, state: 'unwritten', code: row.failure?.code ?? null };
      case 'ready':
      case 'sent':
        return { ...NONE, state: 'ready', version: row.text };
    }
  }

  /** Done in this pass: it went (and the fan has not answered), it may have, or the person skipped the fan. */
  function doneOf(item: OnlineItem, fan: PassFan | undefined, facts: Facts): boolean {
    if (fan?.skipped === true) return true;
    if (answered(item, fan)) return false;
    return WENT.includes(facts.state) || MOVING.includes(facts.state);
  }

  // ── view models ──

  interface Entry {
    readonly fanRef: string;
    readonly item: OnlineItem;
    readonly fan: PassFan | undefined;
    readonly facts: Facts;
    readonly reason: OnlineReasonVM;
    readonly aside: OnlineAsideVM | null;
    readonly group: OnlineGroupId;
    readonly done: boolean;
    readonly fresh: boolean;
    readonly name: string;
  }

  const nameOf = (item: OnlineItem): string => item.alias ?? item.displayName ?? (item.username === null ? `#${item.fanRef}` : `@${item.username}`);

  /** Every fan of the read within «Зашли за», with what this pass knows of them, in the window's order. */
  function entriesOf(period: number, live: ReadonlySet<string>): Entry[] {
    if (list === null) return [];
    const entries: Entry[] = [];
    for (const item of list.items) {
      if (!inPeriod(item, period, live)) continue;
      const fan = pass.get(item.fanRef);
      const reason = reasonOf(item, fan);
      const aside = asideOf(item, fan);
      const facts = factsOf(item.fanRef, item);
      entries.push({ fanRef: item.fanRef, item, fan, facts, reason, aside, group: groupOf(reason, aside), done: doneOf(item, fan, facts), fresh: fresh(item, live), name: nameOf(item) });
    }
    // The groups in their order; in each, who was active within ten minutes first, then who spent most, then the newest.
    return entries.sort(
      (a, b) =>
        ONLINE_GROUPS.indexOf(a.group) - ONLINE_GROUPS.indexOf(b.group) ||
        Number(b.fresh) - Number(a.fresh) ||
        b.item.lifetimeGrossMills - a.item.lifetimeGrossMills ||
        (activeAt(b.item) ?? 0) - (activeAt(a.item) ?? 0),
    );
  }

  const todoOf = (entry: Entry): boolean => TODO_GROUPS.includes(entry.group) && !entry.done;

  const matches = (entry: Entry): boolean => {
    const needle = normalizeSearch(applied).replace(/^@/, '');
    if (needle === '') return true;
    return [entry.item.alias, entry.item.displayName, entry.item.username, entry.fanRef].some((value) => value !== null && normalizeSearch(value).includes(needle));
  };

  /** The fans of the tab as the list shows them, the search applied; the open card's fan stays where it is. */
  function shownOf(entries: readonly Entry[], open: string | null): Entry[] {
    return entries.filter((entry) => (tab === 'all' || todoOf(entry) || entry.fanRef === open || entry.fanRef === pending) && matches(entry));
  }

  /** The next fan of the pass after `from`: whoever waits for an answer first, then the next one down the list. */
  function nextTodo(from: string | null, entries: readonly Entry[]): string | null {
    const todo = entries.filter((entry) => todoOf(entry) && entry.fanRef !== from && matches(entry));
    const waiting = todo.find((entry) => entry.group === 'waiting');
    if (waiting !== undefined) return waiting.fanRef;
    const order = entries.filter(matches).map((entry) => entry.fanRef);
    const at = from === null ? -1 : order.indexOf(from);
    for (let index = at + 1; index < order.length; index += 1) {
      const fanRef = order[index];
      if (todo.some((entry) => entry.fanRef === fanRef)) return fanRef ?? null;
    }
    return todo[0]?.fanRef ?? null;
  }

  function rowOf(entry: Entry, open: string | null, live: ReadonlySet<string>): OnlineRowVM {
    const { item, fan, facts } = entry;
    return {
      handle: handleOf(entry.fanRef),
      name: entry.name,
      username: item.username,
      lifetime: item.lifetimeGrossMills > 0 ? item.lifetimeGrossMills : null,
      seenAt: item.seenAt,
      onlineSince: item.onlineSince,
      live: live.has(entry.fanRef),
      presence: presenceOf(item, live),
      reason: entry.reason,
      aside: entry.aside,
      act: howOf(entry.fanRef, item).act,
      state: facts.state,
      version: facts.version,
      sentAct: fan?.sent?.act ?? null,
      sentAt: fan?.sent === null || fan?.sent === undefined ? null : iso(fan.sent.at),
      skipped: fan?.skipped === true,
      selected: entry.fanRef === (pending ?? open),
      arrived: fan?.arrivedAt !== null && fan?.arrivedAt !== undefined && clock.now() - fan.arrivedAt < ONLINE_ARRIVED_MS,
      replied: fan?.replied === null || fan?.replied === undefined ? null : { at: fan.replied.at, text: null },
      code: facts.code,
    };
  }

  function cardOf(entry: Entry, entries: readonly Entry[], live: ReadonlySet<string>): OnlineCardVM {
    const { item, fan, facts } = entry;
    const how = howOf(entry.fanRef, item);
    const nextRef = nextTodo(entry.fanRef, entries);
    const next = nextRef === null ? null : (entries.find((other) => other.fanRef === nextRef) ?? null);
    const writing = facts.state === 'writing';
    const went = WENT.includes(facts.state) || MOVING.includes(facts.state);
    const template = how.template === null ? null : { id: how.template.id, group: how.template.group === 'b' ? ('b' as const) : ('a' as const), named: /\blove\b/.test(how.template.text) ? item.greetingName !== null : null, greeting: item.greetingName };
    const noChat = own !== null && item.conversationRef === null && fan?.group == null;
    return {
      handle: handleOf(entry.fanRef),
      name: entry.name,
      username: item.username,
      lifetime: item.lifetimeGrossMills > 0 ? item.lifetimeGrossMills : null,
      last30: item.last30dGrossMills > 0 ? item.last30dGrossMills : null,
      seenAt: item.seenAt,
      onlineSince: item.onlineSince,
      live: live.has(entry.fanRef),
      presence: presenceOf(item, live),
      subscription: item.subscription.isSubscriber ? { startedAt: item.subscription.startedAt, endsAt: item.subscription.endsAt, autoRenew: item.subscription.autoRenew } : null,
      reason: entry.reason,
      aside: entry.aside,
      act: how.act,
      template,
      state: facts.state,
      version: facts.version,
      edited: facts.edited,
      editable: facts.editable && !writing,
      rewrite: batchPort !== null && !writing && !went && (how.feature !== null ? facts.state !== 'idle' || fan?.write === true : how.template !== null && templatesOf(how.template.group === 'b' ? 'b' : 'a').length > 1),
      write: how.act === 'none' && !went,
      send: facts.send,
      warning: facts.warning,
      media: facts.media,
      archiveAt: facts.archiveAt,
      sentAt: facts.sentAt,
      clickedAt: facts.clickedAt,
      failedAt: facts.failedAt,
      code: facts.code,
      replied: fan?.replied === null || fan?.replied === undefined ? null : { at: fan.replied.at, text: null },
      skipped: fan?.skipped === true,
      dismiss: entry.aside?.kind === 'dismissed' ? 'restore' : 'dismiss',
      noChat,
      next: next === null ? null : { handle: handleOf(next.fanRef), name: next.name },
    };
  }

  function viewOf(ctx: PageContextState): VmView {
    if (ctx.phase === 'loading') return loadingView(null);
    if (ctx.phase === 'blocked') return failureView(ctx.blocker ?? { code: 'CG-UNKNOWN' }, i18n, RETRY);
    if (!pageFlag(ctx, 'preview')) return failureView(flagFailure(ctx, 'preview'), i18n, RETRY);
    if (ctx.bootstrap?.capabilities.includes(ONLINE_CAPABILITY) !== true) return { s: 'forbidden', error: localError('CG-FEATURE-DISABLED', i18n), remedy: null };
    if (list === null) return listError !== null ? failureView(listError, i18n, RETRY) : loadingView(null);
    if (list.items.length === 0) return { s: 'empty', why: msg(own !== null ? 'online.empty.fansly' : 'online.empty.onlyfans') };
    return listError !== null ? dataView([{ kind: 'source-failed', source: 'online', code: listError.code }]) : dataView([]);
  }

  function build(): OnlineWindowVM {
    const ctx = context.current();
    const live = liveNow();
    const open = openFan();
    const entries = entriesOf(minutes, live);
    const shown = shownOf(entries, open);
    const groups: OnlineGroupVM[] = [];
    for (const id of ONLINE_GROUPS) {
      const rows = shown.filter((entry) => entry.group === id);
      if (rows.length === 0) continue;
      groups.push({ id, left: rows.filter((entry) => !entry.done).length, rows: rows.map((entry) => rowOf(entry, open, live)) });
    }
    const todo = entries.filter(todoOf);
    const sentFans = entries.filter((entry) => entry.fan?.sent !== null && entry.fan?.sent !== undefined);
    const repliedFans = entries.filter((entry) => entry.fan?.replied !== null && entry.fan?.replied !== undefined);
    const skipped = entries.filter((entry) => entry.fan?.skipped === true).length;
    const openEntry = open === null ? null : (entries.find((entry) => entry.fanRef === open) ?? null);
    const card = openEntry === null ? null : cardOf(openEntry, entries, live);
    const end: OnlineEndVM | null =
      card === null && todo.length === 0 && sentFans.length + skipped > 0
        ? {
            sent: sentFans.map((entry) => ({ handle: handleOf(entry.fanRef), name: entry.name })),
            skipped,
            replied: repliedFans.map((entry) => ({ handle: handleOf(entry.fanRef), name: entry.name })),
          }
        : null;
    const elsewhere =
      tab === 'todo' && applied.trim() === '' && list !== null
        ? { done: entries.filter((entry) => entry.done && entry.fanRef !== open).length, other: entries.filter((entry) => !TODO_GROUPS.includes(entry.group) && !entry.done).length }
        : null;
    return {
      view: viewOf(ctx),
      pageName: ctx.page?.title ?? null,
      creator: ctx.account?.username ?? null,
      persona: ctx.persona?.label ?? null,
      stamp: stamp(iso(loadedAt), list === null ? 'unknown' : 'complete'),
      source: ctx.binding?.platform === 'fansly' ? 'fansly' : 'onlyfans',
      minutes,
      periods: ONLINE_PERIODS.map((period) => ({ minutes: period, count: list === null ? 0 : list.items.filter((item) => inPeriod(item, period, live)).length })),
      tab,
      tabs: { todo: todo.length, all: entries.length },
      query: typed,
      groups,
      elsewhere: elsewhere === null || elsewhere.done + elsewhere.other === 0 ? null : elsewhere,
      totals: { online: entries.length, worth: todo.length, sent: sentFans.length, skipped, replied: repliedFans.length },
      card,
      end,
    };
  }

  const cell = new ViewCell(build);

  /** The view follows; `light` — only the search or the selection moved: no fan's text or send did. */
  function changed(light = false): void {
    if (disposed) return;
    if (!light) followSends();
    cell.invalidate();
    if (!light) for (const listener of [...directoryListeners]) listener();
  }

  /**
   * What went from here is told to the hub once (`online.attempt`, never repeated), and once the open card's text
   * went the next fan's card opens a moment later.
   */
  function followSends(): void {
    const open = openFan();
    for (const [fanRef, fan] of pass) {
      if (fan.clickedAt === null || (fan.reported && fan.advanced)) continue;
      const item = items.get(fanRef);
      if (item === undefined) continue;
      const facts = factsOf(fanRef, item);
      const went = facts.state === 'sent' || facts.state === 'accepted';
      if (!went) continue;
      if (fan.sent === null || fan.sent.at < fan.clickedAt) {
        const how = howOf(fanRef, item);
        fan.sent = { text: facts.version ?? '', act: how.act, templateId: how.template?.id ?? null, at: timeOf(facts.sentAt) ?? clock.now(), opId: own === null ? (batchPort?.outreachRow?.(handleOf(fanRef))?.opId ?? null) : null };
      }
      if (!fan.reported) {
        fan.reported = true;
        report(fanRef, item, fan);
      }
      if (!fan.advanced) {
        fan.advanced = true;
        if (fanRef === open) scheduleAdvance(fanRef);
      }
    }
  }

  /** The hub's record of a send from the window: once, never repeated; a failure changes nothing here. */
  function report(fanRef: string, item: OnlineItem, fan: PassFan): void {
    const id = pageId();
    const sent = fan.sent;
    if (id === null || sent === null) return;
    const act = sent.act === 'none' ? undefined : sent.act;
    void rpc
      .request('online.attempt', {
        pageId: id,
        fanRef,
        action: 'sent',
        ...(act === undefined ? {} : { act }),
        ...(sent.templateId === null ? {} : { templateId: sent.templateId }),
        ...(item.reason.length > 0 && item.reason.length <= 64 ? { reason: item.reason } : {}),
      })
      .catch(() => undefined);
  }

  function scheduleAdvance(from: string): void {
    if (advanceTimer !== null) clock.clearTimer(advanceTimer);
    advanceTimer = clock.setTimer(ONLINE_ADVANCE_MS, () => {
      advanceTimer = null;
      // The person moved to another fan meanwhile: the card stays theirs.
      if (disposed || openFan() !== from || pending !== null) return;
      advance(from);
    });
  }

  /** The next fan of the pass opens, or none is left: the card closes and the end of the pass shows. */
  function advance(from: string): void {
    const next = nextTodo(from, entriesOf(minutes, liveNow()));
    if (next === null) {
      surfaces.setPreview('online', null);
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
    const run = ++reads;
    const atEpoch = epoch;
    loading = true;
    changed(true);
    // Fansly: who of the creator's followers was active, told to the hub first (the background asks the site at most
    // once a minute per creator; a failure leaves the hub's own last word).
    if (own !== null) await own.seen(binding.pageId, binding.platformAccountId).catch(() => undefined);
    if (disposed || run !== reads || atEpoch !== epoch) return;
    const answer = await rpc.request('online.list', { pageId: binding.pageId, minutes: ONLINE_READ_MINUTES }).catch(() => null);
    if (disposed || run !== reads || atEpoch !== epoch) return;
    loading = false;
    if (answer === null) listError = { code: 'CG-RUNTIME-UNREACHABLE' };
    else if (!answer.ok) listError = answer.error;
    else {
      take(answer.payload);
      listError = null;
    }
    loadedAt = clock.now();
    changed();
  }

  /** A new read: who came meanwhile lights up, who answered a text from here waits again. */
  function take(next: OnlineList): void {
    const live = liveNow();
    const now = clock.now();
    const fans = new Set(next.items.filter((item) => inPeriod(item, minutes, live)).map((item) => item.fanRef));
    if (present !== null) for (const fanRef of fans) if (!present.has(fanRef)) passOf(fanRef).arrivedAt = now;
    present = fans;
    list = next;
    items = new Map(next.items.map((item) => [item.fanRef, item]));
    for (const item of next.items) {
      const fan = pass.get(item.fanRef);
      if (fan === undefined) continue;
      // The hub's list says the person's own mark now: it stands by itself.
      if (fan.dismiss !== null && (item.aside === 'dismissed') === (fan.dismiss.to === 'dismissed')) fan.dismiss = null;
      if (fan.sent !== null && fan.replied?.to !== fan.sent.at && answered(item, fan) && item.lastFanMessageAt !== null) {
        fan.replied = { at: item.lastFanMessageAt, to: fan.sent.at };
        // The fan waits for an answer again: a Reply is written for them (by a click on their card), the old text is history.
        fan.write = false;
        fan.fallback = false;
        fan.edit = null;
        fan.own = null;
        fan.ownText = null;
        fan.clickedAt = null;
        fan.advanced = false;
        fan.reported = false;
        fan.textOp = null;
        batch.drop([handleOf(item.fanRef)]);
      }
    }
  }

  function schedulePoll(): void {
    if (pollTimer !== null) clock.clearTimer(pollTimer);
    pollTimer = clock.setTimer(ONLINE_POLL_MS, () => {
      pollTimer = null;
      if (!surfaces.current().online) return;
      if (visible()) void read();
      schedulePoll();
    });
  }

  // ── the texts ──

  /** The fan's text is written now (the AI's) or put on their open card (the guide's), unless it is there already. */
  function ensureText(fanRef: string): void {
    const item = items.get(fanRef);
    const port = batchPort;
    if (item === undefined || port === null) return;
    const fan = pass.get(fanRef);
    const how = howOf(fanRef, item);
    if (fan?.skipped === true) return;
    if (how.feature !== null) {
      const handle = handleOf(fanRef);
      const row = batch.row(handle);
      const facts = factsOf(fanRef, item);
      // Written already, being written, or it went: nothing more by itself («Ещё раз» is the person's).
      if (facts.state !== 'idle' || (row.state !== null && !(row.state === 'failed' && row.failure?.code === NO_TOKEN))) return;
      batch.queue([handle]);
      return;
    }
    if (how.template !== null) void ensureManual(fanRef);
  }

  /** ChatSpace: the guide's text becomes the open card's result, so the card's own send takes it (X8). */
  async function ensureManual(fanRef: string): Promise<void> {
    const item = items.get(fanRef);
    const port = batchPort;
    if (own !== null || item === undefined || port?.onlineText === undefined) {
      changed();
      return;
    }
    const fan = passOf(fanRef);
    const how = howOf(fanRef, item);
    const handle = handleOf(fanRef);
    if (how.template === null || fan.making || surfaces.current().preview.online !== handle) {
      changed();
      return;
    }
    const key = keyOf(how);
    const card = port.outreachRow?.(handle) ?? null;
    if (fan.textOp !== null && fan.textOp.key === key && card !== null && card.opId === fan.textOp.opId) return;
    fan.making = true;
    changed();
    const atEpoch = epoch;
    const ok = await port.onlineText(handle, templateText(item, how.template)).catch(() => false);
    if (disposed || atEpoch !== epoch) return;
    fan.making = false;
    const row = ok ? (port.outreachRow?.(handle) ?? null) : null;
    if (row !== null) fan.textOp = { opId: row.opId, key };
    changed();
  }

  // ── the directory of the preview from `online` ──

  const directoryListeners = new Set<() => void>();

  function infoOf(fanRef: string, id: number, handle: TargetHandle): PreviewTargetInfo | null {
    const item = items.get(fanRef);
    if (item === undefined) return null;
    const platform = context.current().binding?.platform ?? null;
    // On Fansly a chat has an id of its own: the hub's, else the one the page's memory found; none — no chat is read.
    const conversation = platform !== null && !CHAT_IS_FAN[platform] ? (item.conversationRef ?? pass.get(fanRef)?.group ?? null) : null;
    return {
      handle,
      source: 'online',
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
      // Fansly: the fan's chat from the page's memory (a passive lookup, nothing is marked read).
      const fanRef = fanOf(handle);
      const binding = context.current().binding;
      const item = fanRef === null ? undefined : items.get(fanRef);
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
      const order = shownOf(entriesOf(minutes, liveNow()), openFan()).map((entry) => entry.fanRef);
      const at = order.indexOf(fanRef);
      return { previous: at > 0 ? handleOf(order[at - 1] as string) : null, next: at >= 0 && at < order.length - 1 ? handleOf(order[at + 1] as string) : null };
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
    surfaces.setList('online', true);
    schedulePoll();
    const stale = loadedAt === null || clock.now() - loadedAt > ONLINE_POLL_MS / 3;
    const first = stale ? read() : Promise.resolve();
    void first.then(() => {
      if (disposed || !surfaces.current().online || openFan() !== null || pending !== null) return;
      // Where the person was, while that fan is online; else the first fan to write to.
      const entries = entriesOf(minutes, liveNow());
      const back = lastCard !== null && entries.some((entry) => entry.fanRef === lastCard) ? lastCard : null;
      const start = back ?? nextTodo(null, entries);
      if (start !== null) void openCard(start);
    });
    changed();
    return done(type, 'opened');
  }

  /** The fan's card opens; their text is written, and the next fan's. */
  async function openCard(fanRef: string): Promise<void> {
    if (settleTimer !== null) clock.clearTimer(settleTimer);
    settleTimer = null;
    pending = null;
    const handle = handleOf(fanRef);
    const atEpoch = epoch;
    await directory.prepare?.(handle).catch(() => undefined);
    if (disposed || atEpoch !== epoch || !surfaces.current().online || pending !== null) return;
    surfaces.setPreview('online', handle);
    ensureText(fanRef);
    const next = nextTodo(fanRef, entriesOf(minutes, liveNow()));
    if (next !== null) ensureText(next);
    changed();
  }

  /** A row clicked, or the keys on it (`keys` — the card follows once they stop). */
  function select(type: UiActionType, fanRef: string, keys: boolean): ActionReceipt {
    if (!items.has(fanRef)) return refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n));
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
    settleTimer = clock.setTimer(ONLINE_SETTLE_MS, () => {
      settleTimer = null;
      void openCard(fanRef);
    });
    changed(true);
    return done(type);
  }

  /** «Отправить →» of one fan: their text, one click — one message, one attempt. */
  async function send(type: UiActionType, fanRef: string, anyway: boolean): Promise<ActionReceipt> {
    const item = items.get(fanRef);
    if (item === undefined) return refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n));
    const facts = factsOf(fanRef, item);
    if (facts.state !== 'ready' && facts.state !== 'failed') return refused(type, localError(facts.state === 'sending' || facts.state === 'accepted' ? 'CG-SEND-BUSY' : 'CG-SEND-PART', i18n));
    if (facts.send === null || !facts.send.can) return refused(type, localError(facts.send?.paused === true ? 'CG-SEND-BUSY' : 'CG-SEND-PART', i18n));
    const fan = passOf(fanRef);
    if (own === null) {
      const port = batchPort;
      if (port?.outreachSend === undefined) return refused(type, localError('CG-FEATURE-DISABLED', i18n));
      fan.clickedAt = clock.now();
      fan.advanced = false;
      fan.reported = false;
      const receipt = await port.outreachSend(type, handleOf(fanRef), anyway || facts.send.kind === 'anyway');
      changed();
      return receipt;
    }
    return sendOwn(type, fanRef, item, fan, facts);
  }

  /** The site's own send (Fansly): the click's token, the fan's chat, one request. */
  async function sendOwn(type: UiActionType, fanRef: string, item: OnlineItem, fan: PassFan, facts: Facts): Promise<ActionReceipt> {
    const binding = context.current().binding;
    const channel = own;
    if (binding === null || channel === null) return refused(type, localError('CG-BINDING-MISSING', i18n));
    if (paced() || ownSending()) return refused(type, localError('CG-SEND-BUSY', i18n));
    const body = (facts.version ?? '').trim().slice(0, ONLINE_TEXT_MAX);
    if (body.length === 0) return refused(type, localError('CG-SEND-PART', i18n));
    const how = howOf(fanRef, item);
    const sending: OwnSend = { state: 'sending', code: null, clickedAt: clock.now(), at: null };
    fan.own = sending;
    fan.ownText = body;
    fan.clickedAt = sending.clickedAt;
    fan.advanced = false;
    fan.reported = false;
    const sentNow = { text: body, act: how.act, templateId: how.template?.id ?? null, opId: null };
    pace();
    changed();
    const atEpoch = epoch;
    const end = (state: OwnSend['state'], code: string | null): ActionReceipt => {
      if (atEpoch === epoch && fan.own === sending) {
        sending.state = state;
        sending.code = code;
        sending.at = clock.now();
        if (state !== 'failed') fan.sent = { ...sentNow, at: sending.at };
        changed();
      }
      return state === 'sent' ? done(type) : refused(type, localError(state === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-SEND-REJECTED', i18n, code ?? undefined));
    };
    // The click's token first: it is the person's consent for this one send.
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

  /** «Ещё раз» (the AI writes again), «Другой шаблон» (the guide's next text), «Написать Ping» / «Написать Reply». */
  function rewrite(type: UiActionType, fanRef: string): ActionReceipt {
    const item = items.get(fanRef);
    if (item === undefined || batchPort === null) return refused(type, localError('CG-DATA-NOT-READY', i18n));
    const fan = passOf(fanRef);
    const before = factsOf(fanRef, item);
    if (MOVING.includes(before.state) || before.state === 'writing') return refused(type, localError('CG-SEND-BUSY', i18n));
    if (WENT.includes(before.state) && !answered(item, fan)) return refused(type, localError('CG-SEND-PART', i18n));
    let how = howOf(fanRef, item);
    if (how.act === 'none') {
      fan.write = true;
      how = howOf(fanRef, item);
    } else if (how.template !== null) {
      fan.template = (fan.template ?? 0) + 1;
      how = howOf(fanRef, item);
    }
    fan.edit = null;
    if (fan.own?.state === 'failed') fan.own = null;
    if (how.feature !== null) batch.queue([handleOf(fanRef)]);
    else if (how.template !== null) void ensureManual(fanRef);
    changed();
    return done(type, 'started');
  }

  function edit(type: UiActionType, fanRef: string, words: string | null): ActionReceipt {
    const item = items.get(fanRef);
    if (item === undefined) return refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n));
    const facts = factsOf(fanRef, item);
    if (!facts.editable) return refused(type, localError('CG-SEND-PART', i18n));
    if (own === null) {
      const ok = batchPort?.outreachEdit?.(handleOf(fanRef), words === null ? null : words.slice(0, ONLINE_TEXT_MAX)) ?? false;
      changed();
      return ok ? done(type) : refused(type, localError('CG-SEND-PART', i18n));
    }
    passOf(fanRef).edit = words === null ? null : words.slice(0, ONLINE_TEXT_MAX);
    changed();
    return done(type);
  }

  /** «Пропустить» (this pass only) and «Вернуть»; the next fan's card opens after a skip. */
  function skip(type: UiActionType, fanRef: string, on: boolean): ActionReceipt {
    if (!items.has(fanRef)) return refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n));
    passOf(fanRef).skipped = on;
    if (on && openFan() === fanRef) advance(fanRef);
    changed();
    return done(type);
  }

  /** «Не предлагать» for the page's whole team, or its undo: one call to the hub, never repeated. */
  async function dismiss(type: UiActionType, fanRef: string, on: boolean): Promise<ActionReceipt> {
    const id = pageId();
    if (id === null || !items.has(fanRef)) return refused(type, localError('CG-GATE-FAN-UNKNOWN', i18n));
    const fan = passOf(fanRef);
    const previous = fan.dismiss;
    fan.dismiss = { to: on ? 'dismissed' : 'restored', at: clock.now() };
    if (on && openFan() === fanRef) advance(fanRef);
    changed();
    const answer = await rpc.request('online.attempt', { pageId: id, fanRef, action: on ? 'dismissed' : 'restored' }).catch(() => null);
    if (answer !== null && answer.ok) return done(type);
    // The hub did not take it: the mark is not shown as kept.
    fan.dismiss = previous;
    changed();
    return refused(type, answer === null ? localError('CG-RUNTIME-UNREACHABLE', i18n) : errorOf(answer.error, i18n));
  }

  /** The fan's chat, by the person's click on the card's «Открыть чат»: the window closes, the chat opens. */
  async function openChat(type: UiActionType, fanRef: string): Promise<ActionReceipt> {
    const ctx = context.current();
    const binding = ctx.binding;
    const item = items.get(fanRef);
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

  function setOnline(action: Extract<UiAction, { type: 'SetOnline' }>): ActionReceipt {
    if (action.open === true) return open(action.type);
    if (action.open === false) {
      surfaces.setList('online', false);
      return done(action.type);
    }
    if (action.tab !== undefined) tab = action.tab;
    if (action.minutes !== undefined) minutes = action.minutes;
    if (action.refresh === true) void read();
    changed();
    return done(action.type);
  }

  function search(query: string, now: boolean): ActionReceipt {
    typed = query;
    if (searchTimer !== null) clock.clearTimer(searchTimer);
    searchTimer = null;
    if (now) applied = typed;
    else
      searchTimer = clock.setTimer(ONLINE_SEARCH_DEBOUNCE_MS, () => {
        searchTimer = null;
        applied = typed;
        changed(true);
      });
    changed(true);
    return done('Search');
  }

  function dispatch(action: UiAction): Promise<ActionReceipt> | null {
    switch (action.type) {
      case 'Navigate': {
        const to = action.to;
        if (to.kind === 'surface' && to.surface === 'online') {
          if (to.open) return Promise.resolve(open(action.type));
          surfaces.setList('online', false);
          return Promise.resolve(done(action.type));
        }
        if (to.kind !== 'chat') return null;
        const fanRef = fanOf(to.targetHandle);
        return fanRef === null ? null : openChat(action.type, fanRef);
      }
      case 'SetOnline':
        return Promise.resolve(setOnline(action));
      case 'SelectOnline': {
        const fanRef = fanOf(action.targetHandle);
        return fanRef === null ? null : Promise.resolve(select(action.type, fanRef, action.keys === true));
      }
      case 'SendOnline':
      case 'RewriteOnline':
      case 'EditOnline':
      case 'SkipOnline':
      case 'DismissOnline': {
        const fanRef = fanOf(action.targetHandle);
        if (fanRef === null) return null;
        if (action.type === 'SendOnline') return send(action.type, fanRef, action.anyway === true);
        if (action.type === 'RewriteOnline') return Promise.resolve(rewrite(action.type, fanRef));
        if (action.type === 'EditOnline') return Promise.resolve(edit(action.type, fanRef, action.text));
        if (action.type === 'SkipOnline') return Promise.resolve(skip(action.type, fanRef, action.skip));
        return dismiss(action.type, fanRef, action.dismiss);
      }
      case 'Search':
        return action.list === 'online' ? Promise.resolve(search(action.query, action.now === true)) : null;
      case 'ReloadView':
        if (action.selector.of !== 'online') return null;
        return (context.current().phase === 'ready' ? Promise.resolve() : context.refresh()).then(async () => {
          await read();
          return done(action.type);
        });
      default:
        return null;
    }
  }

  // ── life ──

  function reset(): void {
    batch.reset();
    list = null;
    items = new Map();
    listError = null;
    loading = false;
    loadedAt = null;
    present = null;
    reads += 1;
    pass.clear();
    turns.a = 0;
    turns.b = 0;
    pending = null;
    lastCard = null;
    typed = '';
    applied = '';
    tab = 'todo';
    minutes = ONLINE_DEFAULT_MINUTES;
    for (const timer of [settleTimer, advanceTimer, searchTimer]) if (timer !== null) clock.clearTimer(timer);
    settleTimer = null;
    advanceTimer = null;
    searchTimer = null;
  }

  const offContext = context.subscribe((state) => {
    if (state.epoch !== epoch) {
      // Another sign-in, hub or account: the pass of the old one goes with everything it held.
      epoch = state.epoch;
      reset();
      surfaces.setList('online', false);
    } else if (surfaces.current().online && list === null && !loading && usable(state)) void read();
    changed();
  });
  const offSurfaces = surfaces.subscribe((state, previous) => {
    if (state.online) lastCard = state.preview.online === null ? lastCard : fanOf(state.preview.online);
    if (!state.online && previous.online) {
      // Closed: no more reads; the card is remembered for the next opening.
      if (pollTimer !== null) clock.clearTimer(pollTimer);
      pollTimer = null;
      if (settleTimer !== null) clock.clearTimer(settleTimer);
      settleTimer = null;
      pending = null;
    }
    if (state.online !== previous.online || state.preview.online !== previous.preview.online) changed();
  });
  const offLive = deps.live?.subscribe(() => changed(true)) ?? null;
  const offLanguage = i18n.subscribe(() => changed(true));

  return {
    kinds: ['online'],
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
      offBatch?.();
      batch.dispose();
      offContext();
      offSurfaces();
      offLive?.();
      offLanguage();
      for (const timer of [pollTimer, settleTimer, advanceTimer, searchTimer, paceTimer]) if (timer !== null) clock.clearTimer(timer);
      directoryListeners.clear();
      cell.clear();
    },
  };
}
