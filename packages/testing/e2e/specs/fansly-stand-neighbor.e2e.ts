// The Fansly stand next to the FBuddy-like neighbour in Firefox (R20 P6d; S5
// §6; FS-ACC-1, FS-CO-4): FBuddy runs for every chatter (X34), so every later
// Fansly PR that touches the tap, the XHR observer, the dock, insertion,
// sending or the header runs itself next to this neighbour in `off` and
// `after` (plan.md §0). Here, before our extension is on the page at all (its
// Fansly entries come with P7a0), the reference those PRs compare against:
// - in `after` its scripts come in by `<script src>` as FBuddy's do and its
//   hooks sit on the XHR prototype and `fetch`, never on the constructors;
// - our absence changes nothing for the page: the same scenario gives the
//   page the same requests and results with the neighbour `off` and `after`,
//   and the neighbour saw every request of the page;
// - its CSS is on the page (`contain: size`, the two-row composer), its
//   `<body>` layer sits above everything, its widgets after the composer's
//   actions; its guard swallows a trusted send; its translate key is stopped
//   on the field; its own requests come under the token issued to it, and a
//   429 can be its alone.
// Mode by mode at DOM level, over the same fake Fansly:
// src/fake-fansly/neighbor/*.dom.test.ts.

import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { NEIGHBOR_TAGS } from '../../src/fake-fansly/neighbor/dom';
import { GUARD_TOAST } from '../../src/fake-fansly/neighbor/guard';
import { FBUDDY_IDS, NEIGHBOR_PART_ATTRIBUTE, NEIGHBOR_SCRIPT_PATH, type NeighborConfig } from '../../src/fake-fansly/neighbor/protocol';
import { BODY_LAYER_TAG } from '../../src/fake-fansly/neighbor/ui';
import { callNeighbor, neighborState, openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyIds, fanslyStandServer } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';

type Ids = Awaited<ReturnType<typeof fanslyIds>>;

/** The page's API calls on the fake Fansly since `since`, as `METHOD path` with the ids of this run's sends cut. */
async function pageCalls(since: number): Promise<string[]> {
  return (await fakeFansly().calls('page', since)).map((entry) => `${entry.method ?? ''} ${(entry.path ?? '').replace(/before=\d+/, 'before=*')}`).sort();
}

async function waitFor(check: () => Promise<boolean>, what: string, timeout = 5000): Promise<void> {
  await browser.waitUntil(check, { timeout, interval: 50, timeoutMsg: what });
}

/** A run of the same scenario: a chat, a trusted send, a fan's answer, another chat. */
async function scenario(config: Partial<NeighborConfig>, ids: Ids): Promise<{ readonly calls: string[]; readonly seen: string[] | null; readonly sendDuring: unknown; readonly messages: number }> {
  const fake = fakeFansly();
  await fake.command({ op: 'reset' });
  const [a, b] = ids.groups as [string, string];
  // The page sends its read marks at once (the site waits 1–3 s at random): the scenario's requests do not hang on luck.
  await openWithNeighbor('/messages?stand-ack-delay=0', config);
  // Both sides' marks after the page's start: the scenario's part only.
  await waitFor(async () => (await callFansly('socket'))?.state === 'connected', 'the page’s socket');
  await browser.pause(300);
  const since = await fake.mark();
  const logMark = config.mode === 'off' ? 0 : ((await callNeighbor('log')).at(-1)?.seq ?? 0);
  const pageMark = (await callFansly('journal')).at(-1)?.seq ?? 0;
  await callFansly('open', a);
  await waitFor(async () => ((await callFansly('list'))?.messages ?? 0) > 0 && (await callFansly('list'))?.groupId === a, 'the first chat');
  await $(FANSLY_MAIN.field).click();
  // Short: one typing announcement however slow the keys (the page announces at most every 3 s).
  await browser.keys('hello');
  await browser.keys(Key.Enter);
  await waitFor(async () => (await fake.calls('page', since)).some((entry) => entry.route === 'message.send' && entry.status === 200), 'the send');
  const before = (await callFansly('list'))?.messages ?? 0;
  await fake.command({ op: 'message', groupId: a, text: 'a fan answers' });
  await waitFor(async () => ((await callFansly('list'))?.messages ?? 0) === before + 1, 'the fan’s message');
  const messages = (await callFansly('list'))?.messages ?? 0;
  await callFansly('open', b);
  await waitFor(async () => (await callFansly('list'))?.groupId === b && ((await callFansly('list'))?.messages ?? 0) > 0, 'the second chat');
  await browser.pause(500);
  const sendDuring = (await callFansly('journal', pageMark)).find((entry) => entry.type === 'api' && entry['method'] === 'POST' && /^\/api\/v1\/message\?/.test(String(entry['path'])))?.['during'];
  const seen =
    config.mode === 'off'
      ? null
      : (await callNeighbor('log', logMark)).map((entry) => `${entry.method} ${new URL(entry.url).pathname}${new URL(entry.url).search}`.replace(/before=\d+/, 'before=*')).sort();
  await fake.assertOursClean(since, `the scenario with the neighbour ${config.mode ?? 'after'}`);
  return { calls: await pageCalls(since), seen, sendDuring, messages };
}

