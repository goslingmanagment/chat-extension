// «Рассылка» as a window of its own (2026-10-25, the owner's pick of the redesign: the twin of «Новые», one on both
// sites): the view `outreach`. Who it is for comes from the Spenders board (its tiers, sums and who wrote last) through
// «Кому» — the chosen tiers, or the fans ticked in Spenders, minus what a condition leaves out (domain/outreach); each
// fan's version is Fix of the common text written for them (`outreach-fix-v1`), two at a time, by the window's batch
// through the fan's card (the preview from `outreach`); each version goes by one click on that fan's «Отправить» —
// on ChatSpace the card's own send (X8) with the outreach's vault media or the fan's own, on Fansly our background's
// send with the items copied in the model's posts. Nothing goes by itself: no key, no «send all», no retry of an
// unknown outcome; every «Отправить» of the tab rests half a second after a click (#343, #349).
//
// 2026-11-01 (the owner: «чтобы хранились рассылки у нас на сервере», the page's team works them together): where the
// hub keeps outreaches (`outreach-store-v1`) the window's outreach is the hub's — this computer keeps a copy and the save
// the hub has not taken yet; every «Отправить» claims the fan at the hub before the site is asked (one send per fan of
// an outreach, from any tab, computer or colleague), and what a colleague sent, wrote or changed comes into the window
// (domain/outreach/sync.ts). The hub not answering is a warning the person passes, never a block.
//
// What came of a send is read from what the hub already holds — the fan's archive: they wrote back, our priced message
// was bought — and, where the site's vault says it (ChatSpace), whether the fan bought the media; a few times, further
// and further apart, never a chat the person did not open. Once nothing is left to send, the pane on the right says
// what the outreach did.

import { type CgErrorWire } from '@cg/contracts/errors';
import { type FanBadges } from '@cg/contracts/fan-badges';
import { OUTREACH_FIX_CAPABILITY, OUTREACH_STORE_CAPABILITY } from '@cg/contracts/ids';
import { type IsoTimestamp, type MoneyMills } from '@cg/contracts/primitives';
import {
  OUTREACH_STORE_TOUCH_MS,
  OutreachStoreSaveBodySchema,
  OutreachStoreSendBodySchema,
  type OutreachStoreFan,
  type OutreachStoreOutreach,
  type OutreachStoreSaveBody,
  type OutreachStoreSummary,
  type OutreachStoreTouch,
  type SendAttributionComposedWith,
} from '@cg/contracts/hub';
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
  type OutreachSavedVM,
  type OutreachSendVM,
  type OutreachSummaryFanVM,
  type OutreachSummaryLeftVM,
  type OutreachSummaryVM,
  type OutreachTab,
  type OutreachWarningVM,
  type OutreachWindowVM,
  type TalkingMarkVM,
  type TargetHandle,
  type UiAction,
  type VmView,
} from '@cg/contracts/vm';

import {
  DEFAULT_CONDITIONS,
  EMPTY_OUTREACH_STORE,
  OUTREACH_CHIP_BACK_MS,
  adoptPlan,
  audienceOf,
  fanFromHub,
  fromHub,
  inFlightOf,
  mediaWire,
  patchOf,
  reportOf,
  sendRank,
  textKey,
  mergeOutreachStores,
  outreachOwner,
  outreachesOf,
  parseAmount,
  poolOf,
  putOutreach,
  readOutreachStore,
  worthKeeping,
  type Audience,
  type AudienceFan,
  type AdoptPlan,
  type AudienceSource,
  type AudienceTier,
  type AudienceTouch,
  type OutreachConditions,
  type OutreachStore,
  type SavedFan,
  type SavedMedia,
  type SavedOutreach,
  type SavedSend,
} from '../../domain/outreach';
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
import { type OutreachHub } from './hub';

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
/** A change of the outreach is written to this computer at most this often (and once more after the last one). */
export const OUTREACH_SAVE_MS = 700;
/** …and goes to the hub at most this often. */
export const OUTREACH_PUSH_MS = 2_000;
/** The open window reads its outreach from the hub this often: what a colleague sent, wrote or changed comes in. */
export const OUTREACH_POLL_MS = 15_000;
/** …and the page's outreaches and the 3-day touches this often. */
export const OUTREACH_TEAM_MS = 60_000;
/** The hub did not answer: the next try this long after, doubling, at most a minute. */
const OUTREACH_RETRY_MS = [5_000, 10_000, 20_000, 40_000, 60_000] as const;
/** A version the hub keeps that no card shows yet (ChatSpace) is offered to its card again at most this often. */
const ADOPT_RETRY_MS = 30_000;
/** Outreaches of this computer the hub does not have yet, sent there at most per read of the list. */
const UPLOADS_PER_READ = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


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
  /** Fansly: the fan's badges as the board knows them (boards/badges.ts); null — none known. */
  badge?(fanRef: string): FanBadges | null;
  /** Fansly: the window shows these fans — the board asks their badges (an answer comes through `subscribe`). */
  wantBadges?(fanRefs: readonly string[]): void;
  subscribe(listener: () => void): () => void;
}

/**
 * 2026-11-01: the outreaches kept on this computer — one key of storage.local every tab shares (domain/outreach/saved.ts).
 * The tab's early bundle owns the browser API, so the port is made there.
 */
export interface OutreachStorePort {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
}

export interface OutreachControllerDeps {
  /** «Рассылки» kept on this computer; absent — an outreach lives until the tab reloads. */
  readonly store?: OutreachStorePort;
  /** Ids of the kept outreaches; absent — the clock and a random number. */
  readonly ids?: { uuid(): string };
  readonly rpc: TabRpc;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
  readonly board: OutreachBoardPort;
  /** The site sends the versions itself (Fansly); absent — the fan's card sends them (ChatSpace, X8). */
  readonly own?: OutreachOwnChannel;
  /** 1.72.0: «Рассылки» kept by the hub for the page's team (outreach/hub.ts); absent — only on this computer. */
  readonly hub?: OutreachHub;
  /** «В разговоре» marks: the site's own send warns of them, as the cards' send does (ChatSpace). */
  readonly talking?: { mark(key: string): TalkingMarkVM | null; onChange(listener: () => void): () => void };
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
  /** The hub's claim of it; null — no hub keeps outreaches here. */
  readonly attemptId: string | null;
  /** The hub held the claim before the site was asked. */
  claimed: boolean;
  /** The hub has this send as it stands. */
  reported: boolean;
  /** A colleague's send (their login); null — this person's. */
  readonly by: string | null;
  /** The site's id of the message (Fansly answers it). */
  messageId: string | null;
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
/** Media kept from before, as the window shows them (no picture: the vault's links expire). */
const mediaVmOf = (media: SavedMedia | null): OutreachMediaVM | null => (media === null ? null : { items: media.items.map((item) => ({ ...item, thumb: null })), posts: media.posts, priceCents: media.priceCents, problem: null });
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
  /** The common text each fan's version was written from (`textKey`): another than the text's now — stale. */
  const bases = new Map<string, string>();
  /** When each fan's version was written: a message of the fan after it makes it stale too (Fansly). */
  const versionAts = new Map<string, number>();
  /** A colleague's words for a fan's version (their login; the site's own send). */
  const editedBy = new Map<string, string>();
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

  // ── «Рассылки» kept on this computer ──
  const store = deps.store ?? null;
  // An outreach's id is the hub's too: a UUID.
  const newId = (): string => uuid();
  /** The window's outreach among the kept ones; null — not kept yet (nothing worth keeping so far). */
  let currentId: string | null = null;
  let createdAt: number | null = null;
  /** The store as last read or written. */
  let stored: OutreachStore = EMPTY_OUTREACH_STORE;
  /** The first read of the store ended: until then nothing is written over what it holds. */
  let storeRead = store === null;
  /** The owner whose current outreach was looked for after the read (once per owner). */
  let resumedFor: string | null = null;
  let saveTimer: number | null = null;
  /** The window's outreach as last written (without its times): an unchanged one is not written again. */
  let lastSaved = '';
  let writing: Promise<void> = Promise.resolve();
  /** The cards' sends (ChatSpace) kept from before: a card holds no trace of them after a reload. */
  const keptSends = new Map<string, SavedSend>();
  /** Fans' names as kept, for a fan the board no longer lists. */
  const keptNames = new Map<string, string>();

