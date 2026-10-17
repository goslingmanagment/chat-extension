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
import { flagOnSomePage } from '@cg/core/domain/ops';
import type { ChatSpaceHostPort, ChatSpaceLiveConfig } from '@cg/host-chatspace/isolated';
import { CHATSPACE_UI } from '@cg/host-chatspace/isolated/profile';

import { CHATSPACE_FEATURE_SLICE } from '../../../features/chatspace';
import type { HostAppAdapter } from '../../adapter';

const LIVE_OFF: ChatSpaceLiveConfig = { wsTap: false, previewSend: false, markAiGenerated: false, receiptProfiles: [], attribution: false };

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
    // A fuse that never tripped and was never reset tells the port nothing: the configuration stays as it was.
    ...(fuse === null || (fuse.fuse === null && fuse.resetAt === null) ? {} : { fuse }),
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
};
