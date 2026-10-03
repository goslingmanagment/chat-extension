// Control endpoints of the stand (`/__stand/...`) for tests: journal, reset,
// scripted sends, fan messages, socket frames and closes, state patches. The
// session-token endpoint lives here too; the page's client calls it natively.

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { CallOrigin, MimicState, SendOutcome, SocketTraffic } from '../../fixture-chatspace/src/protocol';
import { STAND_TOKEN_PATH } from '../../fixture-chatspace/src/protocol';
import type { StandMessage } from './dataset';
import type { ApiContext } from './api';
import { readJson, sendJson } from './api';
import { newMessageFrame } from './wire';

export interface EgressLog {
  attempts(): readonly string[];
}

export interface ControlContext extends ApiContext {
  readonly egress: EgressLog | null;
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
    ok({ sockets: hub.summary(), scripts: state.pendingScripts(), permissions: state.permissions, owner: state.owner, mimic: state.mimic, mimicHeld: state.mimicHeld, withholdAuth: state.withholdAuth, traffic: state.traffic });
    return;
  }
  if (path === '/__stand/egress' && method === 'GET') {
    ok({ attempts: context.egress?.attempts() ?? [] });
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
