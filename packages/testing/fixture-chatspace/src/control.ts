// `window.__stand`: the test-control API of the fixture page (protocol.ts
// StandControl). Server-side state changes go through the control endpoints
// (labelled `control` in the server journal, never `native`), and the page
// caches are patched the way a push or a refetch would have patched them.

import { CONTROL_REQUEST_HEADER, STAND_BREAK_PARAM, type FanPatch, type MimicState, type QueryObserverState, type SendOutcome, type StandControl } from './protocol';
import { env } from './env';
import { readJournal, record } from './journal';
import { isOwner, isSignedIn } from './net/auth';
import { socket, socketState } from './net/socket';
import { useQueryCache } from './query/cache';
import type { FansMap } from './query/model';
import { keys, optionsForKey } from './query/queries';
import { holdObserver, releaseObserver } from './query/use-query';
import { useChatsStore } from './stores/chats';
import { useComposerTranslator } from './stores/composer';
import { usePendingMessages } from './stores/pending-messages';
import { draftKey } from './ui/bridge';
import { remountComposers } from './ui/composer';
import type { Navigation } from './ui/navigation';
import { composerSnapshots, findComposer, messageListState } from './ui/registry';
import { setSidePanel } from './ui/side-panel';
import { setFixedWidth, setThemeMode } from './ui/theme';

/** The page's own fetch as it was at boot: control calls must not pass through anything the extension installed. */
const bootFetch = globalThis.fetch.bind(globalThis);

