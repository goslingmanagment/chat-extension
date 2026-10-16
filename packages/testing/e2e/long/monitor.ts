// Stream journals to disk and keep only cursors/counters in the harness: an 8-hour observer must not grow its own log arrays.
import { appendFileSync } from 'node:fs';

import type { DiagnosticsSnapshot, LogRecord } from '@cg/contracts';
import { browser } from '@wdio/globals';

import type { FakeHubControlClient } from '../../src/fake-hub/control-client';
import { journalViolations } from '../../src/fake-hub/journal';
import type { SendEvidence } from '../../src/long-run/report';
import { pageRpc } from '../support/extension';
import { testBuildPage } from '../support/fake-hub';
import type { FanslyShift } from '../support/fansly-shift';
import { fakeFansly } from '../support/fansly-stand';
import { allowedE2eOrigins } from '../support/network-trap';
import { foreignCalls, standServer } from '../support/stand';

export class LongRunMonitor {
  private fanslyCursor = 0;
  private hubCursor = 0;
  private standCursor = 0;
  private egressCursor = 0;
  private readonly logKeys = new Set<string>();
  private readonly allowed = new Set(allowedE2eOrigins().map((origin) => new URL(origin).host));
  constructor(private readonly dir: string, private readonly errors: string[], private readonly warnings: string[], private readonly sends: SendEvidence[]) {}

  record(kind: string, value: unknown): void { appendFileSync(`${this.dir}/journal.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), kind, value })}\n`); }

  async observeBrowser(label: string): Promise<void> {
    await browser.sessionSubscribe({ events: ['network.beforeRequestSent', 'log.entryAdded'] });
    browser.on('network.beforeRequestSent', (entry: { request: { url: string; method: string } }) => {
      const url = new URL(entry.request.url);
      if (['about:', 'moz-extension:', 'data:', 'blob:', 'chrome:', 'resource:'].includes(url.protocol)) return;
      if (this.allowed.has(url.host)) return;
      const message = `${label}: outside stand: ${entry.request.method} ${url.origin}${url.pathname}`;
      this.errors.push(message); this.record('network-error', message);
    });
    browser.on('log.entryAdded', (entry: { level: string; text?: string | null }) => {
      if (entry.level !== 'error' && entry.level !== 'warn') return;
      const text = `${label}: ${entry.text ?? '(no text)'}`.slice(0, 2000);
      this.record('browser-log', { level: entry.level, text });
      if (entry.level === 'error') this.errors.push(text);
      else if (this.warnings.length < 100) this.warnings.push(text);
    });
  }

  async mark(hub: FakeHubControlClient): Promise<void> {
    this.fanslyCursor = await fakeFansly().mark();
    this.hubCursor = await hub.mark();
    this.standCursor = await standServer.mark();
    this.egressCursor = (await standServer.egress()).next;
  }

  async drain(hub: FakeHubControlClient): Promise<void> {
    const fansly = await fakeFansly().journal(this.fanslyCursor);
    const hubPage = await hub.journal(this.hubCursor);
    const stand = await standServer.journal(this.standCursor);
    for (const [name, page, cursor] of [['fansly', fansly, this.fanslyCursor], ['hub', hubPage, this.hubCursor], ['chatspace', stand, this.standCursor]] as const) {
      if (page.entries.length > 0 && page.entries[0]?.seq !== cursor + 1) this.errors.push(`${name}: journal gap after ${cursor}`);
      this.record(name, page);
    }
    this.fanslyCursor = fansly.next; this.hubCursor = hubPage.next; this.standCursor = stand.next;
    for (const violation of fansly.violations) this.errors.push(`FS-NET-1: ${JSON.stringify(violation)}`);
    for (const violation of journalViolations(hubPage.entries)) this.errors.push(`hub schema/route: #${violation.seq} ${violation.path}`);
    for (const call of hubPage.entries) if (call.status >= 400) this.errors.push(`hub HTTP ${call.status}: ${call.route ?? call.path}`);
    for (const call of foreignCalls(stand.entries)) this.errors.push(`ChatSpace foreign call: #${call.seq}`);
    for (const call of fansly.entries) {
      if (call.kind === 'http' && (call.status ?? 0) >= 400) this.errors.push(`Fansly HTTP ${String(call.status)}: ${call.route ?? '?'}`);
      if (call.kind !== 'http' || call.route !== 'message.send') continue;
      // Only one synthetic send click is scheduled per fresh group; ANY POST by the page or neighbour is unexpected too.
      const string = (key: string): string | null => typeof call.detail?.[key] === 'string' ? call.detail[key] : null;
      this.sends.push({ seq: call.seq, requestId: string('requestId'), groupId: string('groupId'), messageId: string('messageId') });
    }
    const egress = await standServer.egress(this.egressCursor);
    this.egressCursor = egress.next;
    this.record('egress', egress);
    if (egress.dropped > 0 || egress.attempts.length > 0) this.errors.push(`egress attempts ${egress.attempts.length}, dropped ${egress.dropped}`);
  }

  async diagnostics(shift: FanslyShift): Promise<DiagnosticsSnapshot> {
    await shift.toPages();
    // This page alone may export. Return to its quiet counterpart after the call (the caller does it).
    await browser.url(testBuildPage('options.html'));
    const answer = await pageRpc<DiagnosticsSnapshot>('diagnostics.get');
    if (!answer.ok) throw new Error(`diagnostics.get: ${answer.error.code}`);
    this.record('diagnostics', answer.payload);
    const exported = await pageRpc<{ body: string }>('diagnostics.export', { format: 'json' });
    if (!exported.ok) throw new Error(`diagnostics.export: ${exported.error.code}`);
    const bundle = JSON.parse(exported.payload.body) as { logs: { store: { logSession: number | null }; recent: LogRecord[]; previous: { logSession: number | null; records: LogRecord[] } } };
    for (const [session, records] of [[bundle.logs.store.logSession, bundle.logs.recent], [bundle.logs.previous.logSession, bundle.logs.previous.records]] as const) {
      for (const log of records) {
        const key = `${session}:${log.ts}:${log.seq}:${log.scope}:${log.ctx?.tabSessionId ?? ''}`;
        if (this.logKeys.has(key)) continue;
        this.logKeys.add(key);
        this.record('extension-log', log);
        if (log.level === 'error') this.errors.push(`${log.scope}: ${log.code ?? ''} ${log.msg}`);
        if (log.level === 'warn' && this.warnings.length < 100) this.warnings.push(`${log.scope}: ${log.code ?? ''} ${log.msg}`);
      }
    }
    // Bounded deduplication is enough: the export itself keeps at most its recent/previous tails.
    if (this.logKeys.size > 10_000) this.logKeys.clear();
    await browser.url(testBuildPage());
    await shift.toFansly();
    return answer.payload;
  }
}
