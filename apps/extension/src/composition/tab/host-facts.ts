// What the page tells the tab and the tab passes on (architecture.md §6.6,
// §6.8, §8.3, §9.8), and what the bootstrap tells the host adapter:
//
// - every incoming-message fact (the WS tap or the stores; no text) goes to
//   the background's one sound arbiter as it is — the tab decides nothing
//   about sound (SN-016);
// - a human send whose draft descends from an insert of a preview or a
//   «Новые» card («Открыть и вставить») is reported for that part's operation
//   — telemetry `sent` and, for a greeting, its registration are the
//   background's. The report is the only word the hub ever gets of that send
//   while X8 is off, so it is said again until the background acknowledges
//   it: a port that was lost under the request (the event page unloaded)
//   answered nothing, and the report goes again once the port is back — the
//   background takes a repeat as the same registration. The dock's own
//   inserts are reported by R11's workspace, which knows them; an
//   attribution that is not known is never guessed;
// - the owner's switches and the receipt profiles of the bootstrap configure
//   the adapter's part B (the tap, X8, the AI mark), and its limit sets the
//   deadline of «Открыть и вставить». The adapter serves every account of
//   the tab, so each part is on while the switch is usable on at least one
//   granted page; the page's own value is applied where the page is known —
//   the background per fact (the tap), the preview per send (X8, the mark).
//
// Facts only: ids, digests, booleans. Never a message text.

import type { HostContractReport } from '@cg/contracts/host';
import type { Bootstrap } from '@cg/contracts/hub';
import type { PartRef } from '@cg/contracts/ids';
import { flagOnSomePage } from '@cg/core/domain/ops';
import type { ChatSpaceHostPort, ChatSpaceLiveConfig } from '@cg/host-chatspace/isolated';

import type { ControllerRpc } from './client';

/** Inserts of the boards remembered for a later send; the oldest go. */
const INSERTS_KEPT = 64;
/** How many times one human-send report is said before it is given up: the port may be lost more than once. */
export const SENT_REPORT_TRIES = 4;
/** Reports that wait for the port; the oldest go. */
const SENT_REPORTS_KEPT = 32;

type SentReport = { readonly opId: string; readonly part: PartRef; readonly pendingId: string; readonly platformMessageId: string; readonly edited: boolean };

export interface HostFacts {
  /** An insert of a board's part reached the composer: a human send of that draft is its `sent`. */
  noteInsert(intentId: string, opId: string, part: PartRef): void;
  /** The bootstrap as the tab knows it now; null — nobody is signed in, or it is not read yet. */
  configure(bootstrap: Bootstrap | null): void;
  dispose(): void;
}

/**
 * Anchors of what the owner switches on separately — the WebSocket tap (`wsTap`) and the receipt profile of the
 * preview send (X8). With the switch off the adapter reports them `missing` (§6.2: nothing of that part is in
 * the page): the normal state of a shift, not a ChatSpace that changed — the same rule «Статус» reads the
 * report by (core `hostGaps`). What is wrong with them while the switch is on is said by their capabilities.
 */
const SWITCHED_ANCHORS: readonly string[] = ['wsFrames', 'receiptProfile'];

/**
 * The host contract as the tab's log says it (DB-031): every anchor that is not `ok`, every capability that is
 * not `on` — and `ok` false, which makes the record a CG-HOST-CONTRACT of «ошибки за сегодня», only when an
 * anchor of ChatSpace itself is gone.
 */
export function contractFactsOf(report: HostContractReport): { readonly build: string | null; readonly adapterVersion: string; readonly ok: boolean; readonly missing: string[]; readonly degraded: string[] } {
  const missing = Object.entries(report.anchors)
    .filter(([, state]) => state !== 'ok')
    .map(([anchor]) => anchor);
  const degraded = Object.entries(report.capabilities)
    .filter(([, capability]) => capability.state !== 'on')
    .map(([name]) => name);
  return { build: report.build, adapterVersion: report.adapterVersion, ok: missing.every((anchor) => SWITCHED_ANCHORS.includes(anchor)), missing, degraded };
}

const LIVE_OFF: ChatSpaceLiveConfig = { wsTap: false, previewSend: false, markAiGenerated: false, receiptProfiles: [] };

/** Part B of the adapter as the bootstrap sets it (§6.2, §6.7, §6.8). */
export function liveConfigOf(bootstrap: Bootstrap | null): ChatSpaceLiveConfig {
  if (bootstrap === null) return LIVE_OFF;
  // Never the top-level `flags` (the owner's `"*"` row alone): a page switched on by itself must work.
  return {
    wsTap: flagOnSomePage(bootstrap, 'wsTap'),
    // On for at least one page of this sign-in; the preview checks its own page before a send, and the hub
    // checks the page's own flag again on every dispatch.
    previewSend: flagOnSomePage(bootstrap, 'previewSend'),
    markAiGenerated: flagOnSomePage(bootstrap, 'previewSendMarkAiGenerated'),
    receiptProfiles: bootstrap.limits.previewSendReceiptProfiles,
  };
}

/**
 * What the adapter is told for what the tab knows of the sign-in and of its bootstrap; `undefined` — nothing yet.
 * Nobody signed in is knowledge: the owner's flags went with the sign-in, part B is off. A sign-in whose
 * bootstrap has not arrived (the first read is on its way, the hub did not answer) is not: a tap that was told
 * to stand down is gone from the document for good (§6.8 п. 8), so «not known yet» must never read as «off».
 */
export function knownBootstrap(
  session: object | null | undefined,
  bootstrap: { readonly s: 'idle' | 'loading' | 'error' } | { readonly s: 'ready'; readonly value: Bootstrap },
): Bootstrap | null | undefined {
  if (session === undefined) return undefined;
  if (session === null) return null;
  return bootstrap.s === 'ready' ? bootstrap.value : undefined;
}

export function forwardHostFacts(deps: { readonly host: ChatSpaceHostPort; readonly rpc: ControllerRpc; readonly setNavInsertTimeoutMs: (ms: number) => void; readonly onFailure: (what: string) => void }): HostFacts {
  const { host, rpc } = deps;
  const inserts = new Map<string, { readonly opId: string; readonly part: PartRef }>();
  let configured = '';
  /** Reports the background has not acknowledged, waiting for the port to come back. */
  const waiting: { readonly report: SentReport; readonly tries: number }[] = [];

  const reportSent = (report: SentReport, tries = 1): void => {
    void rpc.request('op.reportSent', report).then((answer) => {
      // Acknowledged, or refused with the background's own word: said. Only «nobody answered» is said again.
      if (answer.ok || answer.error.code !== 'CG-RUNTIME-UNREACHABLE' || tries >= SENT_REPORT_TRIES) return;
      waiting.push({ report, tries: tries + 1 });
      if (waiting.length > SENT_REPORTS_KEPT) waiting.shift();
      // The port is already back (the request itself outlived a reconnect, or timed out): no state change will come.
      if (rpc.state() === 'ready') flush();
    });
  };
  function flush(): void {
    for (const { report, tries } of waiting.splice(0)) reportSent(report, tries);
  }
  const offState = rpc.onState((state) => {
    if (state === 'ready') flush();
  });

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
    reportSent({ opId: origin.opId, part: origin.part, pendingId, platformMessageId, edited: draft.editedSinceInsert });
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
      offState();
      inserts.clear();
      waiting.length = 0;
    },
  };
}
