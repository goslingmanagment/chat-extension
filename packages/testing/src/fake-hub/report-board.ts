// The board «Отчёт» on the stand (hub package R, 2026-11-15): until Hub's Workboard serves its frame page, the fake hub
// serves a small stub at `/workboard/frame/report` that speaks the extension's protocol (R-protocol.md, handshake v2) —
// the key in the address fragment, the port with the key, `ready`, `state`, `collapse`, `find`, `fetch` through the port to this fake hub, `copy`, `statement` — so every part
// of the extension's side is seen working in `pnpm see report-*`. It is NOT the board: Hub's R2 draws that, and the same
// scenarios run against Hub's demo board when `CG_SEE_FRAME_ORIGIN` points the frames there.
//
// The API under `/api/v1/shift-reports`, `/api/v1/sale-claims` and `/api/v1/client/sale-sightings` is this stub's own
// shape (the real routes are Hub's, package R1): the board of the shift with sales on the stand's pages, a comment that
// saves, and the sightings the extension reports (kept for the run's `hub-calls.json` and `reportSightings()`).

import { STAND_WALLET } from '../../fixture-fansly/src/protocol';
import { STAND_TRANSACTIONS } from '../../fixture-chatspace/src/protocol';
import { WORLD } from '../scenarios/hub';

export const REPORT_FRAME_PATH = '/workboard/frame/report';

/** A sale of the stub board, in the protocol's `find` form plus what the stub draws. */
export interface StubSale {
  readonly transactionId: number;
  readonly pageLabel: string;
  readonly platform: 'fansly' | 'onlyfans';
  readonly platformRef: string | null;
  readonly kind: string;
  readonly occurredAt: string;
  readonly netMills: number;
  readonly grossMills: number | null;
  readonly fanName: string | null;
  readonly fanHandle: string | null;
  readonly words: string;
  readonly mine: boolean;
}

const FANSLY_KIND: Readonly<Record<number, string>> = { 2110: 'media', 7101: 'tip', 15001: 'subscription' };
const FANSLY_WORDS: Readonly<Record<string, string>> = { media: 'Media Sale to', tip: 'Tip from', subscription: 'Subscription Sale to' };

function fanslySale(index: number, id: number, mine = true): StubSale {
  const row = STAND_WALLET[index] ?? STAND_WALLET[0];
  if (row === undefined) throw new Error('no stand wallet');
  const kind = FANSLY_KIND[row.type] ?? 'tip';
  return {
    transactionId: id,
    pageLabel: WORLD.pages.fansly.pageLabel,
    platform: 'fansly',
    platformRef: row.transactionId,
    kind,
    occurredAt: new Date(row.createdAt).toISOString(),
    netMills: row.amount,
    grossMills: null,
    fanName: row.fanName,
    fanHandle: row.fanHandle,
    words: `${FANSLY_WORDS[kind] ?? ''} ${row.fanName}`,
    mine,
  };
}

function onlyfansSale(index: number, id: number, mine = true): StubSale {
  const row = STAND_TRANSACTIONS[index] ?? STAND_TRANSACTIONS[0];
  if (row === undefined) throw new Error('no stand transactions');
  const fan = row.description.split(' ').at(-1) ?? null;
  const kind = row.description.startsWith('Tip') ? 'tip' : row.description.startsWith('Subscription') ? 'subscription' : 'message';
  return {
    transactionId: id,
    pageLabel: WORLD.pages.one.pageLabel,
    platform: 'onlyfans',
    platformRef: null,
    kind,
    occurredAt: new Date(row.at).toISOString(),
    netMills: row.netMills,
    grossMills: row.grossMills,
    fanName: fan,
    fanHandle: null,
    words: row.description,
    mine,
  };
}

/** The stub's shift: sales of both stands, one on a later page of each list, one the site does not show. */
export function stubBoard(): { readonly shiftId: number; readonly sales: readonly StubSale[] } {
  const ghost: StubSale = { ...fanslySale(2, 9003), platformRef: '981337000000000001', words: 'Tip from mossrain' };
  return {
    shiftId: 41,
    sales: [fanslySale(0, 9001), fanslySale(4, 9002), fanslySale(13, 9004), ghost, onlyfansSale(0, 9101), onlyfansSale(3, 9102), onlyfansSale(13, 9103)],
  };
}

/**
 * The stub frame page: plain HTML and a script, no app. Accepts the first port from its parent that carries the key of
 * its own address (any origin: the stand's sites run on loopback ports of their own), asks the board through it, draws the sales by page, and says
 * every protocol message it gets in a line at the top, for the pictures.
 */
