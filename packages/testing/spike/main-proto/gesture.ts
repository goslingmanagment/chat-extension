// Human send (architecture §5.9, А7): the last TRUSTED gesture (Enter in the main composer, click on its
// .send-button); an XHR whose native `loadstart` runs while that event is still being delivered
// (eventPhase !== NONE, currentTarget set) and on the same route gets the mark; a marked loadend at exactly
// /api/v1/message is the receipt; the receipt and the 5/1 echo (any order) → fx.sent. One candidate per gesture.

import { digest } from './natives';
import type { World } from './world';

const COMPOSER = 'app-messages-conversation-route > app-group-message-container > app-group-message-input';

export interface Gesture {
  id: number;
  ev: Event;
  kind: 'enter' | 'click';
  route: string;
  marked: number;
  ended: number;
  receipts: Array<{ msgId: string; groupId: string; digest: string }>;
}

export interface GestureLog {
  gesture: number;
  kind: string;
  phaseAtLoadstart: number;
  inSend: unknown;
  verdict: string;
  msgId?: string;
}

export interface GestureApi {
  stamp(xhr: XMLHttpRequest): Gesture | null;
  receipt(g: Gesture | null, body: { id?: unknown; groupId?: unknown; senderId?: unknown; content?: unknown } | null): void;
  ended(g: Gesture | null): void;
  echo(msgId: string, groupId: string, content: string): void;
  log: GestureLog[];
  sent: Array<{ groupId: string; msgId: string; contentDigest: string; order: string }>;
}

export function installGesture(w: World): GestureApi {
  let last: Gesture | null = null;
  let ids = 0;
  const route = (): string => w.win.location.pathname;
  const groupOfRoute = (path: string): string | null => /^\/messages\/(\d+)$/.exec(path)?.[1] ?? null;
  const pendingReceipts = new Map<string, { groupId: string; digest: string; at: number }>();
  const echoes = new Map<string, { groupId: string; digest: string; at: number }>();
  const log: GestureLog[] = [];
  const sent: GestureApi['sent'] = [];

  const remember = (ev: Event, kind: 'enter' | 'click'): void => {
    last = { id: (ids += 1), ev, kind, route: route(), marked: 0, ended: 0, receipts: [] };
    // Only to let go of the event object; the predicate itself never waits for a timer.
    const g = last;
    w.win.setTimeout(
      w.guard('gesture-release', () => {
        if (last === g && g.marked === 0) last = null;
      }),
      1000,
    );
  };

  w.n.listen(
    w.win,
    'keydown',
    w.guard('gesture-key', (ev: KeyboardEvent) => {
      if (!ev.isTrusted || ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
      const t = ev.target;
      if (!(t instanceof w.win.HTMLTextAreaElement) || !t.classList.contains('message-input') || !w.n.closest(t, COMPOSER)) return;
      remember(ev, 'enter');
    }) as EventListener,
    true,
  );
  w.n.listen(
    w.win,
    'click',
    w.guard('gesture-click', (ev: MouseEvent) => {
      if (!ev.isTrusted) return;
      const t = ev.target;
      if (!(t instanceof w.win.Element)) return;
      const button = w.n.closest(t, '.send-button');
      if (!button || !w.n.closest(button, COMPOSER)) return;
      remember(ev, 'click');
    }) as EventListener,
    true,
  );

  const emitSent = (msgId: string, groupId: string, dg: string, order: string): void => {
    sent.push({ groupId, msgId, contentDigest: dg, order });
    w.emit.event('fx.sent', { groupId, msgId, contentDigest: dg }, 96);
  };

  return {
    log,
    sent,
    stamp(xhr) {
      const g = last;
      const inSend = (w.win as unknown as { __spikeInSend?: unknown }).__spikeInSend;
      if (!g) {
        log.push({ gesture: 0, kind: '-', phaseAtLoadstart: -1, inSend, verdict: 'no-gesture' });
        return null;
      }
      const phase = g.ev.eventPhase;
      const live = phase !== 0 && g.ev.currentTarget !== null;
      const sameRoute = route() === g.route;
      log.push({ gesture: g.id, kind: g.kind, phaseAtLoadstart: phase, inSend, verdict: live ? (sameRoute ? 'marked' : 'route-mismatch') : 'gesture-over' });
      void xhr;
      if (!live || !sameRoute) return null;
      g.marked += 1;
      return g;
    },
    receipt(g, body) {
      if (!g || !body) return;
      const msgId = typeof body.id === 'string' ? body.id : null;
      const groupId = typeof body.groupId === 'string' ? body.groupId : null;
      if (!msgId || !groupId || body.senderId !== w.store.creator || groupId !== groupOfRoute(g.route)) {
        log.push({ gesture: g.id, kind: g.kind, phaseAtLoadstart: -1, inSend: null, verdict: 'receipt-rejected' });
        return;
      }
      g.receipts.push({ msgId, groupId, digest: digest(typeof body.content === 'string' ? body.content : '') });
    },
    ended(g) {
      if (!g) return;
      g.ended += 1;
      if (g.ended < g.marked) return;
      if (g.receipts.length !== 1) {
        log.push({ gesture: g.id, kind: g.kind, phaseAtLoadstart: -1, inSend: null, verdict: g.receipts.length ? 'ambiguous' : 'no-receipt' });
        return;
      }
      const r = g.receipts[0] as { msgId: string; groupId: string; digest: string };
      log.push({ gesture: g.id, kind: g.kind, phaseAtLoadstart: -1, inSend: null, verdict: 'receipt', msgId: r.msgId });
      const echo = echoes.get(r.msgId);
      if (echo) {
        echoes.delete(r.msgId);
        emitSent(r.msgId, r.groupId, r.digest, 'echo-first');
      } else {
        pendingReceipts.set(r.msgId, { groupId: r.groupId, digest: r.digest, at: w.n.now() });
      }
    },
    echo(msgId, groupId, content) {
      const r = pendingReceipts.get(msgId);
      if (r) {
        pendingReceipts.delete(msgId);
        emitSent(msgId, r.groupId, r.digest, 'receipt-first');
        return;
      }
      echoes.set(msgId, { groupId, digest: digest(content), at: w.n.now() });
      if (echoes.size > 64) echoes.delete(echoes.keys().next().value as string);
    },
  };
}
