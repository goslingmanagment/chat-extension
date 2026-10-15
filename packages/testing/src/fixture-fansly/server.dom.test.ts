// The Fansly-like stand page over the fake Fansly (R20 P6b): real XHR requests
// and a real socket to a loopback server, in happy-dom. What the page does
// with them is what Fansly's client does (fixture-fansly/src/live.ts): its
// start order, the fresh end asked again after `t: 1`, its marks of delivery
// and reading by `POST /message/ack` — never inside a gesture — and what each
// socket event does to the chat. Layout and trusted input stay Firefox's
// (e2e/specs/fansly-stand.e2e.ts).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createWorld, standIds } from '../../fixture-fansly/src/data';
import type { FanslyPageJournalEntry } from '../../fixture-fansly/src/protocol';
import { FRAME, serviceFrame, type WireMessage } from '../../fixture-fansly/src/wire';
import { DEFAULT_VERIFY_DELAY_MS, startFakeFansly, type FakeFansly } from '../fake-fansly';
import { pendingRequests } from '../../fixture-fansly/src/http';
import { readJournal } from '../../fixture-fansly/src/journal';
import { apiCalls, contactBlock, key, mainField, mountServerStand, type, until, type MountedStand } from './harness';

const ids = standIds(createWorld());
const [first, , third] = ids.groups as [string, string, string];

let fake: FakeFansly;
let stand: MountedStand | null = null;
let since = 0;
/** The page's journal is the module's, kept across mounts: each test reads its own part from here. */
let pageSince = 0;

beforeAll(async () => {
  // happy-dom's page origin: the fake Fansly lets it in and names its calls `page`.
  fake = await startFakeFansly({ pageOrigin: location.origin });
});

afterAll(async () => {
  await fake.close();
});

beforeEach(() => {
  fake.command({ op: 'reset' });
  since = fake.journal.next;
});

afterEach(async () => {
  stand?.unmount();
  stand = null;
  // What the page had in flight ends before the next test reads the server's journal.
  await until(() => pendingRequests() === 0, 'the page’s requests to end');
});

const server = () => ({ apiOrigin: fake.apiOrigin, socketUrl: fake.socketUrl, token: fake.token });
const pageJournal = (): FanslyPageJournalEntry[] => stand?.control.journal(pageSince) ?? [];
const serverCalls = (route?: string) => fake.journal.calls('page', since).filter((entry) => route === undefined || entry.route === route);
const connected = (): boolean => stand?.control.socket()?.state === 'connected';
const bubbles = (): string[] => [...document.querySelectorAll('app-messages-conversation-route app-group-message .message-text')].map((node) => node.textContent ?? '');

/** One page at a time: a page left mounted keeps its socket and reconnects after every reset. */
async function mount(path: string, live?: Parameters<typeof mountServerStand>[2]): Promise<MountedStand> {
  stand?.unmount();
  pageSince = readJournal().at(-1)?.seq ?? 0;
  stand = await mountServerStand(server(), path, live);
  return stand;
}

/**
 * Opens a chat and waits until the page's start is over: the socket verified and every read of the fresh end it made
 * (one before `t: 1`, maybe one after) answered — so what a test sends next is the socket's alone.
 */
async function openChat(path: string): Promise<{ readonly group: string; readonly fan: string }> {
  stand = await mount(path);
  const group = path.split('/').at(-1) ?? '';
  await until(() => connected() && (stand?.control.list()?.messages ?? 0) > 0, 'the chat and its socket');
  await until(() => pendingRequests() === 0, 'the page’s requests answered');
  await new Promise((resolve) => setTimeout(resolve, 30));
  await until(() => pendingRequests() === 0, 'the page’s requests answered');
  return { group, fan: ids.fans[group] ?? '' };
}

