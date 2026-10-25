// «Новые» on Fansly in the background: the pass Б17 and its queue (R20 P10b1; docs/project-unite/architecture.md §5.8,
// §8.7; spec FS-NEW-1, FS-NEW-4, FS-NEW-7; NF-030…NF-033, NF-038, NF-039). The answers of `fansly.followers.{scan,
// read,pause,resume,prioritize,history,close,exclude}` for Fansly's background chunk (`bg/fansly`), and the rows that change
// as `fansly.followers.changed` to the tabs whose window holds the pass — the window never polls (the old one asked
// for the whole snapshot every 700 ms).
//
// The pass, as the old extension made it (src/background/followers-service.ts), over FS-NET-1's purpose
// `newcomers` alone — every request through `fansly-api`'s allowlist and the creator's pacer (the port `api`):
// 1. the fast part (`scanning`): the creator's welcome texts (`/message/automated`), the new followers of the period
//    (`followersnew`, ≤ 20 pages of 100, the moment of a follow from its id — NF-030), the start of the inbox (≤ 10
//    pages, positive only: absence there proves nothing), the profiles by 100 with the creator's own names (NF-031),
//    then the check of each fan whose chat the inbox named (NF-032): the participants' fence, the history to its
//    empty page (≤ 30 pages of 25), a personal message of the creator's — «Уже писали» (NF-033);
// 2. the automatic queue (`queue`, NF-039; the owner's decision Б17): the rest one by one — `POST /group` (get-or-
//    create by identity: it may make an empty technical chat; one attempt, never repeated), then the same check.
// A row is `ready` only after its history was walked to the empty page; then the pass keeps its proof for the
// greeting (FS-NEW-7): the ids of the checked history (both directions, the newest 60), the group, and the start
// (`StartProofV1`, `pass-empty-page`: `coveredCount` — every message walked, `personalCount` — the personal ones among
// the last 30, as the old).
//
// FS-NEW-4: nothing runs unless a window opened the pass (`scan`) — never at the browser's start —, and it stops
// when no window holds it. The person's own buttons come first (NF-038): «Пауза» stops the queue after the request
// in flight, «Проверить оставшихся» checks the rest, «Проверить следующим» puts a fan first, and «Проверить чат» on a
// standing queue checks that fan alone, now. A cooldown of the creator's lane (our own 429) is waited out by the
// pacer; meanwhile the pass says `cooldown` with its end — the window's banner — and goes on by itself. Five failures
// of Fansly's in a row stop it (`stopped`, PASS_FUSE); a session Fansly refused stops it at once.
//
// R20 P10b2, FS-NEW-2, FX-003: «Нельзя написать» — the group's own DM rules (`dmPermissionFlags`, Fansly's
// `verifyNew`, domain dm-permissions.ts) the creator meets none of: decided by the check, before anything is
// generated, held or sent, never by a failed `POST /message`; a personal message of the creator's still wins
// («Уже писали»). Such a row keeps no proof for the greeting. «Исключить из очереди» (`fansly.followers.exclude`)
// takes it out of «К обработке» and back, as the old window: only a fan Fansly will not let the creator write to, kept
// in this browser (storage.local, one key per creator and fan) and dropped once a check reads the DMs open again.
//
// R20 P10c (FS-NEW-3, FS-NEW-7; NF-034, NF-036): the greeting takes what the pass proved — `greetingProof` (the
// checked history's ids, the start, the avatar of the profile the pass read), `recheck` (the history read again right
// before the custody: a changed one is a new revision), `live` (the tuple of the send's final check, from memory) and
// `greeted` (the card's greeting went: the row is «Уже писали»). Every walked history is told to the send
// (`onHistory`): a receipt the echo never confirmed is confirmed by it.
// Never: a request for another creator's session, a send of its own, a text in the log. The pass lives in the event
// page's memory: an open window's port keeps the page awake; a pass nobody holds stands still, and the next `scan` of
// its period takes it up again with what it found — only the welcome texts and the followers since its end are read,
// and the new ones checked (2026-10-23).
// Its metadata journal is a separate port (P10b3, NF-029, FS-NEW-5): IDB with rotation and only a small memory tail.
//
// As the old extension (2.13.0), 2026-10-21 (audit regression 7):
// - what a pass proved outlives it (`NEWCOMERS_KNOWN_PREFIX`): a fan written to — the creator's personal message or a
//   greeting of ours that went — is «Уже писали» on the next window without a request, and a fan's chat is a lead
//   instead of `POST /group`. «Nobody wrote» is never kept: it is read again on every pass;
// - a blip of Fansly's (no answer, no tab, a 404) is asked again once, at the end of the queue, after 3 s (2.4.3);
// - the check right before a send never waits out a cooldown: it is refused at once with its end (FS-NET-1 `greeting`).

import { type CgAnyCode, type CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import { SEND_LIMITS } from '@cg/contracts/limits';
import { type StartProofV1 } from '@cg/contracts/fansly';
import {
  FANSLY_TAB_LIMITS,
  type FanslyFollowerRow,
  type FanslyGreetingProof,
  type FanslyPassView,
  type FanslyPreviewMessage,
  type FanslyTabEventPayload,
  type FanslyTabRequestPayload,
  type FanslyTabResponsePayload,
} from '@cg/contracts/tab-messages-fansly';
import { type AbortSignalLike } from '@cg/contracts/hub';
import { LIVE_TEXT_LIMITS } from '@cg/contracts/limits';
import { compareNativeIds, NATIVE_ID_PATTERN } from '@cg/contracts/primitives';
import { NEWCOMER_CHECK_FILTERS, type NewcomerDmClosed } from '@cg/contracts/vm';

import {
  PASS_BOUNDS,
  byId,
  foldText,
  isCreatorPersonal,
  passStartProof,
  previewOf,
  readAccounts,
  readFollowersPage,
  readGroup,
  readHistoryPage,
  readInboxPage,
  readWelcomeTexts,
  snowflakeMs,
  withChatHead,
  windowOf,
  type PassChat,
  type PassMessage,
  type PassProfile,
} from '../../../domain/hosts/fansly/newcomers/pass-rules';
import { checkOf, passRowOf } from '../../../domain/hosts/fansly/newcomers/rows';
import { digestHex } from '../../../domain/ops/digest';
import { inPassTab, matchesPassSearch, passesCheckFilter } from '../../../domain/newcomers/pass';
import { AbortSwitch } from '../../ports';
import { NO_LOG, createWriteChain, type KeyValuePort, type ServiceLog } from '../../storage/ports';
import type { PassJournal, PassJournalEvent, PassJournalFields, PassJournalRun, PassJournalSink } from './newcomers-journal';

export type { PassJournal, PassJournalEvent, PassJournalFields, PassJournalRun, PassJournalSink } from './newcomers-journal';

/** The routes of FS-NET-1's `newcomers` row (fansly-api allowlist.ts): the only ones the pass asks. */
export type NewcomersRoute = 'followers.new' | 'messaging.groups' | 'account.byIds' | 'group.detail' | 'group.create' | 'message.history' | 'message.automated';

export interface NewcomersCall {
  readonly route: NewcomersRoute;
  /** The creator whose session the request carries: always the pass's. */
  readonly account: string;
  readonly path?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  /**
   * The person waits for it (the check right before a send): FS-NET-1's `greeting` reads — their turn in the creator's
   * queue, one attempt, refused at once while the creator cools down, never waited out.
   */
  readonly click?: true;
}

/**
 * Fansly's API as the pass uses it (`bg/fansly` over fansly-api: purpose `newcomers`, the pacer, the session). `call`
 * answers the envelope's `response`; it rejects with the API's failure — its `kind` and `toWire()` (FanslyApiError,
 * read structurally here: the core never imports fansly-api).
 */
export interface FanslyNewcomersApi {
  call(call: NewcomersCall, signal: AbortSignalLike, trace?: PassJournalSink): Promise<unknown>;
  /** When the creator's cooldown ends (epoch ms); 0 or past — none. */
  coolingUntil(account: string): number;
}

export type FollowersChange = FanslyTabEventPayload<'fansly.followers.changed'>;

export interface FanslyNewcomersDeps {
  readonly api: FanslyNewcomersApi;
  readonly now: () => number;
  readonly uuid: () => string;
  readonly monotonicNow?: () => number;
  readonly journal?: PassJournal;
  /** Resolves after `ms`, or as soon as `signal` aborts. */
  readonly sleep: (ms: number, signal: AbortSignalLike) => Promise<void>;
  /** One event to one tab session (and only to it). */
  readonly emit: (tabSessionId: string, change: FollowersChange) => void;
  /** The tab session is still registered. */
  readonly alive: (tabSessionId: string) => boolean;
  /** The tab is on this creator's account (or has not said which yet): a window of another account gets nothing. */
  readonly tabOn: (tabSessionId: string, hostAccountId: string) => boolean;
  /** storage.local: the person's exclusions (R20 P10b2), one key per creator and fan (`NEWCOMERS_EXCLUDED_PREFIX`). */
  readonly local: KeyValuePort;
  readonly log?: ServiceLog;
  /** R20 P10c: a history the pass walked — its group, its ids, read to its start (the send confirms receipts by it). */
  readonly onHistory?: (groupId: string, ids: readonly string[], complete: boolean) => void;
}

/** storage.local: `fansly.newcomers.excluded.<creator>.<fan>` → `{ at }` — the fan is out of «К обработке» (FS-NEW-2). */
export const NEWCOMERS_EXCLUDED_PREFIX = 'fansly.newcomers.excluded.';
/** storage.local: the period of «Новые» the person chose last (X59) — the next window opens on it, in any tab. */
export const NEWCOMERS_WINDOW_KEY = 'fansly.newcomers.window';
/**
 * storage.local: `fansly.newcomers.welcome.<creator>` → `{ texts, checkedAt }` — every welcome text Fansly named for
 * the creator, newest first, as the old extension kept them (`welcome-definitions.ts`): an edited automation's old text
 * still marks the fans who got it as automated, and a read that failed takes these instead of stopping the pass.
 */
export const NEWCOMERS_WELCOME_PREFIX = 'fansly.newcomers.welcome.';
/** Welcome texts kept per creator: far above what a creator has; it only bounds the store. */
const WELCOME_TEXTS_MAX = 200;
/**
 * storage.local: `fansly.newcomers.known.<creator>` → `{ v: 1, fans: { <fan>: KnownFan } }` — what passes proved of the
 * creator's fans, as the old extension kept it (followers-service.ts `chatgoose:followers:v1:{personal,attempt,group}`):
 * the fan's chat, and «Уже писали» — the creator's personal message (its id, time and a digest of its folded text, never
 * the text) or a greeting of ours that went. The next pass takes a written-to fan without a request and a known chat as
 * a lead instead of `POST /group`; a personal message whose text has since become a welcome text proves nothing again.
 */
export const NEWCOMERS_KNOWN_PREFIX = 'fansly.newcomers.known.';
const KNOWN_VERSION = 1;
/** Fans kept per creator, the newest followers first: a bound of the store (a fan past it is simply checked again). */
export const KNOWN_FANS_MAX = 2000;
/** A fan who followed longer ago than the longest period (and a day) is never in a pass again. */
const KNOWN_KEEP_MS = (FANSLY_TAB_LIMITS.windowHoursMax + 24) * 3_600_000;
/** What a pass learned is written this long after the first change (one write for a run of verdicts). */
export const KNOWN_FLUSH_MS = 1000;

interface KnownFan {
  /** The fan's chat with the creator. */
  readonly g: string;
  /** When the fan followed, epoch ms: what bounds the store. */
  readonly f: number;
  /** When it was learned, epoch ms. */
  readonly t: number;
  /** «Уже писали»: the creator's personal message, or `sent` — a greeting of ours went. */
  readonly p?: { readonly id: string; readonly at: number; readonly fold: string } | 'sent';
}

interface KnownBook {
  readonly fans: Map<string, KnownFan>;
  dirty: boolean;
  timer: boolean;
}

/**
 * 2026-10-25: the greeting reminder's check (`remind`) takes the kept welcome texts without asking Fansly while they
 * are this fresh: a check a minute at most, not a read of the automations per check.
 */
export const REMIND_WELCOME_FRESH_MS = 15 * 60_000;
/** The start of the inbox one reminder check reads at most, pages of `PASS_BOUNDS.inboxPage`, back past the oldest follow. */
export const REMIND_INBOX_PAGES = 3;

/** A new follower the greeting reminder asks about: the fan and the follow's moment (epoch ms). */
export interface FanslyRemindFollow {
  readonly fanRef: string;
  readonly followedAt: number;
}

/** What the greeting reminder's check of one new follower found (greet-remind.ts). */
export type FanslyRemindVerdict =
  /**
   * Nobody wrote to the fan, the fan did not write, and Fansly lets the creator write: the reminder is due — with the
   * fan's name, @handle and picture as their profile gives them (null — not read).
   */
  | { readonly s: 'due'; readonly fanLabel: string | null; readonly username?: string | null; readonly avatarUrl?: string | null }
  /** The creator's personal message, or a greeting of ours that went. */
  | { readonly s: 'greeted' }
  | { readonly s: 'wrote' }
  /** «Нельзя написать» (FS-NEW-2), or the person took the fan out of the queue. */
  | { readonly s: 'closed' };

/** A blip of Fansly's is asked again no sooner than this (the old extension's 2.4.3: live 404s came in runs of 2–3 s). */
export const RECHECK_DELAY_MS = 3000;
/**
 * `refresh` reads the follows from this long before the period's end: the end is this machine's clock, a follow's moment
 * Fansly's (its id), and a clock a few seconds ahead of Fansly's would skip a fan who followed right after the read —
 * on every later refresh too. A fan already in the pass is never taken twice.
 */
const REFRESH_OVERLAP_MS = 5 * 60_000;

/** What the greeting (P10c) takes of a checked row (FS-NEW-7): only a history walked to its empty page has one. */
export interface PassRowProof {
  readonly groupId: string;
  readonly historyRevision: string;
  /** The checked history's ids, both directions, the newest 60, oldest first. */
  readonly window: readonly { readonly id: string; readonly dir: 'fan' | 'model' }[];
  readonly startProof: StartProofV1;
}

/**
 * Five failures of Fansly's in a row stop the pass instead of doubling the load on a failing Fansly (the old fuse).
 * As in the old extension, only Fansly failing counts — no answer, no answer in time, no tab, a 404, a 5xx, a limit
 * not waited out —; a row's own failure (an odd chat, a page that did not parse, a refusal for this fan) is the row's
 * and starts the run over: one odd fan does not stop the check (2026-10-20 restrictions, item 16).
 */
export const PASS_FUSE = 5;

/** Whether a failure is Fansly failing (counts toward PASS_FUSE), not the row's own. */
function fanslyFailing(kind: string, wire: CgAnyErrorWire): boolean {
  if (kind === 'network' || kind === 'timeout' || kind === 'tab' || kind === 'rate-limited' || kind === 'cooling') return true;
  if (kind !== 'http') return false;
  const status = wire.httpStatus ?? 0;
  return status === 0 || status === 404 || status >= 500;
}

/**
 * A blip, asked again once (the old extension's 2.4.3, E130/E133): no answer, no tab, a 404 Fansly gives for a second or
 * two on routes that work. A 5xx already spent the client's own retries; a refusal or a timeout would end the same way.
 */
function blip(kind: string, wire: CgAnyErrorWire): boolean {
  if (kind === 'network' || kind === 'tab') return true;
  const status = wire.httpStatus ?? 0;
  return kind === 'http' && (status === 0 || status === 404);
}
/** While a call is in flight, the creator's cooldown is looked at this often, for the banner. */
export const COOLING_LOOK_MS = 1000;
/** A cooldown that refused a call that never left is waited out at most this many times for one call. */
const COOLING_ROUNDS = 3;

type Base = 'scanning' | 'queue' | 'paused' | 'done' | 'stopped';
type Phase = NonNullable<FanslyPassView['phase']>;

interface Row {
  view: FanslyFollowerRow;
  chat: PassChat | null;
  /** The newest messages of the walked history (oldest first), for the card. */
  kept: PassMessage[];
  /** `kept` holds the whole history, to its start. */
  keptAll: boolean;
  proof: PassRowProof | null;
  /** R20 P10c (FX-018): the avatar's address of the profile the pass read; null — none fit to send. */
  avatar: string | null;
}

interface Work {
  readonly stop: AbortSwitch;
  readonly done: Promise<void>;
  /** Rows a blip sent to the end of the queue: when they may be asked again. */
  readonly again: Map<string, number>;
  /** Rows asked again already in this run: a second blip is their failure. */
  readonly spent: Set<string>;
}

const workOf = (stop: AbortSwitch, done: Promise<void> = Promise.resolve()): Work => ({ stop, done, again: new Map(), spent: new Set() });

/** A chat a book names: a lead like a thin inbox entry — the check's fence confirms it before anything rests on it. */
const knownChat = (fanRef: string, groupId: string): PassChat => ({ fanRef, groupId, verified: false, last: null, lastKnown: false, lastMessageId: null, dmRead: false, dmClosed: null });

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** An entry of a book as storage gave it; null — not one (a damaged or foreign value proves nothing). */
function knownOf(value: unknown): KnownFan | null {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as { readonly g?: unknown; readonly f?: unknown; readonly t?: unknown; readonly p?: unknown };
  if (typeof entry.g !== 'string' || !NATIVE_ID_PATTERN.test(entry.g) || !finite(entry.f) || !finite(entry.t)) return null;
  const base = { g: entry.g, f: entry.f, t: entry.t };
  if (entry.p === undefined) return base;
  if (entry.p === 'sent') return { ...base, p: 'sent' };
  const p = personalOf(entry.p);
  return p === null ? base : { ...base, p };
}

function personalOf(value: unknown): Exclude<KnownFan['p'], 'sent' | undefined> | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, at, fold } = value as { readonly id?: unknown; readonly at?: unknown; readonly fold?: unknown };
  return typeof id === 'string' && NATIVE_ID_PATTERN.test(id) && finite(at) && typeof fold === 'string' ? { id, at, fold } : null;
}