  // ── «Рассылки» on the hub, the page's team's (domain/outreach/sync.ts) ──
  const hub = deps.hub ?? null;
  /** A colleague's outreach (their login); null — the person's own. */
  let author: string | null = null;
  /** The hub has the window's outreach (a save of it was taken). */
  let synced = false;
  /** The hub's copy the window last saw: a save sends what changed since; null — none seen (after a reload). */
  let base: SavedOutreach | null = null;
  /** A save the hub has not taken (kept with the outreach on this computer): sent before anything else of it. */
  let pending: OutreachStoreSaveBody | null = null;
  /** The last save the hub refused as it was: not sent again unchanged. */
  let refusedSave = '';
  let pushTimer: number | null = null;
  let pushing: Promise<void> | null = null;
  /** The hub did not answer: since when; null — it did. */
  let offlineSince: number | null = null;
  let retries = 0;
  /** The hub keeps no outreaches for this sign-in or page (an older hub, the page not granted): this computer does. */
  let hubOff = false;
  let pollTimer: number | null = null;
  /** The page's outreaches on the hub as last read (the team's); null — not read. */
  let team: readonly OutreachStoreSummary[] | null = null;
  let teamAt = 0;
  /** Fans written to in the last 72 hours (an outreach, a fan queue, «Онлайн»): the latest touch each. */
  let touches: ReadonlyMap<string, OutreachStoreTouch> = new Map();
  let touchesAt = 0;
  let touchedCache: { readonly of: unknown; readonly id: string | null; readonly at: number; readonly value: ReadonlyMap<string, AudienceTouch> } | null = null;
  /** Fans whose send of this outreach a colleague's claim holds right now (its ticket runs). */
  let inFlight: ReadonlySet<string> = new Set();
  /** Fans whose claim the hub did not answer: their «Отправить всё равно» sends without one. */
  const hubDown = new Set<string>();
  /** The cards' sends (ChatSpace) the window claimed, until the card says how they ended. */
  const cardClaims = new Map<string, { readonly attemptId: string; readonly claimed: boolean; readonly clickedAt: number; readonly text: string; readonly media: SavedMedia | null; settled: boolean; code: string | null }>();
  /** The cards' sends that ended here, with whether the hub has their end. */
  const cardSent = new Map<string, SavedSend>();
  /** ChatSpace: versions the hub keeps that no card shows yet (and the words for them): each goes into its fan's card. */
  const held = new Map<string, { readonly text: string; readonly basis: string | null; readonly at: number | null; readonly edit: string | null; tried: number }>();
  let adopting = false;
  let adoptTimer: number | null = null;
  const uuid = (): string => {
    const id = deps.ids?.uuid() ?? null;
    if (id !== null && UUID.test(id)) return id;
    const hex = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
  };

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
      bases.set(fanRef, textKey(text));
      versionAts.set(fanRef, clock.now());
      edits.delete(fanRef);
      editedBy.delete(fanRef);
      held.delete(fanRef);
      cardKnown.delete(fanRef);
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
      fans = new Map(index.rows.map((row) => [row.fanRef, { fanRef: row.fanRef, lifetime: row.lifetime, fanWroteAt: row.fanWroteAt, waiting: row.waiting, gone: row.deleted }]));
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
    // An outreach whose «Кому» is not known here (one made where the window kept no such state) is its fans.
    const from: AudienceSource | null = source ?? (locked === null ? null : { kind: 'picked', fans: locked });
    if (index === null || from === null) return null;
    const media = offerMedia();
    const ids = paidIds(media);
    const recent = board.recent();
    const touched = touchedMap();
    const key = [index, source ?? locked, conditions, ids.join(','), bought.size, statesFailed, recent, unticked.size, [...unticked].join(','), locked, Math.floor(clock.now() / 60_000), touched];
    if (audienceCache !== null && audienceCache.key.length === key.length && audienceCache.key.every((part, at) => part === key[at])) return audienceCache.value;
    const fans = fansOf(index);
    const tiers = tiersOf(index);
    const pool = poolOf({ fans, tiers, source: from });
    const value = audienceOf({
      fans,
      tiers,
      source: from,
      conditions,
      bought: boughtMap(pool, ids),
      recent: recent === null ? null : new Set(recent.rows.filter((row) => (row.period ?? 0) > 0).map((row) => row.fanRef)),
      touched,
      unticked,
      locked,
      now: clock.now(),
    });
    audienceCache = { key, value };
    return value;
  }

  /** Fans written to in the last 3 days by another outreach, a fan queue or «Онлайн» (this outreach's own sends aside). */
  function touchedMap(): ReadonlyMap<string, AudienceTouch> {
    const minute = Math.floor(clock.now() / 60_000);
    if (touchedCache !== null && touchedCache.of === touches && touchedCache.id === currentId && touchedCache.at === minute) return touchedCache.value;
    const map = new Map<string, AudienceTouch>();
    for (const touch of touches.values()) {
      if (touch.kind === 'outreach' && touch.outreachId === currentId) continue;
      const at = timeOf(touch.at);
      if (at === null || clock.now() - at > OUTREACH_STORE_TOUCH_MS) continue;
      map.set(touch.fanRef, { at: touch.at, what: touch.kind === 'queue' || touch.kind === 'online' ? touch.kind : 'outreach', by: touch.by === null || touch.by.isMe ? null : touch.by.name });
    }
    touchedCache = { of: touches, id: currentId, at: minute, value: map };
    return map;
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
      case 'available': {
        // The card warns of what it knows (the fan wrote, a colleague talks to him); the window of the hub's word and the
        // 3-day touches.
        const warning = windowWarning(fanRef);
        return { ...base, ...none, state: 'ready', warning, send: { can: row.can, kind: warning === null ? 'send' : 'anyway', paused: row.paused, reason: null } };
      }
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

  /** What the window itself warns of before a send: the hub did not answer its claim, a touch of the last 3 days. */
  function windowWarning(fanRef: string): OutreachWarningVM | null {
    if (hubDown.has(fanRef)) return { kind: 'hub' };
    const touch = touchedMap().get(fanRef);
    return touch === undefined ? null : { kind: 'touched', at: touch.at, what: touch.what, by: touch.by };
  }

  /** The site's own send (Fansly) warns as the cards do: a colleague talks to the fan, the fan wrote after the version. */
  function ownWarning(fanRef: string): OutreachWarningVM | null {
    const id = pageId();
    const mark = id === null ? null : (deps.talking?.mark(`page:${String(id)}:${fanRef}`) ?? null);
    if (mark !== null) return { kind: 'talking', names: mark.names, at: mark.lastSentAt };
    const wrote = timeOf(listIndex()?.byFan.get(fanRef)?.fanWroteAt ?? null);
    const writtenAt = versionAts.get(fanRef);
    if (wrote !== null && writtenAt !== undefined && wrote > writtenAt) return { kind: 'stale', at: iso(wrote) };
    return windowWarning(fanRef);
  }

  /** A colleague's send of the fan (their login); null — the person's, or none. */
  const byOf = (fanRef: string): string | null => (own !== null ? (owned.get(fanRef)?.by ?? null) : (cardSent.get(fanRef)?.by ?? keptSends.get(fanRef)?.by ?? null));

  function factsOf(fanRef: string): FanFacts {
    const facts = factsOfRaw(fanRef);
    // A colleague's claim of this fan runs right now: on its way, never sendable here.
    return inFlight.has(fanRef) && facts.state === 'uncertain' && byOf(fanRef) !== null ? { ...facts, state: 'sending' } : facts;
  }

  function factsOfRaw(fanRef: string): FanFacts {
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
      // A send of the card that ended here, or kept from before the reload, or a colleague's: what went, or may have, stands.
      const ended = cardSent.get(fanRef);
      if (ended !== undefined && ended.state !== 'failed') return { ...none, state: ended.state === 'sent' ? 'sent' : 'uncertain', version: ended.text, media: mediaVmOf(ended.media), sentAt: ended.state === 'sent' ? iso(ended.at) : null, clickedAt: iso(ended.clickedAt) };
      const kept = keptSends.get(fanRef);
      if (kept !== undefined) return { ...none, state: kept.state === 'sent' ? 'sent' : 'uncertain', version: kept.text, media: mediaVmOf(kept.media), sentAt: kept.state === 'sent' ? iso(kept.at) : null, clickedAt: iso(kept.clickedAt) };
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
      const warning = ownWarning(fanRef);
      return { ...base, state: 'ready', editable: true, warning, send: { can: !resting && !empty, kind: warning === null ? 'send' : 'anyway', paused: resting && !empty, reason: empty ? msg('outreach.reason.empty') : null } };
    }
    switch (sent.state) {
      case 'sending':
        return { ...base, state: 'sending', clickedAt: iso(sent.clickedAt) };
      case 'sent':
        return { ...base, state: 'sent', sentAt: iso(sent.at), clickedAt: iso(sent.clickedAt) };
      case 'uncertain':
        return { ...base, state: 'uncertain', clickedAt: iso(sent.clickedAt) };
      case 'failed':
        return { ...base, state: 'failed', editable: true, code: sent.code, failedAt: iso(sent.at), warning: ownWarning(fanRef), send: { can: !resting && !empty, kind: 'retry', paused: resting && !empty, reason: empty ? msg('outreach.reason.empty') : null } };
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
      const fans = audienceNow.pool.filter((fanRef) => index.byFan.get(fanRef)?.waiting === true && audienceNow.aside.get(fanRef)?.some((reason) => reason.kind === 'bought' || reason.kind === 'gone') !== true);
      return fans.length > 0 ? { kind: 'waiting', fans: namesOf(fans, index) } : { kind: 'none-waiting' };
    }
    if (id === 'noGone') {
      const fans = goneOf(audienceNow.pool, index);
      return fans.length > 0 && conditions.noGone.on ? { kind: 'gone', fans: namesOf(fans, index) } : null;
    }
    if (id === 'noTouched') {
      const fans = touchedOf(audienceNow.pool);
      return fans.length > 0 ? { kind: 'touched', fans: namesOf(fans, index) } : null;
    }
    return null;
  }

  /** The fans of the pool written to in the last 3 days by another outreach, a fan queue or «Онлайн». */
  const touchedOf = (pool: readonly string[]): string[] => {
    const touched = touchedMap();
    return pool.filter((fanRef) => touched.has(fanRef));
  };

  /** The fans of the pool whose account the site no longer finds (the board's «удалён»). */
  const goneOf = (pool: readonly string[], index: BoardIndex): string[] => pool.filter((fanRef) => index.byFan.get(fanRef)?.deleted === true);

  /** «Не купил это видео» exists only with paid media of the vault and a site that says who bought them. */
  const canTellBought = (media: OutreachMediaVM | null): boolean => own === null && batchPort?.outreachStates !== undefined && paidIds(media).length > 0;

  function rowOf(fanRef: string, index: BoardIndex, selected: string | null, ticked: boolean, aside: readonly OutreachAsideVM[] | undefined): OutreachRowVM {
    const row = index.byFan.get(fanRef);
    const facts = factsOf(fanRef);
    const outcome = outcomes.get(fanRef);
    return {
      handle: handleOf(fanRef),
      name: row?.name ?? keptNames.get(fanRef) ?? fanRef,
      username: row?.username ?? null,
      ...(row?.deleted === true ? { gone: true as const } : {}),
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
      stale: isStale(fanRef, facts),
      ownMedia: facts.ownMedia,
      send: facts.send,
      warning: facts.warning,
      sentAt: facts.sentAt,
      clickedAt: facts.clickedAt,
      code: facts.code,
      bought: outcome?.bought ?? null,
      replied: outcome?.replied ?? null,
      ...(aside === undefined ? {} : { aside }),
      ...badgeOf(fanRef),
      ...whoOf(fanRef),
    };
  }

  /** The text the window holds now, by its name: a version written from another one is stale. */
  let keyCache: { readonly text: string; readonly key: string } = { text: '', key: textKey('') };
  const keyNow = (): string => {
    if (keyCache.text !== text) keyCache = { text, key: textKey(text) };
    return keyCache.key;
  };
  /** A version that has not gone, written from another common text than the window's now. */
  const isStale = (fanRef: string, facts: Pick<FanFacts, 'version' | 'state'>): boolean => facts.version !== null && (facts.state === 'ready' || facts.state === 'failed') && (bases.get(fanRef) ?? keyNow()) !== keyNow();
  /** Who of the team sent the fan's version, and whose words it is. */
  const whoOf = (fanRef: string): { readonly by?: string; readonly editedBy?: string } => {
    const by = byOf(fanRef);
    const words = editedBy.get(fanRef) ?? null;
    return { ...(by === null ? {} : { by }), ...(words === null ? {} : { editedBy: words }) };
  };

  const badgeOf = (fanRef: string): { readonly badges?: FanBadges } => {
    const known = deps.board.badge?.(fanRef) ?? null;
    return known === null ? {} : { badges: known };
  };

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
        saved: savedList(null),
        sync: syncState(),
        author,
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
    // Fansly: the shown fans' badges, the board's store (a fan asked lately is not asked again).
    deps.board.wantBadges?.([...shown, ...now.aside.keys()]);

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
      const fact = facts.get(fanRef);
      return fact !== undefined && isStale(fanRef, fact);
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
      conditions: (['spent', 'active', 'notBought', 'noWaiting', 'noGone', 'noTouched'] as const)
        .filter((id) => (id !== 'notBought' || canTellBought(media)) && (id !== 'noGone' || goneOf(now.pool, index).length > 0) && (id !== 'noTouched' || touchedOf(now.pool).length > 0))
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
      saved: savedList(totals),
      sync: syncState(),
      author,
    };
  }

  // ── «Рассылки»: the hub's (the page's team's), and the copy on this computer ──

  function ownerOf(): string | null {
    const ctx = context.current();
    const id = ctx.binding?.pageId;
    return ctx.session === null || id === undefined ? null : outreachOwner(ctx.session.hubOrigin, ctx.session.userId, id);
  }

  /** The hub keeps outreaches for this sign-in and page (`outreach-store-v1`), and has not said it does not. */
  const hubOn = (): boolean => hub !== null && !hubOff && pageId() !== null && context.current().bootstrap?.capabilities.includes(OUTREACH_STORE_CAPABILITY) === true;

  /** Where the window's outreach is kept: the hub has it, the hub did not answer, or only this computer keeps them. */
  function syncState(): OutreachWindowVM['sync'] {
    if (!hubOn()) return 'local';
    return offlineSince !== null ? 'offline' : 'hub';
  }

  /** An outreach of the hub's list, as the head's list shows it. */
  const fromSummary = (item: OutreachStoreSummary): OutreachSavedVM => ({
    id: item.outreachId,
    current: false,
    text: item.text.slice(0, 200),
    startedAt: item.createdAt,
    updatedAt: item.updatedAt,
    total: item.fans,
    sent: item.sent,
    replied: item.replied,
    boughtMills: item.bought > 0 ? item.boughtMills : null,
    media: item.withMedia,
    author: item.author.isMe ? null : item.author.name,
    uncertain: item.uncertain + item.sending,
  });

  /** The list in the head: the page's outreaches (the hub's, the team's, and this computer's), newest change first. */
  function savedList(totals: OutreachWindowVM['totals'] | null): OutreachSavedVM[] {
    const owner = ownerOf();
    if (owner === null) return [];
    const at = (ms: number): IsoTimestamp => new Date(ms).toISOString();
    const entry = (outreach: SavedOutreach): OutreachSavedVM => {
      let sent = 0;
      let uncertain = 0;
      let replied = 0;
      let boughtMills: number | null = null;
      for (const fan of outreach.fans) {
        if (fan.send?.state === 'sent') sent += 1;
        if (fan.send?.state === 'uncertain') uncertain += 1;
        if ((fan.outcome?.replied ?? null) !== null) replied += 1;
        const mills = fan.outcome?.bought?.mills ?? null;
        if (mills !== null) boughtMills = (boughtMills ?? 0) + mills;
      }
      return { id: outreach.id, current: false, text: outreach.text.slice(0, 200), startedAt: at(outreach.createdAt), updatedAt: at(outreach.updatedAt), total: outreach.locked?.length ?? 0, sent, replied, boughtMills, media: outreach.media !== null || outreach.picked.length > 0, author: outreach.author, uncertain };
    };
    const byId = new Map<string, OutreachSavedVM>();
    for (const outreach of outreachesOf(stored, owner)) byId.set(outreach.id, entry(outreach));
    // The hub's word for each outreach it keeps (a colleague's sends are there only), unless this computer's copy is newer.
    for (const item of team ?? []) {
      const mine = byId.get(item.outreachId);
      if (mine !== undefined && (timeOf(mine.updatedAt) ?? 0) > (timeOf(item.updatedAt) ?? 0)) continue;
      byId.set(item.outreachId, fromSummary(item));
    }
    const list = [...byId.values()].sort((a, b) => (timeOf(b.updatedAt) ?? 0) - (timeOf(a.updatedAt) ?? 0));
    const keeping = worthKeeping({ text, locked });
    if (!keeping) return list.filter((item) => item.id !== currentId);
    const now = clock.now();
    const mine: OutreachSavedVM = {
      id: currentId ?? '',
      current: true,
      text: text.slice(0, 200),
      startedAt: at(createdAt ?? now),
      updatedAt: list.find((item) => item.id === currentId)?.updatedAt ?? at(now),
      total: locked === null ? 0 : (totals?.total ?? locked.length),
      sent: totals?.sent ?? 0,
      replied: totals?.replied ?? 0,
      boughtMills: totals?.boughtMills ?? null,
      media: offerMedia() !== null,
      author,
      uncertain: totals?.uncertain ?? 0,
    };
    return [mine, ...list.filter((item) => item.id !== currentId)];
  }

  function mediaOfVm(media: OutreachMediaVM | null): SavedMedia | null {
    return media === null ? null : { items: media.items.map(({ id, type, duration, free }) => ({ id, type, duration, free })), posts: media.posts, priceCents: media.priceCents };
  }

  /** ChatSpace: the version and the words a fan's card showed last (a card's result runs out in 30 minutes; the hub keeps it). */
  const cardKnown = new Map<string, { readonly fix: string; readonly edit: string | null }>();

  /** The window's outreach as it is now, to keep (`pending` aside: the save holds it). */
  function snapshot(owner: string): SavedOutreach {
    const now = clock.now();
    const index = listIndex();
    const fans: SavedFan[] = [];
    for (const fanRef of locked ?? []) {
      const facts = factsOfRaw(fanRef);
      const handle = handleOf(fanRef);
      const row = batch.row(handle);
      const fix = row.state === 'ready' || row.state === 'sent' ? row.text : null;
      let send: SavedSend | null = null;
      let version: string | null;
      let edit: string | null;
      if (own !== null) {
        const sent = owned.get(fanRef);
        const took = sentTexts.get(fanRef);
        // One on its way when the tab goes is unknown: it is never sent again from what was kept.
        if (sent !== undefined) {
          send = {
            state: sent.state === 'sending' ? 'uncertain' : sent.state,
            code: sent.code,
            clickedAt: sent.clickedAt,
            at: sent.at,
            text: took?.text ?? null,
            media: mediaOfVm(took?.media ?? null),
            attemptId: sent.attemptId,
            claimed: sent.claimed,
            reported: sent.state === 'sending' ? false : sent.reported,
            by: sent.by,
            messageId: sent.messageId,
          };
        }
        version = fix;
        edit = edits.get(fanRef) ?? null;
      } else {
        const card = batchPort?.outreachRow?.(handle) ?? null;
        if (card !== null) cardKnown.set(fanRef, { fix: card.fix, edit: card.edited ? card.text : null });
        const known = cardKnown.get(fanRef);
        const hold = held.get(fanRef);
        const claim = cardClaims.get(fanRef);
        const ended = cardSent.get(fanRef);
        const kept = keptSends.get(fanRef);
        if (ended !== undefined) send = ended;
        else if (claim !== undefined) send = { state: 'uncertain', code: null, clickedAt: claim.clickedAt, at: null, text: claim.text, media: claim.media, attemptId: claim.attemptId, claimed: claim.claimed, reported: false, by: null, messageId: null };
        else if (kept !== undefined) send = kept;
        else if (facts.state === 'sent' || facts.state === 'uncertain' || facts.state === 'accepted' || facts.state === 'sending') {
          send = { state: facts.state === 'sent' ? 'sent' : 'uncertain', code: null, clickedAt: timeOf(facts.clickedAt), at: timeOf(facts.sentAt), text: facts.version, media: mediaOfVm(facts.media), attemptId: null, claimed: false, reported: false, by: null, messageId: null };
        }
        version = card?.fix ?? known?.fix ?? hold?.text ?? fix;
        edit = card !== null ? (card.edited ? card.text : null) : (known?.edit ?? hold?.edit ?? null);
      }
      const outcome = outcomes.get(fanRef);
      fans.push({
        fanRef,
        name: index?.byFan.get(fanRef)?.name ?? keptNames.get(fanRef) ?? null,
        version,
        basis: version === null ? null : (bases.get(fanRef) ?? held.get(fanRef)?.basis ?? 'unknown'),
        versionAt: versionAts.get(fanRef) ?? null,
        edit,
        editedBy: editedBy.get(fanRef) ?? null,
        send,
        outcome: outcome === undefined ? null : { sentAt: outcome.sentAt, mills: outcome.mills, paidIds: [...outcome.paidIds], bought: outcome.bought, replied: outcome.replied, checks: outcome.checks },
      });
    }
    return {
      id: currentId ?? '',
      owner,
      createdAt: createdAt ?? now,
      updatedAt: now,
      text,
      textRevision,
      textChangedAt,
      source: source === null ? null : source.kind === 'tiers' ? { kind: 'tiers', on: [...source.on] } : { kind: 'picked', fans: [...source.fans] },
      conditions,
      amountTyped,
      locked: locked === null ? null : [...locked],
      unticked: [...unticked],
      items: own === null ? [] : items.map(({ contentType, contentId }) => ({ contentType, contentId })),
      picked: own === null ? [] : [...pickedItems],
      media: own === null ? mediaOfVm(offerMedia()) : null,
      fans,
      folded: minimized || surfaces.current().outreach,
      author,
      synced,
      pending: null,
    };
  }

  /**
   * What of the window's outreach the hub has not taken, kept with it on this computer: what changed since the hub's
   * copy it saw; everything when that copy is not known here (the hub did not answer since a reload); none before the
   * hub ever took it (the first save sends it whole).
   */
  function pendingOf(snap: SavedOutreach): SavedOutreach['pending'] {
    if (!synced) return null;
    const body = base !== null ? patchOf(base, snap) : (pending ?? patchOf(null, snap));
    if (body === null) return null;
    const { createdAt: _createdAt, ...rest } = body;
    return rest;
  }

  /** A save kept on this computer, as the hub's route takes it; null — none, or not one. */
  const pendingBody = (raw: SavedOutreach['pending']): OutreachStoreSaveBody | null => {
    if (raw === null) return null;
    const parsed = OutreachStoreSaveBodySchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  };

  /** A kept outreach becomes the window's, as it was left: nothing is written or sent by it. */
  function restoreFrom(saved: SavedOutreach): void {
    resetCampaign();
    keptSends.clear();
    keptNames.clear();
    cardSent.clear();
    cardClaims.clear();
    cardKnown.clear();
    held.clear();
    hubDown.clear();
    currentId = saved.id;
    createdAt = saved.createdAt;
    text = saved.text;
    textRevision = saved.textRevision;
    textChangedAt = saved.textChangedAt;
    source = saved.source === null ? null : saved.source.kind === 'tiers' ? { kind: 'tiers', on: new Set(saved.source.on) } : { kind: 'picked', fans: [...saved.source.fans] };
    conditions = saved.conditions;
    amountTyped = saved.amountTyped;
    for (const fanRef of saved.unticked) unticked.add(fanRef);
    locked = saved.locked === null ? null : [...saved.locked];
    author = saved.author;
    synced = saved.synced;
    base = null;
    pending = pendingBody(saved.pending);
    refusedSave = '';
    inFlight = new Set();
    if (own !== null) {
      if (saved.items.length > 0) {
        items = saved.items.map(({ contentType, contentId }) => ({ contentType, contentId }));
        itemsState = 'checked';
      }
      pickedItems.clear();
      for (const key of saved.picked) pickedItems.add(key);
    }
    const ready: { handle: string; text: string }[] = [];
    for (const fan of saved.fans) {
      if (fan.name !== null) keptNames.set(fan.fanRef, fan.name);
      if (fan.basis !== null) bases.set(fan.fanRef, fan.basis);
      if (fan.versionAt !== null) versionAts.set(fan.fanRef, fan.versionAt);
      if (fan.editedBy !== null) editedBy.set(fan.fanRef, fan.editedBy);
      const handle = handleOf(fan.fanRef);
      // A send kept by 3.15.0 has no attempt of the hub's: it gets one, to be recorded there.
      const send = fan.send === null ? null : fan.send.attemptId === null && fan.send.state !== 'failed' ? { ...fan.send, attemptId: uuid() } : fan.send;
      if (own !== null) {
        // The site's own send (Fansly): the versions, the person's words and what went come back whole.
        if (fan.version !== null) ready.push({ handle, text: fan.version });
        if (fan.edit !== null) edits.set(fan.fanRef, fan.edit);
        if (send !== null) {
          owned.set(fan.fanRef, { state: send.state, code: send.code, clickedAt: send.clickedAt ?? send.at ?? saved.updatedAt, at: send.at, attemptId: send.attemptId, claimed: send.claimed, reported: send.reported, by: send.by, messageId: send.messageId });
          if (send.state !== 'failed') sentTexts.set(fan.fanRef, { text: send.text ?? fan.edit ?? fan.version ?? '', media: mediaVmOf(send.media) });
        }
      } else if (send !== null && send.state !== 'failed') keptSends.set(fan.fanRef, send);
      // The cards' send (ChatSpace): a version lives on its card, which a reload empties — it goes back into the card.
      else if (fan.version !== null) {
        held.set(fan.fanRef, { text: fan.version, basis: fan.basis, at: fan.versionAt, edit: fan.edit, tried: 0 });
        cardKnown.set(fan.fanRef, { fix: fan.version, edit: fan.edit });
      }
      if (send?.clickedAt !== undefined && send.clickedAt !== null) clicks.set(fan.fanRef, send.clickedAt);
      if (fan.outcome !== null) outcomes.set(fan.fanRef, { ...fan.outcome, paidIds: [...fan.outcome.paidIds], timer: null });
    }
    if (ready.length > 0) batch.restore(ready);
    // Versions going back into their cards are work left, not the end: the pane stays on the offer.
    endShown = held.size > 0;
    audienceCache = null;
    lastSaved = '';
    if (held.size > 0) scheduleAdopt();
  }

  /** The owner's current outreach comes back after the first read, unless the window holds one of its own already. */
  function resumeCurrent(): void {
    const owner = ownerOf();
    if (!storeRead || owner === null || resumedFor === owner) return;
    resumedFor = owner;
    if (currentId !== null || text.trim() !== '' || locked !== null) return;
    const id = stored.current[owner];
    const saved = id === undefined ? undefined : stored.outreaches.find((outreach) => outreach.id === id && outreach.owner === owner);
    if (saved === undefined) return;
    restoreFrom(saved);
    // Folded (or open) when the page went: its chip stands again, one click back to it.
    if (saved.folded && clock.now() - saved.updatedAt < OUTREACH_CHIP_BACK_MS && !surfaces.current().outreach) {
      minimized = true;
      surfaces.setOutreachChip(true);
      // The chip says how far the outreach got: the board its fans come from is read for it.
      void board.load({ recent: conditions.active.on }).then(() => changed());
    }
    // The hub's copy is newer than this computer's for all a colleague did since: it comes in.
    void pull();
  }

  /** What another tab kept of the window's outreach: a send that went (or may have) there stands here too. */
  function adoptKept(): boolean {
    if (currentId === null) return false;
    const saved = stored.outreaches.find((outreach) => outreach.id === currentId);
    if (saved === undefined) return false;
    let moved = false;
    for (const fan of saved.fans) {
      const send = fan.send;
      if (send === null || send.state === 'failed') continue;
      const state = factsOf(fan.fanRef).state;
      if (state === 'sent' || state === 'uncertain' || state === 'sending' || state === 'accepted') continue;
      adoptSend(fan.fanRef, send);
      if (fan.outcome !== null && !outcomes.has(fan.fanRef)) outcomes.set(fan.fanRef, { ...fan.outcome, paidIds: [...fan.outcome.paidIds], timer: null });
      moved = true;
    }
    return moved;
  }

  /** The store as the tabs left it: the list follows, and a send another tab made of this outreach stands. */
  async function readStored(): Promise<void> {
    if (store === null) return;
    const raw = await store.load().catch(() => undefined);
    if (disposed) return;
    stored = mergeOutreachStores(readOutreachStore(raw, clock.now()), stored, clock.now());
    if (adoptKept()) changed();
    else cell.invalidate();
  }

  /** A change is written at most every OUTREACH_SAVE_MS. */
  function scheduleSave(): void {
    if (store === null || !storeRead || disposed || saveTimer !== null) return;
    saveTimer = clock.setTimer(OUTREACH_SAVE_MS, () => {
      saveTimer = null;
      void save();
    });
  }

  /** The window's outreach gets its id once it is worth keeping (the hub's too: a UUID). */
  function ensureId(snap: Pick<SavedOutreach, 'text' | 'locked' | 'createdAt'>): string | null {
    if (currentId !== null) return currentId;
    if (!worthKeeping(snap)) return null;
    currentId = newId();
    createdAt = snap.createdAt;
    return currentId;
  }

  /** The window's outreach into the store, merged with what other tabs wrote; the snapshot is taken at once. */
  function save(): Promise<void> {
    const owner = ownerOf();
    if (store === null || !storeRead || owner === null) return writing;
    const snap = snapshot(owner);
    if (!worthKeeping(snap)) return writing;
    const id = ensureId(snap);
    if (id === null) return writing;
    const outreach: SavedOutreach = { ...snap, id, pending: pendingOf(snap) };
    const key = JSON.stringify({ ...outreach, id: '', createdAt: 0, updatedAt: 0 });
    if (key === lastSaved) return writing;
    lastSaved = key;
    writing = writing
      .then(async () => {
        const raw = await store.load().catch(() => undefined);
        const now = clock.now();
        const next = mergeOutreachStores(readOutreachStore(raw, now), putOutreach(EMPTY_OUTREACH_STORE, outreach, now), now);
        await store.save(next);
        if (disposed) return;
        stored = next;
        if (adoptKept()) changed();
        else cell.invalidate();
      })
      .catch(() => undefined);
    return writing;
  }

  /** What waits to be written goes now. */
  function flush(): Promise<void> {
    if (saveTimer !== null) {
      clock.clearTimer(saveTimer);
      saveTimer = null;
    }
    return save();
  }

  /** A send of this fan another tab kept for the window's outreach (went, or may have); null — none, or nothing kept. */
  async function sentElsewhere(fanRef: string): Promise<SavedSend | null> {
    const id = currentId;
    if (store === null || id === null) return null;
    const raw = await store.load().catch(() => undefined);
    const saved = readOutreachStore(raw, clock.now()).outreaches.find((outreach) => outreach.id === id);
    const send = saved?.fans.find((fan) => fan.fanRef === fanRef)?.send ?? null;
    return send !== null && send.state !== 'failed' ? send : null;
  }

  // ── the hub: saves, the sends' claims and reports, a colleague's changes ──

  /** The window's outreach goes to the hub at most every OUTREACH_PUSH_MS (sooner: `delay`). */
  function schedulePush(delay: number = OUTREACH_PUSH_MS): void {
    if (!hubOn() || disposed) return;
    if (pushTimer !== null) {
      if (delay >= OUTREACH_PUSH_MS) return;
      clock.clearTimer(pushTimer);
    }
    pushTimer = clock.setTimer(delay, () => {
      pushTimer = null;
      void push();
    });
  }

  /** The hub did not answer: tried again later, further and further apart. */
  function wentOffline(): void {
    offlineSince ??= clock.now();
    const delay = OUTREACH_RETRY_MS[Math.min(retries, OUTREACH_RETRY_MS.length - 1)] ?? 60_000;
    retries += 1;
    if (pushTimer !== null) clock.clearTimer(pushTimer);
    pushTimer = clock.setTimer(delay, () => {
      pushTimer = null;
      void push();
    });
  }

  const cameBack = (): void => {
    offlineSince = null;
    retries = 0;
  };

  /** One save of the window's outreach at a time; a change meanwhile is saved by the next. */
  function push(): Promise<void> {
    if (pushing !== null) return pushing;
    const run = pushOnce().finally(() => {
      pushing = null;
    });
    pushing = run;
    return run;
  }

  async function pushOnce(): Promise<void> {
    const owner = ownerOf();
    const page = pageId();
    if (!hubOn() || hub === null || owner === null || page === null) return;
    const first = snapshot(owner);
    const outreachId = ensureId(first);
    if (outreachId === null) return;
    const atEpoch = epoch;
    // A save kept from before goes first; then what changed since the hub's copy; twice at most a run.
    for (let round = 0; round < 3; round += 1) {
      const snap = round === 0 ? first : snapshot(owner);
      const body = pending ?? patchOf(synced ? base : null, snap);
      if (body === null) break;
      const key = JSON.stringify(body);
      if (key === refusedSave) break;
      const answer = await hub.save(page, outreachId, body);
      if (disposed || atEpoch !== epoch || currentId !== outreachId) return;
      if (!answer.ok) {
        if (answer.kind === 'off') hubOff = true;
        else if (answer.kind === 'offline') {
          pending = body;
          wentOffline();
        } else {
          // Refused as it is (a fan the hub does not know, a broken field): not sent again unchanged.
          refusedSave = key;
          pending = null;
        }
        changed(true);
        return;
      }
      cameBack();
      pending = null;
      refusedSave = '';
      synced = true;
      takeHub(answer.value);
    }
    await flushReports(page, outreachId, atEpoch);
  }

  /** Every send the hub is to be told of: its report, or the record of one made without a claim. */
  function unreported(): { readonly fanRef: string; readonly send: SavedSend }[] {
    const owner = ownerOf();
    if (owner === null) return [];
    return snapshot(owner).fans.flatMap((fan) => (fan.send === null || fan.send.reported || fan.send.attemptId === null || isMovingHere(fan.fanRef) ? [] : [{ fanRef: fan.fanRef, send: fan.send }]));
  }

  /** The window's own send of the fan is on its way: nothing of it is told yet. */
  const isMovingHere = (fanRef: string): boolean => owned.get(fanRef)?.state === 'sending' || cardClaims.has(fanRef);

  function markReported(fanRef: string, attemptId: string | null): void {
    const mine = owned.get(fanRef);
    if (mine !== undefined && mine.attemptId === attemptId) mine.reported = true;
    const ended = cardSent.get(fanRef);
    if (ended !== undefined && ended.attemptId === attemptId) cardSent.set(fanRef, { ...ended, reported: true });
    const kept = keptSends.get(fanRef);
    if (kept !== undefined && kept.attemptId === attemptId) keptSends.set(fanRef, { ...kept, reported: true });
  }

  async function flushReports(page: number, outreachId: string, atEpoch: number): Promise<void> {
    if (hub === null || !synced) return;
    for (const { fanRef, send } of unreported()) {
      const raw = reportOf(fanRef, send);
      const parsed = raw === null ? null : OutreachStoreSendBodySchema.safeParse(raw);
      if (parsed === null || !parsed.success) {
        markReported(fanRef, send.attemptId);
        continue;
      }
      const answer = await hub.send(page, outreachId, parsed.data);
      if (disposed || atEpoch !== epoch || currentId !== outreachId) return;
      if (!answer.ok) {
        if (answer.kind === 'off') hubOff = true;
        else if (answer.kind === 'offline') wentOffline();
        else markReported(fanRef, send.attemptId);
        if (answer.kind !== 'refused') return;
        continue;
      }
      cameBack();
      markReported(fanRef, send.attemptId);
      // A record the hub did not take (a colleague's send came first): theirs stands here too.
      takeFan(fanRef, answer.value.fan);
    }
    changed(true);
  }

  /** The hub's word on one fan (an answer to a send): its send, when it got further than the window's. */
  function takeFan(fanRef: string, fan: OutreachStoreFan): void {
    const send = fanFromHub(fan, clock.now())?.send ?? null;
    if (send === null) return;
    const local = snapshotSend(fanRef);
    if (sendRank(send) > sendRank(local) || (local !== null && local.attemptId === send.attemptId && send.state !== local.state && local.state !== 'failed')) adoptSend(fanRef, send);
  }

  /** The fan's send as the window would keep it now. */
  function snapshotSend(fanRef: string): SavedSend | null {
    const owner = ownerOf();
    return owner === null ? null : (snapshot(owner).fans.find((fan) => fan.fanRef === fanRef)?.send ?? null);
  }

  /** The hub's copy of the window's outreach: what the window did not change since the copy it saw comes in. */
  function takeHub(value: OutreachStoreOutreach): void {
    const owner = ownerOf();
    if (owner === null || value.outreachId !== currentId) return;
    const remote = fromHub(value, owner, clock.now(), { names: keptNames });
    if (remote === null) return;
    applyPlan(adoptPlan(base, snapshot(owner), remote));
    base = remote;
    inFlight = inFlightOf(value, clock.now());
    author = remote.author;
    changed();
  }

  function applyPlan(plan: AdoptPlan): void {
    if (plan.text !== null && plan.text.text !== text) {
      text = plan.text.text;
      textRevision += 1;
      textChangedAt = plan.text.changedAt ?? clock.now();
    }
    if (plan.audience !== null && locked === null) {
      const next = plan.audience;
      source = next.source === null ? null : next.source.kind === 'tiers' ? { kind: 'tiers', on: new Set(next.source.on) } : { kind: 'picked', fans: [...next.source.fans] };
      conditions = next.conditions;
      amountTyped = next.amountTyped;
      unticked.clear();
      for (const fanRef of next.unticked) unticked.add(fanRef);
      if (own !== null) {
        if (next.items.length > 0) {
          items = next.items.map(({ contentType, contentId }) => ({ contentType, contentId }));
          itemsState = 'checked';
        }
        pickedItems.clear();
        for (const key of next.picked) pickedItems.add(key);
      }
      audienceCache = null;
    }
    if (plan.order !== undefined) applyOrder(plan.order ?? []);
    for (const fan of plan.fans) {
      if (fan.send !== undefined) adoptSend(fan.fanRef, fan.send);
      if (fan.version !== undefined) adoptVersion(fan.fanRef, fan.version);
      if (fan.edit !== undefined) adoptEdit(fan.fanRef, fan.edit);
      if (fan.outcome !== undefined) {
        const was = outcomes.get(fan.fanRef);
        if (was?.timer !== undefined && was.timer !== null) clock.clearTimer(was.timer);
        outcomes.set(fan.fanRef, { ...fan.outcome, paidIds: [...fan.outcome.paidIds], timer: null });
      }
    }
  }

  /** The hub's order of the fans: a fan the window works on (a version being written, a send) stays though it left it. */
  function applyOrder(next: readonly string[]): void {
    const now = locked ?? [];
    const stays = now.filter((fanRef) => !next.includes(fanRef) && [...MOVING, ...WENT].includes(factsOf(fanRef).state));
    const leaving = now.filter((fanRef) => !next.includes(fanRef) && !stays.includes(fanRef));
    if (leaving.length > 0) {
      batch.drop(leaving.map(handleOf));
      for (const fanRef of leaving) {
        edits.delete(fanRef);
        editedBy.delete(fanRef);
        held.delete(fanRef);
        cardKnown.delete(fanRef);
        bases.delete(fanRef);
        versionAts.delete(fanRef);
      }
    }
    const merged = [...next, ...stays];
    locked = merged.length === 0 ? null : merged;
    audienceCache = null;
  }

  /** A send the hub knows (a colleague's, another tab's, the archive's word on an unknown one) stands in the window. */
  function adoptSend(fanRef: string, send: SavedSend): void {
    if (own !== null) {
      const mine = owned.get(fanRef);
      // The window's own send on its way is the window's to tell.
      if (mine?.state === 'sending') return;
      owned.set(fanRef, { state: send.state, code: send.code, clickedAt: send.clickedAt ?? send.at ?? clock.now(), at: send.at, attemptId: send.attemptId, claimed: send.claimed, reported: send.reported, by: send.by, messageId: send.messageId });
      if (send.state !== 'failed') sentTexts.set(fanRef, { text: send.text ?? edits.get(fanRef) ?? batch.row(handleOf(fanRef)).text ?? '', media: mediaVmOf(send.media) });
      else sentTexts.delete(fanRef);
    } else {
      if (cardClaims.has(fanRef)) return;
      const card = batchPort?.outreachRow?.(handleOf(fanRef))?.send?.s;
      if (card === 'queued' || card === 'sending' || card === 'accepted') return;
      const ended = cardSent.get(fanRef);
      if (ended !== undefined && ended.attemptId === send.attemptId) cardSent.set(fanRef, { ...ended, ...send, reported: true });
      else if (send.state === 'failed') keptSends.delete(fanRef);
      else {
        keptSends.set(fanRef, send);
        held.delete(fanRef);
      }
    }
    hubDown.delete(fanRef);
    if (send.clickedAt !== null) clicks.set(fanRef, send.clickedAt);
  }

  /** The hub's version of a fan (a colleague's, another computer's): only where nothing is written or sent here. */
  function adoptVersion(fanRef: string, version: { readonly text: string | null; readonly basis: string | null; readonly at: number | null }): void {
    const state = factsOf(fanRef).state;
    if (MOVING.includes(state) || WENT.includes(state)) return;
    const handle = handleOf(fanRef);
    if (version.text === null) {
      batch.drop([handle]);
      bases.delete(fanRef);
      versionAts.delete(fanRef);
      held.delete(fanRef);
      cardKnown.delete(fanRef);
      return;
    }
    bases.set(fanRef, version.basis ?? 'unknown');
    if (version.at !== null) versionAts.set(fanRef, version.at);
    if (own !== null) batch.restore([{ handle, text: version.text }]);
    else {
      held.set(fanRef, { text: version.text, basis: version.basis, at: version.at, edit: held.get(fanRef)?.edit ?? null, tried: 0 });
      cardKnown.set(fanRef, { fix: version.text, edit: null });
      scheduleAdopt();
    }
  }

  /** The hub's words for a fan's version (a colleague's): only where nothing is sent here. */
  function adoptEdit(fanRef: string, edit: { readonly text: string | null; readonly by: string | null }): void {
    const state = factsOf(fanRef).state;
    if (MOVING.includes(state) || WENT.includes(state)) return;
    if (edit.by === null) editedBy.delete(fanRef);
    else editedBy.set(fanRef, edit.by);
    if (own !== null) {
      if (edit.text === null) edits.delete(fanRef);
      else edits.set(fanRef, edit.text);
      return;
    }
    const hold = held.get(fanRef);
    if (hold !== undefined) held.set(fanRef, { ...hold, edit: edit.text });
    else batchPort?.outreachEdit?.(handleOf(fanRef), edit.text);
    const known = cardKnown.get(fanRef);
    if (known !== undefined) cardKnown.set(fanRef, { ...known, edit: edit.text });
  }

  /** ChatSpace: versions the hub keeps that no card shows go into their cards, one at a time. */
  function scheduleAdopt(): void {
    if (own !== null || adoptTimer !== null || disposed) return;
    adoptTimer = clock.setTimer(300, () => {
      adoptTimer = null;
      void adoptHeld();
    });
  }

  async function adoptHeld(): Promise<void> {
    const port = batchPort;
    if (own !== null || adopting || port === null || listIndex() === null) return;
    // A card's result that ran out of its time comes back from what the window knew of it.
    for (const fanRef of locked ?? []) {
      if (held.has(fanRef)) continue;
      const known = cardKnown.get(fanRef);
      if (known === undefined || port.outreachRow?.(handleOf(fanRef)) !== null) continue;
      const state = factsOfRaw(fanRef).state;
      if (MOVING.includes(state) || WENT.includes(state) || keptSends.has(fanRef) || cardSent.has(fanRef)) continue;
      held.set(fanRef, { text: known.fix, basis: bases.get(fanRef) ?? null, at: versionAts.get(fanRef) ?? null, edit: known.edit, tried: 0 });
    }
    if (held.size === 0) return;
    if (port.outreachAdopt === undefined) {
      // A preview that cannot take a version: «Дописать» writes them again.
      batch.pick([...held.keys()].map(handleOf), true);
      held.clear();
      changed();
      return;
    }
    adopting = true;
    const atEpoch = epoch;
    try {
      for (const [fanRef, version] of [...held]) {
        if (disposed || atEpoch !== epoch) return;
        if (clock.now() - version.tried < ADOPT_RETRY_MS) continue;
        version.tried = clock.now();
        const state = factsOfRaw(fanRef).state;
        if (MOVING.includes(state) || WENT.includes(state) || keptSends.has(fanRef)) {
          held.delete(fanRef);
          continue;
        }
        const handle = handleOf(fanRef);
        const ok = await port.outreachAdopt(handle, version.text).catch(() => false);
        if (disposed || atEpoch !== epoch || held.get(fanRef) !== version) continue;
        if (!ok) continue;
        held.delete(fanRef);
        batch.restore([{ handle, text: version.text }]);
        if (version.edit !== null) port.outreachEdit?.(handle, version.edit);
      }
    } finally {
      adopting = false;
      if (!disposed) changed();
    }
  }

  /**
   * The hub's copy of the window's outreach, read again. The first after a reload (the window's came from this
   * computer): the save kept here goes first, then the hub's copy is the window's — unless the window works already.
   */
  async function pull(): Promise<void> {
    const page = pageId();
    const outreachId = currentId;
    const owner = ownerOf();
    if (!hubOn() || hub === null || page === null || outreachId === null || owner === null) return;
    if (!synced || pending !== null) {
      await push();
      if (!synced || pending !== null || currentId !== outreachId) return;
    }
    const atEpoch = epoch;
    const answer = await hub.get(page, outreachId);
    if (disposed || atEpoch !== epoch || currentId !== outreachId) return;
    if (!answer.ok) {
      if (answer.kind === 'off') hubOff = true;
      else if (answer.kind === 'offline') offlineSince ??= clock.now();
      else {
        // Not on the hub (gone after 90 days untouched): the next save makes it again.
        synced = false;
        base = null;
        schedulePush(0);
      }
      changed(true);
      return;
    }
    cameBack();
    if (base === null && !(locked ?? []).some((fanRef) => MOVING.includes(factsOf(fanRef).state))) {
      const remote = fromHub(answer.value, owner, clock.now(), { names: keptNames, folded: minimized || surfaces.current().outreach });
      if (remote !== null) {
        const card = lastCard;
        restoreFrom(remote);
        lastCard = card;
        base = remote;
        inFlight = inFlightOf(answer.value, clock.now());
        changed();
        await flushReports(page, outreachId, atEpoch);
        return;
      }
    }
    takeHub(answer.value);
    await flushReports(page, outreachId, atEpoch);
  }

  /** The page's outreaches on the hub (the team's) and the fans written to in 3 days, read again when due. */
  async function refreshTeam(force = false): Promise<void> {
    const page = pageId();
    if (!hubOn() || hub === null || page === null) return;
    const now = clock.now();
    if (force || now - teamAt >= OUTREACH_TEAM_MS) {
      teamAt = now;
      const answer = await hub.list(page);
      if (disposed || pageId() !== page) return;
      if (answer.ok) {
        team = answer.value.outreaches;
        void uploadLocal(page);
      } else if (answer.kind === 'off') hubOff = true;
    }
    if (force || now - touchesAt >= OUTREACH_TEAM_MS) {
      touchesAt = now;
      const answer = await hub.touches(page);
      if (disposed || pageId() !== page) return;
      if (answer.ok) {
        touches = new Map(answer.value.fans.map((touch) => [touch.fanRef, touch] as const));
        audienceCache = null;
      } else if (answer.kind === 'off') hubOff = true;
    }
    changed();
  }

  /** This computer's outreaches the hub does not have yet (3.15.0's, or made while it did not answer): sent there. */
  async function uploadLocal(page: number): Promise<void> {
    const owner = ownerOf();
    if (hub === null || owner === null || store === null) return;
    const known = new Set((team ?? []).map((item) => item.outreachId));
    const waiting = outreachesOf(stored, owner).filter((outreach) => outreach.id !== currentId && UUID.test(outreach.id) && (!outreach.synced || outreach.pending !== null || outreach.fans.some((fan) => fan.send !== null && !fan.send.reported)));
    for (const outreach of waiting.slice(0, UPLOADS_PER_READ)) {
      if (disposed || pageId() !== page) return;
      const body = outreach.synced && known.has(outreach.id) ? pendingBody(outreach.pending) : patchOf(null, outreach);
      if (body !== null) {
        const answer = await hub.save(page, outreach.id, body);
        if (!answer.ok) {
          if (answer.kind !== 'refused') return;
          continue;
        }
      }
      const fans: SavedFan[] = [];
      for (const fan of outreach.fans) {
        let send = fan.send;
        if (send !== null && !send.reported) {
          const attempt: SavedSend = send.attemptId === null ? { ...send, attemptId: uuid() } : send;
          const raw = reportOf(fan.fanRef, attempt);
          const parsed = raw === null ? null : OutreachStoreSendBodySchema.safeParse(raw);
          if (parsed !== null && parsed.success) {
            const answer = await hub.send(page, outreach.id, parsed.data);
            if (!answer.ok && answer.kind !== 'refused') return;
          }
          send = { ...attempt, reported: true };
        }
        fans.push(send === fan.send ? fan : { ...fan, send });
      }
      // Kept as the hub now has it.
      const done: SavedOutreach = { ...outreach, fans, synced: true, pending: null };
      writing = writing
        .then(async () => {
          const raw = await store.load().catch(() => undefined);
          const now = clock.now();
          const current = readOutreachStore(raw, now);
          const next = mergeOutreachStores(current, { ...current, outreaches: current.outreaches.map((item) => (item.id === done.id ? done : item)) }, now);
          await store.save(next);
          if (!disposed) stored = next;
        })
        .catch(() => undefined);
    }
  }

  /** While the window is open its outreach, the team's list and the touches are read again; never while it is closed. */
  function schedulePoll(): void {
    if (pollTimer !== null || disposed || !hubOn() || !surfaces.current().outreach) return;
    pollTimer = clock.setTimer(OUTREACH_POLL_MS, () => {
      pollTimer = null;
      if (!surfaces.current().outreach) return;
      void pull().then(() => refreshTeam()).finally(() => schedulePoll());
    });
  }

  /**
   * The claim of a fan's send at the hub, before the site is asked: `ok` — the window's to send; `taken` — went, may
   * have, or is on its way from this outreach (`fan` says whose); `busy` — another outreach sends to the fan right now;
   * `offline` — the hub did not answer (the person may send anyway); `off` — the hub keeps no outreaches here.
   */
  async function claimSend(fanRef: string, attemptId: string, body: string, media: Record<string, unknown> | null): Promise<{ readonly kind: 'ok' | 'taken' | 'busy' | 'offline' | 'off'; readonly fan?: OutreachStoreFan }> {
    const page = pageId();
    if (hub === null || page === null || !hubOn()) return { kind: 'off' };
    // The hub must have the outreach (and the window's last save) before a fan of it is claimed.
    if (!synced || pending !== null) await push();
    if (!hubOn()) return { kind: 'off' };
    const outreachId = currentId;
    if (!synced || outreachId === null) return { kind: 'offline' };
    const answer = await hub.send(page, outreachId, { action: 'claim', fanRef, attemptId, text: body, media });
    if (!answer.ok) {
      if (answer.kind === 'off') {
        hubOff = true;
        return { kind: 'off' };
      }
      if (answer.kind === 'offline') offlineSince ??= clock.now();
      return { kind: 'offline' };
    }
    cameBack();
    const outcome = answer.value.outcome;
    if (outcome === 'ok') return { kind: 'ok', fan: answer.value.fan };
    // `busy`, `taken`, `not_yours` and anything this build does not know: never sent from here.
    return { kind: outcome === 'busy' ? 'busy' : 'taken', fan: answer.value.fan };
  }

  /** The hub refused the claim: who sent (or sends) the fan stands in the window; nothing goes. */
  function claimRefused(type: UiAction['type'], fanRef: string, claim: { readonly kind: string; readonly fan?: OutreachStoreFan }): ActionReceipt {
    if (claim.fan !== undefined) takeFan(fanRef, claim.fan);
    if (claim.kind === 'busy') inFlight = new Set([...inFlight, fanRef]);
    changed();
    return refused(type, localError('CG-SEND-BUSY', i18n));
  }

  /** «Рассылки»: another outreach becomes the window's — the hub's copy (a colleague's is only there), else this computer's. */
  async function resume(type: UiAction['type'], id: string): Promise<ActionReceipt> {
    const owner = ownerOf();
    if ((store === null && !hubOn()) || owner === null) return refused(type, localError('CG-BINDING-MISSING', i18n));
    if (id === currentId) return done(type, 'noop');
    // A version being written or a send on its way belongs to the outreach it started in.
    if ((locked ?? []).some((fanRef) => MOVING.includes(factsOf(fanRef).state))) return refused(type, localError('CG-SEND-BUSY', i18n));
    await flush();
    // What the window's outreach has not saved at the hub goes there first.
    if (pending !== null || (pushTimer !== null && hubOn())) await push();
    await readStored();
    if (disposed) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    const page = pageId();
    const local = stored.outreaches.find((outreach) => outreach.id === id && outreach.owner === owner);
    if (hubOn() && hub !== null && page !== null && UUID.test(id)) {
      const atEpoch = epoch;
      const answer = await hub.get(page, id);
      if (disposed || atEpoch !== epoch) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
      const remote = answer.ok ? fromHub(answer.value, owner, clock.now(), { names: keptNames }) : null;
      if (answer.ok && remote !== null) {
        restoreFrom(remote);
        base = remote;
        inFlight = inFlightOf(answer.value, clock.now());
        // A save this computer kept of it goes after.
        pending = pendingBody(local?.pending ?? null);
        if (pending !== null) schedulePush(0);
        surfaces.setPreview('outreach', null);
        changed();
        return done(type);
      }
      if (!answer.ok && answer.kind === 'off') hubOff = true;
    }
    if (local === undefined) return refused(type, localError('CG-DATA-NOT-READY', i18n));
    restoreFrom(local);
    void pull();
    surfaces.setPreview('outreach', null);
    changed();
    return done(type);
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
      ...whoOf(fanRef),
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
      watchCards();
      if (own === null && (held.size > 0 || cardKnown.size > 0)) scheduleAdopt();
    }
    scheduleSave();
    schedulePush();
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
    // What other tabs kept since: the list in the head, and their sends of this outreach.
    void readStored();
    // The hub's: the team's outreaches, the touches of 3 days, and what a colleague did in this one.
    void refreshTeam(true);
    void pull();
    schedulePoll();
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
        return facts.state === 'stopped' || facts.state === 'unwritten' || facts.state === 'idle' || isStale(fanRef, facts);
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
    // A click on «Отправить всё равно» passes the warning it shows (a colleague talks to the fan, the hub did not answer).
    const passes = anyway || facts.send.kind === 'anyway';
    const handle = handleOf(fanRef);
    clicks.set(fanRef, clock.now());
    if (own !== null) return sendOwn(type, fanRef, facts, passes);
    const port = batchPort;
    if (port?.outreachSend === undefined) return refused(type, localError('CG-FEATURE-DISABLED', i18n));
    const version = (facts.version ?? '').trim();
    if (hubOn() && version !== '' && !cardClaims.has(fanRef)) {
      // The hub claims the fan first: one send per fan of the outreach, from any tab, computer or colleague.
      const attemptId = uuid();
      const atEpoch = epoch;
      const claim = await claimSend(fanRef, attemptId, version, mediaWire(mediaOfVm(facts.media)));
      if (disposed || atEpoch !== epoch) {
        if (claim.kind === 'ok') cardSent.set(fanRef, { state: 'failed', code: 'CG-CONTEXT-CHANGED', clickedAt: clock.now(), at: clock.now(), text: version, media: mediaOfVm(facts.media), attemptId, claimed: true, reported: false, by: null, messageId: null });
        return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
      }
      if (claim.kind === 'taken' || claim.kind === 'busy') return claimRefused(type, fanRef, claim);
      if (claim.kind === 'offline' && !(passes && hubDown.has(fanRef))) {
        hubDown.add(fanRef);
        changed();
        return refused(type, localError('CG-HUB-UNAVAILABLE', i18n));
      }
      if (claim.kind !== 'off') {
        cardClaims.set(fanRef, { attemptId, claimed: claim.kind === 'ok', clickedAt: clock.now(), text: version, media: mediaOfVm(facts.media), settled: false, code: null });
        cardSent.delete(fanRef);
        if (claim.kind === 'ok') hubDown.delete(fanRef);
      }
    }
    const receipt = await port.outreachSend(type, handle, passes);
    const claim = cardClaims.get(fanRef);
    if (claim !== undefined) {
      claim.settled = true;
      claim.code = receipt.ok ? null : (receipt.code ?? 'CG-SEND-REJECTED');
    }
    watchCards();
    changed();
    return receipt;
  }

  /**
   * The cards' sends the window claimed (ChatSpace): once a card says how its send ended — sent, refused, unknown — the
   * hub is told; a click that reached no queue of ChatSpace's (the card refused it) ends refused.
   */
  function watchCards(): void {
    if (own !== null || cardClaims.size === 0) return;
    let ended = false;
    for (const [fanRef, claim] of [...cardClaims]) {
      const card = batchPort?.outreachRow?.(handleOf(fanRef)) ?? null;
      const s = card?.send?.s ?? null;
      if (s === 'queued' || s === 'sending' || s === 'accepted') continue;
      const base = { clickedAt: claim.clickedAt, text: claim.text, media: claim.media, attemptId: claim.attemptId, claimed: claim.claimed, reported: false, by: null, messageId: null };
      let send: SavedSend | null = null;
      if (s === 'sent') send = { ...base, state: 'sent', code: null, at: timeOf(card?.send?.s === 'sent' ? card.send.at : null) ?? clock.now() };
      else if (s === 'uncertain') send = { ...base, state: 'uncertain', code: null, at: null };
      else if (s === 'rejected') send = { ...base, state: 'failed', code: card?.send?.s === 'rejected' ? card.send.code : 'CG-SEND-REJECTED', at: clock.now() };
      else if (claim.settled) send = { ...base, state: claim.code === 'CG-SEND-UNCERTAIN' ? 'uncertain' : 'failed', code: claim.code, at: clock.now() };
      if (send === null) continue;
      cardClaims.delete(fanRef);
      if (send.state === 'failed' && !send.claimed) continue;
      cardSent.set(fanRef, send);
      if (send.state === 'sent') noteSent(fanRef, send.at ?? clock.now(), mediaVmOf(send.media));
      ended = true;
    }
    if (ended) schedulePush(0);
  }

  /** The site's own send (Fansly), as the old Spenders bar sent it: the click's token, the hub's claim, the fan's chat, one request. */
  async function sendOwn(type: UiAction['type'], fanRef: string, facts: FanFacts, passes: boolean): Promise<ActionReceipt> {
    const binding = context.current().binding;
    const channel = own;
    if (binding === null || channel === null) return refused(type, localError('CG-BINDING-MISSING', i18n));
    if (paced() || ownSending()) return refused(type, localError('CG-SEND-BUSY', i18n));
    const body = (facts.version ?? '').trim();
    if (body.length === 0) return refused(type, localError('CG-SEND-PART', i18n));
    const attachments = pickedPosts();
    const claiming = hubOn();
    const sent: OwnSend = { state: 'sending', code: null, clickedAt: clock.now(), at: null, attemptId: claiming ? uuid() : null, claimed: false, reported: false, by: null, messageId: null };
    owned.set(fanRef, sent);
    sentTexts.set(fanRef, { text: body, media: offerMedia() });
    pace();
    changed();
    const atEpoch = epoch;
    const mine = (): boolean => !disposed && atEpoch === epoch && owned.get(fanRef) === sent;
    const end = (state: OwnSend['state'], code: string | null): ActionReceipt => {
      if (mine()) {
        sent.state = state;
        sent.code = code;
        sent.at = clock.now();
        if (state === 'sent') noteSent(fanRef, sent.at, offerMedia());
        // The hub hears how it ended (a refused send never claimed is nothing to it).
        if (sent.attemptId !== null) schedulePush(0);
        changed();
      }
      return state === 'sent' ? done(type) : refused(type, localError(state === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-SEND-REJECTED', i18n, code ?? undefined));
    };
    /** Nothing went: the fan is as before the click. */
    const undo = (code: CgErrorWire['code']): ActionReceipt => {
      if (mine()) {
        owned.delete(fanRef);
        sentTexts.delete(fanRef);
        changed();
      }
      return refused(type, localError(code, i18n));
    };
    // The click's token first: it is the person's consent for this one send.
    const cause = await issueCause(rpc, 'send', 'preview');
    if (!mine()) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    if (!cause.ok) return end('failed', cause.code);
    if (sent.attemptId !== null) {
      // The hub claims the fan: one send per fan of the outreach, from any tab, computer or colleague.
      const claim = await claimSend(fanRef, sent.attemptId, body, mediaWire(mediaOfVm(offerMedia())));
      if (!mine()) {
        // Claimed, then the window moved on: nothing went, the hub hears so.
        if (claim.kind === 'ok') {
          sent.claimed = true;
          sent.state = 'failed';
          sent.code = 'CG-CONTEXT-CHANGED';
          sent.at = clock.now();
        }
        return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
      }
      if (claim.kind === 'taken' || claim.kind === 'busy') {
        owned.delete(fanRef);
        sentTexts.delete(fanRef);
        return claimRefused(type, fanRef, claim);
      }
      if (claim.kind === 'offline' && !(passes && hubDown.has(fanRef))) {
        hubDown.add(fanRef);
        return undo('CG-HUB-UNAVAILABLE');
      }
      if (claim.kind === 'ok') {
        sent.claimed = true;
        hubDown.delete(fanRef);
      }
      if (claim.kind === 'off') {
        // The hub keeps no outreaches here after all: this computer's word, as before.
        const elsewhere = await sentElsewhere(fanRef);
        if (elsewhere !== null) {
          if (mine()) adoptSend(fanRef, elsewhere);
          return refused(type, localError('CG-SEND-BUSY', i18n));
        }
      }
    } else {
      // Another tab of this outreach may have sent this version meanwhile: its word stands, nothing goes twice.
      const elsewhere = await sentElsewhere(fanRef);
      if (elsewhere !== null) {
        if (mine()) {
          owned.delete(fanRef);
          adoptSend(fanRef, elsewhere);
          changed();
        }
        return refused(type, localError('CG-SEND-BUSY', i18n));
      }
    }
    if (!mine()) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    const groupId = await board.group(fanRef).catch(() => null);
    if (groupId === null) return end('failed', 'CG-HOST-CHAT-NOT-FOUND');
    const answer = await channel
      .send({ hostAccountId: binding.platformAccountId, fanRef, groupId, text: body, attachments, cause: cause.cause, composedWith: facts.edited ? 'hand' : 'fix' })
      .catch((): OutreachAnswer => ({ ok: false, code: 'CG-SEND-UNCERTAIN' }));
    if (answer.ok) {
      if (mine()) sent.messageId = /^\d{1,30}$/.test(answer.messageId) ? answer.messageId : null;
      return end('sent', null);
    }
    return end(answer.code === 'CG-SEND-UNCERTAIN' ? 'uncertain' : 'failed', answer.code);
  }

  function edit(type: UiAction['type'], fanRef: string, words: string | null): ActionReceipt {
    const facts = factsOf(fanRef);
    if (!facts.editable) return refused(type, localError('CG-SEND-PART', i18n));
    // The words are the person's now (a colleague's were in place before).
    editedBy.delete(fanRef);
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
    for (const fanRef of unsent) {
      held.delete(fanRef);
      cardKnown.delete(fanRef);
      hubDown.delete(fanRef);
      editedBy.delete(fanRef);
    }
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
    // A send on its way belongs to the outreach it started in.
    if ((locked ?? []).some((fanRef) => { const state = factsOf(fanRef).state; return state === 'sending' || state === 'accepted'; }) || cardClaims.size > 0) return refused(type, localError('CG-SEND-BUSY', i18n));
    // The outreach it held is kept as it is (its snapshot is taken now), and stays in «Рассылки»; what the hub has not
    // taken of it goes there now (a save kept on this computer goes later, with the list).
    if (saveTimer !== null) clock.clearTimer(saveTimer);
    saveTimer = null;
    void save();
    if (pushTimer !== null) {
      clock.clearTimer(pushTimer);
      pushTimer = null;
      void push();
    }
    currentId = null;
    createdAt = null;
    lastSaved = '';
    keptSends.clear();
    keptNames.clear();
    forgetHubCopy();
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
    bases.clear();
    versionAts.clear();
    editedBy.clear();
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
        // A change that makes versions stale (or fresh again) moves the rows and the foot, not only the field.
        light = false;
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
    if (action.type === 'SetOutreach') return action.resume !== undefined ? resume(action.type, action.resume) : Promise.resolve(setOutreach(action));
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

  /** The window's outreach is another one now: what it knew of the hub's copy goes. */
  function forgetHubCopy(): void {
    author = null;
    synced = false;
    base = null;
    pending = null;
    refusedSave = '';
    inFlight = new Set();
    held.clear();
    cardKnown.clear();
    cardClaims.clear();
    cardSent.clear();
    hubDown.clear();
  }

  function reset(): void {
    resetCampaign();
    if (saveTimer !== null) clock.clearTimer(saveTimer);
    saveTimer = null;
    for (const timer of [pushTimer, pollTimer, adoptTimer]) if (timer !== null) clock.clearTimer(timer);
    pushTimer = null;
    pollTimer = null;
    adoptTimer = null;
    forgetHubCopy();
    team = null;
    teamAt = 0;
    touches = new Map();
    touchesAt = 0;
    hubOff = false;
    offlineSince = null;
    retries = 0;
    currentId = null;
    createdAt = null;
    lastSaved = '';
    resumedFor = null;
    keptSends.clear();
    keptNames.clear();
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
    // The page known (or another one): its outreach of last time comes back.
    resumeCurrent();
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
    if (state.outreach && !previous.outreach) {
      minimized = false;
      schedulePoll();
    }
    if (state.outreach !== previous.outreach || state.outreachChip !== previous.outreachChip || state.preview.outreach !== previous.preview.outreach) changed();
  });
  const offLanguage = i18n.subscribe(() => changed());
  // A colleague talking to a fan warns the site's own send (Fansly), as the cards warn of it.
  const offTalking = deps.talking?.onChange(() => changed()) ?? null;

  // The first read of the kept outreaches: the page's current one comes back once the page is known.
  if (store !== null) {
    void store
      .load()
      .then(
        (raw) => readOutreachStore(raw, clock.now()),
        () => EMPTY_OUTREACH_STORE,
      )
      .then((read) => {
        if (disposed) return;
        stored = read;
        storeRead = true;
        resumeCurrent();
        changed();
      });
  }

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
      // Versions the hub keeps that no card shows yet go into their cards now.
      scheduleAdopt();
      changed();
    },
    dispose() {
      // A change still waiting goes now (the snapshot is taken at once; the write may outlive the tab).
      if (saveTimer !== null) {
        clock.clearTimer(saveTimer);
        saveTimer = null;
        void save();
      }
      if (pushTimer !== null) {
        clock.clearTimer(pushTimer);
        pushTimer = null;
        void push();
      }
      for (const timer of [pollTimer, adoptTimer]) if (timer !== null) clock.clearTimer(timer);
      pollTimer = null;
      adoptTimer = null;
      offTalking?.();
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

