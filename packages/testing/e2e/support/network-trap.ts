// Network trap for e2e (architecture.md §12 п. 4 «сетевой журнал BiDi: ни
// одного запроса нашего кода, кроме поддельного хаба»), two sources:
// - the BiDi network log (network.beforeRequestSent, all browsing contexts):
//   requests of pages and content scripts, with their URL. It does NOT see
//   requests of extension background pages;
// - the egress sink (src/stand/egress-sink.ts): the profile sends every
//   non-loopback request there, from any part of the browser, the background
//   included; it records the host and drops the connection.
// After every test, and once more after the suite, both are read and any
// request outside the loopback stand and fake hub fails — except, in the sink
// only, the hosts Firefox itself still contacts (FIREFOX_OWN_HOSTS), and the
// pictures of a site's own CDN a suite declares (`expectSiteMedia`).

import { browser } from '@wdio/globals';

import type { EgressAttempt } from '../../src/stand/egress-sink';
import { standApiOrigin, standOrigin, standServer } from './stand';

export interface TrappedRequest {
  readonly url: string;
  readonly method: string;
  readonly context: string | null;
  readonly timestamp: number;
}

const NON_NETWORK_SCHEMES = new Set(['moz-extension:', 'about:', 'data:', 'blob:', 'chrome:', 'resource:', 'javascript:']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Hosts Firefox itself still reaches with the quiet prefs of
 * egressProxyPrefs (seen in e2e runs). Only the sink allows them; our code
 * never has a reason to reach them, and a request of ours there would still
 * show in the BiDi log if it came from a page or content script.
 */
export const FIREFOX_OWN_HOSTS: ReadonlySet<string> = new Set<string>([]);

/** A site's own CDN, whose pictures a surface of ours may show as the site's page does: Fansly's `cdnN.fansly.com`. */
const SITE_MEDIA_HOST = /^cdn\d*\.fansly\.com$/;

/**
 * Origins an e2e may reach: the stands (ChatSpace's page and API; Fansly's page and the fake Fansly's API and socket)
 * and the fake hub (wdio onPrepare starts them).
 */
export function allowedE2eOrigins(): string[] {
  const set = (name: string): string[] => {
    const value = process.env[name];
    return value !== undefined && value !== '' ? [value] : [];
  };
  return [standOrigin(), standApiOrigin(), ...set('CG_FANSLY_STAND_ORIGIN'), ...set('CG_FANSLY_API_ORIGIN'), ...set('CG_FANSLY_SOCKET_URL'), ...set('CG_FAKE_HUB_ORIGIN')];
}

/** How long the final sweep lets late requests (timers in a background page) arrive. */
const FINAL_SETTLE_MS = 1500;

export class NetworkTrap {
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly seen: TrappedRequest[] = [];
  private cursor = 0;
  private egressCursor = 0;
  /** Probe hosts a test reached on purpose; the browser may retry them for a while, so they stay allowed for the suite. */
  private readonly probeHosts = new Set<string>();
  /** A site's CDN hosts whose pictures the suite's surfaces show (`expectSiteMedia`). */
  private readonly mediaHosts = new Set<string>();

  private constructor(allowedOrigins: readonly string[]) {
    // http, https, ws and wss to the same loopback host:port are one origin for this purpose.
    this.allowedHosts = new Set(allowedOrigins.map((origin) => new URL(origin).host));
  }

  /** Subscribes to network events of every browsing context of the session and starts reading the sink from now. */
  static async install(allowedOrigins: readonly string[] = allowedE2eOrigins()): Promise<NetworkTrap> {
    const trap = new NetworkTrap(allowedOrigins);
    await browser.sessionSubscribe({ events: ['network.beforeRequestSent'] });
    browser.on('network.beforeRequestSent', (params) => {
      trap.seen.push({ url: params.request.url, method: params.request.method, context: params.context, timestamp: params.timestamp });
    });
    trap.egressCursor = (await standServer.egress()).next;
    return trap;
  }

  isAllowed(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (NON_NETWORK_SCHEMES.has(parsed.protocol)) return true;
    return LOOPBACK_HOSTS.has(parsed.hostname) && this.allowedHosts.has(parsed.host);
  }

  /** Every request the BiDi log has seen so far. */
  requests(): readonly TrappedRequest[] {
    return [...this.seen];
  }

  /** Lets events already emitted by the browser arrive (one BiDi round trip and a short pause). */
  async settle(): Promise<void> {
    await browser.browsingContextGetTree({});
    await browser.pause(150);
  }

  /** BiDi violations since the last take, consumed. */
  async takeViolations(): Promise<TrappedRequest[]> {
    await this.settle();
    const fresh = this.seen.slice(this.cursor);
    this.cursor = this.seen.length;
    return fresh.filter((request) => !this.isAllowed(request.url) && !this.isSiteMedia(request));
  }

  /** A picture of a declared site CDN: a GET over https, nothing sent along. */
  private isSiteMedia(request: TrappedRequest): boolean {
    if (request.method !== 'GET') return false;
    try {
      const parsed = new URL(request.url);
      return parsed.protocol === 'https:' && this.mediaHosts.has(parsed.host);
    } catch {
      return false;
    }
  }

  /**
   * Declares a deliberate request to a probe host (an `.invalid` name only):
   * the sink's attempts there no longer fail this suite.
   */
  expectProbeHost(host: string): void {
    if (!host.endsWith('.invalid')) throw new Error(`only .invalid probe hosts can be expected, not ${host}`);
    this.probeHosts.add(host);
  }

  /**
   * Declares the pictures of a site's own CDN that a surface of ours shows, the way the site's page loads them (X59:
   * the fan's picture in «Новые фоловеры» on Fansly). Their GETs and the sink's attempts there no longer fail this suite;
   * in the e2e container they reach nothing, and the picture stays its initial. Only a site's CDN host is accepted.
   */
  expectSiteMedia(host: string): void {
    if (!SITE_MEDIA_HOST.test(host)) throw new Error(`only a site's CDN host can be expected for pictures, not ${host}`);
    this.mediaHosts.add(host);
  }

  /** Sink attempts to hosts other than Firefox's own since the last take, consumed. Lines lost from the bounded sink log fail. */
  async takeEgress(): Promise<EgressAttempt[]> {
    const page = await standServer.egress(this.egressCursor);
    this.egressCursor = page.next;
    if (page.dropped > 0) throw new Error(`the egress sink dropped ${page.dropped} attempt(s) before they were read`);
    return page.attempts.filter((attempt) => attempt.host === null || !FIREFOX_OWN_HOSTS.has(attempt.host));
  }

  /** Fails on any BiDi violation or foreign sink attempt not yet taken; `where` names the test for the report. */
  async assertClean(where = ''): Promise<void> {
    const violations = await this.takeViolations();
    const egress = (await this.takeEgress()).filter((attempt) => attempt.host === null || (!this.probeHosts.has(attempt.host) && !this.mediaHosts.has(attempt.host)));
    if (violations.length === 0 && egress.length === 0) return;
    const parts = [
      ...(violations.length > 0 ? [`BiDi: ${violations.map((request) => `${request.method} ${request.url}`).join(', ')}`] : []),
      ...(egress.length > 0 ? [`egress sink: ${[...new Set(egress.map((attempt) => attempt.line))].join(', ')}`] : []),
    ];
    throw new Error(`requests outside the loopback stand/fake hub${where === '' ? '' : ` (${where})`}: ${parts.join('; ')}`);
  }
}

/**
 * Mocha wiring: installs the trap before the suite, fails after any test that
 * let an outside request through (naming that test), and sweeps once more
 * after the suite for late requests. A test that makes one on purpose takes it
 * with `takeViolations()` / `takeEgress()` itself, after `expectProbeHost()`.
 */
export function useNetworkTrap(allowedOrigins?: () => readonly string[]): { readonly trap: () => NetworkTrap } {
  let trap: NetworkTrap | null = null;
  before(async () => {
    trap = await NetworkTrap.install(allowedOrigins?.() ?? allowedE2eOrigins());
  });
  afterEach(async function (this: Mocha.Context) {
    await trap?.assertClean(`during or right after «${this.currentTest?.fullTitle() ?? '?'}»`);
  });
  after(async () => {
    if (trap === null) return;
    await browser.pause(FINAL_SETTLE_MS);
    await trap.assertClean('after the last test of the suite');
  });
  return {
    trap: () => {
      if (trap === null) throw new Error('network trap not installed yet');
      return trap;
    },
  };
}
