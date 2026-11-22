// The launcher's «Кастомы» on the stand: the fake hub serves a small stub at `/workboard/frame/customs` that speaks the
// extension's frame protocol (handshake v2, as the board's stub in report-board.ts and the forms' in workboard-forms.ts)
// — the key in the address fragment, the port with the key, `ready`, `fetch` through the port to this fake hub,
// `collapse` — and lists the orders the stand's fan cards hold. It is NOT Workboard's screen: Hub draws that (its
// `FrameCustomsScreen`, the customs facts screen), and the same scenario runs against Hub's demo Workboard when
// `CG_SEE_FRAME_ORIGIN` and `CG_SEE_BOARD_API` point there (report-board.ts `forwardBoard`).
//
// The API is Hub's own paths, the stub's own shape where the stand needs no more: `GET /api/v1/custom-orders` (the
// stand's orders), `/done`, `/findings`, `/changes` (nothing), `GET /api/v1/custom-orders/K-n` (the order as the fan
// panel's «Отдан» answers it).

export const CUSTOMS_FRAME_PATH = '/workboard/frame/customs';

/** One row of the stub's list. */
export interface StubCustomRow {
  readonly code: string;
  readonly pageLabel: string;
  readonly fan: string;
  readonly task: string;
  readonly step: string;
  readonly priceMills: number | null;
  readonly deadlineOn: string | null;
  readonly overdueDays: number | null;
}

