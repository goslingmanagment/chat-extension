// Egress sink for e2e: the browser profile sends every non-loopback request to
// this loopback "proxy", which records the request line (CONNECT host:443 or
// GET http://host/…) and drops the connection. Nothing leaves the machine and
// no outside name is even resolved. It sees requests from every part of the
// browser — pages, content scripts AND extension background pages, which the
// BiDi network trap does not see — so e2e specs read it after every test
// (e2e/support/network-trap.ts) and fail on any host the browser itself does
// not contact.

import { createServer, type Server, type Socket } from 'node:net';

export interface EgressAttempt {
  /** 1, 2, 3… in arrival order, never reused. */
  readonly seq: number;
  /** The request line, at most 300 characters. */
  readonly line: string;
  /** Host of the request line (`CONNECT host:port`, or the absolute URL's host); null if unparsable. */
  readonly host: string | null;
}

export interface EgressPage {
  readonly attempts: readonly EgressAttempt[];
  /** Pass as `since` to read only what came after this page. */
  readonly next: number;
  /** Attempts after `since` that fell out of the bounded log before this read. */
  readonly dropped: number;
}

export interface EgressSink {
  readonly port: number;
  /** Attempts with seq > since (all kept ones by default), oldest first. */
  read(since?: number): EgressPage;
  close(): Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 5000;

/** `CONNECT host:443 HTTP/1.1` → host; `GET http://host/path HTTP/1.1` → host. */
export function egressHost(line: string): string | null {
  const [method, target] = line.split(' ');
  if (method === undefined || target === undefined) return null;
  if (method === 'CONNECT') {
    const host = target.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return host === '' ? null : host.toLowerCase();
  }
  try {
    return new URL(target).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export async function startEgressSink(options: { readonly maxAttempts?: number } = {}): Promise<EgressSink> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const attempts: EgressAttempt[] = [];
  let seq = 0;
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.once('data', (chunk: Buffer) => {
      const line = (chunk.toString('latin1').split('\r\n', 1)[0] ?? '').slice(0, 300);
      seq += 1;
      attempts.push({ seq, line, host: egressHost(line) });
      if (attempts.length > maxAttempts) attempts.shift();
      socket.destroy();
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(5000, () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('egress sink has no TCP address');
  return {
    port: address.port,
    read: (since = 0) => {
      const kept = attempts.filter((attempt) => attempt.seq > since);
      const oldestKept = attempts[0]?.seq ?? seq + 1;
      return { attempts: kept, next: seq, dropped: Math.max(0, oldestKept - since - 1) };
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/**
 * Firefox prefs that route every non-loopback request through the sink and
 * keep Firefox's own services quiet, so that what the sink records is ours.
 * Loopback (127.0.0.1, localhost) never goes through a proxy in Firefox
 * (`network.proxy.allow_hijacking_localhost` stays false), so the stand and
 * the fake hub are reached directly.
 */
export function egressProxyPrefs(port: number): Record<string, string | number | boolean> {
  return {
    'network.proxy.type': 1,
    'network.proxy.http': '127.0.0.1',
    'network.proxy.http_port': port,
    'network.proxy.ssl': '127.0.0.1',
    'network.proxy.ssl_port': port,
    'network.proxy.share_proxy_settings': true,
    'network.proxy.allow_hijacking_localhost': false,
    'network.proxy.no_proxies_on': '',
    ...QUIET_FIREFOX_PREFS,
  };
}

/** Firefox's own outside traffic, off: speculative work, update and settings services, telemetry, region, safe browsing. */
export const QUIET_FIREFOX_PREFS: Readonly<Record<string, string | number | boolean>> = {
  'network.dns.disablePrefetch': true,
  'network.prefetch-next': false,
  'network.http.speculative-parallel-limit': 0,
  'network.captive-portal-service.enabled': false,
  'network.connectivity-service.enabled': false,
  'network.trr.mode': 5,
  // Remote settings (blocklists, certificate data, search config, …): a dead server.
  'services.settings.server': 'data:,#remote-settings-dummy/v1',
  'extensions.blocklist.enabled': false,
  'security.remote_settings.crlite_filters.enabled': false,
  'security.remote_settings.intermediates.enabled': false,
  'security.OCSP.enabled': 0,
  'extensions.update.enabled': false,
  'extensions.getAddons.cache.enabled': false,
  'extensions.systemAddon.update.enabled': false,
  'extensions.systemAddon.update.url': '',
  'app.update.enabled': false,
  'app.update.auto': false,
  'app.update.url': '',
  'app.normandy.enabled': false,
  'app.normandy.api_url': '',
  'app.shield.optoutstudies.enabled': false,
  'messaging-system.rsexperimentloader.enabled': false,
  'browser.region.network.url': '',
  'browser.region.update.enabled': false,
  'browser.search.update': false,
  'browser.safebrowsing.malware.enabled': false,
  'browser.safebrowsing.phishing.enabled': false,
  'browser.safebrowsing.downloads.enabled': false,
  'browser.safebrowsing.blockedURIs.enabled': false,
  'browser.safebrowsing.provider.google4.updateURL': '',
  'browser.safebrowsing.provider.google.updateURL': '',
  'browser.safebrowsing.provider.mozilla.updateURL': '',
  'media.gmp-manager.url': '',
  'media.gmp-manager.updateEnabled': false,
  'media.gmp-gmpopenh264.autoupdate': false,
  'media.gmp-widevinecdm.autoupdate': false,
  'browser.translations.enable': false,
  'browser.newtabpage.enabled': false,
  'browser.newtabpage.activity-stream.feeds.system.topstories': false,
  'browser.newtabpage.activity-stream.feeds.section.topstories': false,
  'browser.newtabpage.activity-stream.feeds.topsites': false,
  'browser.topsites.contile.enabled': false,
  'browser.ping-centre.telemetry': false,
  'datareporting.healthreport.uploadEnabled': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.enabled': false,
  'toolkit.telemetry.server': 'data:,',
  'geo.provider.network.url': '',
  'identity.fxaccounts.enabled': false,
  'browser.discovery.enabled': false,
};
