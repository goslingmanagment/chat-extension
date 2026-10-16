import { afterEach, describe, expect, it } from 'vitest';
import type { FanPanelVM } from '@cg/contracts/vm';
import { entry } from '../scenarios/app-client';
import { mountBoardSettled, type MountedBoard } from './harness';
import { boardScenario } from './states';

let ui: MountedBoard | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

describe('[host:fansly] fan panel registration', () => {
  it('[FS-REG-4] renders the optional local date without needing a header anchor', async () => {
    const base = boardScenario('14a');
    const scenario = { ...base, views: base.views.map((view) => view.selector.of === 'fan-panel'
      ? entry({ of: 'fan-panel' }, { ...(view.vm as FanPanelVM), registration: { label: 'Регистрация', at: '2024-01-01T12:00:00.000Z' } }) : view) };
    ui = await mountBoardSettled('fan-panel', scenario);
    // A row of «Подписка», before the subscription's own dates, not a block above the money.
    expect(ui.$('[data-registration-date]')?.previousElementSibling?.textContent).toBe('Регистрация');
    expect(ui.text('[data-registration-date]')).toContain('2024');
    expect(ui.$('[data-registration-date]')?.getAttribute('data-registration-date')).toBe('2024-01-01T12:00:00.000Z');
  });
});
