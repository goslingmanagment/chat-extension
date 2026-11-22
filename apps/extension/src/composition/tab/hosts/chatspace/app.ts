// The application's half of the ChatSpace adapter (docs/project-unite/
// architecture.md §1.3; tab/adapter.ts): what only ChatSpace's application
// does with ChatSpace's host port. It is in ChatSpace's `tab-app` chunk
// (lazy/entries/tab-app.ts), never in the early bundle: the flag rules of the
// bootstrap it reads weigh ≈ 2 KiB gzip there.
//
// The bootstrap switches the port's part B (architecture.md §6.2, §6.7,
// §6.8): the WebSocket tap, X8 and its receipt profiles, the AI mark of a
// preview's send, with the browser's X8 fuse (decision X25). The port serves
// every account of the tab, so each part is on while its switch is usable on
// at least one granted page (tab/host-facts.ts says where the page's own value
// is applied).
//
// And ChatSpace's slice of the feature manifest (§1.4), its profile for our
// interface (§1.5) and its AI policy (R20 F10), which the application reads
// through the adapter and never by a site's name.

import { CHATSPACE_CONTRACT } from '@cg/contracts/host';
import { hasCapability, type Bootstrap } from '@cg/contracts/hub';
import type { SendFuseState } from '@cg/contracts/send';
import { CHATSPACE_AI } from '@cg/core/application/hosts/chatspace/ai';
import { createChatSpaceOnlineSource } from '@cg/core/application/hosts/chatspace/online';
import { flagOnSomePage } from '@cg/core/domain/ops';
import type { ChatSpaceHostPort, ChatSpaceLiveConfig } from '@cg/host-chatspace/isolated';
import { CHATSPACE_UI } from '@cg/host-chatspace/isolated/profile';
import { ONLYFANS_SALE_LOOK, findTransactionRow, transactionsWindow } from '@cg/host-chatspace/isolated/transactions-finder';
import { startChatSpaceFeedPoll } from '@cg/core/application/hosts/chatspace/feed-poll';

import type { MountSurfaceKind } from '@cg/contracts/vm';

import type * as ChatLengthChunk from '../../../../../lazy/chatspace/chat-length';
import type * as NotesChunk from '../../../../../lazy/chatspace/notes';
import { CHATSPACE_FEATURE_SLICE } from '../../../features/chatspace';
import type { HostAppAdapter, SiteAppEnv } from '../../adapter';

const LIVE_OFF: ChatSpaceLiveConfig = { wsTap: false, previewSend: false, markAiGenerated: false, receiptProfiles: [], attribution: false, onlyfansFeed: false };

/** Part B of the port as the bootstrap sets it, with the browser's X8 fuse (null — not read yet). */
export function liveConfigOf(bootstrap: Bootstrap | null, fuse: SendFuseState | null = null): ChatSpaceLiveConfig {
  if (bootstrap === null) return LIVE_OFF;
  // Never the top-level `flags` (the owner's `"*"` row alone): a page switched on by itself must work.
  const wsTap = flagOnSomePage(bootstrap, 'wsTap');
  return {
    wsTap,
    // On for at least one page of this sign-in; the preview checks its own page before a send, and the hub
    // checks the page's own flag again on every dispatch.
    previewSend: flagOnSomePage(bootstrap, 'previewSend'),
    markAiGenerated: flagOnSomePage(bootstrap, 'previewSendMarkAiGenerated'),
    receiptProfiles: bootstrap.limits.previewSendReceiptProfiles,
    // Decision X48: while the hub records who sent each message, MAIN follows every human send to its receipt. The
    // receipt pairs with the tap's echo, so it needs the tap; the background reports a send of a page where the
    // feature `send-attribution` is on (its page's own `wsTap`).
    attribution: wsTap && hasCapability(bootstrap.capabilities, 'send-attribution-v1'),
    // 2026-11-01 (hub #953): the OnlyFans feed, heard by the tap, on while some granted page has `ofFeed` and the hub
    // takes it; the background reports an account's records only for its page's own `ofFeed` (feature `onlyfans-feed`).
    onlyfansFeed: wsTap && flagOnSomePage(bootstrap, 'ofFeed') && hasCapability(bootstrap.capabilities, 'onlyfans-feed-v1'),
    // A fuse that never tripped and was never reset tells the port nothing: the configuration stays as it was.
    ...(fuse === null || (fuse.fuse === null && fuse.resetAt === null) ? {} : { fuse }),
  };
}

/**
 * ChatSpace's own surfaces (2026-10-28): «Заметки», and since 2026-11-11 the chat's length after it in the chat header
 * (the owner: «и с хуя ли на чатспейсе его нет?»). Each chunk loads the first time a chat is open and is kept; each says
 * itself where it stands. A chunk that did not load is asked again on the next chat. And (2026-11-15) the clicks of the
 * launcher at the bottom of the account rail, as Fansly's corner card's.
 */
