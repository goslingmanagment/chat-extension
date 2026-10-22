// Whether the fan read the group's newest message (a fan's preview; FS-NET-1 row `preview`): read from `GET
// /group/<id>/` — the group's `lastMessage` with its `interactions`, one per member it reached: `readAt` in ms, 0 while
// not read; a member with no entry has not read it either. Our reads never mark a message read (no `POST
// /message/ack`, RB-022).

import type { ChatReadState } from '@cg/contracts/host';

const FANSLY_ID = /^[1-9]\d{0,23}$/;

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Fansly's time in seconds (`createdAt`, fractional in a socket frame) or milliseconds (`readAt`) as ISO; null — none. */
const isoOf = (value: unknown, unit: 's' | 'ms'): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const at = new Date(Math.round(unit === 's' ? value * 1000 : value));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

/**
 * The group's answer (the envelope's `response`) as the fan's read state. `group` false — the answer is not this
 * group of the creator and the fan (nothing is said of it); `last` null — the group has no message, or its sender is
 * neither of the two.
 */
export function groupReadState(value: unknown, groupId: string, creatorId: string, fanId: string): { readonly group: true; readonly last: ChatReadState | null } | { readonly group: false } {
  if (!record(value) || value['id'] !== groupId || !Array.isArray(value['users'])) return { group: false };
  const users = value['users'].map((user: unknown) => (record(user) ? user['userId'] : null));
  if (!users.includes(creatorId) || !users.includes(fanId)) return { group: false };
  const last = value['lastMessage'];
  if (!record(last) || typeof last['id'] !== 'string' || !FANSLY_ID.test(last['id'])) return { group: true, last: null };
  const sender = last['senderId'];
  const direction = sender === fanId ? 'fan' : sender === creatorId ? 'model' : null;
  if (direction === null) return { group: true, last: null };
  const interactions: unknown = last['interactions'];
  const seen: unknown = direction === 'model' && Array.isArray(interactions) ? (interactions.find((entry: unknown) => record(entry) && entry['userId'] === fanId) ?? { readAt: 0 }) : undefined;
  const readAt = record(seen) ? seen['readAt'] : undefined;
  return {
    group: true,
    last: {
      messageId: last['id'],
      direction,
      sentAt: isoOf(last['createdAt'], 's'),
      read: typeof readAt === 'number' ? readAt > 0 : null,
      readAt: isoOf(readAt, 'ms'),
    },
  };
}