describe('the Fansly stand next to the FBuddy-like neighbour', () => {
  useNetworkTrap();
  let ids: Ids;
  let journalStart = 0;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    journalStart = await fanslyStandServer.mark();
    await browser.setWindowSize(1440, 900);
    await openWithNeighbor('/messages', { mode: 'off' });
    ids = await fanslyIds();
  });

  after(async () => {
    // Nothing but the page's own loads (its neighbour's scripts among them) reached the Fansly stand.
    const entries = await fanslyStandServer.journal(journalStart);
    expect(entries.filter((entry) => entry.origin !== 'asset')).toEqual([]);
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
  });

  it('after: its scripts come in by <script src> — the bridge stays, the hook leaves — and its hooks are on the XHR prototype and fetch, never on the constructors', async () => {
    await openWithNeighbor(`/messages/${String(ids.groups[0])}`, { mode: 'after' });
    const page = await browser.execute(
      (bridgeId: string, part: string, src: string) => {
        const native = (fn: unknown): boolean => typeof fn === 'function' && Function.prototype.toString.call(fn).includes('[native code]');
        const bridge = document.getElementById(bridgeId);
        const first = document.head.querySelector('script');
        return {
          boot: first?.getAttribute(part) === 'boot' && first.getAttribute('src') === src,
          bridge: bridge === null ? null : { part: bridge.getAttribute(part), src: bridge.getAttribute('src'), version: bridge.getAttribute('data-fbuddy-version'), parent: bridge.parentElement?.localName },
          hookScripts: document.querySelectorAll(`script[${part}="hook"]`).length,
          hook: (window as unknown as Record<string, unknown>)['__FBUDDY_NETWORK_HOOK__'],
          xhrConstructor: native(window.XMLHttpRequest),
          socketConstructor: native(window.WebSocket),
          open: native(Reflect.get(XMLHttpRequest.prototype, 'open')),
          send: native(Reflect.get(XMLHttpRequest.prototype, 'send')),
          setRequestHeader: native(Reflect.get(XMLHttpRequest.prototype, 'setRequestHeader')),
          fetch: native(Reflect.get(window, 'fetch')),
          mapSet: native(Reflect.get(Map.prototype, 'set')),
        };
      },
      FBUDDY_IDS.bridgeScript,
      NEIGHBOR_PART_ATTRIBUTE,
      NEIGHBOR_SCRIPT_PATH,
    );
    expect(page).toEqual({
      boot: true,
      bridge: { part: 'bridge', src: NEIGHBOR_SCRIPT_PATH, version: '2', parent: 'html' },
      hookScripts: 0,
      hook: true,
      xhrConstructor: true,
      socketConstructor: true,
      open: false,
      send: false,
      setRequestHeader: false,
      fetch: false,
      // Its MAIN script found the stand's view registry and gave Map.prototype back.
      mapSet: true,
    });
    expect((await neighborState()).mapPatch).toEqual({ installed: true, found: true, restored: true });
  });

  it('our absence changes nothing: the page makes the same requests with the same results with the neighbour off and after — and the neighbour saw each one', async () => {
    const off = await scenario({ mode: 'off' }, ids);
    const after = await scenario({ mode: 'after' }, ids);
    expect(after.calls).toEqual(off.calls);
    expect(after.messages).toBe(off.messages);
    // The page's send inside the trusted Enter, both times.
    expect(off.sendDuring).toEqual({ type: 'keydown', isTrusted: true, eventPhase: 2 });
    expect(after.sendDuring).toEqual(off.sendDuring);
    // Every request of the page went past its hooks, once.
    expect(after.seen).toEqual(after.calls);
  });

  it('its CSS on the page — `contain: size`, the two-row composer — its <body> layer first and on top, its widgets after the composer’s actions', async () => {
    const measure = () =>
      browser.execute((tag: string, widgets: string[]) => {
        const wrapper = document.querySelector('app-messages-route .messages-wrapper');
        const actions = document.querySelector('app-messages-conversation-route app-group-message-input .collapsable-actions');
        const entry = document.querySelector('app-messages-conversation-route app-group-message-input .message-entry');
        const layer = document.body.firstElementChild;
        const inner = layer?.shadowRoot?.querySelector('.fb-body-layer');
        const toasts = layer?.shadowRoot?.querySelector('section.fb-toasts');
        const after: string[] = [];
        for (let node = actions?.nextElementSibling ?? null; node !== null && widgets.includes(node.localName); node = node.nextElementSibling) after.push(node.localName);
        return {
          contain: wrapper === null ? null : getComputedStyle(wrapper).contain,
          // The field and the action row on rows of their own (`.message-entry{flex:1 0 100%}` with `wrap-reverse`).
          twoRows:
            actions !== null && entry !== null
              ? actions.getBoundingClientRect().bottom <= entry.getBoundingClientRect().top + 1 || entry.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top + 1
              : null,
          composerHeight: entry?.parentElement?.getBoundingClientRect().height ?? 0,
          layer: layer?.localName ?? null,
          layerIsOurs: layer?.localName === tag,
          z: inner === null || inner === undefined ? null : getComputedStyle(inner).zIndex,
          toasts: toasts === null || toasts === undefined ? null : { position: getComputedStyle(toasts).position, z: getComputedStyle(toasts).zIndex },
          widgets: after,
          topBar: [...(document.querySelector('app-nav-bar-top .right-side')?.children ?? [])].slice(0, 2).map((node) => node.localName),
        };
      }, BODY_LAYER_TAG, [NEIGHBOR_TAGS.templates, NEIGHBOR_TAGS.emoji, NEIGHBOR_TAGS.translate]);
    const group = String(ids.groups[1]);
    await openWithNeighbor(`/messages/${group}`, { mode: 'off' });
    const plain = await measure();
    expect(plain).toMatchObject({ contain: 'none', twoRows: false, layerIsOurs: false, widgets: [] });
    await openWithNeighbor(`/messages/${group}`, { mode: 'after' });
    await waitFor(async () => (await measure()).widgets.length === 3, 'its composer widgets');
    const next = await measure();
    expect(next.composerHeight).toBeGreaterThan(plain.composerHeight);
    expect(next).toMatchObject({
      contain: 'size',
      twoRows: true,
      layer: BODY_LAYER_TAG,
      z: '1000000',
      toasts: { position: 'fixed', z: '999999999' },
      widgets: [NEIGHBOR_TAGS.templates, NEIGHBOR_TAGS.emoji, NEIGHBOR_TAGS.translate],
      topBar: [NEIGHBOR_TAGS.menu, NEIGHBOR_TAGS.badges],
    });
  });

  it('+guard: a trusted Enter with a restricted word sends nothing — no request, no XHR event — its toast, the text back in the field; the next message goes', async () => {
    const fake = fakeFansly();
    const group = String(ids.groups[2]);
    await openWithNeighbor(`/messages/${group}`, { mode: 'after', guard: ['forbidden'] });
    await waitFor(async () => (await neighborState()).guard.active, 'its guard');
    const since = await fake.mark();
    const watched = await browser.execute(() => {
      // A listener-only watcher of the page's XHRs (the shape our tap must have).
      const events: string[] = [];
      const Native = window.XMLHttpRequest;
      window.XMLHttpRequest = new Proxy(Native, {
        construct(target, args, newTarget) {
          const xhr = Reflect.construct(target, args, newTarget) as XMLHttpRequest;
          for (const type of ['loadstart', 'load', 'error', 'abort', 'timeout']) xhr.addEventListener(type, () => events.push(type));
          return xhr;
        },
      });
      (window as unknown as Record<string, unknown>)['__standXhrEvents'] = events;
      return true;
    });
    expect(watched).toBe(true);
    await $(FANSLY_MAIN.field).click();
    await browser.keys('this is forbidden');
    await browser.keys(Key.Enter);
    await waitFor(async () => (await neighborState()).guard.restored === 1, 'the text written back');
    await browser.pause(300);
    expect((await fake.calls('page', since)).filter((entry) => entry.route === 'message.send')).toEqual([]);
    expect(await browser.execute(() => (window as unknown as Record<string, string[]>)['__standXhrEvents'])).toEqual([]);
    expect(await $(FANSLY_MAIN.field).getValue()).toBe('this is forbidden');
    expect(await callNeighbor('toasts')).toContain(GUARD_TOAST);
    // The field emptied the way a page script would; then a clean message, trusted.
    await browser.execute((selector: string) => {
      const field = document.querySelector<HTMLTextAreaElement>(selector);
      if (field === null) throw new Error('no field');
      field.value = '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, FANSLY_MAIN.field);
    await $(FANSLY_MAIN.field).click();
    await browser.keys('all clean');
    await browser.keys(Key.Enter);
    await waitFor(async () => (await fake.calls('page', since)).some((entry) => entry.route === 'message.send' && entry.status === 200), 'the clean send');
    await waitFor(async () => (await neighborState()).messageLogs === 1, 'its message log');
  });

  it('translate: a trusted Ctrl+Shift+L in the field is stopped on the field and replaces the whole value a moment later; Alt+T focuses its toasts', async () => {
    await openWithNeighbor(`/messages/${String(ids.groups[3])}`, { mode: 'after', mod: 'ctrl' });
    await browser.execute(() => {
      const seen: string[] = [];
      document.addEventListener('keydown', (event) => seen.push(`capture:${event.code}`), true);
      document.addEventListener('keydown', (event) => seen.push(`bubble:${event.code}`));
      (window as unknown as Record<string, unknown>)['__standKeys'] = seen;
    });
    await $(FANSLY_MAIN.field).click();
    await browser.keys('hola guapo');
    await browser.execute(() => ((window as unknown as Record<string, string[]>)['__standKeys'] ?? []).splice(0));
    await browser.keys([Key.Ctrl, Key.Shift, 'l']);
    await waitFor(async () => (await $(FANSLY_MAIN.field).getValue()) === '[EN] hola guapo', 'the translation');
    const keys = await browser.execute(() => (window as unknown as Record<string, string[]>)['__standKeys'] ?? []);
    expect(keys).toContain('capture:KeyL');
    expect(keys).not.toContain('bubble:KeyL');
    expect((await callFansly('composers')).find((composer) => composer.place === 'main')?.model).toBe('[EN] hola guapo');
    await browser.keys([Key.Alt, 't']);
    expect(await browser.execute((tag: string) => document.querySelector(tag)?.shadowRoot?.activeElement?.className ?? null, BODY_LAYER_TAG)).toBe('fb-toasts');
  });

  it('its own requests: the token issued to it — journaled `neighbour`, never ours — its poll, the title after each; a 429 that is its alone', async () => {
    const fake = fakeFansly();
    const since = await fake.mark();
    await openWithNeighbor(`/messages/${String(ids.groups[4])}`, { mode: 'after', pollMs: 400 });
    await waitFor(async () => (await fake.calls('neighbour', since)).filter((entry) => entry.route === 'message.unread').length >= 2, 'its polls');
    await fake.command({ op: 'api', rules: [{ route: 'message.unread', caller: 'neighbour', times: 1, outcome: { kind: 'status', status: 429, retryAfterS: 5 } }] });
    await waitFor(async () => (await callNeighbor('own')).some((entry) => entry.status === 429), 'its 429');
    const own = await fake.calls('neighbour', since);
    expect(own[0]?.route).toBe('account.me');
    expect(own.filter((entry) => entry.status === 429).map((entry) => entry.route)).toEqual(['message.unread']);
    expect(own.every((entry) => entry.detail?.['headers'] !== undefined && (entry.detail['headers'] as string[]).includes('authorization'))).toBe(true);
    expect((await fake.calls('page', since)).every((entry) => entry.status === 200)).toBe(true);
    expect(await fake.calls('ours', since)).toEqual([]);
    await fake.assertOursClean(since, 'the neighbour’s own requests');
    const state = await neighborState();
    expect(state.title.writes).toBeGreaterThanOrEqual(2);
    expect(await browser.getTitle()).toBe('Fansly stand');
  });
});
