// The Fansly-like stand's own behaviour in Firefox, without the extension (R20
// P6a; docs/project-unite/architecture.md §13): what every later Fansly PR
// leans on must hold on the stand first — the anchors of the live chat, the
// route observer's view of a chat switch, NgModel and the draft cache, the
// trusted Enter/Shift and Send paths with the request inside the gesture, the
// list's bottom rules and its older pages, the virtual inbox, the upload
// modal, the mini-chat, the theme and the old extension's marks. The DOM-only
// rules are in src/fixture-fansly/*.dom.test.ts. The page's data come from the
// fake Fansly (R20 P6b) by real XHR requests and a real socket: the last test
// here checks that road in Firefox.

import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import type { FanslyPageJournalEntry, ListView } from '../../fixture-fansly/src/protocol';
import { useNetworkTrap } from '../support/network-trap';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyIds, fanslyStandServer, openFanslyStand } from '../support/fansly-stand';

const mark = async (): Promise<number> => (await callFansly('journal')).at(-1)?.seq ?? 0;
const apiSince = async (since: number, method: string, path: RegExp): Promise<FanslyPageJournalEntry[]> =>
  (await callFansly('journal', since)).filter((entry) => entry.type === 'api' && entry['method'] === method && path.test(String(entry['path'])));
const list = async (): Promise<ListView> => {
  const view = await callFansly('list');
  if (view === null) throw new Error('no main list');
  return view;
};
const fromBottom = (view: ListView): number => view.scrollHeight - view.clientHeight - view.scrollTop;

