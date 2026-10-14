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
import { callNeighbor, neighborState, openWithNeighbor, setFanslyNeighbor, waitForNeighborComposer } from '../support/fansly-neighbor';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyIds, fanslyStandServer, waitForFanslyStandIdle } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';

type Ids = Awaited<ReturnType<typeof fanslyIds>>;

async function waitFor(check: () => Promise<boolean>, what: string, timeout = 5000): Promise<void> {
  await browser.waitUntil(check, { timeout, interval: 50, timeoutMsg: what });
}

/** What one run of the scenario left on both sides, read once the page had settled. */
interface Run {
  /** Every call of the page as the server answered it, `METHOD path → status`, sorted. */
  readonly all: string[];
  /** The same without its read marks' calls: what must be equal from run to run, call for call. */
  readonly calls: string[];
  /**
   * What the page marked, `<kind of mark>:<message>`, sorted: the ids it acknowledged, however many calls carried
   * them — the page sends its marks in chunks, and how they fall into calls is timing, not behaviour.
   */
  readonly marks: string[];
  /** Every call of the page as the neighbour's hook reported it, in `all`'s form; null — no neighbour. */
  readonly seen: string[] | null;
  /** The handler the page's send was made in. */
  readonly sendDuring: unknown;
  /** Messages in the first chat after the fan's answer. */
  readonly messages: number;
}

const FANS_NEW_MESSAGE = 'the fan’s new message';

/**
 * One run of the same scenario — a chat, a trusted send, a fan's answer, a chat with unread messages — between two
 * moments when the page has SETTLED (`idle()`): its start is over before the first mark (at its start alone the page
 * sends 60 delivery marks, 25 a call, 200 ms apart), and its last mark is out before the journals are read.
 */
