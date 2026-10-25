// «Рассылка» as a window of its own (2026-10-25, the owner's pick of the redesign: the twin of «Новые», one on both
// sites): the view `outreach`. Who it is for comes from the Spenders board (its tiers, sums and who wrote last) through
// «Кому» — the chosen tiers, or the fans ticked in Spenders, minus what a condition leaves out (domain/outreach); each
// fan's version is Fix of the common text written for them (`outreach-fix-v1`), two at a time, by the window's batch
// through the fan's card (the preview from `outreach`); each version goes by one click on that fan's «Отправить» —
// on ChatSpace the card's own send (X8) with the outreach's vault media or the fan's own, on Fansly our background's
// send with the items copied in the model's posts. Nothing goes by itself: no key, no «send all», no retry of an
// unknown outcome; every «Отправить» of the tab rests half a second after a click (#343, #349).
//
// What came of a send is read from what the hub already holds — the fan's archive: they wrote back, our priced message
// was bought — and, where the site's vault says it (ChatSpace), whether the fan bought the media; a few times, further
// and further apart, never a chat the person did not open. Once nothing is left to send, the pane on the right says
// what the outreach did.

import { type CgErrorWire } from '@cg/contracts/errors';
import { OUTREACH_FIX_CAPABILITY } from '@cg/contracts/ids';
import { type IsoTimestamp, type MoneyMills } from '@cg/contracts/primitives';
import { type SendAttributionComposedWith } from '@cg/contracts/hub';
import {
  type ActionReceipt,
  type I18n,
  type OutreachAsideVM,
  type OutreachCardVM,
  type OutreachChipVM,
  type OutreachConditionNoteVM,
  type OutreachConditionVM,
  type OutreachFanState,
  type OutreachMediaVM,
  type OutreachNamesVM,
  type OutreachPane,
  type OutreachPostVM,
  type OutreachRowVM,
  type OutreachSendVM,
  type OutreachSummaryFanVM,
  type OutreachSummaryLeftVM,
  type OutreachSummaryVM,
  type OutreachTab,
  type OutreachWarningVM,
  type OutreachWindowVM,
  type TargetHandle,
  type UiAction,
  type VmView,
} from '@cg/contracts/vm';

import { DEFAULT_CONDITIONS, audienceOf, parseAmount, poolOf, type Audience, type AudienceFan, type AudienceSource, type AudienceTier, type OutreachConditions } from '../../domain/outreach';
import { type BoardIndex } from '../../domain/spenders/board';
import { normalizeSearch } from '../../domain/spenders/rows';
import { OUTSIDE_SHELF_ID } from '../../domain/spenders/shelves';
import { batchDispatch, createBatch, isBatchAction, type BatchPreviewPort, type OutreachCardRow } from '../boards/batch';
import { type PageContextPort, flagFailure, pageFlag, pageFlagOf } from '../boards/context';
import { fanHandle, parseFanHandle } from '../boards/handles';
import { issueCause } from '../boards/navigate';
import { type BoardsClock, type TabRpc } from '../boards/ports';
import { type PreviewDirectory, type PreviewTargetInfo, type Surfaces } from '../boards/shared';
import { ViewCell, done, refused, type SurfaceController } from '../boards/surface';
import { dataView, failureView, loadingView, localError, msg, stamp } from '../boards/views';
import { flagReasonVm } from '../flag-reason';

/** One «Отправить» of the tab each half second, as the cards' (#343, #349: a run of clicks never goes out in one burst). */
export const OUTREACH_PACE_MS = 500;
/** The common text and one version, at most (the preview's draft limit). */
export const OUTREACH_TEXT_MAX = 5_000;
/** The tiers «Кому» starts with: the richest three that have fans («Whale, Top и Prime»). */
const DEFAULT_TIERS = 3;
/** The search waits this long after the last keystroke. */
export const OUTREACH_SEARCH_DEBOUNCE_MS = 150;
/** What a fan did after a send is read again this long after it, further and further apart; then no more. */
export const OUTCOME_CHECKS_MS = [60_000, 120_000, 240_000, 480_000, 900_000, 1_800_000, 3_600_000] as const;
/** Reads of what came of the sends at once, at most. */
const OUTCOME_READS = 2;
/** Fans asked about purchases of the offer's media at once, at most (the site's vault, one read per fan). */
const STATE_READS = 3;
/** The names a note of «Кому» says, at most. */
const NAMES_SHOWN = 3;
/** The fan messages after our send that count as an answer: the archive's first page of the fan. */
const FEED_LIMIT = 20;

/** An item of Fansly's «Copied …» list: 2 — «Copied Bundle», 1 — «Copied Media». */
export interface OutreachItem {
  readonly contentType: 1 | 2;
  readonly contentId: string;
}

/**
 * The page's «Copied …» list as read. `checked` — the site said which ids are bundles (Fansly's own reload files copied
 * bundles as «Copied Media», and a bundle sent as media reaches the fan as nothing); false — as the page stored them.
 */
export interface OutreachCopied {
  readonly items: readonly OutreachItem[];
  readonly checked: boolean;
}

/** What goes to one fan by the site's own send: the background's `fansly.spenders.outreach`. */
export interface OutreachRequest {
  readonly hostAccountId: string;
  readonly fanRef: string;
  readonly groupId: string;
  readonly text: string;
  readonly attachments: readonly OutreachItem[];
  readonly cause: { readonly kind: 'click' | 'key'; readonly actionToken: string };
  /** How the text was written, for the hub's record of who sent it (Chat Memory week 1). */
  readonly composedWith: SendAttributionComposedWith;
}

export type OutreachAnswer = { readonly ok: true; readonly messageId: string } | { readonly ok: false; readonly code: string };

/** A site that sends the versions itself (Fansly): the page's «Copied …» list and the background's send. */
export interface OutreachOwnChannel {
  /** The creator's list; `hostAccountId` null — the window is bound to no account, nothing is asked of the site. */
  copied(hostAccountId: string | null): Promise<OutreachCopied>;
  send(request: OutreachRequest): Promise<OutreachAnswer>;
}

/** The Spenders board as the window reads it (the Spenders controller's, so its names and caches are one). */
export interface OutreachBoardPort {
  /** The page's lifetime board: every payer with their tier, sum and who wrote last. */
  list(): { readonly index: BoardIndex | null; readonly loading: boolean; readonly error: CgErrorWire | null; readonly since: number | null };
  /** The 7-day board: who spent in the last 7 days; null — not read. */
  recent(): BoardIndex | null;
  /** Reads what is missing or old (`force` — past the caches); `recent` — the 7-day board too. */
  load(what: { readonly recent?: boolean; readonly force?: boolean }): Promise<void>;
  /** Spenders' ticked fans and its pressed tier: what the window opened from it starts with. */
  seed(): { readonly picked: readonly string[]; readonly shelf: string | null };
  /** The fan as the board knows them for their card (without the handle and the list); null — not on the board. */
  info(fanRef: string): Omit<PreviewTargetInfo, 'handle' | 'source'> | null;
  /** A passive lookup of the fan's chat before their card opens (Fansly's group in the page's memory). */
  prepare?(fanRef: string): Promise<void>;
  /** The fan's chat for a send or a read, as the board finds it (Fansly: its row, the page's memory, the inbox search). */
  group(fanRef: string): Promise<string | null>;
  /** «Открыть чат» of a fan the person clicked: the board's own way into the chat (the boards close). */
  openChat(type: UiAction['type'], fanRef: string): Promise<ActionReceipt>;
  subscribe(listener: () => void): () => void;
}

export interface OutreachControllerDeps {
  readonly rpc: TabRpc;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
  readonly board: OutreachBoardPort;
  /** The site sends the versions itself (Fansly); absent — the fan's card sends them (ChatSpace, X8). */
  readonly own?: OutreachOwnChannel;
}

export interface OutreachController extends SurfaceController<'outreach'> {
  /** Who an `outreach:` handle is, and the neighbours in the window's order (the preview from `outreach`). */
  readonly directory: PreviewDirectory;
  /** The preview, made after the lists: until then the window writes no versions. */
  attachBatch(port: BatchPreviewPort): void;
}

/** A send of the site's own channel (Fansly): where it stands. */
interface OwnSend {
  state: 'sending' | 'sent' | 'uncertain' | 'failed';
  code: string | null;
  readonly clickedAt: number;
  at: number | null;
}

/** What came of a send: read from the archive (and the site's vault), checked a few times, further apart. */
interface Outcome {
  readonly sentAt: number;
  /** The price the fan was offered with paid media, mills; null — text only, or posts of unknown price. */
  readonly mills: MoneyMills | null;
  /** The paid media of the vault that went (their purchase is asked of the site); empty — none. */
  readonly paidIds: readonly string[];
  bought: { readonly mills: MoneyMills | null; readonly at: IsoTimestamp | null } | null;
  replied: { readonly at: IsoTimestamp; readonly text: string | null } | null;
  checks: number;
  timer: number | null;
}

