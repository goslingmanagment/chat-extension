// P3a spike driver (docs/project-unite/spike.md). Headless Firefox under geckodriver, the loopback world of
// lib/servers.mjs, small test extensions from ext/, the MAIN prototype from main-proto/. Never touches the network
// beyond loopback. Run inside the pinned CI Firefox image (tools/ci/e2e-docker-local.sh), from packages/testing:
//   node spike/run.mjs [lazy] [perm] [gesture] [main] [nav]      (no argument: all)
// Prints one JSON document with every measurement.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { QUIET_FIREFOX_PREFS } from '../src/stand/egress-sink.ts';
import { frameMix, groupsResponse, message, newMessageFrame, text } from './lib/data.mjs';
import { prepare, UUIDS } from './lib/ext.mjs';
import { startWorld } from './lib/servers.mjs';
import { Session, sleep, startDriver, waitFor } from './lib/wd.mjs';
import { buildMainProto } from './main-proto/build.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../..');
const out = resolve(repo, '.cache/spike');
mkdirSync(out, { recursive: true });
const wanted = new Set(process.argv.slice(2));
const want = (name) => wanted.size === 0 || wanted.has(name);

const results = { firefox: null, startedAt: new Date().toISOString() };
const world = await startWorld();
const driver = await startDriver();
const GID = '900000000000000001';

function prefs(extra = {}) {
  return {
    ...QUIET_FIREFOX_PREFS,
    'network.dns.localDomains': 'fansly.test,apiv3.fansly.test,wsv3.fansly.test',
    'network.dns.disableIPv6': true,
    'network.proxy.type': 0,
    'dom.security.https_first': false,
    'dom.security.https_first_schemeless': false,
    'privacy.reduceTimerPrecision': false,
    'browser.shell.checkDefaultBrowser': false,
    'extensions.webextensions.uuids': JSON.stringify(UUIDS),
    'extensions.webextOptionalPermissionPrompts': false,
    ...extra,
  };
}

const logsOf = (src, kind) => world.logs.filter((l) => l.src === src && (!kind || l.kind === kind));
const page = (path) => `${world.origin}${path}`;
const extUrl = (id, path) => `moz-extension://${UUIDS[id]}/${path}`;

async function withSession(name, extra, fn) {
  const session = await Session.create(driver.base, { prefs: prefs(extra) });
  results.firefox ??= `${session.capabilities.browserName} ${session.capabilities.browserVersion}`;
  // Partial results survive a failure: the experiment fills `r` as it goes.
  const r = (results[name] = {});
  world.logs.length = 0;
  world.apiLog.length = 0;
  try {
    const out = await fn(session, r);
    if (out && out !== r) Object.assign(r, out);
  } catch (error) {
    r.failed = String(error?.stack ?? error);
  } finally {
    await session.delete();
  }
}

async function consoleErrors(s, needle) {
  return s.chrome(async (n) => {
    const all = Services.console.getMessageArray() ?? [];
    return all
      .map((m) => (m instanceof Ci.nsIScriptError ? `${m.sourceName}:${m.lineNumber} ${m.errorMessage}` : String(m.message)))
      .filter((t) => !n || t.includes(n))
      .slice(-20);
  }, needle);
}

// ───────────────────────── item 1: lazy background chunks ─────────────────────────
function synthChunk(kb) {
  let body = 'export async function start(kit) { return { started: true, realm: kit.realm, n: fns.length }; }\nconst fns = [];\n';
  let i = 0;
  while (body.length < kb * 1024) {
    body += `function f${i}(a, b) { const o = { k: a, s: "${text(40)}", n: [${i}, ${i * 3}, ${i * 7}] }; for (let j = 0; j < b; j += 1) { o.k += j * ${i % 13}; if (o.k > ${i * 100}) break; } return o.s.length + o.k; }\nfns.push(f${i});\n`;
    i += 1;
  }
  return body;
}
function realChunk() {
  const bg = resolve(repo, 'apps/extension/.output/firefox-mv3/background.js');
  if (!existsSync(bg)) return null;
  return `export async function start(kit) { return { started: true, realm: kit.realm, real: true }; }\nexport function payload() {\n${readFileSync(bg, 'utf8')}\n}\n`;
}