describe('the Fansly stand over the fake Fansly: its start', () => {
  it('asks `/account/me` first; the socket and the unread messages after its answer; the fresh end of the open chat twice — before `t: 1` and after', async () => {
    fake.command({ op: 'socket', verifyDelayMs: DEFAULT_VERIFY_DELAY_MS });
    stand = await mount(`/messages/${ids.longHistory}`);
    await until(() => pageJournal().filter((entry) => entry.type === 'api' && String(entry['path']).startsWith(`/api/v1/message?groupId=${ids.longHistory}`)).length === 2, 'a second fresh end');
    const journal = pageJournal();
    const order = journal.flatMap((entry): string[] => {
      if (entry.type === 'socket-created' || entry.type === 'socket-verified') return [entry.type];
      if (entry.type !== 'api') return [];
      const path = String(entry['path']);
      if (path.startsWith('/api/v1/account/me')) return ['me'];
      if (path.startsWith('/api/v1/message?groupId=')) return ['fresh end'];
      return [];
    });
    expect(order).toEqual(['me', 'socket-created', 'fresh end', 'socket-verified', 'fresh end']);
    expect(stand.control.loggedOut).toBe(false);
    expect(stand.control.backend).toBe('server');
  });

  it('every request of the page carries `ngsw-bypass=true` and the session headers, and the server names it the page’s', async () => {
    expect((await openChat(`/messages/${first}`)).group).toMatch(/^\d{18}$/);
    const calls = serverCalls();
    expect(calls.length).toBeGreaterThan(4);
    for (const entry of calls) {
      expect(entry.path).toContain('ngsw-bypass=true');
      expect(entry.detail?.['headers']).toEqual(['authorization', 'fansly-client-id', 'fansly-client-ts', 'fansly-session-id', 'fansly-client-check']);
      expect(entry.via).toBe('direct');
    }
    expect(calls.map((entry) => entry.route)).toEqual(expect.arrayContaining(['account.me', 'message.unread', 'messaging.groups', 'group.detail', 'message.history', 'message.automated']));
    // The page's own calls break none of OUR rules, its `/message/ack` included.
    expect(fake.journal.violations(since)).toEqual([]);
  });

  it('a dead session: `/account/me` answers 401 — no socket, no chat', async () => {
    fake.command({ op: 'session', expire: true });
    stand = await mount('/messages');
    expect(stand.control.loggedOut).toBe(true);
    expect(stand.control.socket()?.created).toBe(0);
    expect(serverCalls().map((entry) => [entry.route, entry.status])).toEqual([['account.me', 401]]);
  });

  it('a 429 on `/account/me` is tried again (0.5 s later), as the page’s own start does', async () => {
    fake.command({ op: 'api', rules: [{ route: 'account.me', times: 1, outcome: { kind: 'status', status: 429 } }] });
    stand = await mount('/messages');
    expect(stand.control.loggedOut).toBe(false);
    expect(serverCalls('account.me').map((entry) => entry.status)).toEqual([429, 200]);
  });
});

