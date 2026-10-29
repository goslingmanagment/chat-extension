// The background's pass of «Новые» on Fansly (R20 P10b1) against a small scripted Fansly: what it asks, in what
// order, what each row's verdict rests on, and the proof a greeting takes. Every request is
// checked against FS-NET-1's `newcomers` routes as it arrives.

import { FANSLY_TAB_REQUESTS, FANSLY_TAB_EVENTS, type FanslyFollowerRow, type FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { StartProofV1Schema } from '@cg/contracts/fansly';
import { type FanslyGreetingRequest } from '@cg/contracts/send-fansly';
import { FanslyGreetingProofSchema } from '@cg/contracts/tab-messages-fansly';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FANSLY_EPOCH_MS } from '../../../domain/hosts/fansly/newcomers/pass-rules';
import { createMemoryKv, type MemoryKv } from '../../test-support/memory-kv';
import { createFanslyGreeting } from './greeting';
import { type FanslySendStart } from './send';
import { COOLING_LOOK_MS, KNOWN_FLUSH_MS, NEWCOMERS_KNOWN_PREFIX, READY_FRESH_MS, RECHECK_DELAY_MS, SESSION_LOOK_MS, WATCH_MS, createFanslyNewcomers, type FollowersChange, type NewcomersCall, type NewcomersRoute, type PassJournal } from './newcomers';

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
    readonly httpStatus?: number,
  ) {
    super(kind);
  }
  toWire(): { code: string; httpStatus?: number } {
    return this.httpStatus === undefined ? { code: this.code } : { code: this.code, httpStatus: this.httpStatus };
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
  /** The creator's welcome automation, as `/message/automated` names it. */
  let welcome = 'Thanks  for\n the follow';
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
    setWelcome: (text: string) => (welcome = text),
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
            return [{ messageTemplate: JSON.stringify({ content: welcome }) }];
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

  it.each(['no'] as const)('[NF-032] [FS-NEW-7] a known lastMessageId survives a %s inbox entry and a thin group; lagging empty or older history gives no proof', async (inInbox) => {
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

  it('[FS-NEW-4] the window’s identity: a tab on another account gets no pass; a closed window stops the work; a session Fansly refused stops it at once; five failures of Fansly’s in a row stop it', async () => {
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
    failing.world.failures.set('group.create', new ApiError('http', 'CG-FAN-REQUEST', 503));
    const fused = await failing.scan();
    await failing.settle();
    expect(failing.world.calls.filter((call) => call.route === 'group.create')).toHaveLength(5);
    expect((await failing.ask('fansly.followers.read', { passId: fused, offset: 0, limit: 1 })).pass).toMatchObject({ state: 'stopped', error: { code: 'CG-FAN-REQUEST' } });
  });

  it('[FS-NEW-4] the window opened again goes on with the same pass (2026-10-23): nobody it checked is asked about again — only the welcome texts and the followers since its end; the period moves to now; a «Пауза» closed with the window goes on too', async () => {
    const t = setup();
    const ready = t.world.follow(1, T0 - minutes(5));
    // Followed near the period's start: the period moving on takes them out of the list.
    t.world.follow(2, T0 - minutes(48 * 60 - 5));
    const passId = await t.scan();
    await t.settle();
    expect(await t.row(passId, ready)).toMatchObject({ status: 'ready' });
    expect(await t.ask('fansly.followers.close', { passId })).toEqual({ recorded: true });

    await vi.advanceTimersByTimeAsync(minutes(10));
    const fresh = t.world.follow(3, T0 + minutes(8));
    const from = t.world.calls.length;
    const reopened = Date.now();
    expect(await t.scan()).toBe(passId);
    await t.settle();
    const asked = t.world.calls.slice(from);
    expect(asked.map((call) => call.route).filter((route) => route === 'followers.new' || route === 'message.automated')).toEqual(['message.automated', 'followers.new']);
    expect(asked.filter((call) => call.route === 'group.create').map((call) => (call.body as { users: { userId: string }[] }).users[0]?.userId)).toEqual([fresh]);
    const read = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 10 });
    expect(read.rows.map((row) => [row.fanRef, row.status])).toEqual([[fresh, 'ready'], [ready, 'ready']]);
    expect(read.pass?.startedAt).toBe(new Date(reopened).toISOString());

    // «Пауза» belongs to the open window: the window closed and opened again goes on, the paused fan is checked.
    const later = t.world.follow(4, T0 + minutes(12));
    await vi.advanceTimersByTimeAsync(minutes(5));
    const release = t.world.hold('group.create');
    expect(await t.scan()).toBe(passId);
    await t.until(() => t.world.calls.at(-1)?.route === 'group.create');
    await t.ask('fansly.followers.pause', { passId });
    release();
    await t.settle();
    expect((await t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 })).pass?.state).toBe('paused');
    expect(await t.ask('fansly.followers.close', { passId })).toEqual({ recorded: true });
    expect(await t.scan()).toBe(passId);
    await t.settle();
    expect(await t.row(passId, later)).toMatchObject({ status: 'ready' });
    expect((await t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 })).pass?.state).not.toBe('paused');
  });

  it('[FS-NEW-4] the window opened again reads back a little before the period’s end: a follow Fansly dated just before it (its clock behind this machine’s) is read; a fan read again keeps their row and is not asked about', async () => {
    const t = setup();
    const ready = t.world.follow(1, T0 - minutes(2));
    const passId = await t.scan();
    await t.settle();
    const checked = await t.row(passId, ready);
    expect(checked).toMatchObject({ status: 'ready' });
    expect(await t.ask('fansly.followers.close', { passId })).toEqual({ recorded: true });

    // Fansly's clock 3 s behind this machine's: a follow made right after the read carries T0 - 3 s.
    const skewed = t.world.follow(2, T0 - 3000);
    await vi.advanceTimersByTimeAsync(minutes(10));
    const from = t.world.calls.length;
    expect(await t.scan()).toBe(passId);
    await t.settle();
    expect((await t.rows(passId)).map((row) => [row.fanRef, row.status])).toEqual([[skewed, 'ready'], [ready, 'ready']]);
    // The fan read again is the same row: its verdict, and the revision its draft rests on; nothing asked about them.
    expect(await t.row(passId, ready)).toEqual(checked);
    const asked = t.world.calls.slice(from);
    expect(asked.filter((call) => call.route === 'group.create').map((call) => (call.body as { users: { userId: string }[] }).users[0]?.userId)).toEqual([skewed]);
    expect(asked.some((call) => call.query?.['groupId'] === checked.groupId || call.path?.['group'] === checked.groupId)).toBe(false);

    // ⟳ once more: nobody twice.
    await vi.advanceTimersByTimeAsync(minutes(1));
    expect(await t.scan()).toBe(passId);
    await t.settle();
    expect((await t.rows(passId)).map((row) => row.fanRef)).toEqual([skewed, ready]);
  });

  it('[NF-030] a follow Fansly dates more than a minute ahead of this machine’s clock is at the period’s end, never at 0: the list is read to its end with the follower in it; on the window opened again too', async () => {
    const t = setup();
    for (let n = 1; n <= 150; n += 1) t.world.follow(n, T0 - minutes(n));
    // This machine 2 min slow: Fansly dates a follow made just now 2 min ahead of it.
    const ahead = t.world.follow(999, T0 + minutes(2));
    const passId = await t.scan(12);
    await t.settle();
    const read = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 500 });
    expect([read.total, read.pass?.partial]).toEqual([151, false]);
    expect(t.world.calls.filter((call) => call.route === 'followers.new')).toHaveLength(2);
    expect(read.rows[0]).toMatchObject({ fanRef: ahead, followedAt: new Date(T0).toISOString() });

    expect(await t.ask('fansly.followers.close', { passId })).toEqual({ recorded: true });
    await vi.advanceTimersByTimeAsync(minutes(10));
    const next = t.world.follow(1000, Date.now() + minutes(2));
    const reopened = Date.now();
    expect(await t.scan(12)).toBe(passId);
    await t.settle();
    const again = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 500 });
    expect([again.total, again.pass?.partial, again.rows[0]?.fanRef, again.rows[0]?.followedAt]).toEqual([152, false, next, new Date(reopened).toISOString()]);
  });

  it('[FS-NEW-4] a row’s own failure (a 400, an answer that did not parse) is the row’s: seven odd fans do not stop the check, as in the old extension', async () => {
    const t = setup();
    for (let n = 1; n <= 7; n += 1) t.world.follow(n, T0 - minutes(n));
    t.world.failures.set('group.create', new ApiError('http', 'CG-FAN-REQUEST', 400));
    const passId = await t.scan();
    await t.settle();
    expect(t.world.calls.filter((call) => call.route === 'group.create')).toHaveLength(7);
    expect((await t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 })).pass?.state).not.toBe('stopped');
  });

  it('[NF-033] the welcome texts are kept: a read that failed takes the kept ones instead of stopping the pass; with none kept it stops as before', async () => {
    const kv = createMemoryKv();
    const first = setup({ kv });
    first.world.follow(1, T0 - minutes(1));
    await first.scan();
    await first.settle();
    const kept = await kv.open().get([`fansly.newcomers.welcome.${C}`]);
    expect(kept.ok && kept.value[`fansly.newcomers.welcome.${C}`]).toMatchObject({ texts: ['Thanks for the follow'] });

    const again = setup({ kv });
    const fan = again.world.follow(1, T0 - minutes(1));
    again.world.chat(fan, [{ from: 'model', content: 'Thanks for the follow' }]);
    again.world.failures.set('message.automated', new ApiError('network', 'CG-FAN-REQUEST'));
    const passId = await again.scan();
    await again.settle();
    expect((await again.ask('fansly.followers.read', { passId, offset: 0, limit: 1 })).pass?.state).not.toBe('stopped');
    expect(await again.row(passId, fan)).toMatchObject({ status: 'ready', fanWrote: false });

    const fresh = setup();
    fresh.world.follow(1, T0 - minutes(1));
    fresh.world.failures.set('message.automated', new ApiError('network', 'CG-FAN-REQUEST'));
    const stopped = await fresh.scan();
    await fresh.settle();
    expect((await fresh.ask('fansly.followers.read', { passId: stopped, offset: 0, limit: 1 })).pass).toMatchObject({ state: 'stopped' });
  });

  it('[NF-033] the window opened again and ⟳ read the welcome texts again: the text of an automation edited meanwhile is automated, never «Уже писали»; a read that failed takes the kept ones', async () => {
    const t = setup();
    t.world.follow(1, T0 - minutes(5));
    const passId = await t.scan();
    await t.settle();
    expect(await t.ask('fansly.followers.close', { passId })).toEqual({ recorded: true });

    // The creator edits the welcome automation: the next follower gets its new text (type 1, no correlation id).
    t.world.setWelcome('Hey babe,\n welcome to my page');
    await vi.advanceTimersByTimeAsync(minutes(20));
    const fresh = t.world.follow(2, Date.now() - minutes(1));
    t.world.chat(fresh, [{ from: 'model', content: 'Hey babe, welcome to my page' }]);
    const from = t.world.calls.length;
    expect(await t.scan()).toBe(passId);
    await t.settle();
    expect(t.world.calls.slice(from).map((call) => call.route).filter((route) => route === 'followers.new' || route === 'message.automated')).toEqual(['message.automated', 'followers.new']);
    expect(await t.row(passId, fresh)).toMatchObject({ status: 'ready', fanWrote: false });
    expect(t.service.proof(passId, fresh)?.startProof).toMatchObject({ coveredCount: 1, personalCount: 0 });
    // Nothing «Уже писали» was learned of them for the next window.
    await vi.advanceTimersByTimeAsync(KNOWN_FLUSH_MS + 1);
    const book = await t.kv.open().get([`${NEWCOMERS_KNOWN_PREFIX}${C}`]);
    expect(book.ok && (book.value[`${NEWCOMERS_KNOWN_PREFIX}${C}`] as { fans: Record<string, { p?: unknown }> }).fans[fresh]?.p).toBeUndefined();

    // ⟳ while Fansly does not answer the welcome texts: the kept ones (the new text among them) stand, the pass goes on.
    t.world.failures.set('message.automated', new ApiError('network', 'CG-FAN-REQUEST'));
    await vi.advanceTimersByTimeAsync(minutes(1));
    const later = t.world.follow(3, Date.now() - 1000);
    t.world.chat(later, [{ from: 'model', content: 'Hey babe, welcome to my page' }]);
    expect(await t.scan()).toBe(passId);
    await t.settle();
    expect((await t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 })).pass?.state).not.toBe('stopped');
    expect(await t.row(passId, later)).toMatchObject({ status: 'ready', fanWrote: false });
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
});

