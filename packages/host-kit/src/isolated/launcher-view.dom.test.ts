import { describe, expect, it } from 'vitest';

import { createSiteLauncher } from './launcher';
import { drawLauncher } from './launcher-view';

const page = { current: () => ({ scheme: 'light' as const }), onChange: () => () => undefined } as unknown as Parameters<typeof createSiteLauncher>[0];

function draw(look: 'rows' | 'icons') {
  const host = document.createElement('div');
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const launcher = createSiteLauncher(page);
  drawLauncher({ host: { host, root }, launcher, tokens: '', platform: 'MacIntel', look });
  const report = (): HTMLButtonElement => root.querySelector('button[data-launcher="report"]') as HTMLButtonElement;
  const customs = (): HTMLButtonElement => root.querySelector('button[data-launcher="customs"]') as HTMLButtonElement;
  const shown = (): number => [...root.querySelectorAll('button[data-launcher]')].filter((button) => !(button as HTMLButtonElement).hidden).length;
  return { launcher, report, customs, shown };
}

describe('the launcher\'s fifth row «Отчёт»: only for a person whose pulse has a board', () => {
  it('is not drawn while the pulse says report: null, on both looks; «Кастомы» is, last, for everyone', () => {
    for (const look of ['rows', 'icons'] as const) {
      const { report, customs, shown } = draw(look);
      expect(report().hidden).toBe(true);
      expect(customs().hidden).toBe(false);
      expect(customs().nextElementSibling).toBeNull();
      expect(shown()).toBe(5);
    }
  });

  it('comes with the board, carries the dot while it waits for the person, and goes again with null', () => {
    const { launcher, report, customs, shown } = draw('rows');
    launcher.setReport({ needsMe: false });
    expect(report().hidden).toBe(false);
    expect(shown()).toBe(6);
    expect(report().querySelector('.mark')).toBeNull();
    launcher.setReport({ needsMe: true });
    expect(report().querySelector('.mark')).not.toBeNull();
    launcher.setReport(null);
    expect(report().hidden).toBe(true);
    expect(customs().hidden).toBe(false);
    expect(shown()).toBe(5);
  });
});
