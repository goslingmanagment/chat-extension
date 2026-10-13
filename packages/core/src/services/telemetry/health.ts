// `client_health` in the background (architecture.md §9.6, H-11; NEW-03,
// DB-031; R20 §8.13). A 15-minute period, and in it one window per pair
// (site, build) — 1.15.0, R20 F7: what the tabs of that site on that build
// measured (`health.report` deltas) and what the background counted for the
// site (a site's background chunk counts through its kit). Every 15 minutes —
// the composition root drives `tick()` from an alarm, because an event page
// loses its timers — each window of a site whose tab is open becomes a report
// in the telemetry queue, and a new period starts. The hub keys its rollups on
// the site and the build, and the hub layer gives each report an id of its
// own window (`HubFacade.ingest`), so two windows of one period are two
// reports. A change of a site's contract sends the period early, at most once
// per 60 s. Nothing is measured or kept without consent, and nothing is built
// at all until bootstrap advertises `client-health-perf-v1`.
//
// A contract without a build (the page's build not read yet: every tab's
// first report) is no contract of a known build: its numbers join the build
// the site's tabs are on, and it stands for the site only while no build of
// the site is known — then the window of «no build» folds into the build's
// when the period closes. Otherwise every page load would report a broken
// contract of «no build».
//
// An event page may be unloaded between the tabs' minute reports: the windows
// (numbers and machine tokens only), the build each site's tabs are on, the
// time of the last report and each site's contract fingerprint are saved to
// storage.session after each change and restored by `start()`.

import { type CgCode } from '@cg/contracts/errors';
import { contractHostOf, type HostContractReport } from '@cg/contracts/host';
import { HOST_KINDS, type HostKind } from '@cg/contracts/hosts';
import { TELEMETRY_LIMITS } from '@cg/contracts/limits';
import { type PerfMetric, type TabHealthReport } from '@cg/contracts/telemetry';

import { HealthWindow, hostSignature, hostSummary, type HealthClient, type HealthFootprint, type HealthWindowSnapshot } from '../../domain/telemetry';
import { type KeyValuePort, type Scheduler } from '../ports';
import { type QueueOutcome, type TelemetryEvent } from './queue';

/** Windows of one period at most: sites × the builds their tabs are on is a handful; more is a fault, kept bounded. */
export const HEALTH_WINDOWS_MAX = 8;
const BUILD_MAX = 80;

export interface HealthReporterDeps {
  readonly scheduler: Scheduler;
  /** TelemetryQueue.add. */
  readonly submit: (event: TelemetryEvent) => QueueOutcome;
  readonly consent: () => boolean;
  /** Bootstrap advertises `client-health-perf-v1`. */
  readonly supported: () => boolean;
  /** At least one tab of this site is registered: only then are its windows reported. */
  readonly hostOpen: (site: HostKind) => boolean;
  readonly client: () => HealthClient;
  /** Our caches and logs in the background (KiB, owned estimate): the extension's, in the report of every window. */
  readonly footprint: () => HealthFootprint;
  /** Flags and page features that are off. */
  readonly disabled: () => Iterable<string>;
  /** storage.session `telemetry.healthWindow`; without it the windows live in memory only. */
  readonly store?: KeyValuePort;
}

interface StoredWindow {
  readonly site: HostKind;
  readonly build: string | null;
  readonly window: HealthWindowSnapshot;
}

interface StoredHealth {
  readonly v: 2;
  /** When the period began. */
  readonly from: number;
  readonly windows: readonly StoredWindow[];
  /** The build each site's tabs last reported. */
  readonly builds: Readonly<Partial<Record<HostKind, string>>>;
  readonly lastSentAt: number | null;
  /** Each site's contract fingerprint, as last reported. */
  readonly signatures: Readonly<Partial<Record<HostKind, string>>>;
}

export interface HealthReporterStats {
  /** When the current period began. */
  readonly windowFrom: number;
  readonly lastSentAt: number | null;
  readonly sent: number;
  /** Windows that ended without a report (consent, support, no tab of the site, nothing measured). */
  readonly skipped: number;
  readonly earlyPending: boolean;
}

