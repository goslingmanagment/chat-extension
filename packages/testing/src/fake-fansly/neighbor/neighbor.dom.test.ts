// The FBuddy-like neighbour next to the Fansly stand page (R20 P6d; S5 §6),
// over a real fake Fansly on loopback, in happy-dom: what each mode and flag
// does to the page — its hooks see every API answer of the page, its guard
// swallows a send, its own requests go out under a token of its own and can
// get a 429 alone, its DOM work (top bar, inbox rows, composer widgets, message
// actions, the fan panel, the `<body>` layer, the style fixes), its composer
// writes and keys, its note — and that the page's own work stays the page's.
// Script injection order, layout and trusted keys are Firefox's:
// e2e/specs/fansly-stand-neighbor.e2e.ts.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createWorld, standIds } from '../../../fixture-fansly/src/data';
import { startFakeFansly, type FakeFansly } from '../index';
import { mainComposer, mainField, until } from '../../fixture-fansly/harness';
import { NEIGHBOR_TAGS } from './dom';
import { GUARD_TOAST } from './guard';
import { mountWithNeighbor, type NeighborStand } from './harness';
import { TEMPLATE_TEXT, translated } from './composer';
import { BODY_LAYER_TAG, BODY_LAYER_Z, MANAGED, TOAST_Z } from './ui';
import { FBUDDY_IDS, FBUDDY_KEYS, FBUDDY_NOTE_TITLE, FBUDDY_NOTE_TYPE, FBUDDY_XHR, NEIGHBOR_GLOBAL, RECORDED_HEADERS, type NeighborConfig } from './protocol';
import { unreadIcon } from './own';

const ids = standIds(createWorld());
const [first, second, third] = ids.groups as [string, string, string];

let fake: FakeFansly;
let stand: NeighborStand | null = null;
let since = 0;

/** The page's answers, the neighbour's 50-ms throttle and its batches, the bridge's messages. */
const quiet = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 200));
};

/**
 * The page has SETTLED (`idle()`: no request in flight, its unread reading over, no read mark waiting or going out —
 * at its start alone it sends 60 delivery marks, 25 a call, 200 ms apart) and the hook's reports have crossed the
 * bridge: the moment to compare what the hook saw with what the server answered. Not after a swallowed send — that
 * request never ends.
 */
const settled = async (): Promise<void> => {
  await until(() => stand?.control.idle() === true, 'the page to settle', 8000);
  await new Promise((resolve) => setTimeout(resolve, 100));
};

beforeAll(async () => {
  fake = await startFakeFansly({ pageOrigin: location.origin });
});

afterAll(async () => {
  await fake.close();
});

beforeEach(() => {
  fake.command({ op: 'reset' });
  since = fake.journal.next;
});

afterEach(async () => {
  // What the page still had in flight ends, and its reports arrive, before the window is handed to the next test.
  await quiet();
  stand?.unmount();
  stand = null;
  document.title = 'Fansly stand';
});

async function mount(config: Partial<NeighborConfig>, path = '/messages', options?: Parameters<typeof mountWithNeighbor>[3]): Promise<NeighborStand> {
  stand?.unmount();
  stand = await mountWithNeighbor(fake, path, config, options);
  return stand;
}

const s = (): NeighborStand => {
  if (stand === null) throw new Error('no stand');
  return stand;
};

/** The page's API calls on the server since the test began: `METHOD path`, in the order the server answered them. */
const pageCalls = (): string[] => fake.journal.calls('page', since).map((entry) => `${entry.method ?? ''} ${entry.path ?? ''}`);
/** Requests in flight together end in either order on each side: compare what, not when. */
const sorted = (calls: readonly string[]): string[] => [...calls].sort();
/** The neighbour's log of the page's requests: `METHOD path` (its own requests never pass its hooks). */
const seen = (from = 0): string[] => s().neighbor.log(from).map((entry) => `${entry.method} ${entry.url.slice(fake.apiOrigin.length)}`);

