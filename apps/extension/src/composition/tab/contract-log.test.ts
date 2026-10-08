// The host contract in the log without ChatSpace's start-up (tab/contract-log.ts).

import { createLogger, logHostContract, type HostContractFacts, type HostContractLogKind } from '@cg/core/domain/logging';
import type { LogRecord } from '@cg/contracts/logs';
import { describe, expect, it } from 'vitest';

import { CONTRACT_SETTLE_MAX_MS, CONTRACT_SETTLE_MS, createContractLog } from './contract-log';

const T0 = Date.UTC(2026, 9, 8, 15, 32, 56, 213);

/** A clock whose timers run when the test moves time on. */
function world() {
  let now = T0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const sunk: LogRecord[] = [];
  const logger = createLogger({ now: () => now, debugEnabled: () => false, console: null, sinks: [(record) => sunk.push(record)] });
  const kinds: HostContractLogKind[] = [];
  const log = createContractLog(
    (facts, kind) => {
      kinds.push(kind);
      logHostContract(logger, facts, kind);
    },
    {
      now: () => now,
      setTimer: (ms, fn) => {
        seq += 1;
        timers.set(seq, { at: now + ms, fn });
        return seq;
      },
      clearTimer: (handle) => timers.delete(handle as number),
    },
  );
  const advance = (ms: number): void => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
  };
  const errorsToday = () => logger.counters.todayCounts(now);
  const warnings = () => sunk.filter((record) => record.level === 'warn' || record.level === 'error');
  return { log, sunk, kinds, advance, errorsToday, warnings, pending: () => timers.size };
}

const facts = (ok: boolean, missing: readonly string[]): HostContractFacts => ({ build: 'index-p8xPkCj8', adapterVersion: '0.2.0', ok, missing, degraded: [] });

/** The reload of the third live check (diagnostics 2026-10-08 15:32:56–57): broken four times, whole within 0.8 s. */
const LIVE_RELOAD: readonly (readonly [atMs: number, HostContractFacts])[] = [
  [0, facts(false, ['accounts', 'wsFrames', 'mimic', 'userPermissions', 'receiptProfile'])],
  [282, facts(false, ['wsFrames', 'mimic', 'userPermissions', 'receiptProfile'])],
  [1, facts(false, ['wsFrames', 'mimic', 'userPermissions', 'receiptProfile'])],
  [28, facts(false, ['wsFrames', 'mimic', 'receiptProfile'])],
  [459, facts(true, ['wsFrames', 'receiptProfile'])],
  [20, facts(true, ['receiptProfile'])],
];

describe('the host contract in the log: ChatSpace’s start-up is not a broken contract (third live check)', () => {
  it('[LG-016] a reload while ChatSpace boots: no CG-HOST-CONTRACT of the day and no warning; the settled whole contract is written once', () => {
    const w = world();
    for (const [gap, next] of LIVE_RELOAD) {
      w.advance(gap);
      w.log.report(next);
    }
    expect(w.errorsToday()).toEqual([]);
    expect(w.warnings()).toEqual([]);
    expect(w.kinds).toEqual(['starting', 'starting', 'starting', 'starting', 'starting', 'starting']);
    // Still settling: nothing is judged before ChatSpace keeps one result for the settle time.
    w.advance(CONTRACT_SETTLE_MS - 1);
    expect(w.kinds).toHaveLength(6);
    w.advance(1);
    expect(w.kinds.at(-1)).toBe('checked');
    expect(w.sunk.at(-1)).toMatchObject({ level: 'info', msg: 'host contract checked', fields: { ok: true, missing: ['receiptProfile'] } });
    expect(w.sunk.at(-1)?.fields?.['starting']).toBeUndefined();
    expect(w.errorsToday()).toEqual([]);
    expect(w.warnings()).toEqual([]);
  });

  it('[LG-016] a contract that stays broken after the start-up counts once, as before', () => {
    const w = world();
    w.log.report(facts(false, ['accounts']));
    w.advance(300);
    w.log.report(facts(false, ['composerFrame']));
    expect(w.errorsToday()).toEqual([]);
    w.advance(CONTRACT_SETTLE_MS);
    expect(w.kinds).toEqual(['starting', 'starting', 'checked']);
    expect(w.sunk.at(-1)).toMatchObject({ code: 'CG-HOST-CONTRACT', msg: 'host contract checked', fields: { ok: false, missing: ['composerFrame'] } });
    expect(w.errorsToday()).toEqual([{ code: 'CG-HOST-CONTRACT', count: 1 }]);
  });

  it('[LG-016] after the start-up every change is written at once as a change: a break warns and counts, a repair warns without the code', () => {
    const w = world();
    w.log.report(facts(true, []));
    w.advance(CONTRACT_SETTLE_MS);
    w.log.report(facts(false, ['composerFrame']));
    expect(w.sunk.at(-1)).toMatchObject({ level: 'warn', code: 'CG-HOST-CONTRACT', msg: 'host contract changed' });
    w.log.report(facts(true, []));
    expect(w.sunk.at(-1)).toMatchObject({ level: 'warn', msg: 'host contract changed' });
    expect(w.sunk.at(-1)?.code).toBeUndefined();
    expect(w.kinds).toEqual(['starting', 'checked', 'changed', 'changed']);
    expect(w.errorsToday()).toEqual([{ code: 'CG-HOST-CONTRACT', count: 1 }]);
  });

  it('[LG-016] a contract that never stops changing is judged at the latest after the start-up limit', () => {
    const w = world();
    let ok = false;
    for (let elapsed = 0; elapsed < CONTRACT_SETTLE_MAX_MS + 10_000; elapsed += 1000) {
      w.log.report(facts(ok, ok ? [] : ['accounts']));
      ok = !ok;
      w.advance(1000);
    }
    const checked = w.kinds.indexOf('checked');
    expect(checked).toBeGreaterThan(0);
    expect(w.kinds.slice(0, checked).every((kind) => kind === 'starting')).toBe(true);
    expect(w.kinds.slice(checked + 1).every((kind) => kind === 'changed')).toBe(true);
    // The judgement came at the limit: one report a second, so the 31st result is the first written after it.
    expect(checked).toBe(CONTRACT_SETTLE_MAX_MS / 1000);
  });

  it('a disposed log writes nothing more and leaves no timer behind', () => {
    const w = world();
    w.log.report(facts(false, ['accounts']));
    w.log.dispose();
    expect(w.pending()).toBe(0);
    w.advance(CONTRACT_SETTLE_MAX_MS);
    w.log.report(facts(false, ['accounts']));
    expect(w.kinds).toEqual(['starting']);
    expect(w.errorsToday()).toEqual([]);
  });
});
