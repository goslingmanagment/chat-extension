// The fake Fansly's API (`https://apiv3.fansly.com/api/v1` on the real site;
// S2 Q2, Q3; fansly-web.md §4): the endpoints the stand page asks and the ones
// our background may ask (FS-NET-1), answered from the synthetic world in
// Fansly's envelope `{success, response}`.
// - Cross-origin for the page, as on the real site: CORS for the stand page's
//   origin only, with credentials and a preflight (the page's XHR carries the
//   session headers and `withCredentials`).
// - A session: `authorization` must be a live token (401 otherwise).
// - A test scripts outcomes (state.ts, `ApiRule`): 429 with `Retry-After`, a
//   refusal inside HTTP 200 (`success: false`), a delay, a hang, a dropped
//   connection, a body that is not JSON — instead of the request or, for a
//   write, after it took effect (its answer lost).
// - `POST /message` answers with the created message and echoes it on the
//   socket (`5/1`), in the order and with the delays a test sets.
// Every call is journaled with who made it (journal.ts); the rules about our
// own calls are checked there.
//
// Not Fansly's: `POST /account/media` is the stand page's stand-in for the
// site's upload flow (multipart PUTs to signed addresses, main:38138-38161).

import type { IncomingMessage, ServerResponse } from 'node:http';

import { FANSLY_CONTROL_HEADER, FANSLY_CONTROL_PATH, type ApiOutcome, type FakeFanslyCommand } from '../../fixture-fansly/src/server-protocol';
import {
  FANSLY_API_PATH,
  FANSLY_SESSION_HEADERS,
  NGSW_BYPASS,
  ackFrame,
  groupUserFrame,
  messageCreatedFrame,
  type WireAckBody,
  type WireCreateGroupBody,
  type WireEnvelope,
  type WireError,
  type WireNoteBody,
  type WireSendBody,
} from '../../fixture-fansly/src/wire';
import { FakeFanslyCommandError, groupCreatedFrame, runCommand } from './control';
import { HISTORY_PAGE, MESSAGE_TYPE, type FanslyWorld } from './data';
import { classifyCaller, hasNgswBypass, type FanslyCaller, type FanslyRoute, type FanslyVia, type RequestFacts } from './journal';
import type { FanslySocketHub } from './socket';
import type { FanslyState } from './state';

/** A cookie the API sets for the page (`withCredentials`): a request of ours that carries it was not `credentials: 'omit'`. */
export const STAND_COOKIE = 'stand_fansly_session';

const ALLOWED_HEADERS = [...FANSLY_SESSION_HEADERS, 'content-type', 'accept', NGSW_BYPASS, FANSLY_CONTROL_HEADER].join(', ');
const PREFLIGHT_MAX_AGE_S = 600;

const headerText = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value.join(',') : value);
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body));
}

const failure = (code: number, details?: string): WireEnvelope<never> => ({ success: false, error: { code, ...(details !== undefined ? { details } : {}) } });

interface ApiCall {
  readonly world: FanslyWorld;
  readonly state: FanslyState;
  readonly hub: FanslySocketHub;
  readonly params: URLSearchParams;
  /** The path's captures (a group id, an account id). */
  readonly match: RegExpExecArray;
  readonly body: unknown;
  readonly caller: FanslyCaller;
  /** The request path after `/api/v1`. */
  readonly path: string;
}

interface RouteAnswer {
  /** `undefined` — an envelope with no `response` (a delete has nothing to hand back, old `postOnce`). */
  readonly response?: unknown;
  /** A refusal of the request itself: an HTTP status with the error envelope. */
  readonly error?: { readonly status: number } & WireError;
  readonly headers?: Record<string, string>;
  /** The answer waits this long. */
  readonly delayMs?: number;
  /** What the journal keeps of the call besides its route and status (ids and counts, never a text). */
  readonly journal?: Readonly<Record<string, unknown>>;
  /** Runs before the answer is written / after it (the socket echo of a send, the receipt of an ack). */
  readonly before?: () => void;
  readonly after?: () => void;
}

interface Route {
  readonly name: FanslyRoute;
  readonly method: 'GET' | 'POST';
  readonly path: RegExp;
  readonly run: (call: ApiCall) => RouteAnswer;
}