describe('[host:fansly] what the greeting takes of the pass (R20 P10c)', () => {
  const SIGNED = { 'Key-Pair-Id': 'K1', Policy: 'P1', Signature: 'S1' };

  it('[NF-034] [FS-NEW-7] the proof of a checked fan: the window and confirmed texts of the history, the fan’s newest ids, the start, and the avatar of the profile the pass read — the largest variant up to 512 px, signed', async () => {
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
      // 2026-10-26: the profile's names and «about» too: the hub has not met a new follower yet.
      fanAccount: { username: 'fan_1', displayName: 'Fan 1', about: 'about 1' },
      capturedAt: row.checkedAt,
      tail: chat.messages.map((message, i) => ({ platformMessageId: message.id, direction: message.senderId === C ? 'model' : 'fan', sentAt: new Date(T0 - minutes(500) + i * 1000).toISOString(), text: message.content })),
    });
    expect(chat.id).not.toBe(fan);
    // X59: the row the window shows carries the same picture; an address the hub would refuse is none there too.
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

describe('[host:fansly] «Новые» after the check (2026-10-26: a fan a colleague greeted sat in «Не писали» with an empty card)', () => {
  const personal = (text: string) => ({ id: sf(Date.now()), senderId: C, type: 1, content: text, correlationId: null, inReplyTo: null });
  const reads = (t: ReturnType<typeof setup>, groupId: string, from: number): number =>
    t.world.calls.slice(from).filter((call) => call.route === 'message.history' && call.query?.['groupId'] === groupId).length;

  it('[2026-10-26] while the window is open the inbox is looked at once a minute: only a chat with a message the check did not see is read again, and a colleague’s greeting makes it «Уже писали»', async () => {
    const t = setup();
    const fan = t.world.follow(1, T0 - minutes(5));
    const quiet = t.world.follow(2, T0 - minutes(6));
    const chat = t.world.chat(fan, [], 'full');
    const quietChat = t.world.chat(quiet, [], 'full');
    const passId = await t.scan();
    await t.settle();
    expect((await t.rows(passId)).map((row) => row.status)).toEqual(['ready', 'ready']);

    chat.messages.push(personal('hi, welcome ♡ nice to see a new face here'));
    const before = t.world.calls.length;
    await vi.advanceTimersByTimeAsync(WATCH_MS);
    await t.settle();
    expect(await t.row(passId, fan)).toMatchObject({ status: 'greeted' });
    expect(await t.row(passId, quiet)).toMatchObject({ status: 'ready' });
    expect([t.world.calls.slice(before).filter((call) => call.route === 'messaging.groups').length, reads(t, chat.id, before), reads(t, quietChat.id, before)]).toEqual([1, 1, 0]);

    // Nothing new: the next look reads no chat.
    const after = t.world.calls.length;
    await vi.advanceTimersByTimeAsync(WATCH_MS);
    await t.settle();
    expect(t.world.calls.slice(after).map((call) => call.route)).toEqual(['messaging.groups']);

    // The last window closed: no more looks.
    await t.ask('fansly.followers.close', { passId });
    const closed = t.world.calls.length;
    await vi.advanceTimersByTimeAsync(WATCH_MS * 3);
    expect(t.world.calls.length).toBe(closed);
  });

  it('[2026-10-26] a check older than a couple of minutes is made again before the card shows the chat and before a Hi takes it; a fresh one is not', async () => {
    const t = setup();
    const carded = t.world.follow(1, T0 - minutes(5));
    const hi = t.world.follow(2, T0 - minutes(6));
    const fresh = t.world.follow(3, T0 - minutes(7));
    // Chats the inbox does not list: only the card and the Hi can see what changed.
    const cardChat = t.world.chat(carded, [], 'no');
    const hiChat = t.world.chat(hi, [], 'no');
    const freshChat = t.world.chat(fresh, [], 'no');
    const passId = await t.scan();
    await t.settle();
    const start = t.world.calls.length;
    expect(await t.ask('fansly.followers.history', { passId, fanRef: fresh, before: null, limit: 25 })).toMatchObject({ ok: true, messages: [] });
    expect((await t.service.freshProof(passId, fresh, TAB)).ok).toBe(true);
    expect(reads(t, freshChat.id, start)).toBe(0);

    await vi.advanceTimersByTimeAsync(READY_FRESH_MS + 1000);
    cardChat.messages.push(personal('hey you'));
    hiChat.messages.push(personal('heyy, thanks for the follow'));
    const history = await t.ask('fansly.followers.history', { passId, fanRef: carded, before: null, limit: 25 });
    expect(history.ok && history.messages.map((message) => message.text)).toEqual(['hey you']);
    expect(await t.row(passId, carded)).toMatchObject({ status: 'greeted' });
    expect(await t.service.freshProof(passId, hi, TAB)).toEqual({ ok: false, code: 'CG-SEND-PART' });
    expect(await t.row(passId, hi)).toMatchObject({ status: 'greeted' });
    // Checked just now: the Hi takes the proof as it is.
    const now = t.world.calls.length;
    expect((await t.service.freshProof(passId, fresh, TAB)).ok).toBe(true);
    expect((await t.service.freshProof(passId, fresh, TAB)).ok).toBe(true);
    expect(reads(t, freshChat.id, now)).toBe(1);
  });
});

describe('[host:fansly] «Новые» as the old extension did it (audit 2026-10-20, regression 7)', () => {
  /** A world of three new followers: one written to, one who only wrote, one with no chat (the queue's `POST /group`). */
  const world = (t: ReturnType<typeof setup>, personal = 'hey you') => {
    const greeted = t.world.follow(1, T0 - minutes(5));
    const wrote = t.world.follow(2, T0 - minutes(6));
    const none = t.world.follow(3, T0 - minutes(7));
    const greetedChat = t.world.chat(greeted, [{ from: 'fan', content: 'hi' }, { from: 'model', content: personal }], 'no');
    const wroteChat = t.world.chat(wrote, [{ from: 'fan', content: 'hello?' }], 'no');
    return { greeted, wrote, none, greetedChat, wroteChat };
  };
  const touching = (t: ReturnType<typeof setup>, groupId: string, from = 0): NewcomersCall[] =>
    t.world.calls.slice(from).filter((call) => call.query?.['groupId'] === groupId || call.path?.['group'] === groupId);

  it('[FS:713-743] what a pass proved outlives it: the next window takes a fan written to without a request and a known chat instead of `POST /group`; «nobody wrote» is read again', async () => {
    const kv = createMemoryKv();
    const first = setup({ kv });
    const a = world(first);
    await first.scan();
    await first.settle();
    await vi.advanceTimersByTimeAsync(KNOWN_FLUSH_MS + 1);
    const book = kv.read<{ v: number; fans: Record<string, { g: string; p?: unknown }> }>(`${NEWCOMERS_KNOWN_PREFIX}${C}`);
    expect(book?.v).toBe(1);
    expect(book?.fans[a.greeted]).toMatchObject({ g: a.greetedChat.id, p: { fold: expect.stringMatching(/^[0-9a-f]{16}$/) } });
    expect(book?.fans[a.wrote]).toEqual(expect.not.objectContaining({ p: expect.anything() }));
    expect(book?.fans[a.none]?.g).toMatch(/^\d+$/);
    // Never a text of a message in the store.
    expect(JSON.stringify(book)).not.toMatch(/hey you|hello/);

    // Another window, another background: the same followers.
    const second = setup({ kv });
    const b = world(second);
    second.world.chat(b.none, [], 'no');
    const passId = await second.scan();
    await second.settle();
    expect(await second.row(passId, b.greeted)).toMatchObject({ status: 'greeted', groupId: b.greetedChat.id, historyRevision: null });
    expect(touching(second, b.greetedChat.id)).toEqual([]);
    expect(second.creates()).toEqual([]);
    // A known chat passes the participants' fence and its history is read to the start again.
    expect(touching(second, b.wroteChat.id).map((call) => call.route)).toEqual(['group.detail', 'message.history', 'message.history']);
    expect(await second.row(passId, b.wrote)).toMatchObject({ status: 'ready' });
    expect(await second.row(passId, b.none)).toMatchObject({ status: 'ready' });
  });

  it('[FS:713-743] a greeting of ours that went is kept; a personal message whose text has since become a welcome text proves nothing again', async () => {
    const kv = createMemoryKv();
    const first = setup({ kv });
    const a = world(first, 'Welcome, love');
    const passId = await first.scan();
    await first.settle();
    first.service.greeted(C, a.wrote);
    await vi.advanceTimersByTimeAsync(KNOWN_FLUSH_MS + 1);
    expect(kv.read<{ fans: Record<string, { p?: unknown }> }>(`${NEWCOMERS_KNOWN_PREFIX}${C}`)?.fans[a.wrote]?.p).toBe('sent');
    expect(await first.row(passId, a.greeted)).toMatchObject({ status: 'greeted' });

    const second = setup({ kv });
    // The technical chat the first pass made is gone: the kept chat is forgotten, the queue's get-or-create finds one.
    const b = world(second, 'Welcome, love');
    const call = second.world.api.call.bind(second.world.api);
    // The creator made that text an automation meanwhile.
    vi.spyOn(second.world.api, 'call').mockImplementation(async (request) =>
      request.route === 'message.automated' ? (second.world.calls.push(request), [{ messageTemplate: JSON.stringify({ content: 'Welcome,  love' }) }]) : call(request),
    );
    const again = await second.scan();
    await second.settle();
    expect(await second.row(again, b.wrote)).toMatchObject({ status: 'greeted' });
    expect(touching(second, b.wroteChat.id)).toEqual([]);
    expect(await second.row(again, b.greeted)).toMatchObject({ status: 'ready' });
    expect(touching(second, b.greetedChat.id).map((call) => call.route)).toContain('message.history');
    expect(await second.row(again, b.none)).toMatchObject({ status: 'ready' });
    expect(second.creates()).toEqual([b.none]);
  });

  it('[2.4.3] a blip of Fansly’s (a 404, no answer) is asked again once, at the end of the queue, after 3 s; a second one is the row’s failure; a failed `POST /group` is never asked again by itself', async () => {
    const t = setup();
    const lucky = t.world.follow(1, T0 - minutes(5));
    const unlucky = t.world.follow(2, T0 - minutes(6));
    const lone = t.world.follow(3, T0 - minutes(7));
    const luckyChat = t.world.chat(lucky, [{ from: 'fan' }]);
    const unluckyChat = t.world.chat(unlucky, [{ from: 'fan' }]);
    const call = t.world.api.call.bind(t.world.api);
    let blips = 0;
    vi.spyOn(t.world.api, 'call').mockImplementation(async (request) => {
      const group = request.query?.['groupId'];
      if (request.route === 'message.history' && (group === unluckyChat.id || (group === luckyChat.id && blips++ === 0))) {
        t.world.calls.push(request);
        throw new ApiError(group === luckyChat.id ? 'network' : 'http', 'CG-FAN-REQUEST', group === luckyChat.id ? undefined : 404);
      }
      if (request.route === 'group.create') {
        t.world.calls.push(request);
        throw new ApiError('http', 'CG-FAN-REQUEST', 404);
      }
      return call(request);
    });
    const passId = await t.scan();
    await vi.advanceTimersByTimeAsync(10);
    expect(await t.row(passId, lucky)).toMatchObject({ status: 'pending' });
    await vi.advanceTimersByTimeAsync(RECHECK_DELAY_MS + 10);
    await t.settle();
    expect(await t.row(passId, lucky)).toMatchObject({ status: 'ready' });
    expect(touching(t, luckyChat.id).filter((entry) => entry.route === 'message.history')).toHaveLength(3);
    expect(await t.row(passId, unlucky)).toMatchObject({ status: 'failed', error: { code: 'CG-FAN-REQUEST', httpStatus: 404 } });
    expect(touching(t, unluckyChat.id).filter((entry) => entry.route === 'message.history')).toHaveLength(2);
    expect(await t.row(passId, lone)).toMatchObject({ status: 'failed' });
    expect(t.creates()).toEqual([lone]);
    expect((await t.ask('fansly.followers.read', { passId, offset: 0, limit: 1 })).pass?.state).toBe('done');
  });

  it('[FS:595-601] the check right before a send never waits out a cooldown: refused at once with its end; its reads are the greeting’s (refused, not waited)', async () => {
    const t = setup();
    const fan = t.world.follow(1, T0 - minutes(5));
    t.world.chat(fan, [{ from: 'fan', content: 'hi' }]);
    const passId = await t.scan();
    await t.settle();
    const before = t.world.calls.length;
    expect((await t.service.recheck(passId, fan, TAB)).ok).toBe(true);
    expect(t.world.calls.slice(before).length).toBeGreaterThan(0);
    expect(t.world.calls.slice(before).every((call) => call.click === true)).toBe(true);

    const until = Date.now() + 90_000;
    t.world.setCooling(until);
    const asked = t.world.calls.length;
    expect(await t.service.recheck(passId, fan, TAB)).toEqual({ ok: false, code: 'CG-FAN-RATE-LIMIT', retryAt: until });
    expect(t.world.calls.length).toBe(asked);
    expect(await t.row(passId, fan)).toMatchObject({ status: 'ready' });
  });

  it('[FW:298-301] a click on a row puts the fan first in a running queue and never starts a standing one', async () => {
    const t = setup();
    for (let n = 1; n <= 3; n += 1) t.world.follow(n, T0 - minutes(n));
    const release = t.world.hold('group.create');
    const passId = await t.scan();
    await t.until(() => t.creates().length === 1);
    expect(await t.ask('fansly.followers.pause', { passId })).toMatchObject({ pass: { passId } });
    release();
    await t.settle();
    const pending = (await t.rows(passId)).find((row) => row.status === 'pending');
    expect(pending).toBeDefined();
    const calls = t.world.calls.length;
    expect(await t.ask('fansly.followers.prioritize', { passId, fanRef: pending?.fanRef ?? '', next: true })).toEqual({ recorded: false });
    await t.settle();
    expect(t.world.calls.length).toBe(calls);
  });

  it('[2026-10-25] the greeting reminder checks a creator’s new followers READ-ONLY, together: the inbox once, the chats it names; no chat made', async () => {
    const t = setup();
    const at = T0 - minutes(10);
    const welcomed = t.world.follow(1, at, { name: 'Ann' });
    t.world.chat(welcomed, [{ from: 'model', content: 'Thanks for the follow' }]);
    const greeted = t.world.follow(2, at);
    t.world.chat(greeted, [{ from: 'model', content: 'Thanks for the follow' }, { from: 'model', content: 'hey you 💕' }]);
    const wrote = t.world.follow(3, at);
    t.world.chat(wrote, [{ from: 'fan', content: 'hi' }]);
    // No chat anywhere: nobody wrote since the follow, and the inbox read to its end says so.
    const silent = t.world.follow(4, at, { name: 'Bea' });
    const fans = [welcomed, greeted, wrote, silent].map((fanRef) => ({ fanRef, followedAt: at }));
    const verdicts = await t.service.remind(C, fans);
    expect(Object.fromEntries(verdicts)).toEqual({
      [welcomed]: { s: 'due', fanLabel: 'Ann', username: 'fan_1', avatarUrl: null },
      [greeted]: { s: 'greeted' },
      [wrote]: { s: 'wrote' },
      [silent]: { s: 'due', fanLabel: 'Bea', username: 'fan_4', avatarUrl: null },
    });
    expect(t.creates()).toEqual([]);
    expect(t.routes().filter((route) => route === 'messaging.groups' || route === 'message.automated' || route === 'account.byIds')).toEqual(['message.automated', 'messaging.groups', 'account.byIds']);
    // What it proved is the book's: a window's pass takes the greeted fan without a request.
    await vi.advanceTimersByTimeAsync(KNOWN_FLUSH_MS + 1);
    expect(t.kv.data.get(`${NEWCOMERS_KNOWN_PREFIX}${C}`)).toMatchObject({ fans: { [greeted]: { p: { at: expect.any(Number) } } } });
    // The creator's lane cools down: nothing is asked, nobody is told — the reminder asks again a minute later.
    const calls = t.world.calls.length;
    t.world.setCooling(Date.now() + minutes(1));
    expect(Object.fromEntries(await t.service.remind(C, fans.slice(0, 1)))).toEqual({ [welcomed]: null });
    expect(t.world.calls.length).toBe(calls);
  });
});

describe('[host:fansly] «Новые» loading (2026-10-27: «открывает дохуя типов, цифры потом уменьшаются»)', () => {
  it('[2026-10-27] a window that opens with the page waits for the creator’s session instead of stopping the pass with CG-FAN-SESSION', async () => {
    const t = setup();
    const fan = t.world.follow(1, T0 - minutes(5));
    t.world.failures.set('message.automated', new ApiError('session', 'CG-FAN-SESSION'));
    const passId = await t.scan();
    await vi.advanceTimersByTimeAsync(SESSION_LOOK_MS * 3);
    expect(t.routes().every((route) => route === 'message.automated')).toBe(true);
    // The page asked Fansly something: the session is there, the pass goes on by itself.
    t.world.failures.delete('message.automated');
    await vi.advanceTimersByTimeAsync(SESSION_LOOK_MS + 1);
    await t.settle();
    expect(await t.row(passId, fan)).toMatchObject({ status: 'ready' });
  });

  it('[2026-10-27] the check goes newest first whether or not the inbox named the chat; a chat the inbox shows ending with the creator’s message is «Уже писали» without a request; «К обработке» counts only fans checked', async () => {
    const t = setup();
    const newest = t.world.follow(1, T0 - minutes(2));
    const greeted = t.world.follow(2, T0 - minutes(3));
    const greetedChat = t.world.chat(greeted, [{ from: 'model', content: 'hey, personal' }]);
    const older = t.world.follow(3, T0 - minutes(4));
    t.world.chat(older, [{ from: 'fan', content: 'hi' }]);
    const release = t.world.hold('message.history');
    const passId = await t.scan();
    await t.until(() => t.routes().includes('message.history'));
    // Nobody has a verdict that needs the person yet: «К обработке» holds nobody, «Все» holds all three.
    const reading = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 100, query: { search: '', tab: 'todo', filter: 'any' } });
    expect([reading.counts?.tabs.todo, reading.counts?.tabs.all]).toEqual([0, 3]);
    expect(await t.row(passId, greeted)).toMatchObject({ status: 'greeted' });
    release();
    await t.settle();
    // The newest fan, who has no chat, before the older one the inbox named; the greeted one asked nothing.
    expect(t.creates()).toEqual([newest]);
    const order = t.world.calls.filter((call) => call.route === 'group.create' || call.route === 'message.history').map((call) => call.route);
    expect(order[0]).toBe('group.create');
    expect(t.world.calls.some((call) => call.query?.['groupId'] === greetedChat.id || call.path?.['group'] === greetedChat.id)).toBe(false);
    const done = await t.ask('fansly.followers.read', { passId, offset: 0, limit: 100, query: { search: '', tab: 'todo', filter: 'any' } });
    expect(done.rows.map((row) => row.fanRef)).toEqual([newest, older]);
  });
});