/** Types like a person as far as the page can tell, then Enter. */
function typeAndEnter(text: string): void {
  const field = mainField();
  if (field === null) throw new Error('no field');
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

async function openChat(groupId: string): Promise<void> {
  await s().control.open(groupId);
  await until(() => s().control.list()?.groupId === groupId && mainField() !== null, `chat ${groupId} open`);
}


describe('the neighbour: its hooks next to the page (after)', () => {
  it('sees every API request of the page — its request info, the four client headers, the whole answer — and the page gets its own results', async () => {
    await mount({ mode: 'after' });
    await s().neighbor.whenReady();
    await openChat(first);
    typeAndEnter('hello from the page');
    await until(() => fake.journal.calls('page', since).some((entry) => entry.route === 'message.send' && entry.status === 200), 'the send answered');
    await settled();
    // Every request the page made, the hook reported — each once.
    expect(sorted(seen())).toEqual(sorted(pageCalls()));
    const log = s().neighbor.log();
    expect(log.every((entry) => entry.kind === 'xhr' && entry.outcome === 'load' && entry.digest !== null && entry.instance === 1)).toBe(true);
    expect(log.every((entry) => RECORDED_HEADERS.every((name) => entry.headers.includes(name)))).toBe(true);
    expect(log.filter((entry) => entry.requestBody).map((entry) => entry.url.slice(fake.apiOrigin.length))).toEqual([expect.stringMatching(/^\/api\/v1\/message\?/)]);
    // The page sent its own text, from its handler, and shows the message.
    expect(fake.state.world.groups.get(first)?.history.at(-1)).toMatchObject({ content: 'hello from the page' });
    expect(s().control.composers().find((composer) => composer.place === 'main')?.model).toBe('');
    expect(s().neighbor.state()).toMatchObject({ ready: true, creatorId: ids.creator, hook: { installs: 1, instance: 1 }, messageLogs: 0 });
    expect(Reflect.get(window, FBUDDY_KEYS.hook)).toBe(true);
    expect(document.getElementById(FBUDDY_IDS.bridgeScript)?.getAttribute('data-fbuddy-version')).toBe('2');
  });

  it('marks every API XHR of the page with __fbuddyRequestInfo, at open', async () => {
    await mount({ mode: 'after' });
    const marked: boolean[] = [];
    const Native = window.XMLHttpRequest;
    // A watcher that only listens: the page's instances as the page made them.
    window.XMLHttpRequest = new Proxy(Native, {
      construct(target, args, newTarget) {
        const xhr = Reflect.construct(target, args, newTarget) as XMLHttpRequest;
        xhr.addEventListener('loadstart', () => marked.push(Reflect.get(xhr, FBUDDY_XHR.requestInfo) !== undefined));
        return xhr;
      },
    });
    await openChat(second);
    await quiet();
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.every(Boolean)).toBe(true);
  });

  it('finds the stand’s view registry at boot and gives Map.prototype back', async () => {
    const nativeSet: unknown = Reflect.get(Map.prototype, 'set');
    await mount({ mode: 'after' });
    expect(s().neighbor.state().mapPatch).toEqual({ installed: true, found: true, restored: true });
    expect(Reflect.get(Map.prototype, 'set')).toBe(nativeSet);
  });
});

describe('the neighbour: when its hooks arrive', () => {
  it('before: in place before the page’s first request — the page’s own /account/me is in its log', async () => {
    await mount({ mode: 'before' });
    await settled();
    // The log is in the order the requests ENDED: the page's first request is /account/me, but on a busy runner one
    // of its start's /message/ack marks, sent alongside, can come back before it (#180's check). Its presence is
    // what the timing proves; «first-xhr» below is the case where it is missing.
    expect(seen()).toContainEqual(expect.stringMatching(/^GET \/api\/v1\/account\/me\?/));
    expect(sorted(seen())).toEqual(sorted(pageCalls()));
  });

  it('first-xhr: after the page’s first request came back — what the page asked before is not in its log, everything after is', async () => {
    let inject: (() => void) | null = null;
    await mount({ mode: 'after', timing: 'first-xhr' }, '/messages', { afterFirstXhr: (run) => (inject = run) });
    expect(s().neighbor.state().ready).toBe(false);
    // The page's whole start goes by without its hooks, and nothing is in flight when they come.
    await settled();
    const unhooked = pageCalls();
    expect(unhooked[0]).toMatch(/^GET \/api\/v1\/account\/me\?/);
    expect(seen()).toEqual([]);
    const hooked = fake.journal.next;
    if (inject === null) throw new Error('no injection waiting');
    (inject as () => void)();
    await s().neighbor.whenReady();
    await openChat(first);
    await settled();
    const after = fake.journal.calls('page', hooked).map((entry) => `${entry.method ?? ''} ${entry.path ?? ''}`);
    expect(after.some((call) => call.startsWith(`GET /api/v1/message?groupId=${first}`))).toBe(true);
    expect(sorted(seen())).toEqual(sorted(after));
    expect(seen()).not.toContain(unhooked[0]);
  });
});

