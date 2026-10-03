// Native API of the stand: the endpoints the fixture page's own client calls,
// with synthetic data. The send endpoint answers from the test script
// (200 with id, Message Guard, any status, hang, drop) and emits the outgoing
// echo on the socket before or after the HTTP response.

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { CallOrigin, SendOutcome } from '../../fixture-chatspace/src/protocol';
import { plainText, type StandChat, type StandMessage } from './dataset';
import type { ServerJournal } from './journal';
import type { SocketHub } from './socket-hub';
import type { StandState } from './state';
import { newMessageFrame, rawAccount, rawChat, rawFan, rawMessage } from './wire';

export interface ApiContext {
  readonly state: StandState;
  readonly journal: ServerJournal;
  readonly hub: SocketHub;
  /** Responses of `hang` sends, ended when the server closes. */
  readonly hanging: Set<ServerResponse>;
}

const DEFAULT_PAGE = 10;
const DEFAULT_ECHO_GAP_MS = 40;

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function errorCode(status: number): string {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status >= 500) return 'INTERNAL_ERROR';
  return 'BAD_REQUEST';
}

function errorBody(status: number, code = errorCode(status), message = 'Stand scripted error'): Record<string, unknown> {
  return { code, message, details: { upstream_message: `stand ${code.toLowerCase()}` } };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Handles one `/api/...` request; returns the status sent (null while a `hang` send is open). */
export async function handleApi(context: ApiContext, request: IncomingMessage, response: ServerResponse, url: URL, origin: CallOrigin, replayOf?: string): Promise<number | null> {
  const { state, journal } = context;
  const method = request.method ?? 'GET';
  const path = url.pathname;
  const replay = replayOf === undefined ? {} : { replayOf };
  const log = (status: number, extra: Record<string, unknown> = {}): number => {
    journal.record({ kind: 'http', origin, method, path: `${path}${url.search}`, status, ...extra, ...(replayOf !== undefined ? { detail: { ...replay } } : {}) });
    return status;
  };

  const auth = request.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  if (!state.isValidToken(token)) {
    sendJson(response, 401, errorBody(401, 'UNAUTHORIZED', 'No stand session'));
    return log(401);
  }

  const parts = path.split('/').filter(Boolean); // ['api', 'v0', ...]
  const route = parts.slice(1).join('/');
  const list = (name: string): string[] => url.searchParams.getAll(name);

  if (method === 'GET' && route === 'v0/accounts') {
    sendJson(response, 200, { items: state.dataset.accounts.filter((account) => !state.hiddenAccounts.has(account.id)).map(rawAccount) });
    return log(200);
  }
  if (method === 'GET' && route === 'user/permissions') {
    sendJson(response, 200, { status: 'ok', data: state.permissions });
    return log(200);
  }
  if (method === 'GET' && route.startsWith('v0/copilot/')) await state.mimicReleased();
  if (method === 'GET' && route === 'v0/copilot/settings') {
    sendJson(response, 200, { is_active: state.mimic.isActive });
    return log(200);
  }
  if (method === 'GET' && route === 'v0/copilot/chats') {
    const wanted = new Set(list('status'));
    const chats = Object.entries(state.mimic.chats)
      .filter(([, status]) => wanted.size === 0 || wanted.has(status))
      .map(([key, status]) => {
        const [accountId = '', fanId = ''] = key.split(':');
        return { account_id: Number(accountId), fan_id: fanId, status, escalation_type: null, escalation_reason: null, activated_at: null, updated_at: null };
      });
    sendJson(response, 200, { chats });
    return log(200);
  }
  if (method === 'GET' && route === 'stats/platforms/onlyfans/buying_power') {
    const items = list('fan_ids').flatMap((fanId) => {
      const fan = [...state.dataset.chats.values()].find((chat) => chat.fan.id === fanId)?.fan;
      return fan ? [{ id: Number(fan.id), buying_power: String(fan.buyingPower) }] : [];
    });
    sendJson(response, 200, { items });
    return log(200);
  }

  const accountMatch = /^v0\/accounts\/([^/]+)\/(.+)$/.exec(route) ?? /^stats\/accounts\/([^/]+)\/(.+)$/.exec(route);
  const accountId = accountMatch?.[1];
  const rest = accountMatch?.[2] ?? '';
  const account = accountId === undefined ? undefined : state.account(accountId);
  if (accountId === undefined || account === undefined) {
    sendJson(response, 404, errorBody(404));
    return log(404);
  }

  if (method === 'GET' && rest === 'chats' && route.startsWith('v0/')) {
    const limit = Number(url.searchParams.get('limit') ?? DEFAULT_PAGE);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const filter = url.searchParams.get('filter');
    const listId = url.searchParams.get('list_id');
    const query = (url.searchParams.get('query') ?? '').toLowerCase();
    const oldFirst = url.searchParams.get('order') === 'old';
    const byFilter: Record<string, (chat: StandChat) => boolean> = {
      unread: (chat) => chat.unread > 0,
      pinned: (chat) => chat.fan.pinnedChat,
      who_tipped: (chat) => chat.fan.tipped,
      priority: (chat) => chat.fan.priority,
    };
    const lastAt = (chat: StandChat): string => chat.messages.at(-1)?.sentAt ?? '';
    const chats = state
      .chatsOf(accountId)
      .filter((chat) => filter === null || (byFilter[filter]?.(chat) ?? false))
      .filter((chat) => listId === null || chat.fan.lists.includes(listId))
      .filter((chat) => query === '' || chat.fan.name.toLowerCase().includes(query) || chat.fan.username.toLowerCase().includes(query))
      .sort((x, y) => (oldFirst ? lastAt(x).localeCompare(lastAt(y)) : lastAt(y).localeCompare(lastAt(x))));
    const page = chats.slice(offset, offset + limit);
    sendJson(response, 200, { items: page.map((chat) => rawChat(chat, account)), has_more: offset + limit < chats.length, next_offset: offset + page.length });
    return log(200);
  }

  const fanRoute = /^chats\/([^/]+)\/(messages|typing)$/.exec(rest);
  if (fanRoute) {
    const fanId = fanRoute[1] ?? '';
    const chat = state.chat(accountId, fanId);
    if (!chat) {
      sendJson(response, 404, errorBody(404));
      return log(404);
    }
    if (fanRoute[2] === 'typing' && method === 'POST') {
      response.writeHead(204).end();
      return log(204, { accountId, chatId: fanId });
    }
    if (method === 'GET') {
      // Loading a chat's history marks it read on the platform (live-verified on
      // ChatSpace, docs/research/onlymonster-chatspace/facts.md): the journal
      // keeps every such load so tests can prove none happened unasked.
      // Pages run newest first; `cursor` = the oldest id already loaded, `first_id` = an anchor
      // (that message and older), `filter=pinned` = pinned messages only.
      const limit = Number(url.searchParams.get('limit') ?? DEFAULT_PAGE);
      const cursor = url.searchParams.get('cursor');
      const anchor = url.searchParams.get('first_id');
      const filter = url.searchParams.get('filter');
      const source = filter === 'pinned' ? chat.messages.filter((message) => message.isPinned === true) : chat.messages;
      const indexOf = (id: string | null): number => (id === null ? -1 : source.findIndex((message) => message.id === id));
      const upTo = cursor !== null && indexOf(cursor) !== -1 ? indexOf(cursor) : anchor !== null && indexOf(anchor) !== -1 ? indexOf(anchor) + 1 : source.length;
      const start = Math.max(0, upTo - limit);
      const items = source.slice(start, upTo).reverse();
      const unreadBefore = chat.unread;
      chat.unread = 0;
      sendJson(response, 200, { items: items.map(rawMessage), platform_fan_id: fanId, has_more: start > 0 });
      journal.record({
        kind: 'history-load',
        origin,
        method,
        path: `${path}${url.search}`,
        status: 200,
        accountId,
        chatId: fanId,
        detail: { unreadBefore, ...(filter !== null ? { filter } : {}), ...(anchor !== null ? { anchor } : {}), ...replay },
      });
      return log(200, { accountId, chatId: fanId });
    }
    if (method === 'POST') return handleSend(context, request, response, { accountId, fanId, origin, path });
  }

  const blockRoute = /^platforms\/onlyfans\/users\/([^/]+)\/block$/.exec(rest);
  if (blockRoute && (method === 'POST' || method === 'DELETE')) {
    const fanId = blockRoute[1] ?? '';
    if (!state.patchFan(accountId, fanId, { isBlocked: method === 'POST' })) {
      sendJson(response, 404, errorBody(404));
      return log(404);
    }
    sendJson(response, 200, { success: true });
    return log(200, { accountId, chatId: fanId });
  }

  if (method === 'GET' && rest === 'platforms/onlyfans/fans') {
    const items = list('fan_ids').flatMap((fanId) => {
      const chat = state.chat(accountId, fanId);
      return chat ? [rawFan(chat.fan)] : [];
    });
    sendJson(response, 200, { items });
    return log(200, { accountId });
  }

  if (method === 'GET' && rest === 'fans/transactions/latest') {
    const result: Record<string, string> = {};
    for (const fanId of list('fanIds')) {
      const paid = state.chat(accountId, fanId)?.fan.lastPaymentAt;
      if (paid) result[fanId] = paid;
    }
    sendJson(response, 200, result);
    return log(200, { accountId });
  }

  const insightsRoute = /^fans\/([^/]+)\/insights$/.exec(rest);
  if (method === 'GET' && insightsRoute) {
    const fanId = insightsRoute[1] ?? '';
    const chat = state.chat(accountId, fanId);
    const seed = Number(fanId.slice(-2)) || 1;
    sendJson(response, chat ? 200 : 404, chat ? { temperature: 1 + (seed % 4), reach: 1 + (seed % 6), focus: 1 + ((seed + 1) % 4), generated_at: '2026-09-01T00:00:00Z' } : errorBody(404));
    return log(chat ? 200 : 404, { accountId, chatId: fanId });
  }

  sendJson(response, 404, errorBody(404));
  return log(404);
}

interface SendTarget {
  readonly accountId: string;
  readonly fanId: string;
  readonly origin: CallOrigin;
  readonly path: string;
}

async function handleSend(context: ApiContext, request: IncomingMessage, response: ServerResponse, target: SendTarget): Promise<number | null> {
  const { state, journal, hub } = context;
  const { accountId, fanId, origin, path } = target;
  const raw = await readJson(request);
  const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const text = typeof body['text'] === 'string' ? body['text'] : '';
  const outcome: SendOutcome = state.takeOutcome(accountId, fanId);
  const account = state.account(accountId);
  journal.record({
    kind: 'send',
    origin,
    method: 'POST',
    path,
    accountId,
    chatId: fanId,
    detail: {
      outcome: outcome.kind,
      text,
      plain: plainText(text),
      isCopied: body['is_copied'] ?? null,
      isAiGenerated: body['is_ai_generated'] ?? null,
      internalTemplateId: body['internal_template_id'] ?? null,
      replyTime: body['reply_time'] ?? null,
      previousMessage: body['previous_message'] ?? null,
      platformMetadata: body['platformMetadata'] ?? null,
    },
  });
  const done = (status: number, extra: Record<string, unknown> = {}): number => {
    journal.record({ kind: 'http', origin, method: 'POST', path, status, accountId, chatId: fanId, detail: { outcome: outcome.kind, ...extra } });
    return status;
  };

  switch (outcome.kind) {
    case 'ok': {
      // What the platform stored (and echoes) may differ from what was sent and from the receipt.
      const id = outcome.id ?? state.nextMessageId();
      const message: StandMessage = { id: outcome.echoId ?? id, content: outcome.echoContent ?? text, sentAt: new Date().toISOString(), isFromFan: false };
      const responseId = outcome.responseId ?? id;
      state.appendMessage(accountId, fanId, message);
      const echo = (): void => {
        if (account) hub.deliverNewMessage(newMessageFrame(account, fanId, message), accountId);
      };
      const gap = outcome.gapMs ?? DEFAULT_ECHO_GAP_MS;
      const mode = outcome.echo ?? 'after';
      if (mode === 'before') {
        echo();
        await delay(gap);
      }
      sendJson(response, 200, { id: responseId, content: message.content, sent_at: message.sentAt, is_from_fan: false });
      if (mode === 'after') setTimeout(echo, gap);
      return done(200, { id: responseId, echoId: message.id, echo: mode });
    }
    case 'guard':
      sendJson(response, 422, {
        ...errorBody(422, 'MESSAGE_GUARD_VIOLATION', 'Message Guard blocked this message'),
        word_matches: outcome.words ?? ['stand-word'],
        topic_matches: outcome.topics ?? [],
      });
      return done(422);
    case 'status':
      sendJson(response, outcome.status, errorBody(outcome.status, outcome.code, outcome.message));
      return done(outcome.status);
    case 'hang':
      context.hanging.add(response);
      response.on('close', () => {
        context.hanging.delete(response);
        if (!response.writableEnded) journal.record({ kind: 'send-aborted', origin, method: 'POST', path, accountId, chatId: fanId });
      });
      return null;
    case 'drop':
      request.socket.destroy();
      return done(0, { dropped: true });
  }
}
