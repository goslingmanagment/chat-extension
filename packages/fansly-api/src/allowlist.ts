// FS-NET-1 as data (R20 docs/project-unite/spec.md §4, architecture.md §8.3,
// §8.4): the only requests the extension ever makes to Fansly of its own — by
// its background, to `https://apiv3.fansly.com/api/v1/` alone — and, for each,
// why it is made and how the pacer takes it.
//
// - A route is one address of Fansly's API: its method, its path under the
//   base (a `:name` segment takes an id), the query keys it may carry, the
//   family of its `fansly-client-check` (the families P9a captures them by,
//   composition/site-access.ts `routeFamily`) and its pace key (the pacer's
//   rules, pacer/rules.ts).
// - A purpose is a row of FS-NET-1's table: the «Новые» pass, the greeting,
//   Spenders, «Регистрация», «Заметки», the identity, «Онлайн». Only a (purpose, route)
//   pair named here is admitted; the pair gives the call its pacer mode
//   (architecture §8.4 — a mode per call, not per route: `GET /group/<id>` waits
//   its turn in a pass and only checks the cooldown for «Регистрация») and how
//   many attempts it may make (RB-023: a read of a pass may be asked again, a
//   write never, a click's read once).
// - Anything else — another route, another pair, `POST /message/ack` above all
//   (our reads never mark a message read, RB-022) — is refused before any
//   request (`not-admitted`). The fake Fansly keeps its own copy of the list and
//   checks every call of ours against it as it arrives
//   (packages/testing/src/fake-fansly/journal.ts `FS_NET_1`).
//
// Every address is the base, the route's path, its query and `ngsw-bypass=true`
// (the page asks every API address so, and the site's service worker then
// leaves the request alone). Ids in a path are decimal strings, never numbers
// (Fansly's ids are above 2^53).

/** Where every request of ours to Fansly goes (FS-NET-1); the relay checks the same prefix (FANSLY_RELAY_TARGET). */
export const FANSLY_API_BASE = 'https://apiv3.fansly.com/api/v1/';

/** The page's own marker on every API address (main:25694-25697). */
export const NGSW_BYPASS = 'ngsw-bypass';

/** Fansly's ids in a path or a list: decimal strings (18–19 digits today), never numbers. */
const ID = /^[1-9][0-9]{0,23}$/;
/** A query value of ours: short, printable. */
export const QUERY_VALUE_MAX = 2048;

export type FanslyMethod = 'GET' | 'POST';

export interface FanslyRouteSpec {
  readonly method: FanslyMethod;
  /** The path under the base; a `:name` segment takes an id (`group/:group/`). */
  readonly path: string;
  /** The query keys the route may carry (besides `ngsw-bypass`, which every address carries). */
  readonly query: readonly string[];
  /** A write: one attempt, never repeated on an unclear outcome (FS-NET-3). */
  readonly write: boolean;
  /** The family of its `fansly-client-check` (P9a's capture); null — no check is sent. */
  readonly checkFamily: string | null;
  /** The pacer's key of the route (pacer/rules.ts). */
  readonly pace: string;
  /** Its answer may be an envelope without `response` (a delete has nothing to hand back). */
  readonly emptyAnswer?: true;
}

/** The routes of FS-NET-1; names as the fake Fansly's journal names them. */
export const FANSLY_ROUTES = {
  'account.me': { method: 'GET', path: 'account/me', query: [], write: false, checkFamily: 'account', pace: 'GET /account*' },
  'account.byIds': { method: 'GET', path: 'account', query: ['ids'], write: false, checkFamily: 'account', pace: 'GET /account*' },
  'followers.new': {
    method: 'GET',
    path: 'account/:account/followersnew',
    query: ['before', 'after', 'limit', 'offset', 'search', 'lastSeenAfter'],
    write: false,
    checkFamily: 'account',
    pace: 'GET /account*',
  },
  'messaging.groups': {
    method: 'GET',
    path: 'messaging/groups',
    query: ['sortOrder', 'flags', 'subscriptionTierId', 'listIds', 'search', 'limit', 'offset'],
    write: false,
    checkFamily: 'messagingGroups',
    pace: 'GET /messaging/groups',
  },
  'group.detail': { method: 'GET', path: 'group/:group/', query: [], write: false, checkFamily: 'group', pace: 'GET /group/:id' },
  'group.create': { method: 'POST', path: 'group', query: [], write: true, checkFamily: 'group', pace: 'POST /group' },
  'message.history': { method: 'GET', path: 'message', query: ['groupId', 'before', 'limit'], write: false, checkFamily: 'message', pace: 'GET /message' },
  'message.automated': { method: 'GET', path: 'message/automated', query: [], write: false, checkFamily: 'message', pace: 'GET /message/automated' },
  'message.send': { method: 'POST', path: 'message', query: [], write: true, checkFamily: 'message', pace: 'POST /message' },
  // One fan's orders of one paid media or bundle (the old extension's purchase check, fansly-client.ts 2.13.0).
  'media.orderhistory': {
    method: 'GET',
    path: 'media/orderhistory',
    query: ['accountMediaId', 'accountMediaBundleId', 'accountIds', 'limit'],
    write: false,
    checkFamily: 'media',
    pace: 'GET /media/orderhistory',
  },
  // The creator's bundles by id (the page's `getAccountMediaBundles`, main:29512): which of the copied items are bundles.
  'media.bundles': { method: 'GET', path: 'account/media/bundle', query: ['ids'], write: false, checkFamily: 'account', pace: 'GET /account/media/bundle' },
  'notes.create': { method: 'POST', path: 'notes', query: [], write: true, checkFamily: null, pace: 'POST /notes' },
  // decision 170 of the Fansly extension: Fansly's window takes `success` alone as an edit's confirmation.
  'notes.edit': { method: 'POST', path: 'notes/edit', query: [], write: true, checkFamily: null, pace: 'POST /notes', emptyAnswer: true },
  'notes.delete': { method: 'POST', path: 'notes/delete', query: [], write: true, checkFamily: null, pace: 'POST /notes', emptyAnswer: true },
} as const satisfies Record<string, FanslyRouteSpec>;