if (want('lazy')) {
  const real = realChunk();
  const chunks = { 'bg/ok.js': 'export async function start(kit) { return { started: true, realm: kit.realm }; }\n', 'bg/ok200.js': synthChunk(200), 'bg/ok800.js': real ?? synthChunk(800) };
  for (const variant of ['classic', 'module']) {
    const background = variant === 'classic' ? '{ "scripts": ["bg.js"] }' : '{ "scripts": ["bg-static.js", "bg.js"], "type": "module" }';
    const dir = prepare('lazy', { SINK: world.sink, VERSION: '1.0', BACKGROUND: background, BGTYPE: variant }, chunks);
    await withSession(`lazy-${variant}`, { 'extensions.background.idle.timeout': 3000 }, async (s, r) => {
      Object.assign(r, { chunkSizes: Object.fromEntries(Object.entries(chunks).map(([k, v]) => [k, v.length])), realChunk: real !== null });
      const t0 = Date.now();
      await s.installAddon(dir);
      r.installMs = Date.now() - t0;
      await s.go(extUrl('lazy@cg-spike.test', 'ctl.html'));
      const cmd = (c) => s.execAsync((c) => window.cmd(c), c);
      r.ping1 = await cmd({ op: 'ping' });
      r.static = await cmd({ op: 'static' });
      r.okSmall = await cmd({ op: 'import', path: 'bg/ok.js' });
      // Cold cost (fetch + parse + evaluate), five times each with a fresh URL so nothing comes from the module map.
      r.cold = {};
      for (const path of ['bg/ok.js', 'bg/ok200.js', 'bg/ok800.js']) {
        const times = [];
        for (let i = 0; i < 5; i += 1) times.push((await cmd({ op: 'import', path: `${path}?cold=${i}` })).ms);
        r.cold[path] = { ms: times.map((x) => +x.toFixed(2)), median: +times.sort((a, b) => a - b)[2].toFixed(2) };
      }
      r.ok200 = await cmd({ op: 'import', path: 'bg/ok200.js' });
      r.ok800 = await cmd({ op: 'import', path: 'bg/ok800.js' });
      r.ok800Again = await cmd({ op: 'import', path: 'bg/ok800.js' });
      r.parallel = await cmd({ op: 'parallel', path: 'bg/ok200.js?p=1' });
      r.missing = await cmd({ op: 'importTwice', path: 'bg/missing.js' });
      r.evalError = await cmd({ op: 'importTwice', path: 'bg/evalerror.js' });
      r.syntax = await cmd({ op: 'import', path: 'bg/syntax.js' });
      r.depsMissing = await cmd({ op: 'import', path: 'bg/deps-missing.js' });
      r.once = await cmd({ op: 'importTwice', path: 'bg/once.js' });
      // Restart: the event page sleeps after 3 s idle (pref) and a message wakes a new realm.
      await sleep(6000);
      r.ping2 = await cmd({ op: 'ping' });
      r.restarted = r.ping2.realm !== r.ping1.realm;
      r.afterRestart = { ok800Cold: await cmd({ op: 'import', path: 'bg/ok800.js' }), once: await cmd({ op: 'importTwice', path: 'bg/once.js' }), evalError: await cmd({ op: 'import', path: 'bg/evalerror.js' }) };
      r.starts = logsOf('lazy-bg', 'start').map((l) => l.realm);
      r.consoleErrors = await consoleErrors(s, 'cg-spike-lazy').catch((e) => [`console read failed: ${e.message}`]);
      return r;
    });
  }
}

