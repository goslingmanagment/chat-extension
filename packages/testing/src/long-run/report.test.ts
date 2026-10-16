import { describe, expect, it } from 'vitest';

import { buildLongRunReport, longRunMinutes, longRunSummary, type RunEvidence } from './report';

function good(minutes = 480): RunEvidence {
  return {
    minutes, elapsedMs: minutes * 60_000, finished: true, metadata: { sha: 'synthetic' },
    chatsWithEvents: 320, messages: 320, typing: 320,
    actions: { reload: 2, accountSwitch: 1, backgroundWake: 1, newcomers: 1, greeting: 1, vault: 1, notes: 1, admission: 1 },
    memory: Array.from({ length: minutes / 5 + 1 }, (_, index) => ({ atMs: index * 300_000, epoch: 0, fanslyOverheadMB: 7, chatspaceOverheadMB: 9, backgroundMB: 20 })),
    idle: [0, minutes * 60_000 - 60_000].map((atMs) => ({ atMs, cpuWindowMs: 30_000, profileWindowMs: 30_000, tabCpuMs: 100, baselineTabCpuMs: 80,
      backgroundCpuMs: 80, baselineBackgroundCpuMs: 5, tabTimers: 0, backgroundTimers: 0, backgroundWakeups: 12 })),
    expectedSends: 1, sends: [{ seq: 1, requestId: 'request-a', groupId: 'group-a', messageId: 'message-a' }],
    stuckOps: 0, leakedSlots: 0, errors: [], warnings: [],
  };
}

describe('P16b manual long-run report', () => {
  it('defaults to 8 h; accepts the 5-minute smoke and rejects durations outside the job budget', () => {
    expect(longRunMinutes(undefined)).toBe(480);
    expect(longRunMinutes('5')).toBe(5);
    for (const input of ['0', '4', '481', '-1', 'NaN', '5.5', '1e2', '5; exit 0']) expect(() => longRunMinutes(input)).toThrow(/CG_LONG_RUN_MINUTES/);
  });

  it('requires a completed full-duration run; a successful smoke cannot close P16b', () => {
    expect(buildLongRunReport(good())).toMatchObject({ status: 'passed', rowComplete: true });
    const smoke = buildLongRunReport(good(5));
    expect(smoke).toMatchObject({ status: 'smoke-passed', rowComplete: false });
    expect(longRunSummary(smoke)).toContain('P16b закрыт этим отчётом: нет');
    expect(buildLongRunReport({ ...good(), finished: false })).toMatchObject({ status: 'incomplete', rowComplete: false });
    expect(buildLongRunReport({ ...good(), elapsedMs: 479 * 60_000 }).status).toBe('failed');
  });

  it('fails closed on missing/invalid measurements, missing phases and missing event coverage', () => {
    for (const patch of [
      { memory: [] }, { idle: [] }, { actions: {} }, { chatsWithEvents: 319 }, { typing: 0 },
      { memory: good().memory.map((sample) => ({ ...sample, backgroundMB: null })) },
      { memory: good().memory.map((sample) => ({ ...sample, fanslyOverheadMB: NaN })) },
      { idle: good().idle.map((sample) => ({ ...sample, tabCpuMs: -1 })) },
      { idle: good().idle.map((sample) => ({ ...sample, backgroundTimers: null })) },
      { memory: [good().memory[0]!, good().memory.at(-1)!] },
    ]) expect(buildLongRunReport({ ...good(), ...patch }).status).toBe('failed');
  });

  it('uses the 15/30 MB budgets and post-warm-up growth against the matching baseline, within a document epoch', () => {
    for (const patch of [{ fanslyOverheadMB: 15.01 }, { chatspaceOverheadMB: 15.01 }, { backgroundMB: 30.01 }]) {
      expect(buildLongRunReport({ ...good(), memory: good().memory.map((sample) => ({ ...sample, ...patch })) }).status).toBe('failed');
    }
    const series = good().memory.map((sample, index) => ({ ...sample, fanslyOverheadMB: index === 0 ? 7 : 13 }));
    expect(buildLongRunReport({ ...good(), memory: series }).checks.find((check) => check.name === 'fanslyOverheadMB growth after warm-up')?.passed).toBe(false);
    // A reload starts a new document. It must still fit the absolute budget, but is not growth of the old document.
    expect(buildLongRunReport({ ...good(), memory: series.map((sample, index) => ({ ...sample, fanslyOverheadMB: index < 2 ? 7 : 13, epoch: index < 2 ? 0 : 1 })) }).status).toBe('passed');
    expect(buildLongRunReport({ ...good(), memory: series.map((sample, index) => ({ ...sample, epoch: index })) }).status).toBe('failed');
  });

  it('normalizes windows to one minute, subtracts baseline CPU and detects even one idle add-on timer', () => {
    const idle = good().idle;
    expect(buildLongRunReport(good()).idle[0]?.perMinute.tabCpu).toBe(40);
    for (const patch of [{ tabCpuMs: 186 }, { backgroundCpuMs: 256 }, { tabTimers: 1 }, { backgroundTimers: 1 }, { backgroundWakeups: 6000 }]) {
      expect(buildLongRunReport({ ...good(), idle: idle.map((sample) => ({ ...sample, ...patch })) }).status).toBe('failed');
    }
  });

  it('catches an unrequested send, missing receipt, browser resend with two effects, and a repeated greeting to one group', () => {
    const send = good().sends[0]!;
    for (const sends of [[], [{ ...send, messageId: null }], [send, { ...send, seq: 2, messageId: 'message-b' }],
      [send, { ...send, seq: 2, requestId: 'request-b', messageId: 'message-b' }],
      [send, { seq: 2, requestId: 'request-b', messageId: 'message-b', groupId: 'group-b' }]]) {
      expect(buildLongRunReport({ ...good(), sends }).status).toBe('failed');
    }
    for (const patch of [{ stuckOps: 1 }, { leakedSlots: 1 }, { errors: ['unexpected error'] }]) expect(buildLongRunReport({ ...good(), ...patch }).status).toBe('failed');
  });
});
