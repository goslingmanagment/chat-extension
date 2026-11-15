// The fan panel's windows of Workboard on the stand (products package R5): the fake hub serves a small stub at
// `/workboard/frame/custom` and `/workboard/frame/ask` that speaks the extension's frame protocol (handshake v2, as the
// board's stub in report-board.ts) — the key in the address fragment, the port with the key, `ready`, `fetch` through
// the port to this fake hub, `done` and `collapse` — with the page and the fan the panel filled in. It is NOT Workboard's
// form: Hub draws that (`RecordFromSaleModal`, `AskModal` in their frame screens), and the same scenarios run against
// Hub's demo when `CG_SEE_FRAME_ORIGIN` points the frames there.
//
// The API is Hub's own shape, as far as the stand needs it: `POST /api/v1/custom-orders` (`customOrderCreate`: a page,
// the fan, the card's task and price) records the order into the fan's card; `POST /api/v1/team/questions`
// (`teamQuestionAsk`) keeps the question for the run's `hub-calls.json`.

export const FORM_FRAME_PATHS = { custom: '/workboard/frame/custom', ask: '/workboard/frame/ask' } as const;
export type FormScreen = keyof typeof FORM_FRAME_PATHS;

export const formScreenOf = (path: string): FormScreen | null => (path === FORM_FRAME_PATHS.custom ? 'custom' : path === FORM_FRAME_PATHS.ask ? 'ask' : null);

const TITLES: Readonly<Record<FormScreen, string>> = { custom: 'Записать кастом', ask: 'Спросить' };

/** The stub window: plain HTML and a script, the look of Workboard's modal, the same handshake as the board's stub. */
export function formFrameHtml(screen: FormScreen): string {
  const fields =
    screen === 'custom'
      ? `<label>Что заказал<textarea id="task" rows="4" placeholder="Видео 5 минут, в красном"></textarea></label>
<label>Цена<input id="price" placeholder="100$"></label>`
      : `<label>О чём<select id="kind"><option value="discount_over_50">Скидка больше 50%</option><option value="free_paid">Бесплатно платное</option><option value="custom_price">Цена кастома</option><option value="whale_terms">Условия для кита</option></select></label>
<label>Вопрос<textarea id="text" rows="4" placeholder="Можно ему скидку 60% на набор?"></textarea></label>`;
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${TITLES[screen]} (стенд)</title>
<style>
:root { color-scheme: light dark; --ink:#1f1e1b; --muted:#6b675e; --line:#e4e0d6; --bg:#faf9f5; --raised:#fff; --clay:#c96442; --scrim:rgb(31 30 27 / .38); }
@media (prefers-color-scheme: dark) { :root { --ink:#e2dfd3; --muted:#a39e93; --line:#3a372f; --bg:#1b1a17; --raised:#262420; --clay:#e08566; --scrim:rgb(0 0 0 / .55); } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 13px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: var(--scrim); color: var(--ink); }
.modal { width: min(460px, calc(100vw - 32px)); background: var(--raised); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 24px 60px -24px rgb(0 0 0 / .5); }
.head { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.head b { font-size: 15px; font-weight: 600; flex: 1; }
.stub { color: var(--muted); font-size: 12px; }
.body { display: grid; gap: 12px; padding: 14px 16px; }
.kv { display: grid; grid-template-columns: 70px 1fr; gap: 4px 10px; color: var(--muted); }
.kv span:nth-child(even) { color: var(--ink); font-weight: 600; }
label { display: grid; gap: 4px; color: var(--muted); }
textarea, input, select { font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; }
.foot { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid var(--line); }
button { font: inherit; height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--raised); color: var(--ink); cursor: pointer; }
button.go { background: var(--clay); border-color: var(--clay); color: #fff; }
#log { color: var(--muted); min-height: 18px; }
#nobody { padding: 40px; text-align: center; font-size: 15px; background: var(--raised); border-radius: 12px; }
</style></head>
<body>
<div class="modal" id="modal">
<div class="head"><b>${TITLES[screen]}</b><span class="stub">Стенд: заглушка окна Workboard</span></div>
<div class="body">
<div class="kv"><span>Страница</span><span id="page"></span><span>Фан</span><span id="fan"></span></div>
${fields}
<div id="log">Жду порт от расширения…</div>
</div>
<div class="foot"><button id="close">Отмена</button><button class="go" id="go">${screen === 'custom' ? 'Записать' : 'Спросить'}</button></div>
</div>
<script>
(() => {
  const screen = ${JSON.stringify(screen)};
  let port = null, seq = 0;
  const waiting = new Map();
  const log = (line) => { document.getElementById('log').textContent = line; };
  const send = (message) => port && port.postMessage(message);
  const api = (method, path, body) => new Promise((resolve) => { const id = 'q' + (++seq); waiting.set(id, resolve); send({ t: 'fetch', id, method, path, body: body === undefined ? null : JSON.stringify(body) }); });
  const search = new URLSearchParams(location.search);
  const page = search.get('page') || '', fan = search.get('fan') || '', name = search.get('name') || '';
  document.getElementById('page').textContent = page;
  document.getElementById('fan').textContent = name ? name + ' (' + fan + ')' : fan;
  const params = new URLSearchParams(location.hash.slice(1));
  const key = params.get('k');
  history.replaceState(null, '', location.pathname + location.search);
  const nobody = () => { document.body.innerHTML = '<div id="nobody">Откройте из ChatGoose</div>'; };
  if (window.parent === window || !key) nobody();
  window.addEventListener('message', (event) => {
    if (port !== null || event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.cg !== 'report-board/port' || data.key !== key || !event.ports[0]) return;
    if (data.v !== 2) { log('Обновите ChatGoose: версия ' + data.v); return; }
    port = event.ports[0];
    port.onmessage = (e) => { const m = e.data; if (m && m.t === 'fetch:result') { const done = waiting.get(m.id); waiting.delete(m.id); if (done) done(m); } };
    port.postMessage({ t: 'ready', v: 2 });
    log('');
  });
  setTimeout(() => { if (port === null) nobody(); }, 10000);
  document.getElementById('close').onclick = () => send({ t: 'collapse' });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') send({ t: 'collapse' }); });
  document.getElementById('go').onclick = () => {
    if (screen === 'custom') {
      const task = document.getElementById('task').value.trim();
      if (!task) { log('Напишите, что заказал'); return; }
      const price = document.getElementById('price').value.trim();
      api('POST', '/api/v1/custom-orders', { pageLabel: page, fan, card: price ? { task, price } : { task } }).then((answer) => {
        if (answer.error || answer.status >= 300) { log('Не записалось: ' + (answer.error || answer.status)); return; }
        send({ t: 'done', screen: 'custom', code: JSON.parse(answer.body).order.code });
      });
    } else {
      const text = document.getElementById('text').value.trim();
      if (!text) { log('Напишите вопрос'); return; }
      api('POST', '/api/v1/team/questions', { kind: document.getElementById('kind').value, pageLabel: page, fanRef: fan, text, door: 'extension' }).then((answer) => {
        if (answer.error || answer.status >= 300) { log('Не ушло: ' + (answer.error || answer.status)); return; }
        send({ t: 'done', screen: 'ask' });
      });
    }
  };
})();
</script>
</body></html>`;
}

/** «100$», «$49.99», «120» → mills; anything else — none (Hub keeps the card's price as words). */
export function stubPriceMills(price: unknown): number | null {
  if (typeof price !== 'string') return null;
  const match = /(\d{1,6})(?:[.,](\d{1,2}))?/.exec(price);
  if (match === null) return null;
  return (Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))) * 10;
}
