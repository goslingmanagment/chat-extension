// The fake Fansly's world (R20 P6b): synthetic, Fansly-shaped, and the same
// conversations as the stand page's own in-page world.

import { describe, expect, it } from 'vitest';

import { GROUP_COUNT, createWorld, standIds } from '../../fixture-fansly/src/data';
import { compareIds, snowflakeAt, snowflakeMs } from '../../fixture-fansly/src/wire';
import { FanslyWorld, GROUP_TYPE, MESSAGE_TYPE, SEED_FOLLOWERS } from './data';

const seed = createWorld();
const ids = standIds(seed);

describe('the fake Fansly’s world', () => {
  it('is the stand page’s world: the same creator, conversations, fans and histories', () => {
    const world = new FanslyWorld();
    expect(world.creatorId).toBe(ids.creator);
    expect(world.inbox().map((group) => group.id)).toEqual(seed.groups.map((group) => group.id));
    for (const group of seed.groups.slice(0, 8)) {
      const known = world.groups.get(group.id);
      expect(known?.fanId).toBe(group.fan.id);
      expect(known?.history.map((message) => [message.id, message.senderId, message.content])).toEqual(group.history.map((message) => [message.id, message.senderId, message.content]));
      expect(known?.unread.size).toBe(group.unread);
    }
  });

  it('ids are Fansly’s: digit strings of 18 above 2^53; a message’s id is a snowflake of its own time', () => {
    const world = new FanslyWorld();
    const all = [...world.accounts.keys(), ...world.groups.keys(), ...world.messages.keys(), ...world.follows.map((follow) => follow.id), ...world.albums.map((album) => album.id)];
    expect(all.length).toBeGreaterThan(GROUP_COUNT * 5);
    for (const id of all) {
      expect(id).toMatch(/^[1-9]\d{17}$/);
      expect(BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    }
    expect(new Set(all).size).toBe(all.length);
    for (const message of world.messages.values()) expect(Math.floor(snowflakeMs(message.id) / 1000)).toBe(message.createdAt);
    // The id order is the time order across conversations: the inbox is listed by it.
    const newest = world.inbox().map((group) => group.history.at(-1)?.id ?? '');
    expect([...newest].sort((a, b) => compareIds(b, a))).toEqual(newest);
    expect(snowflakeAt(1_791_072_000_000)).toMatch(/^9\d{17}$/);
    expect(compareIds('999', '1000')).toBeLessThan(0);
  });

  it('new ids are snowflakes of now, never repeated, each newer than the last', () => {
    const world = new FanslyWorld();
    const now = Date.now();
    const made = Array.from({ length: 50 }, () => world.nextId(now));
    expect(new Set(made).size).toBe(50);
    expect([...made].sort(compareIds)).toEqual(made);
    expect(Math.abs(snowflakeMs(made[0] as string) - now)).toBeLessThan(2);
    for (const seeded of world.messages.keys()) expect(compareIds(seeded, made[0] as string)).toBeLessThan(0);
  });

  it('followers are newest first, over about a week; the first ones are fans of the inbox', () => {
    const now = Date.now();
    const world = new FanslyWorld(now);
    expect(world.follows).toHaveLength(SEED_FOLLOWERS);
    const times = world.follows.map((follow) => snowflakeMs(follow.id));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(now - (times[0] as number)).toBe(5 * 60_000);
    expect(now - (times.at(-1) as number)).toBeGreaterThan(6 * 86_400_000);
    expect(world.conversationWith(world.follows[0]?.followerId ?? '')).not.toBeNull();
    expect(world.conversationWith(world.follows.at(-1)?.followerId ?? '')).toBeNull();
    for (const follow of world.follows) expect(world.accounts.get(follow.followerId)?.followsCreator).toBe(true);
  });

  it('a mass send is a `type 3` parent and a copy a conversation; deleting the parent takes the copies', () => {
    const world = new FanslyWorld();
    const [a, b] = ids.groups as [string, string];
    const { parent, copies } = world.broadcast('Stand mass send', [a, b]);
    expect(world.groups.get(parent.groupId)?.type).toBe(GROUP_TYPE.broadcast);
    expect(parent.type).toBe(MESSAGE_TYPE.broadcast);
    expect(copies.map((copy) => copy.correlationId)).toEqual([parent.id, parent.id]);
    // The creator's mass-send group is no conversation of the inbox.
    expect(world.inbox().some((group) => group.id === world.broadcastGroupId)).toBe(false);
    const removed = world.deleteMessage(parent.id);
    expect(removed?.cascade.map((copy) => copy.id).sort()).toEqual(copies.map((copy) => copy.id).sort());
    for (const copy of copies) expect(world.messages.has(copy.id)).toBe(false);
    expect(world.deleteMessage(parent.id)).toBeNull();
  });

  it('a conversation is found or made by its fan; a group chat has no fan; marks follow the reader', () => {
    const world = new FanslyWorld();
    const [a] = ids.groups as [string];
    const group = world.groups.get(a);
    if (group === undefined) throw new Error('no group');
    expect(world.createConversation(ids.fans[a] as string)).toEqual({ group, created: false });
    const made = world.createConversation('931000000000000456');
    expect(made.created).toBe(true);
    expect(made.group.history).toEqual([]);
    expect(world.inbox().at(-1)?.id).toBe(made.group.id);

    expect(world.fanOf(group)).toBe(ids.fans[a]);
    expect(world.setPartners(group, 3).added).toHaveLength(2);
    expect(world.fanOf(group)).toBeNull();
    expect(world.setPartners(group, 1).removed).toHaveLength(2);

    const fromFan = world.addMessage({ groupId: a, senderId: ids.fans[a] as string, content: 'new' });
    expect(group.unread.has(fromFan.id)).toBe(true);
    world.ack(world.creatorId, [fromFan.id], 2);
    expect(group.unread.has(fromFan.id)).toBe(false);
    world.ack(world.creatorId, [fromFan.id], 4);
    expect(group.unread.has(fromFan.id)).toBe(true);
    // Nobody marks their own message.
    expect(world.ack(ids.fans[a] as string, [fromFan.id], 2)).toEqual([]);
  });
});