export function startChatSpaceSurfaces(env: SiteAppEnv<ChatSpaceHostPort>): () => void {
  // hub #955: the OnlyFans feed's light reads of ChatSpace, for the accounts of this tab whose page lends this tab its
  // poll (the background asks the hub; a page without `ofPoll` answers nothing).
  const stopPoll = startChatSpaceFeedPoll({
    port: env.host.feedPoll,
    accounts: () => env.host.current().accounts,
    lend: (hostAccountId, creatorId, passed) =>
      env.rpc.request('feed.poll', { hostAccountId, creatorId, ...(passed === undefined ? {} : { passed }) }).then((answer) => (answer.ok ? answer.payload : null), () => null),
    clock: { now: () => Date.now() },
    random: Math.random,
    setTimer: (ms, fn) => env.win.setTimeout(fn, ms),
    clearTimer: (handle) => env.win.clearTimeout(handle as number),
    // The board «Отчёт» asks its OnlyFans pages' statements now (hub package R): the accounts of this tab bound to them.
    onSoon: (listener) =>
      env.rpc.onEvent('report.statement', ({ pages }) => {
        const accounts = env.host.current().accounts;
        void Promise.all(
          accounts.map((account) => env.rpc.request('binding.resolve', { account }).then((answer) => (answer.ok && pages.includes(answer.payload.binding.pageLabel) ? account.hostAccountId : null), () => null)),
        ).then((ids) => listener(ids.filter((id): id is string => id !== null)));
      }),
  });
  env.life.addEventListener('abort', stopPoll, { once: true });
  let notes: Promise<(() => void) | null> | null = null;
  let chatLength: Promise<(() => void) | null> | null = null;
  const sync = (): void => {
    if (env.life.aborted || env.host.current().route.chat === null) return;
    notes ??= env.lazy<typeof NotesChunk>('notes').then(
      (chunk) => (env.life.aborted ? null : chunk.startChatSpaceNotes(env)),
      () => {
        notes = null;
        env.report({ kind: 'render', surface: 'notes' as MountSurfaceKind, code: 'CG-UI-FAILED', name: 'NotesChunk' });
        return null;
      },
    );
    chatLength ??= env.lazy<typeof ChatLengthChunk>('chat-length').then(
      (chunk) => (env.life.aborted ? null : chunk.startChatSpaceChatLength(env)),
      () => {
        chatLength = null;
        env.report({ kind: 'render', surface: 'header-slot' as MountSurfaceKind, code: 'CG-UI-FAILED', name: 'ChatLengthChunk' });
        return null;
      },
    );
  };
  const off = env.host.subscribe((event) => {
    if (event.type === 'route') sync();
  });
  sync();
  // The rail's launcher (ui-design §3.13) opens its window as the popup's command does (`Navigate` to the surface): the
  // click kept while the application loaded at once, every next one in its own click — the gate sees it through our root.
  // A refusal speaks for itself where the router says it (a toast, the window's own state), as for the popup's command.
  // 2026-11-15 (hub package R): the fifth icon «Отчёт» opens Workboard's board over the site (tab/frames.ts), the last
  // one «Кастомы» Workboard's customs screen the same way. Nothing of them in ChatSpace's dock (the owner): only the
  // icons at the bottom of the account rail.
  const offLauncher = env.host.launcher.serve((surface) => {
    if (surface === 'report' || surface === 'customs') env.frames?.open(surface);
    else void env.deps.client.dispatch({ type: 'Navigate', to: { kind: 'surface', surface, open: true } }).catch(() => undefined);
  });
  // The board's bar starts right of the account rail: the rail and its icons stay whole (ChatSpace's own width).
  const railWidth = Number.parseFloat(env.win.getComputedStyle(env.win.document.documentElement).getPropertyValue('--account-sidebar-width'));
  env.frames?.inset(Number.isFinite(railWidth) && railWidth > 0 && railWidth < 200 ? railWidth : 0);
  // The buttons wear the scheme of our surfaces, so they stay the dock's chips under «Тема».
  const offScheme = env.host.launcher.follow(env.deps.scheme);
  return () => {
    off();
    offLauncher();
    offScheme();
    void notes?.then((stop) => stop?.());
    void chatLength?.then((stop) => stop?.());
  };
}

export const CHATSPACE_APP: HostAppAdapter<ChatSpaceHostPort, ChatSpaceLiveConfig> = {
  liveConfigOf,
  configure: (host, config) => host.configure(config),
  features: CHATSPACE_FEATURE_SLICE,
  contract: CHATSPACE_CONTRACT,
  // The page's own palette reaches our hosts by inheritance: ChatSpace's theme has nothing to give the profile.
  ui: () => CHATSPACE_UI,
  // ChatSpace's policy is small and rides here, in its `tab-app`: nothing to load.
  ai: () => CHATSPACE_AI,
  // ChatSpace 0.195 shows its own fan panel next to the chat (spend, subscription, scores, lists, profile): ours shows
  // only what it lacks (decision X47).
  fanPanelBesideHost: true,
  start: (env) => startChatSpaceSurfaces(env),
  // «Show on the site» (hub package R): the sale's row in ChatSpace's transactions window (host-chatspace
  // isolated/transactions-finder.ts, built from the documents: ChatSpace live is closed to agents).
  findSale: (win, sale) => findTransactionRow(win, sale),
  saleLook: ONLYFANS_SALE_LOOK,
  saleScreen: (win) => transactionsWindow(win.document) !== null,
  // «Онлайн» (2026-10-31, hub #952): OnlyFansAPI's feed stops, so ChatSpace's own word of who is online goes to the hub —
  // its online poll from the page's memory and, where the owner's `onlineProbe` is on, the page's probe.
  online: ({ rpc, host, win, clock }) =>
    createChatSpaceOnlineSource({
      port: host.onlinePresence,
      accounts: () => host.current().accounts,
      report: (pageId, seen) => rpc.request('online.presence', { pageId, seen: [...seen] }).then((answer) => answer.ok, () => false),
      lend: (pageId) => rpc.request('online.probe', { pageId }).then((answer) => (answer.ok ? answer.payload : null), () => null),
      clock,
      random: Math.random,
      visible: () => win.document.visibilityState === 'visible',
    }),
};
