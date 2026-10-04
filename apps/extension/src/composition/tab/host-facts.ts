// What the page tells the tab and the tab passes on (architecture.md §6.6,
// §6.8, §8.3, §9.8), and what the bootstrap tells the host adapter:
//
// - every incoming-message fact (the WS tap or the stores; no text) goes to
//   the background's one sound arbiter as it is — the tab decides nothing
//   about sound (SN-016);
// - a human send whose draft descends from an insert of a preview or a
//   «Новые» card («Открыть и вставить») is reported for that part's operation
//   — telemetry `sent` and, for a greeting, its registration are the
//   background's. The dock's own inserts are reported by R11's workspace,
//   which knows them; an attribution that is not known is never guessed;
// - the owner's flags and the receipt profiles of the bootstrap configure
//   the adapter's part B (the tap, X8, the AI mark), and its limit sets the
//   deadline of «Открыть и вставить».
//
// Facts only: ids, digests, booleans. Never a message text.

import type { Bootstrap } from '@cg/contracts/hub';
import type { PartRef } from '@cg/contracts/ids';
import type { ChatSpaceHostPort, ChatSpaceLiveConfig } from '@cg/host-chatspace/isolated';

import type { ControllerRpc } from './client';

/** Inserts of the boards remembered for a later send; the oldest go. */
const INSERTS_KEPT = 64;

export interface HostFacts {
  /** An insert of a board's part reached the composer: a human send of that draft is its `sent`. */
  noteInsert(intentId: string, opId: string, part: PartRef): void;
  /** The bootstrap as the tab knows it now; null — nobody is signed in, or it is not read yet. */
  configure(bootstrap: Bootstrap | null): void;
  dispose(): void;
}

const LIVE_OFF: ChatSpaceLiveConfig = { wsTap: false, previewSend: false, markAiGenerated: false, receiptProfiles: [] };

/** Part B of the adapter as the bootstrap sets it (§6.2, §6.7, §6.8). */
export function liveConfigOf(bootstrap: Bootstrap | null): ChatSpaceLiveConfig {
  if (bootstrap === null) return LIVE_OFF;
  const on = (flag: string): boolean => bootstrap.flags[flag] === true;
  return {
    wsTap: on('wsTap'),
    // On for at least one page of this sign-in; the hub checks the page's own flag again on every dispatch.
    previewSend: on('previewSend') && bootstrap.pages.some((page) => page.features['previewSend']?.available === true),
    markAiGenerated: on('previewSendMarkAiGenerated'),
    receiptProfiles: bootstrap.limits.previewSendReceiptProfiles,
  };
}

export function forwardHostFacts(deps: { readonly host: ChatSpaceHostPort; readonly rpc: ControllerRpc; readonly setNavInsertTimeoutMs: (ms: number) => void; readonly onFailure: (what: string) => void }): HostFacts {
  const { host, rpc } = deps;
  const inserts = new Map<string, { readonly opId: string; readonly part: PartRef }>();
  let configured = '';

  const off = host.subscribe((event) => {
    if (event.type === 'incoming') {
      // A tab without a port has nobody to tell; the arbiter judges freshness by the fact's own time.
      if (rpc.state() === 'ready') void rpc.request('sound.event', { fact: event.fact });
      return;
    }
    if (event.type !== 'humanSend') return;
    const { draft, platformMessageId, pendingId } = event.fact;
    // §6.6 п. 5: no id from the send's own response, or a draft that is not our insert — no `sent`, no greeting.
    if (platformMessageId === null || draft.insertIntentId === null || draft.editedSinceInsert === null) return;
    const origin = inserts.get(draft.insertIntentId);
    if (origin === undefined) return;
    inserts.delete(draft.insertIntentId);
    void rpc.request('op.reportSent', { opId: origin.opId, part: origin.part, pendingId, platformMessageId, edited: draft.editedSinceInsert });
  });

  return {
    noteInsert(intentId, opId, part) {
      inserts.set(intentId, { opId, part });
      if (inserts.size > INSERTS_KEPT) inserts.delete(inserts.keys().next().value ?? '');
    },
    configure(bootstrap) {
      if (bootstrap !== null) deps.setNavInsertTimeoutMs(bootstrap.limits.navInsertTimeoutSec * 1000);
      const config = liveConfigOf(bootstrap);
      const key = JSON.stringify(config);
      if (key === configured) return;
      configured = key;
      host.configure(config).catch(() => deps.onFailure('configure'));
    },
    dispose() {
      off();
      inserts.clear();
    },
  };
}