export type FanslyRouteName = keyof typeof FANSLY_ROUTES;
export const FANSLY_ROUTE_NAMES = Object.keys(FANSLY_ROUTES) as FanslyRouteName[];

/** Why the extension asks Fansly at all: the rows of FS-NET-1's table. */
export const FANSLY_PURPOSES = ['newcomers', 'greeting', 'spenders', 'registration', 'notes', 'identity', 'hi', 'ppv', 'preview', 'outreach', 'online'] as const;
export type FanslyPurpose = (typeof FANSLY_PURPOSES)[number];

/**
 * How the pacer takes a call (architecture §8.4):
 * - `queue` — the creator's FIFO: one attempt in flight, the gaps, the keys' spacing, and it waits out a cooldown;
 * - `queue-or-refuse` — the FIFO and its gaps, but a cooldown refuses it at once instead of being waited out
 *   (`POST /group`);
 * - `check` — no queue and no wait: refused while the creator cools down, otherwise at once (a click's read);
 * - `dispatch` — a write after the hub's custody: never waits; a cooldown refuses it before the custody.
 */
export type PacerMode = 'queue' | 'queue-or-refuse' | 'check' | 'dispatch';

export interface FanslyAdmission {
  readonly mode: PacerMode;
  /** Attempts the call may make: more than one only for a read of a running pass (RB-023). */
  readonly attempts: number;
}

/** A read of a running pass may be asked again: after 1, 2 and 4 s on a 5xx, after the cooldown on a 429 (RB-023). */
const PASS_READ: FanslyAdmission = { mode: 'queue', attempts: 4 };
/** A read the person waits for by a click: once, and not at all while the creator cools down. */
const CLICK_READ: FanslyAdmission = { mode: 'check', attempts: 1 };
/**
 * A read an open window repeats on its own (at most once a minute per creator, its caller's rule): never in the creator's
 * FIFO — a person's click never waits behind it, nor it behind a pass —, once, and not at all while the creator cools
 * down (the window keeps what it had). Not a pass's read: a cooldown is never waited out, a failure never asked again.
 */
const POLL_READ: FanslyAdmission = { mode: 'check', attempts: 1 };
/** `POST /group` (get-or-create by identity): its turn in the FIFO, refused at once during a cooldown, one attempt. */
const GROUP_WRITE: FanslyAdmission = { mode: 'queue-or-refuse', attempts: 1 };
/** A write the person asked for: one attempt, no wait (the hub's custody is already taken for a greeting). */
const WRITE: FanslyAdmission = { mode: 'dispatch', attempts: 1 };
/**
 * A read a send waits for (the check right before it, NF-036): its turn in the creator's FIFO, one attempt, refused at
 * once during a cooldown — the click is told how long, it never sits the cooldown out (the old `assertNotCooling`).
 */
const SEND_CHECK: FanslyAdmission = { mode: 'queue-or-refuse', attempts: 1 };

