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
//   attribution that is not known is never guessed. Which part an insert
//   belongs to is remembered BEFORE the insert starts (`boardsHostOver`):
//   the page writes the text first and answers a frame later, and the
//   person's Send may be seen in between — a send whose insert is not known
//   yet would be dropped for good;
// - who sent each message (decision X48): every human send whose own
//   response named the message — a draft of ours or the person's own — goes
//   to the background as one fact (`attribution.report`: the chat, the
//   message id, when, a price and media as marks). The background reports it
//   to the hub under the person signed in, where its page has the feature
//   `send-attribution`; it is said again until the background acknowledges
//   it, as a human send of a part is. Chat Memory week 1: the fact says how
//   the draft was written (`wrote`: ours, the person's own, not known) and,
//   on Fansly, its chat's group. Fansly also says every message its page
//   sent from this tab (`pageSent`: media, PPV, voice too, no gesture
//   proven): it waits PAGE_SENT_WAIT_MS for the same message's `humanSend`,
//   which reports it with its draft; none came — it is reported as written
//   in a way not known;
// - what the bootstrap switches in the site's host port goes to it through
//   the application's half of the site's adapter (tab/adapter.ts; ChatSpace:
//   the owner's switches and the receipt profiles configure its part B — the
//   tap, X8, the AI mark — tab/hosts/chatspace/app.ts), and its limit sets
//   the deadline of «Открыть и вставить». The port serves every account of
//   the tab, so each part is on while the switch is usable on at least one
//   granted page — its capability report says «the tap is on in this tab»,
//   not «on for this page». The page's own value is applied wherever what
//   the tap heard is USED: the background per incoming fact (the sound, the
//   stale mark) and per reported human send (`op.reportSent`: the page of
//   the operation), the preview per send (X8 and its freshness, the mark);
// - the X8 fuse (decision X25): the browser's fuse as the background keeps it
//   goes to the adapter with the bootstrap's part B, read at start and after a
//   lost port, and again on every `send.fuse` event; a trip MAIN saw in this
//   tab (the adapter's `sendFuse` event, X8 is already off here) is reported
//   to the background with the tab's ChatSpace build — said again until the
//   background acknowledges it, as a human send is.
//
// Facts only: ids, digests, booleans. Never a message text.

import type { HostContractReport, HostContractShape, HostPort, InsertIntent, InsertReceipt, NavigateOptions, NavigationIntent, SendAttributionFact } from '@cg/contracts/host';
import type { Bootstrap } from '@cg/contracts/hub';
import type { PartRef } from '@cg/contracts/ids';
import type { SendFuseFact, SendFuseState } from '@cg/contracts/send';
import { anchorGap, anchorsNotYet, expectedAnchors, siteCapabilitiesOf } from '@cg/core/domain/host';
import { wroteOf } from '@cg/core/domain/send';

import type { HostAppAdapter } from './adapter';
import type { ControllerRpc } from './client';

/** Inserts of the boards remembered for a later send; the oldest go. */
const INSERTS_KEPT = 64;
/** How many times one human-send report is said before it is given up: the port may be lost more than once. */
export const SENT_REPORT_TRIES = 4;
/** Reports that wait for the port; the oldest go. */
const SENT_REPORTS_KEPT = 32;
/** Fuse trips that wait for the port; the oldest go (one is enough to keep the fuse). */
const FUSE_REPORTS_KEPT = 8;
/** Who-sent facts that wait for the port (decision X48); the oldest go. */
const ATTRIBUTIONS_KEPT = 64;
/** How long a page's send waits for its own `humanSend` before it is reported without its draft (Chat Memory week 1). */
export const PAGE_SENT_WAIT_MS = 5_000;
/** Messages whose `humanSend` was heard, remembered for a later `pageSent` of the same message; the oldest go. */
const HUMAN_SENDS_KEPT = 256;

type SentReport = { readonly opId: string; readonly part: PartRef; readonly pendingId: string; readonly platformMessageId: string; readonly edited: boolean };

export interface HostFacts {
  /** An insert of a board's part is going to the composer: a human send of the draft it leaves there is that part's `sent`. */
  noteInsert(intentId: string, opId: string, part: PartRef): void;
  /** That insert wrote nothing (the host said so): there is no draft of it to send. */
  forgetInsert(intentId: string): void;
  /** The bootstrap as the tab knows it now; null — nobody is signed in, or it is not read yet. */
  configure(bootstrap: Bootstrap | null): void;
  dispose(): void;
}

/**
 * The host contract as the tab's log says it (DB-031): every anchor that is gone or changed, every capability that
 * is not `on` — and `ok` false, which makes the record a CG-HOST-CONTRACT of «ошибки за сегодня», only when an
 * anchor of the site itself is gone. The anchors read are the site's expected set (`shape`, the adapter's; R20 F7,
 * FS-CTR-1): one the report does not name is `missing`, never «nothing to check». An anchor of a part the owner
 * switches on separately (ChatSpace: the WebSocket tap, X8's receipt profile) is `missing` while its switch is off
 * (§6.2: nothing of that part is in the page) — the normal state of a shift, not a site that changed, the same rule
 * «Статус» reads the report by (core `hostGaps`); what is wrong with it while the switch is on its capabilities say.
 * An anchor the site has not created yet (`notYet`: ChatSpace's composer translator store before the page's first
 * chat) is listed apart and is no error: every reload has it until a chat is opened.
 */
