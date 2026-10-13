// The XHR observer (architecture §5.4): construct-only Proxy, native instance, our `loadstart` (epoch, order,
// gesture) and `loadend` (classify by responseURL and response shape; parse ≤ 64 KiB at once, larger copied into a
// bounded queue parsed when idle). No open/send/setRequestHeader of ours, no prototype methods called.

import type { GestureApi, Gesture } from './gesture';
import type { Msg } from './observe';
import { API_PREFIX_RE, type World } from './world';

interface Stamp {
  seq: number;
  epoch: number;
  confirmed: boolean;
  gesture: Gesture | null;
}

type Kind = 'history' | 'older' | 'receipt' | 'byIds' | 'unread' | 'group' | 'groups' | 'me' | 'automated' | 'vault';

const NOW_LIMIT = 64 * 1024;
const QUEUE_BYTES = 1024 * 1024;
const QUEUE_ITEMS = 8;

export interface XhrApi {
  drain(budgetMs: number): boolean;
  queued(): number;
  handle(kind: Kind, path: string, query: string, text: string, stamp: Stamp | null): void;
}

export function classify(url: string): [Kind, string, string] | null {
  const m = API_PREFIX_RE.exec(url);
  if (!m) return null;
  const rest = url.slice(m[0].length);
  const q = rest.indexOf('?');
  const path = q < 0 ? rest : rest.slice(0, q);
  const query = q < 0 ? '' : rest.slice(q + 1);
  const has = (key: string): boolean => query.startsWith(`${key}=`) || query.includes(`&${key}=`);
  switch (path) {
    case 'message':
      if (has('groupId')) return [has('before') ? 'older' : 'history', path, query];
      return ['receipt', path, query];
    case 'messages':
      return has('ids') ? ['byIds', path, query] : null;
    case 'message/unread':
      return ['unread', path, query];
    case 'messaging/groups':
      return ['groups', path, query];
    case 'account/me':
      return ['me', path, query];
    case 'message/automated':
      return ['automated', path, query];
    case 'vault/albums/media':
      return ['vault', path, query];
    default:
      return /^group\/\d+\/?$/.test(path) ? ['group', path, query] : null;
  }
}

const param = (query: string, key: string): string | null => {
  for (const part of query.split('&')) if (part.startsWith(`${key}=`)) return part.slice(key.length + 1);
  return null;
};

