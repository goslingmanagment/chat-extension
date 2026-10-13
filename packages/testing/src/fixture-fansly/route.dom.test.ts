// The Fansly-like stand's route and header lifecycle (fixture-fansly; R20 P6a):
// what fansly.com re-creates on a chat change and what it re-creates without
// one (docs/project-unite/fansly-web.md §3; main:74512-74566, :74723-74724).

import { afterEach, describe, expect, it } from 'vitest';

import { apiCalls, contactBlock, headerRow, mainComposer, mainContainer, mountStand, route, settle, type MountedStand } from './harness';

let stand: MountedStand | null = null;

afterEach(() => {
  stand?.unmount();
  stand = null;
});

describe('the Fansly stand: the conversation route', () => {
  it('reuses the route but makes a new container, composer and contact block on every chat change; the header root survives', async () => {
    stand = await mountStand('/messages');
    const [a, b] = stand.control.ids.groups;
    await stand.control.open(a as string);
    const first = { route: route(), header: route()?.querySelector(':scope > div.message-content-header'), contact: contactBlock(), container: mainContainer(), composer: mainComposer() };
    expect(first.container).not.toBeNull();
    expect(first.composer).not.toBeNull();
    expect(first.contact?.querySelector('.content-header-sub-row .gallery-hot-icon')).not.toBeNull();
    expect(location.pathname).toBe(`/messages/${String(a)}`);

    // A cached group: everything is made again within the navigation itself, before any answer.
    await stand.control.open(b as string);
    expect(route()).toBe(first.route);
    expect(route()?.querySelector(':scope > div.message-content-header')).toBe(first.header);
    expect(contactBlock()).not.toBeNull();
    expect(contactBlock()).not.toBe(first.contact);
    expect(mainContainer()).not.toBe(first.container);
    expect(mainComposer()).not.toBe(first.composer);
    expect(first.container?.isConnected).toBe(false);
    expect(first.contact?.isConnected).toBe(false);
    const instances = stand.control.composers().filter((composer) => composer.place === 'main');
    expect(instances).toHaveLength(1);
    expect(instances[0]?.groupId).toBe(b);
  });

  it('an uncached group: the old container and contact block go at once, the new ones after `GET /group/<id>/`', async () => {
    stand = await mountStand('/messages');
    const [a, b] = stand.control.ids.groups;
    await stand.control.open(a as string);
    stand.control.forget(b as string);
    const mark = stand.control.journal().at(-1)?.seq ?? 0;
    await stand.control.open(b as string);
    expect(location.pathname).toBe(`/messages/${String(b)}`);
    expect(mainContainer()).toBeNull();
    expect(contactBlock()).toBeNull();
    expect(headerRow()?.querySelector('.back-button')).not.toBeNull();
    await settle();
    expect(mainContainer()).not.toBeNull();
    expect(contactBlock()).not.toBeNull();
    const journal = stand.control.journal(mark);
    expect(apiCalls(journal, 'GET', new RegExp(`^/api/v1/group/${String(b)}/`))).toHaveLength(1);
    expect(apiCalls(journal, 'GET', new RegExp(`^/api/v1/message\\?groupId=${String(b)}&limit=25`))).toHaveLength(1);
  });

  it('A → B → A asks for no history again; every entry asks for the group', async () => {
    stand = await mountStand('/messages');
    const [a, b] = stand.control.ids.groups;
    await stand.control.open(a as string);
    await settle();
    const mark = stand.control.journal().at(-1)?.seq ?? 0;
    await stand.control.open(b as string);
    await settle();
    await stand.control.open(a as string);
    await settle();
    const journal = stand.control.journal(mark);
    expect(apiCalls(journal, 'GET', /^\/api\/v1\/message\?groupId=/).map((entry) => String(entry['path']))).toEqual([expect.stringContaining(`groupId=${String(b)}&`)]);
    expect(apiCalls(journal, 'GET', /^\/api\/v1\/group\//)).toHaveLength(2);
  });

  it('a new partner count re-creates the contact block and the avatar without an address change; the container stays', async () => {
    stand = await mountStand('/messages');
    const [a] = stand.control.ids.groups;
    await stand.control.open(a as string);
    const contact = contactBlock();
    const container = mainContainer();
    const composer = stand.control.composers()[0]?.instance;
    const path = location.pathname;
    stand.control.setPartners(a as string, 2);
    expect(contactBlock()).toBeNull();
    expect(headerRow()?.querySelector('.message-content-header-avatar')).toBeNull();
    expect(mainContainer()).toBe(container);
    stand.control.setPartners(a as string, 1);
    expect(contactBlock()).not.toBeNull();
    expect(contactBlock()).not.toBe(contact);
    expect(headerRow()?.querySelector('.message-content-header-avatar')).not.toBeNull();
    expect(mainContainer()).toBe(container);
    expect(stand.control.composers()[0]?.instance).toBe(composer);
    expect(location.pathname).toBe(path);
  });

  it('a status change re-renders the sub-row’s status line before its anchor; a node after the gallery icon stays', async () => {
    stand = await mountStand('/messages');
    const [a] = stand.control.ids.groups;
    await stand.control.open(a as string);
    const row = contactBlock()?.querySelector<HTMLElement>('.content-header-sub-row');
    const ours = document.createElement('div');
    row?.querySelector('.gallery-hot-icon')?.after(ours);
    stand.control.setStatus(a as string, 4);
    expect(row?.querySelector('.active-status')).toBeNull();
    stand.control.setStatus(a as string, 1);
    expect(row?.querySelector('.active-status')?.textContent).toBe('Active now');
    expect(row?.querySelector('.divider')).not.toBeNull();
    expect(ours.isConnected).toBe(true);
    expect(row?.lastElementChild).toBe(ours);
  });

  it('the gallery replaces the chat header and the container without an address change; back makes new ones', async () => {
    stand = await mountStand('/messages');
    const [a] = stand.control.ids.groups;
    await stand.control.open(a as string);
    const header = route()?.querySelector(':scope > div.message-content-header');
    const composer = stand.control.composers()[0]?.instance ?? 0;
    const path = location.pathname;
    contactBlock()?.querySelector<HTMLElement>('.gallery-hot-icon')?.click();
    expect(stand.control.route()).toEqual({ path, groupId: a, gallery: true });
    expect(mainContainer()).toBeNull();
    expect(header?.isConnected).toBe(false);
    // Its own header repeats the class, so a locator of «the chat header» must not take it for one.
    const galleryHeader = route()?.querySelector<HTMLElement>(':scope > div.message-content-header');
    expect(galleryHeader?.querySelector('.back-button-always')).not.toBeNull();
    expect(galleryHeader?.querySelector('.message-content-header-contact')).toBeNull();
    expect(route()?.querySelector(':scope > app-group-media-offers.media-content')).not.toBeNull();
    expect(location.pathname).toBe(path);
    galleryHeader?.querySelector<HTMLElement>('.back-button-always')?.click();
    expect(stand.control.route().gallery).toBe(false);
    expect(mainContainer()).not.toBeNull();
    expect(stand.control.composers()[0]?.instance).toBeGreaterThan(composer);
  });

  it('`/messages` alone: the default route in the outlet, no conversation; leaving `/messages` takes the route away', async () => {
    stand = await mountStand('/messages');
    expect(document.querySelector('.messages-content-wrapper > router-outlet + app-messages-default-conversation-route')).not.toBeNull();
    expect(route()).toBeNull();
    const [a] = stand.control.ids.groups;
    await stand.control.open(a as string);
    expect(document.querySelector('app-messages-default-conversation-route')).toBeNull();
    expect(document.querySelector('.messages-content-wrapper > router-outlet + app-messages-conversation-route')).not.toBeNull();
    await stand.app.router.navigateByUrl('/home');
    expect(document.querySelector('app-messages-route')).toBeNull();
    expect(document.querySelector('.content-wrapper > router-outlet + app-home-route')).not.toBeNull();
    expect(stand.control.composers()).toEqual([]);
  });

  it('a `popstate` with `state: null` opens the chat a task later and replaces the entry with the router’s own state', async () => {
    stand = await mountStand('/messages');
    const [, b] = stand.control.ids.groups;
    history.pushState(null, '', `/messages/${String(b)}`);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    await Promise.resolve();
    expect(route()).toBeNull();
    await settle(1);
    expect(stand.control.route().groupId).toBe(b);
    expect((history.state as { navigationId?: number } | null)?.navigationId).toEqual(expect.any(Number));
    const navigation = stand.control.journal().filter((entry) => entry.type === 'navigation').at(-1);
    expect(navigation).toMatchObject({ source: 'popstate', restored: null, path: `/messages/${String(b)}` });
  });

  it('the address changes before the route renders, in the same task (the router calls the history instance at call time)', async () => {
    stand = await mountStand('/messages');
    const [a] = stand.control.ids.groups;
    const seen: Array<{ readonly at: string; readonly container: boolean }> = [];
    // A hook on the instance (the prototype's method stays): the router must see it, it calls at call time.
    history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
      seen.push({ at: 'pushState', container: mainContainer() !== null });
      History.prototype.pushState.apply(this, args);
    };
    try {
      await stand.control.open(a as string);
    } finally {
      Reflect.deleteProperty(history, 'pushState');
    }
    expect(seen).toEqual([{ at: 'pushState', container: false }]);
    expect(mainContainer()).not.toBeNull();
  });

  it('a chat entry marks it read once (`POST /message/ack`) when it has unread messages', async () => {
    stand = await mountStand('/messages');
    const unread = stand.control.groups().find((group) => group.unread > 0);
    expect(unread).toBeDefined();
    const mark = stand.control.journal().at(-1)?.seq ?? 0;
    await stand.control.open(unread?.id ?? '');
    await settle();
    expect(apiCalls(stand.control.journal(mark), 'POST', /^\/api\/v1\/message\/ack/)).toHaveLength(1);
    expect(stand.control.groups().find((group) => group.id === unread?.id)?.unread).toBe(0);
  });

  it('ids are Fansly’s: 18-digit strings above 2^53, a group never its fan', async () => {
    stand = await mountStand('/messages');
    const { ids } = stand.control;
    for (const id of [ids.creator, ...ids.groups, ...Object.values(ids.fans)]) {
      expect(id).toMatch(/^[1-9]\d{17}$/);
      expect(BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    }
    for (const group of ids.groups) expect(ids.fans[group]).not.toBe(group);
  });
});
