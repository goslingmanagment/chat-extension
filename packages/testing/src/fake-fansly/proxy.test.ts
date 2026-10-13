// The stand's proxy (R20 P6b; FS-NET-4, architecture.md §8.5): a request that
// came through it is journaled `via: 'proxy'` by the fake Fansly itself, one
// that came straight is `direct`; nothing but the fake Fansly's own names is
// forwarded.

import { connect as netConnect } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createWorld, standIds } from '../../fixture-fansly/src/data';
import type { WireAccountMe } from '../../fixture-fansly/src/wire';
import type { FakeFansly } from './index';
import { bypass, call, startTestFansly } from './kit';

const ids = standIds(createWorld());

let fake: FakeFansly;
let since = 0;

beforeAll(async () => {
  fake = await startTestFansly();
});

afterAll(async () => {
  await fake.close();
});

beforeEach(() => {
  since = fake.journal.next;
});

/** Opens a tunnel through the proxy and sends one HTTP request down it; resolves with everything that came back. */
function throughTunnel(target: string, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(fake.proxy.port, '127.0.0.1');
    let received = '';
    let sent = false;
    socket.on('connect', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    socket.on('data', (chunk: Buffer) => {
      received += chunk.toString('utf8');
      if (!sent && received.includes('\r\n\r\n')) {
        sent = true;
        if (!received.startsWith('HTTP/1.1 200')) {
          socket.end();
          return;
        }
        socket.write(request);
      }
    });
    socket.on('end', () => resolve(received));
    socket.on('close', () => resolve(received));
    socket.on('error', reject);
  });
}

describe('the stand proxy', () => {
  it('forwards a proxied API request (`GET http://localhost:<port>/…`) to the door behind it: the journal says `via: proxy`', async () => {
    const proxied = await call<WireAccountMe>(fake, 'GET', '', { as: 'ours', port: fake.proxy.port, target: `${fake.apiOrigin}/api/v1${bypass('/account/me')}` });
    expect(proxied.status).toBe(200);
    expect(proxied.response?.account.id).toBe(ids.creator);
    const direct = await call(fake, 'GET', bypass('/account/me'), { as: 'ours' });
    expect(direct.status).toBe(200);
    expect(fake.journal.calls('ours', since).map((entry) => [entry.via, entry.route, entry.status])).toEqual([
      ['proxy', 'account.me', 200],
      ['direct', 'account.me', 200],
    ]);
    expect(fake.journal.violations(since)).toEqual([]);
  });

  it('carries a POST with its body and the caller’s own headers; the rules about our calls hold through it', async () => {
    const group = ids.groups[0] as string;
    const sent = await call<{ id: string; content: string }>(fake, 'POST', '', {
      as: 'ours',
      port: fake.proxy.port,
      target: `${fake.apiOrigin}/api/v1${bypass('/message')}`,
      body: { type: 1, content: 'through the proxy', groupId: group, attachments: [], likes: [], scheduledFor: 0, inReplyTo: null, createdAt: 0 },
    });
    expect(sent.response).toMatchObject({ content: 'through the proxy' });
    await call(fake, 'POST', '', { as: 'ours', port: fake.proxy.port, target: `${fake.apiOrigin}/api/v1${bypass('/message/ack')}`, body: { messageIds: [sent.response?.id], type: 2 } });
    expect(fake.journal.violations(since).map((violation) => violation.reason)).toEqual(['ack']);
    expect(fake.journal.calls('ours', since).map((entry) => entry.via)).toEqual(['proxy', 'proxy']);
  });

  it('tunnels a `CONNECT` to the fake Fansly’s names (how a browser carries a socket through a proxy), behind the same door', async () => {
    const api = new URL(fake.apiOrigin);
    const answer = await throughTunnel(api.host, `GET /api/v1${bypass('/account/me')} HTTP/1.1\r\nHost: ${api.host}\r\nauthorization: ${fake.token}\r\nConnection: close\r\n\r\n`);
    expect(answer).toContain('HTTP/1.1 200 Connection Established');
    expect(answer).toContain(`"id":"${ids.creator}"`);
    expect(fake.journal.calls('ours', since).map((entry) => [entry.via, entry.status])).toEqual([['proxy', 200]]);
  });

  it('forwards nowhere else: another target is refused and journaled, by request and by tunnel', async () => {
    const refused = await call(fake, 'GET', '', { port: fake.proxy.port, target: 'http://apiv3.stand.invalid/api/v1/account/me', host: 'apiv3.stand.invalid' });
    expect(refused.status).toBe(502);
    expect(await throughTunnel('apiv3.stand.invalid:443', '')).toContain('502 Bad Gateway');
    expect(fake.journal.read(since).entries.map((entry) => [entry.kind, entry.method, entry.path])).toEqual([
      ['proxy-refused', 'GET', 'http://apiv3.stand.invalid/api/v1/account/me'],
      ['proxy-refused', 'CONNECT', 'apiv3.stand.invalid:443'],
    ]);
  });
});
