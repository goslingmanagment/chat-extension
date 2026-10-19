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
// standing queue checks that fan alone, now. A cooldown of the creator's lane (a 429, ours or the page's) is waited
// out by the pacer; meanwhile the pass says `cooldown` with its end — the window's banner — and goes on by itself.
// Five failures in a row stop it (`stopped`); a session Fansly refused stops it at once.
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
// page's memory: an open window's port keeps the page awake; a pass nobody holds is let go by the next `scan`.
// Its metadata journal is a separate port (P10b3, NF-029, FS-NEW-5): IDB with rotation and only a small memory tail.

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
import { compareNativeIds } from '@cg/contracts/primitives';
import { NEWCOMER_CHECK_FILTERS, type NewcomerDmClosed } from '@cg/contracts/vm';

import {
  PASS_BOUNDS,
  byId,
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
import { inPassTab, matchesPassSearch, passesCheckFilter } from '../../../domain/newcomers/pass';
import { AbortSwitch } from '../../ports';
import { NO_LOG, type KeyValuePort, type ServiceLog } from '../../storage/ports';
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

/** What the greeting (P10c) takes of a checked row (FS-NEW-7): only a history walked to its empty page has one. */
export interface PassRowProof {
  readonly groupId: string;
  readonly historyRevision: string;
  /** The checked history's ids, both directions, the newest 60, oldest first. */
  readonly window: readonly { readonly id: string; readonly dir: 'fan' | 'model' }[];
  readonly startProof: StartProofV1;
}

/** Five failures in a row stop the pass instead of doubling the load on a failing Fansly (the old fuse). */
export const PASS_FUSE = 5;
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
  revisionKey: string | null;
  proof: PassRowProof | null;
  /** R20 P10c (FX-018): the avatar's address of the profile the pass read; null — none fit to send. */
  avatar: string | null;
}

interface Work {
  readonly stop: AbortSwitch;
  readonly done: Promise<void>;
}

interface Pass {
  readonly id: string;
  readonly creator: string;
  readonly windowHours: number;
  readonly startedAt: number;
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

  /** One call of the pass: its creator's session, the work's signal; a cooldown that refused it is waited out. */
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

  /** The fast part (NF-030, NF-031, NF-032), then the queue (NF-039). */
  async function fastPart(pass: Pass, work: Work): Promise<void> {
    const phase = (next: Phase): void => {
      pass.phase = next;
      note(pass, 'pass.phase', { phase: next });
      touch(pass);
    };
    phase('welcome');
    const welcome = readWelcomeTexts(await ask(pass, work, { route: 'message.automated' }));
    if (welcome === null) throw new PassFailure({ code: 'CG-FAN-REQUEST' });
    pass.welcome = welcome;
    note(pass, 'welcome.refresh', { count: welcome.size });

    phase('followers');
    const cutoff = pass.startedAt - pass.windowHours * 3_600_000;
    await followers(pass, work, cutoff);

    if (pass.rows.length > 0) await inbox(pass, work, cutoff);
    phase('profiles');
    await profiles(pass, work);
    phase('checking');
    let fails = 0;
    for (const row of order(pass)) {
      if (row.view.status !== 'pending' || !pass.leads.has(row.view.fanRef)) continue;
      fails = await checkOne(pass, work, row, false, fails);
    }
    pass.phase = null;
    pass.base = 'queue';
    touch(pass);
    await queue(pass, work, null);
  }

