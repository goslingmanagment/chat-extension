// P10d's fixtures must be observable through the same API the pass reads, without scripting extension state.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type WireAccount, type WireFollowersPage, type WireGroup, type WireHistoryPage, snowflakeMs } from '../../fixture-fansly/src/wire';
import { fakeFanslyControl } from './client';
import { type FakeFansly } from './index';
import { bypass, call, startTestFansly } from './kit';

const FAN = '940000000000000101';
const OTHER = '940000000000000102';
let fake: FakeFansly;
beforeAll(async () => { fake = await startTestFansly(); });
afterAll(async () => { await fake.close(); });
beforeEach(() => { fake.command({ op: 'reset' }); });

describe('the newcomers pass fixtures over the fake Fansly API', () => {
  it('replaces the follower list, newest first, with real snowflake ages and a working second page', async () => {
    const now = Date.now();
    await fakeFanslyControl(fake.apiOrigin).command({ op: 'newcomers', followers: [{ fanId: FAN, ageHours: 49 }, { fanId: OTHER, ageHours: 0.5 }] });
    const creator = fake.state.world.creatorId;
    const first = (await call<WireFollowersPage>(fake, 'GET', bypass(`/account/${creator}/followersnew?limit=1&before=0`))).response;
    expect(first?.followers.map((follow) => follow.followerId)).toEqual([OTHER]);
    expect(Math.abs(snowflakeMs(first?.followers[0]?.id ?? '0') - (now - 0.5 * 3_600_000))).toBeLessThan(1000);
    const next = (await call<WireFollowersPage>(fake, 'GET', bypass(`/account/${creator}/followersnew?limit=100&before=${first?.followers[0]?.id ?? ''}`))).response;
    expect(next?.followers.map((follow) => follow.followerId)).toEqual([FAN]);
    expect(Math.abs(snowflakeMs(next?.followers[0]?.id ?? '0') - (now - 49 * 3_600_000))).toBeLessThan(1000);
    await fakeFanslyControl(fake.apiOrigin).command({ op: 'newcomers', followers: [] });
    expect((await call<WireFollowersPage>(fake, 'GET', bypass(`/account/${creator}/followersnew?limit=100`))).response?.followers).toEqual([]);
  });

  it('serves profiles, custom names, DM rules and every automation shape as normal account, group and history responses', async () => {
    const seeded = await fakeFanslyControl(fake.apiOrigin).command({ op: 'newcomers', followers: [{
      fanId: FAN, customName: 'Проверочный фан', dmRulesUnmet: true,
      messages: [
        { from: 'fan', text: 'hello' },
        { from: 'creator', text: 'automatic', type: 2 },
        { from: 'creator', text: 'mass copy', correlationId: '806000000000000099' },
        { from: 'creator', text: 'a personal reply', correlationId: '806000000000000099', inReplyTo: '830000000000000001' },
      ],
    }] });
    const messages = seeded.messages ?? [];
    expect(messages).toHaveLength(4);
    const group = messages[0]?.groupId ?? '';
    expect(group).not.toBe(FAN);
    const profile = (await call<WireAccount[]>(fake, 'GET', bypass(`/account?ids=${FAN}`))).response?.[0];
    expect(profile).toMatchObject({ id: FAN, followsYou: true, notes: [{ contentType: 12002, note: 'Проверочный фан' }] });
    const detail = (await call<WireGroup>(fake, 'GET', bypass(`/group/${group}/`))).response;
    expect(detail).toMatchObject({ id: group, hasDmPermissionFlags: true });
    const history = (await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${group}&limit=25`))).response?.messages;
    expect(history?.map((message) => message.id)).toEqual(messages.map((message) => message.id).reverse());
    expect(history?.[0]).toMatchObject({ correlationId: '806000000000000099', inReplyTo: '830000000000000001' });
  });

  it('distinguishes an absent conversation from an existing empty one, and keeps unrelated conversations', async () => {
    const unrelated = fake.command({ op: 'conversation', fanId: '940000000000000103' }).groupId ?? '';
    fake.command({ op: 'newcomers', followers: [{ fanId: FAN }, { fanId: OTHER, messages: [] }] });
    const creator = fake.state.world.creatorId;
    const existingId = fake.state.world.conversationWith(OTHER)?.id;
    expect(fake.state.world.conversationWith(FAN)).toBeNull();
    const body = (fan: string) => ({ users: [{ userId: fan, permissionFlags: 0 }, { userId: creator, permissionFlags: 0 }], recipients: [], lastMessage: null, userSettings: null, type: 1 });
    const existing = (await call<WireGroup>(fake, 'POST', bypass('/group'), { body: body(OTHER) })).response;
    const created = (await call<WireGroup>(fake, 'POST', bypass('/group'), { body: body(FAN) })).response;
    expect(existing?.id).toBe(existingId);
    expect(created?.id).toMatch(/^\d+$/);
    expect(created?.id).not.toBe(existingId);
    expect((await call(fake, 'GET', bypass(`/group/${unrelated}/`))).status).toBe(200);
    expect((await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${existing?.id ?? ''}&limit=25`))).response?.messages).toEqual([]);
  });

  it('serves an unpaid DM price in Fansly’s nested metadata, alongside the existing permission-rule fixture', async () => {
    fake.command({ op: 'newcomers', followers: [{ fanId: FAN, dmPriceMills: 1700 }, { fanId: OTHER, dmRulesUnmet: true, messages: [] }] });
    const group = fake.state.world.conversationWith(FAN)?.id ?? '';
    const paid = (await call<WireGroup>(fake, 'GET', bypass(`/group/${group}/`))).response;
    expect(paid).toMatchObject({ hasDmPermissionFlags: true, dmPermissionFlags: [{ flags: 1, metadata: JSON.stringify({ '1': JSON.stringify({ price: 1700 }) }) }] });
    const other = fake.state.world.conversationWith(OTHER)?.id ?? '';
    expect((await call<WireGroup>(fake, 'GET', bypass(`/group/${other}/`))).response?.dmPermissionFlags).toEqual([expect.objectContaining({ flags: 2, metadata: '{}' })]);
  });
});
