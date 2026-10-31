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

import type { MountSurfaceKind } from '@cg/contracts/vm';

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
 * ChatSpace's own surfaces (2026-10-28): «Заметки», whose chunk loads the first time a chat is open and is kept; it
 * says itself where its button and panel stand. A chunk that did not load is asked again on the next chat.
 */
export function startChatSpaceSurfaces(env: SiteAppEnv<ChatSpaceHostPort>): () => void {
  let notes: Promise<(() => void) | null> | null = null;
  const sync = (): void => {
    if (env.life.aborted || notes !== null || env.host.current().route.chat === null) return;
    notes = env.lazy<typeof NotesChunk>('notes').then(
      (chunk) => (env.life.aborted ? null : chunk.startChatSpaceNotes(env)),
      () => {
        notes = null;
        env.report({ kind: 'render', surface: 'notes' as MountSurfaceKind, code: 'CG-UI-FAILED', name: 'NotesChunk' });
        return null;
      },
    );
  };
  const off = env.host.subscribe((event) => {
    if (event.type === 'route') sync();
  });
  sync();
  return () => {
    off();
    void notes?.then((stop) => stop?.());
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