// ───────────── item 2 + 5: permissions, registration, banner, WAR; webRequest of neighbours ─────────────
if (want('perm')) {
  await withSession('perm', { 'extensions.background.idle.timeout': 3000 }, async (s, r) => {
    const perm = 'perm@cg-spike.test';
    const cmd = (c) => s.execAsync((c) => window.cmd(c), c);
    const orderOf = () => s.exec(() => document.documentElement.dataset.order ?? null);
    const handles = {};
    // Tab A: a Fansly tab open BEFORE install and grant.
    await s.go(page('/plain?tab=A'));
    handles.A = (await s.windowHandles())[0];
    let t = Date.now();
    await s.installAddon(prepare('perm', { SINK: world.sink, VERSION: '1.0' }));
    r.install1Ms = Date.now() - t;
    await s.newWindow();
    handles.ctl = (await s.windowHandles()).find((h) => h !== handles.A);
    await s.switchTo(handles.ctl);
    await s.go(extUrl(perm, 'ctl.html'));
    r.beforeGrant = { ping: await cmd({ op: 'ping' }), perms: await cmd({ op: 'perms' }), tabs: await cmd({ op: 'tabs', url: ['http://fansly.test/*'] }) };
    r.beforeGrant.registerWithoutPermission = await cmd({ op: 'register', order: 'main-first' }).catch((e) => `error:${e.message}`);
    await s.switchTo(handles.A);
    await s.refresh();
    r.beforeGrant.orderAfterReload = await orderOf();
    r.beforeGrant.war = await s.execAsync((a, b) => Promise.all([window.__war(a), window.__war(b)]), extUrl(perm, 'lazy/probe.js'), extUrl(perm, 'nowar/probe.js'));
    await s.switchTo(handles.ctl);
    await cmd({ op: 'unregister' });
    await cmd({ op: 'setEnabled', enabled: true, order: 'main-first' });
    r.requestWithoutGesture = await s.execAsync(() => window.requestWithoutGesture());
    r.requestFromBackground = await cmd({ op: 'requestHere' });
    // «Включить Fansly»: a trusted click, permissions.request synchronously in its handler.
    t = Date.now();
    await s.clickTimes('#grant');
    r.grant = await waitFor(() => s.exec(() => (window.grantResult && window.grantResult !== 'pending' ? window.grantResult : null)), { what: 'grant', timeout: 10_000 }).catch((e) => `timeout:${e.message}`);
    await waitFor(() => logsOf('perm-bg', 'notify').length > 0, { what: 'notify after grant', timeout: 10_000 }).catch(() => undefined);
    r.afterGrant = {
      ms: Date.now() - t,
      perms: await cmd({ op: 'perms' }),
      ping: await cmd({ op: 'ping' }),
      registered: await cmd({ op: 'registered' }),
      tabs: await cmd({ op: 'tabs', url: ['http://fansly.test/*'] }),
      notify: logsOf('perm-bg', 'notify').at(-1)?.data ?? null,
      log: world.logs.filter((l) => l.src === 'perm-bg' && ['perm-added', 'sync', 'wr-attached'].includes(l.kind)).map((l) => ({ kind: l.kind, data: l.data })),
    };
    await s.switchTo(handles.A);
    r.afterGrant.bannerInA = await s.exec(() => !!document.querySelector('[data-host="cg-notice"]'));
    // §8.2 wake chains on the stand (a temporary add-on; P3b repeats them on signed builds). The event page sleeps
    // after 2 s idle (pref); then a request of the page: does webRequest wake it and deliver the request?
    const bgState = () => s.chrome((id) => WebExtensionPolicy.getByID(id)?.extension?.backgroundState ?? null, perm);
    const pageRequest = (src) => s.exec((src) => {
      const x = new XMLHttpRequest();
      x.open('GET', `${location.protocol}//apiv3.${location.host}/api/v1/account/me?ngsw-bypass=true&src=${src}`);
      x.setRequestHeader('authorization', `page-token-${src}`);
      x.send();
    }, src);
    const wakeStep = async (src) => {
      world.logs.length = 0;
      await sleep(6000);
      const asleep = await bgState();
      await pageRequest(src);
      await sleep(2000);
      return { stateBefore: asleep, stateAfter: await bgState(), startedAgain: logsOf('perm-bg', 'start').length, delivered: logsOf('perm-bg', 'wr-headers').filter((l) => l.data.url.includes(src)).length, attachedAt: logsOf('perm-bg', 'wr-attached').map((l) => l.data.why) };
    };
    r.wake = { state0: await bgState() };
    r.wake.afterGrantListenersOnly = await wakeStep('wakeA');
    // A message wakes it (a new realm registers webRequest at top level now that the API exists), then sleep again.
    await s.switchTo(handles.ctl);
    r.wake.pingBetween = await cmd({ op: 'ping' });
    await s.switchTo(handles.A);
    r.wake.afterTopLevelStart = await wakeStep('wakeB');
    await s.switchTo(handles.ctl);
    r.wake.ping = await cmd({ op: 'ping' });
    await s.switchTo(handles.A);
    // Order of MAIN and ISOLATED for each way of registering.
    r.order = {};
    for (const order of ['main-first', 'iso-first', 'separate']) {
      await s.switchTo(handles.ctl);
      await cmd({ op: 'register', order });
      await s.switchTo(handles.A);
      await s.refresh();
      r.order[order] = { order: await orderOf(), pageSaw: await s.exec(() => window.__pageSaw) };
    }
    await s.switchTo(handles.ctl);
    await cmd({ op: 'register', order: 'main-first' });
    r.registeredDetails = await cmd({ op: 'registered' });
    await s.switchTo(handles.A);
    await s.refresh();
    await s.exec(() => document.dispatchEvent(new CustomEvent('cg-spike-iso')));
    r.isoImports = await waitFor(() => s.exec(() => document.documentElement.dataset.isoResult ?? null), { what: 'iso imports' }).catch((e) => e.message);
    r.warAfterGrant = await s.execAsync((a) => window.__war(a), extUrl(perm, 'lazy/probe.js'));

    // ── item 5: what webRequest shows; neighbours (MV2, MV3) in the same tab; a foreign 429 ──
    world.logs.length = 0;
    world.apiLog.length = 0;
    await s.installAddon(prepare('neighbour-mv2'));
    await s.installAddon(prepare('neighbour-mv3'));
    await s.go(page(`/messages/${GID}?tab=wr`));
    await sleep(1500);
    await s.exec(() => document.dispatchEvent(new CustomEvent('cg-spike-nb')));
    await sleep(1500);
    world.state.unread429 = true;
    await s.exec(() => void window.__app.api('GET', 'message/unread?limit=100&src=page', null));
    await sleep(800);
    world.state.unread429 = false;
    r.webRequest = {
      neighbours: await s.exec(() => ({ mv2: document.documentElement.getAttribute('data-nb-mv2'), mv3: document.documentElement.getAttribute('data-nb-mv3') })),
      seen: world.logs.filter((l) => l.src === 'perm-bg' && l.kind.startsWith('wr-')).map((l) => ({ kind: l.kind, ...l.data })),
      arrivedAtServer: world.apiLog.map((e) => ({ method: e.method, path: e.path, src: e.src, origin: e.origin, auth: e.auth, status: e.status })),
    };
    await s.switchTo(handles.ctl);
    world.logs.length = 0;
    r.webRequest.selfFetch = { status: await cmd({ op: 'selfFetch' }) };
    await sleep(500);
    r.webRequest.selfFetch.seen = world.logs.filter((l) => l.src === 'perm-bg' && l.kind.startsWith('wr-')).map((l) => ({ kind: l.kind, ...l.data }));
    await s.switchTo(handles.A);
    await s.uninstallAddon('nb2@cg-spike.test');
    await s.uninstallAddon('nb3@cg-spike.test');

    // ── update: a temporary reinstall with a higher version = ADDON_UPGRADE ──
    await s.go(page('/plain?tab=A2'));
    r.beforeUpdate = { order: await orderOf(), reg: await s.exec(() => window.__cgReg) };
    world.logs.length = 0;
    t = Date.now();
    await s.installAddon(prepare('perm', { SINK: world.sink, VERSION: '1.1' }));
    const installReturned = Date.now() - t;
    // A load started right after the install call returned: does it get the scripts? (The old ctl tab is gone:
    // Firefox closes the pages of an extension that reloads.)
    r.update = { installReturnedMs: installReturned, handlesAfter: (await s.windowHandles()).length };
    const before = new Set(await s.windowHandles());
    await s.newWindow();
    handles.C = (await s.windowHandles()).find((h) => !before.has(h));
    await s.switchTo(handles.C);
    await s.go(page('/plain?tab=C'));
    r.update.tabLoadedRightAfterInstall = { order: await orderOf(), sinceInstallMs: Date.now() - t };
    await waitFor(() => logsOf('perm-bg', 'sync').length > 0, { what: 'sync after update', timeout: 10_000 }).catch(() => undefined);
    await waitFor(() => logsOf('perm-bg', 'notify').length > 0, { what: 'notify after update', timeout: 10_000 }).catch(() => undefined);
    r.update.log = world.logs.filter((l) => l.src === 'perm-bg' && ['start', 'installed', 'sync', 'notify', 'wr-attached'].includes(l.kind)).map((l) => ({ kind: l.kind, at: l.at - t, data: l.data }));
    await s.refresh();
    r.update.tabCAfterReload = await orderOf();
    await s.switchTo(handles.A);
    r.update.oldTab = {
      order: await orderOf(),
      oldMainStill: await s.exec(() => window.__cgReg?.version ?? null),
      banner: await s.exec(() => !!document.querySelector('[data-host="cg-notice"]')),
    };
    await s.exec(() => {
      delete document.documentElement.dataset.isoResult;
      document.dispatchEvent(new CustomEvent('cg-spike-iso'));
    });
    await sleep(800);
    r.update.oldIsolated = await s.exec(() => document.documentElement.dataset.isoResult ?? 'no answer (old isolated script gone)');
    await s.refresh();
    r.update.afterReload = { order: await orderOf(), reg: await s.exec(() => window.__cgReg) };
    await s.switchTo(handles.C);
    await s.go(extUrl(perm, 'ctl.html'));
    handles.ctl = handles.C;
    r.update.registered = await cmd({ op: 'registered' });
    r.update.perms = await cmd({ op: 'perms' });
    // ── revoke and grant again ──
    world.logs.length = 0;
    await s.execAsync(() => window.remove());
    await sleep(800);
    r.revoke = { registered: await cmd({ op: 'registered' }), log: logsOf('perm-bg').map((l) => ({ kind: l.kind, data: l.data })) };
    await s.switchTo(handles.A);
    await s.refresh();
    r.revoke.orderAfterReload = await orderOf();
    // …and grant again: one more trusted click.
    await s.switchTo(handles.ctl);
    world.logs.length = 0;
    await s.clickTimes('#grant');
    await waitFor(() => logsOf('perm-bg', 'sync').some((l) => l.data.action === 'registered'), { what: 'regrant', timeout: 10_000 }).catch(() => undefined);
    r.regrant = { log: logsOf('perm-bg').map((l) => ({ kind: l.kind, data: l.data })), registered: (await cmd({ op: 'registered' })).map((x) => x.id) };
    await s.switchTo(handles.A);
    await s.refresh();
    r.regrant.orderAfterReload = await orderOf();
    r.revoke.bannerKept = await s.exec(() => !!document.querySelector('[data-host="cg-notice"]'));
    return r;
  });
}

