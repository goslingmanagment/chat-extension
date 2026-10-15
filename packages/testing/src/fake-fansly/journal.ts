// The fake Fansly's journal (R20 P6b): every call to its API and socket, by who
// made it and how it came — and the checks that can only live on the server.
// A request of the extension's background to loopback is seen by neither the
// BiDi network log nor the egress sink (e2e/support/network-trap.ts), so the
// rules about OUR OWN requests to Fansly are checked here, as they arrive
// (docs/project-unite/architecture.md §13, spec.md FS-NET-1, §8.3):
// - only the list FS-NET-1: a call of ours to anything else is a violation;
// - never `POST /message/ack`: our reads must not mark a message read;
// - every address of ours carries `ngsw-bypass=true`, no cookie travels with
//   it (`credentials: 'omit'`), and we never open a socket of our own.
//
// Who made a call is told by what an HTTP server can see:
// - the page: its `Origin` is the stand page's (a cross-origin XHR with
//   credentials, as fansly.com → apiv3.fansly.com);
// - ours: no `Origin` — the shape of a request from an extension page that
//   holds the host permission, the background and the relay frame alike (the
//   old extension's stand measured it, fansly-chat E149; P3a, spike.md п. 5).
//   A test process that sends no `Origin` is «ours» too: that is how the
//   checks are tested;
// - a neighbour: a token issued for it (`session.issue`). A content script of
//   an MV3 neighbour is otherwise indistinguishable from the page here, just as
//   it is for `webRequest` (P3a) — P6d's emulation asks for that token;
// - control: the stand's own control header;
// - anything else is foreign.

import { FANSLY_API_PATH, NGSW_BYPASS } from '../../fixture-fansly/src/wire';
import type { FanslyCaller } from '../../fixture-fansly/src/server-protocol';

export type { FanslyCaller };

export type FanslyVia = 'direct' | 'proxy';

/** The API's routes by name (api.ts routes a call to one; null — a path the fake does not serve). */
export type FanslyRoute =
  | 'account.me'
  | 'account.byIds'
  | 'followers.new'
  | 'messaging.groups'
  | 'group.detail'
  | 'group.create'
  | 'group.addUsers'
  | 'message.history'
  | 'message.byIds'
  | 'message.unread'
  | 'message.send'
  | 'message.ack'
  | 'message.typing'
  | 'message.automated'
  | 'notes.create'
  | 'notes.edit'
  | 'notes.delete'
  | 'vault.albums'
  | 'vault.addMedia'
  | 'vault.albumMedia'
  | 'media.create';

/**
 * FS-NET-1 (spec.md §4): the only calls our background may make — the pass of «Новые» (`followersnew`, the start of
 * the inbox, profiles, `GET /group`, `POST /group`, pages of history, `message/automated`), the greeting
 * (`POST /message`), Spenders (the inbox search, `POST /group`), «Регистрация» (`GET /group/<id>`), «Заметки»
 * (`GET /account?ids=`, `POST /notes`, `/notes/edit`, `/notes/delete`) and the identity (`GET /account/me`). The
 * server's own copy of the list: the client's (packages/fansly-api) is checked against it by arriving here.
 */
export const FS_NET_1: ReadonlySet<FanslyRoute> = new Set<FanslyRoute>([
  'account.me',
  'account.byIds',
  'followers.new',
  'messaging.groups',
  'group.detail',
  'group.create',
  'message.history',
  'message.automated',
  'message.send',
  'notes.create',
  'notes.edit',
  'notes.delete',
]);

export type FanslyViolationReason =
  /** A call outside FS-NET-1 (a path the fake does not know included). */
  | 'not-allowlisted'
  /** `POST /message/ack` from us: never. */
  | 'ack'
  /** No `ngsw-bypass=true` in the address. */
  | 'ngsw-bypass'
  /** A cookie came with the request: it was not `credentials: 'omit'`. */
  | 'credentials'
  /** A socket of our own to Fansly. */
  | 'socket';

export interface FanslyViolation {
  /** The journal entry it is about. */
  readonly seq: number;
  readonly reason: FanslyViolationReason;
  /** `POST /api/v1/message/ack?…` or `socket`. */
  readonly what: string;
}

