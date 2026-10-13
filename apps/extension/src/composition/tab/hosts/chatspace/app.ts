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
// And ChatSpace's slice of the feature manifest (§1.4), which the application
// reads through the adapter and never by a site's name.

import { CHATSPACE_CONTRACT } from '@cg/contracts/host';
import type { Bootstrap } from '@cg/contracts/hub';
import type { SendFuseState } from '@cg/contracts/send';
import { flagOnSomePage } from '@cg/core/domain/ops';
import type { ChatSpaceHostPort, ChatSpaceLiveConfig } from '@cg/host-chatspace/isolated';

import { CHATSPACE_FEATURE_SLICE } from '../../../features/chatspace';
import type { HostAppAdapter } from '../../adapter';

const LIVE_OFF: ChatSpaceLiveConfig = { wsTap: false, previewSend: false, markAiGenerated: false, receiptProfiles: [] };

/** Part B of the port as the bootstrap sets it, with the browser's X8 fuse (null — not read yet). */
export function liveConfigOf(bootstrap: Bootstrap | null, fuse: SendFuseState | null = null): ChatSpaceLiveConfig {
  if (bootstrap === null) return LIVE_OFF;
  // Never the top-level `flags` (the owner's `"*"` row alone): a page switched on by itself must work.
  return {
    wsTap: flagOnSomePage(bootstrap, 'wsTap'),
    // On for at least one page of this sign-in; the preview checks its own page before a send, and the hub
    // checks the page's own flag again on every dispatch.
    previewSend: flagOnSomePage(bootstrap, 'previewSend'),
    markAiGenerated: flagOnSomePage(bootstrap, 'previewSendMarkAiGenerated'),
    receiptProfiles: bootstrap.limits.previewSendReceiptProfiles,
    // A fuse that never tripped and was never reset tells the port nothing: the configuration stays as it was.
    ...(fuse === null || (fuse.fuse === null && fuse.resetAt === null) ? {} : { fuse }),
  };
}

export const CHATSPACE_APP: HostAppAdapter<ChatSpaceHostPort, ChatSpaceLiveConfig> = {
  liveConfigOf,
  configure: (host, config) => host.configure(config),
  features: CHATSPACE_FEATURE_SLICE,
  contract: CHATSPACE_CONTRACT,
};
