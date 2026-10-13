// The spike's loopback world on ONE port, told apart by Host (the container's /etc/hosts maps the names to
// 127.0.0.1): `fansly.test` — the stand pages; `apiv3.fansly.test` — a fake API with CORS and credentials like
// Fansly's; `wsv3.fansly.test` — the socket ({t, d} frames, t:1 on the client's token, t:2 on "p"); `127.0.0.1` — the
// sink (POST /log from extensions and pages) and the control API of the driver.

import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocketServer } from 'ws';

import { CREATOR, groupResponse, groupsResponse, historyResponse, message, newMessageFrame, sessionFrame } from './data.mjs';

const standDir = fileURLToPath(new URL('../stand/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

export async function startWorld({ port = 0, extraStatic = {} } = {}) {
  const logs = [];
  const apiLog = [];
  const state = { echo: 'after', postDelayMs: 30, echoDelayMs: 30, unread429: false, nb429: true, groups: groupsResponse(115_000) };
  const sockets = new Set();
  let origin = '';

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    sockets.add(ws);
    ws.on('message', (raw) => {
      const data = String(raw);
      if (data === 'p') ws.send(JSON.stringify({ t: 2, d: JSON.stringify({ lastPing: Date.now() }) }));
      else if (data.startsWith('{"t":1')) ws.send(sessionFrame());
    });
    ws.on('close', () => sockets.delete(ws));
  });
  const push = (frames) => {
    for (const ws of sockets) for (const f of frames) ws.send(f);
    return sockets.size;
  };

  const body = (req) =>
    new Promise((ok) => {
      const parts = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
    });
  const json = (res, status, text, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(text);
  };

  const server = createServer(async (req, res) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    try {
      if (host === '127.0.0.1' || host === 'localhost') {
        const cors = { 'access-control-allow-origin': '*' };
        if (url.pathname === '/log' && req.method === 'POST') {
          const text = await body(req);
          try {
            logs.push({ at: Date.now(), ...JSON.parse(text) });
          } catch {
            logs.push({ at: Date.now(), raw: text });
          }
          return json(res, 200, '{}', cors);
        }
        if (url.pathname === '/ctl/state' && req.method === 'POST') {
          Object.assign(state, JSON.parse(await body(req)));
          return json(res, 200, '{}');
        }
        if (url.pathname === '/ctl/push' && req.method === 'POST') return json(res, 200, JSON.stringify({ sockets: push(JSON.parse(await body(req)).frames) }));
        if (url.pathname.startsWith('/static/')) {
          const name = url.pathname.slice('/static/'.length);
          const file = extraStatic[name];
          if (file && existsSync(file)) {
            res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', ...cors });
            return res.end(readFileSync(file));
          }
        }
        return json(res, 200, '{"ok":true}', cors);
      }

      if (host === 'fansly.test') {
        let path = url.pathname;
        if (path === '/' || path.startsWith('/messages')) path = '/chat.html';
        else if (path.startsWith('/nav')) path = '/nav.html';
        else if (!extname(path)) path = `${path}.html`;
        const file = resolve(standDir, `.${path}`);
        if (!file.startsWith(standDir) || !existsSync(file)) return json(res, 404, '{}');
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain', 'cache-control': 'no-store' });
        return res.end(readFileSync(file, 'utf8').replaceAll('__ORIGIN__', origin));
      }

      if (host === 'apiv3.fansly.test') {
        const pageOrigin = req.headers.origin ?? '';
        const cors = {
          'access-control-allow-origin': pageOrigin || '*',
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': 'authorization, content-type, fansly-client-id, fansly-client-ts, fansly-session-id, fansly-client-check, ngsw-bypass',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
        };
        if (req.method === 'OPTIONS') {
          res.writeHead(204, cors);
          return res.end();
        }
        const text = req.method === 'POST' ? await body(req) : '';
        const path = url.pathname.replace(/^\/api\/v1\//, '');
        const src = url.searchParams.get('src') ?? '';
        const entry = { at: Date.now(), method: req.method, path, src, origin: pageOrigin, auth: req.headers.authorization ?? null, clientId: req.headers['fansly-client-id'] ?? null, status: 200 };
        apiLog.push(entry);
        const ok = (response) => json(res, 200, JSON.stringify({ success: true, response }), cors);
        if (path === 'account/me') return ok({ account: { id: CREATOR, username: 'model' } });
        if (path === 'message' && req.method === 'POST') {
          const sent = JSON.parse(text || '{}');
          const m = message({ groupId: String(sent.groupId), senderId: CREATOR, content: String(sent.content ?? '') });
          const respond = () => ok(m);
          const echo = () => push([newMessageFrame(m)]);
          if (state.echo === 'before') {
            echo();
            setTimeout(respond, state.postDelayMs);
          } else {
            setTimeout(() => {
              respond();
              if (state.echo === 'after') setTimeout(echo, state.echoDelayMs);
            }, state.postDelayMs);
          }
          return;
        }
        if (path === 'message' && url.searchParams.has('groupId')) {
          const gid = url.searchParams.get('groupId');
          const n = Number(url.searchParams.get('count') ?? 25);
          return json(res, 200, historyResponse(gid, '600000000000000000', n), cors);
        }
        if (path === 'messaging/groups') return json(res, 200, state.groups, cors);
        if (/^group\/\d+\/?$/.test(path)) return json(res, 200, groupResponse(path.split('/')[1], '600000000000000000'), cors);
        if (path === 'message/unread' && (state.unread429 || (state.nb429 && src.startsWith('nb')))) {
          entry.status = 429;
          return json(res, 429, JSON.stringify({ success: false, error: { code: 429 } }), cors);
        }
        if (path === 'message/unread') return ok({ messageInteractions: [], total: 0 });
        if (path === 'media/upload') return ok({ id: '1' });
        return ok({});
      }
      return json(res, 404, '{}');
    } catch (error) {
      json(res, 500, JSON.stringify({ error: String(error) }));
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (host !== 'wsv3.fansly.test') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  const actual = server.address().port;
  origin = `http://fansly.test:${actual}`;
  return {
    port: actual,
    origin,
    api: `http://apiv3.fansly.test:${actual}`,
    ws: `ws://wsv3.fansly.test:${actual}`,
    sink: `http://127.0.0.1:${actual}`,
    logs,
    apiLog,
    state,
    push,
    sockets,
    close: () => new Promise((ok) => {
      for (const ws of sockets) ws.terminate();
      server.close(() => ok());
    }),
  };
}