describe('the neighbour: reinject and legacy', () => {
  it('reinject: a new instance disposes the old; each request is reported once, by the new one; its guard still blocks', async () => {
    await mount({ mode: 'reinject', reinjectMs: 60_000, guard: ['forbidden'] });
    await s().neighbor.whenReady();
    await until(() => s().neighbor.state().guard.active, 'the guard');
    // What instance 1 sent is reported by instance 1 — even after it is gone: its listeners came with the request.
    // So the page settles first: nothing of instance 1's is in flight when instance 2 comes.
    await settled();
    expect(await s().neighbor.reinject()).toBe(2);
    const mark = s().neighbor.log().at(-1)?.seq ?? 0;
    await openChat(third);
    await settled();
    const after = s().neighbor.log(mark);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((entry) => entry.instance === 2)).toBe(true);
    expect(new Set(after.map((entry) => `${entry.method} ${entry.url}`)).size).toBe(after.length);
    typeAndEnter('a forbidden thing');
    await quiet();
    expect(fake.journal.calls('page', since).some((entry) => entry.route === 'message.send')).toBe(false);
    expect(s().neighbor.state().guard.swallowed).toBe(1);
  });

  it('legacy: every request — the stand’s own control calls too — with every body; a re-injection changes nothing', async () => {
    await mount({ mode: 'legacy' });
    await s().neighbor.whenReady();
    s().control.setPartners(first, 1);
    // The fetch answer and its bridged report are asynchronous; CPU load can exceed quiet()'s fixed pause.
    await until(() => s().neighbor.log().some((entry) => entry.url.includes('/__stand/fansly')), 'the legacy hook reported the control request');
    const control = s().neighbor.log().filter((entry) => entry.url.includes('/__stand/fansly'));
    expect(control).toEqual([expect.objectContaining({ kind: 'fetch', method: 'POST', requestBody: true })]);
    await s().neighbor.reinject();
    expect(s().neighbor.state().hook.instance).toBe(1);
  });
});

