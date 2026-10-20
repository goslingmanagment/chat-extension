// Fansly's MAIN world as a whole against a page-like window (docs/project-unite/
// architecture.md §5.1–§5.4, §6): the boot of host-kit with Fansly's runtime,
// its Proxies over the page's WebSocket and XMLHttpRequest, its listeners on
// the page's own instances, and the stream it sends — received by the shared
// isolated client over Fansly's own schemas (validate.ts), so every batch
// here passed the checks the isolated side makes. The constructors are fakes
// with the natives' shape (Node has no XMLHttpRequest; src/testing/fake-page.ts); Firefox's own natives,
// the stand and the FBuddy-like neighbour are the e2e's
// (packages/testing/e2e/specs/suite-fansly-tap.e2e.ts).

import { afterEach, describe, expect, it } from 'vitest';

import {
  CREATOR,
  FAN,
  GROUP,
  SOCKET,
  API,
  type FakeWebSocket as WebSocket,
  connect as connectTo,
  newMessage,
  ok,
  page,
  request,
  session,
  settle,
  type Connected,
  type PageWindow,
} from '../testing/fake-page';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const connect = (win: PageWindow, options: { acking?: boolean; start?: boolean } = {}): Promise<Connected> => connectTo(win, cleanups, options);

const coverage = (c: Connected): unknown[] => c.events().filter((e) => e.t === 'fx.coverage').map((e) => e.p);

describe('[SN-017] [EX-007] [host:fansly] the Proxies over the page’s constructors (FS-WS-1)', () => {
  it('[SP-037] a passive group lookup names only a direct conversation of the requested creator and fan', async () => {
    const c = await connect(page());
    request(c.win, `${API}/account/me`).respond(200, ok({ account: { id: CREATOR } }));
    request(c.win, `${API}/messaging/groups`).respond(200, ok({ data: [], aggregationData: { groups: [{ id: GROUP, type: 1, users: [{ userId: CREATOR }, { userId: FAN }] }] } }));
    await settle();
    expect(await c.client.request('fx.groupForFan', { creatorId: CREATOR, fanId: FAN })).toEqual({ groupId: GROUP });
    expect(await c.client.request('fx.groupForFan', { creatorId: '999', fanId: FAN })).toEqual({ groupId: null });
    expect(await c.client.request('fx.groupForFan', { creatorId: CREATOR, fanId: '999' })).toEqual({ groupId: null });
    request(c.win, `${API}/group/${GROUP}/`).respond(200, ok({ id: GROUP, type: 1, users: [{ userId: CREATOR }, { userId: FAN }, { userId: '999' }] }));
    await settle();
    expect(await c.client.request('fx.groupForFan', { creatorId: CREATOR, fanId: FAN })).toEqual({ groupId: null });
  });
});

describe('[SN-020] [host:fansly] the tap’s counts and completeness (FS-WS-5)', () => {
  it('[FS-WS-5] a new socket and the end of one make every chat unknown; t:1 confirms only the newest socket', async () => {
    const c = await connect(page());
    const first = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    first.receive(session);
    first.drop();
    const second = new c.win.WebSocket(SOCKET) as unknown as WebSocket;
    // A late frame of the old socket: its message still counts, its t:1 confirms nothing.
    first.receive(session);
    first.receive(newMessage('700000000000000108'));
    await settle();
    expect(coverage(c)).toEqual([
      { groupIds: 'all', state: 'unknown', reason: 'socket' },
      { groupIds: 'all', state: 'unknown', reason: 'socket' },
      { groupIds: 'all', state: 'unknown', reason: 'socket' },
    ]);
    expect((await c.state()).socket).toEqual({ epoch: 2, confirmed: false });
    second.receive(session);
    await settle();
    expect((await c.state()).socket).toEqual({ epoch: 2, confirmed: true });
    expect(c.events().filter((e) => e.t === 'fx.incoming')).toHaveLength(1);
  });
});