export interface FanslyJournalEntry {
  readonly seq: number;
  /** Milliseconds since the journal started. */
  readonly at: number;
  readonly kind: 'http' | 'preflight' | 'ws-open' | 'ws-stalled' | 'ws-in' | 'ws-out' | 'ws-close' | 'proxy-refused';
  readonly caller: FanslyCaller;
  /** `proxy` — it came through the stand's proxy (proxy.ts): the relay's road. */
  readonly via: FanslyVia;
  readonly method?: string;
  /** The path with its query. */
  readonly path?: string;
  readonly route?: FanslyRoute | null;
  readonly status?: number;
  readonly socketId?: number;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface FanslyJournalPage {
  readonly entries: readonly FanslyJournalEntry[];
  /** Violations of the entries after `since`. */
  readonly violations: readonly FanslyViolation[];
  readonly next: number;
}

export interface CallerFacts {
  /** The `Origin` header. */
  readonly origin: string | undefined;
  /** The control header is there. */
  readonly control: boolean;
  /** The name a token was issued under (`session.issue`), if the request carries such a token. */
  readonly tokenLabel: 'neighbour' | null;
}

/** An extension page's request with the host permission: no `Origin`, or the opaque one, or the extension's own. */
const isExtensionOrigin = (origin: string | undefined): boolean => origin === undefined || origin === 'null' || origin.startsWith('moz-extension://');

export function classifyCaller(facts: CallerFacts, pageOrigin: string): FanslyCaller {
  if (facts.control) return 'control';
  if (facts.tokenLabel === 'neighbour') return 'neighbour';
  if (facts.origin === pageOrigin) return 'page';
  if (isExtensionOrigin(facts.origin)) return 'ours';
  return 'foreign';
}

/** What of a request the checks read besides its journal entry. */
export interface RequestFacts {
  readonly ngswBypass: boolean;
  readonly cookie: boolean;
}

/** Whether an address carries `ngsw-bypass=true` (the page adds it to every API address, main:25694-25697). */
export const hasNgswBypass = (url: URL): boolean => url.searchParams.get(NGSW_BYPASS) === 'true';

/** The violations of one entry: only a call of OURS can break our rules. */
export function violationsOf(entry: FanslyJournalEntry, facts: RequestFacts | null): FanslyViolation[] {
  if (entry.caller !== 'ours') return [];
  if (entry.kind === 'ws-open' || entry.kind === 'ws-stalled') return [{ seq: entry.seq, reason: 'socket', what: 'socket' }];
  if (entry.kind !== 'http') return [];
  const what = `${entry.method ?? '?'} ${entry.path ?? '?'}`;
  const reasons: FanslyViolationReason[] = [];
  if (entry.route === 'message.ack') reasons.push('ack');
  else if (entry.route === null || entry.route === undefined || !FS_NET_1.has(entry.route)) reasons.push('not-allowlisted');
  if (facts !== null && !facts.ngswBypass && (entry.path ?? '').startsWith(FANSLY_API_PATH)) reasons.push('ngsw-bypass');
  if (facts !== null && facts.cookie) reasons.push('credentials');
  return reasons.map((reason) => ({ seq: entry.seq, reason, what }));
}

const MAX_ENTRIES = 20_000;

type NewEntry = Omit<FanslyJournalEntry, 'seq' | 'at'>;

export class FanslyJournal {
  private readonly started = performance.now();
  private readonly entries: FanslyJournalEntry[] = [];
  private readonly found: FanslyViolation[] = [];
  private seq = 0;

  record(entry: NewEntry, facts: RequestFacts | null = null): FanslyJournalEntry {
    this.seq += 1;
    const full: FanslyJournalEntry = { ...entry, seq: this.seq, at: Math.round((performance.now() - this.started) * 100) / 100 };
    this.entries.push(full);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.found.push(...violationsOf(full, facts));
    return full;
  }

  read(since = 0): FanslyJournalPage {
    return { entries: this.entries.filter((entry) => entry.seq > since), violations: this.violations(since), next: this.seq };
  }

  /** Our own calls that broke a rule, after `since`. Never dropped with old entries: a violation is kept until read. */
  violations(since = 0): FanslyViolation[] {
    return this.found.filter((violation) => violation.seq > since);
  }

  /** The calls of one caller after `since` (`http` only: what was asked, not the socket's traffic). */
  calls(caller: FanslyCaller, since = 0): FanslyJournalEntry[] {
    return this.entries.filter((entry) => entry.seq > since && entry.kind === 'http' && entry.caller === caller);
  }

  get next(): number {
    return this.seq;
  }
}

/** One line per violation, for an assertion's message. */
export function describeViolations(violations: readonly FanslyViolation[]): string {
  return violations.map((violation) => `#${violation.seq} ${violation.reason}: ${violation.what}`).join('\n');
}