/** FS-NET-1: the admitted pairs and their mode. A pair not here is never requested. */
export const FS_NET_1: { readonly [P in FanslyPurpose]: Partial<Record<FanslyRouteName, FanslyAdmission>> } = {
  // «Новые» (Б17): `followersnew`, the start of the inbox, the profiles, the group, `POST /group`, the pages of history,
  // `message/automated` — in a running pass.
  newcomers: {
    'followers.new': PASS_READ,
    'messaging.groups': PASS_READ,
    'account.byIds': PASS_READ,
    'group.detail': PASS_READ,
    'group.create': GROUP_WRITE,
    'message.history': PASS_READ,
    'message.automated': PASS_READ,
  },
  // The greeting of «Новые»: one click, one attempt; the fan's group and history read again right before it.
  greeting: { 'message.send': WRITE, 'group.detail': SEND_CHECK, 'message.history': SEND_CHECK },
  // Spenders: the inbox search, `POST /group`, the names — by a click; the names only when the hub gave none.
  spenders: { 'messaging.groups': CLICK_READ, 'group.create': GROUP_WRITE, 'account.byIds': CLICK_READ },
  // «Регистрация»: `GET /group/<id>` when the fan's id is unknown, one attempt, nothing during a cooldown.
  registration: { 'group.detail': CLICK_READ },
  // «Заметки»: the group and `GET /account?ids=` when the panel or the chat opens — once, and not at all while the
  // creator cools down (FS-NOTE-3; R20 P11b: as a click's read, not a pass's); the writes by the person's action.
  notes: { 'group.detail': CLICK_READ, 'account.byIds': CLICK_READ, 'notes.create': WRITE, 'notes.edit': WRITE, 'notes.delete': WRITE },
  // The identity, when the page's own answer did not give it.
  identity: { 'account.me': PASS_READ },
  // Hi in the open chat when the tab saw no start of it (a cold load, a new socket): the welcome texts and the pages of
  // history to the empty one, by the person's click — once, and not at all while the creator cools down.
  hi: { 'message.history': CLICK_READ, 'message.automated': CLICK_READ },
  // An AI start in the open chat: its newest pages of history and, for each paid attachment no inline order shows bought,
  // the fan's orders of it — by the person's click, once, and not at all while the creator cools down.
  ppv: { 'message.history': CLICK_READ, 'media.orderhistory': CLICK_READ },
  // A fan's preview (Spenders, «Новые», the palette): the group, whether the fan read its newest message — once the
  // preview rests on the fan, once, and not at all while the creator cools down.
  preview: { 'group.detail': CLICK_READ },
  // «Рассылка» of Spenders: a fan's personal message with the copied bundles, by the person's click on its row — one
  // `POST /message`, one attempt (the fan's group is found by Spenders' own `spenders` reads before it). Opening the
  // bar or «Обновить» asks once which copied items are bundles: Fansly's own reload files them as media.
  outreach: { 'message.send': WRITE, 'media.bundles': CLICK_READ },
  // «Онлайн»: who of the creator's followers was active lately — `followersnew?lastSeenAfter=`, the read FBuddy makes —,
  // while a window or the bar's count needs it, at most once a minute per creator; never queued, never during a cooldown.
  online: { 'followers.new': POLL_READ },
};

const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

export const isFanslyRouteName = (value: unknown): value is FanslyRouteName => typeof value === 'string' && has(FANSLY_ROUTES, value);
export const isFanslyPurpose = (value: unknown): value is FanslyPurpose => typeof value === 'string' && (FANSLY_PURPOSES as readonly string[]).includes(value);

/** The admission of a pair; null — FS-NET-1 does not name it, and no request is made. */
export function admit(purpose: unknown, route: unknown): FanslyAdmission | null {
  if (!isFanslyPurpose(purpose) || !isFanslyRouteName(route)) return null;
  return FS_NET_1[purpose][route] ?? null;
}

/** What a call names of its address: the path's ids and the query. */
export interface FanslyAddressParts {
  readonly path?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
}

/**
 * The address of a call: the base, the route's path with its ids, the query it may carry, `ngsw-bypass=true`. Null —
 * the parts do not fit the route (an id that is not one, a missing or unknown segment, a query key the route does not
 * carry, a value too long): nothing is requested.
 */
export function addressOf(base: string, route: FanslyRouteName, parts: FanslyAddressParts = {}): string | null {
  const spec: FanslyRouteSpec = FANSLY_ROUTES[route];
  const ids = parts.path ?? {};
  const used = new Set<string>();
  let failed = false;
  const path = spec.path.replace(/:([a-z]+)/g, (_, name: string) => {
    const value = has(ids, name) ? ids[name] : undefined;
    if (value === undefined || !ID.test(value)) failed = true;
    used.add(name);
    return value ?? '';
  });
  if (failed || Object.keys(ids).some((name) => !used.has(name))) return null;
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    return null;
  }
  if (!url.href.startsWith(base)) return null;
  for (const [key, value] of Object.entries(parts.query ?? {})) {
    if (!spec.query.includes(key) || typeof value !== 'string' || value.length > QUERY_VALUE_MAX) return null;
    url.searchParams.set(key, value);
  }
  url.searchParams.set(NGSW_BYPASS, 'true');
  return url.href;
}