// ───────────────────────── items 3, 4, 6: the MAIN prototype ─────────────────────────
let mainDir = null;
if (want('gesture') || want('main') || want('nav')) {
  results.mainSizes = await buildMainProto(out);
  mainDir = prepare('main', {}, { 'fansly-main.js': readFileSync(join(out, 'fansly-main.spike.js'), 'utf8') });
}

async function openChat(s, query = '') {
  await s.go(page(`/messages/${GID}${query}`));
  await waitFor(() => s.exec(() => window.__app && window.__app.sockets > 0 && !!window.__cgSpike), { what: 'chat ready' });
  await sleep(300);
}
const dump = async (s) => {
  await s.exec(() => document.dispatchEvent(new CustomEvent('cg-spike-dump')));
  return JSON.parse(await s.exec(() => document.documentElement.dataset.isoDump ?? 'null'));
};

if (want('gesture')) {
  await withSession('gesture', {}, async (s) => {
    await s.installAddon(mainDir);
    const runs = [];
    const scenario = async (name, { query, act, text: msg = 'hello there', state = {}, wait = 700 }) => {
      Object.assign(world.state, { echo: 'after', postDelayMs: 30, echoDelayMs: 30 }, state);
      await openChat(s, query);
      if (msg !== null) await s.type('app-messages-conversation-route textarea.message-input', msg);
      await act();
      await sleep(wait);
      const g = await s.exec(() => ({ log: window.__cgSpike.gesture.log, sent: window.__cgSpike.gesture.sent, app: window.__app.sent, swallowed: window.__nbSwallowed ?? 0 }));
      const iso = await dump(s);
      runs.push({ name, query, gesture: g.log, sent: g.sent, pageSent: g.app, swallowed: g.swallowed, isoSent: iso?.stats?.sent ?? null });
    };
    const click = () => s.clickTimes('app-messages-conversation-route .send-button');
    const enter = () => s.keys(['']);
    await scenario('sync-click', { query: '?s=sync', act: click });
    await scenario('sync-enter', { query: '?s=sync', act: enter });
    await scenario('micro-click', { query: '?s=micro', act: click });
    await scenario('micro3-enter', { query: '?s=micro3', act: enter });
    await scenario('micro-last-click (page listener last on window)', { query: '?s=micro-last', act: click });
    await scenario('timer-click', { query: '?s=timer', act: click });
    await scenario('messagechannel-click', { query: '?s=channel', act: click });
    await scenario('media-click (upload first)', { query: '?s=media', act: click });
    await scenario('route-change-before-send', { query: '?s=route-before', act: click });
    await scenario('ack-then-post-click', { query: '?s=ack', act: click });
    await scenario('post-then-ack-enter', { query: '?s=ack-after', act: enter });
    await scenario('double-post-one-gesture', { query: '?s=double', act: click });
    await scenario('two-quick-clicks', { query: '?s=keep', act: () => s.clickTimes('app-messages-conversation-route .send-button', 2, 0) });
    await scenario('two-quick-enters', { query: '?s=keep', act: () => s.keys(['', '']) });
    await scenario('swallowed-by-neighbour-then-normal', {
      query: '?s=sync&nb=1',
      text: 'this is forbidden',
      act: async () => {
        await click();
        await sleep(400);
        await s.exec(() => window.__app.setText(''));
        await s.type('app-messages-conversation-route textarea.message-input', 'clean text');
        await click();
      },
    });
    await scenario('neighbour-hook-normal-send', { query: '?s=sync&nb=1', act: click });
    await scenario('untrusted-click-and-enter', { query: '?s=sync', act: async () => {
      await s.exec(() => window.__app.fakeClick());
      await sleep(200);
      await s.exec(() => window.__app.setText('again'));
      await s.exec(() => window.__app.fakeEnter());
    } });
    await scenario('echo-before-receipt', { query: '?s=sync', act: click, state: { echo: 'before', postDelayMs: 150 } });
    await scenario('echo-after-receipt', { query: '?s=sync', act: click, state: { echo: 'after', echoDelayMs: 150 } });
    await scenario('no-echo', { query: '?s=sync', act: click, state: { echo: 'none' } });
    await scenario('route-change-after-click (slow response)', {
      query: '?s=sync',
      state: { postDelayMs: 300 },
      act: async () => {
        await click();
        await s.exec(() => window.__app.router.go('/messages/900000000000000007'));
      },
    });
    return { runs };
  });
}

