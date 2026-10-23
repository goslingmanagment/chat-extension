import { afterEach, describe, expect, it, vi } from 'vitest';
import { admit } from './allowlist';
import type { FanslyAnswer, FanslyCall } from './client';
import { FanslyApiError } from './errors';
import { createSpendersLookup, RESOLVE_BUDGET_MS, sendOutreach } from './spenders';

const ACCOUNT = '700000000000000001';
const FAN = '700000000000000002';
const GROUP = '800000000000000003';
const group = (users = [ACCOUNT, FAN], type = 1) => ({ id: GROUP, type, users: users.map((userId) => ({ userId })) });
const fan = { fanRef: FAN, displayName: 'Display name', username: 'handle' };
const answer = (response: unknown): FanslyAnswer => ({ status: 200, response });
function world(reply: (call: FanslyCall) => unknown = () => []) {
  let time = 1_000;
  const call = vi.fn(async (request: FanslyCall) => {
    expect(admit(request.purpose, request.route)).not.toBeNull();
    return answer(await reply(request));
  });
  const lookup = createSpendersLookup({ call }, () => time);
  return { lookup, call, advance: (ms: number) => { time += ms; } };
}
afterEach(() => vi.useRealTimers());

describe('[host:fansly] Spenders missing-data lookup (R20 P9e)', () => {
  it('[SP-041] searches once by displayName || username and uses exact identity/membership, never a name match', async () => {
    const w = world(() => ({ data: [{ partnerAccountId: FAN, groupId: GROUP }], aggregationData: { groups: [group()] } }));
    expect(await w.lookup.resolve(ACCOUNT, fan)).toBe(GROUP);
    expect(w.call).toHaveBeenCalledTimes(1);
    expect(w.call.mock.calls[0]?.[0]).toMatchObject({ purpose: 'spenders', route: 'messaging.groups', query: { search: 'Display name', offset: '0' } });
    expect(await w.lookup.resolve(ACCOUNT, fan)).toBe(GROUP);
    expect(w.call).toHaveBeenCalledTimes(1);
    expect(w.lookup.cached('999', FAN)).toBeNull();
  });
  it('[FS-SPD-2] an empty successful search permits one POST /group; it never sends or acknowledges a message', async () => {
    const w = world((call) => call.route === 'messaging.groups' ? { data: [], aggregationData: { groups: [] } } : group());
    expect(await w.lookup.resolve(ACCOUNT, fan)).toBe(GROUP);
    expect(w.call.mock.calls.map(([call]) => call.route)).toEqual(['messaging.groups', 'group.create']);
    expect(w.call.mock.calls[1]?.[0]).toMatchObject({ purpose: 'spenders', body: { users: [{ userId: FAN, permissionFlags: 0 }, { userId: ACCOUNT, permissionFlags: 0 }], recipients: [], lastMessage: null, userSettings: null, type: 1 } });
  });
  it.each(['network', 'rate-limited', 'cooling', 'expired', 'malformed'] as const)('a %s search never falls through to a POST or retries', async (kind) => {
    const w = world(() => { throw new FanslyApiError(kind, { sent: kind !== 'cooling' }); });
    await expect(w.lookup.resolve(ACCOUNT, fan)).rejects.toMatchObject({ kind });
    expect(w.call).toHaveBeenCalledTimes(1);
  });
  it('a group chat or another creator in the POST answer is refused, never cached or retried', async () => {
    for (const value of [group([ACCOUNT, FAN, '999']), group(['999', FAN]), group([ACCOUNT, FAN], 3)]) {
      const w = world(() => value);
      await expect(w.lookup.resolve(ACCOUNT, { ...fan, displayName: null, username: null })).rejects.toMatchObject({ kind: 'malformed' });
      expect(w.call).toHaveBeenCalledTimes(1);
      expect(w.lookup.cached(ACCOUNT, FAN)).toBeNull();
    }
  });
  it('a POST with an indeterminate outcome is attempted once', async () => {
    const w = world(() => { throw new FanslyApiError('network', { sent: true }); });
    await expect(w.lookup.resolve(ACCOUNT, { ...fan, displayName: null, username: null })).rejects.toMatchObject({ kind: 'network' });
    expect(w.call).toHaveBeenCalledTimes(1);
  });
  it('[SP-041] the 15 s budget aborts an inbox search and never starts a POST afterwards', async () => {
    vi.useFakeTimers();
    const w = world((call) => new Promise((_, reject) => call.signal?.addEventListener('abort', () => reject(new FanslyApiError('aborted', { sent: true })))));
    const finding = w.lookup.resolve(ACCOUNT, fan);
    const rejected = expect(finding).rejects.toMatchObject({ kind: 'aborted' });
    await vi.advanceTimersByTimeAsync(RESOLVE_BUDGET_MS);
    await rejected;
    expect(w.call).toHaveBeenCalledTimes(1);
  });
  it('concurrent clicks share one resolution; a cleared owner never receives a late group', async () => {
    let done!: (value: unknown) => void;
    const w = world(() => new Promise((resolve) => { done = resolve; }));
    const one = w.lookup.resolve(ACCOUNT, { ...fan, displayName: null, username: null });
    const two = w.lookup.resolve(ACCOUNT, { ...fan, displayName: null, username: null });
    expect(two).toBe(one);
    await w.lookup.clear();
    done(group());
    expect(await one).toBeNull();
    expect(w.lookup.cached(ACCOUNT, FAN)).toBeNull();
    expect(w.call).toHaveBeenCalledTimes(1);
  });
});

describe('[host:fansly] «Рассылка»: what goes to the fan', () => {
  const BUNDLE = '700000000000000011';
  const PREVIEW = '700000000000000012';
  it('one POST /message to the fan\'s group with the text and the copied items, as Fansly\'s composer sends them', async () => {
    const w = world(() => ({ id: '700000000000000013', groupId: GROUP, senderId: ACCOUNT }));
    const sent = await sendOutreach({ call: w.call }, ACCOUNT, { groupId: GROUP, text: 'hey you\n\nnew video is up', attachments: [{ contentType: 2, contentId: BUNDLE }, { contentType: 2, contentId: PREVIEW }] });
    expect(sent).toBe('700000000000000013');
    expect(w.call).toHaveBeenCalledTimes(1);
    expect(w.call.mock.calls[0]?.[0]).toEqual({
      purpose: 'outreach',
      route: 'message.send',
      account: ACCOUNT,
      body: {
        type: 1,
        content: 'hey you\n\nnew video is up',
        groupId: GROUP,
        attachments: [{ messageId: null, pos: 0, contentId: BUNDLE, contentType: 2 }, { messageId: null, pos: 1, contentId: PREVIEW, contentType: 2 }],
        likes: [],
        scheduledFor: 0,
        inReplyTo: null,
      },
    });
  });
  it('a receipt of another group is no receipt; a failed send is never asked again', async () => {
    const other = world(() => ({ id: '700000000000000013', groupId: '800000000000000009' }));
    await expect(sendOutreach({ call: other.call }, ACCOUNT, { groupId: GROUP, text: 'hey', attachments: [] })).rejects.toMatchObject({ kind: 'malformed', sent: true });
    const lost = world(() => { throw new FanslyApiError('network', { sent: true }); });
    await expect(sendOutreach({ call: lost.call }, ACCOUNT, { groupId: GROUP, text: 'hey', attachments: [] })).rejects.toBeInstanceOf(FanslyApiError);
    expect(lost.call).toHaveBeenCalledTimes(1);
  });
});