const bad = (details: string): RouteAnswer => ({ error: { status: 400, code: 400, details } });
const missing = (details: string): RouteAnswer => ({ error: { status: 404, code: 404, details } });
const asRecord = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
/** `before=0` and an absent `before` both mean «from the newest» (the page's own default, main:28396-28404). */
const cursor = (value: string | null): string | null => (value === null || value === '' || value === '0' ? null : value);
const count = (value: string | null, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};
const idList = (value: string | null): string[] => (value ?? '').split(',').filter((id) => /^\d{1,24}$/.test(id));

const ROUTES: readonly Route[] = [
  {
    name: 'account.me',
    method: 'GET',
    path: /^\/account\/me$/,
    run: ({ world, caller }) => {
      const creator = world.accounts.get(world.creatorId);
      if (creator === undefined) return missing('no account');
      return {
        response: { account: world.wireAccount(creator), correlationId: world.nextId(), authorizedAccountFlags: 0 },
        ...(caller === 'page' ? { headers: { 'set-cookie': `${STAND_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax` } } : {}),
      };
    },
  },
  {
    // The account cache of the page and our «Заметки»: accounts with the creator's notes on them (S2 Q3).
    name: 'account.byIds',
    method: 'GET',
    path: /^\/account$/,
    run: ({ world, params }) => ({ response: idList(params.get('ids')).flatMap((id) => world.accounts.get(id) ?? []).map((account) => world.wireAccount(account)) }),
  },
  {
    name: 'followers.new',
    method: 'GET',
    path: /^\/account\/(\d+)\/followersnew$/,
    run: ({ world, params, match }) => {
      if (match[1] !== world.creatorId) return { response: { followers: [], aggregationData: { accounts: [] } } };
      return { response: world.wireFollowersPage(cursor(params.get('before')), count(params.get('limit'), 100, 100)) };
    },
  },
  {
    name: 'messaging.groups',
    method: 'GET',
    path: /^\/messaging\/groups$/,
    run: ({ world, params }) => ({ response: world.wireInboxPage(params.get('search') ?? '', count(params.get('limit'), 20, 100), Number(params.get('offset') ?? 0) || 0) }),
  },
  {
    // With the slash (the page, main:28372-28378) or without (the hub's spec): the same group.
    name: 'group.detail',
    method: 'GET',
    path: /^\/group\/(\d+)\/?$/,
    run: ({ world, match }) => {
      const group = world.groups.get(match[1] ?? '');
      return group === undefined ? missing('no group') : { response: world.wireGroup(group) };
    },
  },
  {
    name: 'group.create',
    method: 'POST',
    path: /^\/group$/,
    run: ({ world, hub, body }) => {
      const users = (asRecord(body) as WireCreateGroupBody | null)?.users;
      const ids = Array.isArray(users) ? users.map((user: { userId?: unknown }) => user.userId) : [];
      const fanId = ids.find((id): id is string => typeof id === 'string' && id !== world.creatorId);
      if (ids.length !== 2 || !ids.includes(world.creatorId) || fanId === undefined || !/^\d{1,24}$/.test(fanId)) return bad('a conversation is the creator and one more account');
      const { group, created } = world.createConversation(fanId);
      return { response: world.wireGroup(group), ...(created ? { after: () => void hub.emit([groupCreatedFrame(group.id)], '4/8') } : {}) };
    },
  },
  {
    // Adding members to a group chat: the page reads only `response.users` (main:28340-28347).
    name: 'group.addUsers',
    method: 'POST',
    path: /^\/group\/(\d+)\/?$/,
    run: ({ world, hub, match, body }) => {
      const group = world.groups.get(match[1] ?? '');
      if (group === undefined) return missing('no group');
      const asked = asRecord(body)?.['groupUsers'];
      const added = (Array.isArray(asked) ? asked : []).map((user: { userId?: unknown }) => user.userId).filter((id): id is string => typeof id === 'string' && !group.users.includes(id));
      for (const id of added) world.ensureAccount(id);
      group.users = [...group.users, ...added];
      return {
        response: { users: group.users.map((userId) => world.wireGroupUser(group, userId)) },
        ...(added.length > 0 ? { after: () => void hub.emit(added.map((userId) => groupUserFrame(world.wireGroupUser(group, userId), true)), '4/6') } : {}),
      };
    },
  },
  {
    // The fresh end (no `before`) or the page before a message; never `offset` or `after` from the page (S2 Q1.7).
    name: 'message.history',
    method: 'GET',
    path: /^\/message$/,
    run: ({ world, params }) => {
      const groupId = params.get('groupId');
      if (groupId === null || groupId === '') return bad('groupId');
      return { response: world.wireHistory(world.history(groupId, cursor(params.get('before')), count(params.get('limit'), HISTORY_PAGE, 100))) };
    },
  },
  {
    name: 'message.byIds',
    method: 'GET',
    path: /^\/messages$/,
    run: ({ world, params }) => ({ response: world.wireHistory(idList(params.get('ids')).flatMap((id) => world.messages.get(id) ?? [])) }),
  },
  {
    name: 'message.unread',
    method: 'GET',
    path: /^\/message\/unread$/,
    run: ({ world, params }) => ({ response: world.wireUnread(cursor(params.get('before')), count(params.get('limit'), 100, 100), Number(params.get('offset') ?? 0) || 0) }),
  },
  {
    name: 'message.send',
    method: 'POST',
    path: /^\/message$/,
    run: ({ world, state, hub, body }) => {
      const sent = asRecord(body) as Partial<WireSendBody> | null;
      const group = typeof sent?.groupId === 'string' ? world.groups.get(sent.groupId) : undefined;
      if (sent === null || group === undefined) return missing('no group');
      if (typeof sent.content !== 'string') return bad('content');
      const message = world.addMessage({
        groupId: group.id,
        senderId: world.creatorId,
        content: sent.content,
        type: typeof sent.type === 'number' ? sent.type : MESSAGE_TYPE.message,
        inReplyTo: typeof sent.inReplyTo === 'string' ? sent.inReplyTo : null,
        attachments: Array.isArray(sent.attachments) ? sent.attachments : [],
      });
      const wire = world.wireMessage(message);
      const echo = (): void => void hub.emit([messageCreatedFrame(wire)], '5/1 echo');
      const { echo: order, receiptDelayMs, echoDelayMs } = state.send;
      return {
        response: wire,
        delayMs: receiptDelayMs,
        ...(order === 'before' ? { before: echo } : {}),
        ...(order === 'after' ? { after: () => (echoDelayMs > 0 ? void setTimeout(echo, echoDelayMs) : echo()) } : {}),
      };
    },
  },
  {
    // The page's own: it marks messages delivered and read (main:28316-28323). Never ours (journal.ts).
    name: 'message.ack',
    method: 'POST',
    path: /^\/message\/ack$/,
    run: ({ world, hub, body }) => {
      const ack = asRecord(body) as Partial<WireAckBody> | null;
      const ids = Array.isArray(ack?.messageIds) ? ack.messageIds.filter((id): id is string => typeof id === 'string') : [];
      const type = typeof ack?.type === 'number' ? ack.type : 0;
      if (ids.length === 0 || type < 1 || type > 4) return bad('messageIds and type');
      world.ack(world.creatorId, ids, type);
      // Every socket of the account hears of it (GroupService 4/2, 7 009 a day on production, S2 Q1.4). The journal
      // keeps WHAT was marked: the page sends its marks in chunks, so the number of calls says nothing by itself.
      return { response: {}, journal: { ackType: type, messageIds: ids }, after: () => void hub.emit([ackFrame({ type, userId: world.creatorId, messageIds: ids })], '4/2 own') };
    },
  },
  { name: 'message.typing', method: 'POST', path: /^\/message\/typing$/, run: ({ body }) => (typeof asRecord(body)?.['groupId'] === 'string' ? { response: {} } : bad('groupId')) },
  { name: 'message.automated', method: 'GET', path: /^\/message\/automated$/, run: ({ world }) => ({ response: world.automated }) },
  {
    name: 'notes.create',
    method: 'POST',
    path: /^\/notes$/,
    run: ({ world, body }) => {
      const note = asRecord(body) as Partial<WireNoteBody> | null;
      if (note === null || typeof note.contentId !== 'string' || typeof note.contentType !== 'number' || typeof note.title !== 'string' || typeof note.note !== 'string') return bad('a note');
      return { response: world.wireNote(world.createNote(note.contentId, note.contentType, note.title, note.note)) };
    },
  },
  {
    name: 'notes.edit',
    method: 'POST',
    path: /^\/notes\/edit$/,
    run: ({ world, body }) => {
      const note = asRecord(body) as Partial<WireNoteBody> | null;
      const found = typeof note?.id === 'string' ? world.findNote(note.id) : null;
      if (note === null || found === null) return missing('no note');
      if (typeof note.title !== 'string' || typeof note.note !== 'string') return bad('a note');
      found.note.title = note.title;
      found.note.note = note.note;
      found.note.updatedAt = Date.now();
      return { response: world.wireNote(found.note) };
    },
  },
  {
    name: 'notes.delete',
    method: 'POST',
    path: /^\/notes\/delete$/,
    run: ({ world, body }) => {
      const id = asRecord(body)?.['id'];
      const found = typeof id === 'string' ? world.findNote(id) : null;
      if (found === null) return missing('no note');
      found.account.notes.splice(found.account.notes.indexOf(found.note), 1);
      return {};
    },
  },
  { name: 'vault.reload', method: 'GET', path: /^\/media\/vaultnew$/, run: ({ world, params }) => {
    const album = world.albums.find((a) => a.id === params.get('albumId'));
    return album ? { response: { media: [...album.mediaIds].reverse().map((id) => ({ id, filename: world.vaultMedia.get(id) ?? id })) } } : missing('no album');
  } },
  { name: 'vault.albums', method: 'GET', path: /^\/vault\/albums(?:new)?$/, run: ({ world }) => ({ response: world.wireAlbums() }) },
  {
    // The page checks only `success` (main:30320-30326, :12818-12827); what the answer carries is not known.
    name: 'vault.addMedia',
    method: 'POST',
    path: /^\/vault\/albums\/media$/,
    run: ({ world, body }) => {
      const asked = asRecord(body);
      const album = world.albums.find((item) => item.id === asked?.['albumId']);
      const mediaIds = Array.isArray(asked?.['mediaIds']) ? asked['mediaIds'].filter((id): id is string => typeof id === 'string') : [];
      if (album === undefined) return missing('no album');
      if (mediaIds.length === 0) return bad('mediaIds');
      album.mediaIds.push(...mediaIds);
      return { response: {} };
    },
  },
  {
    name: 'media.create',
    method: 'POST',
    path: /^\/account\/media$/,
    run: ({ world, body }) => ({ response: (Array.isArray(body) ? body : []).map((file: unknown) => {
      const contentId = world.nextId();
      const name = asRecord(file)?.['name'];
      if (typeof name === 'string') world.vaultMedia.set(contentId, name);
      return { contentId, contentType: 1 };
    }) }),
  },
];

