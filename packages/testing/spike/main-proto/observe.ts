// Chat observation with one memory account (architecture §5.5–§5.6): metadata rings, texts of recently active
// chats, tombstones, the fan → group map; certificates and completeness; merge order by a document sequence.
// Costs per item are ESTIMATES (bytes); the spike calibrates them against Firefox's memory reporter.

import { cmpId } from './natives';

export const COST = { rec: 200, chat: 400, textBase: 40, tomb: 48, group: 160 };
export const LIMITS = { recsPerChat: 120, chats: 300, textChats: 20, textsPerChat: 60, textBytes: 2 * 1024 * 1024, totalBytes: 4 * 1024 * 1024 };

export interface Rec {
  id: string;
  fromFan: boolean;
  at: number;
  type: number;
  corr: string | null;
  reply: string | null;
  media: boolean;
  deleted: boolean;
  epoch: number;
  seq: number;
}

export interface Chat {
  gid: string;
  recs: Rec[];
  texts: Map<string, string> | null;
  textBytes: number;
  fanId: string | null;
  kind: number;
  dmAllowed: boolean;
  everCertified: boolean;
  loss: boolean;
  complete: boolean;
  startProven: boolean;
  covered: number;
  personal: number;
  floor: string | null;
  active: number;
  lastSeenId: string | null;
}

export interface Msg {
  id: string;
  groupId: string;
  senderId: string;
  type: number;
  content: string;
  createdAt: number;
  correlationId?: string | null;
  inReplyTo?: string | null;
  attachments?: unknown[];
}

export interface Store {
  chats: Map<string, Chat>;
  creator: string | null;
  automated: Set<string>;
  tombs: Set<string>;
  bytes(): number;
  textBytes(): number;
  ingest(gid: string, msgs: readonly Msg[], epoch: number, seq: number, live: boolean): void;
  deleteMsg(id: string, cascadeCorr: boolean, seq: number): string[];
  certify(gid: string, msgs: readonly Msg[], epoch: number, startedSeq: number): void;
  hint(gid: string, lastMessageId: string | null): void;
  unknownAll(reason: string): void;
  group(gid: string): Chat;
  touch(gid: string): void;
}

const isAuto = (m: Msg, store: Store): boolean =>
  m.senderId === store.creator && (m.type === 2 || (!!m.correlationId && m.correlationId !== '0' && !m.inReplyTo) || store.automated.has(norm(m.content)));