describe('the neighbour: its own requests', () => {
  it('go out with the token issued to it — journaled `neighbour`, with the replayed client headers — and a 429 scripted for it alone leaves the page alone', async () => {
    await mount({ mode: 'after' });
    await s().neighbor.whenReady();
    fake.command({ op: 'api', rules: [{ route: 'message.unread', caller: 'neighbour', times: 1, outcome: { kind: 'status', status: 429, retryAfterS: 5 } }] });
    expect(await s().neighbor.pollNow()).toMatchObject({ method: 'GET', status: 429, purpose: 'unread' });
    expect(await s().neighbor.pollNow()).toMatchObject({ status: 200 });
    s().control.cameBack(31_000);
    await until(() => fake.journal.calls('page', since).filter((entry) => entry.route === 'message.unread').length >= 2, 'the page’s own unread read');
    const own = fake.journal.calls('neighbour', since);
    expect(own.map((entry) => [entry.route, entry.status])).toEqual([
      ['account.me', 200],
      ['message.unread', 429],
      ['message.unread', 200],
    ]);
    // Its first request came before it had seen one of the page's; the polls replay what it recorded.
    expect(own.at(-1)?.detail?.['headers']).toEqual(expect.arrayContaining(['authorization', 'fansly-client-id', 'fansly-client-ts', 'fansly-session-id', 'fansly-client-check']));
    expect(fake.journal.calls('page', since).every((entry) => entry.status === 200)).toBe(true);
    expect(fake.journal.calls('ours', since)).toEqual([]);
    expect(fake.journal.violations(since)).toEqual([]);
  });

  it('after each poll: the title twice and the favicon — the count while there are unread messages, the page’s own after', async () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = '/favicon.ico';
    document.head.append(link);
    try {
      await mount({ mode: 'after' });
      await s().neighbor.whenReady();
      const titles: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) titles.push(node.textContent ?? '');
      });
      observer.observe(document.head, { childList: true, subtree: true, characterData: true });
      fake.command({ op: 'message', groupId: third, text: 'unread one' });
      await s().neighbor.pollNow();
      await quiet();
      observer.disconnect();
      expect(s().neighbor.state().title.writes).toBe(2);
      expect(titles).toEqual(['Fansly stand FB', 'Fansly stand']);
      expect(document.title).toBe('Fansly stand');
      const unread = fake.state.world.wireUnread(null, 100, 0).total;
      expect(unread).toBeGreaterThan(0);
      expect(link.getAttribute('href')).toBe(unreadIcon(unread));
    } finally {
      link.remove();
    }
  });

  it('a page with no fake Fansly: no own requests, its DOM work starts at once', async () => {
    await mount({ mode: 'after' }, '/messages', { apiOrigin: null });
    await s().neighbor.whenReady();
    expect(s().neighbor.state().creatorId).toBe('local');
    expect(fake.journal.calls('neighbour', since)).toEqual([]);
  });

  it('saves its fan profile: the fan’s «FBuddy Notes» 12000 note is created, then edited — both its calls', async () => {
    await mount({ mode: 'after' });
    await s().neighbor.whenReady();
    const fan = ids.fans[first] as string;
    const created = await s().neighbor.writeNote(fan, 'likes cats');
    expect(created).toMatchObject({ created: true });
    const edited = await s().neighbor.writeNote(fan, 'likes cats and dogs');
    expect(edited).toEqual({ id: created?.id, created: false });
    const notes = fake.state.world.accounts.get(fan)?.notes.filter((note) => note.title === FBUDDY_NOTE_TITLE) ?? [];
    expect(notes.map((note) => [note.contentType, note.note])).toEqual([[FBUDDY_NOTE_TYPE, 'likes cats and dogs']]);
    expect(fake.journal.calls('neighbour', since).map((entry) => entry.route)).toEqual(['account.me', 'account.byIds', 'notes.create', 'account.byIds', 'notes.edit']);
  });
});