/** The route of a call; null — a path of the API the fake does not serve. */
export function routeOf(method: string, pathname: string): { readonly route: Route; readonly match: RegExpExecArray } | null {
  if (!pathname.startsWith(`${FANSLY_API_PATH}/`)) return null;
  const path = pathname.slice(FANSLY_API_PATH.length);
  for (const route of ROUTES) {
    const match = route.method === method ? route.path.exec(path) : null;
    if (match !== null) return { route, match };
  }
  return null;
}

/** Writes a scripted outcome instead of the answer. Returns the status journaled (0 — no answer). */
async function writeOutcome(state: FanslyState, response: ServerResponse, outcome: Exclude<ApiOutcome, { kind: 'delay' }>): Promise<number> {
  switch (outcome.kind) {
    case 'status':
      sendJson(response, outcome.status, failure(outcome.status), outcome.retryAfterS !== undefined ? { 'retry-after': String(outcome.retryAfterS) } : {});
      return outcome.status;
    case 'refuse':
      sendJson(response, 200, failure(outcome.code));
      return 200;
    case 'garbage':
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end('<!doctype html><title>Stand edge page</title>');
      return 200;
    case 'hang':
      state.hanging.add(response);
      response.on('close', () => state.hanging.delete(response));
      return 0;
    case 'drop':
      await delay(0);
      response.destroy();
      return 0;
  }
}

