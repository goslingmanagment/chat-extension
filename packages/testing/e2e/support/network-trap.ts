// BiDi network-log trap (architecture.md §12 п. 4 «сетевой журнал BiDi»):
// records every request the browser starts (network.beforeRequestSent, all
// contexts) and fails the test on any request outside the loopback stand and
// fake-hub origins. Extension-internal and non-network schemes pass.
// The egress sink (src/stand/egress-sink.ts) is the hard block behind it:
// nothing the trap reports could have left the machine.

import { browser } from '@wdio/globals';

import { standApiOrigin, standOrigin } from './stand';

export interface TrappedRequest {
  readonly url: string;
  readonly method: string;
  readonly context: string | null;
  readonly timestamp: number;
}

const NON_NETWORK_SCHEMES = new Set(['moz-extension:', 'about:', 'data:', 'blob:', 'chrome:', 'resource:', 'javascript:']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Origins an e2e may reach: the stand (page and API) and, when R02 part 2 starts it, the fake hub. */
export function allowedE2eOrigins(): string[] {
  const hub = process.env['CG_FAKE_HUB_ORIGIN'];
  return [standOrigin(), standApiOrigin(), ...(hub !== undefined && hub !== '' ? [hub] : [])];
}

export class NetworkTrap {
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly seen: TrappedRequest[] = [];
  private cursor = 0;

  private constructor(allowedOrigins: readonly string[]) {
    // http, https, ws and wss to the same loopback host:port are one origin for this purpose.
    this.allowedHosts = new Set(allowedOrigins.map((origin) => new URL(origin).host));
  }

  /** Subscribes to network events of every browsing context of the session. */
  static async install(allowedOrigins: readonly string[] = allowedE2eOrigins()): Promise<NetworkTrap> {
    const trap = new NetworkTrap(allowedOrigins);
    await browser.sessionSubscribe({ events: ['network.beforeRequestSent'] });
    browser.on('network.beforeRequestSent', (params) => {
      trap.seen.push({ url: params.request.url, method: params.request.method, context: params.context, timestamp: params.timestamp });
    });
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

  /** Every request seen so far. */
  requests(): readonly TrappedRequest[] {
    return [...this.seen];
  }

  /** Lets events already emitted by the browser arrive (one BiDi round trip and a short pause). */
  async settle(): Promise<void> {
    await browser.browsingContextGetTree({});
    await browser.pause(150);
  }

  /** Violations since the last take, consumed. */
  async takeViolations(): Promise<TrappedRequest[]> {
    await this.settle();
    const fresh = this.seen.slice(this.cursor);
    this.cursor = this.seen.length;
    return fresh.filter((request) => !this.isAllowed(request.url));
  }

  async assertClean(): Promise<void> {
    const violations = await this.takeViolations();
    if (violations.length > 0) {
      throw new Error(`requests outside the loopback stand/fake hub: ${violations.map((request) => `${request.method} ${request.url}`).join(', ')}`);
    }
  }
}

/**
 * Mocha wiring: installs the trap before the suite and fails after any test
 * that let an outside request through. A test that makes one on purpose takes
 * it with `takeViolations()` itself.
 */
export function useNetworkTrap(allowedOrigins?: () => readonly string[]): { readonly trap: () => NetworkTrap } {
  let trap: NetworkTrap | null = null;
  before(async () => {
    trap = await NetworkTrap.install(allowedOrigins?.() ?? allowedE2eOrigins());
  });
  afterEach(async () => {
    await trap?.assertClean();
  });
  return {
    trap: () => {
      if (trap === null) throw new Error('network trap not installed yet');
      return trap;
    },
  };
}
