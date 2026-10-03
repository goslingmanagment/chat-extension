// The fixed vocabularies and tables: the CG codes of Appendix A, the X8
// attempt machine of §6.7.7, the operation model and timeouts of §7, the
// histogram bounds of client_health.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as C from '../src/index';

/** CG codes of the Appendix A table in docs/architecture.md, in order. */
function appendixACodes(): string[] {
  const doc = readFileSync(new URL('../../../docs/architecture.md', import.meta.url), 'utf8');
  const start = doc.indexOf('## Приложение А.');
  const end = doc.indexOf('**Чего в реестре нет:**', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return [...doc.slice(start, end).matchAll(/^\| (CG-[A-Z0-9-]+) \|/gm)].map((match) => match[1] ?? '');
}

describe('CG codes (Appendix A)', () => {
  it('are exactly the Appendix A list, in its order', () => {
    expect([...C.CG_CODES]).toEqual(appendixACodes());
  });

  it('are unique and keep the CG-<AREA>-<NAME> form', () => {
    expect(new Set(C.CG_CODES).size).toBe(C.CG_CODES.length);
    for (const code of C.CG_CODES) expect(code).toMatch(C.CG_CODE_PATTERN);
    expect(C.isCgCode('CG-SEND-UNCERTAIN')).toBe(true);
    expect(C.isCgCode('CG-HUB-401')).toBe(false);
  });

  it('every code used by the contracts is registered', () => {
    const admissionCodes = ['CG-OP-CHAT-BUSY', 'CG-OP-TAB-LIMIT'];
    for (const code of admissionCodes) expect(C.isCgCode(code)).toBe(true);
  });
});

describe('light copies', () => {
  it('tab.register takes exactly the host kinds of ids.ts', () => {
    for (const host of C.HOST_KINDS) expect(C.TabRegisterRequestSchema.safeParse({ host, lateInjection: false, contractsVersion: '1.0.0' }).success).toBe(true);
    expect(C.TabRegisterRequestSchema.shape.host.options).toEqual([...C.HOST_KINDS]);
    expect(C.TAB_REQUESTS['tab.register'].req).toBe(C.TabRegisterRequestSchema);
  });
});

describe('X8 attempt machine (§6.7.7)', () => {
  const T = C.SEND_ATTEMPT_TRANSITIONS as Record<C.SendAttemptState, readonly C.SendAttemptState[]>;

  it('covers every state and starts from ready only', () => {
    expect(Object.keys(T).sort()).toEqual([...C.SEND_ATTEMPT_STATES].sort());
    for (const targets of Object.values(T)) expect(targets).not.toContain('ready');
  });

  it('reaches every state from ready', () => {
    const seen = new Set<C.SendAttemptState>(['ready']);
    const queue: C.SendAttemptState[] = ['ready'];
    while (queue.length > 0) {
      const state = queue.shift() as C.SendAttemptState;
      for (const next of T[state]) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    expect([...seen].sort()).toEqual([...C.SEND_ATTEMPT_STATES].sort());
  });

  it('uncertain is never retried: it only resolves to sentObserved by a late linked pair', () => {
    expect(T.uncertain).toEqual(['sentObserved']);
    expect(T.sentObserved).toEqual([]);
    expect(T.rejected).toEqual([]);
  });

  it('nothing after a possible queue call goes back before it', () => {
    const before: C.SendAttemptState[] = ['ready', 'preparing', 'held', 'notEnqueued'];
    for (const state of ['nativeEnqueued', 'nativeAccepted', 'uncertain'] as const) {
      for (const next of T[state]) expect(before).not.toContain(next);
    }
  });

  it('a new attempt is allowed only after an end that proves nothing was queued', () => {
    for (const state of C.SEND_ATTEMPT_RETRYABLE_ENDS) expect(T[state]).toEqual([]);
    for (const state of C.SEND_ATTEMPT_CUSTODY_STATES) expect(C.SEND_ATTEMPT_RETRYABLE_ENDS as readonly string[]).not.toContain(state);
    expect(C.SEND_ATTEMPT_CUSTODY_STATES).toContain('uncertain');
  });

  it('the lock key is (hubOrigin, pageId, platform, fanRef)', () => {
    expect(C.sendLockKey({ hubOrigin: 'https://hub.example.test', pageId: 11, platform: 'onlyfans', fanRef: '2002' })).toBe('https://hub.example.test|11|onlyfans|2002');
  });
});

describe('operations (§5.5, §7)', () => {
  it('states and transitions: terminal states have no way out', () => {
    for (const state of C.OP_TERMINAL_STATES) expect(C.OP_TRANSITIONS[state]).toEqual([]);
    expect(Object.keys(C.OP_TRANSITIONS).sort()).toEqual([...C.OP_STATES].sort());
  });

  it('timeouts follow the §7 table for every feature', () => {
    const s = (v: number) => v * 1000;
    expect(Object.keys(C.OP_TIMEOUTS).sort()).toEqual([...C.FEATURE_IDS].sort());
    for (const feature of ['reply', 'fix', 'hi', 'ping'] as const) {
      expect(C.OP_TIMEOUTS[feature]).toEqual({ untilMetaMs: s(30), firstChunkAfterMetaMs: s(30), silenceMs: s(30), maxMs: s(60) });
    }
    expect(C.OP_TIMEOUTS['recap-short']).toEqual({ untilMetaMs: s(60), firstChunkAfterMetaMs: s(45), silenceMs: s(45), maxMs: s(120) });
    for (const feature of ['review', 'recap'] as const) {
      expect(C.OP_TIMEOUTS[feature]).toEqual({ untilMetaMs: s(180), firstChunkAfterMetaMs: s(45), silenceMs: s(45), maxMs: s(300) });
    }
    expect(C.OP_TIMEOUTS.coach).toEqual({ untilMetaMs: s(60), firstChunkAfterMetaMs: s(45), silenceMs: s(45), maxMs: s(180) });
  });

  it('concurrency and the one transparent retry (А3, §7)', () => {
    expect(C.OP_LIMITS.perChat).toBe(1);
    expect(C.OP_LIMITS.perTab).toBe(3);
    expect(C.OP_LIMITS.serviceUnavailableRetries).toBe(1);
    expect(C.OP_LIMITS.serviceUnavailableRetryDelayMs).toBe(5000);
  });

  it('fresh text and Split belong to the right features (D-14, D-15)', () => {
    expect(C.FRESH_TEXT_FEATURES).toEqual(['reply', 'fix', 'hi', 'ping']);
    expect(C.SPLIT_FEATURES).not.toContain('recap');
    expect(C.SPLIT_FEATURES).not.toContain('review');
    expect(C.isFreshTextFeature('coach')).toBe(false);
    expect(C.isSplitFeature('coach')).toBe(true);
  });
});

describe('client_health histograms', () => {
  it('fixed bounds are positive and strictly increasing; at most 16 metrics', () => {
    expect(C.PERF_METRIC_NAMES.length).toBeLessThanOrEqual(C.TELEMETRY_LIMITS.healthMaxPerf);
    for (const metric of C.PERF_METRIC_NAMES) {
      const { bounds } = C.PERF_METRICS[metric];
      expect(bounds.length).toBeGreaterThan(0);
      expect(bounds.length).toBeLessThanOrEqual(32);
      bounds.forEach((bound, i) => {
        expect(bound).toBeGreaterThan(0);
        if (i > 0) expect(bound).toBeGreaterThan(bounds[i - 1] ?? Number.POSITIVE_INFINITY);
      });
    }
  });

  it('names every metric of §5.7', () => {
    for (const metric of ['panelOpenMs', 'insertMs', 'ttfcMs', 'firstChunkPaintMs', 'routeToDockMs', 'handlerMs', 'boardOpenMs', 'searchMs', 'eventLatencyMs']) {
      expect(C.PERF_METRIC_NAMES).toContain(metric);
    }
  });
});
