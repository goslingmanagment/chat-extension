// Recap and Review in the dock sheet (ui-design §4.11, §10, §12 п. 6; AI-050…
// AI-054, AI-060…AI-071): a lazy part of the dock. Neither is a message to the
// fan: nothing here inserts, and Recap never generates from the strip.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { type ResultDebugVM } from '@cg/contracts';
import { DEFAULT_PARTS, preloadPart, type DockParts } from '@cg/ui/dock';
import { ANALYSIS_STYLE } from '@cg/ui/dock/analysis';

import { cgError, entry, handles, FANS, msg, phase, reason, recapPicker, recapView, review, uuid, views } from '../scenarios/app-client';
import { type MountedKit, ctx, dockScenario, dockVm, flush, keydown, mountDock, mountDockSettled, settle, text } from './harness';

let kit: MountedKit | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
});
beforeAll(async () => {
  await Promise.all([preloadPart(DEFAULT_PARTS.analysis), preloadPart(DEFAULT_PARTS.debug)]);
});

const recapDock = () => dockVm('ready', { analysis: 'recap', actionsOptions: { active: 'recap' }, options: { ...dockVm().options, splitReason: reason('not-a-message') } });
const reviewDock = () => dockVm('ready', { analysis: 'review', actionsOptions: { active: 'review' } });
const byLabel = (label: string): HTMLElement => {
  const found = kit?.$$('.cg-sheet button').find((element) => element.querySelector('.cg-btn__t')?.textContent === label || element.getAttribute('aria-label') === label || element.textContent === label);
  if (found === undefined) throw new Error(`no button «${label}»`);
  return found;
};
const facts = (): string[] => kit?.$$('.cg-facts .cg-fact').map(text) ?? [];

describe('the analysis part is lazy', () => {
  it('the dock asks for its chunk on first use and shows a head with a spinner meanwhile; its sheet is adopted then', async () => {
    let load: (() => void) | null = null;
    let asked = 0;
    const parts: Partial<DockParts> = {
      analysis: () => {
        asked += 1;
        return new Promise((resolve) => {
          load = () => void DEFAULT_PARTS.analysis().then(resolve);
        });
      },
    };
    kit = await mountDockSettled('recap-short', { parts });
    expect(asked).toBe(1);
    expect(text(kit.$('.cg-head__title'))).toBe('Recap');
    expect(kit.$('.cg-head .cg-spin')).not.toBeNull();
    expect(kit.$('.cg-prose')).toBeNull();
    const before = kit.root.adoptedStyleSheets.length;
    (load as (() => void) | null)?.();
    await settle(2);
    expect(kit.$('.cg-prose')).not.toBeNull();
    expect(kit.root.adoptedStyleSheets.length).toBe(before + 1);
    expect(ANALYSIS_STYLE.id).toBe('cg-dock-analysis');
    // A draft result never loads it.
    kit.unmount();
    asked = 0;
    kit = await mountDockSettled('gallery-ready', { parts });
    expect(asked).toBe(0);
  });

  it('a chunk that fails to load shows «Сбой интерфейса» in the sheet and leaves the strip working (ER-020)', async () => {
    const parts: Partial<DockParts> = { analysis: () => Promise.reject(new TypeError('chunk')) };
    kit = await mountDockSettled('recap-short', { parts });
    await settle(2);
    expect(text(kit.$('.cg-sheet .cg-card__code'))).toBe('ChatGoose · CG-UI-FAILED');
    expect(kit.$('.cg-strip')).not.toBeNull();
    expect(kit.failures).toEqual([{ kind: 'render', surface: 'dock', code: 'CG-UI-FAILED', name: 'TypeError' }]);
  });
});