export function installXhrTap(w: World, gesture: GestureApi): XhrApi {
  const Native = w.win.XMLHttpRequest;
  const stamps = new WeakMap<XMLHttpRequest, Stamp>();
  const queue: Array<{ kind: Kind; path: string; query: string; text: string; stamp: Stamp | null }> = [];
  let queueBytes = 0;
  let idleAsked = false;

  const onStart = w.guard('xhr-start', (ev: Event) => {
    const xhr = ev.target as XMLHttpRequest;
    w.seq += 1;
    stamps.set(xhr, { seq: w.seq, epoch: w.socket.epoch, confirmed: w.socket.confirmed, gesture: gesture.stamp(xhr) });
  });

  const onEnd = w.guard('xhr-end', (ev: Event) => {
    const t0 = w.n.now();
    const xhr = ev.target as XMLHttpRequest;
    const stamp = stamps.get(xhr) ?? null;
    try {
      const url = xhr.responseURL;
      const c = classify(url);
      w.m.xhrs += 1;
      if (!c) return;
      const [kind, path, query] = c;
      if (xhr.status === 429) return;
      if (xhr.status < 200 || xhr.status >= 300) return;
      const rt = xhr.responseType;
      if (rt !== '' && rt !== 'text') return;
      const text = xhr.responseText;
      if (text.length <= NOW_LIMIT || kind === 'receipt') {
        api.handle(kind, path, query, text, stamp);
      } else if (queue.length < QUEUE_ITEMS && queueBytes + text.length * 2 <= QUEUE_BYTES) {
        queue.push({ kind, path, query, text, stamp });
        queueBytes += text.length * 2;
        askIdle();
      } else {
        w.m.losses += 1;
        w.store.unknownAll('parse-queue');
      }
    } finally {
      if (stamp?.gesture) gesture.ended(stamp.gesture);
      const dt = w.n.now() - t0;
      w.m.xhrMs += dt;
      if (dt > w.m.xhrMax) w.m.xhrMax = dt;
      w.emit.flush();
    }
  });

  const askIdle = (): void => {
    if (idleAsked) return;
    idleAsked = true;
    w.n.idle(
      w.guard('xhr-idle', (deadline: IdleDeadline) => {
        idleAsked = false;
        while (queue.length && (deadline.didTimeout || deadline.timeRemaining() > 2)) {
          one();
        }
        if (queue.length) askIdle();
        w.emit.flush();
      }),
    );
  };

  const one = (): void => {
    const item = queue.shift();
    if (!item) return;
    queueBytes -= item.text.length * 2;
    const t0 = w.n.now();
    api.handle(item.kind, item.path, item.query, item.text, item.stamp);
    const dt = w.n.now() - t0;
    w.m.deferred += 1;
    w.m.deferredMs += dt;
    if (dt > w.m.deferredMax) w.m.deferredMax = dt;
  };

  const api: XhrApi = {
    queued: () => queue.length,
    drain(budgetMs) {
      const until = w.n.now() + budgetMs;
      while (queue.length && w.n.now() < until) one();
      return queue.length === 0;
    },
    handle(kind, path, query, text, stamp) {
      w.m.xhrParsed += 1;
      const body = w.n.parse(text) as { success?: unknown; response?: Record<string, unknown> };
      if (body.success !== true || !body.response || typeof body.response !== 'object') {
        if (kind === 'receipt') gesture.receipt(stamp?.gesture ?? null, null);
        return;
      }
      const r = body.response;
      switch (kind) {
        case 'me': {
          const account = r['account'] as { id?: unknown } | undefined;
          if (typeof account?.id === 'string') {
            w.store.creator = account.id;
            w.accountMeSeen = true;
            w.emit.state('fx.identity', { creatorId: account.id, accountMeSeen: true });
          }
          return;
        }
        case 'receipt':
          gesture.receipt(stamp?.gesture ?? null, r as { id?: unknown });
          return;
        case 'history':
        case 'older':
        case 'byIds': {
          const msgs = (r['messages'] as Msg[] | undefined) ?? [];
          const gid = param(query, 'groupId') ?? msgs[0]?.groupId ?? null;
          if (!gid) return;
          const certificate = kind === 'history' && stamp !== null && stamp.confirmed && stamp.epoch === w.socket.epoch && w.socket.confirmed;
          if (certificate) w.store.certify(gid, msgs, stamp.epoch, stamp.seq);
          else w.store.ingest(gid, msgs, stamp?.epoch ?? 0, stamp?.seq ?? 0, false);
          w.emit.event('fx.coverage', { groupIds: [gid], state: w.store.chats.get(gid)?.complete ? 'complete' : 'unknown', reason: kind }, 96);
          return;
        }
        case 'unread': {
          const list = (r['messageInteractions'] as Array<{ messageId?: string; groupId?: string }> | undefined) ?? [];
          for (const item of list) if (item.groupId && item.messageId) w.store.hint(item.groupId, item.messageId);
          return;
        }
        case 'groups': {
          const data = (r['data'] as Array<{ groupId?: string; lastMessageId?: string }> | undefined) ?? [];
          for (const item of data) if (item.groupId) w.store.hint(item.groupId, item.lastMessageId ?? null);
          const groups = ((r['aggregationData'] as { groups?: unknown[] } | undefined)?.groups ?? []) as Array<Record<string, unknown>>;
          for (const g of groups) group(g);
          return;
        }
        case 'group': {
          const id = /^group\/(\d+)/.exec(path)?.[1];
          // POST /group/<id>/ answers only `users` (the page reads nothing else): demand a whole group.
          if (r['id'] === id && typeof r['type'] === 'number' && Array.isArray(r['users'])) group(r);
          return;
        }
        case 'automated': {
          const items = (Array.isArray(r) ? r : ((r['messages'] as unknown[]) ?? [])) as Array<{ content?: string }>;
          for (const item of items) if (typeof item.content === 'string') w.store.automated.add(item.content.trim().replace(/\s+/g, ' ').toLowerCase());
          return;
        }
        case 'vault':
          w.emit.event('fx.vaultAdded', { at: w.seq }, 48);
          return;
      }
    },
  };

  const group = (g: Record<string, unknown>): void => {
    const gid = g['id'];
    if (typeof gid !== 'string') return;
    const chat = w.store.group(gid);
    const users = (g['users'] as Array<{ userId?: string }> | undefined) ?? [];
    chat.kind = typeof g['type'] === 'number' ? (g['type'] as number) : chat.kind;
    const others = users.filter((u) => u.userId && u.userId !== w.store.creator);
    chat.fanId = users.length === 2 && others.length === 1 ? (others[0]?.userId ?? null) : null;
    const last = (g['lastMessage'] as { id?: string } | null | undefined)?.id ?? null;
    w.store.hint(gid, last);
  };

  w.win.XMLHttpRequest = new Proxy(Native, {
    construct(target, args, newTarget) {
      const xhr = w.n.construct(target, args, newTarget) as XMLHttpRequest;
      try {
        w.n.listen(xhr, 'loadstart', onStart);
        w.n.listen(xhr, 'loadend', onEnd);
      } catch {
        // the page gets its native instance regardless
      }
      return xhr;
    },
  });

  return api;
}