describe('the neighbour: its DOM', () => {
  it('its style fixes in <head>; its <body> layer first, at z 1 000 000, toasts bottom-right above all', async () => {
    await mount({ mode: 'after', noisyMs: 30 });
    await s().neighbor.whenReady();
    expect(document.getElementById(FBUDDY_IDS.styleFixes)?.textContent).toContain('app-messages-route .messages-wrapper{contain:size!important}');
    expect(document.getElementById(FBUDDY_IDS.styleFixes)?.textContent).toContain('.message-entry{flex:1 0 100%!important}');
    expect(document.getElementById(FBUDDY_IDS.dynamicTweaks)?.textContent).toBe('app-messages-route{max-width:1800px!important}');
    const layer = document.body.firstElementChild;
    expect(layer?.localName).toBe(BODY_LAYER_TAG);
    const root = layer?.shadowRoot;
    expect(root?.querySelector<HTMLElement>('.fb-body-layer')?.getAttribute('style')).toContain(`z-index:${BODY_LAYER_Z}`);
    expect(root?.querySelector<HTMLElement>('section.fb-toasts')?.getAttribute('style')).toMatch(new RegExp(`right:16px;bottom:16px;z-index:${TOAST_Z}`));
    await until(() => (root?.querySelectorAll('.fb-toast').length ?? 0) > 0, 'a noisy toast');
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', altKey: true, bubbles: true }));
    expect(root?.activeElement ?? null).toBe(root?.querySelector('section.fb-toasts'));
  });

  it('two hosts first in the top bar, a badge per inbox row, its entries in every message’s actions — open shadow roots, owner marks', async () => {
    await mount({ mode: 'after' });
    await s().neighbor.whenReady();
    await openChat(first);
    await until(() => document.querySelectorAll(NEIGHBOR_TAGS.inboxBadge).length === s().control.inbox().rendered.length, 'a badge per row');
    const right = document.querySelector('app-nav-bar-top .nav-content-wrapper > .right-side');
    // The top bar is a batch of its own: on a busy runner the badges came first (a stress run of this file saw ['a']).
    await until(() => right?.querySelector(NEIGHBOR_TAGS.menu) !== null && right?.querySelector(NEIGHBOR_TAGS.badges) !== null, 'its two hosts in the top bar');
    expect([...(right?.children ?? [])].slice(0, 2).map((element) => element.localName)).toEqual([NEIGHBOR_TAGS.menu, NEIGHBOR_TAGS.badges]);
    const menu = right?.firstElementChild;
    expect(menu?.shadowRoot).not.toBeNull();
    expect(menu?.getAttribute(MANAGED.feature)).toBe('header-extension-button');
    expect(right?.getAttribute(MANAGED.ownerId)).toBe(menu?.getAttribute(MANAGED.ownerId));
    const actions = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('app-messages-conversation-route app-group-message .actions')];
    // Its batches take ≤ 32 targets each: a full chat takes a few.
    await until(() => actions().length > 0 && actions().every((row) => row.querySelector('.fb-pin-message') !== null), 'entries in every message');
    expect(actions().every((row) => row.querySelector('.fb-translate-message-entry') !== null && row.style.width === 'auto' && row.classList.contains('fb-message-actions-attached'))).toBe(true);
  });

  it('three widgets right after the composer’s actions — again for every new composer and every new field branch', async () => {
    await mount({ mode: 'after' });
    await s().neighbor.whenReady();
    const widgets = (): string[] => {
      const actions = mainComposer()?.querySelector('.collapsable-actions');
      const tags: string[] = [];
      for (let node = actions?.nextElementSibling ?? null; node !== null && node.localName.startsWith('fb-'); node = node.nextElementSibling) tags.push(node.localName);
      return tags;
    };
    const expected = [NEIGHBOR_TAGS.templates, NEIGHBOR_TAGS.emoji, NEIGHBOR_TAGS.translate];
    await openChat(first);
    await until(() => widgets().length === 3, 'widgets in the first composer');
    expect(widgets()).toEqual(expected);
    const firstComposer = mainComposer();
    await openChat(second);
    await until(() => mainComposer() !== firstComposer && widgets().length === 3, 'widgets in the next composer');
    s().control.recreateField();
    await until(() => widgets().length === 3, 'widgets in the new field branch');
    expect(document.querySelectorAll(`app-messages-conversation-route ${NEIGHBOR_TAGS.templates}`)).toHaveLength(1);
    expect(mainComposer()?.querySelector(NEIGHBOR_TAGS.templates)?.getAttribute('style')).toBe('display:inline-flex;margin-left:.25rem');
  });

  it('panel=desktop: a 400-px panel at the end of .messages-wrapper, flexGrow 3 on the inbox', async () => {
    await mount({ mode: 'after', panel: 'desktop' });
    await s().neighbor.whenReady();
    await until(() => document.querySelector(NEIGHBOR_TAGS.panelDesktop) !== null, 'the desktop panel');
    const wrapper = document.querySelector('app-messages-route .messages-wrapper');
    expect(wrapper?.lastElementChild?.localName).toBe(NEIGHBOR_TAGS.panelDesktop);
    expect(wrapper?.lastElementChild?.getAttribute('style')).toContain('width:400px');
    expect(document.querySelector<HTMLElement>('.messages-list-wrapper')?.style.flexGrow).toBe('3');
  });

  it('panel=mobile: a node at the END of the chat header, made anew for every chat, never in .content-header-sub-row', async () => {
    await mount({ mode: 'after', panel: 'mobile' });
    await s().neighbor.whenReady();
    const header = (): Element | null => document.querySelector('app-messages-conversation-route > .message-content-header');
    const node = (): Element | null | undefined => header()?.lastElementChild;
    await openChat(first);
    await until(() => node()?.localName === NEIGHBOR_TAGS.panelMobile && node()?.getAttribute('data-group') === first, 'the node for the first chat');
    const before = node();
    await openChat(second);
    await until(() => node()?.getAttribute('data-group') === second, 'a node for the next chat');
    expect(node()).not.toBe(before);
    expect(before?.isConnected).toBe(false);
    expect(header()?.querySelectorAll(NEIGHBOR_TAGS.panelMobile)).toHaveLength(1);
    expect(document.querySelector(`.content-header-sub-row ${NEIGHBOR_TAGS.panelMobile}`)).toBeNull();
  });

  it('its observer does not rock: still while the page is still, bounded per chat switch', async () => {
    await mount({ mode: 'after', panel: 'mobile' });
    await s().neighbor.whenReady();
    /** The page has settled (its marks out, their receipts in the inbox) and the neighbour has worked its queue through. */
    const still = async (): Promise<void> => {
      await settled();
      await until(() => s().neighbor.state().dom.queued === 0, 'its queue to empty');
      await quiet();
    };
    await openChat(first);
    await still();
    const before = s().neighbor.state().dom;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(s().neighbor.state().dom).toEqual(before);
    const perSwitch: number[] = [];
    for (const groupId of [second, third, first, second, third, first]) {
      const from = s().neighbor.state().dom.records;
      await openChat(groupId);
      await still();
      perSwitch.push(s().neighbor.state().dom.records - from);
    }
    // The same work for every switch: no growth from its own records feeding it.
    expect(Math.max(...perSwitch)).toBeLessThan(200);
    expect(Math.max(...perSwitch.slice(3)) - Math.min(...perSwitch.slice(3))).toBeLessThan(40);
    const after = s().neighbor.state().dom;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(s().neighbor.state().dom).toEqual(after);
    // Seven times «the page has settled»: each waits out the page's marks (their chunk gap is 200 ms).
  }, 30_000);
});

