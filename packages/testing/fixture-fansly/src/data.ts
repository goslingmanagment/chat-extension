// The stand's synthetic world: a creator, 120 conversations, their histories.
// Nothing here is real: ids are Fansly-shaped (18 digits, above 2^53, so a
// `Number()` would round them) and always strings; a group's id is never its
// fan's id (FS-ACC-1). Deterministic: every load gets the same world.

import type { FanslyStandIds } from './protocol';

export interface Account {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
}

export interface MessageAttachment {
  readonly contentId: string;
  /** 1 — account media, 2 — a bundle (Fansly's content types). */
  readonly contentType: number;
}

export interface Message {
  readonly id: string;
  readonly groupId: string;
  readonly senderId: string;
  readonly content: string;
  /** Seconds, as Fansly's `createdAt`. */
  readonly createdAt: number;
  readonly attachments: readonly MessageAttachment[];
}

/** A conversation as the server side of the stand keeps it. */
export interface ServerGroup {
  readonly id: string;
  /** Participants other than the creator; the header's contact block stands only while there is exactly one. */
  partners: Account[];
  /** The fan's account (the first partner at creation). */
  readonly fan: Account;
  dmRulesUnmet: boolean;
  /** 1 online, 2 away, 3 offline, 4 hidden. */
  status: 1 | 2 | 3 | 4;
  unread: number;
  /** Oldest first. */
  readonly history: Message[];
}

export interface World {
  readonly creator: Account;
  /** Newest conversation first: the inbox's order. */
  readonly groups: ServerGroup[];
  readonly byId: Map<string, ServerGroup>;
  /** Next message id. */
  nextMessage: bigint;
  /** Next media id (uploads). */
  nextMedia: bigint;
}

export const GROUP_COUNT = 120;
const GROUP_BASE = 810_000_000_000_000_000n;
const FAN_BASE = 920_000_000_000_000_000n;
const MESSAGE_BASE = 830_000_000_000_000_000n;
const MEDIA_BASE = 840_000_000_000_000_000n;
/** 2026-10-01 00:00 UTC: the synthetic histories end before it. */
const EPOCH_S = 1_791_072_000;

const CREATOR: Account = { id: '700000000000000017', username: 'stand_creator', displayName: 'Stand Creator' };

const groupId = (index: number): string => String(GROUP_BASE + BigInt(index * 13 + 1));
const fanOf = (index: number): Account => ({ id: String(FAN_BASE + BigInt(index * 29 + 3)), username: `stand_fan_${index + 1}`, displayName: `Stand Fan ${index + 1}` });
/** The first conversation has a long history: three older pages of 25 above the latest one. */
const historyLength = (index: number): number => (index === 0 ? 90 : ((index * 7) % 23) + 3);

export function createWorld(): World {
  let nextMessage = MESSAGE_BASE;
  const groups: ServerGroup[] = [];
  for (let index = 0; index < GROUP_COUNT; index += 1) {
    const id = groupId(index);
    const fan = fanOf(index);
    const length = historyLength(index);
    const history: Message[] = [];
    for (let k = 0; k < length; k += 1) {
      nextMessage += 1n;
      const mine = k % 3 === 2;
      history.push({
        id: String(nextMessage),
        groupId: id,
        senderId: mine ? CREATOR.id : fan.id,
        content: mine ? `Stand reply ${k + 1} to fan ${index + 1}` : `Stand line ${k + 1} from fan ${index + 1}`,
        createdAt: EPOCH_S - index * 600 - (length - k) * 60,
        attachments: [],
      });
    }
    groups.push({ id, partners: [fan], fan, dmRulesUnmet: false, status: index % 3 === 0 ? 1 : 3, unread: index % 4 === 1 ? 2 : 0, history });
  }
  return { creator: CREATOR, groups, byId: new Map(groups.map((group) => [group.id, group])), nextMessage, nextMedia: MEDIA_BASE };
}

export function standIds(world: World): FanslyStandIds {
  const first = world.groups.slice(0, 8);
  return {
    creator: world.creator.id,
    groups: first.map((group) => group.id),
    fans: Object.fromEntries(first.map((group) => [group.id, group.fan.id])),
    longHistory: world.groups[0]?.id ?? '',
    groupCount: world.groups.length,
  };
}

export function newMessageId(world: World): string {
  world.nextMessage += 1n;
  return String(world.nextMessage);
}

export function newMediaId(world: World): string {
  world.nextMedia += 1n;
  return String(world.nextMedia);
}
