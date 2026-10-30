import { describe, expect, it } from 'vitest';

import { type AiLimitSnapshot, type BackgroundToast } from '@cg/contracts';

import { createAiLimitAlerts } from './ai-limit-alerts';

const DAY1 = '2026-10-31T21:00:00.000Z';
const DAY2 = '2026-11-01T21:00:00.000Z';

const snap = (todayMicroUsd: number, resetsAt = DAY1): AiLimitSnapshot => ({
  dailyLimitMicroUsd: 3_500_000,
  todayMicroUsd,
  remainingMicroUsd: Math.max(3_500_000 - todayMicroUsd, 0),
  resetsAt,
  observedAt: '2026-10-31T12:00:00.000Z',
});

function setup(tabs = true) {
  const toasts: BackgroundToast[] = [];
  const kept = new Map<string, unknown>();
  let open = tabs;
  let id = 0;
  const alerts = createAiLimitAlerts({
    ids: { uuid: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` },
    events: { emit: (_to, type, payload) => void (type === 'toast' && toasts.push((payload as { toast: BackgroundToast }).toast)) },
    local: { get: async (key) => kept.get(key), set: async (key, value) => void kept.set(key, value) },
    hasTabs: () => open,
  });
  return { alerts, toasts, kept, openTabs: () => (open = true) };
}

const levels = (toasts: readonly BackgroundToast[]) => toasts.map((toast) => toast.aiLimit?.level);

describe('the personal AI limit alerts: at 80 % and when spent, once a Moscow day each', () => {
  it('warns at 80 %, then once when spent, and never twice the same day', () => {
    const { alerts, toasts } = setup();
    alerts.note(snap(2_000_000));
    alerts.note(snap(2_800_000));
    alerts.note(snap(3_000_000));
    alerts.note(snap(3_600_000));
    alerts.note(snap(3_700_000));
    expect(levels(toasts)).toEqual(['low', 'out']);
  });

  it('a jump past both says only that it is spent; the next day starts over', () => {
    const { alerts, toasts } = setup();
    alerts.note(snap(3_600_000));
    alerts.note(snap(2_900_000));
    alerts.note(snap(2_900_000, DAY2));
    expect(levels(toasts)).toEqual(['out', 'low']);
  });

  it('with no tab open nothing is marked: the alert comes when a tab is there', () => {
    const { alerts, toasts, openTabs } = setup(false);
    alerts.note(snap(2_900_000));
    expect(toasts).toHaveLength(0);
    openTabs();
    alerts.note(snap(2_900_000));
    expect(levels(toasts)).toEqual(['low']);
  });

  it('a restarted browser keeps the marks of the day', async () => {
    const first = setup();
    first.alerts.note(snap(2_900_000));
    await Promise.resolve();
    const again = createAiLimitAlerts({
      ids: { uuid: () => '00000000-0000-4000-8000-000000000099' },
      events: { emit: (_to, type, payload) => void (type === 'toast' && first.toasts.push((payload as { toast: BackgroundToast }).toast)) },
      local: { get: async (key) => first.kept.get(key), set: async () => undefined },
    });
    await again.restore();
    again.note(snap(3_000_000));
    expect(levels(first.toasts)).toEqual(['low']);
  });
});
