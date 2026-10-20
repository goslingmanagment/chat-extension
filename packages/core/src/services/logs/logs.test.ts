import { LogRecordSchema, type LogRecord } from '@cg/contracts/logs';
import { describe, expect, it } from 'vitest';

import { CodeCounters, createRedactor } from '../../domain/logging';
import { acceptUiRecords } from './index';

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const TOKEN = 'agency_hub_device_Zx81kQpLm4Rt7Vw2Yb9N';
const TAB = '7d0a1c2e-3f4b-4c5d-8e6f-708192a3b4c5';

describe('[LG-003] records from tabs and pages', () => {
  it('[LG-003] the background masks the token a tab never knew, adds the tab session, counts codes', () => {
    const redactor = createRedactor();
    redactor.setToken(TOKEN);
    const stored: LogRecord[] = [];
    const counters = new CodeCounters(T0);
    const fromTab: LogRecord = {
      ts: new Date(T0).toISOString(),
      seq: 4,
      level: 'warn',
      scope: 'tab.dock',
      msg: `failed with ${TOKEN}`,
      code: 'CG-INSERT-FAILED',
      fields: { reason: `token tail ${TOKEN.slice(-8)}`, text: '[text len=12]' },
    };
    const answer = acceptUiRecords([fromTab], { tabSessionId: TAB }, { redactor, sinks: [(r) => stored.push(r)], debugEnabled: () => false, counters });
    expect(answer).toEqual({ accepted: 1, dropped: 0 });
    const json = JSON.stringify(stored);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain(TOKEN.slice(-8));
    expect(stored[0]).toMatchObject({ seq: 4, scope: 'tab.dock', code: 'CG-INSERT-FAILED', ctx: { tabSessionId: TAB }, fields: { text: '[text len=12]' } });
    expect(LogRecordSchema.safeParse(stored[0]).success).toBe(true);
    expect(counters.todayCounts(T0)).toEqual([{ code: 'CG-INSERT-FAILED', count: 1 }]);
  });
});
