// The Fansly MAIN runtime of the prototype: built by the host-kit boot at document_start (installMainBridge's
// `runtime` option), installs both taps at once, answers ToMainFansly requests (§6), sends fx.batch.

import type { MainContext, MainRuntime } from '../../../host-kit/src/main/bridge';
import { createEmitter } from './emitter';
import { installExtras, isFeature, isGroupId } from './extras';
import { handleFrame } from './frames';
import { installSocketTap } from './frames';
import { installGesture } from './gesture';
import { captureNatives, cmpId } from './natives';
import { COST, createStore, LIMITS, type Chat } from './observe';
import type { World } from './world';
import { classify, installXhrTap } from './xhr';

declare const __SPIKE__: boolean;

const LEGACY = Symbol.for('chatgoose.socketTap');
const SNAPSHOT_BYTES = 128 * 1024;

export function createFanslyRuntime(ctx: MainContext): MainRuntime {
  const win = ctx.win as Window & typeof globalThis;
  const legacy = Object.prototype.hasOwnProperty.call(win, LEGACY);
  let connected = false;
  const emit = createEmitter((t, p) => ctx.post(t, p as never), () => connected);
  const n = captureNatives(win);
  const store = createStore((gids, reason) => emit.event('fx.coverage', { groupIds: gids, state: 'unknown', reason }, 64));
  const w: World = {
    win,
    n,
    store,
    emit,
    guard: ctx.guard,
    socket: { epoch: 0, confirmed: false, seen: false },
    seq: 0,
    routeEpoch: 0,
    accountMeSeen: false,
    m: { frames: 0, frameMs: 0, frameMax: 0, xhrs: 0, xhrParsed: 0, xhrMs: 0, xhrMax: 0, deferred: 0, deferredMs: 0, deferredMax: 0, losses: 0 },
    onEcho: () => undefined,
    onService: () => undefined,
  };
  if (legacy) return { handle: () => 'disabled', dispose: () => undefined };

  const gesture = installGesture(w);
  w.onEcho = (id, gid, content) => gesture.echo(id, gid, content);
  installSocketTap(w);
  const xhr = installXhrTap(w, gesture);
  let stopped = false;
  const extras = installExtras(w, { xhr: win.XMLHttpRequest, ws: win.WebSocket }, () => {
    stopped = true;
  });
  w.onService = (sid, type, e) => extras.participants(sid, type, e);

  const chatView = (chat: Chat): Record<string, unknown> => ({
    groupId: chat.gid,
    fanId: chat.fanId,
    kind: chat.kind,
    dmAllowed: chat.dmAllowed,
    routeEpoch: w.routeEpoch,
    window: { loaded: chat.recs.length, newestId: chat.recs.at(-1)?.id ?? null, newestAt: chat.recs.at(-1)?.at ?? null, completeness: chat.complete ? 'complete' : 'unknown', startProven: chat.startProven, fanScript: extras.fanScript(chat) },
  });

  const snapshot = (p: { groupId: string; feature: string; window: number; withText: boolean }): Record<string, unknown> => {
    const drained = xhr.drain(3);
    const chat = store.chats.get(p.groupId);
    if (!chat) return { completeness: 'unknown', gap: 'no-chat', window: [], truncated: false };
    const size = Math.min(60, p.window);
    const recs = chat.recs.slice(-size);
    const live = recs.filter((r) => !r.deleted);
    const out: Record<string, unknown> = {
      identity: { creatorId: store.creator, groupId: chat.gid, fanId: chat.fanId },
      epochs: { document: ctx.documentEpoch, socket: w.socket.epoch, route: w.routeEpoch },
      completeness: drained && chat.complete ? 'complete' : 'unknown',
      window: live.map((r) => ({ id: r.id, dir: r.fromFan ? 'fan' : 'model' })),
      knownFanMessageIds: live.filter((r) => r.fromFan).slice(-10).map((r) => r.id),
      deletedIds: recs.filter((r) => r.deleted).map((r) => r.id),
      truncated: false,
    };
    if (!drained) out['gap'] = 'pending-parse';
    if (p.feature === 'hi' && chat.startProven) {
      const sorted = [...chat.recs].sort((a, b) => cmpId(a.id, b.id));
      out['startProof'] = { v: 1, source: 'tab-short-page', groupId: chat.gid, startWitnessId: sorted[0]?.id ?? null, coveredCount: chat.covered, personalCount: chat.personal, automatedIds: sorted.filter((r) => !r.fromFan && r.type === 2).slice(-120).map((r) => r.id) };
    }
    if (p.withText && chat.texts) {
      const tail: Array<{ id: string; dir: string; text: string }> = [];
      let bytes = 0;
      for (let i = live.length - 1; i >= 0; i -= 1) {
        const r = live[i];
        const text = r ? chat.texts.get(r.id) : undefined;
        if (!r || text === undefined || text === '') continue;
        bytes += text.length * 3 + 64;
        if (bytes > SNAPSHOT_BYTES) {
          out['truncated'] = true;
          break;
        }
        tail.unshift({ id: r.id, dir: r.fromFan ? 'fan' : 'model', text });
      }
      out['tail'] = tail;
    }
    return out;
  };

  const runtime: MainRuntime = {
    handle(t, payload) {
      const p = (payload ?? {}) as Record<string, unknown>;
      if (stopped) return 'disabled';
      connected = true;
      switch (t) {
        case 'fx.ack':
          emit.ack(Number(p['n']));
          return null;
        case 'fx.state':
          emit.resync();
          return { creatorId: store.creator, socket: w.socket, accountMeSeen: w.accountMeSeen, legacy, documentEpoch: ctx.documentEpoch, contract: extras.contract(), fbuddy: extras.fbuddy() };
        case 'fx.focus': {
          if (p['groupId'] !== null && !isGroupId(p['groupId'])) return 'bad-request';
          const gid = typeof p['groupId'] === 'string' ? p['groupId'] : null;
          w.routeEpoch += 1;
          const chat = gid ? store.chats.get(gid) : undefined;
          if (chat) emit.state('fx.chat', chatView(chat));
          emit.flush();
          return null;
        }
        case 'fx.windowMeta': {
          const chat = store.chats.get(String(p['groupId']));
          return chat ? chatView(chat) : null;
        }
        case 'fx.generationSnapshot': {
          if (!isGroupId(p['groupId']) || !isFeature(p['feature']) || typeof p['window'] !== 'number' || typeof p['withText'] !== 'boolean') return 'bad-request';
          const t0 = n.now();
          const out = snapshot(p as never);
          out['ms'] = n.now() - t0;
          return out;
        }
        default:
          return 'unknown-request';
      }
    },
    dispose: () => undefined,
  };

  if (__SPIKE__) {
    Object.defineProperty(win, '__cgSpike', {
      value: { w, store, gesture, emit, xhr, limits: LIMITS, cost: COST, classify, handleFrame: (d: string) => handleFrame(w, d), handle: runtime.handle },
      configurable: true,
    });
  }
  return runtime;
}