export function reportFrameHtml(): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Отчёт смены (стенд)</title>
<style>
:root { color-scheme: light dark; --ink:#1f1e1b; --muted:#6b675e; --line:#e4e0d6; --bg:#faf9f5; --raised:#fff; --clay:#c96442; --clay-bg:#fbf0ea; --sel:#fbf0ea; }
@media (prefers-color-scheme: dark) { :root { --ink:#e2dfd3; --muted:#a39e93; --line:#3a372f; --bg:#1b1a17; --raised:#262420; --clay:#e08566; --clay-bg:#3f2b21; --sel:rgb(63 43 33 / .62); } }
* { box-sizing: border-box; }
body { margin: 0; font: 13px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--ink); }
header { display: flex; align-items: center; gap: 12px; height: 42px; padding: 0 8px 0 16px; border-bottom: 1px solid var(--line); background: var(--raised); }
header b { font-weight: 600; }
.chip { height: 22px; padding: 0 9px; border-radius: 99px; background: var(--clay-bg); color: var(--clay); font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; }
.stub { color: var(--muted); }
.grow { flex: 1; }
button { font: inherit; height: 26px; padding: 0 9px; border-radius: 7px; border: 1px solid var(--line); background: var(--raised); color: var(--ink); cursor: pointer; }
button:hover { border-color: var(--clay); color: var(--clay); }
#log { padding: 6px 16px; border-bottom: 1px solid var(--line); color: var(--muted); min-height: 30px; white-space: pre-wrap; }
.cols { display: flex; gap: 16px; padding: 12px 16px; align-items: flex-start; }
.col { flex: 1; min-width: 0; background: var(--raised); border: 1px solid var(--line); border-radius: 10px; }
.col h3 { margin: 0; padding: 10px 12px; font-size: 13px; border-bottom: 1px solid var(--line); }
.r { padding: 7px 12px; border-bottom: 1px solid var(--line); }
.r:last-child { border-bottom: 0; }
.r.is-hl { background: var(--sel); }
.r1 { display: flex; gap: 8px; }
.r1 .grow { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.r2 { display: flex; gap: 10px; color: var(--muted); }
.r2 a { color: var(--clay); text-decoration: none; cursor: pointer; }
.r2 a:hover { text-decoration: underline; }
.foot { display: flex; gap: 8px; align-items: center; padding: 10px 16px; border-top: 1px solid var(--line); position: fixed; left: 0; right: 0; bottom: 0; background: var(--raised); }
.foot input { flex: 1; height: 26px; border-radius: 7px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); padding: 0 8px; }
#nobody { padding: 40px; text-align: center; font-size: 15px; }
</style></head>
<body>
<header><b>Отчёт смены</b><span class="chip" id="chip">Черновик</span><span class="stub">Стенд: заглушка доски Hub</span><span class="grow"></span>
<button id="copy">Скопировать пост</button><button id="statement">Обновить выписку</button><button id="refused">Запрос мимо списка</button><button id="collapse">Свернуть</button></header>
<div id="log">Жду порт от расширения…</div>
<div class="cols" id="cols"></div>
<div class="foot"><input id="comment" placeholder="Комментарий для следующей смены"><button id="save">Сохранить</button><span id="total"></span></div>
<script>
(() => {
  let port = null, board = null, seq = 0, hl = null;
  const waiting = new Map();
  const log = (line) => { document.getElementById('log').textContent = line; };
  const usd = (m) => '$' + (m / 1000).toFixed(2);
  const time = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const send = (message) => port && port.postMessage(message);
  const api = (method, path, body) => new Promise((resolve) => { const id = 'q' + (++seq); waiting.set(id, resolve); send({ t: 'fetch', id, method, path, body: body === undefined ? null : JSON.stringify(body) }); });
  const mine = () => board.sales.filter((s) => s.mine);
  const state = () => send({ t: 'state', shiftId: board.shiftId, phase: 'draft', chip: 'Черновик', count: mine().length, totalMills: mine().reduce((a, s) => a + s.netMills, 0), needsMe: false });
  const draw = () => {
    const pages = [...new Set(board.sales.map((s) => s.pageLabel))];
    const cols = document.getElementById('cols');
    cols.replaceChildren(...pages.map((page) => {
      const col = document.createElement('div'); col.className = 'col';
      const h = document.createElement('h3'); h.textContent = page; col.append(h);
      for (const s of board.sales.filter((x) => x.pageLabel === page)) {
        const r = document.createElement('div'); r.className = 'r' + (hl === s.transactionId ? ' is-hl' : ''); r.dataset.id = String(s.transactionId);
        r.innerHTML = '<div class="r1"><span class="grow"></span><span></span></div><div class="r2"><a></a><span>моя</span></div>';
        r.querySelector('.grow').textContent = s.words;
        r.querySelector('.r1 span:last-child').textContent = s.platform === 'fansly' ? '+' + usd(s.netMills) : usd(s.grossMills) + ' ' + usd(s.netMills);
        const a = r.querySelector('a');
        a.textContent = s.platform === 'fansly' ? '#…' + (s.platformRef || '').slice(-4) : time(s.occurredAt);
        a.title = 'Показать на сайте';
        a.onclick = () => { log('find ' + a.textContent); send({ t: 'find', sale: { transactionId: s.transactionId, pageLabel: s.pageLabel, platform: s.platform, platformRef: s.platformRef, kind: s.kind, occurredAt: s.occurredAt, netMills: s.netMills, grossMills: s.grossMills, fanName: s.fanName, fanHandle: s.fanHandle } }); };
        col.append(r);
      }
      return col;
    }));
    document.getElementById('total').textContent = 'Ваши продажи: ' + mine().length + ', ' + usd(mine().reduce((a, s) => a + s.netMills, 0));
  };
  const take = (message) => {
    if (!message || typeof message !== 'object') return;
    if (message.t === 'fetch:result') { const done = waiting.get(message.id); waiting.delete(message.id); if (done) done(message); return; }
    if (message.t === 'show') { hl = message.transactionId ?? null; log('show' + (hl ? ' ' + hl : '')); if (board) draw(); return; }
    if (message.t === 'found') { log('found ' + message.transactionId + ': ' + (message.ok ? 'да' : message.words)); return; }
    if (message.t === 'copy:result') { log('copy: ' + (message.ok ? 'скопировано' : 'не вышло')); return; }
  };
  // Handshake v2 (R-protocol): the key from the address fragment, read once and taken out of the address; the first
  // port from the parent with that key wins; «ready» on it. Nothing is ever posted to the parent.
  const params = new URLSearchParams(location.hash.slice(1));
  const key = params.get('k');
  history.replaceState(null, '', location.pathname + location.search);
  const nobody = () => { document.body.innerHTML = '<div id="nobody">Откройте отчёт из ChatGoose</div>'; };
  if (window.parent === window || !key) nobody();
  window.addEventListener('message', (event) => {
    if (port !== null || event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.cg !== 'report-board/port' || data.key !== key || !event.ports[0]) return;
    if (data.v !== 2) { log('Обновите ChatGoose: версия ' + data.v); return; }
    port = event.ports[0];
    port.onmessage = (e) => take(e.data);
    port.postMessage({ t: 'ready', v: 2 });
    log('порт пришёл от ' + event.origin);
    api('GET', '/api/v1/shift-reports/current').then((answer) => {
      if (answer.error) { log('fetch: ' + answer.error); return; }
      board = JSON.parse(answer.body); draw(); state(); log('порт пришёл (v2, ключ), доска загружена через порт (' + answer.status + ')');
    });
  });
  setTimeout(() => { if (port === null) nobody(); }, 10000);
  document.getElementById('collapse').onclick = () => send({ t: 'collapse' });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') send({ t: 'collapse' }); });
  document.getElementById('copy').onclick = () => send({ t: 'copy', text: 'Смена 12 нояб.: ' + (board ? mine().length : 0) + ' продаж' });
  document.getElementById('statement').onclick = () => { send({ t: 'statement', pages: board ? [...new Set(board.sales.filter((s) => s.platform === 'onlyfans').map((s) => s.pageLabel))] : [] }); log('statement отправлен'); };
  document.getElementById('refused').onclick = () => api('GET', '/api/v1/auth/devices').then((answer) => log('запрос мимо списка: ' + (answer.error || answer.status)));
  document.getElementById('save').onclick = () => api('PUT', '/api/v1/shift-reports/' + (board ? board.shiftId : 0) + '/comment', { comment: document.getElementById('comment').value }).then((answer) => log('комментарий: ' + (answer.error || answer.status)));
})();
</script>
</body></html>`;
}

/** A request of the stub's API: what the fake hub answers, or null — not the stub's. */
export function reportBoardAnswer(method: string, path: string, body: string): { readonly status: number; readonly body: unknown; readonly what: string } | null {
  if (method === 'GET' && path === '/api/v1/shift-reports/current') return { status: 200, body: stubBoard(), what: 'board' };
  if (method === 'PUT' && /^\/api\/v1\/shift-reports\/\d+\/comment$/.test(path)) {
    let comment: unknown;
    try {
      comment = (JSON.parse(body) as { comment?: unknown }).comment ?? null;
    } catch {
      comment = null;
    }
    return { status: 200, body: { comment }, what: 'comment' };
  }
  if (method === 'POST' && path === '/api/v1/client/sale-sightings') return { status: 200, body: { recorded: true }, what: 'sightings' };
  if (/^\/api\/v1\/(shift-reports|sale-claims)(\/|$)/.test(path)) return { status: 200, body: {}, what: 'other' };
  return null;
}