async function scenario(config: Partial<NeighborConfig>, ids: Ids): Promise<Run> {
  const fake = fakeFansly();
  await fake.command({ op: 'reset' });
  const [a, b] = ids.groups as [string, string];
  // The page collects its marks for 0 ms, not the site's 1–3 s at random.
  await openWithNeighbor('/messages?stand-ack-delay=0', config);
  await waitForFanslyStandIdle();
  const since = await fake.mark();
  const logMark = config.mode === 'off' ? 0 : ((await callNeighbor('log')).at(-1)?.seq ?? 0);
  const pageMark = (await callFansly('journal')).at(-1)?.seq ?? 0;

  await callFansly('open', a);
  await waitFor(async () => (await callFansly('list'))?.groupId === a && ((await callFansly('list'))?.messages ?? 0) > 0, 'the first chat');
  await $(FANSLY_MAIN.field).click();
  // One key: exactly one typing announcement, however slow the machine (the page announces at most every 3 s).
  await browser.keys('h');
  await browser.keys(Key.Enter);
  await waitFor(async () => (await fake.calls('page', since)).some((entry) => entry.route === 'message.send' && entry.status === 200), 'the send');
  await waitForFanslyStandIdle();
  const before = (await callFansly('list'))?.messages ?? 0;
  const fanMessage = (await fake.command({ op: 'message', groupId: a, text: 'a fan answers' })).message?.id;
  await waitFor(async () => ((await callFansly('list'))?.messages ?? 0) === before + 1, 'the fan’s message');
  const messages = (await callFansly('list'))?.messages ?? 0;
  // The second chat has two unread messages: opening it marks them read.
  await callFansly('open', b);
  await waitFor(async () => (await callFansly('list'))?.groupId === b && ((await callFansly('list'))?.messages ?? 0) > 0, 'the second chat');
  await waitForFanslyStandIdle();

  const line = (method: string, address: string, status: number): string => `${method} ${address.replace(/before=\d+/, 'before=*')} → ${status}`;
  const entries = await fake.calls('page', since);
  const acks = entries.filter((entry) => entry.route === 'message.ack');
  const marks = acks.flatMap((entry) => ((entry.detail?.['messageIds'] ?? []) as string[]).map((id) => `${String(entry.detail?.['ackType'])}:${id === fanMessage ? FANS_NEW_MESSAGE : id}`));
  const sendDuring = (await callFansly('journal', pageMark)).find((entry) => entry.type === 'api' && entry['method'] === 'POST' && /^\/api\/v1\/message\?/.test(String(entry['path'])))?.['during'];
  const seen = config.mode === 'off' ? null : (await callNeighbor('log', logMark)).map((entry) => line(entry.method, `${new URL(entry.url).pathname}${new URL(entry.url).search}`, entry.status)).sort();
  await fake.assertOursClean(since, `the scenario with the neighbour ${config.mode ?? 'after'}`);
  return {
    all: entries.map((entry) => line(entry.method ?? '', entry.path ?? '', entry.status ?? 0)).sort(),
    calls: entries.filter((entry) => entry.route !== 'message.ack').map((entry) => line(entry.method ?? '', entry.path ?? '', entry.status ?? 0)).sort(),
    marks: marks.sort(),
    seen,
    sendDuring,
    messages,
  };
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
    // No neighbour left polling for the next spec, and the world as a new stand has it.
    await browser.url('about:blank');
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
          bridge:
            bridge === null
              ? null
              : { part: bridge.getAttribute(part), src: new URL(bridge.getAttribute('src') ?? '', location.href).pathname, version: bridge.getAttribute('data-fbuddy-version'), parent: bridge.parentElement?.localName },
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
    // The scenario did what it says, in the reference run already: the send, the fan's answer marked, the second
    // chat's two unread messages marked read.
    expect(off.calls.filter((call) => call.startsWith('POST /api/v1/message?'))).toEqual(['POST /api/v1/message?ngsw-bypass=true → 200']);
    expect(off.marks.filter((mark) => mark.endsWith(FANS_NEW_MESSAGE))).toHaveLength(1);
    expect(off.marks.filter((mark) => mark.startsWith('2:'))).toHaveLength(2);
    expect(new Set(off.marks).size).toBe(off.marks.length);
    // The same requests with the same answers, call for call — and the same messages marked the same way.
    expect(after.calls).toEqual(off.calls);
    expect(after.marks).toEqual(off.marks);
    expect(after.messages).toBe(off.messages);
    // The page's send inside the trusted Enter, both times.
    expect(off.sendDuring).toEqual({ type: 'keydown', isTrusted: true, eventPhase: 2 });
    expect(after.sendDuring).toEqual(off.sendDuring);
    // Every request of the page — each call of its marks too — went past the neighbour's hooks once, with the answer
    // the server gave.
    expect(after.seen).toEqual(after.all);
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
    await waitForNeighborComposer();
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
      // A listener-only watcher of the page's XHRs (the shape our tap must have): the events of each, by its address.
      const events: string[] = [];
      const Native = window.XMLHttpRequest;
      window.XMLHttpRequest = new Proxy(Native, {
        construct(target, args, newTarget) {
          const xhr = Reflect.construct(target, args, newTarget) as XMLHttpRequest;
          const info = (): string => {
            const request = Reflect.get(xhr, '__fbuddyRequestInfo') as { method?: string; url?: string } | undefined;
            return `${request?.method ?? '?'} ${request?.url === undefined ? '?' : new URL(request.url).pathname}`;
          };
          for (const type of ['loadstart', 'load', 'error', 'abort', 'timeout']) xhr.addEventListener(type, () => events.push(`${type} ${info()}`));
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
    // The page's other requests (its typing announcement) had their events; the swallowed send none.
    const events = await browser.execute(() => (window as unknown as Record<string, string[] | undefined>)['__standXhrEvents'] ?? []);
    expect(events.filter((event) => event.endsWith(' POST /api/v1/message'))).toEqual([]);
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
    // Its key is on the field only once its batch has reached this composer.
    await waitForNeighborComposer();
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