if (want('main')) {
  await withSession('main', {}, async (s, r) => {
    await s.installAddon(mainDir);
    await openChat(s);
    r.install = await s.exec(() => ({ install: window.__cgSpikeInstall, pageSaw: window.__pageSaw, wsIsProxy: Function.prototype.toString.call(WebSocket), protoCtor: XMLHttpRequest.prototype.constructor === XMLHttpRequest }));
    // Frames through the real socket: the busiest page's mix.
    const frames = frameMix(10_000);
    r.frameBytes = { p50: frames.map((f) => f.length).sort((a, b) => a - b)[5000], max: Math.max(...frames.map((f) => f.length)) };
    const before = await s.exec(() => ({ ...window.__cgSpike.w.m }));
    for (let i = 0; i < frames.length; i += 500) world.push(frames.slice(i, i + 500));
    await waitFor(() => s.exec((n) => window.__cgSpike.w.m.frames >= n, before.frames + frames.length), { what: 'frames', timeout: 60_000 }).catch(() => undefined);
    await sleep(500);
    const after = await s.exec(() => ({ m: { ...window.__cgSpike.w.m }, emit: window.__cgSpike.emit.stats(), bytes: window.__cgSpike.store.bytes(), chats: window.__cgSpike.store.chats.size }));
    r.socket = { frames: after.m.frames - before.frames, meanMs: (after.m.frameMs - before.frameMs) / (after.m.frames - before.frames), maxMs: after.m.frameMax, emitter: after.emit, storeBytes: after.bytes, chats: after.chats, iso: (await dump(s))?.stats };
    // Per-type microbenchmark inside the page (same parse, no socket).
    const msg1k = newMessageFrame(message({ groupId: GID, senderId: '600000000000000000', content: text(600) }));
    const msg5k = newMessageFrame(message({ groupId: GID, senderId: '600000000000000000', content: text(4800) }));
    r.perType = await s.exec(
      (sets) => {
        const out = {};
        for (const [name, list] of Object.entries(sets)) {
          const t0 = performance.now();
          for (let i = 0; i < 2000; i += 1) window.__cgSpike.handleFrame(list[i % list.length]);
          const ours = (performance.now() - t0) / 2000;
          const t1 = performance.now();
          for (let i = 0; i < 2000; i += 1) {
            const f = JSON.parse(list[i % list.length]);
            if (f.t === 10000) JSON.parse(JSON.parse(f.d).event);
          }
          out[name] = { oursMs: ours, threeParsesMs: (performance.now() - t1) / 2000, bytes: list[0].length };
        }
        return out;
      },
      { typing: frameMix(100).filter((f) => f.includes('typingAnnounceEvent')), receipt: frameMix(100).filter((f) => f.includes('ackCommand')), message1k: [msg1k], message5k: [msg5k] },
    );
    // A 115 KB /messaging/groups answer: through the page's own XHR (deferred path) and directly.
    const groups = world.state.groups;
    r.groups = { bytes: groups.length };
    const m0 = await s.exec(() => ({ ...window.__cgSpike.w.m }));
    await s.exec(() => void window.__app.api('GET', 'messaging/groups?sortOrder=1&flags=0&limit=20&offset=0', null));
    await sleep(1500);
    const m1 = await s.exec(() => ({ ...window.__cgSpike.w.m }));
    r.groups.viaXhr = { loadendMs: m1.xhrMax, deferred: m1.deferred - m0.deferred, deferredMs: m1.deferredMs - m0.deferredMs, deferredMax: m1.deferredMax };
    r.groups.direct = await s.exec((text) => {
      const parse = [];
      const ours = [];
      for (let i = 0; i < 20; i += 1) {
        const t0 = performance.now();
        JSON.parse(text);
        parse.push(performance.now() - t0);
        const t1 = performance.now();
        window.__cgSpike.xhr.handle('groups', 'messaging/groups', '', text, null);
        ours.push(performance.now() - t1);
      }
      const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
      return { jsonParseMedianMs: med(parse), jsonParseMaxMs: Math.max(...parse), oursMedianMs: med(ours), oursMaxMs: Math.max(...ours) };
    }, groups);
    // A response outside the table: the cost of saying «not ours» (classification by responseURL only).
    r.nonTable = await s.exec((api) => {
      const urls = [`${api}/api/v1/account/settings?ngsw-bypass=true`, 'https://cdn3.fansly.com/123/456.jpeg?ngsw-bypass=true&Policy=xyz', `${api}/api/v1/timeline/home?before=0&after=0&ngsw-bypass=true`];
      const out = {};
      for (const url of urls) {
        const t0 = performance.now();
        for (let i = 0; i < 1e5; i += 1) window.__cgSpike.classify(url);
        out[url.slice(0, 60)] = (performance.now() - t0) / 1e5;
      }
      return out;
    }, world.api);
    // Snapshot of an open chat, then with three 115 KB answers queued in front of it.
    await s.exec((gid) => {
      document.documentElement.dataset.snapGroup = gid;
      document.documentElement.dataset.snapFeature = 'reply';
    }, GID);
    world.push(Array.from({ length: 60 }, (_, i) => newMessageFrame(message({ groupId: GID, senderId: i % 2 ? '600000000000000000' : '700000000000000001', content: text(50 + i * 7) }))));
    await sleep(500);
    for (let k = 0; k < 5; k += 1) {
      await s.exec(() => document.dispatchEvent(new CustomEvent('cg-spike-snapshot')));
      await sleep(150);
    }
    await s.exec(() => {
      for (let i = 0; i < 3; i += 1) window.__app.api('GET', `messaging/groups?offset=${i}`, null);
    });
    await sleep(60);
    await s.exec(() => document.dispatchEvent(new CustomEvent('cg-spike-snapshot')));
    await sleep(1500);
    r.snapshots = (await dump(s))?.stats?.snapshots;
    // A slow bridge consumer: no acks → credits run out, the queue is bounded, one fx.gap.
    await openChat(s, '?slow=1');
    const burst = frameMix(20000).filter((f) => !f.includes('typingAnnounceEvent') && !f.includes('ackCommand'));
    for (let i = 0; i < burst.length; i += 400) world.push(burst.slice(i, i + 400));
    await sleep(2000);
    r.slowConsumer = { pushed: burst.length, emitter: await s.exec(() => window.__cgSpike.emit.stats()), iso: (await dump(s))?.stats };
    return r;
  });

  // Memory calibration: fill the store to its ceilings and compare our estimate with Firefox's memory reporter.
  await withSession('memory', {}, async (s, r) => {
    await s.installAddon(mainDir);
    await openChat(s, '?mem=1');
    const measure = (marker) =>
      s.chrome(async (marker) => {
        const mgr = Cc['@mozilla.org/memory-reporter-manager;1'].getService(Ci.nsIMemoryReporterManager);
        await new Promise((ok) => mgr.minimizeMemoryUsage(ok));
        const sums = { window: 0, jsRealm: 0, strings: 0, objects: 0 };
        await new Promise((ok) =>
          mgr.getReports(
            (process, path, kind, units, amount) => {
              if (units !== Ci.nsIMemoryReporter.UNITS_BYTES || !path.startsWith('explicit/window-objects/') || !path.includes(marker)) return;
              sums.window += amount;
              if (path.includes('/js-realm(') || path.includes('/js-zone(')) sums.jsRealm += amount;
              if (path.includes('/strings/')) sums.strings += amount;
              if (path.includes('/objects/') || path.includes('/gc-heap/')) sums.objects += amount;
            },
            null,
            ok,
            null,
            false,
          ),
        );
        return sums;
      }, marker);
    const est = () => s.exec(() => ({ total: window.__cgSpike.store.bytes(), texts: window.__cgSpike.store.textBytes(), chats: window.__cgSpike.store.chats.size, recs: [...window.__cgSpike.store.chats.values()].reduce((n, c) => n + c.recs.length, 0) }));
    const fill = (opts) =>
      s.exec((o) => {
        const sp = window.__cgSpike;
        // Lift the limits for the calibration: we want the raw per-item cost.
        sp.limits.totalBytes = 1e12;
        sp.limits.textBytes = 1e12;
        let id = 812000000000000000n;
        for (let c = 0; c < o.chats; c += 1) {
          const gid = String(900100000000000000n + BigInt(c));
          const fan = String(600100000000000000n + BigInt(c));
          const msgs = [];
          for (let i = 0; i < o.recs; i += 1) {
            id += 4096n;
            // Unique texts: SpiderMonkey deduplicates equal strings when it tenures them.
            const filler = o.cyr ? 'привет как дела ' : 'hello how are you ';
            const content = c < o.textChats && i >= o.recs - o.texts ? `${c}.${i}.${id} ${filler.repeat(Math.ceil(o.len / filler.length))}`.slice(0, o.len) : '';
            msgs.push({ id: String(id), groupId: gid, senderId: i % 2 ? fan : '700000000000000001', type: 1, content, createdAt: 1700000000 + i, correlationId: '0', inReplyTo: null, attachments: [] });
          }
          // Through JSON so the strings are what JSON.parse makes, as on the page.
          sp.store.ingest(gid, JSON.parse(JSON.stringify(msgs)), 1, 1, true);
        }
      }, opts);
    r.steps = [];
    const m0 = await measure('mem=1');
    const e0 = await est();
    r.steps.push({ step: 'empty', ...m0, est: e0 });
    await fill({ chats: 300, recs: 120, textChats: 0, texts: 0, len: 0 });
    const m1 = await measure('mem=1');
    const e1 = await est();
    r.steps.push({ step: '300 chats × 120 records, no texts', ...m1, est: e1, deltaWindow: m1.window - m0.window, deltaEst: e1.total - e0.total });
    await openChat(s, '?mem=2');
    const m2a = await measure('mem=2');
    const e2a = await est();
    await fill({ chats: 20, recs: 60, textChats: 20, texts: 60, len: 150 });
    const m2 = await measure('mem=2');
    const e2 = await est();
    r.steps.push({ step: '20 chats × 60 texts of 150 Latin-1 chars', ...m2, est: e2, deltaWindow: m2.window - m2a.window, deltaEst: e2.total - e2a.total, deltaTexts: e2.texts - e2a.texts });
    await openChat(s, '?mem=3');
    const m3a = await measure('mem=3');
    const e3a = await est();
    await fill({ chats: 20, recs: 60, textChats: 20, texts: 60, len: 150, cyr: true });
    const m3 = await measure('mem=3');
    const e3 = await est();
    r.steps.push({ step: '20 chats × 60 texts of 150 Cyrillic chars', ...m3, est: e3, deltaWindow: m3.window - m3a.window, deltaEst: e3.total - e3a.total, deltaTexts: e3.texts - e3a.texts });
    // The same 36 000 records in a compact per-chat layout (ids as strings, the rest in typed arrays).
    await openChat(s, '?mem=4');
    const m4a = await measure('mem=4');
    await s.exec(() => {
      const keep = [];
      let id = 813000000000000000n;
      for (let c = 0; c < 300; c += 1) {
        const ids = [];
        for (let i = 0; i < 120; i += 1) {
          id += 4096n;
          ids.push(String(id));
        }
        const parsed = JSON.parse(JSON.stringify(ids));
        keep.push({ gid: String(900200000000000000n + BigInt(c)), ids: parsed, at: new Float64Array(120), meta: new Uint8Array(120), type: new Uint8Array(120), corr: new Array(120).fill(null) });
      }
      Object.defineProperty(window, '__compact', { value: keep });
    });
    const m4 = await measure('mem=4');
    r.steps.push({ step: 'compact layout: 300 chats × 120 records', ...m4, deltaWindow: m4.window - m4a.window });
    return r;
  });
}