/** The stub screen: plain HTML and a script, the look of the board's stub, the same handshake. */
export function customsFrameHtml(): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Кастомы (стенд)</title>
<style>
:root { color-scheme: light dark; --ink:#1f1e1b; --muted:#6b675e; --line:#e4e0d6; --bg:#faf9f5; --raised:#fff; --clay:#c96442; --bad:#b4372f; }
@media (prefers-color-scheme: dark) { :root { --ink:#e2dfd3; --muted:#a39e93; --line:#3a372f; --bg:#1b1a17; --raised:#262420; --clay:#e08566; --bad:#e0796f; } }
* { box-sizing: border-box; }
body { margin: 0; font: 13px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--ink); }
header { display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 12px 0 20px; border-bottom: 1px solid var(--line); background: var(--raised); }
header b { font-size: 16px; font-weight: 600; }
.stub { color: var(--muted); }
.grow { flex: 1; }
button { font: inherit; height: 28px; padding: 0 10px; border-radius: 7px; border: 1px solid var(--line); background: var(--raised); color: var(--ink); cursor: pointer; }
button:hover { border-color: var(--clay); color: var(--clay); }
#log { padding: 6px 20px; border-bottom: 1px solid var(--line); color: var(--muted); min-height: 30px; white-space: pre-wrap; }
table { width: calc(100% - 40px); margin: 16px 20px; border-collapse: collapse; background: var(--raised); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
tr[data-code] { cursor: pointer; }
tr[data-code]:hover td { background: var(--bg); }
td.late { color: var(--bad); font-weight: 600; }
td.num { font-variant-numeric: tabular-nums; text-align: right; }
#nobody { padding: 40px; text-align: center; font-size: 15px; }
</style></head>
<body>
<header><b>Кастомы</b><span class="stub">Стенд: заглушка экрана Workboard</span><span class="grow"></span>
<button id="refused">Запрос мимо списка</button><button id="collapse">Свернуть</button></header>
<div id="log">Жду порт от расширения…</div>
<table><thead><tr><th>Заказ</th><th>Фан</th><th>Что снять</th><th>Шаг</th><th>Срок фану</th><th class="num">Сумма</th></tr></thead><tbody id="rows"></tbody></table>
<script>
(() => {
  let port = null, seq = 0;
  const waiting = new Map();
  const log = (line) => { document.getElementById('log').textContent = line; };
  const usd = (m) => m === null ? '' : '$' + (m / 1000).toFixed(2);
  const send = (message) => port && port.postMessage(message);
  const api = (method, path, body) => new Promise((resolve) => { const id = 'q' + (++seq); waiting.set(id, resolve); send({ t: 'fetch', id, method, path, body: body === undefined ? null : JSON.stringify(body) }); });
  const draw = (orders) => {
    document.getElementById('rows').replaceChildren(...orders.map((one) => {
      const tr = document.createElement('tr'); tr.dataset.code = one.code;
      const cells = [one.code + ' · ' + one.pageLabel, one.fan, one.task, one.step, one.deadlineOn ?? '', usd(one.priceMills)];
      cells.forEach((text, index) => {
        const td = document.createElement('td'); td.textContent = text;
        if (index === 4 && one.overdueDays) td.className = 'late';
        if (index === 5) td.className = 'num';
        tr.append(td);
      });
      tr.onclick = () => api('GET', '/api/v1/custom-orders/' + one.code).then((answer) => {
        if (answer.error || answer.status >= 300) { log(one.code + ': ' + (answer.error || answer.status)); return; }
        const order = JSON.parse(answer.body).order; log('заказ через порт: ' + order.code + ', ' + order.stateWord);
      });
      return tr;
    }));
  };
  const take = (message) => {
    if (!message || typeof message !== 'object') return;
    if (message.t === 'fetch:result') { const done = waiting.get(message.id); waiting.delete(message.id); if (done) done(message); return; }
    if (message.t === 'show') { load(); }
  };
  const load = () => api('GET', '/api/v1/custom-orders').then((answer) => {
    if (answer.error || answer.status >= 300) { log('доска: ' + (answer.error || answer.status)); return; }
    const orders = JSON.parse(answer.body).orders; draw(orders);
    log('порт пришёл (v2, ключ), заказы загружены через порт (' + answer.status + '): ' + orders.length);
  });
  // Handshake v2 (R-protocol): the key from the address fragment, read once and taken out of the address; the first
  // port from the parent with that key wins; «ready» on it. Nothing is ever posted to the parent.
  const params = new URLSearchParams(location.hash.slice(1));
  const key = params.get('k');
  history.replaceState(null, '', location.pathname + location.search);
  const nobody = () => { document.body.innerHTML = '<div id="nobody">Откройте «Кастомы» из ChatGoose</div>'; };
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
  });
  setTimeout(() => { if (port === null) nobody(); }, 10000);
  document.getElementById('collapse').onclick = () => send({ t: 'collapse' });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') send({ t: 'collapse' }); });
  // A finding's resolution needs the password: the extension never passes it.
  document.getElementById('refused').onclick = () => api('POST', '/api/v1/custom-orders/findings/1', { action: 'dismiss', reason: 'test' }).then((answer) => log('запрос мимо списка: ' + (answer.error || answer.status)));
})();
</script>
</body></html>`;
}

/** A request of the stub's API: what the fake hub answers, or null — not the stub's. */
export function customsBoardAnswer(
  method: string,
  path: string,
  stand: { readonly rows: () => readonly StubCustomRow[]; readonly order: (code: string) => { readonly status: number; readonly body: unknown } },
): { readonly status: number; readonly body: unknown; readonly what: string } | null {
  if (method !== 'GET') return null;
  if (path === '/api/v1/custom-orders') return { status: 200, body: { orders: stand.rows() }, what: 'board' };
  if (path === '/api/v1/custom-orders/done') return { status: 200, body: { given: [], closed: [], capped: false }, what: 'done' };
  if (path === '/api/v1/custom-orders/findings') return { status: 200, body: { findings: [] }, what: 'findings' };
  if (path === '/api/v1/custom-orders/changes') return { status: 200, body: { changes: [] }, what: 'changes' };
  const code = /^\/api\/v1\/custom-orders\/(K-[1-9][0-9]{0,17})$/.exec(path)?.[1];
  if (code !== undefined) return { ...stand.order(code), what: 'order' };
  return null;
}
