// P3a spike, item 2 and 5: optional Fansly permissions, registration of MAIN + ISOLATED, the reload banner by
// executeScript into open tabs, and what webRequest shows for requests of the page, of another extension and of
// its 429 (architecture §4, §8.2). Everything it learns goes to the spike sink.
'use strict';

const SINK = '__SINK__/log';
const REALM = Math.random().toString(36).slice(2, 8);
const T0 = performance.now();
const ORIGINS = ['http://fansly.test/*', 'http://apiv3.fansly.test/*'];
const MATCHES = ['http://fansly.test/*'];
const log = (kind, data) => fetch(SINK, { method: 'POST', body: JSON.stringify({ src: 'perm-bg', realm: REALM, kind, data }) }).catch(() => undefined);

log('start', { version: browser.runtime.getManifest().version, webRequest: typeof browser.webRequest === 'object' && browser.webRequest !== null });

const pick = (d, withHeaders) => ({
  url: d.url,
  method: d.method,
  type: d.type,
  tabId: d.tabId,
  frameId: d.frameId,
  parentFrameId: d.parentFrameId,
  originUrl: d.originUrl,
  documentUrl: d.documentUrl,
  cookieStoreId: d.cookieStoreId,
  thirdParty: d.thirdParty,
  statusCode: d.statusCode,
  error: d.error,
  requestId: d.requestId,
  headers: withHeaders ? (d.requestHeaders ?? []).map((h) => { const n = h.name.toLowerCase(); return ['authorization', 'fansly-client-id', 'origin', 'referer'].includes(n) ? `${n}=${h.value}` : n; }) : undefined,
});

let attached = false;
function attachWebRequest(why) {
  if (attached || !browser.webRequest) return false;
  const filter = { urls: ['http://apiv3.fansly.test/*'] };
  browser.webRequest.onBeforeSendHeaders.addListener((d) => void log('wr-headers', pick(d, true)), filter, ['requestHeaders']);
  browser.webRequest.onCompleted.addListener((d) => void log('wr-completed', pick(d, false)), filter);
  browser.webRequest.onErrorOccurred.addListener((d) => void log('wr-error', pick(d, false)), filter);
  attached = true;
  log('wr-attached', { why, sinceStart: performance.now() - T0 });
  return true;
}
attachWebRequest('top');

const SCRIPTS = {
  main: { id: 'fansly-main', js: ['reg-main.js'], matches: MATCHES, runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: true },
  iso: { id: 'fansly', js: ['reg-iso.js'], matches: MATCHES, runAt: 'document_start', world: 'ISOLATED', allFrames: false, persistAcrossSessions: true },
};

// Registration changes run one at a time: a start-up sync racing a command fails with «already registered».
let chain = Promise.resolve();
const serial = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
};

async function register(order) {
  await browser.scripting.unregisterContentScripts().catch(() => undefined);
  if (order === 'iso-first') await browser.scripting.registerContentScripts([SCRIPTS.iso, SCRIPTS.main]);
  else if (order === 'separate') {
    await browser.scripting.registerContentScripts([SCRIPTS.iso]);
    await browser.scripting.registerContentScripts([SCRIPTS.main]);
  } else await browser.scripting.registerContentScripts([SCRIPTS.main, SCRIPTS.iso]);
  return browser.scripting.getRegisteredContentScripts();
}

function sync(reason) {
  return serial(() => syncNow(reason));
}

async function syncNow(reason) {
  const t = performance.now();
  const perms = await browser.permissions.getAll();
  const granted = ORIGINS.every((o) => perms.origins.includes(o));
  const { enabled = false, order = 'main-first' } = await browser.storage.local.get(['enabled', 'order']);
  const before = await browser.scripting.getRegisteredContentScripts();
  let action = 'none';
  if (granted && enabled && before.length < 2) {
    await register(order);
    action = 'registered';
  } else if ((!granted || !enabled) && before.length) {
    await browser.scripting.unregisterContentScripts();
    action = 'unregistered';
  }
  log('sync', { reason, granted, enabled, before: before.map((r) => r.id), action, ms: performance.now() - t, sinceStart: performance.now() - T0 });
}

async function notifyOpenTabs(reason) {
  const t = performance.now();
  let tabs = [];
  try {
    tabs = await browser.tabs.query({ url: MATCHES });
  } catch (e) {
    log('notify', { reason, error: String(e) });
    return { error: String(e) };
  }
  const results = [];
  for (const tab of tabs) {
    try {
      const [r] = await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['notice.js'] });
      results.push({ tabId: tab.id, url: tab.url, result: r?.result ?? null, error: r?.error ?? null });
    } catch (e) {
      results.push({ tabId: tab.id, url: tab.url, thrown: String(e) });
    }
  }
  const out = { reason, tabs: tabs.map((x) => ({ id: x.id, url: x.url, title: x.title })), results, ms: performance.now() - t };
  log('notify', out);
  return out;
}

browser.permissions.onAdded.addListener((p) => {
  log('perm-added', p);
  attachWebRequest('onAdded');
  void sync('onAdded').then(() => notifyOpenTabs('onAdded'));
});
browser.permissions.onRemoved.addListener((p) => {
  log('perm-removed', p);
  void sync('onRemoved');
});
browser.runtime.onInstalled.addListener((d) => {
  log('installed', d);
  if (d.reason === 'install' || d.reason === 'update') void notifyOpenTabs(d.reason);
});
void sync('start');

const handlers = {
  ping: () => ({ realm: REALM, uptime: performance.now() - T0, webRequest: !!browser.webRequest, attached }),
  perms: () => browser.permissions.getAll(),
  registered: () => browser.scripting.getRegisteredContentScripts(),
  register: (m) => serial(() => register(m.order)),
  unregister: () => serial(() => browser.scripting.unregisterContentScripts()),
  setEnabled: async (m) => {
    await browser.storage.local.set({ enabled: m.enabled, order: m.order ?? 'main-first' });
    await sync('setEnabled');
    return browser.scripting.getRegisteredContentScripts();
  },
  notify: () => notifyOpenTabs('manual'),
  tabs: (m) => browser.tabs.query({ url: m.url }).then((ts) => ts.map((x) => ({ id: x.id, url: x.url ?? null, title: x.title ?? null }))),
  attach: () => attachWebRequest('manual'),
  // Our own background request to the API: how does webRequest show it (to tell our 429 from a foreign one)?
  selfFetch: () => fetch('http://apiv3.fansly.test:' + new URL(SINK).port + '/api/v1/message/unread?ngsw-bypass=true&src=self-bg', { credentials: 'omit' }).then((r) => r.status, (e) => `error:${e.message}`),
  // A permissions.request NOT from a user gesture: the background has none.
  requestHere: () => browser.permissions.request({ origins: ORIGINS, permissions: ['webRequest'] }).then((r) => `ok:${r}`, (e) => `error:${e.message}`),
};
browser.runtime.onMessage.addListener((m) => {
  const h = handlers[m?.op];
  return h ? Promise.resolve(h(m)) : undefined;
});
