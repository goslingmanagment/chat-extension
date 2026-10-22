// Control endpoints of the stand (`/__stand/...`) for tests: journal, reset,
// scripted sends, fan messages, socket frames and closes, state patches. The
// session-token endpoint lives here too; the page's client calls it natively.

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { CallOrigin, MimicState, SendOutcome, SocketTraffic } from '../../fixture-chatspace/src/protocol';
import { STAND_TOKEN_PATH } from '../../fixture-chatspace/src/protocol';
import type { StandMessage } from './dataset';
import type { EgressPage } from './egress-sink';
import type { SentryInbox } from './sentry-inbox';
import type { ApiContext } from './api';
import { readJson, sendJson } from './api';
import { newMessageFrame } from './wire';

export interface EgressLog {
  read(since?: number): EgressPage;
}

export interface ControlContext extends ApiContext {
  readonly egress: EgressLog | null;
  /** The page's Sentry envelopes (?stand-sentry=1); absent in a context without the collector. */
  readonly sentry?: SentryInbox;
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const asString = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const isMs = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The valid fields of a traffic patch (anything else is ignored). */
function trafficPatch(body: Record<string, unknown>): Partial<SocketTraffic> {
  const typing = Array.isArray(body['typing'])
    ? body['typing'].flatMap((item) => {
        const pair = asRecord(item);
        const accountId = asString(pair['accountId']);
        const fanId = asString(pair['fanId']);
        return accountId !== null && fanId !== null ? [{ accountId, fanId }] : [];
      })
    : undefined;
  return {
    ...(typeof body['enabled'] === 'boolean' ? { enabled: body['enabled'] } : {}),
    ...(isMs(body['firstSummaryMs']) ? { firstSummaryMs: body['firstSummaryMs'] } : {}),
    ...(isMs(body['summaryEveryMs']) && body['summaryEveryMs'] > 0 ? { summaryEveryMs: body['summaryEveryMs'] } : {}),
    ...(isMs(body['messagesSummaryEveryMs']) ? { messagesSummaryEveryMs: body['messagesSummaryEveryMs'] } : {}),
    ...(isMs(body['typingEveryMs']) && body['typingEveryMs'] > 0 ? { typingEveryMs: body['typingEveryMs'] } : {}),
    ...(typing !== undefined ? { typing } : {}),
    ...('strayAccountId' in body ? { strayAccountId: asString(body['strayAccountId']) } : {}),
  };
}

export async function handleControl(context: ControlContext, request: IncomingMessage, response: ServerResponse, url: URL, origin: CallOrigin): Promise<void> {
  const { state, journal, hub } = context;
  const method = request.method ?? 'GET';
  const path = url.pathname;
  const ok = (body: unknown = { ok: true }, status = 200): void => {
    sendJson(response, status, body);
    if (path !== '/__stand/journal') journal.record({ kind: path === STAND_TOKEN_PATH ? 'http' : 'control', origin, method, path, status });
  };

  if (path === STAND_TOKEN_PATH && method === 'POST') {
    ok({ token: state.issueToken(), userId: state.dataset.userId, owner: state.owner });
    return;
  }
  if (path === '/__stand/journal' && method === 'GET') {
    ok(journal.read(Number(url.searchParams.get('since') ?? 0)));
    return;
  }
  if (path === '/__stand/journal/reset' && method === 'POST') {
    ok({ next: journal.clear() });
    return;
  }
  if (path === '/__stand/reset' && method === 'POST') {
    state.reset();
    hub.restartTraffic();
    ok();
    return;
  }
  if (path === '/__stand/state' && method === 'GET') {
    ok({ sockets: hub.summary(), scripts: state.pendingScripts(), permissions: state.permissions, owner: state.owner, mimic: state.mimic, mimicHeld: state.mimicHeld, fansHeld: state.fansHeld, withholdAuth: state.withholdAuth, traffic: state.traffic });
    return;
  }
  if (path === '/__stand/sentry' && method === 'GET') {
    ok(context.sentry?.read(Number(url.searchParams.get('since') ?? 0)) ?? { envelopes: [], next: 0 });
    return;
  }
  if (path === '/__stand/sentry/reset' && method === 'POST') {
    ok({ next: context.sentry?.clear() ?? 0 });
    return;
  }
  if (path === '/__stand/egress' && method === 'GET') {
    const page: EgressPage = context.egress?.read(Number(url.searchParams.get('since') ?? 0)) ?? { attempts: [], next: 0, dropped: 0 };
    ok(page);
    return;
  }

  const body = asRecord(await readJson(request));

  if (path === '/__stand/script/send' && method === 'POST') {
    const accountId = asString(body['accountId']) ?? '*';
    const chatId = asString(body['chatId']) ?? '*';
    const outcomes = Array.isArray(body['outcomes']) ? (body['outcomes'] as SendOutcome[]) : [];
    state.script(accountId, chatId, outcomes);
    ok({ queued: outcomes.length });
    return;
  }
  if (path === '/__stand/fan-message' && method === 'POST') {
    const accountId = asString(body['accountId']);
    const fanId = asString(body['fanId']);
    const account = accountId === null ? undefined : state.account(accountId);
    if (accountId === null || fanId === null || account === undefined || state.chat(accountId, fanId) === undefined) {
      ok({ error: 'unknown chat' }, 404);
      return;
    }
    const text = asString(body['text']) ?? 'Синтетическое новое сообщение';
    const message: StandMessage = { id: asString(body['id']) ?? state.nextMessageId(), content: `<p>${text}</p>`, sentAt: new Date().toISOString(), isFromFan: true };
    state.appendMessage(accountId, fanId, message);
    const delivered = hub.deliverNewMessage(newMessageFrame(account, fanId, message), accountId);
    ok({ id: message.id, delivered });
    return;
  }
  // The model's message in a chat, as a send from elsewhere would leave it (unread by the fan); delivered on the socket.
  if (path === '/__stand/model-message' && method === 'POST') {
    const accountId = asString(body['accountId']);
    const fanId = asString(body['fanId']);
    const account = accountId === null ? undefined : state.account(accountId);
    if (accountId === null || fanId === null || account === undefined || state.chat(accountId, fanId) === undefined) {
      ok({ error: 'unknown chat' }, 404);
      return;
    }
    const text = asString(body['text']) ?? 'Синтетический ответ модели';
    const message: StandMessage = { id: asString(body['id']) ?? state.nextMessageId(), content: `<p>${text}</p>`, sentAt: new Date().toISOString(), isFromFan: false };
    state.appendMessage(accountId, fanId, message);
    const delivered = hub.deliverNewMessage(newMessageFrame(account, fanId, message), accountId);
    ok({ id: message.id, delivered });
    return;
  }
  // The fan opens the chat: every model's message in it reads as seen (`isNew: false`). The socket says nothing of it.
  if (path === '/__stand/fan-read' && method === 'POST') {
    const accountId = asString(body['accountId']);
    const fanId = asString(body['fanId']);
    const chat = accountId === null || fanId === null ? undefined : state.chat(accountId, fanId);
    if (chat === undefined) {
      ok({ error: 'unknown chat' }, 404);
      return;
    }
    for (const message of chat.messages) if (!message.isFromFan) message.isNew = false;
    ok({ read: true });
    return;
  }
  // A history load past OnlyMonster's cache (`force=true`) answers this much later; 0 — at once.
  if (path === '/__stand/forced-history-delay' && method === 'POST') {
    const ms = typeof body['ms'] === 'number' && body['ms'] >= 0 && body['ms'] <= 60_000 ? body['ms'] : null;
    if (ms === null) {
      ok({ error: 'ms 0…60000' }, 400);
      return;
    }
    state.forcedHistoryDelayMs = ms;
    ok({ ms });
    return;
  }
  // The chat's next history load meets a fan message that came the same moment (the read mark's race).
  if (path === '/__stand/race-history' && method === 'POST') {
    const accountId = asString(body['accountId']);
    const fanId = asString(body['fanId']);
    if (accountId === null || fanId === null || state.chat(accountId, fanId) === undefined) {
      ok({ error: 'unknown chat' }, 404);
      return;
    }
    state.racingHistory.add(`${accountId}:${fanId}`);
    ok({ armed: true });
    return;
  }
  // X54: a model's paid message (PPV) in a chat, as the model's send would leave it; delivered on the socket like one.
  if (path === '/__stand/paid-message' && method === 'POST') {
    const accountId = asString(body['accountId']);
    const fanId = asString(body['fanId']);
    const account = accountId === null ? undefined : state.account(accountId);
    const price = typeof body['price'] === 'number' && body['price'] > 0 ? body['price'] : null;
    if (accountId === null || fanId === null || account === undefined || state.chat(accountId, fanId) === undefined || price === null) {
      ok({ error: 'unknown chat or no price' }, 404);
      return;
    }
    const text = asString(body['text']) ?? 'Синтетическое платное сообщение';
    const message: StandMessage = { id: asString(body['id']) ?? state.nextMessageId(), content: `<p>${text}</p>`, sentAt: new Date().toISOString(), isFromFan: false, price, isOpened: body['isOpened'] === true };
    state.appendMessage(accountId, fanId, message);
    const delivered = hub.deliverNewMessage(newMessageFrame(account, fanId, message), accountId);
    ok({ id: message.id, delivered });
    return;
  }
  // X54: the fan buys a paid message. OnlyFans changes the message; ChatSpace's socket says nothing of it (client-internals.md):
  // the page's loaded copy keeps `isOpened: false` until it loads the history again.
  if (path === '/__stand/purchase' && method === 'POST') {
    const accountId = asString(body['accountId']);
    const fanId = asString(body['fanId']);
    const messageId = asString(body['messageId']);
    const message = accountId === null || fanId === null ? undefined : state.chat(accountId, fanId)?.messages.find((item) => item.id === messageId);
    if (message === undefined || (message.price ?? 0) <= 0) {
      ok({ error: 'unknown paid message' }, 404);
      return;
    }
    message.isOpened = true;
    ok({ id: message.id });
    return;
  }
  if (path === '/__stand/ws/frame' && method === 'POST') {
    const frame = asRecord(body['frame']);
    ok({ delivered: hub.broadcast(frame, asString(body['accountId'])) });
    return;
  }
  if (path === '/__stand/ws/close' && method === 'POST') {
    const code = typeof body['code'] === 'number' ? body['code'] : 4000;
    ok({ closed: hub.closeAll(code) });
    return;
  }
  if (path === '/__stand/accounts/hide' && method === 'POST') {
    // The accounts list changes, and the server tells every page (accounts_list_updated → refetch).
    const accountId = asString(body['accountId']);
    if (accountId !== null) {
      if (body['hidden'] === false) state.hiddenAccounts.delete(accountId);
      else state.hiddenAccounts.add(accountId);
    }
    ok({ hidden: [...state.hiddenAccounts], delivered: hub.broadcast({ event: 'accounts_list_updated' }, null) });
    return;
  }
  if (path === '/__stand/presence' && method === 'POST') {
    // Who the presence endpoint answers as online for one account; pages learn it at their poll's next look.
    const accountId = asString(body['accountId']);
    if (accountId === null || state.account(accountId) === undefined) {
      ok({ error: 'unknown account' }, 404);
      return;
    }
    const online = Array.isArray(body['online']) ? body['online'].filter((item): item is string => typeof item === 'string' && item !== '') : [];
    state.setOnline(accountId, online);
    ok({ accountId, online });
    return;
  }
  if (path === '/__stand/ws/traffic' && method === 'POST') {
    state.traffic = { ...state.traffic, ...trafficPatch(body) };
    hub.restartTraffic();
    ok({ traffic: state.traffic });
    return;
  }
  if (path === '/__stand/ws/auth' && method === 'POST') {
    state.withholdAuth = body['withhold'] === true;
    ok({ withholdAuth: state.withholdAuth });
    return;
  }
  if (path === '/__stand/state' && method === 'POST') {
    if (Array.isArray(body['permissions'])) state.permissions = body['permissions'].filter((item): item is string => typeof item === 'string');
    if (typeof body['owner'] === 'boolean') state.owner = body['owner'];
    if (typeof body['holdMimic'] === 'boolean') state.holdMimic(body['holdMimic']);
    if (typeof body['holdFans'] === 'boolean') state.holdFans(body['holdFans']);
    if (typeof body['failReleaseForms'] === 'boolean') state.failReleaseForms = body['failReleaseForms'];
    if (typeof body['mimic'] === 'object' && body['mimic'] !== null) state.mimic = body['mimic'] as MimicState;
    if (Array.isArray(body['fans'])) {
      for (const item of body['fans'] as unknown[]) {
        const fan = asRecord(item);
        const accountId = asString(fan['accountId']);
        const fanId = asString(fan['fanId']);
        if (accountId !== null && fanId !== null) state.patchFan(accountId, fanId, asRecord(fan['patch']));
      }
    }
    ok();
    return;
  }
  ok({ error: `unknown control ${method} ${path}` }, 404);
}
