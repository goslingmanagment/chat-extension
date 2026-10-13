// The Fansly stand of the stand server on its own (no browser; R20 P6a): its
// page is served under its own loopback NAME, `localhost`, on a port of its
// own — never as ChatSpace's `127.0.0.1` — and its build lands where the
// server serves it from.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import viteConfig, { FANSLY_FIXTURE_BUILD_DIR as VITE_OUT_DIR } from '../../fixture-fansly.vite.config';
import { CONTROL_REQUEST_HEADER } from '../../fixture-chatspace/src/protocol';
import { FANSLY_SERVER_META } from '../../fixture-fansly/src/server-protocol';
import { FANSLY_STAND_HOSTNAME, FANSLY_STAND_JOURNAL_PATH, startStandServer, type StandServer } from '../stand-server';
import { FANSLY_FIXTURE_BUILD_DIR, FANSLY_FIXTURE_SOURCE_DIR } from './paths';

const fanslyDir = mkdtempSync(join(tmpdir(), 'cg-fansly-stand-'));
writeFileSync(
  join(fanslyDir, 'index.html'),
  `<!doctype html><title>fansly stand test</title>${Object.values(FANSLY_SERVER_META)
    .map((name) => `<meta name="${name}" content="" />`)
    .join('')}<app-root></app-root>`,
);
mkdirSync(join(fanslyDir, 'assets'));
writeFileSync(join(fanslyDir, 'assets', 'index-test.js'), 'export {};');

let stand: StandServer;

beforeAll(async () => {
  stand = await startStandServer({ fanslyDir });
});

afterAll(async () => {
  await stand.close();
});

/** A GET to the Fansly stand's port over 127.0.0.1, under the Host name given (the browser sends the name it was told). */
function get(path: string, host: string, headers: Record<string, string> = {}): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const call = request({ hostname: '127.0.0.1', port: stand.fansly.port, path, headers: { host, ...headers } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, type: String(response.headers['content-type'] ?? ''), body: Buffer.concat(chunks).toString('utf8') }));
    });
    call.on('error', reject);
    call.end();
  });
}

describe('the Fansly stand on the stand server', () => {
  it('has its own loopback name and port: http://localhost:<port>, apart from ChatSpace’s 127.0.0.1 origins', () => {
    expect(FANSLY_STAND_HOSTNAME).toBe('localhost');
    expect(stand.fansly.origin).toBe(`http://localhost:${stand.fansly.port}`);
    expect(new URL(stand.origin).hostname).toBe('127.0.0.1');
    expect(new Set([stand.port, stand.apiPort, stand.fansly.port]).size).toBe(3);
  });

  it('serves the app for every route of the page (history mode) and its assets by name', async () => {
    const host = `localhost:${stand.fansly.port}`;
    for (const path of ['/messages', '/messages/810000000000000001', '/home']) {
      const page = await get(path, host, { 'sec-fetch-dest': 'document' });
      expect(page.status, path).toBe(200);
      expect(page.body).toContain('fansly stand test');
    }
    const asset = await get('/assets/index-test.js', host, { 'sec-fetch-dest': 'script' });
    expect(asset).toMatchObject({ status: 200, type: 'text/javascript; charset=utf-8' });
    expect((await get('/assets/missing.js', host)).status).toBe(404);
    // A path out of the folder is resolved by the URL first: it is the app, never a file outside.
    expect((await get('/assets/../../../package.json', host)).body).toContain('fansly stand test');
  });

  it('refuses any other name for the same port: one stand address, one site (421)', async () => {
    const wrong = await get('/messages', `127.0.0.1:${stand.fansly.port}`);
    expect(wrong.status).toBe(421);
    expect(wrong.body).toContain(`http://localhost:${stand.fansly.port}`);
  });

  it('journals its calls by who made them: the page loads as assets, anything else is foreign', async () => {
    const since = stand.fansly.journal.read().next;
    const host = `localhost:${stand.fansly.port}`;
    await get('/messages', host, { 'sec-fetch-dest': 'document' });
    await get('/messages', host, { 'sec-fetch-dest': 'empty' });
    expect(stand.fansly.journal.read(since).entries.map((entry) => [entry.origin, entry.path, entry.status])).toEqual([
      ['asset', '/messages', 200],
      ['foreign', '/messages', 200],
    ]);
  });

  it('gives the test process its journal with the control header, and does not journal that read', async () => {
    const host = `localhost:${stand.fansly.port}`;
    const since = stand.fansly.journal.read().next;
    await get('/home', host, { 'sec-fetch-dest': 'document' });
    const page = JSON.parse((await get(`${FANSLY_STAND_JOURNAL_PATH}?since=${since}`, host, { [CONTROL_REQUEST_HEADER]: '1' })).body) as { entries: Array<{ path: string }>; next: number };
    expect(page.entries.map((entry) => entry.path)).toEqual(['/home']);
    expect(stand.fansly.journal.read(since).entries).toHaveLength(1);
    // Without the header it is just a path of the app.
    expect((await get(FANSLY_STAND_JOURNAL_PATH, host)).body).toContain('fansly stand test');
  });

  it('tells the page where the fake Fansly is (R20 P6b): its API and socket under the same loopback name, and the page’s session', async () => {
    const page = await get('/messages', `localhost:${stand.fansly.port}`, { 'sec-fetch-dest': 'document' });
    const meta = (name: string): string | undefined => new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(page.body)?.[1];
    const { fake } = stand.fansly;
    expect(meta(FANSLY_SERVER_META.api)).toBe(fake.apiOrigin);
    expect(meta(FANSLY_SERVER_META.socket)).toBe(fake.socketUrl);
    expect(meta(FANSLY_SERVER_META.token)).toBe(fake.token);
    expect(fake.apiOrigin).toMatch(/^http:\/\/localhost:\d+$/);
    expect(fake.socketUrl).toMatch(/^ws:\/\/localhost:\d+\?v=3$/);
    const ports = new Set([stand.port, stand.apiPort, stand.fansly.port, Number(new URL(fake.apiOrigin).port), Number(new URL(fake.socketUrl).port), fake.proxy.port]);
    expect(ports.size).toBe(6);
    // The fake Fansly lets the stand page in — and only it.
    expect(fake.state.pageOrigin).toBe(stand.fansly.origin);
  });

  it('the stand proxy carries a page load to the Fansly stand too (a tab behind a container’s proxy loads its page through it)', async () => {
    const page = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const call = request({ hostname: '127.0.0.1', port: stand.fansly.fake.proxy.port, path: `${stand.fansly.origin}/messages`, headers: { host: `localhost:${stand.fansly.port}`, 'sec-fetch-dest': 'document' } }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      });
      call.on('error', reject);
      call.end();
    });
    expect(page.status).toBe(200);
    expect(page.body).toContain('fansly stand test');
  });

  it('builds the page where the server serves it from, outside the sources archive', () => {
    expect(VITE_OUT_DIR).toBe(FANSLY_FIXTURE_BUILD_DIR);
    expect(viteConfig.root).toBe(FANSLY_FIXTURE_SOURCE_DIR);
    expect(FANSLY_FIXTURE_BUILD_DIR).toMatch(/\/\.cache\/fixture-fansly\/$/);
  });
});
