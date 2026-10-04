// The tab's side of client_health (tab/health.ts): starts and ends of the
// metrics, and the report to the background.

import type { HostContractReport } from '@cg/contracts/host';
import type { TabHealthReport } from '@cg/contracts/telemetry';
import { describe, expect, it } from 'vitest';

import { HEALTH_REPORT_MS, startTabHealth } from './health';

const CONTRACT = { build: 'index-Synthetic1' } as unknown as HostContractReport;

function world() {
  let now = 1_700_000_000_000;
  let perf = 1000;
  const sent: TabHealthReport[] = [];
  let tick: () => void = () => undefined;
  let cleared = 0;
  const health = startTabHealth({
    send(report) {
      sent.push(report);
      return Promise.resolve(true);
    },
    contract: () => CONTRACT,
    domNodes: () => 42,
    now: () => now,
    perfNow: () => perf,
    setInterval(fn, ms) {
      expect(ms).toBe(HEALTH_REPORT_MS);
      tick = fn;
      return 1;
    },
    clearInterval: () => void (cleared += 1),
  });
  const metric = (report: TabHealthReport | undefined, name: string) => report?.perf.find((item) => item.metric === name);
  return {
    health,
    sent,
    metric,
    tick: () => tick(),
    cleared: () => cleared,
    advance(ms: number) {
      now += ms;
      perf += ms;
    },
    flush: () => Promise.resolve().then(() => Promise.resolve()),
  };
}

describe('client_health of a tab', () => {
  it('[TL-014] a metric is a start of the tab and an end of the UI: route → dock, action → panel, first chunk → paint', async () => {
    const w = world();
    w.health.routeChanged();
    w.advance(12);
    w.health.painted('routeToDockMs', 'dock:chatspace:910101:74001001');
    w.health.action('Generate');
    w.advance(40);
    w.health.painted('panelOpenMs', 'op-1');
    w.health.firstChunk('op-1', 1_700_000_000_052 + 100);
    w.advance(130);
    w.health.painted('firstChunkPaintMs', 'op-1');
    w.health.report();
    await w.flush();
    const report = w.sent[0];
    expect(report).toMatchObject({ host: CONTRACT, footprint: { cachesKB: 0, domNodes: 42 } });
    expect(w.metric(report, 'routeToDockMs')).toMatchObject({ count: 1, sum: 12, max: 12 });
    expect(w.metric(report, 'panelOpenMs')).toMatchObject({ count: 1, sum: 40, max: 40 });
    expect(w.metric(report, 'firstChunkPaintMs')).toMatchObject({ count: 1, sum: 30, max: 30 });
    // Names of marks — a target, an operation — never leave the tab.
    expect(JSON.stringify(report)).not.toContain('op-1');
    expect(JSON.stringify(report)).not.toContain('74001001');
  });

  it('an end without its start measures nothing, a start is spent once, and a paint that came too late is not a latency', async () => {
    const w = world();
    w.health.painted('panelOpenMs', 'op-1');
    w.health.painted('firstChunkPaintMs', 'op-unknown');
    w.health.action('Search');
    w.advance(8);
    w.health.painted('searchMs', 'spenders.search');
    w.health.painted('searchMs', 'spenders.search');
    w.health.action('Navigate', 'spenders');
    w.advance(60_000);
    w.health.painted('boardOpenMs', 'spenders.board');
    w.health.report();
    await w.flush();
    expect(w.sent[0]?.perf.map((item) => [item.metric, item.count])).toEqual([['searchMs', 1]]);
  });

  it('a key of ours and what opens a window start `panelOpenMs`; the Spenders board has its own start', async () => {
    const w = world();
    w.health.action('key');
    w.advance(5);
    w.health.painted('panelOpenMs', 'x');
    w.health.action('Navigate', 'spenders');
    w.advance(90);
    w.health.painted('boardOpenMs', 'spenders.board');
    w.health.painted('panelOpenMs', 'spenders');
    w.health.record('handlerMs', 0.4);
    w.health.record('insertMs', 18);
    w.health.count('ui.failed.dock');
    w.health.report();
    await w.flush();
    const report = w.sent[0];
    expect(report?.perf.map((item) => [item.metric, item.count]).sort()).toEqual([['boardOpenMs', 1], ['handlerMs', 1], ['insertMs', 1], ['panelOpenMs', 2]]);
    expect(report?.counters).toEqual({ 'ui.failed.dock': 1 });
  });

  it('once a minute — only when there is something to say; a contract change and the page going away say it at once', async () => {
    const w = world();
    w.tick();
    await w.flush();
    expect(w.sent).toEqual([]);
    w.health.record('handlerMs', 1);
    w.tick();
    await w.flush();
    expect(w.sent).toHaveLength(1);
    // The window started over: nothing new, nothing sent — unless the caller insists (the host contract changed).
    w.tick();
    await w.flush();
    expect(w.sent).toHaveLength(1);
    w.health.report(true);
    await w.flush();
    expect(w.sent).toHaveLength(2);
    expect(w.sent[1]?.perf).toEqual([]);
    w.health.dispose();
    expect(w.cleared()).toBe(1);
  });
});
