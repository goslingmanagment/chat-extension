// `window.__fanslyStand`: the test-control API of the stand page (protocol.ts
// FanslyStandControl). A control stands in for what the server or the socket
// would do (a fan types or writes, the group's participants or DM rules
// change): the stand's world changes first, then the page hears of it the way
// Fansly's page would. Nothing here is a Fansly behaviour of its own.

import type { StandApp } from './app';
import { liveComposers } from './composer';
import { newMessageId, standIds } from './data';
import { readJournal, record } from './journal';
import { FANSLY_STAND_GLOBAL, type FanslyStandControl, type GroupView, type OpenVia } from './protocol';
import { currentTheme, setTheme } from './theme';

export function installControl(app: StandApp): { markReady(): void } {
  let ready = false;
  const world = app.world;
  const serverGroup = (groupId: string) => {
    const group = world.byId.get(groupId);
    if (group === undefined) throw new Error(`no stand group ${groupId}`);
    return group;
  };

  const control: FanslyStandControl = {
    version: 1,
    get ready() {
      return ready;
    },
    ids: standIds(world),
    route: () => {
      const conversation = app.messages()?.conversation ?? null;
      return { path: location.pathname, groupId: conversation?.groupId || null, gallery: (conversation?.galleryAccountId ?? '') !== '' };
    },
    groups: () =>
      world.groups.map(
        (group): GroupView => ({
          id: group.id,
          fanId: group.fan.id,
          username: group.fan.username,
          partners: group.partners.length,
          dmRulesUnmet: group.dmRulesUnmet,
          unread: app.store.getGroup(group.id)?.unread ?? group.unread,
          cached: app.store.getGroup(group.id) !== null,
        }),
      ),
    open: async (groupId: string, via: OpenVia = 'router') => {
      const path = `/messages/${groupId}`;
      if (via === 'link') {
        const link = document.querySelector<HTMLAnchorElement>(`.messages-list-wrapper a[href="${path}"]`);
        if (link === null) throw new Error(`the inbox row of ${groupId} is not rendered`);
        link.click();
        await Promise.resolve();
        return;
      }
      if (via === 'popstate') {
        history.pushState(null, '', path);
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await Promise.resolve();
        return;
      }
      await app.router.navigateByUrl(path);
    },
    openInbox: () => app.router.navigateByUrl('/messages'),
    setLatency: (ms) => {
      app.latency = ms;
    },
    forget: (groupId) => app.store.forget(groupId),
    setPartners: (groupId, count) => {
      const group = serverGroup(groupId);
      group.partners = Array.from({ length: count }, (_, index) => (index === 0 ? group.fan : { id: `${group.fan.id.slice(0, -2)}${String(50 + index)}`, username: `${group.fan.username}_guest${index}`, displayName: `Guest ${index}` }));
      app.store.patch(groupId, { partners: [...group.partners] });
      record('control', { op: 'setPartners', groupId, count });
    },
    setDmRulesUnmet: (groupId, unmet) => {
      serverGroup(groupId).dmRulesUnmet = unmet;
      app.store.patch(groupId, { dmRulesUnmet: unmet });
      record('control', { op: 'setDmRulesUnmet', groupId, unmet });
    },
    setStatus: (groupId, status) => {
      serverGroup(groupId).status = status;
      app.store.patch(groupId, { status });
    },
    setGallery: (open) => {
      const conversation = app.messages()?.conversation ?? null;
      if (conversation === null) throw new Error('no chat is open');
      conversation.setGalleryAccount(open ? (conversation.group?.partners[0]?.id ?? '') : '');
    },
    fanTyping: (groupId) => app.store.typing(groupId, serverGroup(groupId).fan.id),
    fanMessage: (groupId, text) => {
      const group = serverGroup(groupId);
      const message = { id: newMessageId(world), groupId, senderId: group.fan.id, content: text, createdAt: Math.floor(Date.now() / 1000), attachments: [] };
      group.history.push(message);
      app.store.receive(message);
    },
    growLastMessage: (px) => {
      const container = app.mainContainer();
      const last = container?.list.querySelectorAll<HTMLElement>('app-group-message').item(container.list.querySelectorAll('app-group-message').length - 1);
      if (last === null || last === undefined) throw new Error('no message to grow');
      last.style.paddingBottom = `${(Number.parseFloat(last.style.paddingBottom) || 0) + px}px`;
    },
    setTheme: (theme) => setTheme(theme),
    setOldExtension: (on) => app.oldMarks.set(on),
    setMiniChat: (groupId) => app.miniChat.open(groupId),
    recreateField: () => {
      const composer = app.mainContainer()?.composer ?? null;
      if (composer === null) throw new Error('no main composer');
      composer.recreateField();
    },
    composers: () => [...liveComposers].map((composer) => composer.view()),
    list: () => app.mainContainer()?.listView() ?? null,
    inbox: () => app.messages()?.inbox.view() ?? { loaded: app.store.inbox.length, rendered: [], selected: null, topSpacer: 0, bottomSpacer: 0 },
    modals: () => app.modals.tags,
    journal: (since = 0) => readJournal(since),
  };
  Object.defineProperty(window, FANSLY_STAND_GLOBAL, { value: control, configurable: true });
  return {
    markReady: () => {
      ready = true;
      record('ready', { theme: currentTheme() });
    },
  };
}
