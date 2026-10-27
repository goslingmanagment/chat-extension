// The stand's synthetic world: a creator, 120 conversations, their histories.
// Nothing here is real: ids are Fansly-shaped (18 digits, above 2^53, so a
// `Number()` would round them) and always strings; a group's id is never its
// fan's id (FS-ACC-1). A message's id is a snowflake of its own time, as
// Fansly's is: the id order is the time order across all conversations, and
// the newest conversation of the inbox has the newest message id (the inbox
// is listed by it). Deterministic: every load gets the same world. The
// showcase world (`pnpm see --showcase`) dresses the same ids as Sofia Lane's
// working day: showcase.ts, dated back from the run's one «now».

import type { FanslyStandIds } from './protocol';
import { SHOWCASE_CONVERSATIONS, SHOWCASE_CREATOR, showcaseFillerChat, showcasePerson } from './showcase';
import { snowflakeAt } from './wire';

export interface Account {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  /** The creator's custom name for the account (its note 12002): Fansly's chat header shows it instead of the display name. */
  readonly customName?: string;
  /** The line under the name on the profile (the showcase world's; the fake Fansly makes one up otherwise). */
  readonly about?: string;
  /** The picture's address as the API gives it (its 400 px variant); the page draws it only in the showcase world (world.ts). */
  readonly avatar?: string;
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
  /** Fansly's message type (1 — a message, 2 — automated, 3 — the parent of a mass send); absent — 1. */
  readonly type?: number;
  /** The id of what made the message (a mass send's parent): deleting that parent deletes this one too (main:28943-28950). */
  readonly correlationId?: string | null;
  /** When the other side read it, seconds; absent — the moment it came. */
  readonly readAt?: number;
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
const MEDIA_BASE = 840_000_000_000_000_000n;
/** 2026-10-04 00:00 UTC: the synthetic histories end before it. */
const EPOCH_S = 1_791_072_000;

const CREATOR: Account = { id: '700000000000000017', username: 'stand_creator', displayName: 'Stand Creator' };

const groupId = (index: number): string => String(GROUP_BASE + BigInt(index * 13 + 1));
/** The id of the stand's `index`-th conversation (0 — the long one, the first of the inbox in the synthetic world). */
export const standGroupId = groupId;
const fanOf = (index: number): Account => ({ id: String(FAN_BASE + BigInt(index * 29 + 3)), username: `stand_fan_${index + 1}`, displayName: `Stand Fan ${index + 1}` });
/** The first conversation has a long history: three older pages of 25 above the latest one. */
const historyLength = (index: number): number => (index === 0 ? 90 : ((index * 7) % 23) + 3);

/**
 * The stand's world: the synthetic one, or with `showcaseAt` (ms) the showcase world's (showcase.ts) dated back from
 * that moment — the same group, fan and creator ids either way.
 */
export function createWorld(creatorId: string = CREATOR.id, showcaseAt: number | null = null): World {
  if (showcaseAt !== null) return createShowcaseWorld(creatorId, showcaseAt);
  const creator = { ...CREATOR, id: creatorId };
  let sequence = 0;
  const groups: ServerGroup[] = [];
  for (let index = 0; index < GROUP_COUNT; index += 1) {
    const id = groupId(index);
    const fan = fanOf(index);
    const length = historyLength(index);
    const history: Message[] = [];
    for (let k = 0; k < length; k += 1) {
      sequence += 1;
      const mine = k % 3 === 2;
      const createdAt = EPOCH_S - index * 600 - (length - k) * 60;
      history.push({
        // Two messages of one second differ by the id's low bits.
        id: snowflakeAt(createdAt * 1000, sequence),
        groupId: id,
        senderId: mine ? creator.id : fan.id,
        content: mine ? `Stand reply ${k + 1} to fan ${index + 1}` : `Stand line ${k + 1} from fan ${index + 1}`,
        createdAt,
        attachments: [],
      });
    }
    groups.push({ id, partners: [fan], fan, dmRulesUnmet: false, status: index % 3 === 0 ? 1 : 3, unread: index % 4 === 1 ? 2 : 0, history });
  }
  // New messages of the in-page world come after every seeded one.
  return { creator, groups, byId: new Map(groups.map((group) => [group.id, group])), nextMessage: BigInt(snowflakeAt(EPOCH_S * 1000, 0)), nextMedia: MEDIA_BASE };
}

/**
 * Sofia Lane's inbox (showcase.ts): the hand-written conversations first (group 0 is the open chat), the rest short
 * chats of a day to six weeks; message ids are snowflakes of their own moments, in time order across the inbox; a
 * creator's message is read by the fan a few minutes after it came.
 */
function createShowcaseWorld(creatorId: string, now: number): World {
  const creator: Account = { id: creatorId, ...SHOWCASE_CREATOR };
  const groups: ServerGroup[] = [];
  const lines: { readonly group: ServerGroup; readonly mine: boolean; readonly text: string; readonly at: number }[] = [];
  for (let index = 0; index < GROUP_COUNT; index += 1) {
    const id = groupId(index);
    const written = SHOWCASE_CONVERSATIONS[index];
    const person = written ?? showcasePerson(index);
    const fan: Account = { id: fanOf(index).id, username: person.username, displayName: person.displayName, about: person.about };
    const group: ServerGroup = { id, partners: [fan], fan, dmRulesUnmet: false, status: written?.online === true ? 1 : 3, unread: written?.unread ?? (index % 7 === 2 ? 1 : 0), history: [] };
    groups.push(group);
    for (const [from, text, minutesAgo] of written?.chat ?? showcaseFillerChat(index)) lines.push({ group, mine: from === 'model', text, at: Math.floor((now - minutesAgo * 60_000) / 1000) });
  }
  lines
    .sort((a, b) => a.at - b.at)
    .forEach((line, sequence) => {
      line.group.history.push({
        id: snowflakeAt(line.at * 1000, sequence),
        groupId: line.group.id,
        senderId: line.mine ? creator.id : line.group.fan.id,
        content: line.text,
        createdAt: line.at,
        attachments: [],
        ...(line.mine ? { readAt: Math.min(Math.floor(now / 1000), line.at + 60 + (sequence % 9) * 60) } : {}),
      });
    });
  // The inbox's order: the newest conversation first.
  groups.sort((a, b) => (b.history.at(-1)?.createdAt ?? 0) - (a.history.at(-1)?.createdAt ?? 0));
  return { creator, groups, byId: new Map(groups.map((group) => [group.id, group])), nextMessage: BigInt(snowflakeAt(now, 0)), nextMedia: MEDIA_BASE };
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