describe('[host:fansly] «Hi» inside a greeting reminder: its one fan, proved alone (2026-10-29)', () => {
  const SOLO = FANSLY_TAB_REQUESTS['fansly.greet.solo'];
  const solo = async (t: ReturnType<typeof setup>, fanRef: string, create = true, tab = TAB) => {
    const payload = { hostAccountId: C, fanRef, ...(create ? { create: true as const } : {}) };
    expect(SOLO.req.safeParse(payload).success).toBe(true);
    const answer = await t.service.solo(payload, tab);
    expect(SOLO.res.safeParse(answer).success, 'fansly.greet.solo answer').toBe(true);
    return answer;
  };
  const passOf = (answer: Awaited<ReturnType<typeof solo>>): string => {
    if (!answer.ok) throw new Error(answer.error.code);
    return answer.passId;
  };

  it('[2026-10-29] checks the fan alone, as the window would: the inbox’s first page names the chat, its history to the start, the profile — nobody else is asked, no window hears it; its own pass gives the greeting’s proof', async () => {
    const t = setup();
    const fan = t.world.follow(1, T0 - minutes(3), { name: 'Ann' });
    const chat = t.world.chat(fan, [{ from: 'model', content: 'Thanks for the follow' }]);
    const other = t.world.follow(2, T0 - minutes(4));
    const otherChat = t.world.chat(other, [{ from: 'fan', content: 'hi' }]);
    const answer = await solo(t, fan);
    expect(answer).toMatchObject({ ok: true, row: { fanRef: fan, groupId: chat.id, status: 'ready', username: 'fan_1', displayName: 'Ann', historyRevision: expect.any(String) } });
    const passId = passOf(answer);
    expect(t.creates()).toEqual([]);
    expect(t.routes()).not.toContain('followers.new');
    expect(t.world.calls.some((call) => call.query?.['groupId'] === otherChat.id || call.path?.['group'] === otherChat.id)).toBe(false);
    expect(t.world.calls.filter((call) => call.route === 'account.byIds').map((call) => call.query?.['ids'])).toEqual([fan]);
    // The chat's reads are the greeting's: one attempt, refused at once by a cooldown.
    expect(t.world.calls.filter((call) => call.route === 'message.history').every((call) => call.click === true)).toBe(true);
    expect(t.heard).toEqual([]);
    const proof = t.service.greetingProof(passId, fan, TAB);
    expect(proof.ok && proof.proof.groupId).toBe(chat.id);
    // Asked again while fresh: the same pass, no request.
    const calls = t.world.calls.length;
    expect(passOf(await solo(t, fan))).toBe(passId);
    expect(t.world.calls.length).toBe(calls);
    // No window's request reaches it, and a tab of another account gets nothing of it.
    expect(await t.ask('fansly.followers.read', { passId, offset: 0, limit: 10 })).toEqual({ pass: null, rows: [], total: 0 });
    const elsewhere = setup({ tabOn: (tab) => tab !== OTHER_TAB });
    expect(await elsewhere.service.solo({ hostAccountId: C, fanRef: fan, create: true }, OTHER_TAB)).toEqual({ ok: false, error: { code: 'CG-FNEW-ACCOUNT' } });
    expect(t.service.row(passId, fan, TAB)).not.toBeNull();
    t.service.dispose();
    expect(t.service.row(passId, fan, TAB)).toBeNull();
  });

  it('[2026-10-29] a fan with no chat to be found: only the click’s own request makes it, once — a failed `POST /group` is never asked again by itself', async () => {
    const t = setup();
    const fan = t.world.follow(1, T0 - minutes(3));
    expect(await solo(t, fan, false)).toEqual({ ok: false, error: { code: 'CG-FNEW-UNVERIFIED' } });
    expect(t.creates()).toEqual([]);
    expect(await solo(t, fan)).toMatchObject({ ok: true, row: { status: 'ready', groupId: expect.any(String) } });
    expect(t.creates()).toEqual([fan]);

    const unlucky = t.world.follow(2, T0 - minutes(4));
    t.world.failures.set('group.create', new ApiError('network', 'CG-FAN-NETWORK'));
    expect(await solo(t, unlucky)).toEqual({ ok: false, error: { code: 'CG-FAN-NETWORK' } });
    await vi.advanceTimersByTimeAsync(RECHECK_DELAY_MS * 10);
    expect(t.creates()).toEqual([fan, unlucky]);
  });

  it('[2026-10-29] never waits out a cooldown, and takes what the window proved without a request: «Уже писали», a fresh «Не писали»; an aged one is read again before the next greeting', async () => {
    const cold = setup();
    const lone = cold.world.follow(1, T0 - minutes(3));
    const until = Date.now() + 90_000;
    cold.world.setCooling(until);
    expect(await solo(cold, lone)).toEqual({ ok: false, error: { code: 'CG-FAN-RATE-LIMIT', retryAt: until } });
    expect(cold.world.calls).toEqual([]);

    const t = setup();
    const greeted = t.world.follow(1, T0 - minutes(5));
    t.world.chat(greeted, [{ from: 'fan', content: 'hi' }, { from: 'model', content: 'hey you' }]);
    const fresh = t.world.follow(2, T0 - minutes(6));
    const freshChat = t.world.chat(fresh, [{ from: 'fan', content: 'hello?' }]);
    await t.scan();
    await t.settle();
    t.world.setCooling(until);
    const calls = t.world.calls.length;
    expect(await solo(t, greeted)).toMatchObject({ ok: true, row: { status: 'greeted' } });
    expect(await solo(t, fresh)).toMatchObject({ ok: true, row: { status: 'ready', groupId: freshChat.id } });
    expect(t.world.calls.length).toBe(calls);
    // The check aged: the fan's chat is read again before the next greeting (no inbox, no `POST /group`).
    t.world.setCooling(0);
    await vi.advanceTimersByTimeAsync(READY_FRESH_MS + 1);
    const before = t.world.calls.length;
    const again = await solo(t, fresh);
    expect(again).toMatchObject({ ok: true, row: { status: 'ready', groupId: freshChat.id } });
    expect(t.world.calls.slice(before).map((call) => call.route)).toContain('message.history');
    expect(t.world.calls.slice(before).map((call) => call.route)).not.toContain('messaging.groups');
    expect(t.world.calls.slice(before).map((call) => call.route)).not.toContain('group.create');
  });

  it('[2026-10-29] the card’s send takes the solo’s row as a window’s: the history read again before the custody, a colleague’s greeting refuses it; one that went makes the fan «Уже писали» — for the book and the reminder’s next minute', async () => {
    const t = setup({ tabOn: (tab) => tab !== OTHER_TAB });
    const fan = t.world.follow(1, T0 - minutes(3));
    const chat = t.world.chat(fan, [{ from: 'model', content: 'Thanks for the follow' }]);
    const late = t.world.follow(2, T0 - minutes(4));
    const lateChat = t.world.chat(late, [{ from: 'model', content: 'Thanks for the follow' }]);
    const sends: FanslySendStart[] = [];
    const page = { pageId: 13, pageLabel: 'lora-fansly', flagRevision: 4 };
    const greeting = createFanslyGreeting({
      newcomers: t.service,
      send: {
        send(start) {
          sends.push(start);
          return Promise.resolve({ attemptId: start.request.attemptId, fanRef: start.request.fanRef, state: 'sent', proof: 'echo', platformMessageId: '830000000000000001' });
        },
        native: () => Promise.resolve('registered'),
        onChange: () => () => undefined,
        status: () => Promise.resolve(null),
        latest: () => Promise.resolve([]),
      },
      local: t.kv.open(),
      session: () => ({ hubOrigin: 'https://hub.example.test', userId: 7 }),
      page: (creator, tab) => Promise.resolve(creator === C && tab === TAB ? { ok: true, page } : { ok: false, code: 'CG-BINDING-NOT-GRANTED' }),
      generation: () => null,
      tabOn: (tab, creator) => tab === TAB && creator === C,
      now: () => Date.now(),
    });
    const go = async (fanRef: string, groupId: string, tab = TAB) => {
      const answer = await solo(t, fanRef);
      if (!answer.ok) throw new Error(answer.error.code);
      const written = (await greeting.answer('fansly.followers.draft', { passId: answer.passId, fanRef, text: 'Hey you, welcome!' }, TAB)) as FanslyTabResponsePayload<'fansly.followers.draft'>;
      if (!written.ok) throw new Error(written.error.code);
      const request: FanslyGreetingRequest = { attemptId: `00000000-0000-4000-8000-0000000a${fanRef.slice(-4)}`, passId: answer.passId, hostAccountId: C, fanRef, groupId, text: 'Hey you, welcome!', draftRevision: written.draft.revision, historyRevision: answer.row.historyRevision ?? '', admission: { kind: 'own' }, cause: { kind: 'click', actionToken: 'a'.repeat(32) } };
      return { passId: answer.passId, sent: (await greeting.answer('fansly.followers.send', request, tab)) as FanslyTabResponsePayload<'fansly.followers.send'> };
    };

    // A colleague greets the fan after the Hi: the history read again before the custody finds it — nothing goes.
    const answer = await solo(t, late);
    if (!answer.ok) throw new Error(answer.error.code);
    lateChat.messages.push({ id: sf(Date.now()), senderId: C, type: 1, content: 'hey babe 💕', correlationId: null, inReplyTo: null });
    const written = (await greeting.answer('fansly.followers.draft', { passId: answer.passId, fanRef: late, text: 'Hey you, welcome!' }, TAB)) as FanslyTabResponsePayload<'fansly.followers.draft'>;
    if (!written.ok) throw new Error(written.error.code);
    expect(await greeting.answer('fansly.followers.send', { attemptId: '00000000-0000-4000-8000-0000000a0001', passId: answer.passId, hostAccountId: C, fanRef: late, groupId: lateChat.id, text: 'Hey you, welcome!', draftRevision: written.draft.revision, historyRevision: answer.row.historyRevision ?? '', admission: { kind: 'own' }, cause: { kind: 'click', actionToken: 'a'.repeat(32) } }, TAB)).toEqual({ ok: false, error: { code: 'CG-SEND-PART' } });
    expect(sends).toEqual([]);

    // A tab of another account sends nothing for it.
    const { passId, sent } = await go(fan, chat.id, OTHER_TAB);
    expect(sent).toEqual({ ok: false, error: { code: 'CG-CONTEXT-CHANGED' } });
    expect(sends).toEqual([]);

    const ok = await go(fan, chat.id);
    expect(ok.passId).toBe(passId);
    expect(ok.sent).toMatchObject({ ok: true, attempt: { state: 'sent' } });
    expect(sends.map((start) => [start.request.passId, start.request.groupId])).toEqual([[passId, chat.id]]);
    expect(t.service.row(passId, fan, TAB)?.view.status).toBe('greeted');
    expect(t.service.live(passId, fan)).toBeNull();
    await vi.advanceTimersByTimeAsync(KNOWN_FLUSH_MS + 1);
    expect(t.kv.read<{ fans: Record<string, { p?: unknown }> }>(`${NEWCOMERS_KNOWN_PREFIX}${C}`)?.fans[fan]?.p).toBe('sent');
    // The reminder's next minute: greeted, with no request.
    const calls = t.world.calls.length;
    expect(Object.fromEntries(await t.service.remind(C, [{ fanRef: fan, followedAt: T0 - minutes(3) }]))).toEqual({ [fan]: { s: 'greeted' } });
    expect(t.world.calls.length).toBe(calls);
    greeting.dispose();
  });
});