async function control(path: string, body: unknown): Promise<unknown> {
  const response = await bootFetch(path, { method: 'POST', headers: { 'content-type': 'application/json', [CONTROL_REQUEST_HEADER]: '1' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`stand control ${path}: ${response.status}`);
  return response.json();
}

export function installControl(nav: Navigation): { readonly markReady: () => void } {
  const cache = useQueryCache();
  let ready = false;

  const api: StandControl = {
    version: 1,
    get ready() {
      return ready;
    },
    breaks: [...env.breaks],
    route: () => ({
      name: typeof nav.router.currentRoute.value.name === 'string' ? nav.router.currentRoute.value.name : null,
      accountId: nav.currentAccountId(),
      chatId: nav.currentChatId(),
    }),
    openChat: (accountId, chatId, options) => nav.openChat(accountId, chatId, options ?? {}),
    openAccount: (accountId) => nav.openAccount(accountId),
    closeActiveChatTab: () => nav.closeActiveChatTab('control'),
    setTheme: (mode) => setThemeMode(mode),
    setFixedWidth: (on, align) => setFixedWidth(on, align),
    setSidePanel: (state) => setSidePanel(state),
    composers: () => composerSnapshots(),
    composerState: (accountId, chatId) => {
      const editor = findComposer(accountId, chatId)?.editor.tiptap ?? null;
      if (editor === null) return null;
      return {
        text: editor.getText(),
        html: editor.getHTML(),
        marks: { bold: editor.isActive('bold'), italic: editor.isActive('italic'), code: editor.isActive('code'), strike: editor.isActive('strike') },
      };
    },
    draft: (accountId, chatId) => {
      const raw = localStorage.getItem(draftKey(accountId, chatId));
      return raw === null ? null : (JSON.parse(raw) as unknown);
    },
    messageList: () => messageListState(),
    queryState: (key): QueryObserverState => {
      const entry = cache.get(key);
      return {
        exists: entry !== undefined,
        hasData: entry?.state.value.data !== undefined,
        active: entry?.active ?? false,
        loading: entry?.asyncStatus.value === 'loading',
        stale: entry?.stale ?? true,
        observers: entry?.deps.size ?? 0,
      };
    },
    queryData: (key) => JSON.parse(JSON.stringify(cache.getQueryData(key) ?? null)) as unknown,
    holdQueryObserver: (key) => holdObserver(key, optionsForKey(key, cache)),
    releaseQueryObserver: (token) => releaseObserver(token),
    pendingMessages: () => JSON.parse(JSON.stringify(usePendingMessages().messagesByAccountId)) as unknown,
    setQueueTimeoutMs: (ms) => {
      env.queueTimeoutMs = ms;
      record('stand-queue-timeout', { ms });
    },
    setEditorDelayMs: (ms) => {
      env.editorChunkDelayMs = ms;
      record('stand-editor-delay', { ms });
    },
    setRouteDelayMs: (ms) => {
      env.routeDelayMs = ms;
      record('stand-route-delay', { ms });
    },
    remountComposers: (gapMs) => remountComposers(gapMs),
    sendAfterNextWrite: (accountId, chatId) => {
      env.sendAfterWrite = `${accountId}:${chatId}`;
      record('stand-send-after-write', { accountId, chatId });
    },
    injectFanMessage: async (accountId, fanId, text) => {
      const result = (await control('/__stand/fan-message', { accountId, fanId, ...(text !== undefined ? { text } : {}) })) as { id: string };
      return result.id;
    },
    scriptSend: async (accountId, chatId, outcomes: readonly SendOutcome[]) => {
      await control('/__stand/script/send', { accountId, chatId, outcomes });
    },
    setFan: async (accountId, fanId, patch: FanPatch) => {
      await control('/__stand/state', { fans: [{ accountId, fanId, patch }] });
      cache.setQueryData<FansMap>(keys.fansMap(accountId), (previous) => {
        const fan = previous?.[fanId];
        if (fan === undefined || fan === null) return previous ?? {};
        return {
          ...previous,
          [fanId]: {
            ...fan,
            ...(patch.isBlocked !== undefined ? { isBlocked: patch.isBlocked } : {}),
            ...(patch.isRestricted !== undefined ? { isRestricted: patch.isRestricted } : {}),
            ...(patch.canReceiveChatMessage !== undefined ? { canReceiveMessages: patch.canReceiveChatMessage } : {}),
            ...(patch.subscribedOn !== undefined ? { isSubscribed: patch.subscribedOn, isExpired: !patch.subscribedOn } : {}),
          },
        };
      });
    },
    setFanOnline: (accountId, fanId, online) => useChatsStore().updateOnlineStatuses(accountId, { [fanId]: online }),
    setTranslator: (accountId, settings) => {
      const current = useComposerTranslator().getAccountSettings(accountId);
      current.value = { ...current.value, ...settings };
    },
    setMimic: async (state: MimicState) => {
      await control('/__stand/state', { mimic: state });
      cache.setQueryData(keys.mimicSettings(), { isActive: state.isActive });
      cache.setQueryData(
        keys.mimicChats(),
        Object.fromEntries(
          Object.entries(state.chats)
            .filter(([, status]) => status !== 'disabled')
            .map(([key, status]) => {
              const [accountId = '', fanId = ''] = key.split(':');
              return [key, { accountId, fanId, status }];
            }),
        ),
      );
    },
    setPermissions: async (permissions, owner) => {
      await control('/__stand/state', { permissions, ...(owner !== undefined ? { owner } : {}) });
      if (owner !== undefined) isOwner.value = owner;
      cache.setQueryData(keys.userPermissions(), [...permissions]);
    },
    wsStatus: () => {
      const state = socketState();
      return { status: state.status, sockets: state.sockets, authenticated: state.authenticated };
    },
    reconnectWs: () => socket.reconnect(),
    signOut: () => {
      record('signed-out');
      isSignedIn.value = false;
      socket.close();
    },
    journal: (since) => readJournal(since),
    simulateBuildChange: (breaks) => {
      const url = new URL(location.href);
      if (breaks.length === 0) url.searchParams.delete(STAND_BREAK_PARAM);
      else url.searchParams.set(STAND_BREAK_PARAM, breaks.join(','));
      location.assign(url.toString());
    },
  };
  Object.defineProperty(window, '__stand', { value: api, configurable: true, enumerable: false, writable: false });
  return {
    markReady: () => {
      ready = true;
    },
  };
}
