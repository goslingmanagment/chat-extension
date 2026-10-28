// What leaves the browser with the `technicalAndInteraction` consent
// (architecture.md §9.6, D-22; R18's services over R07's storage and the hub
// facade's ingest): the persistent queue, the `client_health` windows (one
// per site and build, R20 F7) and the `ai_acceptance` events. Nothing is queued or sent without consent;
// `client_health` exists only while bootstrap advertises
// `client-health-perf-v1`. No text of a conversation, a draft or a model
// answer is in any event.

import { type HostContractReport } from '@cg/contracts/host';
import { type HostKind } from '@cg/contracts/hosts';
import { type IngestResult } from '@cg/contracts/hub';
import { STORAGE_KEYS } from '@cg/contracts/settings';
import { type AcceptanceEvent, type TabHealthReport } from '@cg/contracts/telemetry';
import { type Logger } from '@cg/core/domain/logging';
import { AcceptanceTracker, type AcceptanceOutcome, type HealthClient, type HealthFootprint, type LinkSource, type PartPosition, type SentProof } from '@cg/core/domain/telemetry';
import { AcceptanceReporter, HealthReporter, TelemetryQueue, type TelemetryBinding, type TelemetryEvent } from '@cg/core/services/telemetry';
import { type KeyValueStore } from '@cg/platform';

import { IDS, SCHEDULER, keyOf } from './ports';

/** storage.session: the health window between the tabs' minute reports (the event page may unload). */
export const HEALTH_WINDOW_KEY = 'telemetry.healthWindow';
/** storage.session: generation links and dedupe keys of `ai_acceptance` (ids only). */
export const ACCEPTANCE_KEY = 'telemetry.acceptance';

export interface BackgroundTelemetryDeps {
  readonly local: KeyValueStore;
  readonly session: KeyValueStore;
  readonly logger: Logger;
  /** HubFacade.ingest. */
  readonly ingest: (events: readonly TelemetryEvent[]) => Promise<IngestResult>;
  /** The current sign-in; null — signed out or not restored yet. */
  readonly binding: () => TelemetryBinding | null;
  /** true / false, or null while the browser has not answered. */
  readonly consent: () => boolean | null;
  /** Bootstrap advertises `client-health-perf-v1`. */
  readonly healthSupported: () => boolean;
  /** A tab of this site is registered (its `client_health` windows are reported). */
  readonly hostOpen: (site: HostKind) => boolean;
  readonly client: () => HealthClient;
  readonly footprint: () => HealthFootprint;
  /** Flags and page features that are off. */
  readonly disabled: () => Iterable<string>;
}

export type AcceptanceKind = AcceptanceEvent['payload']['lifecycle'];

export interface BackgroundTelemetry {
  readonly queue: TelemetryQueue;
  readonly health: HealthReporter;
  readonly acceptance: AcceptanceReporter;
  /** Readiness step: the stored queue, health window and acceptance links. Never rejects. */
  start(): Promise<void>;
  /**
   * One lifecycle event of an operation (`op.reportShown` and its siblings).
   * The generation link is taken from the operation's view the first time (or
   * from what a «Новые» draft kept of it) — no generation link, no event (never
   * guessed). True — queued.
   */
  report(kind: AcceptanceKind, view: LinkSource | null, opId: string, position: PartPosition, proof?: SentProof): boolean;
  /** `health.report` of a tab of `site` (as it registered). */
  mergeTab(tabSessionId: string, site: HostKind, report: TabHealthReport): void;
  onHost(site: HostKind, report: HostContractReport | null): void;
  /** The sign-in changed: old bindings go; a sign-out drops the links and the window. */
  onSessionChanged(signedIn: boolean): void;
  /** Consent changed: a revoke purges the queue, the links and the window. */
  onConsentChanged(granted: boolean): void;
  onCapabilitiesChanged(): void;
}

export function createBackgroundTelemetry(deps: BackgroundTelemetryDeps): BackgroundTelemetry {
  const acceptanceKey = keyOf(deps.session, ACCEPTANCE_KEY);
  let savingLinks = false;

  const queue = new TelemetryQueue({
    scheduler: SCHEDULER,
    store: keyOf(deps.local, STORAGE_KEYS.telemetryQueue),
    ingest: deps.ingest,
    logger: deps.logger,
    session: deps.binding,
    consent: deps.consent,
    healthSupported: deps.healthSupported,
  });

  const health = new HealthReporter({
    scheduler: SCHEDULER,
    submit: (event) => queue.add(event),
    consent: () => deps.consent() === true,
    supported: deps.healthSupported,
    hostOpen: deps.hostOpen,
    client: deps.client,
    footprint: deps.footprint,
    disabled: deps.disabled,
    store: keyOf(deps.session, HEALTH_WINDOW_KEY),
  });

  const tracker: AcceptanceTracker = new AcceptanceTracker({
    now: () => Date.now(),
    uuid: () => IDS.uuid(),
    onChange() {
      // One save per turn of the event loop: ids and labels only.
      if (savingLinks) return;
      savingLinks = true;
      queueMicrotask(() => {
        savingLinks = false;
        void acceptanceKey.save(tracker.snapshot()).catch(() => undefined);
      });
    },
  });
  const acceptance = new AcceptanceReporter((event) => queue.add(event), deps.logger);

  const build = (kind: AcceptanceKind, opId: string, position: PartPosition, proof: SentProof | undefined): AcceptanceOutcome => {
    switch (kind) {
      case 'shown':
        return tracker.shown(opId, position);
      case 'copied':
        return tracker.copied(opId, position);
      case 'inserted':
        return tracker.inserted(opId, position);
      case 'sent':
        return proof === undefined ? { ok: false, reason: 'invalid' } : tracker.sent(opId, position, proof);
    }
  };

  return {
    queue,
    health,
    acceptance,
    async start() {
      tracker.restore(await acceptanceKey.load().catch(() => null));
      await Promise.all([queue.start(), health.start()]);
    },
    report(kind, view, opId, position, proof) {
      // Nothing is linked or built without consent (§9.6): the tracker holds page labels.
      if (deps.consent() !== true) return false;
      if (tracker.linkOf(opId) === null && view !== null && view.generationRef !== undefined) {
        tracker.link({ opId, generationRef: view.generationRef, feature: view.feature, surface: view.surface, pageLabel: view.target.binding.pageLabel });
      }
      return acceptance.report(build(kind, opId, position, proof), { lifecycle: kind, opId }) === 'queued';
    },
    mergeTab: (tabSessionId, site, report) => health.mergeTab(tabSessionId, site, report),
    onHost: (site, report) => health.onHost(site, report),
    onSessionChanged(signedIn) {
      queue.onSessionChanged();
      if (!signedIn) {
        tracker.clear();
        health.reset();
      }
    },
    onConsentChanged(granted) {
      queue.onConsentChanged();
      if (!granted) {
        tracker.clear();
        health.reset();
      }
    },
    onCapabilitiesChanged: () => queue.onCapabilitiesChanged(),
  };
}