/** Scrolls the main list to `top` and waits for its scroll event to be handled. */
async function scrollListTo(top: number | 'bottom'): Promise<ListView> {
  await browser.execute(
    async (selector: string, wanted: number | 'bottom') => {
      const element = document.querySelector<HTMLElement>(selector);
      if (element === null) throw new Error('no list');
      const target = wanted === 'bottom' ? element.scrollHeight - element.clientHeight : wanted;
      if (Math.abs(element.scrollTop - target) < 1) element.scrollTop = target + (target > 0 ? -1 : 1);
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const scrolled = new Promise((resolve) => element.addEventListener('scroll', resolve, { once: true }));
      element.scrollTop = target;
      await scrolled;
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    FANSLY_MAIN.list,
    top,
  );
  return list();
}

/** Scrolls the main list to `px` above its bottom. */
async function scrollFromBottom(px: number): Promise<ListView> {
  const view = await list();
  return scrollListTo(view.scrollHeight - view.clientHeight - px);
}

describe('the Fansly-like stand on its own', () => {
  useNetworkTrap();
  let ids: Awaited<ReturnType<typeof fanslyIds>>;
  let journalStart = 0;
  let fakeStart = 0;

  before(async () => {
    journalStart = await fanslyStandServer.mark();
    fakeStart = await fakeFansly().mark();
    await browser.setWindowSize(1440, 900);
    await openFanslyStand('/messages');
    ids = await fanslyIds();
  });

  after(async () => {
    // Nothing but the page's own loads reached the Fansly stand.
    const entries = await fanslyStandServer.journal(journalStart);
    expect(entries.filter((entry) => entry.origin !== 'asset')).toEqual([]);
    // The fake Fansly heard the page only: nobody else, and no call of ours broke a rule.
    const journal = await fakeFansly().journal(fakeStart);
    expect(journal.entries.filter((entry) => entry.kind === 'http' && entry.caller !== 'page')).toEqual([]);
    expect(journal.violations).toEqual([]);
  });

  it('has the anchors of the live chat, with their styles, in the light theme', async () => {
    await openFanslyStand(`/messages/${String(ids.groups[0])}`);
    // Opened by its address, the group comes with `GET /group/<id>/`: the container follows it.
    await $(FANSLY_MAIN.field).waitForExist({ timeout: 5000 });
    const anchors = await browser.execute(() => {
      const one = (selector: string): Record<string, unknown> | null => {
        const found = document.querySelectorAll<HTMLElement>(selector);
        const first = found[0];
        if (first === undefined) return null;
        const style = getComputedStyle(first);
        return { count: found.length, display: style.display, position: style.position, overflowY: style.overflowY };
      };
      return {
        theme: [...document.documentElement.classList],
        ngVersion: document.querySelector('app-root')?.getAttribute('ng-version'),
        route: one('app-messages-route'),
        inbox: one('.messages-list-wrapper'),
        content: one('.messages-content-wrapper'),
        conversation: one('app-messages-conversation-route'),
        header: one('app-messages-conversation-route > .message-content-header'),
        subRow: one('app-messages-conversation-route .message-content-header-contact .content-header-sub-row'),
        container: one('app-group-message-container'),
        list: one('.message-content-list'),
        composer: one('app-group-message-input'),
        field: one('textarea.message-input'),
        send: one('.send-button'),
        modal: one('.modal-wrapper'),
        file: one('app-group-message-input input[type="file"]'),
        attachments: one('app-group-message-input .message-attachments'),
        oldRoot: one('#chatgoose-root'),
      };
    });
    expect(anchors.theme).toEqual(['bright-theme']);
    expect(anchors.ngVersion).toBe('19.1.2');
    for (const name of ['route', 'inbox', 'content', 'conversation', 'header', 'subRow', 'container', 'list', 'composer', 'field', 'send', 'modal', 'file', 'attachments'] as const) {
      expect(anchors[name]?.['count']).toBe(1);
    }
    expect(anchors.list).toMatchObject({ display: 'flex', overflowY: 'auto' });
    expect(anchors.modal).toMatchObject({ position: 'fixed' });
    expect(anchors.file).toMatchObject({ display: 'none' });
    expect(anchors.oldRoot).toBeNull();
  });

  it('a chat switch: the route observer sees the new container in the task of `pushState`, and its field still empty of the cached draft', async () => {
    const [a, b] = ids.groups as [string, string];
    await callFansly('open', b);
    await $(FANSLY_MAIN.field).click();
    await browser.keys('draft of b');
    await callFansly('open', a);
    const seen = await browser.execute(
      async (other: string, routeSelector: string, fieldSelector: string) => {
        const events: string[] = [];
        // A hook on the instance (the prototype's method stays): the router calls the instance's method at call time.
        history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
          events.push(`pushState ${String(args[2])}`);
          History.prototype.pushState.apply(this, args);
        };
        const observer = new MutationObserver((records) => {
          const added = records.flatMap((record) => [...record.addedNodes]).map((node) => node.nodeName.toLowerCase());
          events.push(`mutation +${added.join(',')} field=${JSON.stringify(document.querySelector<HTMLTextAreaElement>(fieldSelector)?.value ?? null)}`);
        });
        observer.observe(document.querySelector(routeSelector) as Node, { childList: true });
        setTimeout(() => events.push('next task'), 0);
        const control = (window as unknown as Record<string, { open(id: string): Promise<void> }>)['__fanslyStand'];
        await control?.open(other);
        await new Promise((resolve) => setTimeout(resolve, 0));
        observer.disconnect();
        Reflect.deleteProperty(history, 'pushState');
        events.push(`field=${JSON.stringify(document.querySelector<HTMLTextAreaElement>(fieldSelector)?.value ?? null)}`);
        return events;
      },
      b,
      FANSLY_MAIN.route,
      FANSLY_MAIN.field,
    );
    expect(seen).toEqual([`pushState /messages/${b}`, expect.stringMatching(/^mutation \+.*app-group-message-container.* field=""$/), 'next task', 'field="draft of b"']);
  });

  it('a trusted Shift+Enter is a new line; a trusted Enter sends inside its keydown; the field clears by itself', async () => {
    const [a] = ids.groups as [string];
    await callFansly('open', a);
    await $(FANSLY_MAIN.field).click();
    const since = await mark();
    await browser.keys('hello');
    await browser.keys([Key.Shift, Key.Enter]);
    await browser.keys('world');
    const typed = (await callFansly('composers')).find((composer) => composer.place === 'main');
    expect(typed).toMatchObject({ model: 'hello\nworld', value: 'hello\nworld', cached: 'hello\nworld', shiftDown: false, canSend: true });
    // Typing announces at most every 3 s, however many keys.
    const typing = (await apiSince(since, 'POST', /^\/api\/v1\/message\/typing/)).map((entry) => entry.at);
    expect(typing.length).toBeGreaterThanOrEqual(1);
    for (const [index, at] of typing.entries()) if (index > 0) expect(at - (typing[index - 1] ?? 0)).toBeGreaterThanOrEqual(3000);
    await browser.keys(Key.Enter);
    const posts = await apiSince(since, 'POST', /^\/api\/v1\/message\?/);
    expect(posts).toEqual([expect.objectContaining({ groupId: a, content: 'hello\nworld', during: { type: 'keydown', isTrusted: true, eventPhase: 2 } })]);
    await browser.waitUntil(async () => (await $(FANSLY_MAIN.field).getValue()) === '', { timeout: 2000, timeoutMsg: 'the field was not cleared' });
    expect((await callFansly('composers'))[0]).toMatchObject({ model: '', cached: '' });
  });

  it('a trusted Send click sends inside the click and keeps the focus in the field', async () => {
    await $(FANSLY_MAIN.field).click();
    await browser.keys('by click');
    const since = await mark();
    await $(FANSLY_MAIN.send).click();
    // The click may land on the button's icon: the button's own listener runs as it bubbles.
    expect(await apiSince(since, 'POST', /^\/api\/v1\/message\?/)).toEqual([expect.objectContaining({ content: 'by click', during: expect.objectContaining({ type: 'click', isTrusted: true }) })]);
    expect(await browser.execute((selector: string) => document.activeElement === document.querySelector(selector), FANSLY_MAIN.field)).toBe(true);
  });

  it('the list: a new message brings it down within 350 px of the bottom and not farther; a size change only within 1 px', async () => {
    await callFansly('open', ids.longHistory);
    await browser.waitUntil(async () => (await list()).messages >= 25, { timeout: 5000, timeoutMsg: 'the latest page did not load' });
    await browser.waitUntil(async () => fromBottom(await list()) <= 1, { timeout: 2000, timeoutMsg: 'the list did not open at its bottom' });
    // 200 px up: within 350 — the block is lifted, a new message brings the list down.
    let view = await scrollFromBottom(200);
    expect(view).toMatchObject({ scrollBlock: false, resizeScrollBlock: true });
    await callFansly('fanMessage', ids.longHistory, 'within reach');
    await browser.waitUntil(async () => fromBottom(await list()) <= 1, { timeout: 2000, timeoutMsg: 'a new message did not bring the list down from 200 px' });
    // 600 px up: blocked — the list stays where it is.
    view = await scrollFromBottom(600);
    expect(view.scrollBlock).toBe(true);
    const top = view.scrollTop;
    await callFansly('fanMessage', ids.longHistory, 'out of reach');
    await browser.pause(300);
    expect((await list()).scrollTop).toBe(top);
    // At the bottom, the list shrinks (the field grows by a line): its ResizeObserver brings it down again. One line
    // at a time: two resizes in two frames let the page's own scroll event of the first block the second.
    view = await scrollListTo('bottom');
    expect(view.resizeScrollBlock).toBe(false);
    await $(FANSLY_MAIN.field).click();
    await browser.keys([Key.Shift, Key.Enter]);
    await browser.waitUntil(async () => (await list()).clientHeight < view.clientHeight, { timeout: 2000, timeoutMsg: 'the field did not grow' });
    await browser.pause(200);
    expect(fromBottom(await list())).toBeLessThanOrEqual(1);
    // 200 px up, it shrinks again: no bringing down beyond 1 px.
    const before = await scrollFromBottom(200);
    await $(FANSLY_MAIN.field).click();
    await browser.keys([Key.Shift, Key.Enter]);
    await browser.waitUntil(async () => (await list()).clientHeight < before.clientHeight, { timeout: 2000, timeoutMsg: 'the field did not grow again' });
    await browser.pause(200);
    expect(fromBottom(await list())).toBeGreaterThan(150);
    // A message that grows (an image that loaded) changes no box: nothing brings the list down.
    await scrollListTo('bottom');
    await callFansly('growLastMessage', 120);
    await browser.pause(200);
    expect(fromBottom(await list())).toBeGreaterThan(100);
  });

  it('the list at `scrollTop = 0` loads the page before the oldest message and keeps what was in view', async () => {
    const before = await list();
    const since = await mark();
    await scrollListTo(0);
    await browser.waitUntil(async () => (await list()).messages > before.messages, { timeout: 5000, timeoutMsg: 'no older page' });
    const older = await apiSince(since, 'GET', /^\/api\/v1\/message\?groupId=/);
    expect(older).toEqual([expect.objectContaining({ path: expect.stringMatching(/&before=\d{18}&limit=25/) })]);
    const after = await list();
    expect(after.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(after.scrollTop - (after.scrollHeight - before.scrollHeight))).toBeLessThanOrEqual(2);
  });

  it('the virtual inbox: 20 groups a page, more near the bottom; only rows near the view are in the DOM', async () => {
    await callFansly('openInbox');
    const first = await callFansly('inbox');
    expect(first.loaded).toBe(20);
    for (let page = 0; page < 3; page += 1) {
      await browser.execute(() => {
        const element = document.querySelector<HTMLElement>('.messages-list-wrapper .message-list');
        if (element !== null) element.scrollTop = element.scrollHeight;
      });
      await browser.pause(150);
    }
    const later = await callFansly('inbox');
    expect(later.loaded).toBeGreaterThanOrEqual(60);
    expect(later.rendered.length).toBeLessThan(later.loaded);
    expect(later.topSpacer).toBeGreaterThan(0);
    const hrefs = await browser.execute(() => [...document.querySelectorAll('.messages-list-wrapper .message-list > a')].map((row) => row.getAttribute('href')));
    expect(hrefs).toEqual(later.rendered.map((id) => `/messages/${id}`));
  });

  it('a file in the composer’s input opens the upload modal; a trusted «Upload» makes the attachment; the send waits for the media', async () => {
    const [a] = ids.groups as [string];
    await callFansly('open', a);
    await browser.execute((selector: string) => {
      const input = document.querySelector<HTMLInputElement>(selector);
      if (input === null) throw new Error('no file input');
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(32)], 'voice.m4a', { type: 'audio/mp4' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, `${FANSLY_MAIN.composer} .collapsable-actions > input[type=file]`);
    expect(await callFansly('modals')).toEqual(['app-account-media-upload']);
    expect(await browser.execute(() => document.body.classList.contains('modal-opened'))).toBe(true);
    expect(await $(`${FANSLY_MAIN.composer} app-account-media-create-template`).isExisting()).toBe(false);
    await $('app-account-media-upload .btn.solid-blue:not(.disabled)').click();
    expect(await callFansly('modals')).toEqual([]);
    expect(await browser.execute(() => document.body.classList.contains('modal-opened'))).toBe(false);
    expect(await $(`${FANSLY_MAIN.composer} .message-attachments > app-account-media-create-template.attachment`).isExisting()).toBe(true);
    await browser.waitUntil(async () => (await callFansly('composers'))[0]?.canSend === true, { timeout: 5000, timeoutMsg: 'the upload did not finish' });
    const since = await mark();
    await $(FANSLY_MAIN.send).click();
    await browser.waitUntil(async () => (await apiSince(since, 'POST', /^\/api\/v1\/message\?/)).length === 1, { timeout: 3000, timeoutMsg: 'no send after the media' });
    expect(await apiSince(since, 'POST', /^\/api\/v1\/account\/media/)).toEqual([expect.objectContaining({ during: expect.objectContaining({ type: 'click', isTrusted: true }) })]);
    expect(await apiSince(since, 'POST', /^\/api\/v1\/message\?/)).toEqual([expect.objectContaining({ attachments: 1, during: null })]);
  });

  it('the mini-chat has a second composer outside the route; the route’s own anchors stay the main chat’s', async () => {
    // A group with no draft of its own yet: the mini-chat's composer shares the page's draft cache.
    const [a, , , b] = ids.groups as [string, string, string, string];
    await callFansly('setMiniChat', b);
    const mini = 'app-messaging-overlay > app-messaging-overlay-group app-group-message-input textarea.message-input';
    await $(mini).waitForExist({ timeout: 3000 });
    await $(mini).click();
    await browser.keys('mini');
    const composers = await callFansly('composers');
    expect(composers.map((composer) => [composer.place, composer.groupId, composer.model])).toEqual([
      ['main', a, ''],
      ['mini', b, 'mini'],
    ]);
    expect(await browser.execute(() => document.querySelectorAll('app-group-message-input').length)).toBe(2);
    expect(await browser.execute((selector: string) => document.querySelectorAll(selector).length, FANSLY_MAIN.composer)).toBe(1);
    await callFansly('setMiniChat', null);
  });

  it('the theme switches on `<html>`; the old extension’s marks come and go', async () => {
    await callFansly('setTheme', 'dark');
    const dark = await browser.execute(() => ({ classes: [...document.documentElement.classList], background: getComputedStyle(document.body).backgroundColor }));
    await callFansly('setTheme', 'bright');
    const bright = await browser.execute(() => getComputedStyle(document.body).backgroundColor);
    expect(dark.classes).toEqual(['dark-theme']);
    expect(dark.background).not.toBe(bright);
    await callFansly('setOldExtension', true);
    const marks = await browser.execute((selector: string) => ({
      styles: [...document.querySelectorAll('head > style[id^="chatgoose-"]')].map((node) => node.id),
      launcher: document.querySelector('body > #chatgoose-followers-launcher') !== null,
      rootBeforeComposer: document.querySelector('#chatgoose-root')?.nextElementSibling === document.querySelector(selector),
    }), FANSLY_MAIN.composer);
    expect(marks).toEqual({ styles: ['chatgoose-bootstrap-style', 'chatgoose-style'], launcher: true, rootBeforeComposer: true });
    await callFansly('setOldExtension', false);
  });

  it('asks the fake Fansly by XHR and a socket of its own: every request the page’s, with `ngsw-bypass` and the session headers; the socket’s `5/1` lands in the chat', async () => {
    const fake = fakeFansly();
    const since = await fake.mark();
    const [, , , , group] = ids.groups as [string, string, string, string, string];
    await openFanslyStand(`/messages/${group}`);
    expect(await browser.execute(() => (window as unknown as Record<string, { backend: string }>)['__fanslyStand']?.backend)).toBe('server');
    await browser.waitUntil(async () => (await callFansly('socket'))?.state === 'connected', { timeout: 5000, timeoutMsg: 'the page’s socket did not verify' });
    await browser.waitUntil(async () => ((await callFansly('list'))?.messages ?? 0) > 0, { timeout: 5000, timeoutMsg: 'no messages' });
    const calls = await fake.calls('page', since);
    expect(calls.map((entry) => entry.route)).toEqual(expect.arrayContaining(['account.me', 'messaging.groups', 'group.detail', 'message.history', 'message.unread', 'message.automated']));
    for (const entry of calls) {
      expect(entry.path).toContain('ngsw-bypass=true');
      expect(entry.detail?.['headers']).toEqual(expect.arrayContaining(['authorization', 'fansly-client-id', 'fansly-session-id']));
    }
    // A cross-origin XHR with credentials: Firefox asked first.
    expect((await fake.journal(since)).entries.some((entry) => entry.kind === 'preflight' && entry.caller === 'page')).toBe(true);
    const before = (await callFansly('list'))?.messages ?? 0;
    await fake.command({ op: 'message', groupId: group, text: 'stand: by the socket' });
    await browser.waitUntil(async () => ((await callFansly('list'))?.messages ?? 0) === before + 1, { timeout: 3000, timeoutMsg: 'the socket’s message did not land' });
    expect((await callFansly('socket'))?.damaged).toBe(0);
    await fake.assertOursClean(since, 'the stand page alone');
  });

  it('`pushState` + a `popstate` with `state: null` (what an extension can do) opens the chat', async () => {
    const [, , c] = ids.groups as [string, string, string];
    await callFansly('open', c, 'popstate');
    await browser.waitUntil(async () => (await callFansly('route')).groupId === c, { timeout: 2000, timeoutMsg: 'the popstate did not open the chat' });
    expect(await browser.execute(() => typeof (history.state as { navigationId?: unknown } | null)?.navigationId)).toBe('number');
    expect(await $(FANSLY_MAIN.composer).isExisting()).toBe(true);
  });
});
