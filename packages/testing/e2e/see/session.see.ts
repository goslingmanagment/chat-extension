// `pnpm see:session` (tools/see/README.md): a shift on the stand held open and driven over loopback HTTP, for an
// agent's `pnpm see:do` and the owner's eyes (/live). Not in the CI suite (wdio.conf.ts names e2e/specs only).
//
//   POST /run[?name=x&shot=0]  body: async JS with `s` (kit.ts `See`) and `browser` in scope → its result as JSON,
//                              and a picture of the tab after it (`NN-x.png`, unless shot=0)
//   GET  /shot?name=x          → the path of a new picture
//   GET  /live                 → a page that shows the tab as it is now (a frame every half second)
//   GET  /frame.png, /status   → the latest frame; what the session is
//   POST /stop                 → ends the session (so does CG_SEE_IDLE_MIN minutes without a request)

import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import { browser } from '@wdio/globals';

import { lap, OUT, recordFrames, useSee, type See, type SeeSite } from './kit';
import { fanslyWrites, LIVE, netRecords } from './live';

const PORT = Number(process.env['CG_SEE_PORT'] ?? 47811);
const IDLE_MS = Number(process.env['CG_SEE_IDLE_MIN'] ?? 30) * 60_000;

type Run = (s: See<SeeSite>, b: WebdriverIO.Browser) => Promise<unknown>;
/** The constructor of async functions: `new AsyncFunction('s', 'browser', body)` compiles a command of `see:do`. */
const AsyncFunction = (Object.getPrototypeOf(async function () {}) as { constructor: new (...args: string[]) => Run }).constructor;

const LIVE_PAGE = `<!doctype html><meta charset="utf-8"><title>ChatGoose · ${LIVE ? 'fansly.com' : 'stand'}</title>
<style>body{margin:0;background:#111;color:#bbb;font:13px system-ui}img{display:block;width:100%;height:auto}#s{padding:6px 10px}</style>
<div id="s">…</div><img id="f" alt="">
<script>
const f = document.getElementById('f'), s = document.getElementById('s');
setInterval(() => { f.src = '/frame.png?' + Date.now(); }, 500);
setInterval(async () => { try { const r = await (await fetch('/status')).json(); s.textContent = r.site + ' · ' + r.shots + ' pictures · last: ' + (r.last ?? '—'); } catch { s.textContent = 'the session ended'; } }, 1500);
</script>`;

function read(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function answer(response: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const text = typeof body === 'string' || Buffer.isBuffer(body) ? body : `${JSON.stringify(body, null, 2)}\n`;
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }).end(text);
}

describe('see: a held session', function (this: Mocha.Suite) {
  // On the suite, not in the test: wdio's wrapper reads the test's limit before its body runs (a `this.timeout(0)`
  // there came too late, and every session ended at the config's 2 minutes); 0 would be a limit of 0 to it. The idle
  // stop below ends a session long before this.
  this.timeout(12 * 60 * 60_000);
  const run = useSee<SeeSite>({ sites: ['chatspace', 'fansly', 'telegram'] });

  it('serves commands until /stop', async function () {
    const s = run.see();
    let latest: Buffer = Buffer.from(await browser.takeScreenshot(), 'base64');
    let stopped = false;
    let lastUse = Date.now();
    let last: string | null = null;
    let shots = 0;
    let chain: Promise<unknown> = Promise.resolve();
    const serial = <T>(work: () => Promise<T>): Promise<T> => {
      const next = chain.then(work, work);
      chain = next.catch(() => undefined);
      return next;
    };
    const frames = recordFrames(500, (png) => (latest = png));
    frames.follow(await browser.getWindowHandle());
    const shot = async (name: string): Promise<string> => {
      const path = await s.shot(name);
      shots += 1;
      // An extension page refuses BiDi's frames: the live view shows its last picture instead.
      latest = readFileSync(path);
      return path;
    };

    const server = createServer((request, response) => {
      lastUse = Date.now();
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      void (async () => {
        try {
          if (url.pathname === '/run' && request.method === 'POST') {
            const body = await read(request);
            const started = Date.now();
            last = body.trim().split('\n')[0]?.slice(0, 80) ?? '';
            const outcome = await serial(async () => {
              try {
                const result = await new AsyncFunction('s', 'browser', body)(s, browser);
                const path = url.searchParams.get('shot') === '0' ? null : await shot(url.searchParams.get('name') ?? 'do');
                return { ok: true, result: result ?? null, shot: path };
              } catch (error) {
                const path = await shot('error').catch(() => null);
                return { ok: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error), shot: path };
              } finally {
                frames.follow(await browser.getWindowHandle());
              }
            });
            answer(response, outcome.ok ? 200 : 500, { ...outcome, seconds: (Date.now() - started) / 1000 });
          } else if (url.pathname === '/shot') {
            answer(response, 200, { ok: true, shot: await serial(() => shot(url.searchParams.get('name') ?? 'shot')) });
          } else if (url.pathname === '/frame.png') {
            answer(response, 200, latest, 'image/png');
          } else if (url.pathname === '/live' || url.pathname === '/') {
            answer(response, 200, LIVE_PAGE, 'text/html; charset=utf-8');
          } else if (url.pathname === '/status') {
            answer(response, 200, { site: s.site, live: LIVE, fanslyWrites: fanslyWrites.length, net: netRecords.length, out: OUT, port: PORT, shots, last, idleMinutes: IDLE_MS / 60_000 });
          } else if (url.pathname === '/stop') {
            stopped = true;
            answer(response, 200, { ok: true, stopping: true });
          } else {
            answer(response, 404, { ok: false, error: 'POST /run, GET /shot?name=, /live, /frame.png, /status, POST /stop' });
          }
        } catch (error) {
          answer(response, 500, { ok: false, error: String(error) });
        }
      })();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(PORT, '127.0.0.1', resolve);
    });
    writeFileSync(join(OUT, 'session.ready'), String(PORT));
    lap(`session ready on http://127.0.0.1:${PORT}/live`);
    while (!stopped) {
      if (Date.now() - lastUse > IDLE_MS) {
        lap(`session idle for ${IDLE_MS / 60_000} min: stopping`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await frames.stop();
    await serial(() => Promise.resolve());
    server.close();
    lap('session stopped');
  });
});
