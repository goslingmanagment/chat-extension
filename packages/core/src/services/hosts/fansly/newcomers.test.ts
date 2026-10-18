// The background's pass of «Новые» on Fansly (R20 P10b1) against a small scripted Fansly: what it asks, in what
// order, what each row's verdict rests on, the queue's buttons and the changes the window hears. Every request is
// checked against FS-NET-1's `newcomers` routes as it arrives.

import { FANSLY_TAB_REQUESTS, FANSLY_TAB_EVENTS, type FanslyFollowerRow, type FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { StartProofV1Schema } from '@cg/contracts/fansly';
import { FanslyGreetingProofSchema } from '@cg/contracts/tab-messages-fansly';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FANSLY_EPOCH_MS } from '../../../domain/hosts/fansly/newcomers/pass-rules';
import { createMemoryKv, type MemoryKv } from '../../test-support/memory-kv';
import { COOLING_LOOK_MS, NEWCOMERS_EXCLUDED_PREFIX, NEWCOMERS_WINDOW_KEY, createFanslyNewcomers, type FollowersChange, type NewcomersCall, type NewcomersRoute, type PassJournal, type PassJournalEvent, type PassJournalFields } from './newcomers';

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
const C = '700000000000000017';
const TAB = 'tab-1';
const OTHER_TAB = 'tab-2';
const ROUTES: readonly NewcomersRoute[] = ['followers.new', 'messaging.groups', 'account.byIds', 'group.detail', 'group.create', 'message.history', 'message.automated'];

let seq = 0;
const sf = (ms: number): string => String((BigInt(ms - FANSLY_EPOCH_MS) << 22n) + BigInt((seq += 1) % 4_000_000));
const fanId = (n: number): string => String(710_000_000_000_000_000n + BigInt(n));
const minutes = (n: number): number => n * 60_000;

class ApiError extends Error {
  constructor(
    readonly kind: string,
    readonly code: string,
  ) {
    super(kind);
  }
  toWire(): { code: string } {
    return { code: this.code };
  }
}

interface Msg {
  id: string;
  senderId: string;
  type: number;
  content: string;
  correlationId: string | null;
  inReplyTo: string | null;
}

interface Group {
  id: string;
  fan: string;
  messages: Msg[];
  /** The inbox lists it (its users in the aggregation, or thin). */
  inInbox: 'full' | 'thin' | 'no';
  users?: string[];
  /** R20 P10b2: the fan's DM rules as the group object carries them; absent — the answer names none. */
  dm?: { rules: unknown[]; account?: unknown };
}

function fansly() {
  const follows: { id: string; followerId: string }[] = [];
  const accounts = new Map<string, Record<string, unknown>>();
  const groups = new Map<string, Group>();
  const calls: NewcomersCall[] = [];
  const failures = new Map<string, Error>();
  let cooling = 0;
  let nextGroup = 900_000_000_000_000_000n;
  /** Calls of a route that wait for the test to let them go. */
  const gates = new Map<string, Promise<void>>();

  const groupOf = (fan: string): Group | undefined => [...groups.values()].find((group) => group.fan === fan);
  const wireGroup = (group: Group): Record<string, unknown> => ({
    id: group.id,
    users: (group.users ?? [C, group.fan]).map((userId) => ({ userId })),
    lastMessage: group.messages.length === 0 ? null : wireMessage(group, group.messages.at(-1) as Msg),
    ...(group.dm === undefined ? {} : { dmPermissionFlags: group.dm.rules, accountDmPermissionFlags: group.dm.account ?? { flags: 0, metadata: '{}' } }),
  });
  const wireMessage = (group: Group, message: Msg): Record<string, unknown> => ({ ...message, groupId: group.id, createdAt: 0, attachments: [] });

  return {
    calls,
    failures,
    follows,
    setCooling: (until: number) => (cooling = until),
    hold(route: NewcomersRoute): () => void {
      let open = (): void => undefined;
      gates.set(route, new Promise((resolve) => (open = resolve)));
      return () => {
        gates.delete(route);
        open();
      };
    },
    follow(n: number, at: number, profile: { notes?: boolean; name?: string; custom?: string; avatar?: unknown } = {}): string {
      const fan = fanId(n);
      follows.push({ id: sf(at), followerId: fan });
      follows.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1));
      accounts.set(fan, {
        id: fan,
        username: `fan_${n}`,
        displayName: profile.name ?? `Fan ${n}`,
        about: `about ${n}`,
        ...(profile.notes === false ? {} : { notes: profile.custom === undefined ? [] : [{ contentType: 12002, note: profile.custom }] }),
        ...(profile.avatar === undefined ? {} : { avatar: profile.avatar }),
      });
      return fan;
    },
    chat(fan: string, messages: Array<Partial<Msg> & { from: 'fan' | 'model' }>, inInbox: Group['inInbox'] = 'full'): Group {
      const id = String((nextGroup += 1n));
      const group: Group = {
        id,
        fan,
        inInbox,
        messages: messages.map((message, i) => ({
          id: sf(T0 - minutes(500) + i * 1000),
          senderId: message.from === 'fan' ? fan : C,
          type: message.type ?? 1,
          content: message.content ?? `text ${i}`,
          correlationId: message.correlationId ?? null,
          inReplyTo: message.inReplyTo ?? null,
        })),
      };
      groups.set(id, group);
      return group;
    },
    api: {
      async call(call: NewcomersCall): Promise<unknown> {
        expect(ROUTES).toContain(call.route);
        expect(call.account).toBe(C);
        calls.push(call);
        await gates.get(call.route);
        const key = `${call.route}:${call.query?.['groupId'] ?? call.path?.['group'] ?? (call.body as { users?: { userId: string }[] } | undefined)?.users?.[0]?.userId ?? ''}`;
        const failure = failures.get(key) ?? failures.get(call.route);
        if (failure !== undefined) throw failure;
        const q = call.query ?? {};
        switch (call.route) {
          case 'message.automated':
            return [{ messageTemplate: JSON.stringify({ content: 'Thanks  for\n the follow' }) }];
          case 'followers.new': {
            const before = q['before'] ?? '0';
            const page = follows.filter((follow) => before === '0' || BigInt(follow.id) < BigInt(before)).slice(0, Number(q['limit']));
            return { followers: page, aggregationData: { accounts: page.map((follow) => accounts.get(follow.followerId)) } };
          }
          case 'messaging.groups': {
            const listed = [...groups.values()].filter((group) => group.inInbox !== 'no');
            const offset = Number(q['offset']);
            const page = listed.slice(offset, offset + Number(q['limit']));
            return {
              data: page.map((group) => ({ groupId: group.id, partnerAccountId: group.fan, lastMessageId: group.messages.at(-1)?.id ?? null })),
              aggregationData: { groups: page.filter((group) => group.inInbox === 'full').map(wireGroup), accounts: [] },
            };
          }
          case 'account.byIds':
            return (q['ids'] ?? '').split(',').map((id) => ({ ...accounts.get(id), notes: (accounts.get(id)?.['notes'] as unknown[] | undefined) ?? [] }));
          case 'group.detail': {
            const group = groups.get(call.path?.['group'] ?? '');
            if (group === undefined) throw new ApiError('http', 'CG-FAN-REQUEST');
            return wireGroup(group);
          }
          case 'group.create': {
            if (cooling > Date.now()) throw new ApiError('cooling', 'CG-FAN-RATE-LIMIT');
            const fan = (call.body as { users: { userId: string }[] }).users[0]?.userId ?? '';
            return wireGroup(groupOf(fan) ?? this_.chat(fan, [], 'no'));
          }
          case 'message.history': {
            const group = groups.get(q['groupId'] ?? '') as Group;
            const before = q['before'];
            const older = group.messages.filter((message) => before === undefined || BigInt(message.id) < BigInt(before));
            return { messages: older.slice(-Number(q['limit'])).reverse().map((message) => wireMessage(group, message)) };
          }
        }
      },
      coolingUntil: (): number => cooling,
    },
  };
}
// The fake's own `chat` for `POST /group` of a fan without one (a new empty technical chat).
let this_: ReturnType<typeof fansly>;

