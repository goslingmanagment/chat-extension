// A minimal classic WebDriver client for the P3a spike (docs/project-unite/spike.md): geckodriver over HTTP,
// headless Firefox, temporary add-ons, trusted input through WebDriver actions, and the chrome context
// (geckodriver --allow-system-access) for what only the browser itself can tell (memory reports, permissions).

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

export async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function startDriver() {
  const port = await freePort();
  const bin = process.env.GECKODRIVER_PATH ?? 'geckodriver';
  const child = spawn(bin, ['--port', String(port), '--host', '127.0.0.1', '--allow-system-access'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stdout.on('data', (b) => log.push(String(b)));
  child.stderr.on('data', (b) => log.push(String(b)));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${base}/status`);
      if (res.ok) break;
    } catch {
      await sleep(100);
    }
  }
  return { base, child, log, stop: () => child.kill('SIGTERM') };
}

export class Session {
  constructor(base, id) {
    this.base = base;
    this.id = id;
  }

  static async create(base, { prefs = {}, args = ['-headless'] } = {}) {
    const firefoxOptions = { args, prefs };
    if (process.env.FIREFOX_BIN) firefoxOptions.binary = process.env.FIREFOX_BIN;
    const res = await fetch(`${base}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': firefoxOptions, unhandledPromptBehavior: 'ignore' } } }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`session: ${JSON.stringify(body)}`);
    const session = new Session(base, body.value.sessionId);
    session.capabilities = body.value.capabilities;
    return session;
  }

  async cmd(method, path, body) {
    const res = await fetch(`${this.base}/session/${this.id}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json.value).slice(0, 800)}`);
    return json.value;
  }

  installAddon(path, temporary = true) {
    return this.cmd('POST', '/moz/addon/install', { path, temporary });
  }

  uninstallAddon(id) {
    return this.cmd('POST', '/moz/addon/uninstall', { id });
  }

  go(url) {
    return this.cmd('POST', '/url', { url });
  }

  back() {
    return this.cmd('POST', '/back', {});
  }

  forward() {
    return this.cmd('POST', '/forward', {});
  }

  refresh() {
    return this.cmd('POST', '/refresh', {});
  }

  exec(fn, ...args) {
    return this.cmd('POST', '/execute/sync', { script: `return (${fn.toString()}).apply(null, arguments);`, args });
  }

  /** `fn` gets its arguments and must return a promise; the result is awaited in the page. */
  execAsync(fn, ...args) {
    const script = `const done = arguments[arguments.length - 1]; Promise.resolve((${fn.toString()}).apply(null, Array.prototype.slice.call(arguments, 0, -1))).then((v) => done({ ok: true, v }), (e) => done({ ok: false, e: String(e && e.message || e) }));`;
    return this.cmd('POST', '/execute/async', { script, args }).then((r) => {
      if (!r.ok) throw new Error(`execAsync: ${r.e}`);
      return r.v;
    });
  }

  async context(name) {
    await this.cmd('POST', '/moz/context', { context: name });
  }

  /** Runs privileged JS in the parent process (chrome context) and switches back to content. */
  async chrome(fn, ...args) {
    await this.context('chrome');
    try {
      return await this.execAsync(fn, ...args);
    } finally {
      await this.context('content');
    }
  }

  async find(selector) {
    const el = await this.cmd('POST', '/element', { using: 'css selector', value: selector });
    return el[ELEMENT];
  }

  async click(selector) {
    const id = await this.find(selector);
    return this.cmd('POST', `/element/${id}/click`, {});
  }

  async type(selector, text) {
    const id = await this.find(selector);
    return this.cmd('POST', `/element/${id}/value`, { text });
  }

  actions(actions) {
    return this.cmd('POST', '/actions', { actions });
  }

  releaseActions() {
    return this.cmd('DELETE', '/actions');
  }

  /** Trusted pointer clicks on one element, `count` times, with `pauseMs` between them. */
  async clickTimes(selector, count = 1, pauseMs = 0) {
    const id = await this.find(selector);
    const seq = [{ type: 'pointerMove', origin: { [ELEMENT]: id }, x: 0, y: 0 }];
    for (let i = 0; i < count; i += 1) {
      seq.push({ type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 });
      if (pauseMs && i < count - 1) seq.push({ type: 'pause', duration: pauseMs });
    }
    await this.actions([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: seq }]);
    await this.releaseActions();
  }

  /** Trusted key presses (WebDriver key codes, e.g. '' for Enter). */
  async keys(keys) {
    const seq = [];
    for (const key of keys) {
      if (typeof key === 'number') seq.push({ type: 'pause', duration: key });
      else seq.push({ type: 'keyDown', value: key }, { type: 'keyUp', value: key });
    }
    await this.actions([{ type: 'key', id: 'kbd', actions: seq }]);
    await this.releaseActions();
  }

  windowHandles() {
    return this.cmd('GET', '/window/handles');
  }

  newWindow() {
    return this.cmd('POST', '/window/new', { type: 'tab' });
  }

  switchTo(handle) {
    return this.cmd('POST', '/window', { handle });
  }

  closeWindow() {
    return this.cmd('DELETE', '/window');
  }

  delete() {
    return fetch(`${this.base}/session/${this.id}`, { method: 'DELETE' }).catch(() => undefined);
  }
}

export async function waitFor(fn, { timeout = 10_000, every = 50, what = 'condition' } = {}) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    last = await fn();
    if (last) return last;
    await sleep(every);
  }
  throw new Error(`timeout waiting for ${what}`);
}

export { sleep };