  async function followers(pass: Pass, work: Work, cutoff: number): Promise<void> {
    const progress = pass.followers;
    if (progress.read) return;
    let complete = false;
    try {
      while (progress.pages < PASS_BOUNDS.followerPages) {
        const answer = readFollowersPage(
          await ask(pass, work, {
            route: 'followers.new',
            path: { account: pass.creator },
            query: { before: progress.before, after: '0', limit: String(PASS_BOUNDS.followerPage), offset: '0', search: '', lastSeenAfter: '' },
          }),
        );
        if (answer === null) throw new PassFailure({ code: 'CG-FAN-REQUEST' });
        progress.pages += 1;
        note(pass, 'followers.page', { page: progress.pages, count: answer.follows.length });
        const profiles = new Map(answer.profiles.map((profile) => [profile.fanRef, profile]));
        let oldest = Infinity;
        for (const follow of answer.follows) {
          const at = snowflakeMs(follow.id, deps.now()) ?? 0;
          oldest = Math.min(oldest, at);
          if (at < cutoff || at > pass.startedAt || pass.byFan.has(follow.fanRef) || follow.fanRef === pass.creator) continue;
          const row: Row = { view: rowView(follow.fanRef, at, profiles.get(follow.fanRef)), chat: null, kept: [], keptAll: false, revisionKey: null, proof: null, avatar: profiles.get(follow.fanRef)?.avatarUrl ?? null };
          pass.rows.push(row);
          pass.byFan.set(follow.fanRef, row);
          touch(pass, row);
        }
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
    pass.rows.sort((a, b) => Date.parse(b.view.followedAt) - Date.parse(a.view.followedAt));
    touch(pass);
  }

  /** The start of the inbox (NF-031): chats of the period's followers. Positive only; a failure leaves no lead. */
  async function inbox(pass: Pass, work: Work, cutoff: number): Promise<void> {
    const wanted = new Set(pass.rows.map((row) => row.view.fanRef));
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
        if (pass.leads.size >= wanted.size || page.count < PASS_BOUNDS.inboxPage || tail === null || tail < cutoff) break;
      }
      // Chats that jumped to the top meanwhile.
      if (pages > 1 && pass.leads.size < wanted.size) await read(0);
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
      const row = only !== null ? (tried.has(only) ? undefined : pass.byFan.get(only)) : nextRow(pass, tried, wanted);
      if (row === undefined) return;
      tried.add(row.view.fanRef);
      if (only === null && pass.preferred === row.view.fanRef) pass.preferred = null;
      if (!wanted(row)) continue;
      fails = await checkOne(pass, work, row, true, fails);
    }
  }