function setup(options: { tabOn?: (tab: string, creator: string) => boolean; kv?: MemoryKv; journal?: PassJournal; onHistory?: (groupId: string, ids: readonly string[], complete: boolean) => void } = {}) {
  const world = fansly();
  this_ = world;
  const kv = options.kv ?? createMemoryKv();
  const heard: Array<{ tab: string; change: FollowersChange }> = [];
  let uuid = 0;
  const service = createFanslyNewcomers({
    api: world.api,
    now: () => Date.now(),
    uuid: () => `00000000-0000-4000-8000-${String((uuid += 1)).padStart(12, '0')}`,
    sleep: (ms, signal) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      }),
    emit: (tab, change) => {
      expect(FANSLY_TAB_EVENTS['fansly.followers.changed'].payload.safeParse(change).success).toBe(true);
      heard.push({ tab, change });
    },
    alive: () => true,
    tabOn: options.tabOn ?? (() => true),
    local: kv.open(),
    ...(options.journal === undefined ? {} : { journal: options.journal }),
    ...(options.onHistory === undefined ? {} : { onHistory: options.onHistory }),
  });
  const ask = async <T extends keyof typeof FANSLY_TAB_REQUESTS>(type: T, payload: unknown, tab = TAB): Promise<FanslyTabResponsePayload<T>> => {
    expect(FANSLY_TAB_REQUESTS[type].req.safeParse(payload).success, `${type} request`).toBe(true);
    const answer = await service.answer(type, payload, tab);
    expect(FANSLY_TAB_REQUESTS[type].res.safeParse(answer).success, `${type} answer`).toBe(true);
    return answer as FanslyTabResponsePayload<T>;
  };
  const scan = async (windowHours = 48, tab = TAB): Promise<string> => {
    const answer = await ask('fansly.followers.scan', { hostAccountId: C, windowHours }, tab);
    if (!answer.ok) throw new Error('the scan was refused');
    return answer.pass.passId;
  };
  const settle = async (): Promise<void> => {
    await service.idle();
    await vi.advanceTimersByTimeAsync(COOLING_LOOK_MS + 1);
  };
  const rows = async (passId: string): Promise<FanslyFollowerRow[]> => (await ask('fansly.followers.read', { passId, offset: 0, limit: 500 })).rows;
  const row = async (passId: string, fan: string): Promise<FanslyFollowerRow> => (await rows(passId)).find((entry) => entry.fanRef === fan) as FanslyFollowerRow;
  const routes = (): string[] => world.calls.map((call) => call.route);
  /** Lets the work run (its calls answer at once) until `done` holds. */
  const until = async (done: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !done(); i += 1) await vi.advanceTimersByTimeAsync(1);
    expect(done()).toBe(true);
  };
  const creates = (): string[] => world.calls.filter((call) => call.route === 'group.create').map((call) => (call.body as { users: { userId: string }[] }).users[0]?.userId ?? '');
  return { world, service, kv, heard, ask, scan, settle, rows, row, routes, until, creates };
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('[host:fansly] the pass of «Новые» in the background (R20 P10b1)', () => {
  it('[NF-029] [FS-NEW-5] journals phases, calls, pagination, classifications, verdicts and cache use by id; no conversation or profile text', async () => {
    const records: Array<{ event: PassJournalEvent; fields: PassJournalFields | undefined }> = [];
    const start = vi.fn<PassJournal['start']>(() => (event, fields) => { records.push({ event, fields }); });
    const t = setup({ journal: { start } });
    const fan = t.world.follow(1, T0 - minutes(5), { notes: false, name: 'PRIVATE NAME' });
    const group = t.world.chat(fan, [{ from: 'fan', content: 'PRIVATE MESSAGE' }, { from: 'model', type: 2, content: 'PRIVATE AUTOMATION' }]);
    const passId = await t.scan();
    await t.settle();
    await t.ask('fansly.followers.history', { passId, fanRef: fan, before: null, limit: 10 });
    expect(start).toHaveBeenCalledWith({ passId, hostAccountId: C, startedAt: T0, windowHours: 48 });
    expect(start).toHaveBeenCalledTimes(1);
    expect(records.map((record) => record.event)).toEqual(expect.arrayContaining(['pass.start', 'pass.phase', 'call.start', 'call.end', 'welcome.refresh', 'followers.page', 'inbox.page', 'profiles.batch', 'chat.reuse', 'history.page', 'message.classify', 'row.verdict', 'pass.end', 'history.cache']));
    expect(records.find((record) => record.event === 'row.verdict' && record.fields?.status === 'ready')?.fields).toMatchObject({ fanRef: fan, groupId: group.id, status: 'ready', reason: 'history-start' });
    expect(records).toContainEqual({ event: 'message.classify', fields: { fanRef: fan, groupId: group.id, messageId: group.messages[0]?.id, classification: 'fan' } });
    expect(JSON.stringify(records)).not.toMatch(/PRIVATE|Thanks|about 1|fan_1/);
  });

  it('[NF-029] [FS-NEW-5] records a failed call and the stopped pass by code, never the thrown error text; a broken journal cannot break a scan', async () => {
    const events: Array<{ event: PassJournalEvent; fields: PassJournalFields | undefined }> = [];
    const t = setup({ journal: { start: () => (event, fields) => { events.push({ event, fields }); } } });
    t.world.failures.set('message.automated', new Error('PRIVATE ERROR'));
    const passId = await t.scan();
    await t.settle();
    expect((await t.ask('fansly.followers.read', { passId, offset: 0, limit: 10 })).pass?.state).toBe('stopped');
    expect(events.find((record) => record.event === 'call.failed')?.fields).toMatchObject({ route: 'message.automated', code: 'CG-FAN-REQUEST' });
    expect(events).toContainEqual({ event: 'pass.stop', fields: { code: 'CG-FAN-REQUEST', total: 0 } });
    expect(JSON.stringify(events)).not.toContain('PRIVATE ERROR');
    const broken = setup({ journal: { start: () => () => { throw new Error('journal failed'); } } });
    const second = await broken.scan();
    await broken.settle();
    expect((await broken.ask('fansly.followers.read', { passId: second, offset: 0, limit: 10 })).pass?.state).toBe('done');
  });

  it('[FS-NEW-4] [NF-030] [NF-031] nothing is asked before a window scans; then the welcome texts, the period’s followers by the moment in their follow id, the inbox, the profiles with the creator’s own names', async () => {
    const t = setup();
    const a = t.world.follow(1, T0 - minutes(5), { custom: 'Lucky' });
    const b = t.world.follow(2, T0 - minutes(60), { notes: false });
    t.world.follow(3, T0 - minutes(60 * 50));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.world.calls).toEqual([]);

    const passId = await t.scan(48);
    await t.settle();
    expect(t.routes().slice(0, 3)).toEqual(['message.automated', 'followers.new', 'messaging.groups']);
    expect(t.world.calls[1]?.query).toEqual({ before: '0', after: '0', limit: '100', offset: '0', search: '', lastSeenAfter: '' });
    // A profile without the creator's notes is read by id (one batch of 100); the other came with the page.
    expect(t.world.calls.filter((call) => call.route === 'account.byIds').map((call) => call.query?.['ids'])).toEqual([b]);
    const list = await t.rows(passId);
    // Newest followed first; the one outside 48 hours is not in the list.
    expect(list.map((entry) => entry.fanRef)).toEqual([a, b]);
    expect(list[0]).toMatchObject({ username: 'fan_1', displayName: 'Fan 1', bio: 'about 1', customName: 'Lucky', followedAt: new Date(T0 - minutes(5)).toISOString() });
    expect(list[1]).toMatchObject({ customName: null });
    // The changes went to the window’s tab, in order.
    expect(t.heard.every((entry) => entry.tab === TAB)).toBe(true);
    expect(t.heard.map((entry) => entry.change.seq)).toEqual(t.heard.map((_, i) => i + 1));
    const read = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 });
    expect([read.total, read.rows.length, read.seq]).toEqual([2, 1, t.heard.length]);
    // The window's search, tab and filter go over the whole pass before the page; the counts after the search.
    const found = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 100, query: { search: '@FAN_2', tab: 'all', filter: 'any' } });
    expect([found.rows.map((entry) => entry.fanRef), found.total, found.counts?.tabs, found.counts?.filters.ready]).toEqual([[b], 1, { todo: 1, all: 1 }, 1]);
    const none = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 100, query: { search: '', tab: 'todo', filter: 'contacted' } });
    expect([none.rows, none.total, none.counts?.filters.any]).toEqual([[], 0, 2]);
  });

  it('[NF-030] the list: 100 a page by `before` up to 20 pages; a period Fansly did not let be read to its end is «неполный»', async () => {
    const t = setup();
    for (let i = 0; i < 2100; i += 1) t.world.follow(i, T0 - 1000 - i * 1000);
    const release = t.world.hold('group.create');
    const passId = await t.scan(720);
    await t.until(() => t.routes().includes('group.create'));
    await t.ask('fansly.followers.pause', { passId });
    release();
    await t.settle();
    const pages = t.world.calls.filter((call) => call.route === 'followers.new');
    expect(pages).toHaveLength(20);
    expect(pages.slice(1).map((call) => call.query?.['before'])).toEqual(Array.from({ length: 19 }, (_, i) => t.world.follows[(i + 1) * 100 - 1]?.id));
    const read = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 });
    expect([read.total, read.pass?.partial, read.pass?.state]).toEqual([2000, true, 'paused']);
  });

  it('[NF-030] [NF-025] a failed follower page stays incomplete with its warning; continuing retries that page before checking the whole list', async () => {
    const t = setup();
    for (let i = 0; i < 101; i += 1) t.world.follow(i, T0 - minutes(i + 1));
    const call = t.world.api.call.bind(t.world.api);
    let broken = true;
    vi.spyOn(t.world.api, 'call').mockImplementation(async (request) => {
      const response = await call(request);
      if (request.route === 'followers.new' && request.query?.['before'] !== '0' && broken) throw new ApiError('network', 'CG-FAN-REQUEST');
      return response;
    });
    const passId = await t.scan();
    await t.settle();
    const read = () => t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 });
    expect((await read()).pass).toMatchObject({ state: 'stopped', partial: true, error: { code: 'CG-FAN-REQUEST' }, counts: { total: 100, checked: 0 } });

    // Continuing while the network is still broken cannot turn 100 of 101 into a complete list.
    expect(await t.ask('fansly.followers.resume', { passId })).toMatchObject({ ok: true, pass: { partial: true, error: { code: 'CG-FAN-REQUEST' } } });
    await t.settle();
    expect((await read()).pass).toMatchObject({ state: 'stopped', partial: true, error: { code: 'CG-FAN-REQUEST' }, counts: { total: 100 } });

    broken = false;
    const release = t.world.hold('followers.new');
    await t.ask('fansly.followers.resume', { passId });
    await t.until(() => t.routes().filter((route) => route === 'followers.new').length === 4);
    expect((await read()).pass).toMatchObject({ state: 'scanning', partial: true, error: { code: 'CG-FAN-REQUEST' }, counts: { total: 100 } });
    release();
    await t.settle();
    expect((await read()).pass).toMatchObject({ state: 'done', partial: false, error: null, counts: { total: 101, checked: 101 } });
    expect(t.world.calls.filter((request) => request.route === 'followers.new').map((request) => request.query?.['before'])).toEqual(['0', ...Array<string>(3).fill(t.world.follows[99]?.id as string)]);
  });

  it.each(['full', 'thin', 'no'] as const)('[NF-032] [FS-NEW-7] a known lastMessageId survives a %s inbox entry and a thin group; lagging empty or older history gives no proof', async (inInbox) => {
    const t = setup();
    const fan = t.world.follow(1, T0 - minutes(5));
    const group = t.world.chat(fan, [{ from: 'fan' }, { from: 'fan' }], inInbox);
    const lastMessageId = group.messages.at(-1)?.id;
    const call = t.world.api.call.bind(t.world.api);
    let lag: 'empty' | 'older' | null = 'empty';
    vi.spyOn(t.world.api, 'call').mockImplementation(async (request) => {
      const response = (await call(request)) as Record<string, unknown>;
      if (request.route === 'messaging.groups') {
        const aggregation = response['aggregationData'] as { groups: Record<string, unknown>[] };
        return { ...response, aggregationData: { ...aggregation, groups: aggregation.groups.map((entry) => ({ ...entry, lastMessage: null })) } };
      }
      // A thin lead's confirmation has no last message; a get-or-create carries only its id.
      if (request.route === 'group.detail' || request.route === 'group.create') return { ...response, lastMessage: null, ...(request.route === 'group.create' ? { lastMessageId } : {}) };
      if (request.route === 'message.history' && lag !== null) {
        return { messages: lag === 'older' && request.query?.['before'] === undefined ? [{ ...group.messages[0], groupId: group.id }] : [] };
      }
      return response;
    });
    const passId = await t.scan();
    await t.settle();
    const unproven = async () => {
      expect(await t.row(passId, fan)).toMatchObject({ status: 'failed', error: { code: 'CG-FNEW-HISTORY' }, historyRevision: null });
      expect(t.service.proof(passId, fan)).toBeNull();
    };
    await unproven();
    // Reaching the start of an older prefix still does not cover the known newest message.
    lag = 'older';
    await t.ask('fansly.followers.resume', { passId });
    await t.settle();
    await unproven();
    lag = null;
    await t.ask('fansly.followers.resume', { passId });
    await t.settle();
    expect(await t.row(passId, fan)).toMatchObject({ status: 'ready', fanWrote: true });
    expect(t.service.proof(passId, fan)?.startProof).toMatchObject({ coveredCount: 2, personalCount: 2 });
  });

  it('[FS-NEW-4] [NF-038] two tabs share the live pass after either changes its period: the old pass ends, and its tab can read, pause, continue and read the conversation', async () => {
    const t = setup();
    const fan = t.world.follow(1, T0 - minutes(5));
    t.world.chat(fan, [{ from: 'fan' }], 'no');
    const welcome = t.world.hold('message.automated');
    const creating = t.world.hold('group.create');
    const oldId = await t.scan(48);
    expect(await t.scan(48, OTHER_TAB)).toBe(oldId);
    const liveId = await t.scan(24, OTHER_TAB);
    expect(liveId).not.toBe(oldId);
    expect(t.heard.filter((entry) => entry.tab === TAB && entry.change.pass.passId === oldId).at(-1)?.change.pass).toMatchObject({ state: 'stopped', error: { code: 'CG-CONTEXT-CHANGED' } });
    const read = () => t.ask('fansly.followers.read', { passId: oldId, offset: 0, limit: 10 });
    expect((await read()).pass).toMatchObject({ passId: liveId, windowHours: 24 });
    // A stale id is a redirect only for the window that actually held it.
    expect((await t.ask('fansly.followers.read', { passId: oldId, offset: 0, limit: 10 }, 'tab-3')).pass).toBeNull();
    welcome();
    await t.until(() => t.creates().length === 1);
    expect((await t.ask('fansly.followers.pause', { passId: oldId })).pass).toMatchObject({ passId: liveId, state: 'paused' });
    creating();
    await t.settle();
    expect(await t.ask('fansly.followers.resume', { passId: oldId })).toMatchObject({ ok: true, pass: { passId: liveId, state: 'queue' } });
    await t.settle();
    expect((await read()).pass).toMatchObject({ passId: liveId, state: 'done', counts: { total: 1, checked: 1 } });
    expect(await t.ask('fansly.followers.history', { passId: oldId, fanRef: fan, before: null, limit: 10 })).toMatchObject({ ok: true, messages: [{ fromFan: true }] });
    for (const tab of [TAB, OTHER_TAB]) expect(t.heard.some((entry) => entry.tab === tab && entry.change.pass.passId === liveId && entry.change.pass.state === 'done')).toBe(true);
    expect(await t.ask('fansly.followers.close', { passId: oldId })).toEqual({ recorded: true });
    expect((await read()).pass).toBeNull();
    expect(t.service.proof(oldId, fan)).toBeNull();
  });

  it('[NF-032] [NF-033] the check: the participants’ fence, the history to its empty page; automation is not personal; a personal message of the creator’s is «Уже писали»; the start proof counts the last 30', async () => {
    const t = setup();
    const ready = t.world.follow(1, T0 - minutes(5));
    const automated = t.world.follow(2, T0 - minutes(6));
    const greeted = t.world.follow(3, T0 - minutes(7));
    const thin = t.world.follow(4, T0 - minutes(8));
    const stranger = t.world.follow(5, T0 - minutes(9));
    const long = t.world.follow(6, T0 - minutes(10));
    t.world.chat(ready, [{ from: 'fan', content: 'hi' }]);
    const auto = t.world.chat(automated, [
      { from: 'model', type: 2 },
      { from: 'model', correlationId: '800000000000000001' },
      { from: 'model', content: 'Thanks for the follow' },
    ]);
    t.world.chat(greeted, [{ from: 'model', content: 'Thanks for the follow' }, { from: 'fan' }, { from: 'model', content: 'hey, personal', correlationId: '800000000000000002', inReplyTo: '800000000000000003' }, { from: 'fan' }]);
    t.world.chat(thin, [], 'thin');
    const odd = t.world.chat(stranger, [{ from: 'fan' }]);
    odd.users = [C, fanId(99)];
    odd.inInbox = 'thin';
    // 40 messages: the fan's (personal) and automated ones of the creator's, in turn.
    t.world.chat(long, Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? { from: 'fan' as const } : { from: 'model' as const, type: 2 })));
    const passId = await t.scan();
    await t.settle();

    const view = async (fan: string) => t.row(passId, fan);
    const readyRow = await view(ready);
    expect(readyRow).toMatchObject({ status: 'ready', fanWrote: true });
    expect([typeof readyRow.historyRevision, typeof readyRow.groupId]).toEqual(['string', 'string']);
    // type 2, a correlationId without a reply, a welcome text (whitespace folded): automated — «Не писали».
    expect(await view(automated)).toMatchObject({ status: 'ready', fanWrote: false });
    const proof = t.service.proof(passId, automated);
    expect(StartProofV1Schema.safeParse(proof?.startProof).success).toBe(true);
    expect(proof?.startProof).toMatchObject({ source: 'pass-empty-page', groupId: auto.id, startWitnessId: auto.messages[0]?.id, coveredCount: 3, personalCount: 0, automatedIds: auto.messages.map((m) => m.id) });
    expect(proof?.window).toEqual(auto.messages.map((m) => ({ id: m.id, dir: 'model' })));
    // A reply that carries a correlationId is still personal.
    expect(await view(greeted)).toMatchObject({ status: 'greeted', historyRevision: null, proof: { text: 'hey, personal', fromFan: false, automated: false } });
    expect(t.service.proof(passId, greeted)).toBeNull();
    // A thin inbox entry is confirmed by GET /group before anything is decided.
    expect(t.world.calls.some((call) => call.route === 'group.detail' && call.path?.['group'] !== undefined)).toBe(true);
    expect(await view(thin)).toMatchObject({ status: 'ready', fanWrote: false });
    expect(t.service.proof(passId, thin)?.startProof).toMatchObject({ startWitnessId: null, coveredCount: 0, personalCount: 0 });
    // A group whose users are not the two is no fact: the fan is not checked.
    expect(await view(stranger)).toMatchObject({ status: 'failed', error: { code: 'CG-FAN-GROUP' }, historyRevision: null });
    // 40 messages walked, the personal ones counted among the last 30 only.
    const longProof = t.service.proof(passId, long);
    expect([longProof?.startProof.coveredCount, longProof?.startProof.personalCount, longProof?.startProof.automatedIds.length, longProof?.window.length]).toEqual([40, 15, 20, 40]);
    // Every history read asked 25 a page, the pages by `before`.
    const reads = t.world.calls.filter((call) => call.route === 'message.history');
    expect(reads.every((call) => call.query?.['limit'] === '25')).toBe(true);
    expect(reads.some((call) => call.query?.['before'] !== undefined)).toBe(true);
  });

  it('[NF-032] a history not read to its end proves nothing: an empty first page of a chat with a last message, or 30 pages without the end — «Не удалось проверить»', async () => {
    const t = setup();
    const endless = t.world.follow(1, T0 - minutes(5));
    t.world.chat(endless, Array.from({ length: 30 * 25 + 5 }, () => ({ from: 'fan' as const })));
    const passId = await t.scan();
    await t.settle();
    expect(await t.row(passId, endless)).toMatchObject({ status: 'failed', error: { code: 'CG-FNEW-HISTORY' }, historyRevision: null });
    expect(t.world.calls.filter((call) => call.route === 'message.history')).toHaveLength(30);
    expect(t.service.proof(passId, endless)).toBeNull();
  });

  it('[NF-039] the queue: a fan the inbox did not name gets `POST /group` — get-or-create, once — and then the same check; the inbox’s fans first', async () => {
    const t = setup();
    const known = t.world.follow(1, T0 - minutes(5));
    const hidden = t.world.follow(2, T0 - minutes(6));
    const fresh = t.world.follow(3, T0 - minutes(7));
    t.world.chat(known, [{ from: 'fan' }]);
    t.world.chat(hidden, [{ from: 'model', content: 'old personal' }], 'no');
    t.world.failures.set(`group.create:${fresh}`, new ApiError('http', 'CG-FAN-REQUEST'));
    const passId = await t.scan();
    await t.settle();
    const creates = t.world.calls.filter((call) => call.route === 'group.create');
    expect(creates.map((call) => (call.body as { users: { userId: string }[] }).users.map((user) => user.userId))).toEqual([
      [hidden, C],
      [fresh, C],
    ]);
    expect(creates[0]?.body).toEqual({ users: [{ userId: hidden, permissionFlags: 0 }, { userId: C, permissionFlags: 0 }], recipients: [], lastMessage: null, userSettings: null, type: 1 });
    // The known chat was checked before the queue asked anything.
    expect(t.world.calls.findIndex((call) => call.query?.['groupId'] !== undefined)).toBeLessThan(t.world.calls.findIndex((call) => call.route === 'group.create'));
    expect(await t.row(passId, hidden)).toMatchObject({ status: 'greeted' });
    // One attempt: a POST that failed is the row's failure, never asked again in the pass.
    expect(await t.row(passId, fresh)).toMatchObject({ status: 'failed', error: { code: 'CG-FAN-REQUEST' } });
    const done = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 });
    expect([done.pass?.state, done.pass?.counts]).toEqual(['done', { total: 3, checked: 2, ready: 1, greeted: 1, dmClosed: 0, excluded: 0 }]);
  });

  it('[NF-038] «Пауза» stops the queue after the request in flight; «Проверить оставшихся» checks the rest; «Проверить следующим» puts a fan first; «Проверить чат» on a standing queue checks that fan alone', async () => {
    const t = setup();
    const fans = [1, 2, 3, 4, 5].map((n) => t.world.follow(n, T0 - minutes(n)));
    const welcome = t.world.hold('message.automated');
    let creating = t.world.hold('group.create');
    const passId = await t.scan();
    // While the list itself is read there is nothing to pause yet.
    expect((await t.ask('fansly.followers.pause', { passId })).pass?.state).toBe('scanning');
    welcome();
    // In the queue, the first POST /group in flight: «Пауза».
    await t.until(() => t.creates().length === 1);
    expect((await t.ask('fansly.followers.pause', { passId })).pass?.state).toBe('paused');
    creating();
    await t.settle();
    expect((await t.rows(passId)).map((entry) => entry.status)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
    expect(t.creates()).toEqual([fans[0]]);

    // «Проверить чат»: the third fan alone, now; the queue stands again.
    expect(await t.ask('fansly.followers.prioritize', { passId, fanRef: fans[2] })).toEqual({ recorded: true });
    await t.settle();
    expect((await t.row(passId, fans[2] as string)).status).toBe('ready');
    const standing = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 });
    expect([standing.pass?.state, standing.pass?.counts.checked]).toEqual(['paused', 1]);

    // «Проверить оставшихся» (the first fan's chat came back after the pause: no second POST), and «Проверить
    // следующим» for the last fan while the second one's POST is in flight.
    creating = t.world.hold('group.create');
    expect(await t.ask('fansly.followers.resume', { passId })).toMatchObject({ ok: true, pass: { state: 'queue' } });
    await t.until(() => t.creates().length === 3);
    expect(await t.ask('fansly.followers.prioritize', { passId, fanRef: fans[4] })).toEqual({ recorded: true });
    creating();
    await t.settle();
    expect(t.creates()).toEqual([fans[0], fans[2], fans[1], fans[4], fans[3]]);
    expect((await t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 })).pass).toMatchObject({ state: 'done', counts: { checked: 5 } });
    // A fan already checked is not asked about again.
    expect(await t.ask('fansly.followers.prioritize', { passId, fanRef: fans[0] })).toEqual({ recorded: false });
  });

  it('[NF-038] [FS-NEW-4] a cooldown of the creator’s lane: the pass says `cooldown` with its end — the window’s banner — and goes on by itself, through the pacer', async () => {
    const t = setup();
    const fan = t.world.follow(1, T0 - minutes(5));
    t.world.setCooling(T0 + 30_000);
    const passId = await t.scan();
    await vi.advanceTimersByTimeAsync(10);
    const cooling = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 });
    expect([cooling.pass?.state, cooling.pass?.cooldownUntil]).toEqual(['cooldown', T0 + 30_000]);
    expect(t.heard.some((entry) => entry.change.pass.state === 'cooldown' && entry.change.pass.cooldownUntil === T0 + 30_000)).toBe(true);
    // `POST /group` was refused at once (it never left) and waits the cooldown out.
    expect(t.world.calls.filter((call) => call.route === 'group.create')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(31_000);
    await t.settle();
    expect(await t.row(passId, fan)).toMatchObject({ status: 'ready' });
    const done = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 });
    expect([done.pass?.state, done.pass?.cooldownUntil]).toEqual(['done', null]);
  });

  it('[FS-NEW-4] the window’s identity: a tab on another account gets no pass; a closed window stops the work; a session Fansly refused stops it at once; five failures in a row stop it', async () => {
    const other = setup({ tabOn: (tab) => tab === TAB });
    expect(await other.ask('fansly.followers.scan', { hostAccountId: C, windowHours: 48 }, OTHER_TAB)).toEqual({ ok: false, error: { code: 'CG-FNEW-ACCOUNT' } });
    other.world.follow(1, T0 - minutes(1));
    const release = other.world.hold('message.automated');
    const passId = await other.scan();
    expect(await other.ask('fansly.followers.read', { passId, offset: 0, limit: 10 }, OTHER_TAB)).toEqual({ pass: null, rows: [], total: 0 });
    expect(await other.ask('fansly.followers.close', { passId })).toEqual({ recorded: true });
    release();
    await other.settle();
    expect(other.world.calls).toHaveLength(1);

    const expired = setup();
    expired.world.follow(1, T0 - minutes(1));
    expired.world.failures.set('followers.new', new ApiError('expired', 'CG-FAN-EXPIRED'));
    const stopped = await expired.scan();
    await expired.settle();
    expect((await expired.ask('fansly.followers.read', { passId: stopped, offset: 0, limit: 1 })).pass).toMatchObject({ state: 'stopped', error: { code: 'CG-FAN-EXPIRED' } });

    const failing = setup();
    for (let n = 1; n <= 7; n += 1) failing.world.follow(n, T0 - minutes(n));
    failing.world.failures.set('group.create', new ApiError('http', 'CG-FAN-REQUEST'));
    const fused = await failing.scan();
    await failing.settle();
    expect(failing.world.calls.filter((call) => call.route === 'group.create')).toHaveLength(5);
    expect((await failing.ask('fansly.followers.read', { passId: fused, offset: 0, limit: 1 })).pass).toMatchObject({ state: 'stopped', error: { code: 'CG-FAN-REQUEST' } });
  });

  it('[NF-010] the card’s conversation: newest first from what the pass read, older pages read again by `before`', async () => {
    const t = setup();
    const fan = t.world.follow(1, T0 - minutes(5));
    const group = t.world.chat(fan, [{ from: 'fan', content: 'one' }, { from: 'fan', content: 'two' }, { from: 'model', content: 'Thanks for the follow' }]);
    const pending = t.world.follow(2, T0 - minutes(6));
    t.world.failures.set(`group.create:${pending}`, new ApiError('http', 'CG-FAN-REQUEST'));
    const passId = await t.scan();
    await t.settle();
    const first = await t.ask('fansly.followers.history', { passId, fanRef: fan, before: null, limit: 2 });
    expect(first).toMatchObject({ ok: true, more: true });
    if (!first.ok) throw new Error('no conversation');
    expect(first.messages.map((m) => [m.text, m.automated])).toEqual([
      ['Thanks for the follow', true],
      ['two', false],
    ]);
    const older = await t.ask('fansly.followers.history', { passId, fanRef: fan, before: group.messages[1]?.id, limit: 2 });
    if (!older.ok) throw new Error('no older conversation');
    expect([older.messages.map((m) => m.text), older.more]).toEqual([['one'], false]);
    // A fan whose chat the pass did not find has no conversation to show.
    expect(await t.ask('fansly.followers.history', { passId, fanRef: pending, before: null, limit: 2 })).toEqual({ ok: false, error: { code: 'CG-FNEW-UNVERIFIED' } });
  });
});

