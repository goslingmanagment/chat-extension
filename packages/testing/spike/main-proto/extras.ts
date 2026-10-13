// The rest of what a full MAIN carries, kept in the prototype so its size is honest: the network contract
// (fx.contract) with the «someone wrapped our Proxy» signal, the old extension's marker re-checked at
// DOMContentLoaded, FBuddy booleans, group participants (4/6–4/8), bfcache → unknown, the fan's script for the
// language filter (metadata only), request payload checks.

import type { Chat } from './observe';
import type { World } from './world';

const LEGACY = Symbol.for('chatgoose.socketTap');

export interface Extras {
  contract(): Record<string, unknown>;
  fbuddy(): Record<string, boolean>;
  legacyNow(): boolean;
  participants(sid: number, type: number, e: Record<string, unknown>): void;
  fanScript(chat: Chat): string | null;
}

export function installExtras(w: World, ours: { xhr: unknown; ws: unknown }, stop: () => void): Extras {
  const doc = w.win.document;
  const fbuddy = (): Record<string, boolean> => {
    const words = doc.getElementById('fbuddy-restricted-words-data');
    return {
      bridge: !!doc.getElementById('fbuddy-window-bridge-script'),
      hook: (w.win as unknown as Record<string, unknown>)['__FBUDDY_NETWORK_HOOK__'] === true,
      style: !!doc.getElementById('fb-fansly-style-fixes'),
      guard: !!words && (words.textContent ?? '').trim().length > 2,
    };
  };
  const legacyNow = (): boolean => Object.prototype.hasOwnProperty.call(w.win, LEGACY);
  const contract = (): Record<string, unknown> => ({
    accountMe: w.accountMeSeen ? 'ok' : 'missing',
    socket: w.socket.seen ? (w.socket.confirmed ? 'ok' : 'unconfirmed') : 'missing',
    frames: w.m.frames > 0 ? 'ok' : 'missing',
    xhr: w.m.xhrs > 0 ? 'ok' : 'missing',
    tapWrapped: w.win.XMLHttpRequest !== ours.xhr || w.win.WebSocket !== ours.ws,
    losses: w.m.losses,
  });
  w.n.listen(
    doc,
    'DOMContentLoaded',
    w.guard('dcl', () => {
      if (legacyNow()) {
        stop();
        return;
      }
      w.emit.state('fx.identity', { creatorId: w.store.creator, accountMeSeen: w.accountMeSeen, legacy: false, fbuddy: fbuddy() });
      w.emit.state('fx.contract', contract());
      w.emit.flush();
    }),
  );
  w.n.listen(
    w.win,
    'pageshow',
    w.guard('pageshow', (ev: PageTransitionEvent) => {
      if (!ev.persisted) return;
      w.store.unknownAll('bfcache');
      w.emit.flush();
    }) as EventListener,
  );
  return {
    contract,
    fbuddy,
    legacyNow,
    participants(sid, type, e) {
      if (sid !== 4) return;
      const gu = e['groupUser'] as { groupId?: string; userId?: string } | undefined;
      const gid = gu?.groupId ?? (typeof e['id'] === 'string' ? (e['id'] as string) : null);
      if (!gid) return;
      const chat = w.store.chats.get(gid);
      if (!chat) return;
      if (type === 6 || type === 7) {
        // Membership changed: who the fan is must be read again from /group/<id>/.
        chat.fanId = null;
        chat.kind = 0;
        w.emit.event('fx.coverage', { groupIds: [gid], state: 'unknown', reason: 'participants' }, 64);
      }
    },
    fanScript(chat) {
      if (!chat.texts) return null;
      let latin = 0;
      let cyr = 0;
      let other = 0;
      for (const rec of chat.recs.slice(-20)) {
        if (!rec.fromFan) continue;
        const text = chat.texts.get(rec.id) ?? '';
        for (let i = 0; i < text.length && i < 200; i += 1) {
          const c = text.charCodeAt(i);
          if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) latin += 1;
          else if (c >= 0x400 && c <= 0x4ff) cyr += 1;
          else if (c > 0x2ff && (c < 0x2000 || c > 0x2bff) && (c < 0xd800 || c > 0xdfff)) other += 1;
        }
      }
      const max = Math.max(latin, cyr, other);
      if (max === 0) return null;
      return max === latin ? 'latin' : max === cyr ? 'cyrillic' : 'other';
    },
  };
}

/** Request payload checks (MAIN checks every request by hand, §6). */
export const isGroupId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}$/.test(v);
export const isFeature = (v: unknown): boolean => v === 'reply' || v === 'fix' || v === 'hi' || v === 'ping' || v === 'recap' || v === 'review' || v === 'coach';
