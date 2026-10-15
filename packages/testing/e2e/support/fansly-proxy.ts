// The model's tab behind its container's proxy, on the stand (R20 P9c; docs/project-unite/architecture.md §8.5, §13;
// spec FS-NET-4): what Multi-Account Containers does on a chatter's machine — the requests of the tabs of a
// container go through that container's proxy, a background request (`tabId −1`, no tab) leaves directly — copied
// with Firefox's own proxy filter through WebDriver's chrome context, for the stand's tab and the fake Fansly's API:
// - a request whose top document is the Fansly stand's page (the tab and every frame in it: the relay frame of
//   «Fansly через вкладку» too) and whose address is the fake Fansly's API goes through the stand's proxy
//   (packages/testing/src/fake-fansly/proxy.ts), which journals it `via: 'proxy'`;
// - every other loopback request goes direct, as before; anything else keeps what the profile says (the egress
//   sink, support/network-trap.ts).
// Firefox never proxies loopback, even for a filter, unless `network.proxy.allow_hijacking_localhost` is on — so the
// filter takes every loopback request first, and only then is the switch turned; both are undone in reverse.

import { inChrome } from './background';

export interface TabProxyRoute {
  /** The Fansly stand's page origin (`http://localhost:<port>`): its tab's requests are the container's. */
  readonly standOrigin: string;
  /** The fake Fansly's API (`localhost:<port>`): what of the tab goes through the proxy. */
  readonly apiHost: string;
  /** The stand's proxy (`127.0.0.1:<port>`). */
  readonly proxy: string;
}

/** The stand's proxy as wdio.conf.ts started it. */
export function fanslyProxyHost(): string {
  const proxy = process.env['CG_FANSLY_PROXY'];
  if (!proxy) throw new Error('CG_FANSLY_PROXY not set (wdio onPrepare starts the stand and its proxy)');
  return proxy;
}

export async function routeTabThroughProxy(route: TabProxyRoute): Promise<void> {
  const [proxyHost, proxyPort] = route.proxy.split(':');
  const answer = await inChrome((driver) =>
    driver.executeScript(
      `const [standOrigin, apiHost, proxyHost, proxyPort] = arguments;
       const pps = Cc['@mozilla.org/network/protocol-proxy-service;1'].getService(Ci.nsIProtocolProxyService);
       if (window.__cgTabProxy) return { error: 'already routed' };
       const proxy = pps.newProxyInfo('http', proxyHost, Number(proxyPort), '', '', 0, 0xffffffff, null);
       const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
       const counts = { proxied: 0, direct: 0 };
       const filter = {
         QueryInterface: ChromeUtils.generateQI(['nsIProtocolProxyChannelFilter']),
         applyFilter(channel, defaultProxy, callback) {
           let result = defaultProxy;
           try {
             const uri = channel.URI;
             if (LOOPBACK.has(uri.host)) {
               const top = channel.loadInfo && channel.loadInfo.browsingContext ? channel.loadInfo.browsingContext.top : null;
               const tabTop = top && top.currentURI ? top.currentURI.prePath : null;
               result = uri.hostPort === apiHost && tabTop === standOrigin ? proxy : null;
               if (result === null) counts.direct += 1; else counts.proxied += 1;
             }
           } catch (error) {
             result = defaultProxy;
           }
           callback.onProxyFilterResult(result);
         },
       };
       pps.registerChannelFilter(filter, 0);
       window.__cgTabProxy = { filter, counts, hijacking: Services.prefs.getBoolPref('network.proxy.allow_hijacking_localhost', false) };
       Services.prefs.setBoolPref('network.proxy.allow_hijacking_localhost', true);
       return { ok: true };`,
      [route.standOrigin, route.apiHost, proxyHost ?? '127.0.0.1', proxyPort ?? '0'],
    ),
  );
  const result = answer as { ok?: boolean; error?: string };
  if (result.ok !== true) throw new Error(`the tab's proxy: ${result.error ?? 'no answer'}`);
}

/** How many loopback requests the filter sent through the proxy, and how many direct, so far. */
export async function tabProxyCounts(): Promise<{ readonly proxied: number; readonly direct: number } | null> {
  const answer = await inChrome((driver) => driver.executeScript('return window.__cgTabProxy ? { ...window.__cgTabProxy.counts } : null;', []));
  return answer as { proxied: number; direct: number } | null;
}

export async function stopRoutingTabThroughProxy(): Promise<void> {
  await inChrome((driver) =>
    driver.executeScript(
      `const routed = window.__cgTabProxy;
       if (!routed) return;
       Services.prefs.setBoolPref('network.proxy.allow_hijacking_localhost', routed.hijacking);
       Cc['@mozilla.org/network/protocol-proxy-service;1'].getService(Ci.nsIProtocolProxyService).unregisterChannelFilter(routed.filter);
       delete window.__cgTabProxy;`,
      [],
    ),
  );
}
