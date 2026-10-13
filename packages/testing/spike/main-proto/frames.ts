// The socket tap and frame parsing (architecture §5.2–§5.3): a construct-only Proxy over WebSocket; our listeners
// on the instance; three parses for t:10000; t:10001 recursion; limits → `unknown`, never a silent cut.

import type { Msg } from './observe';
import { WS_HOST_RE, type World } from './world';

const MAX_FRAME = 1024 * 1024;
const MAX_DEPTH = 4;
const MAX_NODES = 256;

export function installSocketTap(w: World): void {
  const Native = w.win.WebSocket;
  const onOpen = w.guard('ws-open', () => undefined);
  const onClose = w.guard('ws-close', () => {
    w.socket.confirmed = false;
  });
  const onMessage = w.guard('ws-message', (event: MessageEvent) => {
    if (event.target !== current) return;
    const t0 = w.n.now();
    handleFrame(w, event.data);
    const dt = w.n.now() - t0;
    w.m.frames += 1;
    w.m.frameMs += dt;
    if (dt > w.m.frameMax) w.m.frameMax = dt;
    w.emit.flush();
  });
  let current: WebSocket | null = null;
  w.win.WebSocket = new Proxy(Native, {
    construct(target, args, newTarget) {
      const ws = w.n.construct(target, args, newTarget) as WebSocket;
      try {
        const host = /^wss?:\/\/([^/?#:]+)/.exec(String(args[0]))?.[1] ?? '';
        if (WS_HOST_RE.test(host)) {
          current = ws;
          w.socket = { epoch: w.socket.epoch + 1, confirmed: false, seen: true };
          w.store.unknownAll('socket-epoch');
          w.n.listen(ws, 'open', onOpen);
          w.n.listen(ws, 'message', onMessage as EventListener);
          w.n.listen(ws, 'close', onClose);
          w.n.listen(ws, 'error', onClose);
        }
      } catch {
        // counted by the guard of the next callback; the page gets its socket regardless
      }
      return ws;
    },
  });
}

export function handleFrame(w: World, data: unknown): void {
  if (typeof data !== 'string' || data === 'p') return;
  if (data.length > MAX_FRAME) return loss(w);
  let frame: unknown;
  try {
    frame = w.n.parse(data);
  } catch {
    return loss(w);
  }
  const nodes = { n: 0 };
  node(w, frame, 0, nodes);
}

function node(w: World, frame: unknown, depth: number, nodes: { n: number }): void {
  if ((nodes.n += 1) > MAX_NODES || depth > MAX_DEPTH || !frame || typeof frame !== 'object') return loss(w);
  const { t, d } = frame as { t?: unknown; d?: unknown };
  if (t === 1) {
    w.socket.confirmed = true;
    return;
  }
  if (t === 0 || t === 2) return;
  if (t === 10001) {
    if (!Array.isArray(d)) return loss(w);
    for (const item of d) {
      if (typeof item !== 'string') return loss(w);
      let inner: unknown;
      try {
        inner = w.n.parse(item);
      } catch {
        return loss(w);
      }
      node(w, inner, depth + 1, nodes);
    }
    return;
  }
  if (t !== 10000 || typeof d !== 'string') return;
  let svc: { serviceId?: unknown; event?: unknown };
  try {
    svc = w.n.parse(d) as typeof svc;
  } catch {
    return loss(w);
  }
  const ev = svc.event;
  if (typeof ev !== 'string') return;
  const sid = svc.serviceId;
  // Typing (5/22, 46 % of frames) and receipts (4/2) never reach the bridge: skip their third parse.
  if (sid === 5 && ev.startsWith('{"typingAnnounceEvent"')) return;
  if (sid === 4 && ev.startsWith('{"ackCommand"')) return;
  if (sid !== 5 && sid !== 3 && sid !== 4) return;
  let e: Record<string, unknown>;
  try {
    e = w.n.parse(ev) as Record<string, unknown>;
  } catch {
    return loss(w);
  }
  const type = e['type'];
  if (sid === 5 && type === 1) return onMessage(w, e['message'] as Msg);
  if (sid === 5 && type === 10) return onDelete(w, e['message'] as Msg);
  if (sid === 4 && typeof type === 'number') return w.onService(4, type, e);
  if (sid === 3 && type === 2) {
    const f = e['follow'] as { id: string; accountId: string; followerId: string } | undefined;
    if (f) w.emit.event('fx.follow', { eventId: f.id, accountId: f.accountId, followerId: f.followerId }, 96);
  }
}

function onMessage(w: World, m: Msg | undefined): void {
  if (!m || typeof m.id !== 'string' || typeof m.groupId !== 'string') return loss(w);
  w.seq += 1;
  w.store.ingest(m.groupId, [m], w.socket.epoch, w.seq, true);
  const chat = w.store.chats.get(m.groupId);
  const fromFan = m.senderId !== w.store.creator;
  const tip = Array.isArray(m.attachments) && m.attachments.some((a) => (a as { contentType?: unknown }).contentType === 7);
  w.emit.event('fx.incoming', { groupId: m.groupId, fanId: fromFan ? m.senderId : (chat?.fanId ?? null), msgId: m.id, fromFan, automated: m.type === 2, tip, createdAt: m.createdAt }, 160);
  if (!fromFan) w.onEcho(m.id, m.groupId, m.content ?? '');
}

function onDelete(w: World, m: Msg | undefined): void {
  if (!m || typeof m.id !== 'string') return loss(w);
  w.seq += 1;
  const hit = w.store.deleteMsg(m.id, m.type === 3, w.seq);
  for (const gid of new Set(hit)) w.emit.event('fx.deleted', { groupId: gid, ids: [m.id] }, 96);
}

function loss(w: World): void {
  w.m.losses += 1;
  w.store.unknownAll('frame');
}