describe('Recap', () => {
  it('[AI-069] [AI-063] short: one paragraph, «Коротко | Полностью», «для Hubert», Copy, «Обновить ⌘⇧S», «Скрыть Esc», the facts', async () => {
    kit = mountDock('recap-short');
    await settle(1);
    expect(text(kit.$('.cg-head__title'))).toBe('Recap');
    const segment = kit.$('.cg-seg') as HTMLElement;
    expect(segment.getAttribute('role')).toBe('group');
    expect(segment.getAttribute('aria-label')).toBe('Длина');
    expect([...segment.querySelectorAll('button')].map((element) => [text(element), element.getAttribute('aria-pressed')])).toEqual([
      ['Коротко', 'true'],
      ['Полностью', 'false'],
    ]);
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['для Hubert']);
    expect(text(kit.$('.cg-prose'))).toContain('Hubert, 34, Warsaw.');
    expect(kit.$('.cg-blocks')).toBeNull();
    expect(facts()).toEqual(['Сделан 1 д назад', 'архив полный']);
    // No Insert, no parts: a Recap is not a message to the fan.
    expect(kit.$$('.cg-part')).toEqual([]);
    expect(kit.$('[data-cg-draft]')).toBeNull();
    expect(kit.$('.cg-expand')).toBeNull();
  });

  it('[AI-062] [AI-067] [AI-070] full: blocks by heading, «✓ сохранено в хаб», and the accent dot «архив отстаёт от чата на 2 сообщения»', async () => {
    kit = mountDock('recap-full');
    await settle(1);
    expect(kit.$$('.cg-block > b').map(text)).toEqual(['Кто он', 'Что любит', 'Покупки', 'Чего избегать', 'Сейчас']);
    // Markdown is rendered through the safe AST: «**$12,480**» is a <strong>, never markup from the text.
    expect(kit.$('.cg-block strong')?.textContent).toBe('$12,480');
    expect(facts()).toEqual(['Сделан 1 д назад', 'сохранено в хаб', 'охват неполный', 'архив отстаёт от чата на 2 сообщения']);
    const lag = kit.$('.cg-fact.is-strong') as HTMLElement;
    expect(lag.querySelector('.cg-dot--accent')?.getAttribute('data-accent-use')).toBe('archive-lag');
  });

  it('[AI-068] a failed save keeps the text and offers a retry of the reference write only — never a new generation', async () => {
    kit = mountDock('recap-full');
    await flush(() => kit?.client.goTo(0));
    await settle(1);
    expect(kit.$$('.cg-block')).toHaveLength(5);
    expect(text(kit.$('.cg-fact__code'))).toBe('ChatGoose · CG-RECAP-SAVE:');
    expect(kit.$('.cg-facts .cg-dot--danger')).not.toBeNull();
    await flush(() => (kit?.$('.cg-fact__btn') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'RetryRecapSave', length: 'full' }]);
  });

  it('[AI-064] [AI-065] what each control asks for: a saved length, a fresh build, the whole text, hide, expand', async () => {
    kit = mountDock('recap-full');
    await settle(1);
    await flush(() => byLabel('Коротко').click());
    await flush(() => byLabel('Обновить').click());
    await flush(() => byLabel('Копировать Recap').click());
    await flush(() => byLabel('Развернуть').click());
    await flush(() => byLabel('Скрыть').click());
    expect(kit.client.dispatched).toEqual([
      { type: 'ShowRecap', length: 'short' },
      { type: 'RefreshRecap', length: 'full' },
      { type: 'Copy', artifactHandle: handles.artifact('recap', 1) },
      { type: 'ShowAnalysis', view: 'recap', mode: 'expanded' },
      { type: 'ShowAnalysis', view: 'recap', mode: 'hidden' },
    ]);
    // Esc inside the sheet hides it too.
    await flush(() => (kit?.$('.cg-sheet') as HTMLElement).dispatchEvent(keydown('Escape')));
    expect(kit.client.dispatched[5]).toEqual({ type: 'ShowAnalysis', view: 'recap', mode: 'hidden' });
    expect(byLabel('Обновить').querySelector('kbd')?.textContent).toBe('⌘⇧S');
  });

  it('[AI-060] nothing saved: the picker offers to build the short or the full one; Enter builds the full one; nothing is generated by showing it', async () => {
    const scenario = dockScenario(recapDock(), {}, [
      entry({ of: 'recap.view' }, recapView(ctx, views.empty(msg('cg.recapNotFound.title')), 'short')),
      entry({ of: 'recap.picker' }, recapPicker(ctx, views.empty(msg('cg.recapNotFound.body')))),
    ]);
    kit = mountDock(scenario);
    await settle(1);
    expect(kit.client.dispatched).toEqual([]);
    const picker = kit.$('.cg-pick') as HTMLElement;
    expect(text(picker.querySelector('.cg-pick__note'))).toBe('Recap ещё не сделан');
    expect([...picker.querySelectorAll('.cg-pick__acts button')].map((element) => text(element.querySelector('.cg-btn__t')))).toEqual(['Коротко', 'Полностью']);
    expect(picker.querySelector('.cg-pick__acts button:last-child kbd')?.textContent).toBe('↵');
    picker.focus();
    await flush(() => picker.dispatchEvent(keydown('Enter')));
    // A held Enter builds one Recap, not one per repeat.
    await flush(() => picker.dispatchEvent(keydown('Enter', { repeat: true })));
    await flush(() => (picker.querySelector('.cg-pick__acts button') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([
      { type: 'Generate', targetHandle: handles.dock(FANS.hubert), feature: 'recap', options: {} },
      { type: 'Generate', targetHandle: handles.dock(FANS.hubert), feature: 'recap-short', options: {} },
    ]);
  });

  it('[AI-061] [AI-065] «Проверяю…» while the hub is asked; then what is saved with «Открыть последний»', async () => {
    const empty = recapView(ctx, views.empty(msg('common.empty')), 'short');
    kit = mountDock(dockScenario(recapDock(), {}, [entry({ of: 'recap.view' }, empty), entry({ of: 'recap.picker' }, recapPicker(ctx, views.loading(ctx.now, msg('common.loading'))))]));
    await settle(1);
    expect(kit.$('.cg-state--loading')?.getAttribute('aria-busy')).toBe('true');
    kit.unmount();
    kit = mountDock(dockScenario(recapDock(), {}, [entry({ of: 'recap.view' }, empty), entry({ of: 'recap.picker' }, recapPicker(ctx, views.ready()))]));
    await settle(1);
    const slots = kit.$$('.cg-pick__slot');
    expect(slots.map((slot) => text(slot.querySelector('.cg-pick__name')))).toEqual(['Коротко', 'Полностью']);
    // With something saved nothing says «пусто».
    expect(kit.$('.cg-pick__note')).toBeNull();
    await flush(() => (slots[1]?.querySelector('button') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'ShowRecap', length: 'full' }]);
  });

  it('a Recap being built shows the stage line, «Отменить ⌘.» and the preliminary text as plain text', async () => {
    kit = mountDock('recap-generating');
    await settle(1);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(kit.$$('.cg-stage').map(text)).toEqual(['Читаю переписку', 'Пишет ответ…']);
    expect(kit.$('[data-cg-stream]')?.textContent).toBe('## Кто он\nHubert, 34');
    expect(kit.$('.cg-md')).toBeNull();
    await flush(() => (kit?.$('.cg-cancel') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'CancelGeneration', operationId: uuid(601) }]);
  });

  it('a failed Recap read is an error card with its own retry, never an empty sheet', async () => {
    kit = mountDock(dockScenario(recapDock(), {}, [entry({ of: 'recap.view' }, recapView(ctx, views.error(cgError(ctx, 'CG-PROVIDER-STREAM'), { type: 'ReloadView', selector: { of: 'recap.view' } }), 'full'))]));
    await settle(1);
    expect(text(kit.$('.cg-card__code'))).toBe('ChatGoose · CG-PROVIDER-STREAM');
  });
});

