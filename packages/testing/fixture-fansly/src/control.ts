// `window.__fanslyStand`: the test-control API of the stand page (protocol.ts
// FanslyStandControl). A control stands in for what the server or the socket
// would do (a fan types or writes, the group's participants or DM rules
// change): the stand's world changes first, then the page hears of it the way
// Fansly's page would. Nothing here is a Fansly behaviour of its own.
// Over the fake Fansly (R20 P6b) the world is the SERVER's: these controls ask
// it (a control request), and the page hears through its socket — a moment
// later, not inside the call.

import type { StandApp } from './app';
import { liveComposers } from './composer';
import { newMessageId, standIds } from './data';
import { readJournal, record } from './journal';
import { FANSLY_STAND_GLOBAL, type FanslyStandControl, type GroupView, type OpenVia } from './protocol';
import type { FakeFanslyCommand } from './server-protocol';
import { currentTheme, setTheme } from './theme';

export function installControl(app: StandApp): { markReady(): void } {
  let ready = false;
  const world = app.world;
  const live = app.live;
  /** A command to the fake Fansly: its failure is the stand's, journaled, never an exception inside a control call. */
  const ask = (command: FakeFanslyCommand): void => {
    void live?.command(command).catch((error: unknown) => record('control-failed', { op: command.op, message: error instanceof Error ? error.message : String(error) }));
  };
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
    backend: live === null ? 'local' : 'server',
    get loggedOut() {
      return live?.loggedOut ?? false;
    },
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
          partners: app.store.getGroup(group.id)?.partners.length ?? group.partners.length,
          dmRulesUnmet: app.store.getGroup(group.id)?.dmRulesUnmet ?? group.dmRulesUnmet,
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
      record('control', { op: 'setPartners', groupId, count });
      if (live !== null) {
        ask({ op: 'group', groupId, partners: count });
        return;
      }
      group.partners = Array.from({ length: count }, (_, index) => (index === 0 ? group.fan : { id: `${group.fan.id.slice(0, -2)}${String(50 + index)}`, username: `${group.fan.username}_guest${index}`, displayName: `Guest ${index}` }));
      app.store.patch(groupId, { partners: [...group.partners] });
    },
    // The DM rules and the status have no socket event the stand knows of: the server learns of the change (its
    // next answers carry it) and the page's group changes in place, as after a re-read of the group.
    setDmRulesUnmet: (groupId, unmet) => {
      serverGroup(groupId).dmRulesUnmet = unmet;
      ask({ op: 'group', groupId, dmRulesUnmet: unmet });
      app.store.patch(groupId, { dmRulesUnmet: unmet });
      record('control', { op: 'setDmRulesUnmet', groupId, unmet });
    },
    setStatus: (groupId, status) => {
      serverGroup(groupId).status = status;
      ask({ op: 'group', groupId, status });
      app.store.patch(groupId, { status });
    },
    setGallery: (open) => {
      const conversation = app.messages()?.conversation ?? null;
      if (conversation === null) throw new Error('no chat is open');
      conversation.setGalleryAccount(open ? (conversation.group?.partners[0]?.id ?? '') : '');
    },
    fanTyping: (groupId) => {
      if (live !== null) ask({ op: 'typing', groupId });
      else app.store.typing(groupId, serverGroup(groupId).fan.id);
    },
    fanMessage: (groupId, text) => {
      const group = serverGroup(groupId);
      if (live !== null) {
        ask({ op: 'message', groupId, text });
        return;
      }
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
    socket: () => live?.socket() ?? null,
    idle: () => live?.idle() ?? true,
    notify: (messageIds) => live?.notify(messageIds),
    cameBack: (hiddenMs) => live?.cameBack(hiddenMs),
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