export function contractFactsOf(
  report: HostContractReport,
  shape: HostContractShape,
): {
  readonly build: string | null;
  readonly adapterVersion: string;
  readonly ok: boolean;
  readonly missing: string[];
  readonly degraded: string[];
  readonly notYet?: string[];
} {
  const missing = expectedAnchors(report, shape)
    .filter(([, state]) => anchorGap(state))
    .map(([anchor]) => anchor);
  const later = anchorsNotYet(report, shape);
  const degraded = [...Object.entries(report.capabilities), ...Object.entries(siteCapabilitiesOf(report))]
    .filter(([, capability]) => capability.state !== 'on')
    .map(([name]) => name);
  return { build: report.build, adapterVersion: report.adapterVersion, ok: missing.every((anchor) => shape.switchedAnchors.includes(anchor)), missing, degraded, ...(later.length === 0 ? {} : { notYet: later }) };
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

export function forwardHostFacts<P extends HostPort, C>(deps: {
  readonly host: P;
  /** The application's half of the site's adapter: what the bootstrap switches in the port. */
  readonly site: HostAppAdapter<P, C>;
  readonly rpc: ControllerRpc;
  readonly setNavInsertTimeoutMs: (ms: number) => void;
  readonly onFailure: (what: string) => void;
  /** The tab's clock (tests); Date.now by default. */
  readonly now?: () => number;
  /** The tab's timer (tests); setTimeout by default. Returns its cancel. */
  readonly later?: (callback: () => void, ms: number) => () => void;
}): HostFacts {
  const { host, site, rpc } = deps;
  const inserts = new Map<string, { readonly opId: string; readonly part: PartRef }>();
  let configured = '';
  /** The bootstrap last configured; undefined — none yet (the port keeps what it has). */
  let bootstrapNow: Bootstrap | null | undefined;
  /** The browser's X8 fuse as the background last said (decision X25); null — not read yet. */
  let fuse: SendFuseState | null = null;
  /** Reports the background has not acknowledged, waiting for the port to come back. */
  const waiting: { readonly report: SentReport; readonly tries: number }[] = [];
  /** Fuse trips the background has not acknowledged. */
  const fuseWaiting: { readonly fact: SendFuseFact; readonly build: string | null; readonly tries: number }[] = [];
  /** Who-sent facts the background has not acknowledged (decision X48). */
  const attributionsWaiting: { readonly fact: SendAttributionFact; readonly tries: number }[] = [];
  const now = deps.now ?? Date.now;
  const later =
    deps.later ??
    ((callback: () => void, ms: number) => {
      const id = setTimeout(callback, ms);
      return () => clearTimeout(id);
    });
  /** Messages a `humanSend` reported (Chat Memory week 1): their `pageSent` is said already. */
  const humanSent = new Set<string>();
  /** `pageSent` facts waiting for their `humanSend`: their cancels. */
  const pageSentWaiting = new Map<string, () => void>();

  const apply = (): void => {
    if (bootstrapNow === undefined) return;
    const config = site.liveConfigOf(bootstrapNow, fuse);
    const key = JSON.stringify(config);
    if (key === configured) return;
    configured = key;
    site.configure(host, config).catch(() => deps.onFailure('configure'));
  };
  const fuseIs = (next: SendFuseState): void => {
    fuse = next;
    apply();
  };
  const readFuse = (): void => {
    void rpc.request('send.fuseState', {}).then((answer) => {
      if (answer.ok) fuseIs(answer.payload);
    });
  };
  /** A trip MAIN saw in this tab: the background keeps it for the browser. Said again only when nobody answered. */
  const reportFuse = (fact: SendFuseFact, build: string | null, tries = 1): void => {
    void rpc.request('send.fuse', { fact, build }).then((answer) => {
      if (answer.ok) return fuseIs(answer.payload);
      if (answer.error.code !== 'CG-RUNTIME-UNREACHABLE' || tries >= SENT_REPORT_TRIES) return;
      fuseWaiting.push({ fact, build, tries: tries + 1 });
      if (fuseWaiting.length > FUSE_REPORTS_KEPT) fuseWaiting.shift();
      if (rpc.state() === 'ready') flushFuse();
    });
  };
  function flushFuse(): void {
    for (const { fact, build, tries } of fuseWaiting.splice(0)) reportFuse(fact, build, tries);
  }

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
  /** Who sent a message (X48): the background owes it to the hub. Said again only when nobody answered. */
  const reportAttribution = (fact: SendAttributionFact, tries = 1): void => {
    void rpc.request('attribution.report', { fact }).then((answer) => {
      if (answer.ok || answer.error.code !== 'CG-RUNTIME-UNREACHABLE' || tries >= SENT_REPORT_TRIES) return;
      attributionsWaiting.push({ fact, tries: tries + 1 });
      if (attributionsWaiting.length > ATTRIBUTIONS_KEPT) attributionsWaiting.shift();
      if (rpc.state() === 'ready') flushAttributions();
    });
  };
  function flushAttributions(): void {
    for (const { fact, tries } of attributionsWaiting.splice(0)) reportAttribution(fact, tries);
  }
  const offState = rpc.onState((state) => {
    if (state !== 'ready') return;
    flush();
    flushFuse();
    flushAttributions();
    // A new port may be a new event page: the fuse is read again.
    readFuse();
  });
  const offFuse = rpc.onEvent('send.fuse', fuseIs);
  if (rpc.state() === 'ready') readFuse();

  const off = host.subscribe((event) => {
    if (event.type === 'sendFuse') return reportFuse(event.fuse, host.probe().build);
    if (event.type === 'incoming') {
      // A tab without a port has nobody to tell; the arbiter judges freshness by the fact's own time.
      if (rpc.state() === 'ready') void rpc.request('sound.event', { fact: event.fact });
      return;
    }
    if (event.type === 'pageSent') {
      // Chat Memory week 1: the page's send seen only by its receipt. Its `humanSend`, if any, comes with the draft.
      const { fact } = event;
      const id = fact.platformMessageId;
      if (humanSent.has(id) || pageSentWaiting.has(id)) return;
      const observedAt = new Date(now()).toISOString();
      pageSentWaiting.set(
        id,
        later(() => {
          pageSentWaiting.delete(id);
          if (humanSent.has(id)) return;
          reportAttribution({ chat: fact.chat, platformMessageId: id, observedAt, priced: false, media: fact.media, conversationRef: fact.conversationRef, wrote: 'unknown' });
        }, PAGE_SENT_WAIT_MS),
      );
      return;
    }
    if (event.type !== 'humanSend') return;
    const { draft, platformMessageId, pendingId, cargo } = event.fact;
    // X48: who sent the message — any human send whose own response named it, a draft of ours or the person's own.
    if (platformMessageId !== null) {
      humanSent.add(platformMessageId);
      if (humanSent.size > HUMAN_SENDS_KEPT) humanSent.delete(humanSent.values().next().value ?? '');
      pageSentWaiting.get(platformMessageId)?.();
      pageSentWaiting.delete(platformMessageId);
      const { conversationRef } = event.fact;
      reportAttribution({
        chat: event.fact.chat,
        platformMessageId,
        observedAt: new Date(now()).toISOString(),
        priced: cargo?.priced ?? false,
        media: cargo?.media ?? false,
        ...(conversationRef === undefined ? {} : { conversationRef }),
        wrote: wroteOf(draft),
      });
    }
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
    forgetInsert(intentId) {
      inserts.delete(intentId);
    },
    configure(bootstrap) {
      if (bootstrap !== null) deps.setNavInsertTimeoutMs(bootstrap.limits.navInsertTimeoutSec * 1000);
      bootstrapNow = bootstrap;
      apply();
    },
    dispose() {
      off();
      offState();
      offFuse();
      inserts.clear();
      waiting.length = 0;
      fuseWaiting.length = 0;
      attributionsWaiting.length = 0;
      for (const cancel of pageSentWaiting.values()) cancel();
      pageSentWaiting.clear();
      humanSent.clear();
    },
  };
}

/** The host said the insert wrote nothing: refused, or never reached. `applied` and `uncertain` (the write may have run) are not that. */
const wroteNothing = (receipt: InsertReceipt | null): boolean => receipt === null || receipt.state === 'rejected';

/**
 * The host port as the boards use it (§6.6). A part of a board goes into the composer through the host port as it
 * is; the tab only remembers which insert belongs to which part, so a human send of that draft is reported for its
 * operation. It is remembered BEFORE the call: MAIN writes the text in the same step it gets the command and
 * resolves the receipt a microtask and a frame later, so the person's Send — and the page's word about it, which
 * names the insert the draft descends from — can come before the receipt does. An insert the host says wrote
 * nothing is forgotten again. One whose outcome is not known (a bridge failure after the write may have run)
 * stays: only the page's own word that the sent draft descends from it makes a `sent`, and that word comes only
 * if the write did run.
 */
export function boardsHostOver<P extends HostPort>(host: P, inserts: Pick<HostFacts, 'noteInsert' | 'forgetInsert'>): P {
  return new Proxy(host, {
    get(target, property) {
      if (property === 'navigate') {
        return (intent: NavigationIntent, options?: NavigateOptions) => {
          const then = intent.thenInsert;
          if (then === undefined) return target.navigate(intent, options);
          inserts.noteInsert(then.intentId, then.operationId, then.part);
          return target.navigate(intent, options).then((receipt) => {
            if (wroteNothing(receipt.insert)) inserts.forgetInsert(then.intentId);
            return receipt;
          });
        };
      }
      if (property === 'insert') {
        return (intent: InsertIntent) => {
          inserts.noteInsert(intent.intentId, intent.operationId, intent.part);
          return target.insert(intent).then((receipt) => {
            if (wroteNothing(receipt)) inserts.forgetInsert(intent.intentId);
            return receipt;
          });
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