  function nextRow(pass: Pass, tried: ReadonlySet<string>, wanted: (row: Row) => boolean): Row | undefined {
    const preferred = pass.preferred === null ? undefined : pass.byFan.get(pass.preferred);
    // The person's choice is checked whatever it failed with before.
    if (preferred !== undefined && !tried.has(preferred.view.fanRef) && needsCheck(preferred)) return preferred;
    return order(pass).find((row) => !tried.has(row.view.fanRef) && wanted(row));
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

  /** Checks one row; a failure is the row's, five in a row (or a session refused) stop the pass. Answers the run of failures. */
  async function checkOne(pass: Pass, work: Work, row: Row, create: boolean, fails: number): Promise<number> {
    const before = row.view.status;
    try {
      await check(pass, work, row, create);
      return 0;
    } catch (error) {
      if (error instanceof Aborted || work.stop.aborted) {
        set(pass, row, { status: before === 'checking' ? 'pending' : before });
        throw new Aborted();
      }
      const { wire } = failureOf(error);
      set(pass, row, { status: 'failed', error: wire, checkedAt: iso(deps.now()), historyRevision: null, dmClosed: null, dmPriceMills: null });
      row.proof = null;
      if (stopsPass(error) || fails + 1 >= PASS_FUSE) {
        halt(pass, wire);
        throw new Aborted();
      }
      return fails + 1;
    }
  }

  /**
   * The check of one fan (NF-032): the chat — the inbox's lead, confirmed by `GET /group` when its answer did not list
   * both users, or, in the queue, `POST /group` —, then its history to the empty page; a personal message of the
   * creator's ends it: «Уже писали».
   */
  async function check(pass: Pass, work: Work, row: Row, create: boolean): Promise<void> {
    const fan = row.view.fanRef;
    const users = [pass.creator, fan];
    let chat = row.chat ?? pass.leads.get(fan) ?? null;
    if (chat !== null) note(pass, 'chat.reuse', { fanRef: fan, groupId: chat.groupId, reason: row.chat === null ? 'inbox' : 'checked' });
    if (chat === null && !create) return;
    set(pass, row, { status: 'checking', error: null });
    if (chat === null) {
      // NF-039: get-or-create by identity — one attempt; it may make an empty technical chat (Б17).
      const body = { users: [{ userId: fan, permissionFlags: 0 }, { userId: pass.creator, permissionFlags: 0 }], recipients: [], lastMessage: null, userSettings: null, type: 1 };
      chat = readGroup(await ask(pass, work, { route: 'group.create', body }), pass.creator, fan, deps.now());
      if (chat === null) throw new PassFailure({ code: 'CG-FAN-GROUP' });
    } else if (!chat.verified) {
      // The participants' fence: a lead is a fact only once its group lists exactly the two.
      const confirmed = readGroup(await ask(pass, work, { route: 'group.detail', path: { group: chat.groupId } }), pass.creator, fan, deps.now(), chat.groupId);
      if (confirmed === null) throw new PassFailure({ code: 'CG-FAN-GROUP' });
      chat = withChatHead(confirmed, chat.lastMessageId, chat.lastKnown);
    }
    row.chat = chat;
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
      const messages = readHistoryPage(await ask(pass, work, { route: 'message.history', query }), chat.groupId, users, deps.now());
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
    const key = history.map((message) => message.id).join(',');
    const historyRevision = key === row.revisionKey && row.view.historyRevision !== null ? row.view.historyRevision : deps.uuid();
    row.revisionKey = key;
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
    row.revisionKey = null;
    set(pass, row, { status: excluded ? 'excluded' : 'dm-closed', dmClosed: why, dmPriceMills: priceMills, historyRevision: null, checkedAt: iso(deps.now()), fanWrote: false, proof: null, error: null });
  }

  function greeted(pass: Pass, row: Row, personal: PassMessage, history: readonly PassMessage[]): void {
    row.kept = history.slice(-PASS_BOUNDS.previewKept);
    row.keptAll = false;
    row.proof = null;
    row.revisionKey = null;
    set(pass, row, { status: 'greeted', historyRevision: null, checkedAt: iso(deps.now()), proof: previewOf(personal, pass.creator, pass.welcome), error: null, fanWrote: false, dmClosed: null, dmPriceMills: null });
  }

  // ── the person's exclusions (R20 P10b2, FS-NEW-2): in this browser, as the old window kept them ──

  const exclusionKey = (creator: string, fanRef: string): string => `${NEWCOMERS_EXCLUDED_PREFIX}${creator}.${fanRef}`;

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
    if (open !== undefined && open.windowHours === windowHours && open.base !== 'done' && open.base !== 'stopped' && (open.watchers.has(tab) || running(open))) {
      holds(open, tab);
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
    if (pass === null || pass === undefined || row === undefined || !needsCheck(row) || pass.base === 'stopped') return { recorded: false };
    if (running(pass)) {
      // «Проверить следующим»: the running queue takes this fan next.
      pass.preferred = row.view.fanRef;
      note(pass, 'queue.prioritize', { fanRef: row.view.fanRef, reason: 'next' });
      return { recorded: true };
    }
    // A pause on its way: the request in flight ends first.
    if (pass.work !== null) return { recorded: false };
    // «Проверить чат»: the queue stands — this fan alone, now; then it stands again.
    const was = pass.base;
    note(pass, 'queue.prioritize', { fanRef: row.view.fanRef, reason: 'now' });
    begin(pass, 'queue', async (work) => {
      await queue(pass, work, row.view.fanRef);
      // Not «done» while others wait: the queue stands as it stood.
      if (was === 'paused' && pass.rows.some(needsCheck)) throw new Aborted();
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
    const work: Work = { stop, done: Promise.resolve() };
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
  async function recheck(passId: string, fanRef: string, tab: string): Promise<{ readonly ok: true; readonly historyRevision: string } | { readonly ok: false; readonly code: CgAnyCode }> {
    const pass = exact(passId, tab);
    const row = pass?.byFan.get(fanRef);
    if (pass === null || row === undefined || pass.life.aborted) return { ok: false, code: 'CG-CONTEXT-CHANGED' };
    if (row.view.status !== 'ready' || row.proof === null) return { ok: false, code: notReady(row.view) };
    const before = row.view;
    const stop = new AbortSwitch();
    pass.life.addEventListener('abort', () => stop.abort());
    const work: Work = { stop, done: Promise.resolve() };
    try {
      await check(pass, work, row, false);
    } catch (error) {
      if (byId_.get(passId) === pass && (row.view.status as FanslyFollowerRow['status']) === 'checking') set(pass, row, { status: before.status, error: before.error ?? null });
      return { ok: false, code: error instanceof Aborted || stop.aborted ? 'CG-CONTEXT-CHANGED' : failureOf(error).wire.code };
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

  /** The card's greeting went (sent, or the person's own send registered): the fan is «Уже писали» in the creator's pass. */
  function markGreeted(creator: string, fanRef: string): void {
    const pass = passes.get(creator);
    const row = pass?.byFan.get(fanRef);
    if (pass === undefined || row === undefined || row.view.status === 'greeted') return;
    row.proof = null;
    row.revisionKey = null;
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
    recheck,
    live,
    greeted: markGreeted,
    /** The work in flight, for tests and the module's dispose. */
    idle: async (): Promise<void> => {
      for (const pass of passes.values()) await pass.work?.done;
    },
    dispose(): void {
      for (const pass of [...passes.values()]) drop(pass);
      windows.clear();
    },
  };
}
