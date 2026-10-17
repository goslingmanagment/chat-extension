import { afterEach, describe, expect, it } from 'vitest';

import type { FanPanelVM } from '@cg/contracts/vm';
import { FANSLY_PHRASES } from '@cg/core/domain/hosts/fansly/i18n';
import { FAN_PANEL_STYLES, FanPanel } from '@cg/ui/fanpanel';

import { flush, mountKitSettled } from '../kit/harness';
import { FANSLY_SITE_TEXTS } from '../kit/profiles';
import { ctxOf, entry, recapView, views } from '../scenarios/app-client';
import { mountBoardSettled, textOf, type MountedBoard } from './harness';
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

it('[host:fansly] [FS-TAIL-8] the fan panel’s Recap tab reuses the result mark and its «Ещё раз»', async () => {
  const base = boardScenario('14b');
  const recap = recapView(ctxOf({ lang: 'ru', platform: 'mac' }), views.ready(), 'short', { stale: { reason: 'window-miss', at: null } });
  const scenario = { ...base, views: [...base.views.filter((view) => view.selector.of !== 'recap.view'), entry({ of: 'recap.view' }, recap)] };
  const marked = await mountKitSettled(FanPanel, { scenario, kind: 'fan-panel', styles: [FAN_PANEL_STYLES], site: { phrases: FANSLY_PHRASES, texts: FANSLY_SITE_TEXTS } });
  try {
    const plate = marked.$('.cg-fp .cg-stale') as HTMLElement;
    expect([plate.getAttribute('role'), textOf(plate.querySelector('.cg-stale__t')), plate.querySelector('.cg-dot--accent')?.getAttribute('data-accent-use')]).toEqual(['status', 'Ответ мог не учесть последние сообщения чата.', 'result-stale']);
    await flush(() => (plate.querySelector('button') as HTMLElement).click());
    expect(marked.client.dispatched).toEqual([{ type: 'RefreshRecap', length: 'short', panel: true }]);
    const css = marked.root.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join('\n');
    expect(css).toMatch(/\.cg-stale \{[^}]*display: grid/);
  } finally {
    marked.unmount();
  }
});