describe('the neighbour: the composer', () => {
  it('+guard: a send with a restricted word never reaches the server; a toast; the text back in the field; the next clean send goes and is logged', async () => {
    await mount({ mode: 'after', guard: ['forbidden'] });
    await s().neighbor.whenReady();
    await until(() => s().neighbor.state().guard.active, 'the guard');
    expect(JSON.parse(document.getElementById(FBUDDY_IDS.wordsData)?.textContent ?? '[]')).toEqual(['forbidden']);
    await openChat(first);
    typeAndEnter('this is forbidden, babe');
    await until(() => s().neighbor.state().guard.restored === 1, 'the text written back');
    await quiet();
    expect(mainField()?.value).toBe('this is forbidden, babe');
    expect(fake.journal.calls('page', since).some((entry) => entry.route === 'message.send')).toBe(false);
    expect(s().neighbor.toasts()).toContain(GUARD_TOAST);
    expect(s().neighbor.state().guard).toMatchObject({ active: true, swallowed: 1, restored: 1 });
    // The page's model follows the restored text (its `input` reached NgModel).
    expect(s().control.composers().find((composer) => composer.place === 'main')?.model).toBe('this is forbidden, babe');
    // The page's request never ends — no event will ever come for it: this page is not idle again.
    expect(s().control.idle()).toBe(false);
    typeAndEnter('all clean');
    await until(() => fake.journal.calls('page', since).some((entry) => entry.route === 'message.send' && entry.status === 200), 'the clean send');
    await quiet();
    expect(s().neighbor.state().messageLogs).toBe(1);
  });

  it('translate: Ctrl+Shift+L on the field — stopped there — and the whole value replaced later, unless the chat changed', async () => {
    await mount({ mode: 'after', mod: 'ctrl', translateMs: 20 });
    await s().neighbor.whenReady();
    await openChat(first);
    await until(() => mainComposer()?.querySelector(NEIGHBOR_TAGS.translate) !== null, 'the widgets');
    const field = mainField() as HTMLTextAreaElement;
    field.value = 'hola guapo';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    const reached: string[] = [];
    const onDocument = (event: KeyboardEvent): void => void reached.push(event.code);
    document.addEventListener('keydown', onDocument);
    const press = (init: KeyboardEventInit): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { code: 'KeyL', key: 'L', bubbles: true, cancelable: true, ...init });
      field.dispatchEvent(event);
      return event;
    };
    // Exact modifiers: Meta+Shift and Ctrl+Alt+Shift are not its key.
    expect(press({ metaKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(press({ ctrlKey: true, altKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(press({ ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    document.removeEventListener('keydown', onDocument);
    expect(reached).toEqual(['KeyL', 'KeyL']);
    await until(() => field.value === translated('hola guapo'), 'the translation');
    expect(s().control.composers().find((composer) => composer.place === 'main')?.model).toBe(translated('hola guapo'));
    // A translation that comes back after a chat switch is dropped.
    const next = mainField() as HTMLTextAreaElement;
    next.value = 'otra vez';
    next.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await openChat(second);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(next.value).toBe('otra vez');
  });

  it('its template button splices at the caret with the native setter and untrusted input/change: the page’s model follows', async () => {
    await mount({ mode: 'after' });
    await s().neighbor.whenReady();
    await openChat(first);
    await until(() => mainComposer()?.querySelector(NEIGHBOR_TAGS.templates) !== null, 'the widgets');
    const field = mainField() as HTMLTextAreaElement;
    field.value = 'Hi there';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.setSelectionRange(3, 3);
    const events: string[] = [];
    field.addEventListener('input', (event) => events.push(`${event.type}:${String(event.isTrusted === true)}`));
    field.addEventListener('change', (event) => events.push(`${event.type}:${String(event.isTrusted === true)}`));
    mainComposer()?.querySelector(NEIGHBOR_TAGS.templates)?.shadowRoot?.querySelector('button')?.click();
    expect(field.value).toBe(`Hi ${TEMPLATE_TEXT}there`);
    expect(events).toEqual(['input:false', 'change:false']);
    expect(field.selectionStart).toBe(3 + TEMPLATE_TEXT.length);
    expect(s().control.composers().find((composer) => composer.place === 'main')?.model).toBe(`Hi ${TEMPLATE_TEXT}there`);
  });
});

describe('the neighbour: generic, flood and off', () => {
  it('generic (a Proxy, then a subclass) over XMLHttpRequest and WebSocket: the page still talks, and FBuddy’s hook still sees it', async () => {
    for (const generic of ['proxy', 'subclass'] as const) {
      await mount({ mode: 'after', generic });
      await s().neighbor.whenReady();
      await openChat(first);
      await until(() => s().control.socket()?.state === 'connected', 'the page’s socket');
      await quiet();
      expect(s().neighbor.state().generic?.xhr).toBeGreaterThan(0);
      expect(s().neighbor.state().generic?.sockets).toBeGreaterThan(0);
      expect(seen().length).toBeGreaterThan(0);
      since = fake.journal.next;
    }
  });

  it('flood: 200-KB bodies at 20 a second through window `message` for as long as asked', async () => {
    await mount({ mode: 'after', floodMs: 250 });
    await s().neighbor.whenReady();
    await until(() => s().neighbor.state().flooded >= 3, 'flood messages');
  });

  it('off: nothing of it on the page — no hooks, no keys, no elements', async () => {
    const open: unknown = Reflect.get(XMLHttpRequest.prototype, 'open');
    await mount({ mode: 'off' });
    await openChat(first);
    await quiet();
    expect(Reflect.get(XMLHttpRequest.prototype, 'open')).toBe(open);
    expect(Reflect.get(window, FBUDDY_KEYS.hook)).toBeUndefined();
    expect(document.querySelector('[data-fbuddy-managed-feature]')).toBeNull();
    expect(document.getElementById(FBUDDY_IDS.styleFixes)).toBeNull();
    expect(Reflect.get(window, NEIGHBOR_GLOBAL)).toMatchObject({ config: { mode: 'off' } });
    expect(fake.journal.calls('neighbour', since)).toEqual([]);
  });
});