const sameProof = (a: KnownFan['p'], b: KnownFan['p']): boolean =>
  a === b || (typeof a === 'object' && typeof b === 'object' && a.id === b.id && a.fold === b.fold);

interface Pass {
  readonly id: string;
  readonly creator: string;
  readonly windowHours: number;
  /** The end of the period: the scan's moment, moved to now when a window takes the pass up again (`refresh`). */
  startedAt: number;
  readonly journal: PassJournalSink | undefined;
  base: Base;
  phase: Phase | null;
  partial: boolean;
  error: CgAnyErrorWire | null;
  coolingUntil: number | null;
  welcome: Set<string>;
  /** Successful follower pages survive a failed request; a continuation retries its cursor. */
  readonly followers: { before: string; pages: number; read: boolean; readonly cursors: Set<string> };
  readonly rows: Row[];
  readonly byFan: Map<string, Row>;
  /** Chats the inbox named: leads the check confirms. */
  readonly leads: Map<string, PassChat>;
  readonly watchers: Set<string>;
  readonly life: AbortSwitch;
  work: Work | null;
  preferred: string | null;
  seq: number;
  readonly dirty: Set<Row>;
  passDirty: boolean;
  flushing: boolean;
}

type Payload<T extends keyof typeof REQUESTS> = FanslyTabRequestPayload<T>;
type Answer<T extends keyof typeof REQUESTS> = FanslyTabResponsePayload<T>;
const REQUESTS = {
  'fansly.followers.scan': true,
  'fansly.followers.read': true,
  'fansly.followers.pause': true,
  'fansly.followers.resume': true,
  'fansly.followers.prioritize': true,
  'fansly.followers.history': true,
  'fansly.followers.close': true,
  // R20 P10b2: «Исключить из очереди» / «Вернуть в очередь» (FS-NEW-2).
  'fansly.followers.exclude': true,
} as const;

/** A failure the pass names itself (a malformed answer, a group whose users are not the two). */
class PassFailure extends Error {
  readonly kind = 'malformed';
  constructor(readonly wire: CgAnyErrorWire) {
    super(`newcomers pass: ${wire.code}`);
  }
  toWire(): CgAnyErrorWire {
    return this.wire;
  }
}

class Aborted extends Error {}

/** The API's failure read structurally: its kind and wire form; anything else is a request that failed. */
function failureOf(error: unknown): { readonly kind: string; readonly wire: CgAnyErrorWire } {
  if (typeof error === 'object' && error !== null) {
    const e = error as { kind?: unknown; toWire?: unknown };
    if (typeof e.kind === 'string' && typeof e.toWire === 'function') return { kind: e.kind, wire: (e.toWire as () => CgAnyErrorWire).call(error) };
  }
  return { kind: 'thrown', wire: { code: 'CG-FAN-REQUEST' } };
}

const CHECKED = new Set<FanslyFollowerRow['status']>(['ready', 'greeted', 'dm-closed', 'excluded']);
/** Why a row has nothing to greet with: written to already, nobody can write, or its history is not proven (yet). */
export function notReady(view: FanslyFollowerRow): CgAnyCode {
  if (view.status === 'greeted') return 'CG-SEND-PART';
  if (view.status === 'dm-closed' || view.status === 'excluded') return 'CG-FNEW-DM-CLOSED';
  return 'CG-FNEW-UNVERIFIED';
}

/** A row the queue still has to check: never checked, failed, or interrupted. */
/**
 * The revision of a fan's history: the same messages read as the same revision in every pass (FS-NEW-6 asks only that
 * a changed history changes it), so reopening the window or checking again keeps the drafts made on it. Uuid-shaped.
 */