/** One request to the API origin. `via` — how it came: straight, or through the stand's proxy. */
export async function handleFanslyApi(state: FanslyState, hub: FanslySocketHub, request: IncomingMessage, response: ServerResponse, via: FanslyVia): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${state.apiHost}`);
  const method = request.method ?? 'GET';
  const origin = headerText(request.headers.origin);
  if (headerText(request.headers.host) !== state.apiHost) {
    // One stand address, one site (as the stand page's own name).
    response.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' }).end(`The fake Fansly API answers at http://${state.apiHost} only.`);
    return;
  }
  // CORS for the stand page's origin only; every answer carries it, errors included.
  if (origin === state.pageOrigin) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('access-control-allow-credentials', 'true');
  }
  response.setHeader('vary', 'Origin');
  const control = request.headers[FANSLY_CONTROL_HEADER] !== undefined;
  const token = headerText(request.headers.authorization);
  const caller = classifyCaller({ origin, control, tokenLabel: state.labelOf(token) }, state.pageOrigin);
  const path = `${url.pathname}${url.search}`;

  if (method === 'OPTIONS') {
    response.writeHead(204, { 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': ALLOWED_HEADERS, 'access-control-max-age': String(PREFLIGHT_MAX_AGE_S) }).end();
    // The stand page's controls ask first too: the stand's own, never journaled.
    if (!url.pathname.startsWith(FANSLY_CONTROL_PATH)) state.journal.record({ kind: 'preflight', caller, via, method, path, status: 204 });
    return;
  }

  if (url.pathname.startsWith(FANSLY_CONTROL_PATH)) {
    // The stand's own control: never journaled, and closed without its header.
    if (!control) {
      sendJson(response, 403, { error: 'control endpoints need the control header' });
      return;
    }
    if (method === 'GET' && url.pathname === `${FANSLY_CONTROL_PATH}/journal`) {
      sendJson(response, 200, state.journal.read(Number(url.searchParams.get('since') ?? 0)));
      return;
    }
    if (method !== 'POST' || url.pathname !== FANSLY_CONTROL_PATH) {
      sendJson(response, 404, { error: 'POST a command, or GET …/journal' });
      return;
    }
    try {
      sendJson(response, 200, runCommand(state, hub, (await readJson(request)) as FakeFanslyCommand));
    } catch (error) {
      if (!(error instanceof FakeFanslyCommandError) && !(error instanceof TypeError)) throw error;
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  const found = routeOf(method, url.pathname);
  const route = found?.route.name ?? null;
  const facts: RequestFacts = { ngswBypass: hasNgswBypass(url), cookie: (headerText(request.headers.cookie) ?? '').includes(`${STAND_COOKIE}=`) };
  // Which of Fansly's session headers the request carries — their names, never their values.
  const headers = FANSLY_SESSION_HEADERS.filter((name) => request.headers[name] !== undefined);
  const log = (status: number, detail: Record<string, unknown> = {}): void => {
    state.journal.record({ kind: 'http', caller, via, method, path, route, status, detail: { ...detail, headers } }, facts);
  };

  if (!state.isLive(token)) {
    sendJson(response, 401, failure(401, 'no session'));
    log(401);
    return;
  }
  if (found === null) {
    sendJson(response, 404, failure(404, 'not an endpoint of the fake Fansly'));
    log(404);
    return;
  }

  const body = method === 'POST' ? await readJson(request) : null;
  const rule = state.takeRule(route, caller);
  let outcome = rule?.outcome ?? null;
  if (outcome?.kind === 'delay') {
    await delay(outcome.ms);
    outcome = null;
  }
  if (outcome !== null && rule?.effect !== true) {
    log(await writeOutcome(state, response, outcome), { outcome: outcome.kind });
    return;
  }

  const answer = found.route.run({ world: state.world, state, hub, params: url.searchParams, match: found.match, body, caller, path: url.pathname.slice(FANSLY_API_PATH.length) });
  if (answer.error !== undefined) {
    const { status, ...error } = answer.error;
    sendJson(response, status, { success: false, error });
    log(status);
    return;
  }
  answer.before?.();
  if (answer.delayMs !== undefined && answer.delayMs > 0) await delay(answer.delayMs);
  if (outcome !== null) {
    // The request took effect; only its answer is replaced.
    log(await writeOutcome(state, response, outcome), { ...answer.journal, outcome: outcome.kind, effect: true });
  } else {
    sendJson(response, 200, { success: true, ...(answer.response !== undefined ? { response: answer.response } : {}) }, answer.headers);
    log(200, answer.journal);
  }
  answer.after?.();
}
