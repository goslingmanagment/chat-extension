// P3a spike, item 1: lazy background chunks. The same file runs as a classic event page and (manifest variant)
// as `background.type: "module"`; it loads chunks with import(runtime.getURL(…)) and reports cost and failures.
'use strict';
const SINK = '__SINK__/log';
const REALM = Math.random().toString(36).slice(2, 8);
const T0 = performance.now();
const log = (kind, data) => fetch(SINK, { method: 'POST', body: JSON.stringify({ src: 'lazy-bg', realm: REALM, kind, data }) }).catch(() => undefined);
log('start', { type: '__BGTYPE__' });

async function load(path) {
  const t = performance.now();
  try {
    const mod = await import(browser.runtime.getURL(path));
    const tImported = performance.now() - t;
    const r = typeof mod.start === 'function' ? await mod.start({ realm: REALM }) : null;
    return { ok: true, ms: tImported, msWithStart: performance.now() - t, r, keys: Object.keys(mod).slice(0, 5) };
  } catch (e) {
    return { ok: false, ms: performance.now() - t, name: e?.name ?? null, message: String(e?.message ?? e) };
  }
}

const handlers = {
  ping: () => ({ realm: REALM, uptime: performance.now() - T0 }),
  import: (m) => load(m.path),
  importTwice: async (m) => [await load(m.path), await load(m.path), await load(`${m.path}?retry=1`)],
  parallel: async (m) => Promise.all([load(m.path), load(m.path)]),
  static: () => globalThis.__staticChunk ?? null,
};
browser.runtime.onMessage.addListener((m) => {
  const h = handlers[m?.op];
  return h ? Promise.resolve(h(m)) : undefined;
});