/** A fan of the window as the rows and the card see them: one shape for both sites' sends. */
interface FanFacts {
  readonly state: OutreachFanState;
  readonly version: string | null;
  readonly edited: boolean;
  readonly editable: boolean;
  readonly send: OutreachSendVM | null;
  readonly warning: OutreachWarningVM | null;
  readonly sentAt: IsoTimestamp | null;
  readonly clickedAt: IsoTimestamp | null;
  readonly failedAt: IsoTimestamp | null;
  readonly code: string | null;
  readonly media: OutreachMediaVM | null;
  readonly ownMedia: boolean;
  readonly archiveAt: IsoTimestamp | null;
}

const OUTREACH_SELECTOR = { of: 'outreach' } as const;
const RETRY: UiAction = { type: 'ReloadView', selector: OUTREACH_SELECTOR };
const keyOf = (item: OutreachItem): string => `${item.contentType}:${item.contentId}`;
const iso = (ms: number | null): IsoTimestamp | null => (ms === null ? null : new Date(ms).toISOString());
const timeOf = (at: IsoTimestamp | null): number | null => {
  if (at === null) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
};

export function createOutreachController(deps: OutreachControllerDeps): OutreachController {
  const { rpc, i18n, clock, context, surfaces, board } = deps;
  const own = deps.own ?? null;

  // ── the person's choices ──
  let text = '';
  /** Grows with every change of the common text once versions exist: a version remembers the one it was written from. */
  let textRevision = 0;
  let textChangedAt: number | null = null;
  /** null until the window first opens with a board: then the default tiers (or Spenders' seed). */
  let source: AudienceSource | null = null;
  let conditions: OutreachConditions = DEFAULT_CONDITIONS;
  let amountTyped = '1,000';
  const unticked = new Set<string>();
  /** The fans of the outreach once its versions are written, in the board's order; null — not written yet. */
  let locked: string[] | null = null;
  let tab: OutreachTab = 'all';
  /** «К отправке»: the fans it showed when it was chosen stay, so a row sent from it does not jump away. */
  let todoSnapshot = new Set<string>();
  let pane: OutreachPane = 'offer';
  let typed = '';
  let applied = '';
  let searchTimer: number | null = null;
  let minimized = false;
  /** Fansly's «Из постов» sheet. */
  let postsOpen = false;
  /** The pane went to the end once by itself: a later look at a card is the person's. */
  let endShown = false;
  /** The card open when the window last closed («Свернуть», a chat opened from it): it opens again with the window. */
  let lastCard: TargetHandle | null = null;

  // ── what the sends did ──
  /** The text revision each fan's version was written from. */
  const versions = new Map<string, number>();
  const owned = new Map<string, OwnSend>();
  /** The person's own words for a fan's version (the site's own send; the cards keep theirs). */
  const edits = new Map<string, string>();
  /** What the site's own send took for a fan: the version and the media as they went. */
  const sentTexts = new Map<string, { readonly text: string; readonly media: OutreachMediaVM | null }>();
  /** When «Отправить» was clicked for a fan (the cards' sends too). */
  const clicks = new Map<string, number>();
  const outcomes = new Map<string, Outcome>();
  let outcomeQueue: string[] = [];
  let outcomeReads = 0;
  let pacedUntil = 0;
  let paceTimer: number | null = null;

  // ── Fansly's «Copied …» list ──
  let items: readonly OutreachItem[] = [];
  let itemsState: 'reading' | 'checked' | 'unchecked' = 'checked';
  const pickedItems = new Set<string>();
  let reads = 0;

  // ── who bought the offer's paid media already (the site's vault) ──
  /** `fan|media` → bought; absent — not asked yet. */
  const bought = new Map<string, boolean>();
  const asking = new Set<string>();
  let statesFailed = false;
  let statesTimer: number | null = null;

  let batchPort: BatchPreviewPort | null = null;
  /** The cards can pick media of the vault for the outreach (ChatSpace's X8 send with X53's picker). */
  let cardMedia = false;
  let offBatch: (() => void) | null = null;
  let epoch = context.current().epoch;
  let disposed = false;

  const pageId = (): number | null => context.current().binding?.pageId ?? null;
  const handleOf = (fanRef: string): TargetHandle => fanHandle('outreach', pageId() ?? 0, fanRef);
  const fanOf = (handle: TargetHandle): string | null => {
    const parsed = parseFanHandle(handle);
    return parsed !== null && parsed.source === 'outreach' && parsed.pageId === pageId() ? parsed.fanRef : null;
  };
  const selectedFan = (): string | null => {
    const handle = surfaces.current().preview.outreach;
    return handle === null ? null : fanOf(handle);
  };

  const batch = createBatch({
    clock,
    start(handle) {
      const fanRef = fanOf(handle);
      if (batchPort === null || fanRef === null) return Promise.resolve({ s: 'failed', code: 'CG-CONTEXT-CHANGED' });
      // The text as it is when the fan's turn comes: what the version is written from is what it remembers.
      versions.set(fanRef, textRevision);
      edits.delete(fanRef);
      return batchPort.batchStart('outreach', handle, 'fix', { draft: text });
    },
    live: (handle) => batchPort?.batchLive(handle) ?? null,
    changed: () => changed(),
  });

  // ── the board and the audience ──

  const listIndex = (): BoardIndex | null => board.list().index;

  /** The board's tiers with fans, richest first («вне полок» aside), each tier's fans by what they spent, most first. */
  function tiersOf(index: BoardIndex): AudienceTier[] {
    return index.shelves
      .filter((shelf) => shelf.id !== OUTSIDE_SHELF_ID && shelf.rows.length > 0)
      .map((shelf) => ({ id: shelf.id, fans: [...shelf.rows].sort((a, b) => (b.lifetime ?? -1) - (a.lifetime ?? -1)).map((row) => row.fanRef) }));
  }

  let audienceCache: { readonly key: unknown[]; readonly value: Audience } | null = null;
  const fansCache = new WeakMap<BoardIndex, ReadonlyMap<string, AudienceFan>>();

  function fansOf(index: BoardIndex): ReadonlyMap<string, AudienceFan> {
    let fans = fansCache.get(index);
    if (fans === undefined) {
      fans = new Map(index.rows.map((row) => [row.fanRef, { fanRef: row.fanRef, lifetime: row.lifetime, fanWroteAt: row.fanWroteAt, waiting: row.waiting }]));
      fansCache.set(index, fans);
    }
    return fans;
  }

  /** The offer's paid media of the vault (their purchase is what «Не купил это видео» asks); empty — none. */
  function paidIds(media: OutreachMediaVM | null): string[] {
    if (media === null || media.priceCents === 0) return [];
    return media.items.filter((item) => !item.free).map((item) => item.id);
  }

  /** Who of the pool bought the offer's paid media, as far as asked; null — no paid media, or the site cannot tell. */
  function boughtMap(pool: readonly string[], ids: readonly string[]): ReadonlyMap<string, IsoTimestamp | null> | null {
    if (ids.length === 0 || batchPort?.outreachStates === undefined || own !== null || statesFailed) return null;
    const map = new Map<string, IsoTimestamp | null>();
    for (const fanRef of pool) if (ids.some((id) => bought.get(`${fanRef}|${id}`) === true)) map.set(fanRef, null);
    return map;
  }

  function audience(): Audience | null {
    const index = listIndex();
    if (index === null || source === null) return null;
    const media = offerMedia();
    const ids = paidIds(media);
    const recent = board.recent();
    const key = [index, source, conditions, ids.join(','), bought.size, statesFailed, recent, unticked.size, [...unticked].join(','), locked, Math.floor(clock.now() / 60_000)];
    if (audienceCache !== null && audienceCache.key.length === key.length && audienceCache.key.every((part, at) => part === key[at])) return audienceCache.value;
    const fans = fansOf(index);
    const tiers = tiersOf(index);
    const pool = poolOf({ fans, tiers, source });
    const value = audienceOf({
      fans,
      tiers,
      source,
      conditions,
      bought: boughtMap(pool, ids),
      recent: recent === null ? null : new Set(recent.rows.filter((row) => (row.period ?? 0) > 0).map((row) => row.fanRef)),
      unticked,
      locked,
      now: clock.now(),
    });
    audienceCache = { key, value };
    return value;
  }

  /**
   * «Кому» starts with: Spenders' ticked fans, else its pressed tier, else what the person chose last time, else the
   * richest three tiers. An outreach whose versions are written keeps its fans.
   */
  function seedSource(fromSpenders: boolean): void {
    const index = listIndex();
    if (index === null || locked !== null) return;
    const seed = fromSpenders ? board.seed() : { picked: [], shelf: null };
    const tiers = tiersOf(index);
    let next: AudienceSource | null = null;
    if (seed.picked.length > 0) next = { kind: 'picked', fans: [...seed.picked] };
    else if (seed.shelf !== null && tiers.some((tier) => tier.id === seed.shelf)) next = { kind: 'tiers', on: new Set([seed.shelf]) };
    else if (source === null) next = { kind: 'tiers', on: new Set(tiers.slice(0, DEFAULT_TIERS).map((tier) => tier.id)) };
    if (next === null) return;
    source = next;
    unticked.clear();
  }

  // ── media ──

  /** The offer's media: the vault's (the cards' desk) or the picked «Copied …» items; null — text only. */
  function offerMedia(): OutreachMediaVM | null {
    if (own !== null) {
      const posts = items.filter((item) => pickedItems.has(keyOf(item))).length;
      return posts === 0 ? null : { items: [], posts, priceCents: 0, problem: null };
    }
    return batchPort?.outreachMedia?.() ?? null;
  }

  const pickedPosts = (): OutreachItem[] => items.filter((item) => pickedItems.has(keyOf(item)));

  function readCopied(): void {
    if (own === null) return;
    const at = ++reads;
    const atEpoch = epoch;
    itemsState = 'reading';
    changed();
    void own.copied(context.current().binding?.platformAccountId ?? null).then(
      (next) => {
        if (at !== reads || atEpoch !== epoch) return;
        // Every «Copied Bundle» the list brings is picked; the person's own ticks stay.
        const known = new Set(items.map(keyOf));
        for (const item of next.items) if (!known.has(keyOf(item)) && item.contentType === 2) pickedItems.add(keyOf(item));
        items = next.items;
        for (const key of [...pickedItems]) if (!items.some((item) => keyOf(item) === key)) pickedItems.delete(key);
        itemsState = next.checked ? 'checked' : 'unchecked';
        changed();
      },
      () => {
        if (at !== reads || atEpoch !== epoch) return;
        itemsState = 'unchecked';
        changed();
      },
    );
  }

  /** Who of the pool bought the offer's paid media: asked of the site for the fans not asked yet, a few at a time. */
  function askStates(): void {
    if (statesTimer !== null) clock.clearTimer(statesTimer);
    statesTimer = clock.setTimer(300, () => {
      statesTimer = null;
      void runStates();
    });
  }

  async function runStates(): Promise<void> {
    const port = batchPort;
    const index = listIndex();
    const ids = paidIds(offerMedia());
    if (port?.outreachStates === undefined || own !== null || index === null || ids.length === 0 || source === null || !conditions.notBought.on || locked !== null) return;
    const pool = poolOf({ fans: fansOf(index), tiers: tiersOf(index), source });
    const missing = pool.filter((fanRef) => ids.some((id) => !bought.has(`${fanRef}|${id}`)) && !asking.has(fanRef));
    if (missing.length === 0) return;
    const atEpoch = epoch;
    for (const fanRef of missing) asking.add(fanRef);
    changed();
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < missing.length) {
        const fanRef = missing[next++] as string;
        const answer = await port.outreachStates?.([fanRef], ids).catch(() => null);
        if (disposed || atEpoch !== epoch) return;
        asking.delete(fanRef);
        if (answer === null || answer === undefined) {
          statesFailed = true;
          continue;
        }
        const states = answer.get(fanRef) ?? [];
        for (const id of ids) bought.set(`${fanRef}|${id}`, states.some((state) => state.id === id && state.state === 'paid'));
        changed();
      }
    };
    await Promise.all(Array.from({ length: Math.min(STATE_READS, missing.length) }, () => worker()));
    if (!disposed && atEpoch === epoch) changed();
  }

  // ── each fan, one shape for both sites ──

  const paced = (): boolean => clock.now() < pacedUntil;
  const ownSending = (): boolean => [...owned.values()].some((send) => send.state === 'sending');

  function pace(): void {
    pacedUntil = clock.now() + OUTREACH_PACE_MS;
    if (paceTimer !== null) clock.clearTimer(paceTimer);
    paceTimer = clock.setTimer(OUTREACH_PACE_MS, () => {
      paceTimer = null;
      changed();
    });
  }

  /** The card's send of the version, as one row says it. */
  function cardFacts(fanRef: string, row: OutreachCardRow): Omit<FanFacts, 'state'> & { readonly state: OutreachFanState | null } {
    const send = row.send;
    const base = { version: row.text, edited: row.edited, editable: row.editable, media: row.media, ownMedia: row.ownMedia, archiveAt: row.archiveAt };
    const clicked = iso(clicks.get(fanRef) ?? null);
    const none = { send: null, warning: null, sentAt: null, clickedAt: null, failedAt: null, code: null };
    if (send === null) return { ...base, ...none, state: null };
    switch (send.s) {
      case 'available':
        return { ...base, ...none, state: 'ready', send: { can: row.can, kind: 'send', paused: row.paused, reason: null } };
      case 'unverified':
        return { ...base, ...none, state: 'ready', send: { can: !row.paused, kind: 'anyway', paused: row.paused, reason: null }, warning: { kind: 'archive' } };
      case 'held-stale':
        return { ...base, ...none, state: 'ready', send: { can: !row.paused, kind: 'anyway', paused: row.paused, reason: null }, warning: { kind: 'stale', at: send.at } };
      case 'held-talking':
        return { ...base, ...none, state: 'ready', send: { can: !row.paused, kind: 'anyway', paused: row.paused, reason: null }, warning: { kind: 'talking', names: send.names, at: send.at } };
      case 'unavailable':
        return { ...base, ...none, state: 'ready', send: { can: false, kind: 'send', paused: row.paused, reason: row.paused ? null : send.reason } };
      case 'queued':
      case 'sending':
        return { ...base, ...none, state: 'sending', clickedAt: clicked };
      case 'accepted':
        return { ...base, ...none, state: 'accepted', clickedAt: clicked };
      case 'sent':
        return { ...base, ...none, state: 'sent', sentAt: send.at, clickedAt: clicked };
      case 'rejected':
        return { ...base, ...none, state: 'failed', code: send.code, failedAt: clicked, send: send.canRetry ? { can: !row.paused, kind: 'retry', paused: row.paused, reason: null } : null };
      case 'uncertain':
        return { ...base, ...none, state: 'uncertain', clickedAt: send.since };
    }
  }

  function factsOf(fanRef: string): FanFacts {
    const handle = handleOf(fanRef);
    const row = batchPort === null ? null : batch.row(handle);
    const none: FanFacts = { state: 'idle', version: null, edited: false, editable: false, send: null, warning: null, sentAt: null, clickedAt: null, failedAt: null, code: null, media: offerMedia(), ownMedia: false, archiveAt: null };
    if (row === null) return none;
    // What went, or may have, stands whatever the queue holds now («Очистить» lets go only of what did not go).
    if (own === null) {
      const card = batchPort?.outreachRow?.(handle) ?? null;
      const went = card?.send?.s;
      if (card !== null && (went === 'queued' || went === 'sending' || went === 'accepted' || went === 'sent' || went === 'uncertain')) {
        const facts = cardFacts(fanRef, card);
        return { ...facts, state: facts.state ?? 'sent' };
      }
    } else {
      const sent = owned.get(fanRef);
      const took = sentTexts.get(fanRef);
      if (sent !== undefined && sent.state !== 'failed' && took !== undefined) {
        const base = { ...none, version: took.text, media: took.media };
        if (sent.state === 'sending') return { ...base, state: 'sending', clickedAt: iso(sent.clickedAt) };
        if (sent.state === 'sent') return { ...base, state: 'sent', sentAt: iso(sent.at), clickedAt: iso(sent.clickedAt) };
        return { ...base, state: 'uncertain', clickedAt: iso(sent.clickedAt) };
      }
    }
    switch (row.state) {
      case null:
        // A fan taken back from the queue by «Остановить» waits ticked: «не дописана».
        return locked !== null && row.picked ? { ...none, state: 'stopped' } : none;
      case 'queued':
        return { ...none, state: 'queued' };
      case 'generating':
        return { ...none, state: 'writing' };
      case 'failed':
        return { ...none, state: 'unwritten', code: row.failure?.code ?? null };
      case 'ready':
      case 'sent':
        break;
    }
    if (own === null) {
      const card = batchPort?.outreachRow?.(handle) ?? null;
      if (card !== null) {
        const facts = cardFacts(fanRef, card);
        return { ...facts, state: facts.state ?? (row.state === 'sent' ? 'sent' : 'ready') };
      }
      return { ...none, state: row.state === 'sent' ? 'sent' : 'ready', version: row.text };
    }
    // The site's own send (Fansly): the version is the batch's (or the person's words), the send this controller's.
    const words = edits.get(fanRef) ?? null;
    const version = words ?? row.text;
    const media = offerMedia();
    const sent = owned.get(fanRef);
    const base = { ...none, version, edited: words !== null, media };
    const empty = version === null || version.trim().length === 0;
    // Another fan's send on its way rests the buttons as the pace does: they come back by themselves.
    const resting = paced() || ownSending();
    if (sent === undefined) {
      return { ...base, state: 'ready', editable: true, send: { can: !resting && !empty, kind: 'send', paused: resting && !empty, reason: empty ? msg('outreach.reason.empty') : null } };
    }
    switch (sent.state) {
      case 'sending':
        return { ...base, state: 'sending', clickedAt: iso(sent.clickedAt) };
      case 'sent':
        return { ...base, state: 'sent', sentAt: iso(sent.at), clickedAt: iso(sent.clickedAt) };
      case 'uncertain':
        return { ...base, state: 'uncertain', clickedAt: iso(sent.clickedAt) };
      case 'failed':
        return { ...base, state: 'failed', editable: true, code: sent.code, failedAt: iso(sent.at), send: { can: !resting && !empty, kind: 'retry', paused: resting && !empty, reason: empty ? msg('outreach.reason.empty') : null } };
    }
  }

  /** Waits for the person's click, or for Fix: what «К отправке» shows. */
  const TO_SEND: readonly OutreachFanState[] = ['idle', 'queued', 'writing', 'stopped', 'unwritten', 'ready', 'failed'];
  const WENT: readonly OutreachFanState[] = ['sent', 'uncertain'];
  /** Still moving by itself: Fix writes, or a send is on its way. */
  const MOVING: readonly OutreachFanState[] = ['queued', 'writing', 'sending', 'accepted'];

  /** A click on «Отправить» can send this version now (or in the half second of the pace). */
  const clickable = (facts: Pick<FanFacts, 'state' | 'send'>): boolean => (facts.state === 'ready' || facts.state === 'failed') && facts.send !== null && (facts.send.can || facts.send.paused);

  // ── view models ──

  function namesOf(fanRefs: readonly string[], index: BoardIndex): OutreachNamesVM {
    const names = fanRefs.map((fanRef) => index.byFan.get(fanRef)?.name ?? fanRef);
    return { names: names.slice(0, NAMES_SHOWN), more: Math.max(0, names.length - NAMES_SHOWN) };
  }

  function conditionNote(id: keyof OutreachConditions, audienceNow: Audience, index: BoardIndex, ids: readonly string[]): OutreachConditionNoteVM | null {
    if (id === 'notBought') {
      if (ids.length === 0) return null;
      if (statesFailed) return { kind: 'unknown' };
      const fans = audienceNow.pool.filter((fanRef) => audienceNow.aside.get(fanRef)?.some((reason) => reason.kind === 'bought') === true || (!conditions.notBought.on && ids.some((mediaId) => bought.get(`${fanRef}|${mediaId}`) === true)));
      if (fans.length > 0) return { kind: 'bought', fans: namesOf(fans, index) };
      return audienceNow.pool.some((fanRef) => asking.has(fanRef) || ids.some((mediaId) => !bought.has(`${fanRef}|${mediaId}`))) ? { kind: 'checking' } : { kind: 'none-bought' };
    }
    if (id === 'noWaiting') {
      const fans = audienceNow.pool.filter((fanRef) => index.byFan.get(fanRef)?.waiting === true && audienceNow.aside.get(fanRef)?.some((reason) => reason.kind === 'bought') !== true);
      return fans.length > 0 ? { kind: 'waiting', fans: namesOf(fans, index) } : { kind: 'none-waiting' };
    }
    return null;
  }

  /** «Не купил это видео» exists only with paid media of the vault and a site that says who bought them. */
  const canTellBought = (media: OutreachMediaVM | null): boolean => own === null && batchPort?.outreachStates !== undefined && paidIds(media).length > 0;

  function rowOf(fanRef: string, index: BoardIndex, selected: string | null, ticked: boolean, aside: readonly OutreachAsideVM[] | undefined): OutreachRowVM {
    const row = index.byFan.get(fanRef);
    const facts = factsOf(fanRef);
    const outcome = outcomes.get(fanRef);
    return {
      handle: handleOf(fanRef),
      name: row?.name ?? fanRef,
      username: row?.username ?? null,
      tier: tierOf(index, fanRef),
      lifetime: row?.lifetime ?? null,
      selected: fanRef === selected,
      ticked,
      waitingSince: row?.waiting === true ? row.fanWroteAt : null,
      weWroteAt: row?.weWroteAt ?? null,
      history: row !== undefined && (row.lastMessage !== null || row.weWroteAt !== null || row.fanWroteAt !== null),
      state: facts.state,
      version: facts.version,
      edited: facts.edited,
      stale: facts.version !== null && (facts.state === 'ready' || facts.state === 'failed') && (versions.get(fanRef) ?? textRevision) < textRevision,
      ownMedia: facts.ownMedia,
      send: facts.send,
      warning: facts.warning,
      sentAt: facts.sentAt,
      clickedAt: facts.clickedAt,
      code: facts.code,
      bought: outcome?.bought ?? null,
      replied: outcome?.replied ?? null,
      ...(aside === undefined ? {} : { aside }),
    };
  }

  function tierOf(index: BoardIndex, fanRef: string): OutreachRowVM['tier'] {
    const shelf = index.shelves.find((item) => item.id !== OUTSIDE_SHELF_ID && item.rows.some((row) => row.fanRef === fanRef));
    return shelf === undefined ? null : shelf.range;
  }

  const matches = (index: BoardIndex, fanRef: string): boolean => {
    const needle = normalizeSearch(applied).replace(/^@/, '');
    if (needle === '') return true;
    return index.byFan.get(fanRef)?.haystack.includes(needle) ?? false;
  };

  function viewOf(): VmView {
    const ctx = context.current();
    if (ctx.phase === 'loading') return loadingView(null);
    if (ctx.phase === 'blocked') return failureView(ctx.blocker ?? { code: 'CG-UNKNOWN' }, i18n, RETRY);
    if (!pageFlag(ctx, 'spenders')) return failureView(flagFailure(ctx, 'spenders'), i18n, RETRY);
    if (ctx.bootstrap?.capabilities.includes(OUTREACH_FIX_CAPABILITY) !== true) return { s: 'forbidden', error: localError('CG-FEATURE-DISABLED', i18n), remedy: null };
    const list = board.list();
    if (list.index === null) return list.error !== null ? failureView(list.error, i18n, RETRY) : loadingView(list.since);
    if (list.index.loaded === 0) return { s: 'empty', why: msg('outreach.empty') };
    return list.error !== null ? dataView([{ kind: 'source-failed', source: 'board', code: list.error.code }]) : list.loading ? dataView([{ kind: 'stale-cache', asOf: list.index.asOf }]) : dataView([]);
  }

  /**
   * Nothing more goes by a click, and something went: every version went, or waits where this window cannot send it
   * (the open chat, a fan who takes no messages, a version not written) — nothing is written or on its way meanwhile.
   */
  function settled(members: readonly string[], facts: ReadonlyMap<string, Pick<FanFacts, 'state' | 'send'>>): boolean {
    if (locked === null || members.length === 0) return false;
    let went = false;
    for (const fanRef of members) {
      const fact = facts.get(fanRef);
      if (fact === undefined) return false;
      if (WENT.includes(fact.state)) went = true;
      else if (MOVING.includes(fact.state) || clickable(fact)) return false;
    }
    return went;
  }

  function build(): OutreachWindowVM {
    const ctx = context.current();
    const index = listIndex();
    const view = viewOf();
    const selected = selectedFan();
    const now = audience();
    const media = offerMedia();
    const ids = paidIds(media);
    const persona = ctx.persona?.label ?? null;
    const empty: OutreachWindowVM['batch'] = { picked: 0, max: 60, queued: 0, generating: 0, ready: 0, sent: 0, failed: 0, reason: null };
    const picker = own === null ? (batchPort?.outreachPicker?.() ?? null) : null;
    const base = {
      view,
      pageName: ctx.page?.title ?? null,
      creator: ctx.account?.username ?? null,
      persona,
      stamp: stamp(index?.asOf ?? index?.fetchedAt ?? null, index?.coverage ?? 'unknown'),
      text,
      maxChars: OUTREACH_TEXT_MAX,
      textChangedAt: iso(textChangedAt),
      media,
      canPickMedia: own !== null || cardMedia,
      tab,
      query: typed,
      pane,
      sheet: own !== null ? (postsOpen ? ('posts' as const) : null) : picker !== null ? ('vault' as const) : null,
      picker,
      posts: own === null ? null : { state: itemsState, items: items.map((item): OutreachPostVM => ({ ...item, picked: pickedItems.has(keyOf(item)) })) },
    };
    if (index === null || now === null) {
      return {
        ...base,
        chip: null,
        audience: { source: 'tiers', picked: 0, tiers: [], conditions: [], count: 0, spent: null, locked: false },
        tabs: { todo: 0, all: 0 },
        rows: [],
        aside: [],
        batch: empty,
        totals: { sent: 0, failed: 0, uncertain: 0, ready: 0, written: 0, stopped: 0, total: 0, boughtMills: null, replied: 0 },
        stale: 0,
        card: null,
        summary: null,
      };
    }

    const states = new Map<string, OutreachFanState>();
    const facts = new Map<string, FanFacts>();
    for (const fanRef of [...now.members, ...now.aside.keys()]) {
      const fact = factsOf(fanRef);
      facts.set(fanRef, fact);
      states.set(fanRef, fact.state);
    }
    const ticked = new Set(now.ticked);
    const members = now.members;
    const out = locked === null ? now.ticked : members;
    const todo = out.filter((fanRef) => TO_SEND.includes(states.get(fanRef) ?? 'idle'));
    const shown = tab === 'todo' ? members.filter((fanRef) => todo.includes(fanRef) || todoSnapshot.has(fanRef)) : members;
    const rows = shown.filter((fanRef) => matches(index, fanRef)).map((fanRef) => rowOf(fanRef, index, selected, locked !== null || ticked.has(fanRef), undefined));
    const aside = [...now.aside.entries()].filter(([fanRef]) => matches(index, fanRef)).map(([fanRef, reasons]) => rowOf(fanRef, index, selected, false, reasons));

    const count = (state: OutreachFanState): number => out.filter((fanRef) => states.get(fanRef) === state).length;
    const boughtFans = out.filter((fanRef) => (outcomes.get(fanRef)?.bought ?? null) !== null);
    const boughtMills = boughtFans.reduce<number | null>((sum, fanRef) => {
      const mills = outcomes.get(fanRef)?.bought?.mills ?? null;
      return mills === null || sum === null ? sum : sum + mills;
    }, boughtFans.length === 0 ? null : 0);
    const totals = {
      sent: count('sent'),
      failed: count('failed'),
      uncertain: count('uncertain'),
      ready: count('ready'),
      written: out.filter((fanRef) => ['ready', 'sending', 'accepted', 'sent', 'failed', 'uncertain'].includes(states.get(fanRef) ?? 'idle')).length,
      stopped: count('stopped'),
      total: out.length,
      boughtMills: boughtMills === 0 ? null : boughtMills,
      replied: out.filter((fanRef) => (outcomes.get(fanRef)?.replied ?? null) !== null).length,
    };
    const stale = out.filter((fanRef) => {
      const state = states.get(fanRef);
      return (state === 'ready' || state === 'failed') && (versions.get(fanRef) ?? textRevision) < textRevision;
    }).length;

    const spent = out.reduce<number | null>((sum, fanRef) => {
      const lifetime = index.byFan.get(fanRef)?.lifetime ?? null;
      return sum === null || lifetime === null ? null : sum + lifetime;
    }, 0);
    const audienceVm = {
      source: source?.kind ?? 'tiers',
      picked: source?.kind === 'picked' ? source.fans.length : 0,
      tiers: index.shelves
        .filter((shelf) => shelf.id !== OUTSIDE_SHELF_ID && shelf.rows.length > 0)
        .map((shelf) => ({ id: shelf.id, range: shelf.range, fans: shelf.rows.length, on: source?.kind === 'tiers' && source.on.has(shelf.id) })),
      conditions: (['spent', 'active', 'notBought', 'noWaiting'] as const)
        .filter((id) => id !== 'notBought' || canTellBought(media))
        .map((id): OutreachConditionVM => ({ id, on: conditions[id].on, ...(id === 'spent' ? { amount: amountTyped } : {}), note: conditionNote(id, now, index, ids) })),
      count: out.length,
      spent,
      locked: locked !== null,
    };

    const summary = totals.sent + totals.uncertain > 0 && (pane === 'summary' || settled(members, facts)) ? summaryOf(index, members, now, facts, media) : null;
    const card = selected === null ? null : cardOf(selected, index, facts.get(selected) ?? factsOf(selected), now, members, facts);
    const chip: OutreachChipVM | null = minimized ? { media, sent: totals.sent, total: totals.total, ready: totals.ready, boughtMills: totals.boughtMills } : null;
    const reason = !pageFlag(ctx, 'preview') ? flagReasonVm(pageFlagOf(ctx, 'preview')).text : text.trim().length === 0 ? msg('outreach.needText') : (media?.problem ?? null) !== null ? msg('outreach.reason.price') : null;
    const counts = batch.vm(reason);
    return {
      ...base,
      chip,
      audience: audienceVm,
      tabs: { todo: todo.length, all: out.length },
      rows,
      aside,
      // Before the versions «Выбрано N» is the ticked fans; after, the fans «Остановить» took back from the queue.
      batch: batchPort === null ? empty : { ...counts, picked: locked === null ? now.ticked.length : counts.picked },
      totals,
      stale,
      card,
      summary,
    };
  }

  function cardOf(fanRef: string, index: BoardIndex, facts: FanFacts, now: Audience, members: readonly string[], all: ReadonlyMap<string, FanFacts>): OutreachCardVM {
    const row = index.byFan.get(fanRef);
    const outcome = outcomes.get(fanRef);
    const aside = now.aside.get(fanRef);
    const at = members.indexOf(fanRef);
    let next: OutreachCardVM['next'] = null;
    // The next version a click can send now, else the next Fix is still writing; one held where this window cannot
    // send it (the open chat, a fan who takes no messages) waits in the list and in «Итог рассылки».
    for (const wanted of [clickable, (other: FanFacts): boolean => other.state === 'writing' || other.state === 'queued']) {
      for (let step = 1; step <= members.length && next === null; step += 1) {
        const other = members[(Math.max(at, 0) + step) % members.length];
        const fact = other === undefined ? undefined : all.get(other);
        if (other !== undefined && other !== fanRef && fact !== undefined && wanted(fact)) next = { handle: handleOf(other), name: index.byFan.get(other)?.name ?? other };
      }
    }
    const writing = facts.state === 'queued' || facts.state === 'writing';
    return {
      handle: handleOf(fanRef),
      name: row?.name ?? fanRef,
      state: facts.state,
      version: facts.version,
      edited: facts.edited,
      editable: facts.editable,
      rewrite: batchPort !== null && !writing && (facts.state === 'ready' || facts.state === 'failed' || facts.state === 'unwritten' || facts.state === 'stopped') && text.trim().length > 0,
      media: facts.media,
      ownMedia: facts.ownMedia,
      canPickMedia: own === null && cardMedia,
      send: facts.send,
      warning: facts.warning,
      archiveAt: facts.archiveAt,
      sentAt: facts.sentAt,
      clickedAt: facts.clickedAt,
      failedAt: facts.failedAt,
      code: facts.code,
      bought: outcome?.bought ?? null,
      replied: outcome?.replied ?? null,
      next,
      ...(aside === undefined ? {} : { aside }),
    };
  }

  function summaryOf(index: BoardIndex, members: readonly string[], now: Audience, facts: ReadonlyMap<string, FanFacts>, media: OutreachMediaVM | null): OutreachSummaryVM {
    const fan = (fanRef: string, at: IsoTimestamp | null): OutreachSummaryFanVM => ({ handle: handleOf(fanRef), name: index.byFan.get(fanRef)?.name ?? fanRef, at });
    const left = members.flatMap((fanRef): OutreachSummaryLeftVM[] => {
      const fact = facts.get(fanRef);
      if (fact === undefined || WENT.includes(fact.state)) return [];
      const reason = fact.send !== null && !fact.send.can && !fact.send.paused ? fact.send.reason : null;
      return [{ ...fan(fanRef, null), state: fact.state, reason }];
    });
    const sentFans = members.filter((fanRef) => facts.get(fanRef)?.state === 'sent');
    const uncertain = members.filter((fanRef) => facts.get(fanRef)?.state === 'uncertain');
    const times = members
      .map((fanRef) => timeOf(facts.get(fanRef)?.sentAt ?? null) ?? timeOf(facts.get(fanRef)?.clickedAt ?? null))
      .filter((ms): ms is number => ms !== null)
      .sort((a, b) => a - b);
    // Purchases are what the outreach did when it sold something the site can tell of; else the answers are.
    const paid = canTellBought(media) || sentFans.some((fanRef) => (outcomes.get(fanRef)?.paidIds.length ?? 0) > 0);
    const byTime = (a: string, b: string): number => (timeOf(facts.get(a)?.sentAt ?? null) ?? 0) - (timeOf(facts.get(b)?.sentAt ?? null) ?? 0);
    let boughtVm: OutreachSummaryVM['bought'] = null;
    let repliedVm: OutreachSummaryVM['replied'] = null;
    let quiet: string[];
    if (paid) {
      const buyers = sentFans.filter((fanRef) => (outcomes.get(fanRef)?.bought ?? null) !== null).sort((a, b) => (timeOf(outcomes.get(a)?.bought?.at ?? null) ?? 0) - (timeOf(outcomes.get(b)?.bought?.at ?? null) ?? 0));
      boughtVm = {
        mills: buyers.reduce((sum, fanRef) => sum + (outcomes.get(fanRef)?.bought?.mills ?? 0), 0),
        fans: buyers.map((fanRef) => ({ ...fan(fanRef, facts.get(fanRef)?.sentAt ?? null), mills: outcomes.get(fanRef)?.bought?.mills ?? null, boughtAt: outcomes.get(fanRef)?.bought?.at ?? null })),
      };
      quiet = sentFans.filter((fanRef) => (outcomes.get(fanRef)?.bought ?? null) === null).sort(byTime);
    } else {
      const answered = members.filter((fanRef) => (outcomes.get(fanRef)?.replied ?? null) !== null).sort((a, b) => (timeOf(outcomes.get(a)?.replied?.at ?? null) ?? 0) - (timeOf(outcomes.get(b)?.replied?.at ?? null) ?? 0));
      repliedVm = answered.map((fanRef) => {
        const replied = outcomes.get(fanRef)?.replied as NonNullable<Outcome['replied']>;
        return { ...fan(fanRef, facts.get(fanRef)?.sentAt ?? null), text: replied.text, repliedAt: replied.at };
      });
      quiet = sentFans.filter((fanRef) => (outcomes.get(fanRef)?.replied ?? null) === null).sort(byTime);
    }
    return {
      from: iso(times[0] ?? null),
      to: iso(times[times.length - 1] ?? null),
      sent: sentFans.length,
      total: members.length,
      check: uncertain.map((fanRef) => fan(fanRef, facts.get(fanRef)?.clickedAt ?? null)),
      bought: boughtVm,
      replied: repliedVm,
      quiet: quiet.map((fanRef) => fan(fanRef, facts.get(fanRef)?.sentAt ?? null)),
      left,
      skipped: [...now.aside.entries()].flatMap(([fanRef, reasons]) => (reasons[0] === undefined ? [] : [{ name: index.byFan.get(fanRef)?.name ?? fanRef, reason: reasons[0] }])),
    };
  }

  const cell = new ViewCell(build);

  /** The view follows; `light` — only the text or the search moved: no fan's send or outcome did. */
  function changed(light = false): void {
    if (disposed) return;
    if (!light) {
      followEnd();
      scheduleOutcomes();
    }
    cell.invalidate();
    if (!light) for (const listener of [...directoryListeners]) listener();
  }

  /** Once nothing more goes by a click the pane under the cards is the end, once: a card open stays until it closes. */
  function followEnd(): void {
    if (endShown || locked === null) return;
    const now = audience();
    if (now === null) return;
    const facts = new Map(now.members.map((fanRef) => [fanRef, factsOf(fanRef)] as const));
    if (!settled(now.members, facts)) return;
    endShown = true;
    pane = 'summary';
  }

  // ── what came of the sends ──

  function noteSent(fanRef: string, sentAt: number, media: OutreachMediaVM | null): void {
    if (outcomes.has(fanRef)) return;
    const priced = media !== null && media.priceCents > 0 && media.items.some((item) => !item.free);
    outcomes.set(fanRef, { sentAt, mills: priced ? media.priceCents * 10 : null, paidIds: priced ? paidIds(media) : [], bought: null, replied: null, checks: 0, timer: null });
  }

  /** Every fan whose version went gets its next check of what they did, until it is known or the checks run out. */
  function scheduleOutcomes(): void {
    if (locked === null) return;
    for (const fanRef of locked) {
      const facts = factsOf(fanRef);
      const sentAt = timeOf(facts.sentAt);
      if (facts.state === 'sent' && sentAt !== null) noteSent(fanRef, sentAt, facts.media);
      const outcome = outcomes.get(fanRef);
      if (outcome === undefined || outcome.timer !== null || done_(outcome) || outcome.checks >= OUTCOME_CHECKS_MS.length) continue;
      const due = outcome.sentAt + (OUTCOME_CHECKS_MS[outcome.checks] ?? 0) - clock.now();
      outcome.timer = clock.setTimer(Math.max(1_000, due), () => {
        outcome.timer = null;
        outcome.checks += 1;
        enqueueOutcome(fanRef);
      });
    }
  }

  /** Purchases say what a paid offer did; answers what a text did. */
  const done_ = (outcome: Outcome): boolean => (outcome.paidIds.length > 0 || outcome.mills !== null ? outcome.bought !== null : outcome.replied !== null);

  function enqueueOutcome(fanRef: string): void {
    if (!outcomeQueue.includes(fanRef)) outcomeQueue.push(fanRef);
    pumpOutcomes();
  }

  function pumpOutcomes(): void {
    while (outcomeReads < OUTCOME_READS && outcomeQueue.length > 0) {
      const fanRef = outcomeQueue.shift() as string;
      outcomeReads += 1;
      void readOutcome(fanRef).finally(() => {
        outcomeReads -= 1;
        pumpOutcomes();
      });
    }
  }

  /** The fan's archive (what they wrote after our send) and, for paid media, the site's vault (whether they bought them). */
  async function readOutcome(fanRef: string): Promise<void> {
    const outcome = outcomes.get(fanRef);
    const id = pageId();
    if (outcome === undefined || id === null || disposed) return;
    const atEpoch = epoch;
    const info = board.info(fanRef);
    const conversation = info?.conversationRef === undefined ? {} : { conversationRef: info.conversationRef };
    const answer = await rpc.request('feed.read', { pageId: id, fanRef, cursor: null, limit: FEED_LIMIT, ...conversation }).catch(() => null);
    if (disposed || atEpoch !== epoch || outcomes.get(fanRef) !== outcome) return;
    if (answer !== null && answer.ok) {
      const after = (at: string | null): boolean => (timeOf(at) ?? 0) > outcome.sentAt - 1_000;
      const items = answer.payload.items;
      const reply = items.filter((item) => item.sender === 'fan' && after(item.at)).sort((a, b) => (timeOf(a.at) ?? 0) - (timeOf(b.at) ?? 0))[0];
      if (reply !== undefined && outcome.replied === null && reply.at !== null) outcome.replied = { at: reply.at, text: reply.text.trim().length === 0 ? null : reply.text };
    }
    if (outcome.bought === null && outcome.paidIds.length > 0 && batchPort?.outreachStates !== undefined) {
      const states = await batchPort.outreachStates([fanRef], outcome.paidIds).catch(() => null);
      if (disposed || atEpoch !== epoch || outcomes.get(fanRef) !== outcome) return;
      if (states?.get(fanRef)?.some((state) => state.state === 'paid' && outcome.paidIds.includes(state.id)) === true) outcome.bought = { mills: outcome.mills, at: null };
    }
    changed();
  }

  // ── the directory of the preview from `outreach` ──

  const directoryListeners = new Set<() => void>();
  const directory: PreviewDirectory = {
    canResolve: true,
    async prepare(handle) {
      const fanRef = fanOf(handle);
      if (fanRef !== null) await board.prepare?.(fanRef);
    },
    resolve(handle) {
      const fanRef = fanOf(handle);
      const id = pageId();
      if (fanRef === null || id === null) return null;
      const info = board.info(fanRef);
      return info === null ? null : { ...info, handle, source: 'outreach' };
    },
    neighbours(handle) {
      const fanRef = fanOf(handle);
      const now = audience();
      if (fanRef === null || now === null) return { previous: null, next: null };
      const order = [...now.members, ...now.aside.keys()];
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

  function open(fromSpenders: boolean): ActionReceipt {
    if (fromSpenders || source === null) seedSource(fromSpenders);
    minimized = false;
    const card = lastCard;
    surfaces.setList('outreach', true);
    surfaces.setOutreachChip(false);
    // Where it was: the card open when the window closed, while its fan is still the outreach's.
    const fanRef = card === null ? null : fanOf(card);
    const now = audience();
    if (card !== null && fanRef !== null && now !== null && (now.members.includes(fanRef) || now.aside.has(fanRef))) surfaces.setPreview('outreach', card);
    if (own !== null && items.length === 0 && itemsState !== 'reading') readCopied();
    void board.load({ recent: conditions.active.on }).then(() => {
      if (source === null) seedSource(false);
      changed();
    });
    changed();
    return done('SetOutreach', 'opened');
  }

  /** «Написать N версий», «Переписать N», «Дописать N»: who waits for a version joins the queue — one click for all of them. */
  function write(type: UiAction['type']): ActionReceipt {
    const now = audience();
    if (now === null || batchPort === null) return refused(type, localError('CG-DATA-NOT-READY', i18n));
    if (text.trim().length === 0) return refused(type, localError('CG-SEND-PART', i18n));
    if ((offerMedia()?.problem ?? null) !== null) return refused(type, localError('CG-SEND-MEDIA', i18n));
    let fans: string[];
    if (locked === null) {
      if (now.ticked.length === 0) return done(type, 'noop');
      locked = [...now.ticked];
      fans = locked;
    } else {
      fans = locked.filter((fanRef) => {
        const facts = factsOf(fanRef);
        return facts.state === 'stopped' || facts.state === 'unwritten' || facts.state === 'idle' || ((facts.state === 'ready' || facts.state === 'failed') && (versions.get(fanRef) ?? textRevision) < textRevision);
      });
    }
    if (fans.length === 0) return done(type, 'noop');
    for (const fanRef of fans) if (owned.get(fanRef)?.state === 'failed') owned.delete(fanRef);
    batch.queue(fans.map(handleOf));
    // The first version written opens its card, as «Новые» opens on the first draft.
    changed();
    return done(type, 'started');
  }

  /** «Ещё раз» of one fan, or «Написать для …» of a fan of the chosen tiers left out after the versions. */
  function rewrite(type: UiAction['type'], fanRef: string): ActionReceipt {
    if (batchPort === null) return refused(type, localError('CG-DATA-NOT-READY', i18n));
    if (text.trim().length === 0) return refused(type, localError('CG-SEND-PART', i18n));
    const facts = factsOf(fanRef);
    if (facts.state === 'sending' || facts.state === 'accepted' || facts.state === 'sent' || facts.state === 'uncertain' || facts.state === 'queued' || facts.state === 'writing') return refused(type, localError('CG-SEND-BUSY', i18n));
    // Before the versions they are written for everyone at once («Написать N версий»), never one by one.
    if (locked === null) return refused(type, localError('CG-SEND-PART', i18n));
    if (!locked.includes(fanRef)) {
      const order = audience()?.pool ?? [];
      locked = [...locked, fanRef].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      unticked.delete(fanRef);
    }
    owned.delete(fanRef);
    batch.queue([handleOf(fanRef)]);
    changed();
    return done(type, 'started');
  }

  /** «Отправить» of one fan: the version with its media, one click — one message, one attempt. */
  async function send(type: UiAction['type'], fanRef: string, anyway: boolean): Promise<ActionReceipt> {
    const facts = factsOf(fanRef);
    if (facts.state !== 'ready' && facts.state !== 'failed') return refused(type, localError(facts.state === 'sending' || facts.state === 'accepted' ? 'CG-SEND-BUSY' : 'CG-SEND-PART', i18n));
    if (facts.send === null || !facts.send.can) return refused(type, localError(facts.send?.paused === true ? 'CG-SEND-BUSY' : 'CG-SEND-PART', i18n));
    const handle = handleOf(fanRef);
    clicks.set(fanRef, clock.now());
    if (own === null) {
      const port = batchPort;
      if (port?.outreachSend === undefined) return refused(type, localError('CG-FEATURE-DISABLED', i18n));
      const receipt = await port.outreachSend(type, handle, anyway || facts.send.kind === 'anyway');
      changed();
      return receipt;
    }
    return sendOwn(type, fanRef, facts);
  }

  /** The site's own send (Fansly), as the old Spenders bar sent it: the click's token, the fan's chat, one request. */
  async function sendOwn(type: UiAction['type'], fanRef: string, facts: FanFacts): Promise<ActionReceipt> {
    const binding = context.current().binding;
    const channel = own;
    if (binding === null || channel === null) return refused(type, localError('CG-BINDING-MISSING', i18n));
    if (paced() || ownSending()) return refused(type, localError('CG-SEND-BUSY', i18n));
    const body = (facts.version ?? '').trim();
    if (body.length === 0) return refused(type, localError('CG-SEND-PART', i18n));
    const attachments = pickedPosts();
    const sent: OwnSend = { state: 'sending', code: null, clickedAt: clock.now(), at: null };
    owned.set(fanRef, sent);
    sentTexts.set(fanRef, { text: body, media: offerMedia() });
    pace();
    changed();
    const atEpoch = epoch;
    const end = (state: OwnSend['state'], code: string | null): ActionReceipt => {
      if (atEpoch === epoch && owned.get(fanRef) === sent) {
        sent.state = state;
        sent.code = code;
        sent.at = clock.now();
        if (state === 'sent') noteSent(fanRef, sent.at, offerMedia());
        changed();
      }
      return state === 'sent' ? done(type) : refused(type, localError(state === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-SEND-REJECTED', i18n, code ?? undefined));
    };
    // The click's token first: it is the person's consent for this one send.
    const cause = await issueCause(rpc, 'send', 'preview');
    if (!cause.ok) return end('failed', cause.code);
    const groupId = await board.group(fanRef).catch(() => null);
    if (groupId === null) return end('failed', 'CG-HOST-CHAT-NOT-FOUND');
    const answer = await channel
      .send({ hostAccountId: binding.platformAccountId, fanRef, groupId, text: body, attachments, cause: cause.cause, composedWith: facts.edited ? 'hand' : 'fix' })
      .catch((): OutreachAnswer => ({ ok: false, code: 'CG-SEND-UNCERTAIN' }));
    if (answer.ok) return end('sent', null);
    return end(answer.code === 'CG-SEND-UNCERTAIN' ? 'uncertain' : 'failed', answer.code);
  }

  function edit(type: UiAction['type'], fanRef: string, words: string | null): ActionReceipt {
    const facts = factsOf(fanRef);
    if (!facts.editable) return refused(type, localError('CG-SEND-PART', i18n));
    if (own === null) {
      const ok = batchPort?.outreachEdit?.(handleOf(fanRef), words) ?? false;
      changed();
      return ok ? done(type) : refused(type, localError('CG-SEND-PART', i18n));
    }
    if (words === null) edits.delete(fanRef);
    else edits.set(fanRef, words.slice(0, OUTREACH_TEXT_MAX));
    changed();
    return done(type);
  }

  /** «Очистить»: the versions that have not gone are let go; what went stays, with its marks. */
  function clear(type: UiAction['type']): ActionReceipt {
    const went = (fanRef: string): boolean => {
      const state = factsOf(fanRef).state;
      return state === 'sent' || state === 'uncertain' || state === 'sending' || state === 'accepted';
    };
    const unsent = (locked ?? []).filter((fanRef) => !went(fanRef));
    batch.drop(locked === null ? batch.picked() : unsent.map(handleOf));
    for (const [fanRef, sent] of [...owned]) if (sent.state === 'failed') owned.delete(fanRef);
    if (locked !== null) {
      const kept = locked.filter(went);
      locked = kept.length === 0 ? null : kept;
      if (locked === null) {
        endShown = false;
        pane = 'offer';
      }
    }
    changed();
    return done(type);
  }

  /** «Новая рассылка»: the window starts over — the text, the media and the conditions stay for the next one. */
  function fresh(type: UiAction['type']): ActionReceipt {
    resetCampaign();
    surfaces.setPreview('outreach', null);
    changed();
    return done(type);
  }

  function resetCampaign(): void {
    batch.reset();
    locked = null;
    owned.clear();
    edits.clear();
    sentTexts.clear();
    clicks.clear();
    lastCard = null;
    versions.clear();
    for (const outcome of outcomes.values()) if (outcome.timer !== null) clock.clearTimer(outcome.timer);
    outcomes.clear();
    outcomeQueue = [];
    unticked.clear();
    todoSnapshot = new Set();
    textRevision = 0;
    textChangedAt = null;
    endShown = false;
    pane = 'offer';
    tab = 'all';
  }

  function setOutreach(action: Extract<UiAction, { type: 'SetOutreach' }>): ActionReceipt {
    const type = action.type;
    if (action.open === true) return open(true);
    if (action.minimized !== undefined) {
      minimized = action.minimized;
      if (minimized) {
        surfaces.setList('outreach', false);
        surfaces.setOutreachChip(true);
      } else return open(false);
    }
    if (action.fresh === true) return fresh(type);
    if (action.refresh === true) {
      void board.load({ force: true, recent: conditions.active.on }).then(() => changed());
      readCopied();
      for (const fanRef of outcomes.keys()) enqueueOutcome(fanRef);
    }
    let light = action.text !== undefined;
    if (action.text !== undefined && action.text !== text) {
      text = action.text.slice(0, OUTREACH_TEXT_MAX);
      if (locked !== null) {
        // The first change after the versions makes them stale: the rows and the foot follow, not only the field.
        if (textRevision === Math.max(0, ...versions.values())) light = false;
        textRevision += 1;
        textChangedAt = clock.now();
      }
    }
    if (action.tier !== undefined && locked === null) {
      const index = listIndex();
      const known = index?.shelves.some((shelf) => shelf.id === action.tier?.id) === true;
      if (known && action.tier !== undefined) {
        const on = new Set(source?.kind === 'tiers' ? source.on : []);
        if (action.tier.on) on.add(action.tier.id);
        else on.delete(action.tier.id);
        source = { kind: 'tiers', on };
      }
    }
    if (action.condition !== undefined && locked === null) {
      const { id } = action.condition;
      if (action.condition.amount !== undefined) {
        amountTyped = action.condition.amount;
        const mills = parseAmount(amountTyped);
        if (mills !== null) conditions = { ...conditions, spent: { ...conditions.spent, minMills: mills } };
      }
      if (action.condition.on !== undefined) {
        conditions = { ...conditions, [id]: { ...conditions[id], on: action.condition.on } };
        if (id === 'active' && action.condition.on) void board.load({ recent: true }).then(() => changed());
        if (id === 'notBought' && action.condition.on) askStates();
      }
    }
    if (action.tick !== undefined) {
      const fanRef = fanOf(action.tick.targetHandle);
      if (fanRef !== null && locked === null) {
        if (action.tick.on) unticked.delete(fanRef);
        else unticked.add(fanRef);
      }
    }
    if (action.tickAll !== undefined && locked === null) {
      const now = audience();
      if (action.tickAll) unticked.clear();
      else for (const fanRef of now?.members ?? []) unticked.add(fanRef);
    }
    if (action.tab !== undefined && action.tab !== tab) {
      tab = action.tab;
      const now = audience();
      todoSnapshot = new Set(tab === 'todo' && now !== null ? (locked ?? now.ticked).filter((fanRef) => TO_SEND.includes(factsOf(fanRef).state)) : []);
    }
    if (action.pane !== undefined) {
      pane = action.pane;
      surfaces.setPreview('outreach', null);
    }
    if (action.sheet !== undefined && own !== null) {
      postsOpen = action.sheet;
      if (postsOpen && itemsState !== 'reading') readCopied();
    }
    if (action.post !== undefined && own !== null) {
      const key = keyOf(action.post);
      if (items.some((item) => keyOf(item) === key)) {
        if (action.post.picked) pickedItems.add(key);
        else pickedItems.delete(key);
      }
    }
    const moved = Object.keys(action).some((key) => key !== 'type' && key !== 'text');
    if (moved && locked === null) askStates();
    changed(light && !moved);
    return done(type);
  }

  function search(query: string, now: boolean): ActionReceipt {
    typed = query;
    if (searchTimer !== null) clock.clearTimer(searchTimer);
    searchTimer = null;
    if (now) applied = typed;
    else
      searchTimer = clock.setTimer(OUTREACH_SEARCH_DEBOUNCE_MS, () => {
        searchTimer = null;
        applied = typed;
        changed(true);
      });
    changed(true);
    return done('Search');
  }

  function dispatch(action: UiAction): Promise<ActionReceipt> | null {
    if (action.type === 'Navigate') {
      const to = action.to;
      if (to.kind === 'surface' && to.surface === 'outreach') {
        if (to.open) return Promise.resolve(open(false));
        surfaces.setList('outreach', false);
        return Promise.resolve(done(action.type));
      }
      if (to.kind !== 'chat') return null;
      const fanRef = fanOf(to.targetHandle);
      return fanRef === null ? null : board.openChat(action.type, fanRef);
    }
    if (action.type === 'SetOutreach') return Promise.resolve(setOutreach(action));
    if (action.type === 'SendOutreach' || action.type === 'RewriteOutreach' || action.type === 'EditOutreach') {
      const fanRef = fanOf(action.targetHandle);
      if (fanRef === null) return null;
      if (action.type === 'SendOutreach') return send(action.type, fanRef, action.anyway === true);
      if (action.type === 'RewriteOutreach') return Promise.resolve(rewrite(action.type, fanRef));
      return Promise.resolve(edit(action.type, fanRef, action.text));
    }
    if (action.type === 'Search') return action.list === 'outreach' ? Promise.resolve(search(action.query, action.now === true)) : null;
    if (action.type === 'ClearOutreachMedia') {
      // The cards' media are the preview's (it answers first where the cards send); the site's own: «Из постов».
      if (own === null) return null;
      pickedItems.clear();
      postsOpen = false;
      changed();
      return Promise.resolve(done(action.type));
    }
    if (action.type === 'ReloadView') {
      if (action.selector.of !== 'outreach') return null;
      return (context.current().phase === 'ready' ? Promise.resolve() : context.refresh()).then(async () => {
        await board.load({ force: true, recent: conditions.active.on });
        return done(action.type);
      });
    }
    if (isBatchAction(action) && action.list === 'outreach') {
      if (action.type === 'GenerateBatch') return Promise.resolve(write(action.type));
      if (action.type === 'ClearBatch') return Promise.resolve(clear(action.type));
      if (action.type === 'StopBatch') return Promise.resolve(batchDispatch(batch, action, (handle) => fanOf(handle) !== null));
      return Promise.resolve(done(action.type, 'noop'));
    }
    return null;
  }

  // ── life ──

  function reset(): void {
    resetCampaign();
    text = '';
    source = null;
    conditions = DEFAULT_CONDITIONS;
    amountTyped = '1,000';
    items = [];
    itemsState = 'checked';
    pickedItems.clear();
    bought.clear();
    asking.clear();
    statesFailed = false;
    minimized = false;
    postsOpen = false;
    typed = '';
    applied = '';
    audienceCache = null;
  }

  const offContext = context.subscribe((state) => {
    if (state.epoch !== epoch) {
      // Another sign-in, hub or account: the outreach of the old one goes with everything it held.
      epoch = state.epoch;
      reset();
      surfaces.setList('outreach', false);
      surfaces.setOutreachChip(false);
    }
    changed();
  });
  const offBoard = board.subscribe(() => {
    if (source === null && surfaces.current().outreach) seedSource(false);
    askStates();
    changed();
  });
  const offSurfaces = surfaces.subscribe((state, previous) => {
    if (state.outreach) lastCard = state.preview.outreach;
    else if (previous.outreach) lastCard = previous.preview.outreach;
    // The window closed by a chat opened from it: it folds into its chip while its outreach goes on.
    if (!state.outreach && previous.outreach && state.outreachChip) minimized = true;
    if (state.outreach && !previous.outreach) minimized = false;
    if (state.outreach !== previous.outreach || state.outreachChip !== previous.outreachChip || state.preview.outreach !== previous.preview.outreach) changed();
  });
  const offLanguage = i18n.subscribe(() => changed());

  return {
    kinds: ['outreach'],
    getSnapshot: () => cell.get(),
    subscribe: (_selector, listener) => cell.subscribe(listener),
    dispatch,
    directory,
    attachBatch(port) {
      offBatch?.();
      batchPort = port;
      // The cards' media of the vault go with the outreach where the cards send (X8) and the site has a vault (X53).
      cardMedia = own === null && port.setOutreach?.(true) === true;
      offBatch = port.onBatch(() => {
        askStates();
        changed();
      });
      changed();
    },
    dispose() {
      disposed = true;
      offBatch?.();
      batch.dispose();
      offContext();
      offBoard();
      offSurfaces();
      offLanguage();
      if (searchTimer !== null) clock.clearTimer(searchTimer);
      if (paceTimer !== null) clock.clearTimer(paceTimer);
      if (statesTimer !== null) clock.clearTimer(statesTimer);
      for (const outcome of outcomes.values()) if (outcome.timer !== null) clock.clearTimer(outcome.timer);
      directoryListeners.clear();
      cell.clear();
    },
  };
}