/** Fansly's metadata: a JSON object whose values are JSON strings. */
const dmMeta = (byFlag: Record<number, unknown>): string => JSON.stringify(Object.fromEntries(Object.entries(byFlag).map(([flag, value]) => [flag, JSON.stringify(value)])));
const PAID = { rules: [{ flags: 1, metadata: dmMeta({ 1: { price: 1700 } }), verificationFlags: 0, verificationMetadata: '{}' }] };
/** The stand's rule: «follow the fan», not met. */
const FOLLOW_FAN = { rules: [{ flags: 2, metadata: '{}', verificationFlags: 0, verificationMetadata: '{}' }] };
const OPEN = { rules: [{ flags: 16, metadata: '', verificationFlags: 16, verificationMetadata: '{}' }] };

describe('[host:fansly] «Нельзя написать» and «Исключить из очереди» in the background (R20 P10b2)', () => {
  it('[FX-003] [FS-NEW-2] the group’s own DM rules decide «Нельзя написать» in the check — a paid DM or rules the creator does not meet —, before anything is generated or sent: no proof to greet with; a personal message of the creator’s still wins', async () => {
    const t = setup();
    const paid = t.world.follow(1, T0 - minutes(5));
    const rules = t.world.follow(2, T0 - minutes(6));
    const open = t.world.follow(3, T0 - minutes(7));
    const greeted = t.world.follow(4, T0 - minutes(8));
    const created = t.world.follow(5, T0 - minutes(9));
    const thin = t.world.follow(6, T0 - minutes(10));
    t.world.chat(paid, [{ from: 'fan', content: 'hi' }]).dm = PAID;
    t.world.chat(rules, []).dm = FOLLOW_FAN;
    t.world.chat(open, [{ from: 'fan' }]).dm = OPEN;
    t.world.chat(greeted, [{ from: 'fan' }, { from: 'model', content: 'hey, personal' }]).dm = PAID;
    // The inbox's thin entry carries no rules; `GET /group` does.
    t.world.chat(thin, [], 'thin').dm = FOLLOW_FAN;
    // Not in the inbox: the queue's `POST /group` answers the rules too.
    t.world.chat(created, [], 'no').dm = PAID;
    const passId = await t.scan();
    await t.settle();
    expect(t.creates()).toEqual([created]);

    const view = async (fan: string) => t.row(passId, fan);
    expect(await view(paid)).toMatchObject({ status: 'dm-closed', dmClosed: 'paid', dmPriceMills: 1700, historyRevision: null, proof: null });
    expect(await view(rules)).toMatchObject({ status: 'dm-closed', dmClosed: 'permissions', historyRevision: null });
    expect(await view(thin)).toMatchObject({ status: 'dm-closed', dmClosed: 'permissions' });
    expect(await view(created)).toMatchObject({ status: 'dm-closed', dmClosed: 'paid', dmPriceMills: 1700 });
    expect(await view(open)).toMatchObject({ status: 'ready', dmClosed: null, dmPriceMills: null, fanWrote: true });
    expect(await view(greeted)).toMatchObject({ status: 'greeted', dmClosed: null, dmPriceMills: null });
    // Nothing to greet with: the greeting (P10c) takes a proof only of a fan who can be written to.
    expect(t.service.proof(passId, paid)).toBeNull();
    expect(t.service.proof(passId, rules)).toBeNull();
    expect(t.service.proof(passId, open)).not.toBeNull();
    // Only FS-NET-1's `newcomers` routes: nothing is sent, nothing else is asked.
    expect(new Set(t.routes())).toEqual(new Set(['message.automated', 'followers.new', 'messaging.groups', 'group.detail', 'message.history', 'group.create']));
    // «Нельзя написать» stays in «К обработке» until the person takes the fan out; its filter counts it.
    const read = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 100, query: { search: '', tab: 'todo', filter: 'dm-closed' } });
    expect([read.rows.map((entry) => entry.fanRef).sort(), read.counts?.tabs.todo, read.pass?.counts.dmClosed]).toEqual([[paid, rules, thin, created].sort(), 5, 4]);
    // The card's conversation of a closed fan is the one the pass read.
    const history = await t.ask('fansly.followers.history', { passId, fanRef: paid, before: null, limit: 250 });
    expect(history.ok && history.messages.map((message) => message.text)).toEqual(['hi']);
  });

  it('[NF-003] [X57] the period: a window without one opens the period the person chose last — 12 hours before any choice; a choice is kept in this browser; a store that fails gives the default', async () => {
    const kv = createMemoryKv();
    const t = setup({ kv });
    t.world.follow(1, T0 - minutes(5));
    const ask = async (windowHours: number | null): Promise<number> => {
      const answer = await t.ask('fansly.followers.scan', { hostAccountId: C, windowHours });
      if (!answer.ok) throw new Error('the scan was refused');
      return answer.pass.windowHours;
    };
    expect(await ask(null)).toBe(12);
    expect(kv.data.has(NEWCOMERS_WINDOW_KEY)).toBe(false);
    expect(await ask(72)).toBe(72);
    await t.settle();
    expect(kv.data.get(NEWCOMERS_WINDOW_KEY)).toBe(72);
    expect(await ask(null)).toBe(72);
    // Something that is no period is not one.
    kv.data.set(NEWCOMERS_WINDOW_KEY, 9999);
    expect(await ask(null)).toBe(12);
    kv.data.set(NEWCOMERS_WINDOW_KEY, 24);
    kv.failNext('get');
    expect(await ask(null)).toBe(12);
  });

  it('[FX-003] [FS-NEW-2] «Исключить из очереди»: only a fan nobody can write to leaves «К обработке» — kept in this browser, back by «Вернуть в очередь»; nothing is asked of Fansly', async () => {
    const kv = createMemoryKv();
    const t = setup({ kv });
    const closed = t.world.follow(1, T0 - minutes(5));
    const open = t.world.follow(2, T0 - minutes(6));
    t.world.chat(closed, [{ from: 'fan' }]).dm = PAID;
    t.world.chat(open, [{ from: 'fan' }]).dm = OPEN;
    const passId = await t.scan();
    await t.settle();
    const calls = t.world.calls.length;
    const heard = t.heard.length;
    const todo = async (): Promise<number | undefined> => (await t.ask('fansly.followers.read', { passId, offset: 0, limit: 100, query: { search: '', tab: 'todo', filter: 'any' } })).counts?.tabs.todo;
    expect(await todo()).toBe(2);

    // A fan who can be written to is not taken out; neither is a fan of another pass.
    expect(await t.ask('fansly.followers.exclude', { passId, fanRef: open, excluded: true })).toEqual({ recorded: false });
    expect(await t.ask('fansly.followers.exclude', { passId: '00000000-0000-4000-8000-000000000999', fanRef: closed, excluded: true })).toEqual({ recorded: false });
    expect(await t.ask('fansly.followers.exclude', { passId, fanRef: closed, excluded: true })).toEqual({ recorded: true });
    expect(Object.keys(kv.data.get(`${NEWCOMERS_EXCLUDED_PREFIX}${C}.${closed}`) as object)).toEqual(['at']);
    await t.settle();
    expect(await t.row(passId, closed)).toMatchObject({ status: 'excluded', dmClosed: 'paid' });
    expect(await todo()).toBe(1);
    // The window hears it as a change of the row, no poll.
    expect(t.heard.slice(heard).flatMap((entry) => entry.change.rows.map((row) => `${row.fanRef}:${row.status}`))).toEqual([`${closed}:excluded`]);
    expect(t.heard.at(-1)?.change.pass.counts).toMatchObject({ dmClosed: 0, excluded: 1 });

    expect(await t.ask('fansly.followers.exclude', { passId, fanRef: closed, excluded: false })).toEqual({ recorded: true });
    await t.settle();
    expect(await t.row(passId, closed)).toMatchObject({ status: 'dm-closed' });
    expect(kv.data.has(`${NEWCOMERS_EXCLUDED_PREFIX}${C}.${closed}`)).toBe(false);
    expect(await todo()).toBe(2);
    expect(t.world.calls).toHaveLength(calls);

    // A store that could not keep it: nothing changes, the window hears so.
    kv.failNext('set');
    expect(await t.ask('fansly.followers.exclude', { passId, fanRef: closed, excluded: true })).toEqual({ recorded: false });
    expect(await t.row(passId, closed)).toMatchObject({ status: 'dm-closed' });
  });

  it('[FX-003] the exclusion outlives the pass, as the old window kept it, and goes once a check reads the fan’s DMs open', async () => {
    const kv = createMemoryKv();
    const first = setup({ kv });
    const fan = first.world.follow(1, T0 - minutes(5));
    const group = first.world.chat(fan, [{ from: 'fan' }]);
    group.dm = FOLLOW_FAN;
    let passId = await first.scan();
    await first.settle();
    expect(await first.ask('fansly.followers.exclude', { passId, fanRef: fan, excluded: true })).toEqual({ recorded: true });
    first.service.dispose();

    // The next pass (a new event page): the fan is still out of «К обработке».
    const second = setup({ kv });
    second.world.follow(1, T0 - minutes(5));
    const again = second.world.chat(fan, [{ from: 'fan' }]);
    again.dm = FOLLOW_FAN;
    passId = await second.scan();
    await second.settle();
    expect(await second.row(passId, fan)).toMatchObject({ status: 'excluded', dmClosed: 'permissions' });
    second.service.dispose();

    // The fan opened the DMs: the row is workable again and the exclusion is gone.
    const third = setup({ kv });
    third.world.follow(1, T0 - minutes(5));
    third.world.chat(fan, [{ from: 'fan' }]).dm = OPEN;
    passId = await third.scan();
    await third.settle();
    expect(await third.row(passId, fan)).toMatchObject({ status: 'ready', dmClosed: null });
    expect(kv.data.has(`${NEWCOMERS_EXCLUDED_PREFIX}${C}.${fan}`)).toBe(false);
    third.service.dispose();

    // An answer without the rules says nothing about them: a fresh exclusion stays.
    kv.data.set(`${NEWCOMERS_EXCLUDED_PREFIX}${C}.${fan}`, { at: T0 });
    const fourth = setup({ kv });
    fourth.world.follow(1, T0 - minutes(5));
    fourth.world.chat(fan, [{ from: 'fan' }]);
    passId = await fourth.scan();
    await fourth.settle();
    expect(await fourth.row(passId, fan)).toMatchObject({ status: 'ready' });
    expect(kv.data.has(`${NEWCOMERS_EXCLUDED_PREFIX}${C}.${fan}`)).toBe(true);
  });
});