function revisionOf(creator: string, groupId: string, history: readonly PassMessage[]): string {
  const key = `${creator}|${groupId}|${history.map((message) => message.id).join(',')}`;
  const hex = digestHex(key) + digestHex(`~${key}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const needsCheck = (row: Row): boolean => row.view.status === 'pending' || row.view.status === 'failed' || row.view.status === 'checking';

export type FanslyNewcomers = ReturnType<typeof createFanslyNewcomers>;

export function createFanslyNewcomers(deps: FanslyNewcomersDeps) {
  const log = deps.log ?? NO_LOG;
  const monotonicNow = deps.monotonicNow ?? deps.now;
  const note = (pass: Pass, event: PassJournalEvent, fields?: PassJournalFields): void => {
    try { pass.journal?.(event, fields); } catch { /* Diagnostics never stop the pass. */ }
  };
  const journalFor = (run: PassJournalRun): PassJournalSink | undefined => {
    try { return deps.journal?.start(run); } catch { return undefined; }
  };
  /** One pass per creator: the newest scan's. */
  const passes = new Map<string, Pass>();
  const byId_ = new Map<string, Pass>();
  /** One open window per tab; its old id may follow a replacement until the window reads the new id. */
  const windows = new Map<string, { readonly passId: string; readonly creator: string }>();

  const iso = (ms: number): string => new Date(ms).toISOString();

  // ── the view and its changes ──

  function stateOf(pass: Pass): FanslyPassView['state'] {
    return pass.coolingUntil !== null && (pass.base === 'scanning' || pass.base === 'queue') ? 'cooldown' : pass.base;
  }

  function viewOf(pass: Pass): FanslyPassView {
    const counts = { total: pass.rows.length, checked: 0, ready: 0, greeted: 0, dmClosed: 0, excluded: 0 };
    for (const { view } of pass.rows) {
      if (CHECKED.has(view.status)) counts.checked += 1;
      if (view.status === 'ready') counts.ready += 1;
      else if (view.status === 'greeted') counts.greeted += 1;
      else if (view.status === 'dm-closed') counts.dmClosed += 1;
      else if (view.status === 'excluded') counts.excluded += 1;
    }
    const state = stateOf(pass);
    return {
      passId: pass.id,
      hostAccountId: pass.creator,
      windowHours: pass.windowHours,
      state,
      startedAt: iso(pass.startedAt),
      counts,
      partial: pass.partial,
      cooldownUntil: state === 'cooldown' ? pass.coolingUntil : null,
      error: pass.error,
      phase: pass.base === 'scanning' ? pass.phase : null,
    };
  }

  /** The rows and the pass changed: told once the current step is over, in events of at most 100 rows. */
  function touch(pass: Pass, row?: Row): void {
    if (row === undefined) pass.passDirty = true;
    else pass.dirty.add(row);
    if (pass.flushing) return;
    pass.flushing = true;
    void Promise.resolve().then(() => flush(pass));
  }

  function flush(pass: Pass): void {
    pass.flushing = false;
    for (const tab of [...pass.watchers]) {
      if (!deps.alive(tab)) {
        pass.watchers.delete(tab);
        windows.delete(tab);
      }
    }
    if (pass.watchers.size === 0) {
      pass.dirty.clear();
      pass.passDirty = false;
      // Nobody holds the pass any more (its tabs are gone): it stops (FS-NEW-4).
      standStill(pass);
      return;
    }
    const rows = [...pass.dirty].map((row) => row.view);
    pass.dirty.clear();
    pass.passDirty = false;
    const view = viewOf(pass);
    const step = FANSLY_TAB_LIMITS.followerRowsPerChange;
    for (let at = 0; at === 0 || at < rows.length; at += step) {
      pass.seq += 1;
      const change: FollowersChange = { pass: view, seq: pass.seq, rows: rows.slice(at, at + step) };
      for (const tab of pass.watchers) deps.emit(tab, change);
    }
  }

  function set(pass: Pass, row: Row, patch: Partial<FanslyFollowerRow>): void {
    if (patch.status !== undefined && patch.status !== row.view.status) note(pass, 'row.verdict', { fanRef: row.view.fanRef, groupId: row.chat?.groupId, status: patch.status, code: patch.error?.code, reason: patch.status === 'ready' ? 'history-start' : patch.status === 'greeted' ? 'creator-personal' : patch.status });
    row.view = { ...row.view, ...patch };
    touch(pass, row);
  }

  // ── asking Fansly ──

  /**
   * One call of the pass: its creator's session, the work's signal; a cooldown that refused it is waited out — but for
   * a `click` (the check right before a send), which is refused at once.
   */
  async function ask(pass: Pass, work: Work, call: Omit<NewcomersCall, 'account'>): Promise<unknown> {
    for (let round = 0; ; round += 1) {
      if (work.stop.aborted) throw new Aborted();
      const started = monotonicNow();
      note(pass, 'call.start', { route: call.route, attempt: round + 1 });
      try {
        const answer = await deps.api.call({ ...call, account: pass.creator }, work.stop, pass.journal === undefined ? undefined : (event, fields) => note(pass, event, fields));
        note(pass, 'call.end', { route: call.route, durationMs: Math.max(0, monotonicNow() - started) });
        return answer;
      } catch (error) {
        const { kind, wire } = failureOf(error);
        note(pass, 'call.failed', { route: call.route, kind, code: wire.code, httpStatus: wire.httpStatus, retryAt: wire.retryAt, durationMs: Math.max(0, monotonicNow() - started) });
        if (work.stop.aborted) throw new Aborted();
        if (call.click === true) throw error;
        // `cooling` never left (POST /group in a cooldown); `rate-limited` — the reads' own retries are spent.
        const waitable = kind === 'cooling' || (kind === 'rate-limited' && round === 0);
        const until = deps.api.coolingUntil(pass.creator);
        if (!waitable || round >= COOLING_ROUNDS || until <= deps.now()) throw error;
        note(pass, 'call.wait', { route: call.route, waitMs: until - deps.now(), retryAt: until });
        look(pass);
        await deps.sleep(until - deps.now(), work.stop);
      }
    }
  }

  /** The banner: the creator's lane cools down now, or no longer. */
  function look(pass: Pass): void {
    const until = deps.api.coolingUntil(pass.creator);
    const next = until > deps.now() ? until : null;
    if (next === pass.coolingUntil) return;
    pass.coolingUntil = next;
    touch(pass);
  }

  /** Looks at the cooldown while the work runs (the pacer may wait one out inside a call). */
  async function watchCooling(pass: Pass, work: Work, running: () => boolean): Promise<void> {
    while (running() && !work.stop.aborted) {
      look(pass);
      await deps.sleep(COOLING_LOOK_MS, work.stop);
    }
    if (pass.coolingUntil !== null) {
      pass.coolingUntil = null;
      touch(pass);
    }
  }

  // ── the work ──

  function begin(pass: Pass, base: 'scanning' | 'queue', body: (work: Work) => Promise<void>): Work {
    const stop = new AbortSwitch();
    pass.life.addEventListener('abort', () => stop.abort());
    let running = true;
    pass.base = base;
    note(pass, 'queue.start', { state: base });
    if (!pass.partial || pass.followers.read) pass.error = null;
    touch(pass);
    const work: Work = {
      stop,
      done: Promise.resolve().then(async () => {
        void watchCooling(pass, work, () => running);
        try {
          await body(work);
          if (!stop.aborted) settle(pass, 'done');
        } catch (error) {
          if (error instanceof Aborted || stop.aborted) settle(pass, pass.base === 'stopped' ? 'stopped' : 'paused');
          else halt(pass, failureOf(error).wire);
        } finally {
          running = false;
          for (const row of pass.rows) if (row.view.status === 'checking') set(pass, row, { status: 'pending' });
          if (pass.work === work) pass.work = null;
          touch(pass);
        }
      }),
      again: new Map(),
      spent: new Set(),
    };
    pass.work = work;
    return work;
  }

  /** The work is over: `done` when nothing is left to check, otherwise it stands (`paused`). */
  function settle(pass: Pass, to: 'done' | 'paused' | 'stopped'): void {
    if (pass.base === 'stopped' && to !== 'stopped') return;
    pass.phase = null;
    pass.base = to === 'paused' && !pass.rows.some(needsCheck) ? 'done' : to;
    note(pass, 'pass.end', { state: pass.base, total: pass.rows.length, complete: !pass.partial });
  }

  function halt(pass: Pass, wire: CgAnyErrorWire): void {
    pass.base = 'stopped';
    pass.phase = null;
    pass.error = wire;
    note(pass, 'pass.stop', { code: wire.code, total: pass.rows.length });
    log({ level: 'warn', scope: 'bg.fansly.newcomers', msg: 'the pass stopped', fields: { code: wire.code, rows: pass.rows.length } });
    pass.work?.stop.abort();
  }

  /** «Пауза», a closed window: the work stops after the request in flight; what it found stays. */
  function standStill(pass: Pass): void {
    if (pass.work === null) return;
    note(pass, 'queue.pause', { state: pass.base });
    if (pass.base !== 'stopped') pass.base = 'paused';
    pass.work.stop.abort();
  }

  function phase(pass: Pass, next: Phase): void {
    pass.phase = next;
    note(pass, 'pass.phase', { phase: next });
    touch(pass);
  }

  /** The fast part (NF-030, NF-031, NF-032), then the queue (NF-039). */
  async function fastPart(pass: Pass, work: Work): Promise<void> {
    phase(pass, 'welcome');
    pass.welcome = await welcomeTexts(pass, work);

    phase(pass, 'followers');
    await followers(pass, work, pass.startedAt - pass.windowHours * 3_600_000);
    await afterList(pass, work, false);
  }

  /**
   * A window opened again on a pass that stands, or ⟳ (the owner, 2026-10-23: closing and opening the window must not
   * check everyone again): what the pass found stays — the welcome texts are read again (an automation edited meanwhile
   * is the new followers' first message), the followers since its end are read, the period moves to now, and the new
   * fans, with those whose check failed, are checked as in the fast part.
   */
  async function refresh(pass: Pass, work: Work): Promise<void> {
    phase(pass, 'welcome');
    // The texts read before stay: a fan in the queue who followed before the edit got the old one.
    pass.welcome = new Set([...pass.welcome, ...(await welcomeTexts(pass, work))]);

    phase(pass, 'followers');
    await newFollowers(pass, work);
    await afterList(pass, work, true);
  }

  /** What follows the list: what earlier passes proved, the inbox's leads, the profiles, the known chats, the queue. */
  async function afterList(pass: Pass, work: Work, retry: boolean): Promise<void> {
    const cutoff = pass.startedAt - pass.windowHours * 3_600_000;
    // What earlier passes proved: a fan written to needs no request; a known chat is a lead the inbox did not give.
    const book = await bookOf(pass.creator);
    if (work.stop.aborted) throw new Aborted();
    knownVerdicts(pass, book);

    await inbox(pass, work, cutoff);
    knownLeads(pass, book);
    phase(pass, 'profiles');
    await profiles(pass, work);
    phase(pass, 'checking');
    let fails = 0;
    // The chats already known, newest first — the person's choice (a click on the row) before them, as it comes.
    const seen = new Set<string>();
    const lead = (row: Row | undefined): row is Row => row !== undefined && !seen.has(row.view.fanRef) && row.view.status === 'pending' && pass.leads.has(row.view.fanRef);
    for (;;) {
      const chosen = pass.preferred === null ? undefined : pass.byFan.get(pass.preferred);
      const row = lead(chosen) ? chosen : pass.rows.find(lead);
      if (row === undefined) break;
      seen.add(row.view.fanRef);
      if (pass.preferred === row.view.fanRef) pass.preferred = null;
      fails = await checkOne(pass, work, row, false, fails);
    }
    pass.phase = null;
    pass.base = 'queue';
    touch(pass);
    await queue(pass, work, null, retry);
  }

  /** A page of the creator's new followers, the newest first, before the follow `before` ('0' — from the newest). */
  async function followersPage(pass: Pass, work: Work, before: string): Promise<NonNullable<ReturnType<typeof readFollowersPage>>> {
    const answer = readFollowersPage(
      await ask(pass, work, {
        route: 'followers.new',
        path: { account: pass.creator },
        query: { before, after: '0', limit: String(PASS_BOUNDS.followerPage), offset: '0', search: '', lastSeenAfter: '' },
      }),
    );
    if (answer === null) throw new PassFailure({ code: 'CG-FAN-REQUEST' });
    return answer;
  }

  /**
   * The rows of a page's follows from `from` to `to` the pass has not got yet; answers the moment of its oldest follow.
   * A follow Fansly dates more than a minute ahead of this machine (a slow clock) was made by the time it was read: it is
   * at the period's end `to` — on `refresh`, now —, never at 0, which would end the list at this page as read to its end.
   */
  function takeFollows(pass: Pass, answer: NonNullable<ReturnType<typeof readFollowersPage>>, from: number, to: number): number {
    const profiles = new Map(answer.profiles.map((profile) => [profile.fanRef, profile]));
    let oldest = Infinity;
    for (const follow of answer.follows) {
      const at = snowflakeMs(follow.id, deps.now()) ?? to;
      oldest = Math.min(oldest, at);
      if (at < from || at > to || pass.byFan.has(follow.fanRef) || follow.fanRef === pass.creator) continue;
      const row: Row = { view: rowView(follow.fanRef, at, profiles.get(follow.fanRef)), chat: null, kept: [], keptAll: false, proof: null, avatar: profiles.get(follow.fanRef)?.avatarUrl ?? null };
      pass.rows.push(row);
      pass.byFan.set(follow.fanRef, row);
      touch(pass, row);
    }
    return oldest;
  }

  const byFollowed = (a: Row, b: Row): number => Date.parse(b.view.followedAt) - Date.parse(a.view.followedAt);

  async function followers(pass: Pass, work: Work, cutoff: number): Promise<void> {
    const progress = pass.followers;
    if (progress.read) return;
    let complete = false;
    try {
      while (progress.pages < PASS_BOUNDS.followerPages) {
        const answer = await followersPage(pass, work, progress.before);
        progress.pages += 1;
        note(pass, 'followers.page', { page: progress.pages, count: answer.follows.length });
        const oldest = takeFollows(pass, answer, cutoff, pass.startedAt);
        if (answer.follows.length < PASS_BOUNDS.followerPage || oldest < cutoff) {
          complete = true;
          break;
        }
        const next = answer.follows.at(-1)?.id ?? progress.before;
        if (progress.cursors.has(next)) break;
        progress.cursors.add(next);
        progress.before = next;
      }
    } catch (error) {
      pass.partial = true;
      touch(pass);
      throw error;
    }
    // «Результат неполный» (NF-025): Fansly did not let the period be read to its end.
    progress.read = true;
    pass.partial = !complete;
    if (complete) pass.error = null;
    pass.rows.sort(byFollowed);
    touch(pass);
  }

  /**
   * `refresh`: the follows since the period's end, the newest first — from REFRESH_OVERLAP_MS before it, a fan already in
   * the pass keeping their row —; then the period ends now and the fans before its new start leave it.
   */
  async function newFollowers(pass: Pass, work: Work): Promise<void> {
    const since = pass.startedAt - REFRESH_OVERLAP_MS;
    const until = deps.now();
    const cursors = new Set<string>();
    let before = '0';
    let reached = false;
    for (let page = 1; page <= PASS_BOUNDS.followerPages; page += 1) {
      const answer = await followersPage(pass, work, before);
      note(pass, 'followers.page', { page, count: answer.follows.length });
      const oldest = takeFollows(pass, answer, since, until);
      if (answer.follows.length < PASS_BOUNDS.followerPage || oldest < since) {
        reached = true;
        break;
      }
      const next = answer.follows.at(-1)?.id ?? before;
      if (cursors.has(next)) break;
      cursors.add(next);
      before = next;
    }
    if (!reached) pass.partial = true;
    pass.startedAt = until;
    const cutoff = until - pass.windowHours * 3_600_000;
    for (const row of pass.rows) if (Date.parse(row.view.followedAt) < cutoff) pass.byFan.delete(row.view.fanRef);
    const kept = pass.rows.filter((row) => pass.byFan.get(row.view.fanRef) === row).sort(byFollowed);
    pass.rows.splice(0, pass.rows.length, ...kept);
    touch(pass);
  }

  /**
   * The start of the inbox (NF-031): chats of the period's followers still to check (a fan an earlier pass found written
   * to is not looked for). Positive only; a failure leaves no lead.
   */
  async function inbox(pass: Pass, work: Work, cutoff: number): Promise<void> {
    const wanted = new Set(pass.rows.filter((row) => row.view.status === 'pending' && !pass.leads.has(row.view.fanRef)).map((row) => row.view.fanRef));
    if (wanted.size === 0) return;
    const found = (): number => [...wanted].filter((fan) => pass.leads.has(fan)).length;
    const read = async (offset: number): Promise<ReturnType<typeof readInboxPage>> => {
      const page = readInboxPage(
        await ask(pass, work, {
          route: 'messaging.groups',
          query: { sortOrder: '1', flags: '0', subscriptionTierId: '', listIds: '', search: '', limit: String(PASS_BOUNDS.inboxPage), offset: String(offset) },
        }),
        pass.creator,
        wanted,
        deps.now(),
      );
      for (const chat of page?.chats ?? []) pass.leads.set(chat.fanRef, chat);
      note(pass, 'inbox.page', { page: Math.floor(offset / PASS_BOUNDS.inboxPage) + 1, count: page?.count ?? 0, total: pass.leads.size });
      return page;
    };
    try {
      let pages = 0;
      while (pages < PASS_BOUNDS.inboxPages) {
        const page = await read(pages * PASS_BOUNDS.inboxPage);
        pages += 1;
        if (page === null) break;
        const tail = page.tail === null ? null : snowflakeMs(page.tail, deps.now());
        if (found() >= wanted.size || page.count < PASS_BOUNDS.inboxPage || tail === null || tail < cutoff) break;
      }
      // Chats that jumped to the top meanwhile.
      if (pages > 1 && found() < wanted.size) await read(0);
    } catch (error) {
      if (error instanceof Aborted || stopsPass(error)) throw error;
      log({ level: 'warn', scope: 'bg.fansly.newcomers', msg: 'the inbox was not read; the queue finds the chats', fields: { code: failureOf(error).wire.code } });
    }
  }

  /** Profiles by 100 (NF-031): a name, the «about», the creator's own name for the fan. A failure leaves them unknown. */
  async function profiles(pass: Pass, work: Work): Promise<void> {
    const missing = pass.rows.filter((row) => row.view.username === null || row.view.customName === undefined);
    for (let at = 0; at < missing.length; at += PASS_BOUNDS.profileBatch) {
      const batch = missing.slice(at, at + PASS_BOUNDS.profileBatch);
      try {
        const read = readAccounts(await ask(pass, work, { route: 'account.byIds', query: { ids: batch.map((row) => row.view.fanRef).join(',') } }));
        note(pass, 'profiles.batch', { page: Math.floor(at / PASS_BOUNDS.profileBatch) + 1, count: read?.length ?? 0 });
        for (const profile of read ?? []) {
          const row = pass.byFan.get(profile.fanRef);
          if (row === undefined) continue;
          if (profile.avatarUrl !== null) row.avatar = profile.avatarUrl;
          set(pass, row, profileFields(profile, row.view));
        }
      } catch (error) {
        if (error instanceof Aborted || stopsPass(error)) throw error;
        log({ level: 'warn', scope: 'bg.fansly.newcomers', msg: 'profiles not read', fields: { code: failureOf(error).wire.code, count: batch.length } });
        return;
      }
    }
  }

  /**
   * The queue (NF-039): the rows left, the person's choice first; `only` — «Проверить чат» on a standing queue. The
   * automatic one after the fast part takes the fans never checked; `retry` (the person's «Проверить оставшихся») the
   * failed ones too, as the old «Продолжить».
   */
  async function queue(pass: Pass, work: Work, only: string | null, retry = false): Promise<void> {
    const wanted = (row: Row): boolean => (retry || only !== null ? needsCheck(row) : row.view.status === 'pending');
    let fails = 0;
    const tried = new Set<string>();
    for (;;) {
      if (work.stop.aborted) throw new Aborted();
      const fresh = only !== null ? (tried.has(only) ? undefined : pass.byFan.get(only)) : nextRow(pass, work, tried, wanted);
      // Nothing new is left: the blips, once each, after their pause (the end of the old queue).
      const row = fresh ?? againRow(pass, work, only);
      if (row === undefined) return;
      const fan = row.view.fanRef;
      if (fresh === undefined) {
        const at = work.again.get(fan) ?? 0;
        work.again.delete(fan);
        work.spent.add(fan);
        if (at > deps.now()) await deps.sleep(at - deps.now(), work.stop);
        if (work.stop.aborted) throw new Aborted();
        if (!needsCheck(row)) continue;
      } else {
        tried.add(fan);
        // The person's choice taken before its turn at the end: this is its one more time.
        if (work.again.delete(fan)) work.spent.add(fan);
        if (only === null && pass.preferred === fan) pass.preferred = null;
        if (!wanted(row)) continue;
      }
      fails = await checkOne(pass, work, row, true, fails);
    }
  }

  function nextRow(pass: Pass, work: Work, tried: ReadonlySet<string>, wanted: (row: Row) => boolean): Row | undefined {
    const preferred = pass.preferred === null ? undefined : pass.byFan.get(pass.preferred);
    // The person's choice is checked whatever it failed with before.
    if (preferred !== undefined && !tried.has(preferred.view.fanRef) && needsCheck(preferred)) return preferred;
    return order(pass).find((row) => !tried.has(row.view.fanRef) && !work.again.has(row.view.fanRef) && wanted(row));
  }

  /** The row a blip sent to the end of the queue that is due first; `only` — that fan's alone. */
  function againRow(pass: Pass, work: Work, only: string | null): Row | undefined {
    let due: Row | undefined;
    let dueAt = Infinity;
    for (const [fan, at] of work.again) {
      const row = pass.byFan.get(fan);
      if (row === undefined || (only !== null && fan !== only)) continue;
      if (at < dueAt) {
        due = row;
        dueAt = at;
      }
    }
    return due;
  }

  /** Newest followers first; the person's choice before them. */
  function order(pass: Pass): Row[] {
    const preferred = pass.preferred;
    return preferred === null ? pass.rows : [...pass.rows].sort((a, b) => Number(b.view.fanRef === preferred) - Number(a.view.fanRef === preferred));
  }

  const stopsPass = (error: unknown): boolean => {
    const { kind } = failureOf(error);
    return kind === 'session' || kind === 'expired';
  };

  /**
   * Checks one row; a failure is the row's, five of Fansly's in a row (or a session refused) stop the pass. A blip goes
   * to the end of the queue once (2.4.3), never a failed `POST /group`. Answers the run of failures.
   */
  async function checkOne(pass: Pass, work: Work, row: Row, create: boolean, fails: number): Promise<number> {
    const before = row.view.status;
    const fan = row.view.fanRef;
    try {
      await check(pass, work, row, create);
      return 0;
    } catch (error) {
      if (error instanceof Aborted || work.stop.aborted) {
        set(pass, row, { status: before === 'checking' ? 'pending' : before });
        throw new Aborted();
      }
      const { kind, wire } = failureOf(error);
      const run = fanslyFailing(kind, wire) ? fails + 1 : 0;
      row.proof = null;
      if (!stopsPass(error) && run < PASS_FUSE && blip(kind, wire) && !fromWrite.has(error as object) && !work.spent.has(fan) && !work.again.has(fan)) {
        work.again.set(fan, deps.now() + RECHECK_DELAY_MS);
        note(pass, 'row.recheck', { fanRef: fan, kind, code: wire.code, httpStatus: wire.httpStatus, waitMs: RECHECK_DELAY_MS });
        set(pass, row, { status: 'pending', error: null, historyRevision: null, dmClosed: null, dmPriceMills: null });
        return run;
      }
      set(pass, row, { status: 'failed', error: wire, checkedAt: iso(deps.now()), historyRevision: null, dmClosed: null, dmPriceMills: null });
      if (stopsPass(error) || run >= PASS_FUSE) {
        halt(pass, wire);
        throw new Aborted();
      }
      return run;
    }
  }

  /**
   * The check of one fan (NF-032): the chat — the inbox's lead, confirmed by `GET /group` when its answer did not list
   * both users, or, in the queue, `POST /group` —, then its history to the empty page; a personal message of the
   * creator's ends it: «Уже писали».
   */
  async function check(pass: Pass, work: Work, row: Row, create: boolean, click = false): Promise<void> {
    const fan = row.view.fanRef;
    const users = [pass.creator, fan];
    const asked = (call: Omit<NewcomersCall, 'account'>): Promise<unknown> => ask(pass, work, click ? { ...call, click: true } : call);
    let chat = row.chat ?? pass.leads.get(fan) ?? null;
    const booked = chat !== null && row.chat === null && bookChats.has(chat);
    if (chat !== null) note(pass, 'chat.reuse', { fanRef: fan, groupId: chat.groupId, reason: row.chat !== null ? 'checked' : booked ? 'known' : 'inbox' });
    if (chat === null && !create) return;
    set(pass, row, { status: 'checking', error: null });
    const make = async (): Promise<PassChat> => {
      // NF-039: get-or-create by identity — one attempt; it may make an empty technical chat (Б17).
      const body = { users: [{ userId: fan, permissionFlags: 0 }, { userId: pass.creator, permissionFlags: 0 }], recipients: [], lastMessage: null, userSettings: null, type: 1 };
      const made = await ask(pass, work, { route: 'group.create', body }).catch((error: unknown) => {
        // Never asked again by itself: a blip of the write is the row's failure.
        if (typeof error === 'object' && error !== null) fromWrite.add(error);
        throw error;
      });
      const created = readGroup(made, pass.creator, fan, deps.now());
      if (created === null) throw new PassFailure({ code: 'CG-FAN-GROUP' });
      return created;
    };
    if (chat === null) chat = await make();
    else if (!chat.verified) {
      // The participants' fence: a lead is a fact only once its group lists exactly the two.
      let confirmed: PassChat | null;
      try {
        confirmed = readGroup(await asked({ route: 'group.detail', path: { group: chat.groupId } }), pass.creator, fan, deps.now(), chat.groupId);
      } catch (error) {
        // A chat this browser kept that Fansly no longer gives as theirs is forgotten (a blip is only a blip).
        const { kind } = failureOf(error);
        if (!booked || (kind !== 'http' && kind !== 'refused' && kind !== 'malformed')) throw error;
        confirmed = null;
      }
      if (confirmed === null && !booked) throw new PassFailure({ code: 'CG-FAN-GROUP' });
      if (confirmed === null) {
        forget(pass, fan, chat.groupId);
        // The queue's get-or-create finds the fan's chat; the fast part leaves the row to it.
        if (!create) {
          set(pass, row, { status: 'pending' });
          return;
        }
        chat = await make();
      } else chat = withChatHead(confirmed, chat.lastMessageId, chat.lastKnown);
    }
    row.chat = chat;
    learn(pass, row, chat.groupId);
    if (row.view.groupId !== chat.groupId) set(pass, row, { groupId: chat.groupId });
    const lastPersonal = chat.last !== null && isCreatorPersonal(chat.last, pass.creator, pass.welcome) ? chat.last : null;
    // The fast part trusts a last message of the creator's own as «Уже писали» without reading the history (the old).
    if (lastPersonal !== null && !create) {
      note(pass, 'message.classify', { fanRef: fan, groupId: chat.groupId, messageId: lastPersonal.id, classification: 'creator-personal' });
      return greeted(pass, row, lastPersonal, [lastPersonal]);
    }

    const walked = new Map<string, PassMessage>();
    let personal: PassMessage | null = null;
    let complete = false;
    let cursor: string | null = null;
    for (let page = 0; page < PASS_BOUNDS.historyPages; page += 1) {
      const query: Record<string, string> = { groupId: chat.groupId, limit: String(PASS_BOUNDS.historyPage) };
      if (cursor !== null) query['before'] = cursor;
      const messages = readHistoryPage(await asked({ route: 'message.history', query }), chat.groupId, users, deps.now());
      if (messages === null) throw new PassFailure({ code: 'CG-FNEW-HISTORY' });
      note(pass, 'history.page', { fanRef: fan, groupId: chat.groupId, page: page + 1, count: messages.length, complete: messages.length === 0 && !(page === 0 && chat.lastKnown) });
      for (const message of messages) note(pass, 'message.classify', { fanRef: fan, groupId: chat.groupId, messageId: message.id, classification: message.senderId === fan ? 'fan' : isCreatorPersonal(message, pass.creator, pass.welcome) ? 'creator-personal' : 'automated-or-system' });
      for (const message of messages) walked.set(message.id, message);
      personal = messages.find((message) => isCreatorPersonal(message, pass.creator, pass.welcome)) ?? null;
      if (personal !== null) break;
      if (messages.length === 0) {
        // An empty page proves the start only when the walk also covers every known fact about the head.
        complete = (!chat.lastKnown || walked.size > 0) && (chat.lastMessageId === null || walked.has(chat.lastMessageId));
        break;
      }
      const oldest = [...messages].sort(byId)[0]?.id ?? null;
      if (oldest === null || oldest === cursor) break;
      cursor = oldest;
    }
    personal ??= lastPersonal;
    const history = [...walked.values()].sort(byId);
    // A receipt of our greeting the echo never confirmed is confirmed by the history that shows its id (§8.6).
    deps.onHistory?.(chat.groupId, history.map((message) => message.id), complete);
    if (personal !== null) return greeted(pass, row, personal, history);
    row.kept = history.slice(-PASS_BOUNDS.previewKept);
    row.keptAll = complete && history.length <= PASS_BOUNDS.previewKept;
    // FS-NEW-2: Fansly will not let the creator write — whatever the history: nothing is generated, held or sent.
    if (chat.dmClosed !== null) return closed(pass, work, row, chat.dmClosed, chat.dmPriceMills ?? null);
    // Only a history read to its confirmed end is evidence that nobody wrote (the old fail-closed rule).
    if (!complete) throw new PassFailure({ code: 'CG-FNEW-HISTORY' });
    // The DMs are open (again): an exclusion made while they were closed is over. An answer without the rules says nothing.
    if (chat.dmRead) await forgetExclusion(pass.creator, fan);
    if (work.stop.aborted) throw new Aborted();
    const historyRevision = revisionOf(pass.creator, chat.groupId, history);
    row.proof = { groupId: chat.groupId, historyRevision, window: windowOf(history, pass.creator), startProof: passStartProof(chat.groupId, history, pass.creator, pass.welcome) };
    set(pass, row, {
      status: 'ready',
      historyRevision,
      checkedAt: iso(deps.now()),
      fanWrote: history.some((message) => message.senderId === fan && message.type === 1),
      proof: null,
      error: null,
      dmClosed: null,
      dmPriceMills: null,
    });
  }

  /** «Нельзя написать» (FS-NEW-2), or «Исключён · нельзя написать» as the person left it in this browser: no proof to greet with. */
  async function closed(pass: Pass, work: Work, row: Row, why: NewcomerDmClosed, priceMills: number | null): Promise<void> {
    const excluded = await isExcluded(pass.creator, row.view.fanRef);
    if (work.stop.aborted) throw new Aborted();
    row.proof = null;
    set(pass, row, { status: excluded ? 'excluded' : 'dm-closed', dmClosed: why, dmPriceMills: priceMills, historyRevision: null, checkedAt: iso(deps.now()), fanWrote: false, proof: null, error: null });
  }

  function greeted(pass: Pass, row: Row, personal: PassMessage, history: readonly PassMessage[]): void {
    row.kept = history.slice(-PASS_BOUNDS.previewKept);
    row.keptAll = false;
    row.proof = null;
    if (row.chat !== null) learn(pass, row, row.chat.groupId, { id: personal.id, at: personal.at, fold: foldDigest(personal.content) });
    set(pass, row, { status: 'greeted', historyRevision: null, checkedAt: iso(deps.now()), proof: previewOf(personal, pass.creator, pass.welcome), error: null, fanWrote: false, dmClosed: null, dmPriceMills: null });
  }

  // ── what passes proved, kept in this browser (the old extension's storage cache, FS:713-743) ──

  const books = new Map<string, Promise<KnownBook>>();
  const writeKnown = createWriteChain();
  /** Errors of `POST /group`: a blip of a write is never asked again by itself. */
  const fromWrite = new WeakSet<object>();
  /** Leads a book gave (not the inbox): one Fansly no longer confirms is forgotten. */
  const bookChats = new WeakSet<PassChat>();
  const bookChat = (fanRef: string, groupId: string): PassChat => {
    const chat = knownChat(fanRef, groupId);
    bookChats.add(chat);
    return chat;
  };

  /** A kept chat Fansly does not confirm: out of the pass's leads and of the book. */
  function forget(pass: Pass, fan: string, groupId: string): void {
    pass.leads.delete(fan);
    note(pass, 'chat.reuse', { fanRef: fan, groupId, reason: 'known-forgotten' });
    void bookOf(pass.creator).then((book) => {
      if (book.fans.get(fan)?.g !== groupId) return;
      book.fans.delete(fan);
      keep(pass.creator, book);
    });
  }
  const foldDigest = (content: string): string => {
    const folded = foldText(content);
    return folded === '' ? '' : digestHex(folded);
  };

  /** The creator's book: read once per background, then kept in memory and written behind. */
  function bookOf(creator: string): Promise<KnownBook> {
    let book = books.get(creator);
    if (book === undefined) {
      book = readBook(creator);
      books.set(creator, book);
    }
    return book;
  }

  async function readBook(creator: string): Promise<KnownBook> {
    const key = `${NEWCOMERS_KNOWN_PREFIX}${creator}`;
    const fans = new Map<string, KnownFan>();
    const read = await deps.local.get([key]).catch(() => null);
    if (read === null || !read.ok) {
      log({ level: 'warn', scope: 'bg.fansly.newcomers', msg: 'the known fans were not read; every fan is checked', fields: { code: read?.ok === false ? read.code : 'thrown' } });
      return { fans, dirty: false, timer: false };
    }
    const stored = read.value[key] as { readonly v?: unknown; readonly fans?: unknown } | undefined;
    if (stored?.v === KNOWN_VERSION && typeof stored.fans === 'object' && stored.fans !== null) {
      for (const [fan, value] of Object.entries(stored.fans as Record<string, unknown>)) {
        const known = knownOf(value);
        if (known !== null && NATIVE_ID_PATTERN.test(fan)) fans.set(fan, known);
      }
    }
    return { fans, dirty: false, timer: false };
  }

  /** What a pass learned of a row: its chat, and «Уже писали» when it was proved; written behind, a run at a time. */
  function learn(pass: Pass, row: Row, groupId: string, personal?: NonNullable<KnownFan['p']>): void {
    const fan = row.view.fanRef;
    const followed = Date.parse(row.view.followedAt);
    void bookOf(pass.creator).then((book) => {
      const now = book.fans.get(fan);
      const had = now?.g === groupId ? now.p : undefined;
      // The creator's message is the better proof: a greeting of ours that went never replaces it.
      const p = personal === undefined || (personal === 'sent' && had !== undefined) ? had : personal;
      if (now !== undefined && now.g === groupId && sameProof(now.p, p)) return;
      book.fans.set(fan, { g: groupId, f: Number.isFinite(followed) ? followed : deps.now(), t: deps.now(), ...(p === undefined ? {} : { p }) });
      keep(pass.creator, book);
    });
  }

  function keep(creator: string, book: KnownBook): void {
    book.dirty = true;
    if (book.timer) return;
    book.timer = true;
    void deps.sleep(KNOWN_FLUSH_MS, new AbortSwitch()).then(() => {
      book.timer = false;
      if (!book.dirty) return;
      book.dirty = false;
      const cutoff = deps.now() - KNOWN_KEEP_MS;
      const kept = [...book.fans.entries()].filter(([, known]) => known.f >= cutoff).sort((a, b) => b[1].f - a[1].f).slice(0, KNOWN_FANS_MAX);
      book.fans.clear();
      for (const [fan, known] of kept) book.fans.set(fan, known);
      const value = { v: KNOWN_VERSION, fans: Object.fromEntries(kept) };
      void writeKnown(() => deps.local.set({ [`${NEWCOMERS_KNOWN_PREFIX}${creator}`]: value })).then((written) => {
        if (!written.ok) log({ level: 'warn', scope: 'bg.fansly.newcomers', msg: 'the known fans were not kept', fields: { code: written.code } });
      });
    });
  }

  /**
   * A fan an earlier pass proved written to is «Уже писали» now, without a request (the old cache): the creator's
   * personal message — unless its text has since become a welcome text — or a greeting of ours that went.
   */
  function knownVerdicts(pass: Pass, book: KnownBook): void {
    const welcome = new Set([...pass.welcome].map((text) => digestHex(text)));
    for (const row of pass.rows) {
      const known = book.fans.get(row.view.fanRef);
      if (row.view.status !== 'pending' || known?.p === undefined) continue;
      if (known.p !== 'sent' && known.p.fold !== '' && welcome.has(known.p.fold)) {
        // An automation after all: nothing is proved; the history is read again.
        book.fans.set(row.view.fanRef, { g: known.g, f: known.f, t: known.t });
        keep(pass.creator, book);
        continue;
      }
      row.chat = bookChat(row.view.fanRef, known.g);
      row.kept = [];
      row.keptAll = false;
      row.proof = null;
      note(pass, 'chat.reuse', { fanRef: row.view.fanRef, groupId: known.g, reason: known.p === 'sent' ? 'known-sent' : 'known-personal' });
      set(pass, row, { status: 'greeted', groupId: known.g, historyRevision: null, checkedAt: iso(known.t), proof: null, error: null, fanWrote: false, dmClosed: null, dmPriceMills: null });
    }
  }

  /** A known chat is a lead the inbox did not give: the check's fence and history instead of `POST /group`. */
  function knownLeads(pass: Pass, book: KnownBook): void {
    for (const row of pass.rows) {
      const known = book.fans.get(row.view.fanRef);
      if (row.view.status === 'pending' && known !== undefined && !pass.leads.has(row.view.fanRef)) pass.leads.set(row.view.fanRef, bookChat(row.view.fanRef, known.g));
    }
  }

  // ── the person's exclusions (R20 P10b2, FS-NEW-2): in this browser, as the old window kept them ──

  const exclusionKey = (creator: string, fanRef: string): string => `${NEWCOMERS_EXCLUDED_PREFIX}${creator}.${fanRef}`;

  /**
   * The creator's welcome texts (NF-033): read from Fansly on each pass and joined with every text kept before
   * (`NEWCOMERS_WELCOME_PREFIX`). A read that failed takes the kept texts, as the old extension's cache did
   * (2026-10-20 restrictions, item 17); only with none kept does the failure stop the pass, as before. On `refresh` the
   * texts the pass read before are kept too, whatever the store gave.
   */
  async function welcomeTexts(pass: Pass, work: Work): Promise<Set<string>> {
    const key = `${NEWCOMERS_WELCOME_PREFIX}${pass.creator}`;
    const stored = await deps.local.get([key]).catch(() => null);
    const value = stored?.ok === true ? (stored.value[key] as { readonly texts?: unknown } | undefined) : undefined;
    const inStore = Array.isArray(value?.texts) ? value.texts.filter((text): text is string => typeof text === 'string' && text !== '') : null;
    const kept = inStore === null && pass.welcome.size === 0 ? null : [...new Set([...(inStore ?? []), ...pass.welcome])];
    let read: Set<string> | null = null;
    let failure: CgAnyErrorWire = { code: 'CG-FAN-REQUEST' };
    try {
      read = readWelcomeTexts(await ask(pass, work, { route: 'message.automated' }));
    } catch (error) {
      if (error instanceof Aborted || work.stop.aborted || stopsPass(error) || kept === null) throw error;
      failure = failureOf(error).wire;
    }
    if (read === null) {
      if (kept === null) throw new PassFailure(failure);
      note(pass, 'welcome.refresh', { count: kept.length, complete: false, code: failure.code });
      log({ level: 'warn', scope: 'bg.fansly.newcomers', msg: 'the welcome texts were not read; the kept ones stand', fields: { count: kept.length } });
      return new Set(kept);
    }
    const texts = [...new Set([...read, ...(kept ?? [])])].slice(0, WELCOME_TEXTS_MAX);
    void deps.local.set({ [key]: { texts, checkedAt: deps.now() } }).catch(() => undefined);
    note(pass, 'welcome.refresh', { count: texts.length, complete: true });
    return new Set(texts);
  }

  /** A store that could not be read excludes nobody: the fan stays «К обработке», where the person sees them. */
  async function isExcluded(creator: string, fanRef: string): Promise<boolean> {
    const key = exclusionKey(creator, fanRef);
    const read = await deps.local.get([key]);
    if (read.ok) return Boolean(read.value[key]);
    log({ level: 'warn', scope: 'bg.fansly.newcomers', msg: 'the exclusions were not read', fields: { code: read.code } });
    return false;
  }

  async function forgetExclusion(creator: string, fanRef: string): Promise<void> {
    const key = exclusionKey(creator, fanRef);
    const read = await deps.local.get([key]);
    if (!read.ok || !read.value[key]) return;
    const removed = await deps.local.remove([key]);
    if (!removed.ok) log({ level: 'warn', scope: 'bg.fansly.newcomers', msg: 'an exclusion was not dropped', fields: { code: removed.code } });
  }

  function rowView(fanRef: string, followedAt: number, profile: PassProfile | undefined): FanslyFollowerRow {
    const base: FanslyFollowerRow = {
      fanRef,
      groupId: null,
      username: null,
      displayName: null,
      followedAt: iso(followedAt),
      status: 'pending',
      dmClosed: null,
      historyRevision: null,
      checkedAt: null,
    };
    return profile === undefined ? base : { ...base, ...profileFields(profile, base) };
  }

  function profileFields(profile: PassProfile, now: FanslyFollowerRow): Partial<FanslyFollowerRow> {
    return {
      username: profile.username ?? now.username,
      displayName: profile.displayName ?? now.displayName,
      bio: profile.bio ?? now.bio ?? null,
      ...(profile.customName === undefined ? {} : { customName: profile.customName }),
      // X59: the picture the window shows — the same checked Fansly address Hi takes (FX-018).
      ...(profile.avatarUrl === null ? {} : { avatarUrl: profile.avatarUrl }),
    };
  }

  // ── the requests ──

  function holds(pass: Pass, tab: string): boolean {
    // A window that came back after a lost port reads again from its tab: it holds the pass if it is on its creator.
    if (!deps.tabOn(tab, pass.creator)) return false;
    pass.watchers.add(tab);
    windows.set(tab, { passId: pass.id, creator: pass.creator });
    return true;
  }

  const running = (pass: Pass): boolean => pass.work !== null && !pass.work.stop.aborted;

  // ── the period the person chose last (X59): kept in this browser; a store that cannot be read gives the default ──

  const validHours = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= FANSLY_TAB_LIMITS.windowHoursMin && value <= FANSLY_TAB_LIMITS.windowHoursMax;

  async function rememberedWindow(): Promise<number> {
    const read = await deps.local.get([NEWCOMERS_WINDOW_KEY]);
    if (!read.ok) log({ level: 'warn', scope: 'bg.fansly.newcomers', msg: 'the remembered period was not read', fields: { code: read.code } });
    const stored = read.ok ? read.value[NEWCOMERS_WINDOW_KEY] : undefined;
    return validHours(stored) ? stored : FANSLY_TAB_LIMITS.windowHoursDefault;
  }

  function rememberWindow(hours: number): void {
    void deps.local.set({ [NEWCOMERS_WINDOW_KEY]: hours }).then((written) => {
      if (!written.ok) log({ level: 'warn', scope: 'bg.fansly.newcomers', msg: 'the chosen period was not kept', fields: { code: written.code } });
    });
  }

  /** `windowHours` null — the period remembered; a number — the person's choice, remembered for the next window. */
  async function scan(payload: Payload<'fansly.followers.scan'>, tab: string): Promise<Answer<'fansly.followers.scan'>> {
    const creator = payload.hostAccountId;
    if (!deps.tabOn(tab, creator)) return { ok: false, error: { code: 'CG-FNEW-ACCOUNT' } };
    const chosen = payload.windowHours;
    if (chosen !== null) rememberWindow(chosen);
    const windowHours = chosen ?? (await rememberedWindow());
    // The tab may have left the creator while the store was read.
    if (!deps.tabOn(tab, creator)) return { ok: false, error: { code: 'CG-FNEW-ACCOUNT' } };
    const open = passes.get(creator);
    // The window opened again, another tab, ⟳ (the owner, 2026-10-23): the creator's pass of this period goes on with
    // what it found; a pass that stands reads the welcome texts and the followers since its end and checks the new ones
    // (`refresh`); a «Пауза» belongs to the window that was open and goes on too. Another period is another pass.
    if (open !== undefined && open.windowHours === windowHours) {
      holds(open, tab);
      if (!running(open)) {
        note(open, 'queue.resume', { state: open.base });
        if (open.followers.read) begin(open, 'scanning', (work) => refresh(open, work));
        else begin(open, 'scanning', (work) => fastPart(open, work));
      }
      return { ok: true, pass: viewOf(open) };
    }
    const watchers = new Set(open?.watchers);
    if (open !== undefined) drop(open);
    const run: PassJournalRun = { passId: deps.uuid(), hostAccountId: creator, startedAt: deps.now(), windowHours };
    const pass: Pass = {
      id: run.passId,
      creator,
      windowHours,
      startedAt: run.startedAt,
      journal: journalFor(run),
      base: 'scanning',
      phase: 'welcome',
      partial: false,
      error: null,
      coolingUntil: null,
      welcome: new Set(),
      followers: { before: '0', pages: 0, read: false, cursors: new Set() },
      rows: [],
      byFan: new Map(),
      leads: new Map(),
      watchers,
      life: new AbortSwitch(),
      work: null,
      preferred: null,
      seq: 0,
      dirty: new Set(),
      passDirty: false,
      flushing: false,
    };
    passes.set(creator, pass);
    byId_.set(pass.id, pass);
    holds(pass, tab);
    if (open !== undefined) {
      open.base = 'stopped';
      open.phase = null;
      open.coolingUntil = null;
      open.error = { code: 'CG-CONTEXT-CHANGED' };
      open.seq += 1;
      const change: FollowersChange = { pass: viewOf(open), seq: open.seq, rows: [] };
      // The terminal event makes old windows read again; their old id resolves to the current pass below.
      for (const watcher of watchers) if (deps.alive(watcher) && deps.tabOn(watcher, creator)) deps.emit(watcher, change);
    }
    note(pass, 'pass.start', { state: pass.base });
    begin(pass, 'scanning', (work) => fastPart(pass, work));
    return { ok: true, pass: viewOf(pass) };
  }

  function drop(pass: Pass): void {
    note(pass, 'pass.close', { state: pass.base, reason: 'released' });
    pass.life.abort();
    pass.watchers.clear();
    passes.delete(pass.creator);
    byId_.delete(pass.id);
  }

  function find(passId: string, tab: string): Pass | null {
    const pass = byId_.get(passId);
    if (pass !== undefined) return holds(pass, tab) ? pass : null;
    const window = windows.get(tab);
    const current = window?.passId === passId ? passes.get(window.creator) : undefined;
    return current !== undefined && current.watchers.has(tab) && deps.tabOn(tab, current.creator) ? current : null;
  }

  function read(payload: Payload<'fansly.followers.read'>, tab: string): Answer<'fansly.followers.read'> {
    const pass = find(payload.passId, tab);
    if (pass === null) return { pass: null, rows: [], total: 0 };
    const page = (list: readonly FanslyFollowerRow[]): FanslyFollowerRow[] => list.slice(payload.offset, payload.offset + payload.limit);
    const all = pass.rows.map((row) => row.view);
    // Every change told so far is in what follows (and changes not told yet come after it).
    const query = payload.query;
    if (query === undefined) return { pass: viewOf(pass), rows: page(all), total: all.length, seq: pass.seq };
    // The window's search, tab and filter over the WHOLE pass, then the page (P10a): counts after the search.
    const searched = all.filter((row) => matchesPassSearch(passRowOf(row), query.search));
    const inTab = searched.filter((row) => inPassTab(checkOf(row), query.tab));
    const shown = inTab.filter((row) => passesCheckFilter(checkOf(row), query.filter));
    const filters = Object.fromEntries(NEWCOMER_CHECK_FILTERS.map((id) => [id, inTab.filter((row) => passesCheckFilter(checkOf(row), id)).length])) as Record<(typeof NEWCOMER_CHECK_FILTERS)[number], number>;
    return {
      pass: viewOf(pass),
      rows: page(shown),
      total: shown.length,
      seq: pass.seq,
      counts: { tabs: { todo: searched.filter((row) => inPassTab(checkOf(row), 'todo')).length, all: searched.length }, filters },
    };
  }

  function pause(payload: Payload<'fansly.followers.pause'>, tab: string): Answer<'fansly.followers.pause'> {
    const pass = find(payload.passId, tab);
    if (pass === null) return { pass: null };
    // While the list itself is read there is nothing to stand on: the pause waits for the profiles (the old rule).
    const listRead = pass.base === 'queue' || (pass.base === 'scanning' && (pass.phase === 'profiles' || pass.phase === 'checking'));
    if (listRead && running(pass)) {
      standStill(pass);
      touch(pass);
    }
    return { pass: viewOf(pass) };
  }

  function resume(payload: Payload<'fansly.followers.resume'>, tab: string): Answer<'fansly.followers.resume'> {
    const pass = find(payload.passId, tab);
    if (pass === null) return { ok: false, error: { code: 'CG-CONTEXT-CHANGED' } };
    if (pass.work !== null || (pass.followers.read && !pass.rows.some(needsCheck))) return { ok: true, pass: viewOf(pass) };
    note(pass, 'queue.resume', { state: pass.base });
    if (!pass.followers.read) {
      begin(pass, 'scanning', (work) => fastPart(pass, work));
      return { ok: true, pass: viewOf(pass) };
    }
    begin(pass, 'queue', async (work) => {
      await profiles(pass, work);
      await queue(pass, work, null, true);
    });
    return { ok: true, pass: viewOf(pass) };
  }

  function prioritize(payload: Payload<'fansly.followers.prioritize'>, tab: string): Answer<'fansly.followers.prioritize'> {
    const pass = find(payload.passId, tab);
    const row = pass?.byFan.get(payload.fanRef);
    if (pass === null || pass === undefined || row === undefined || !needsCheck(row)) return { recorded: false };
    if (running(pass)) {
      // «Проверить следующим»: the running queue takes this fan next.
      pass.preferred = row.view.fanRef;
      note(pass, 'queue.prioritize', { fanRef: row.view.fanRef, reason: 'next' });
      return { recorded: true };
    }
    // A pause on its way: the request in flight ends first.
    if (pass.work !== null) return { recorded: false };
    // A click on a row only reorders a running queue, never starts one (the old window's selection).
    if (payload.next === true) return { recorded: false };
    // «Проверить чат»: the queue stands (paused, done, or stopped by a failure — the old window offered it for any fan
    // not checked) — this fan alone, now; then it stands again.
    const was = pass.base;
    note(pass, 'queue.prioritize', { fanRef: row.view.fanRef, reason: 'now' });
    begin(pass, 'queue', async (work) => {
      await queue(pass, work, row.view.fanRef);
      // Not «done» while others wait: the queue stands, «Проверить оставшихся: N».
      if ((was === 'paused' || was === 'stopped') && pass.rows.some(needsCheck)) throw new Aborted();
    });
    return { recorded: true };
  }

  function close(payload: Payload<'fansly.followers.close'>, tab: string): Answer<'fansly.followers.close'> {
    const window = windows.get(tab);
    const pass = window?.passId === payload.passId ? passes.get(window.creator) : byId_.get(payload.passId);
    if (pass === undefined || !pass.watchers.delete(tab)) return { recorded: false };
    windows.delete(tab);
    note(pass, 'pass.close', { state: pass.base, reason: 'window' });
    if (pass.watchers.size === 0) {
      standStill(pass);
      touch(pass);
    }
    return { recorded: true };
  }

  /**
   * «Исключить из очереди» / «Вернуть в очередь» (FS-NEW-2, as the old window): only a fan Fansly will not let the
   * creator write to leaves «К обработке» by hand; kept in this browser. Nothing is asked of Fansly or the hub.
   */
  async function exclude(payload: Payload<'fansly.followers.exclude'>, tab: string): Promise<Answer<'fansly.followers.exclude'>> {
    const pass = find(payload.passId, tab);
    const row = pass?.byFan.get(payload.fanRef);
    const closedNow = (): boolean => row !== undefined && (row.view.status === 'dm-closed' || row.view.status === 'excluded');
    if (pass === null || pass === undefined || row === undefined || !closedNow()) return { recorded: false };
    const key = exclusionKey(pass.creator, row.view.fanRef);
    const written = payload.excluded ? await deps.local.set({ [key]: { at: deps.now() } }) : await deps.local.remove([key]);
    if (!written.ok) {
      log({ level: 'warn', scope: 'bg.fansly.newcomers', msg: 'an exclusion was not kept', fields: { code: written.code, excluded: payload.excluded } });
      return { recorded: false };
    }
    // A check of the queue may have opened the DMs meanwhile: then the row stays as the check left it.
    if (!closedNow()) return { recorded: false };
    const status = payload.excluded ? 'excluded' : 'dm-closed';
    if (row.view.status !== status) set(pass, row, { status });
    return { recorded: true };
  }

  /** The card's conversation as the pass read it, newest first (NF-010); older pages are read again from Fansly. */
  async function history(payload: Payload<'fansly.followers.history'>, tab: string): Promise<Answer<'fansly.followers.history'>> {
    const pass = find(payload.passId, tab);
    const row = pass?.byFan.get(payload.fanRef);
    if (pass === null || pass === undefined || row === undefined) return { ok: false, error: { code: 'CG-CONTEXT-CHANGED' } };
    const groupId = row.chat?.groupId ?? null;
    if (groupId === null || row.view.status === 'pending' || row.view.status === 'checking') return { ok: false, error: { code: 'CG-FNEW-UNVERIFIED' } };
    const older = (id: string, than: string | null): boolean => than === null || compareNativeIds(id, than) < 0;
    const kept = row.kept.filter((message) => older(message.id, payload.before));
    const messages = kept.slice(-payload.limit).reverse();
    if (messages.length === payload.limit || row.keptAll) {
      note(pass, 'history.cache', { fanRef: row.view.fanRef, groupId, count: messages.length, complete: row.keptAll });
      return { ok: true, messages: messages.map((message) => previewOf(message, pass.creator, pass.welcome)), more: kept.length > payload.limit || !row.keptAll };
    }
    // Beyond what the pass kept: the pages before the oldest message in hand, through the pacer like the pass's own.
    let more = false;
    let cursor = messages.at(-1)?.id ?? payload.before;
    const stop = new AbortSwitch();
    pass.life.addEventListener('abort', () => stop.abort());
    const work = workOf(stop);
    try {
      for (let page = 0; messages.length < payload.limit && page <= Math.ceil(payload.limit / PASS_BOUNDS.historyPage); page += 1) {
        const query: Record<string, string> = { groupId, limit: String(PASS_BOUNDS.historyPage) };
        if (cursor !== null) query['before'] = cursor;
        const read = readHistoryPage(await ask(pass, work, { route: 'message.history', query }), groupId, [pass.creator, row.view.fanRef], deps.now());
        if (read === null) return { ok: false, error: { code: 'CG-FNEW-HISTORY' } };
        const page_ = read.filter((message) => older(message.id, cursor)).sort(byId).reverse();
        more = page_.length > 0;
        if (!more) break;
        messages.push(...page_.slice(0, payload.limit - messages.length));
        cursor = page_.at(-1)?.id ?? null;
      }
    } catch (error) {
      return { ok: false, error: failureOf(error).wire };
    }
    const shown: FanslyPreviewMessage[] = messages.map((message) => previewOf(message, pass.creator, pass.welcome));
    return { ok: true, messages: shown, more };
  }

  // ── the greeting's part (R20 P10c) ──

  /** The pass of this id, for a tab on its creator — exactly this pass, never its replacement; the tab's window is not touched. */
  function exact(passId: string, tab: string): Pass | null {
    const pass = byId_.get(passId);
    return pass !== undefined && deps.alive(tab) && deps.tabOn(tab, pass.creator) ? pass : null;
  }

  /** A row of the tab's pass as the greeting reads it; null — no such pass or fan for this tab. */
  function rowFor(passId: string, fanRef: string, tab: string): { readonly creator: string; readonly view: FanslyFollowerRow; readonly proof: PassRowProof | null } | null {
    const pass = exact(passId, tab);
    const row = pass?.byFan.get(fanRef);
    return pass === null || row === undefined ? null : { creator: pass.creator, view: row.view, proof: row.proof };
  }

  /**
   * «Сгенерировать» (FS-NEW-7, NF-013, NF-034): the proof of a row checked in full — the window of the coverage check,
   * the fan's newest ids of it (newest first, ≤ 10), the start, avatar and confirmed texts already read (X69).
   */
  function greetingProof(passId: string, fanRef: string, tab: string): { readonly ok: true; readonly proof: FanslyGreetingProof } | { readonly ok: false; readonly code: CgAnyCode } {
    const pass = exact(passId, tab);
    const row = pass?.byFan.get(fanRef);
    if (pass === null || row === undefined) return { ok: false, code: 'CG-CONTEXT-CHANGED' };
    if (row.view.status !== 'ready' || row.proof === null) return { ok: false, code: notReady(row.view) };
    const proof = row.proof;
    const known = proof.window.filter((entry) => entry.dir === 'fan').map((entry) => entry.id).reverse().slice(0, SEND_LIMITS.knownFanMessagesMax);
    const windowIds = new Set(proof.window.map((entry) => entry.id));
    const tail = row.kept
      .filter((message) => windowIds.has(message.id) && message.content.trim() !== '')
      .slice(-LIVE_TEXT_LIMITS.maxItems)
      .map((message) => ({ platformMessageId: message.id, direction: message.senderId === pass.creator ? 'model' as const : 'fan' as const, sentAt: iso(message.at), text: message.content.slice(0, LIVE_TEXT_LIMITS.maxChars) }));
    return { ok: true, proof: { groupId: proof.groupId, historyRevision: proof.historyRevision, window: [...proof.window], knownFanMessageIds: known, startProof: proof.startProof, fanAvatarUrl: row.avatar, capturedAt: row.view.checkedAt ?? iso(deps.now()), tail } };
  }

  /**
   * NF-036: the fan's history read again right before the custody — the same check as the queue's (the participants'
   * fence, the history to its empty page). A changed history gets a new revision; a personal message of the creator's
   * makes the row «Уже писали». A failed read leaves the row as it was and refuses with its code.
   */
  async function recheck(passId: string, fanRef: string, tab: string): Promise<{ readonly ok: true; readonly historyRevision: string } | { readonly ok: false; readonly code: CgAnyCode; readonly retryAt?: number }> {
    const pass = exact(passId, tab);
    const row = pass?.byFan.get(fanRef);
    if (pass === null || row === undefined || pass.life.aborted) return { ok: false, code: 'CG-CONTEXT-CHANGED' };
    if (row.view.status !== 'ready' || row.proof === null) return { ok: false, code: notReady(row.view) };
    // The old extension's `assertNotCooling`: the person is told at once how long Fansly asks to wait — the click never
    // sits out a cooldown (up to 5 min) behind «Отправляем…».
    const cooling = deps.api.coolingUntil(pass.creator);
    if (cooling > deps.now()) return { ok: false, code: 'CG-FAN-RATE-LIMIT', retryAt: cooling };
    const before = row.view;
    const stop = new AbortSwitch();
    pass.life.addEventListener('abort', () => stop.abort());
    const work = workOf(stop);
    try {
      await check(pass, work, row, false, true);
    } catch (error) {
      if (byId_.get(passId) === pass && (row.view.status as FanslyFollowerRow['status']) === 'checking') set(pass, row, { status: before.status, error: before.error ?? null });
      if (error instanceof Aborted || stop.aborted) return { ok: false, code: 'CG-CONTEXT-CHANGED' };
      const { wire } = failureOf(error);
      const until = wire.retryAt ?? deps.api.coolingUntil(pass.creator);
      return wire.code === 'CG-FAN-RATE-LIMIT' && until > deps.now() ? { ok: false, code: wire.code, retryAt: until } : { ok: false, code: wire.code };
    }
    return row.view.status === 'ready' && row.proof !== null ? { ok: true, historyRevision: row.proof.historyRevision } : { ok: false, code: notReady(row.view) };
  }

  /** The send's tuple now, from memory (§8.6 step 2): the row as the pass holds it; null — not a checked row any more. */
  function live(passId: string, fanRef: string): { readonly hostAccountId: string; readonly groupId: string; readonly fanRef: string; readonly historyRevision: string } | null {
    const pass = byId_.get(passId);
    const row = pass?.byFan.get(fanRef);
    if (pass === undefined || row === undefined || row.view.status !== 'ready' || row.proof === null) return null;
    return { hostAccountId: pass.creator, groupId: row.proof.groupId, fanRef, historyRevision: row.proof.historyRevision };
  }

  // ── the greeting reminder (2026-10-25, greet-remind.ts) ──

  /** The reminder's checks in flight: stopped with the module. */
  const reminding = new Set<AbortSwitch>();

  /**
   * The check of a creator's new followers with no window open, READ-ONLY (the owner, 2026-10-25: «только чтение без
   * создания чата»): never `POST /group`. What passes proved first (an open pass's «Уже писали» or «Нельзя написать»,
   * the book); then the start of the inbox — the newest chats first — back past the oldest follow (at most
   * REMIND_INBOX_PAGES pages, the first page again after more than one: a chat written to meanwhile jumps to the top).
   * A fan whose chat it or the book names is checked as the window checks them (NF-032: the participants' fence, the
   * history to the empty page, «Нельзя написать»), without creating anything. A fan with no chat there, once the inbox
   * reaches past their follow, got no message since and wrote none: due — an old chat with an earlier greeting of a
   * fan who came back is not looked for. The names are read in one request, only for the fans who are due.
   * Per fan: the verdict, or null — not told now (the lane cools down, a failure, an inbox not read far enough): the
   * reminder asks again a minute later. A pass nobody holds: no window shows it; what it proves goes to the book.
   */
  async function remind(creator: string, follows: readonly FanslyRemindFollow[]): Promise<Map<string, FanslyRemindVerdict | null>> {
    const verdicts = new Map<string, FanslyRemindVerdict | null>();
    const open = passes.get(creator);
    const asked: FanslyRemindFollow[] = [];
    for (const follow of follows) {
      if (verdicts.has(follow.fanRef) || asked.some((other) => other.fanRef === follow.fanRef)) continue;
      const shown = open?.byFan.get(follow.fanRef)?.view.status;
      if (shown === 'greeted') verdicts.set(follow.fanRef, { s: 'greeted' });
      else if (shown === 'dm-closed' || shown === 'excluded') verdicts.set(follow.fanRef, { s: 'closed' });
      else asked.push(follow);
    }
    for (const follow of asked) verdicts.set(follow.fanRef, null);
    // The creator's lane cools down: nothing is asked now, the next minute is.
    if (asked.length === 0 || deps.api.coolingUntil(creator) > deps.now()) return verdicts;
    const stop = new AbortSwitch();
    reminding.add(stop);
    const work = workOf(stop);
    const rows: Row[] = asked.map((follow) => ({ view: rowView(follow.fanRef, follow.followedAt, undefined), chat: null, kept: [], keptAll: false, proof: null, avatar: null }));
    const pass: Pass = {
      id: deps.uuid(),
      creator,
      windowHours: FANSLY_TAB_LIMITS.windowHoursMin,
      startedAt: deps.now(),
      journal: undefined,
      base: 'queue',
      phase: null,
      partial: false,
      error: null,
      coolingUntil: null,
      welcome: new Set(),
      followers: { before: '0', pages: 0, read: true, cursors: new Set() },
      rows,
      byFan: new Map(rows.map((row) => [row.view.fanRef, row])),
      leads: new Map(),
      watchers: new Set(),
      life: new AbortSwitch(),
      work: null,
      preferred: null,
      seq: 0,
      dirty: new Set(),
      passDirty: false,
      flushing: false,
    };
    try {
      pass.welcome = (await freshWelcome(creator)) ?? (await welcomeTexts(pass, work));
      const book = await bookOf(creator);
      if (stop.aborted) return verdicts;
      knownVerdicts(pass, book);
      knownLeads(pass, book);
      const reach = await inboxReach(pass, work, Math.min(...asked.map((follow) => follow.followedAt)));
      const due: string[] = [];
      for (const row of rows) {
        const fan = row.view.fanRef;
        const verdict = row.view.status === 'greeted' ? { s: 'greeted' as const } : await remindRow(pass, work, row, reach);
        verdicts.set(fan, verdict);
        if (verdict?.s === 'due') due.push(fan);
      }
      const profiles = due.length === 0 ? new Map<string, PassProfile>() : await profilesOf(pass, work, due);
      for (const fan of due) {
        const profile = profiles.get(fan);
        const name = profile === undefined ? null : profile.customName?.trim() || profile.displayName?.trim() || profile.username?.trim() || null;
        verdicts.set(fan, { s: 'due', fanLabel: name, username: profile?.username?.trim().replace(/^@/, '') || null, avatarUrl: profile?.avatarUrl ?? null });
      }
    } catch (error) {
      if (!(error instanceof Aborted) && !stop.aborted) log({ level: 'warn', scope: 'bg.fansly.newcomers', msg: 'the greeting reminder could not check its fans', fields: { code: failureOf(error).wire.code, fans: asked.length } });
    } finally {
      reminding.delete(stop);
    }
    return verdicts;
  }

  /**
   * The start of the inbox for the reminder: the wanted fans' chats become the pass's leads; the answer is how far back
   * it reached — a follow later than that would show its chat had anyone written since (-Infinity: the inbox's end;
   * +Infinity: not told).
   */
  async function inboxReach(pass: Pass, work: Work, oldest: number): Promise<number> {
    const wanted = new Set(pass.rows.filter((row) => row.view.status === 'pending' && !pass.leads.has(row.view.fanRef)).map((row) => row.view.fanRef));
    if (wanted.size === 0) return Number.POSITIVE_INFINITY;
    const read = async (page: number): Promise<number> => {
      const answer = readInboxPage(
        await ask(pass, work, {
          route: 'messaging.groups',
          query: { sortOrder: '1', flags: '0', subscriptionTierId: '', listIds: '', search: '', limit: String(PASS_BOUNDS.inboxPage), offset: String(page * PASS_BOUNDS.inboxPage) },
        }),
        pass.creator,
        wanted,
        deps.now(),
      );
      if (answer === null) throw new PassFailure({ code: 'CG-FAN-REQUEST' });
      for (const chat of answer.chats) pass.leads.set(chat.fanRef, chat);
      if (answer.count < PASS_BOUNDS.inboxPage) return Number.NEGATIVE_INFINITY;
      return (answer.tail === null ? null : snowflakeMs(answer.tail, deps.now())) ?? Number.POSITIVE_INFINITY;
    };
    let reach = Number.POSITIVE_INFINITY;
    let pages = 0;
    while (pages < REMIND_INBOX_PAGES && reach >= oldest) {
      reach = await read(pages);
      pages += 1;
    }
    // Chats written to while the later pages were read.
    if (pages > 1) await read(0);
    return reach;
  }

  /** One fan of a reminder check: the window's own check of a chat the inbox or the book named; no chat — by the inbox's reach. */
  async function remindRow(pass: Pass, work: Work, row: Row, reach: number): Promise<FanslyRemindVerdict | null> {
    const fan = row.view.fanRef;
    if (!pass.leads.has(fan)) return reach < Date.parse(row.view.followedAt) ? { s: 'due', fanLabel: null } : null;
    try {
      // `create` false: a lead is confirmed and read, never made.
      await check(pass, work, row, false);
    } catch (error) {
      if (error instanceof Aborted || work.stop.aborted || stopsPass(error)) throw error;
      return null;
    }
    // The row as the check left it (it sets it).
    const status = ((): FanslyFollowerRow['status'] => row.view.status)();
    if (status === 'greeted') return { s: 'greeted' };
    if (status === 'dm-closed' || status === 'excluded') return { s: 'closed' };
    if (status !== 'ready') return null;
    return row.view.fanWrote === true ? { s: 'wrote' } : { s: 'due', fanLabel: null };
  }

  /** The kept welcome texts of the creator, read from Fansly less than REMIND_WELCOME_FRESH_MS ago; null — none so fresh. */
  async function freshWelcome(creator: string): Promise<Set<string> | null> {
    const key = `${NEWCOMERS_WELCOME_PREFIX}${creator}`;
    const stored = await deps.local.get([key]).catch(() => null);
    const value = stored?.ok === true ? (stored.value[key] as { readonly texts?: unknown; readonly checkedAt?: unknown } | undefined) : undefined;
    if (!Array.isArray(value?.texts) || !finite(value.checkedAt) || deps.now() - value.checkedAt > REMIND_WELCOME_FRESH_MS) return null;
    return new Set(value.texts.filter((text): text is string => typeof text === 'string' && text !== ''));
  }

  /** The fans' profiles for the reminder, one request; a failed read — none. */
  async function profilesOf(pass: Pass, work: Work, fans: readonly string[]): Promise<Map<string, PassProfile>> {
    const profiles = new Map<string, PassProfile>();
    try {
      for (const profile of readAccounts(await ask(pass, work, { route: 'account.byIds', query: { ids: fans.join(',') } })) ?? []) profiles.set(profile.fanRef, profile);
    } catch (error) {
      if (error instanceof Aborted || work.stop.aborted) throw new Aborted();
    }
    return profiles;
  }

  /** The card's greeting went (sent, or the person's own send registered): the fan is «Уже писали» in the creator's pass. */
  function markGreeted(creator: string, fanRef: string): void {
    const pass = passes.get(creator);
    const row = pass?.byFan.get(fanRef);
    if (pass === undefined || row === undefined || row.view.status === 'greeted') return;
    // The next window knows it without a request (the old extension's send journal, `attempt: sent`).
    const groupId = row.chat?.groupId ?? row.view.groupId;
    if (groupId !== null) learn(pass, row, groupId, 'sent');
    row.proof = null;
    set(pass, row, { status: 'greeted', historyRevision: null, checkedAt: iso(deps.now()), proof: null, error: null, fanWrote: false, dmClosed: null, dmPriceMills: null });
  }

  return {
    handles: (type: string): boolean => Object.prototype.hasOwnProperty.call(REQUESTS, type),
    /** A request of the window's (`fansly.followers.*` but `send`): its answer. */
    async answer(type: string, payload: unknown, tab: string): Promise<unknown> {
      switch (type) {
        case 'fansly.followers.scan':
          return scan(payload as Payload<'fansly.followers.scan'>, tab);
        case 'fansly.followers.read':
          return read(payload as Payload<'fansly.followers.read'>, tab);
        case 'fansly.followers.pause':
          return pause(payload as Payload<'fansly.followers.pause'>, tab);
        case 'fansly.followers.resume':
          return resume(payload as Payload<'fansly.followers.resume'>, tab);
        case 'fansly.followers.prioritize':
          return prioritize(payload as Payload<'fansly.followers.prioritize'>, tab);
        case 'fansly.followers.history':
          return history(payload as Payload<'fansly.followers.history'>, tab);
        case 'fansly.followers.close':
          return close(payload as Payload<'fansly.followers.close'>, tab);
        case 'fansly.followers.exclude':
          return exclude(payload as Payload<'fansly.followers.exclude'>, tab);
        default:
          throw new Error(`${type}: not the pass's`);
      }
    },
    /** What the greeting takes of a checked row (P10c, FS-NEW-7); null — not checked in full, or no such pass. */
    proof(passId: string, fanRef: string): PassRowProof | null {
      return byId_.get(passId)?.byFan.get(fanRef)?.proof ?? null;
    },
    greetingProof,
    row: rowFor,
    /** The creator of the tab's pass (exactly this pass); null — no such pass for this tab. */
    creatorOf: (passId: string, tab: string): string | null => exact(passId, tab)?.creator ?? null,
    recheck,
    live,
    greeted: markGreeted,
    remind,
    /** The work in flight, for tests and the module's dispose. */
    idle: async (): Promise<void> => {
      for (const pass of passes.values()) await pass.work?.done;
    },
    dispose(): void {
      for (const pass of [...passes.values()]) drop(pass);
      for (const stop of reminding) stop.abort();
      windows.clear();
    },
  };
}
