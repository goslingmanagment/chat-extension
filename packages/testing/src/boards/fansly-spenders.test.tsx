// R20 P9e: Fansly’s board keeps the list and the preview, without statistics or a preview send.
import { afterEach, describe, expect, it } from 'vitest';
import type { PreviewVM, PreviewSendView } from '@cg/contracts/vm';
import { ctxOf, entry, preview, stats, views, withResult, uuid, type AppClientScenario } from '../scenarios/app-client';
import { BOARD_FANS } from './data';
import { flush, keydown, mountBoardSettled, textOf, type MountedBoard } from './harness';
import { boardOf, boardScenario, sendResult } from './states';

let ui: MountedBoard | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const ctx = ctxOf({ lang: 'ru', platform: 'mac' });
const OP = uuid(701);
const part = (index: number): HTMLElement => ui?.$(`.cg-pvp[data-cg-part="${index}"]`) as HTMLElement;
const buttons = (index: number): string[] => [...part(index).querySelectorAll('button')].map((button) => button.getAttribute('aria-label') ?? textOf(button));
const sends = () => (ui?.actions() ?? []).filter((action) => action.type === 'SendPart');
function previewOf(states: readonly PreviewSendView[]): AppClientScenario {
  const base = boardScenario('11a');
  const vm = withResult(preview(ctx, 'spenders', views.ready()), sendResult(ctx, OP, 'reply', ['first part'], states, []));
  return { ...base, views: [...base.views.filter((view) => view.selector.of !== 'preview'), entry({ of: 'preview', from: 'spenders' }, vm)] };
}
function boardOnly(vm: ReturnType<typeof boardOf>, statsVm = stats(ctx, views.ready())) {
  return { ...boardScenario('board-list'), views: [entry({ of: 'spenders.board' }, vm), entry({ of: 'spenders.stats' }, statsVm)] };
}

describe('[host:fansly] Spenders preview without sending', () => {
  it('[SP-054] [HK-042] only «Открыть и вставить» and Copy; Enter inserts, no send button or action', async () => {
    const scenario = previewOf([{ s: 'available' }]);
    const noSend = { ...scenario, views: scenario.views.map((view) => {
      if (view.selector.of !== 'preview') return view;
      const vm = view.vm as PreviewVM;
      if (vm.result === null) return view;
      return entry({ of: 'preview', from: 'spenders' }, { ...vm, result: { ...vm.result, parts: (vm.result.parts ?? []).map(({ send: _send, ...part }) => part) } });
    }) };
    ui = await mountBoardSettled('spenders', noSend);
    expect(buttons(0)).toEqual(['Открыть и вставить', 'Копировать часть 1']);
    expect(ui.$('.cg-pvs__send')).toBeNull();
    await flush(() => keydown(part(0), 'Enter'));
    expect(ui.actions().at(-1)).toMatchObject({ type: 'OpenAndInsertPart', operationId: OP, part: 0 });
    expect(sends()).toEqual([]);
  });
});

describe('Spenders without statistics', () => {
  it('[FS-SPD-1] no statistics column or S action when statistics are outside the pilot', async () => {
    ui = await mountBoardSettled('spenders', boardOnly({ ...boardOf(ctx, BOARD_FANS), statistics: false }, { ...stats(ctx, views.ready()), expanded: true }));
    expect(ui.$('.cg-st')).toBeNull();
    expect(ui.$('.cg-stx')).toBeNull();
    expect(ui.$('.cg-sp__cols')?.classList.contains('no-stats')).toBe(true);
    await flush(() => keydown(ui?.$('[role="dialog"]') as HTMLElement, 's'));
    expect(ui.actions().filter((action) => action.type === 'SetStatsExpanded')).toEqual([]);
    // «Обновить» of the header reads the list alone: there is no statistics column to read again.
    await flush(() => (ui?.$('.cg-sp__top .cg-sp__refresh button') as HTMLElement).click());
    expect(ui.actionsOf('ReloadView')).toEqual([{ type: 'ReloadView', selector: { of: 'spenders.board' } }]);
  });

});