describe('[host:fansly] what the greeting takes of the pass (R20 P10c)', () => {
  const SIGNED = { 'Key-Pair-Id': 'K1', Policy: 'P1', Signature: 'S1' };

  it('[NF-034] [FS-NEW-7] the proof of a checked fan: the window of the history (ids only), the fan’s newest ids, the start, and the avatar of the profile the pass read — the largest variant up to 512 px, signed', async () => {
    const histories: [string, readonly string[], boolean][] = [];
    const t = setup({ onHistory: (groupId, ids, complete) => histories.push([groupId, ids, complete]) });
    const fan = t.world.follow(1, T0 - minutes(5), {
      avatar: {
        location: 'https://cdn3.fansly.com/a/original.jpeg',
        variants: [
          { width: 1080, locations: [{ location: 'https://cdn3.fansly.com/a/1080.jpeg' }] },
          { width: 300, locations: [{ location: 'https://cdn3.fansly.com/a/300.jpeg', metadata: SIGNED }] },
        ],
      },
    });
    const plain = t.world.follow(2, T0 - minutes(6), { avatar: { location: 'http://cdn3.fansly.com/a/insecure.jpeg' } });
    const chat = t.world.chat(fan, [{ from: 'model', type: 2 }, { from: 'fan', content: 'hi' }, { from: 'fan', content: 'there?' }]);
    t.world.chat(plain, [{ from: 'fan' }]);
    const passId = await t.scan();
    await t.settle();
    const row = await t.row(passId, fan);
    const answer = t.service.greetingProof(passId, fan, TAB);
    if (!answer.ok) throw new Error(answer.code);
    expect(FanslyGreetingProofSchema.safeParse(answer.proof).success).toBe(true);
    const [welcome, first, second] = chat.messages.map((message) => message.id);
    expect(answer.proof).toEqual({
      // The conversation is the group, never the fan’s id (FS-IDN-6).
      groupId: chat.id,
      historyRevision: row.historyRevision,
      window: [{ id: welcome, dir: 'model' }, { id: first, dir: 'fan' }, { id: second, dir: 'fan' }],
      knownFanMessageIds: [second, first],
      startProof: { v: 1, source: 'pass-empty-page', groupId: chat.id, startWitnessId: welcome, coveredCount: 3, personalCount: 2, automatedIds: [welcome] },
      fanAvatarUrl: 'https://cdn3.fansly.com/a/300.jpeg?Key-Pair-Id=K1&Policy=P1&Signature=S1',
    });
    expect(chat.id).not.toBe(fan);
    // X57: the row the window shows carries the same picture; an address the hub would refuse is none there too.
    expect(row.avatarUrl).toBe('https://cdn3.fansly.com/a/300.jpeg?Key-Pair-Id=K1&Policy=P1&Signature=S1');
    expect((await t.row(passId, plain)).avatarUrl ?? null).toBeNull();
    // An address the hub would refuse is no avatar.
    const other = t.service.greetingProof(passId, plain, TAB);
    expect(other.ok && other.proof.fanAvatarUrl).toBeNull();
    // Every walked history went to the send: it confirms a receipt its echo never did.
    expect(histories).toContainEqual([chat.id, [welcome, first, second], true]);
    // A tab on another account gets no proof.
    const elsewhere = setup({ tabOn: (tab) => tab !== OTHER_TAB });
    expect(elsewhere.service.greetingProof(passId, fan, OTHER_TAB)).toEqual({ ok: false, code: 'CG-CONTEXT-CHANGED' });
  });

  it('[NF-036] the history is read again right before the custody: the same history keeps its revision, a new message makes a new one, a personal message of the creator’s ends the greeting; after `POST /group` the queue checked the history before the row became ready', async () => {
    const t = setup();
    const fan = t.world.follow(1, T0 - minutes(5));
    const hidden = t.world.follow(2, T0 - minutes(6));
    const chat = t.world.chat(fan, [{ from: 'fan', content: 'hi' }]);
    const passId = await t.scan();
    await t.settle();
    // NF-036 «после POST /group»: the queue’s get-or-create is followed by the same check of that group’s history.
    const created = t.world.calls.findIndex((call) => call.route === 'group.create');
    const hiddenRow = await t.row(passId, hidden);
    const read = t.world.calls.findIndex((call) => call.route === 'message.history' && call.query?.['groupId'] === hiddenRow.groupId);
    expect([created >= 0, read > created, hiddenRow.status, typeof hiddenRow.historyRevision]).toEqual([true, true, 'ready', 'string']);

    const revision = (await t.row(passId, fan)).historyRevision as string;
    expect(t.service.live(passId, fan)).toEqual({ hostAccountId: C, groupId: chat.id, fanRef: fan, historyRevision: revision });
    const before = t.world.calls.length;
    expect(await t.service.recheck(passId, fan, TAB)).toEqual({ ok: true, historyRevision: revision });
    expect(t.world.calls.slice(before).map((call) => call.route)).toContain('message.history');

    chat.messages.push({ id: sf(T0), senderId: fan, type: 1, content: 'are you there?', correlationId: null, inReplyTo: null });
    const changed = await t.service.recheck(passId, fan, TAB);
    expect(changed.ok && changed.historyRevision !== revision).toBe(true);
    expect((await t.row(passId, fan)).historyRevision).toBe(changed.ok ? changed.historyRevision : null);

    chat.messages.push({ id: sf(T0 + 1000), senderId: C, type: 1, content: 'hey you', correlationId: null, inReplyTo: null });
    expect(await t.service.recheck(passId, fan, TAB)).toEqual({ ok: false, code: 'CG-SEND-PART' });
    expect(await t.row(passId, fan)).toMatchObject({ status: 'greeted' });
    expect(t.service.live(passId, fan)).toBeNull();

    // A read that failed leaves the row as it was and refuses with its code.
    t.world.failures.set('message.history', new ApiError('http', 'CG-FAN-REQUEST'));
    expect(await t.service.recheck(passId, hidden, TAB)).toEqual({ ok: false, code: 'CG-FAN-REQUEST' });
    expect(await t.row(passId, hidden)).toMatchObject({ status: 'ready' });
  });

  it('[NF-019] the card’s greeting went: the fan is «Уже писали» at once, with no proof to greet with again', async () => {
    const t = setup();
    const fan = t.world.follow(1, T0 - minutes(5));
    t.world.chat(fan, [{ from: 'fan' }]);
    const passId = await t.scan();
    await t.settle();
    t.service.greeted(C, fan);
    await t.settle();
    expect(await t.row(passId, fan)).toMatchObject({ status: 'greeted', historyRevision: null });
    expect(t.service.greetingProof(passId, fan, TAB)).toEqual({ ok: false, code: 'CG-SEND-PART' });
    expect(t.heard.at(-1)?.change.rows.map((entry) => [entry.fanRef, entry.status])).toContainEqual([fan, 'greeted']);
  });
});
