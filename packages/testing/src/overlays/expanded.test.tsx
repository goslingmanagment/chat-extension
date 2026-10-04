// «Развернуть ↗» (ui-design §10; UI-014, UI-015, UI-017): the result of the
// open chat in a window without the sheet's height limit.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_PARTS, preloadPart } from '@cg/ui/dock';
import { DISMISSIBLE_OPEN_ATTRIBUTE } from '@cg/ui/kit';
import { LAZY_OVERLAY_KINDS, lazyOverlays, overlayRootCss } from '@cg/ui/overlays';
import { createExpandedSurface, expandedSurface } from '@cg/ui/overlays/result-expanded';

import { coach, dock, entry, meta, parts, phase, recapView, result, review, scenarioById, uuid, views } from '../scenarios/app-client';
import { type MountedKit, ctx, flush, keydown, mountSurface, scenarioOf, settle, text } from '../dock/harness';

let kit: MountedKit | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
});
beforeAll(async () => {
  await Promise.all([preloadPart(DEFAULT_PARTS.analysis), preloadPart(DEFAULT_PARTS.debug)]);
});

const mount = (scenario: Parameters<typeof mountSurface>[1]): MountedKit => mountSurface(expandedSurface.view, scenario, 'result-expanded', expandedSurface.styles ?? []);
const recapDock = entry({ of: 'dock' }, dock(ctx, 'ready', { analysis: 'recap' }));

describe('the expanded result', () => {
  it('[UI-015] shows nothing until a view model says `expanded`', async () => {
    kit = mount(scenarioById('recap-full'));
    await settle(1);
    expect(kit.$('[role="dialog"]')).toBeNull();
    expect(kit.$('.cg-scrim')).toBeNull();
    expect(kit.host.hasAttribute(DISMISSIBLE_OPEN_ATTRIBUTE)).toBe(false);
  });

  it('[UI-014] [UI-017] a full Recap opens in a modal window with a scrim; «Свернуть Esc» and a press on the scrim return it to the sheet', async () => {
    kit = mount(scenarioOf([recapDock, entry({ of: 'recap.view' }, recapView(ctx, views.ready(), 'full', { expanded: true }))]));
    await settle(1);
    const dialog = kit.$('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Результат ChatGoose: Recap');
    expect(dialog.classList.contains('cg-dialog--wide')).toBe(true);
    expect(kit.host.hasAttribute(DISMISSIBLE_OPEN_ATTRIBUTE)).toBe(true);
    expect(dialog.querySelectorAll('.cg-block')).toHaveLength(5);
    // The window has «Свернуть», not «Скрыть», and no second «Развернуть».
    expect(dialog.querySelector('.cg-hide')).toBeNull();
    expect(dialog.querySelector('.cg-expand')).toBeNull();
    const collapse = dialog.querySelector('.cg-collapse') as HTMLElement;
    expect(text(collapse.querySelector('.cg-btn__t'))).toBe('Свернуть');
    // The window takes focus on «Свернуть» and keeps it inside.
    expect(kit.root.activeElement).toBe(collapse);
    await flush(() => collapse.click());
    await flush(() => dialog.dispatchEvent(keydown('Escape')));
    await flush(() => (kit?.$('.cg-scrim') as HTMLElement).dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(kit.client.dispatched).toEqual(Array(3).fill({ type: 'ShowAnalysis', view: 'recap', mode: 'sheet' }));
  });

  it('[UI-014] a Review expands the same way', async () => {
    kit = mount(scenarioOf([entry({ of: 'dock' }, dock(ctx, 'ready', { analysis: 'review' })), entry({ of: 'review' }, review(ctx, views.ready(), { expanded: true }))]));
    await settle(1);
    const dialog = kit.$('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-label')).toBe('Результат ChatGoose: Review');
    expect(text(dialog.querySelector('.cg-head__score'))).toBe('7/10');
    await flush(() => (dialog.querySelector('.cg-collapse') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'ShowAnalysis', view: 'review', mode: 'sheet' }]);
  });

  it('[UI-014] [DB-020] a draft result expands with its parts, still inserted one at a time, and its debug footer', async () => {
    kit = mount(scenarioById('debug-on'));
    await settle(1);
    const dialog = kit.$('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-label')).toBe('Результат ChatGoose: Reply');
    expect(dialog.querySelectorAll('.cg-part')).toHaveLength(3);
    expect(dialog.querySelector('.cg-debug')).not.toBeNull();
    expect(dialog.querySelector('.cg-keys')).toBeNull();
    await flush(() => (dialog.querySelector('.cg-ins') as HTMLElement).click());
    await flush(() => (dialog.querySelector('.cg-collapse') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([
      { type: 'InsertPart', operationId: uuid(101), part: 0 },
      { type: 'ExpandResult', operationId: uuid(101), expanded: false },
    ]);
  });

  it('[UI-030] [DB-020] an expanded Recap in debug mode carries its debug footer; outside debug mode it has none', async () => {
    const debug = { costLine: 'in 9 120 tok • out 640 tok', stages: [{ name: 'request', ms: 41 }], totalMs: 41, hubStages: [], prompt: null, reasoning: null, context: null, liveTimer: false };
    kit = mount(scenarioOf([recapDock, entry({ of: 'recap.view' }, recapView(ctx, views.ready(), 'full', { expanded: true, debug }))]));
    await settle(2);
    expect(text(kit.$('[role="dialog"] .cg-debug .cg-debug__line span'))).toBe('in 9 120 tok • out 640 tok');
    kit.unmount();
    kit = mount(scenarioOf([recapDock, entry({ of: 'recap.view' }, recapView(ctx, views.ready(), 'full', { expanded: true }))]));
    await settle(2);
    expect(kit.$('.cg-debug')).toBeNull();
  });

  it('the window stays quiet: the dock sheet already says the stages and the readiness of the same operation', async () => {
    const op = uuid(101);
    const writing = result(ctx, { opId: op, feature: 'reply', state: 'streaming', phase: phase(op, ctx.now, ['context'], 'writing'), streamText: 'one', expanded: true });
    const done = result(ctx, { opId: op, feature: 'reply', state: 'done', parts: parts(op, ['one', 'two']), meta: [meta.parts(2)], expanded: true });
    kit = mount(scenarioOf([entry({ of: 'dock' }, dock(ctx, 'ready', { result: writing }))], { steps: [{ label: 'done', at: 10, views: [entry({ of: 'dock' }, dock(ctx, 'ready', { result: done }))] }] }));
    await settle(1);
    expect(kit.$('[role="dialog"] [data-cg-stream]')).not.toBeNull();
    expect(text(kit.$('[data-cg-live]'))).toBe('');
    await flush(() => kit?.client.goTo(0));
    await settle(1);
    expect(kit.$$('[role="dialog"] .cg-part')).toHaveLength(2);
    expect(text(kit.$('[data-cg-live]'))).toBe('');
  });

  it('a result that is not expanded stays in the dock only', async () => {
    const plain = result(ctx, { opId: uuid(101), feature: 'reply', state: 'done', parts: parts(uuid(101), ['one']), meta: [meta.single()] });
    kit = mount(scenarioOf([entry({ of: 'dock' }, dock(ctx, 'ready', { result: plain }))]));
    await settle(1);
    expect(kit.$('[role="dialog"]')).toBeNull();
  });
});