describe('the Fansly stand over the fake Fansly: marks of delivery and reading', () => {
  it('`idle()`: not while the page has marks to send — at its start 60 delivery marks, 25 a call, 200 ms apart — and once idle the server hears nothing more', async () => {
    stand = await mount('/messages');
    const control = stand.control;
    // Between the chunks no request is in flight: «nothing in flight» is not «done», `idle()` is.
    const seen: boolean[] = [];
    await until(
      () => {
        seen.push(control.idle());
        return control.idle();
      },
      'the page to settle',
      8000,
    );
    expect(seen).toContain(false);
    expect(connected()).toBe(true);
    const marks = serverCalls('message.ack').map((entry) => ({ type: entry.detail?.['ackType'], ids: (entry.detail?.['messageIds'] ?? []) as string[] }));
    expect(marks.map((mark) => [mark.type, mark.ids.length])).toEqual([
      [1, 25],
      [1, 25],
      [1, 10],
    ]);
    expect(new Set(marks.flatMap((mark) => mark.ids)).size).toBe(60);
    const settled = fake.journal.next;
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fake.journal.calls('page', settled)).toEqual([]);
    expect(control.idle()).toBe(true);
    // A mark that waits for its collecting delay is work too.
    fake.command({ op: 'message', groupId: third, text: 'one more' });
    await until(() => !control.idle(), 'the page to have a mark to send');
    await until(() => control.idle(), 'the page to settle again');
    expect(fake.journal.calls('page', settled).map((entry) => [entry.route, entry.detail?.['ackType']])).toEqual([['message.ack', 1]]);
  });

  it('opening an unread chat sends the read marks later, by `POST /message/ack` — not inside the click that opened it', async () => {
    stand = await mount('/messages', { ackDelay: 150 });
    await until(connected, 'the socket');
    await until(() => (stand?.control.inbox().loaded ?? 0) > 0, 'the inbox');
    const unread = stand.control.groups().find((group) => group.unread > 0);
    if (unread === undefined) throw new Error('no unread chat');
    const mark = pageJournal().at(-1)?.seq ?? 0;
    const before = fake.journal.next;
    const link = document.querySelector<HTMLAnchorElement>(`.messages-list-wrapper a[href="/messages/${unread.id}"]`);
    link?.click();
    await until(() => stand?.control.route().groupId === unread.id, 'the chat');
    // Inside the click: the route's own requests only — no read mark made in the click's own handler. (By the time the
    // route is seen here a later mark may have gone already: the delay is 150 ms, a loaded machine is slower.)
    const inClick = apiCalls(stand.control.journal(mark), 'POST', /^\/api\/v1\/message\/ack/).filter((entry) => entry.during !== null);
    expect(inClick).toEqual([]);
    await until(() => fake.journal.calls('page', before).some((entry) => entry.route === 'message.ack'), 'the read marks');
    const acks = apiCalls(stand.control.journal(mark), 'POST', /^\/api\/v1\/message\/ack/);
    expect(acks.every((entry) => entry.during === null)).toBe(true);
    expect(acks.some((entry) => entry['ackType'] === 2)).toBe(true);
    await until(() => stand?.control.groups().find((group) => group.id === unread.id)?.unread === 0, 'the chat read');
  });

  it('a fan’s message in a closed chat is marked delivered; the unread count grows; nothing reads it', async () => {
    const { group: open } = await openChat(`/messages/${first}`);
    const other = third;
    expect(other).not.toBe(open);
    const was = stand?.control.groups().find((group) => group.id === other)?.unread ?? -1;
    const before = fake.journal.next;
    const message = fake.command({ op: 'message', groupId: other, text: 'stand: in a closed chat' }).message as WireMessage;
    await until(() => stand?.control.groups().find((group) => group.id === other)?.unread === was + 1, 'the unread count');
    const state = () => fake.state.world.messages.get(message.id)?.interactions.get(fake.state.world.creatorId);
    await until(() => (state()?.deliveredAt ?? 0) > 0, 'the delivery mark');
    expect(fake.journal.calls('page', before).some((entry) => entry.route === 'message.ack')).toBe(true);
    expect(state()?.readAt).toBe(0);
  });
});