describe('Review', () => {
  it('[AI-053] the N/10 score, the window it looked at, and the blocks of the hub\'s format with «Как надо было»', async () => {
    kit = mountDock('review');
    await settle(1);
    expect(text(kit.$('.cg-head__title'))).toBe('Review');
    expect(text(kit.$('.cg-head__score'))).toBe('7/10');
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['последние 40 сообщений с Hubert']);
    expect(kit.$$('.cg-block').map((block) => block.getAttribute('data-cg-section'))).toEqual(['verdict', 'money', 'persona', 'mistakes', 'recommendations']);
    expect(kit.$$('.cg-block > b').map(text)).toEqual(['Вердикт', 'Деньги', 'Персона', 'Ошибки', 'Рекомендации']);
    const example = kit.$('.cg-rv-ex') as HTMLElement;
    expect(text(example.querySelector('.cg-cap'))).toBe('Как надо было · after "[Photo]"');
    expect(text(example.querySelector('.cg-rv-ex__t'))).toBe('Missed you today — want to see what I saved for you?');
    // An example is shown, never inserted.
    expect(kit.$$('.cg-sheet .cg-ins')).toEqual([]);
    expect(facts()).toEqual(['Сделан только что', 'архив на 06:18']);
  });

  it('[AI-054] Copy writes the whole Review; «Ещё раз ⌘⇧B» asks for a new one; hide and expand name the view, not an operation', async () => {
    kit = mountDock('review');
    await settle(1);
    await flush(() => byLabel('Копировать Review').click());
    await flush(() => byLabel('Ещё раз').click());
    await flush(() => byLabel('Развернуть').click());
    await flush(() => byLabel('Скрыть').click());
    expect(kit.client.dispatched).toEqual([
      { type: 'Copy', artifactHandle: handles.artifact('review', 1) },
      { type: 'Generate', targetHandle: handles.dock(FANS.hubert), feature: 'review', options: {} },
      { type: 'ShowAnalysis', view: 'review', mode: 'expanded' },
      { type: 'ShowAnalysis', view: 'review', mode: 'hidden' },
    ]);
    expect(byLabel('Ещё раз').querySelector('kbd')?.textContent).toBe('⌘⇧B');
  });

  it('[AI-052] a Review that did not parse shows the raw text as it is', async () => {
    kit = mountDock(dockScenario(reviewDock(), {}, [entry({ of: 'review' }, review(ctx, views.ready(), { unparsed: true, sections: [], rating: null, raw: 'Rating: ?\n<verdict>broken' }))]));
    await settle(1);
    expect(kit.$('.cg-raw')?.textContent).toBe('Rating: ?\n<verdict>broken');
    expect(kit.$('.cg-head__score')).toBeNull();
    expect(kit.$('.cg-blocks')).toBeNull();
  });

  it('[AI-051] too little history is the card with its reason, not an empty Review', async () => {
    kit = mountDock(dockScenario(reviewDock(), {}, [entry({ of: 'review' }, review(ctx, views.error(cgError(ctx, 'CG-GATE-HISTORY'), null)))]));
    await settle(1);
    expect(text(kit.$('.cg-card__code'))).toBe('ChatGoose · CG-GATE-HISTORY');
    expect(kit.$$('.cg-head__meta').map(text)).toEqual(['не выполнен']);
  });

  it('a Review being written streams as plain text under its stage line', async () => {
    const running = review(ctx, views.loading(ctx.now, null), { opId: uuid(301), state: 'streaming', phase: phase(uuid(301), ctx.now - 2_000, ['context'], 'writing'), streamText: 'Warm and', sections: [], raw: null });
    kit = mountDock(dockScenario(dockVm('ready', { analysis: 'review', actionsOptions: { busy: 'review' } }), {}, [entry({ of: 'review' }, running)]));
    await settle(1);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(text(kit.$('[data-cg-stream]'))).toBe('Warm and');
    expect(kit.$('.cg-body')?.getAttribute('aria-busy')).toBe('true');
  });
});