// ───────────────────────── item 6: Navigation API in the isolated world ─────────────────────────
if (want('nav')) {
  await withSession('nav', {}, async (s) => {
    await s.installAddon(mainDir);
    await openChat(s);
    await s.exec(() => {
      window.__navMain.length = 0;
    });
    await dump(s);
    const ops = [];
    const isoBefore = (await dump(s))?.nav?.length ?? 0;
    for (let i = 0; i < 200; i += 1) {
      const kind = ['push', 'push', 'replace', 'back', 'forward', 'same', 'aba'][i % 7];
      const target = `/messages/9000000000000${String(1000 + i).padStart(5, '0')}`;
      const before = await s.exec(() => [window.__navMain.length, location.pathname]);
      if (kind === 'push') await s.exec((p) => window.__app.router.go(p), target);
      else if (kind === 'replace') await s.exec((p) => window.__app.router.replace(p), target);
      else if (kind === 'back') await s.back();
      else if (kind === 'forward') await s.forward();
      else if (kind === 'same') await s.exec(() => window.__app.router.go(location.pathname));
      else if (kind === 'aba') {
        const a = before[1];
        await s.exec((p) => window.__app.router.go(p), target);
        await s.exec((p) => window.__app.router.go(p), a);
      }
      await sleep(30);
      const after = await s.exec(() => [window.__navMain.length, location.pathname]);
      ops.push({ kind, from: before[1], to: after[1], mainEvents: after[0] - before[0] });
    }
    const main = await s.exec(() => window.__navMain);
    const iso = ((await dump(s))?.nav ?? []).slice(isoBefore);
    const count = (list, type) => list.filter((e) => e.type === type).length;
    const byKind = {};
    for (const op of ops) byKind[op.kind] = (byKind[op.kind] ?? 0) + 1;
    const cec = (list) => list.filter((e) => e.type === 'currententrychange');
    const nav = (list) => list.filter((e) => e.type === 'navigate');
    return {
      ops: byKind,
      main: { navigate: count(main, 'navigate'), currententrychange: count(main, 'currententrychange'), popstate: count(main, 'popstate'), first: main.slice(0, 6) },
      iso: { navigate: count(iso, 'navigate'), currententrychange: count(iso, 'currententrychange'), popstate: count(iso, 'popstate'), first: iso.slice(0, 6), noApi: iso.some((e) => e.type === 'no-navigation-api') },
      samePathInListener: {
        mainCec: cec(main).length,
        isoCec: cec(iso).length,
        isoNavigateOldPath: nav(iso).filter((e) => e.dest && e.path !== e.dest).length,
        isoNavigateSamePath: nav(iso).filter((e) => e.dest && e.path === e.dest).length,
      },
      expectedCec: ops.reduce((n, op) => n + (op.kind === 'aba' ? 2 : 1), 0),
    };
  });
}

driver.stop();
await world.close();
results.finishedAt = new Date().toISOString();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
console.log('SPIKE-RESULTS-BEGIN');
console.log(JSON.stringify(results, null, 1));
console.log('SPIKE-RESULTS-END');
process.exit(0);