export type HealthSendReason = 'window' | 'contract';

/** One window of the period: a site on one build. */
export interface HealthSlot {
  readonly site: HostKind;
  readonly build: string | null;
  readonly window: HealthWindow;
}

const keyOf = (site: HostKind, build: string | null): string => `${site}\n${build ?? ''}`;
const isSite = (value: unknown): value is HostKind => typeof value === 'string' && (HOST_KINDS as readonly string[]).includes(value);
const isBuild = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value.length <= BUILD_MAX);

export class HealthReporter {
  private from: number;
  private windows = new Map<string, HealthSlot>();
  /** The build each site's tabs last reported: what the background counts for the site goes to that window. */
  private readonly builds = new Map<HostKind, string>();
  /** Each site's contract fingerprint as last reported: a change sends early. */
  private readonly signatures = new Map<HostKind, string>();
  private lastSentAt: number | null = null;
  private sent = 0;
  private skipped = 0;
  private cancelEarly: (() => void) | null = null;
  private starting: Promise<void> | null = null;
  private saveQueued = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly deps: HealthReporterDeps) {
    this.from = deps.scheduler.now();
  }

  /** Restores the stored windows (an event-page wake); what was measured since joins them. Runs once; never rejects. */
  start(): Promise<void> {
    this.starting ??= this.restore();
    return this.starting;
  }

  private async restore(): Promise<void> {
    if (this.deps.store === undefined) return;
    let stored: unknown;
    try {
      stored = await this.deps.store.load();
    } catch {
      return;
    }
    if (stored === null || typeof stored !== 'object') return;
    const record = stored as Partial<Record<keyof StoredHealth, unknown>>;
    if (record.v !== 2 || typeof record.from !== 'number' || !Number.isFinite(record.from) || record.from < 0 || !Array.isArray(record.windows)) return;
    const from = record.from;
    const restored = new Map<string, HealthSlot>();
    for (const item of record.windows as unknown[]) {
      if (restored.size >= HEALTH_WINDOWS_MAX) break;
      if (item === null || typeof item !== 'object') continue;
      const { site, build, window: snapshot } = item as Partial<Record<keyof StoredWindow, unknown>>;
      if (!isSite(site) || !isBuild(build)) continue;
      const window = HealthWindow.fromSnapshot(snapshot);
      if (window !== null) restored.set(keyOf(site, build), { site, build, window });
    }
    // What was stored was measured with consent (a revocation saves empty windows); what came since is newer.
    for (const [key, slot] of this.windows) {
      const into = restored.get(key);
      if (into !== undefined) into.window.absorb(slot.window.snapshot());
      else if (restored.size < HEALTH_WINDOWS_MAX) restored.set(key, { ...slot, window: HealthWindow.fromSnapshot({ ...slot.window.snapshot(), from }) ?? slot.window });
    }
    this.windows = restored;
    this.from = from;
    if (record.builds !== null && typeof record.builds === 'object') {
      for (const [site, build] of Object.entries(record.builds)) if (isSite(site) && typeof build === 'string' && isBuild(build) && !this.builds.has(site)) this.builds.set(site, build);
    }
    if (record.signatures !== null && typeof record.signatures === 'object') {
      for (const [site, signature] of Object.entries(record.signatures)) if (isSite(site) && typeof signature === 'string' && !this.signatures.has(site)) this.signatures.set(site, signature);
    }
    if (typeof record.lastSentAt === 'number' && Number.isFinite(record.lastSentAt)) this.lastSentAt = Math.max(this.lastSentAt ?? 0, record.lastSentAt);
    this.persist();
  }

  /** One save per turn of the event loop, in order; a failed save only costs the windows on the next unload. */
  private persist(): void {
    const store = this.deps.store;
    if (store === undefined || this.saveQueued) return;
    this.saveQueued = true;
    this.saving = this.saving.then(async () => {
      this.saveQueued = false;
      const value: StoredHealth = {
        v: 2,
        from: this.from,
        windows: [...this.windows.values()].map((slot) => ({ site: slot.site, build: slot.build, window: slot.window.snapshot() })),
        builds: Object.fromEntries(this.builds),
        lastSentAt: this.lastSentAt,
        signatures: Object.fromEntries(this.signatures),
      };
      try {
        await store.save(value);
      } catch {
        // The windows stay in memory.
      }
    });
  }

  /** Resolves when the last save finished (tests, suspend). */
  saved(): Promise<void> {
    return this.saving;
  }

  private on(): boolean {
    try {
      return this.deps.consent();
    } catch {
      return false;
    }
  }

  /**
   * The window of a site on a build, made on first use. Past HEALTH_WINDOWS_MAX a new pair joins a window of its site
   * (or the first there is), and that is counted: the numbers stay, only their build is lost.
   */
  private windowOf(site: HostKind, build: string | null): HealthWindow {
    const key = keyOf(site, build);
    const slot = this.windows.get(key);
    if (slot !== undefined) return slot.window;
    if (this.windows.size >= HEALTH_WINDOWS_MAX) {
      const all = [...this.windows.values()];
      const near = (all.find((other) => other.site === site) ?? all[0]) as HealthSlot;
      near.window.count('health.windows-capped');
      return near.window;
    }
    const window = new HealthWindow(this.from);
    this.windows.set(key, { site, build, window });
    return window;
  }

  /** The window of the build the site's tabs are on now: where the background's own measurements of the site go. */
  private currentOf(site: HostKind): HealthWindow {
    return this.windowOf(site, this.builds.get(site) ?? null);
  }

  /**
   * Where a tab's contract goes: the window of its build. A contract without one (the page's build not read yet) is
   * no contract of a known build: its numbers join the build the site's tabs are on, and it is the site's contract
   * (`contract: true`) only while no build of the site is known.
   */
  private place(site: HostKind, report: HostContractReport | null): { readonly window: HealthWindow; readonly contract: boolean } {
    if (report !== null && report.build !== null) {
      this.builds.set(site, report.build);
      return { window: this.windowOf(site, report.build), contract: true };
    }
    const known = this.builds.get(site);
    return known === undefined ? { window: this.windowOf(site, null), contract: true } : { window: this.windowOf(site, known), contract: false };
  }

  /** A background measurement for a site (handlers only when sampled by the caller). */
  recordPerf(site: HostKind, metric: PerfMetric, ms: number): void {
    if (!this.on()) return;
    this.currentOf(site).recordPerf(metric, ms);
    this.persist();
  }

  count(site: HostKind, name: string, by = 1): void {
    if (!this.on()) return;
    this.currentOf(site).count(name, by);
    this.persist();
  }

  countCode(site: HostKind, code: CgCode, by = 1): void {
    if (!this.on()) return;
    this.currentOf(site).countCode(code, by);
    this.persist();
  }

  /**
   * `health.report` from a tab of `site` (its registration says which): its deltas join the window of the site and
   * the build its contract names; a changed contract sends early. A contract of another site is not this tab's: its
   * numbers count, the contract does not.
   */
  mergeTab(tabSessionId: string, site: HostKind, report: TabHealthReport): void {
    if (!this.on()) return;
    const host = report.host !== null && contractHostOf(report.host) === site ? report.host : null;
    const { window, contract } = this.place(site, host);
    window.mergeTab(tabSessionId, contract && report.host === host ? report : { ...report, host: null });
    if (report.host !== null && host === null) window.count('health.host-mismatch');
    if (host !== null && contract) this.signal(site, host);
    this.persist();
  }

  /** The host contract as a tab of `site` saw it (also without a report). */
  onHost(site: HostKind, report: HostContractReport | null): void {
    if (!this.on() || (report !== null && contractHostOf(report) !== site)) return;
    const { window, contract } = this.place(site, report);
    if (!contract) return;
    window.setHost(report);
    this.signal(site, report);
    this.persist();
  }

  private signal(site: HostKind, report: HostContractReport | null): void {
    const signature = hostSignature(hostSummary(report));
    const last = this.signatures.get(site);
    if (last === undefined) this.signatures.set(site, signature);
    else if (signature !== last) this.sendEarly();
  }

  private sendEarly(): void {
    if (this.cancelEarly !== null) return;
    const now = this.deps.scheduler.now();
    const wait = this.lastSentAt === null ? 0 : Math.max(0, this.lastSentAt + TELEMETRY_LIMITS.healthMinIntervalMs - now);
    this.cancelEarly = this.deps.scheduler.after(wait, () => {
      this.cancelEarly = null;
      this.close('contract');
    });
  }

  /** The 15-minute alarm. Returns whether a report was queued. */
  tick(): boolean {
    return this.close('window');
  }

  private close(reason: HealthSendReason): boolean {
    // The period closes now: a pending early send would only report empty windows (the closed ones name the new contract).
    this.cancelEarlySend();
    const now = this.deps.scheduler.now();
    this.foldUnbuilt();
    const closing = [...this.windows.values()];
    this.windows = new Map();
    this.from = now;
    let queued = false;
    for (const slot of closing) if (this.report(slot, now, reason)) queued = true;
    this.persist();
    return queued;
  }

  /**
   * A window of «no build» of a site whose build is known by now (its tabs' first reports, the background's counts
   * before them) joins the window of that build: its numbers count there, its contract does not.
   */
  private foldUnbuilt(): void {
    for (const [key, slot] of [...this.windows]) {
      const build = this.builds.get(slot.site);
      if (slot.build !== null || build === undefined) continue;
      this.windows.delete(key);
      this.windowOf(slot.site, build).absorb({ ...slot.window.snapshot(), host: null });
    }
  }

  /** One window becomes a report — when its site is open and it has something to say. */
  private report(slot: HealthSlot, now: number, reason: HealthSendReason): boolean {
    const host = slot.window.hostSummary;
    try {
      // A report names the contract even when nothing was measured — of the build the site's tabs are on: a window of
      // another build with nothing new is only a contract carried over from a build no tab spoke of since. An empty
      // window with no host says nothing.
      const current = slot.build === (this.builds.get(slot.site) ?? null);
      const ready = this.on() && this.deps.supported() && this.deps.hostOpen(slot.site) && (!slot.window.isEmpty() || (current && (host !== null || reason === 'contract')));
      if (!ready) {
        this.skipped += 1;
        return false;
      }
      slot.window.setDisabled(this.deps.disabled());
      const outcome = this.deps.submit(slot.window.build(now, slot.site, this.deps.client(), this.deps.footprint()));
      if (outcome !== 'queued') {
        this.skipped += 1;
        return false;
      }
      this.sent += 1;
      this.lastSentAt = now;
      if (host !== null) {
        this.signatures.set(slot.site, hostSignature(host));
        // The site's contract stays known in the next window of the build its tabs are on: the report always names it.
        if (slot.build === (this.builds.get(slot.site) ?? null)) this.windowOf(slot.site, slot.build).setHostSummary(host);
      }
      return true;
    } catch {
      this.skipped += 1;
      return false;
    }
  }

  /** Consent revoked or signed out: what was measured goes at once. */
  reset(): void {
    this.cancelEarlySend();
    this.windows = new Map();
    this.from = this.deps.scheduler.now();
    this.persist();
  }

  private cancelEarlySend(): void {
    if (this.cancelEarly === null) return;
    try {
      this.cancelEarly();
    } catch {
      // Already fired.
    }
    this.cancelEarly = null;
  }

  stats(): HealthReporterStats {
    return { windowFrom: this.from, lastSentAt: this.lastSentAt, sent: this.sent, skipped: this.skipped, earlyPending: this.cancelEarly !== null };
  }

  /** The windows as they stand, for the export (no ids, no text). */
  currentWindows(): readonly HealthSlot[] {
    return [...this.windows.values()];
  }
}

/** The interval of the alarm that drives `tick()`. */
export const HEALTH_TICK_MS = TELEMETRY_LIMITS.healthWindowMs;