describe('debug under Recap and Review', () => {
  const DEBUG: ResultDebugVM = {
    costLine: 'in 9 120 tok • out 640 tok • $0.0312 • 6.2 s • model-test',
    stages: [
      { name: 'request', ms: 41 },
      { name: 'stream', ms: 6_100 },
    ],
    totalMs: 6_141,
    hubStages: [{ name: 'context', ms: 210 }],
    prompt: { type: 'Navigate', to: { kind: 'debug-prompt', promptHandle: 'snap-2' } },
    reasoning: null,
    context: null,
    liveTimer: false,
  };
  const legend = (): string[] => kit?.$$('.cg-debug .cg-prof__legend:not(.cg-prof__legend--hub) span').map(text) ?? [];

  it('[UI-030] [DB-007] in debug mode a Recap carries the cost line, «Промпт» and the stage profile under its facts; without `debug` nothing of it shows', async () => {
    kit = mountDock(dockScenario(recapDock(), {}, [entry({ of: 'recap.view' }, recapView(ctx, views.ready(), 'full', { debug: DEBUG }))]));
    await settle(2);
    const foot = kit.$('.cg-debug') as HTMLElement;
    expect(text(foot.querySelector('.cg-debug__line span'))).toBe(DEBUG.costLine);
    expect(legend()).toEqual(['запрос 41', 'поток 6 100', 'мс, всего 6,14 с']);
    // The footer of the sheet: under the facts row.
    expect(kit.$('.cg-facts')?.nextElementSibling).toBe(foot);
    await flush(() => (foot.querySelector('.cg-debug__link') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'Navigate', to: { kind: 'debug-prompt', promptHandle: 'snap-2' } }]);
    kit.unmount();
    // Outside debug mode the controller sends no `debug`: no cost, no counters, anywhere.
    kit = mountDock('recap-full');
    await settle(2);
    expect(kit.$('.cg-debug')).toBeNull();
    expect(kit.$('.cg-dock')?.textContent).not.toMatch(/\btok\b|\$0\./);
  });

  it('[UI-030] [DB-013] a Review carries it too — under its facts, and under the card when it failed', async () => {
    kit = mountDock(dockScenario(reviewDock(), {}, [entry({ of: 'review' }, review(ctx, views.ready(), { debug: DEBUG }))]));
    await settle(2);
    expect(text(kit.$('.cg-debug .cg-debug__line span'))).toBe(DEBUG.costLine);
    expect(kit.$('.cg-facts')?.nextElementSibling).toBe(kit.$('.cg-debug'));
    kit.unmount();
    const failed = review(ctx, views.error(cgError(ctx, 'CG-PROVIDER-STREAM'), null), { debug: { ...DEBUG, costLine: null, prompt: null, stages: [{ name: 'request', ms: 41 }], totalMs: 41 } });
    kit = mountDock(dockScenario(reviewDock(), {}, [entry({ of: 'review' }, failed)]));
    await settle(2);
    expect(text(kit.$('.cg-card__code'))).toBe('ChatGoose · CG-PROVIDER-STREAM');
    // The stages it got through, and no cost line the controller did not send.
    expect(legend()).toEqual(['запрос 41', 'мс, всего 0,04 с']);
    expect(kit.$('.cg-debug__line')).toBeNull();
  });

  it('[DB-012] a Recap being built shows the profile under the preliminary text', async () => {
    const building = recapView(ctx, views.loading(ctx.now - 2_000, msg('result.stage.context')), 'full', {
      opId: uuid(601),
      state: 'streaming',
      phase: phase(uuid(601), ctx.now - 2_000, ['context'], 'writing'),
      streamText: '## Кто он',
      debug: { ...DEBUG, costLine: null, prompt: null, stages: [], totalMs: null, hubStages: [], liveTimer: true },
    });
    kit = mountDock(dockScenario(dockVm('ready', { analysis: 'recap', actionsOptions: { busy: 'recap' } }), {}, [entry({ of: 'recap.view' }, building)]));
    await settle(2);
    expect(kit.$('.cg-body')?.getAttribute('aria-busy')).toBe('true');
    expect(text(kit.$('.cg-debug [data-cg-total]'))).toBe('мс, всего 2,00 с');
  });
});