describe('the Fansly stand over the fake Fansly: the socket’s events', () => {
  it('`5/1` lands in the open chat; a send and its echo make one message, whichever comes first', async () => {
    const { group } = await openChat(`/messages/${first}`);
    fake.command({ op: 'message', groupId: group, text: 'stand: a new line' });
    await until(() => bubbles().includes('stand: a new line'), 'the message');

    for (const echo of ['before', 'after'] as const) {
      fake.command({ op: 'send', echo, receiptDelayMs: echo === 'before' ? 60 : 0, echoDelayMs: echo === 'after' ? 60 : 0 });
      const field = mainField() as HTMLTextAreaElement;
      type(field, `stand: echo ${echo}`);
      key(field, 'keydown', 'Enter');
      await until(() => fake.state.world.groups.get(group)?.history.at(-1)?.content === `stand: echo ${echo}`, 'the send');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(bubbles().filter((text) => text === `stand: echo ${echo}`)).toHaveLength(1);
      expect(document.querySelectorAll('app-messages-conversation-route app-group-message.queued')).toHaveLength(0);
    }
  });

  it('a message older than 180 s by the page’s clock is dropped, as the page drops it', async () => {
    const { group } = await openChat(`/messages/${first}`);
    fake.command({ op: 'message', groupId: group, text: 'stand: too old', createdAt: Math.floor(Date.now() / 1000) - 600 });
    await until(() => pageJournal().some((entry) => entry.type === 'socket-message-discarded'), 'the drop');
    expect(bubbles()).not.toContain('stand: too old');
  });

  it('`5/10` deletes; one frame for a mass send’s parent takes its copy out of the open chat too', async () => {
    const { group } = await openChat(`/messages/${first}`);
    const plain = fake.command({ op: 'message', groupId: group, text: 'stand: to delete' }).message as WireMessage;
    const sent = fake.command({ op: 'broadcast', text: 'stand: mass send', groupIds: [group] });
    await until(() => bubbles().includes('stand: to delete') && bubbles().includes('stand: mass send'), 'both messages');
    fake.command({ op: 'delete', messageId: plain.id });
    await until(() => !bubbles().includes('stand: to delete'), 'the deletion');
    fake.command({ op: 'delete', messageId: (sent.message as WireMessage).id });
    await until(() => !bubbles().includes('stand: mass send'), 'the cascade');
  });

  it('`5/22` shows the typing line; `4/6` and `4/7` change the members — the header’s contact block goes and comes back', async () => {
    const { group } = await openChat(`/messages/${first}`);
    fake.command({ op: 'typing', groupId: group });
    await until(() => stand?.control.list()?.typing === true, 'the typing line');
    expect(contactBlock()).not.toBeNull();
    stand?.control.setPartners(group, 2);
    await until(() => contactBlock() === null, 'the contact block gone');
    stand?.control.setPartners(group, 1);
    await until(() => contactBlock() !== null, 'the contact block back');
  });

  it('a batch `t: 10001` is walked frame by frame; a damaged frame is counted and dropped, the socket lives on', async () => {
    const { group, fan } = await openChat(`/messages/${first}`);
    const now = Math.floor(Date.now() / 1000);
    const line = (id: string, content: string): string =>
      serviceFrame(5, { type: 1, message: { id, type: 1, dataVersion: 1, content, groupId: group, senderId: fan, correlationId: null, inReplyTo: null, inReplyToRoot: null, createdAt: now, attachments: [], embeds: [], interactions: [], likes: [], totalTipAmount: 0 } });
    fake.command({ op: 'frames', batch: true, frames: [line('999000000000000001', 'stand: batch one'), line('999000000000000002', 'stand: batch two')] });
    await until(() => bubbles().includes('stand: batch two'), 'the batch');
    const before = stand?.control.socket()?.damaged ?? 0;
    fake.command({ op: 'frames', frames: ['{"t":10000,"d":"{broken', JSON.stringify({ t: FRAME.batch, d: 'not an array' })] });
    await until(() => (stand?.control.socket()?.damaged ?? 0) === before + 2, 'two damaged frames');
    fake.command({ op: 'message', groupId: group, text: 'stand: after the damage' });
    await until(() => bubbles().includes('stand: after the damage'), 'a message after the damage');
    expect(stand?.control.socket()?.created).toBe(1);
  });

  it('a closed socket is replaced by a new one (a new epoch); its `t: 1` makes the page ask for the open chat’s fresh end again', async () => {
    const { group } = await openChat(`/messages/${first}`);
    const fresh = (): number => pageJournal().filter((entry) => entry.type === 'api' && String(entry['path']).startsWith(`/api/v1/message?groupId=${group}&limit`)).length;
    const was = fresh();
    // The socket the stand closed comes back after the page's 1.5 s.
    fake.command({ op: 'socket', close: true });
    await until(() => stand?.control.socket()?.created === 2 && connected(), 'a new socket', 6000);
    await until(() => fresh() === was + 1, 'the fresh end again');
    expect(stand?.control.socket()?.verified).toBe(2);
    expect(fake.journal.read(since).entries.filter((entry) => entry.kind === 'ws-open')).toHaveLength(2);
  });

  it('back to the tab after more than 30 s: the unread messages and the fresh end are read again; a notification asks for its messages by id', async () => {
    const { group } = await openChat(`/messages/${first}`);
    const before = fake.journal.next;
    stand?.control.cameBack(10_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Its own marks may still be going out; nothing is READ again.
    expect(fake.journal.calls('page', before).filter((entry) => entry.route !== 'message.ack')).toEqual([]);
    stand?.control.cameBack(31_000);
    await until(() => fake.journal.calls('page', before).some((entry) => entry.route === 'message.history'), 'the fresh end again');
    expect(fake.journal.calls('page', before).map((entry) => entry.route)).toEqual(expect.arrayContaining(['message.unread', 'message.history']));
    expect(fake.journal.calls('page', before).find((entry) => entry.route === 'message.history')?.path).toContain(`groupId=${group}`);
    const message = fake.state.world.groups.get(group)?.history.at(-1)?.id ?? '';
    stand?.control.notify([message]);
    await until(() => fake.journal.calls('page', before).some((entry) => entry.route === 'message.byIds'), 'the notification’s messages');
  });
});