describe('lazy overlays', () => {
  it('[UI-024] each lazy overlay is a surface whose root spans the window on its layer and lets presses through to the chat', async () => {
    expect(LAZY_OVERLAY_KINDS).toEqual(['coach', 'cheatsheet', 'result-expanded']);
    for (const kind of LAZY_OVERLAY_KINDS) {
      const surface = await lazyOverlays[kind]();
      expect(typeof surface.view, kind).toBe('function');
      const css = (surface.styles ?? []).map((source) => source.css).join('\n');
      // The overlay root spans the window on its layer and lets clicks through (ui-design §3.4).
      expect(css, kind).toContain(`.cg-root[data-cg-surface="${kind}"] { position: fixed; inset: 0; z-index: ${kind === 'coach' ? 900 : 950}; pointer-events: none; }`);
      // A surface that failed to render is a card at the top right that takes clicks (ER-020).
      expect(css, kind).toMatch(new RegExp(`\\.cg-root\\[data-cg-surface="${kind}"\\] > \\.cg-boundary \\{ position: fixed; top: 56px; right: 16px; [^}]*pointer-events: auto;`));
    }
    expect(overlayRootCss('toasts', 'toast')).toContain('.cg-root[data-cg-surface="toasts"] > .cg-boundary { position: fixed;');
  });

  it('[ER-020] an overlay that fails to render shows «Сбой интерфейса» in place of the whole surface, with both buttons working', async () => {
    const coachSurface = await lazyOverlays.coach();
    // A view model the surface cannot draw: the turns are missing.
    const broken = { ...coach(ctx, views.ready(), []), turns: null } as unknown as ReturnType<typeof coach>;
    kit = mountSurface(coachSurface.view, scenarioOf([entry({ of: 'dock' }, dock(ctx, 'ready')), entry({ of: 'coach' }, broken)]), 'coach', coachSurface.styles ?? []);
    await settle(1);
    const card = kit.$('.cg-boundary') as HTMLElement;
    // The card replaced the layer: it is the root's own child, which is what the clickable rule is written for.
    expect(card.parentElement?.classList.contains('cg-root')).toBe(true);
    expect(card.parentElement?.getAttribute('data-cg-surface')).toBe('coach');
    expect(kit.$('.cg-layer')).toBeNull();
    expect(text(card.querySelector('.cg-card__code'))).toBe('ChatGoose · CG-UI-FAILED');
    const buttons = [...card.querySelectorAll('button')];
    expect(buttons.map((element) => text(element.querySelector('.cg-btn__t')))).toEqual(['Перезагрузить панель', 'Выгрузить диагностику', 'Скопировать код']);
    await flush(() => buttons[1]?.click());
    await flush(() => buttons[0]?.click());
    expect(kit.client.dispatched).toEqual([{ type: 'ExportDiagnostics' }, { type: 'ReloadSurface', surface: 'coach' }]);
    expect(kit.failures[0]).toEqual({ kind: 'render', surface: 'coach', code: 'CG-UI-FAILED', name: 'TypeError' });
  });

  it('[ER-020] a part of the window whose chunk fails to load shows its card inside the window; the window stays and collapses', async () => {
    kit = mountSurface(
      createExpandedSurface({ parts: { analysis: () => Promise.reject(new TypeError('chunk')) } }).view,
      scenarioOf([recapDock, entry({ of: 'recap.view' }, recapView(ctx, views.ready(), 'full', { expanded: true }))]),
      'result-expanded',
      expandedSurface.styles ?? [],
    );
    await settle(2);
    const dialog = kit.$('[role="dialog"]') as HTMLElement;
    expect(text(dialog.querySelector('.cg-boundary .cg-card__code'))).toBe('ChatGoose · CG-UI-FAILED');
    expect(kit.$('.cg-layer')).not.toBeNull();
    await flush(() => dialog.dispatchEvent(keydown('Escape')));
    expect(kit.client.dispatched).toEqual([{ type: 'ShowAnalysis', view: 'recap', mode: 'sheet' }]);
  });
});