export const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function createStore(onUnknown: (gids: string[] | 'all', reason: string) => void): Store {
  const chats = new Map<string, Chat>();
  const tombs = new Set<string>();
  let total = 0;
  let texts = 0;
  let clock = 0;

  const store: Store = {
    chats,
    creator: null,
    automated: new Set(),
    tombs,
    bytes: () => total + tombs.size * COST.tomb,
    textBytes: () => texts,
    group: (gid) => {
      let chat = chats.get(gid);
      if (!chat) {
        chat = { gid, recs: [], texts: null, textBytes: 0, fanId: null, kind: 1, dmAllowed: true, everCertified: false, loss: false, complete: false, startProven: false, covered: 0, personal: 0, floor: null, active: (clock += 1), lastSeenId: null };
        chats.set(gid, chat);
        total += COST.chat;
        if (chats.size > LIMITS.chats) evictChat();
      }
      return chat;
    },
    touch: (gid) => {
      const chat = chats.get(gid);
      if (chat) chat.active = clock += 1;
    },
    ingest(gid, msgs, epoch, seq, live) {
      const chat = store.group(gid);
      if (live) chat.active = clock += 1;
      for (const m of msgs) {
        if (tombs.has(m.id)) continue;
        const at = binary(chat.recs, m.id);
        if (at >= 0) {
          const rec = chat.recs[at] as Rec;
          if (rec.seq > seq && rec.deleted) continue;
          continue;
        }
        const rec: Rec = { id: m.id, fromFan: m.senderId !== store.creator, at: m.createdAt, type: m.type, corr: m.correlationId ?? null, reply: m.inReplyTo ?? null, media: !!m.attachments?.length, deleted: false, epoch, seq };
        chat.recs.splice(~at, 0, rec);
        total += COST.rec;
        if (chat.startProven) {
          chat.covered += 1;
          if (rec.fromFan || !isAuto(m, store)) chat.personal += 1;
        }
        if (m.content) putText(chat, m.id, m.content);
        if (chat.recs.length > LIMITS.recsPerChat) {
          const old = chat.recs.shift() as Rec;
          total -= COST.rec;
          dropText(chat, old.id);
          chat.floor = chat.recs[0]?.id ?? null;
        }
      }
      enforce();
    },
    deleteMsg(id, cascadeCorr, seq) {
      const hit: string[] = [];
      tombs.add(id);
      if (tombs.size > 4096) tombs.delete(tombs.values().next().value as string);
      for (const chat of chats.values()) {
        for (const rec of chat.recs) {
          if (rec.id === id || (cascadeCorr && rec.corr === id)) {
            rec.deleted = true;
            rec.seq = seq;
            dropText(chat, rec.id);
            hit.push(chat.gid);
          }
        }
      }
      return hit;
    },
    certify(gid, msgs, epoch, startedSeq) {
      const chat = store.group(gid);
      const first = !chat.everCertified;
      const ids = msgs.map((m) => m.id).sort(cmpId);
      const lastKnown = chat.recs.filter((r) => !r.deleted).at(-1)?.id ?? null;
      const overlaps = lastKnown === null || ids.includes(lastKnown);
      const toStart = msgs.length < 25;
      store.ingest(gid, msgs, epoch, startedSeq, false);
      if (first || (chat.loss && (overlaps || toStart))) {
        chat.everCertified = true;
        chat.loss = false;
        chat.complete = true;
        chat.floor = ids[0] ?? null;
        if (toStart) {
          chat.startProven = true;
          chat.covered = msgs.length;
          chat.personal = msgs.filter((m) => m.senderId !== store.creator || !isAuto(m, store)).length;
        }
      }
    },
    hint(gid, lastMessageId) {
      const chat = chats.get(gid);
      if (!chat || !lastMessageId) return;
      const newest = chat.recs.at(-1)?.id;
      if (chat.complete && (!newest || cmpId(lastMessageId, newest) > 0)) {
        chat.complete = false;
        chat.loss = true;
        onUnknown([gid], 'source-newer');
      }
    },
    unknownAll(reason) {
      for (const chat of chats.values()) {
        chat.complete = false;
        if (chat.everCertified) chat.loss = true;
      }
      onUnknown('all', reason);
    },
  };

  function binary(recs: Rec[], id: string): number {
    let lo = 0;
    let hi = recs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = cmpId((recs[mid] as Rec).id, id);
      if (c === 0) return mid;
      if (c < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return ~lo;
  }

  function putText(chat: Chat, id: string, text: string): void {
    if (!chat.texts) {
      const withTexts = [...chats.values()].filter((c) => c.texts);
      if (withTexts.length >= LIMITS.textChats) {
        const oldest = withTexts.sort((a, b) => a.active - b.active)[0] as Chat;
        dropAllTexts(oldest);
      }
      chat.texts = new Map();
    }
    const cost = COST.textBase + text.length * 2;
    chat.texts.set(id, text);
    chat.textBytes += cost;
    texts += cost;
    total += cost;
    while (chat.texts.size > LIMITS.textsPerChat) dropText(chat, chat.texts.keys().next().value as string);
  }

  function dropText(chat: Chat, id: string): void {
    const text = chat.texts?.get(id);
    if (text === undefined || !chat.texts) return;
    chat.texts.delete(id);
    const cost = COST.textBase + text.length * 2;
    chat.textBytes -= cost;
    texts -= cost;
    total -= cost;
  }

  function dropAllTexts(chat: Chat): void {
    texts -= chat.textBytes;
    total -= chat.textBytes;
    chat.textBytes = 0;
    chat.texts = null;
  }

  function evictChat(): void {
    let victim: Chat | null = null;
    for (const chat of chats.values()) if (!victim || chat.active < victim.active) victim = chat;
    if (!victim) return;
    dropAllTexts(victim);
    total -= COST.chat + victim.recs.length * COST.rec;
    chats.delete(victim.gid);
    onUnknown([victim.gid], 'evicted');
  }

  function enforce(): void {
    while (texts > LIMITS.textBytes) {
      const withTexts = [...chats.values()].filter((c) => c.texts).sort((a, b) => a.active - b.active);
      const oldest = withTexts[0];
      if (!oldest) break;
      dropAllTexts(oldest);
    }
    while (store.bytes() > LIMITS.totalBytes && chats.size > 1) evictChat();
  }

  return store;
}
