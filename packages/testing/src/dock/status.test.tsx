// Status banners of the dock (ui-design §4.10, §8.1; UI-011, UI-013, UI-027):
// one row above the strip — whose error, **title.** explanation, one line
// button — for every DockVM.status that has one, the card for «расширение
// обновилось», and words only while the chat loads.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { CG_CODES, DOCK_STATUSES, type DockStatus, type DockVM, type UiAction } from '@cg/contracts';
import { DEFAULT_PARTS, errorToneOf, preloadPart, toneOf } from '@cg/ui/dock';

import { cgError, failedResult, scenarioById, uuid } from '../scenarios/app-client';
import { type MountedKit, ctx, dockScenario, dockVm, flush, mountDock, settle, text } from './harness';

let kit: MountedKit | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
});
beforeAll(async () => {
  await preloadPart(DEFAULT_PARTS.analysis);
});

const banner = (): HTMLElement | null => kit?.$('.cg-banner') ?? null;
const bannerButton = (): HTMLElement | null => kit?.$('.cg-banner > .cg-btn') ?? null;

interface Expected {
  readonly code: string | null;
  readonly dot: 'ring' | 'danger' | null;
  readonly text: string | null;
  readonly button: string | null;
  readonly action: UiAction | null;
  readonly mode: 'insert' | 'copy-only';
}

const EXPECTED: Record<Exclude<DockStatus, 'reload-needed'>, Expected> = {
  ready: { code: null, dot: null, text: null, button: null, action: null, mode: 'insert' },
  'loading-chat': { code: null, dot: null, text: null, button: null, action: null, mode: 'insert' },
  'not-signed-in': {
    code: 'CG-AUTH-REQUIRED',
    dot: 'ring',
    text: 'ChatGoose · CG-AUTH-REQUIRED Нужно войти. Войдите в ChatGoose через значок расширения.',
    button: 'Войти',
    action: { type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } },
    mode: 'insert',
  },
  'no-binding': {
    code: 'CG-BINDING-MISSING',
    dot: 'ring',
    text: 'ChatGoose · CG-BINDING-MISSING Аккаунт не привязан. Этот аккаунт OnlyMonster не привязан к странице в хабе. Напишите тимлиду.',
    button: 'Скопировать код',
    action: null,
    mode: 'insert',
  },
  'no-persona': {
    code: 'CG-PERSONA-UNASSIGNED',
    dot: 'ring',
    text: 'ChatGoose · CG-PERSONA-UNASSIGNED Нет персоны. Для этой страницы не выбрана персона. Выберите её в настройках.',
    button: 'Выбрать',
    action: { type: 'OpenSettings', route: { section: 'personas', code: 'CG-PERSONA-UNASSIGNED' } },
    mode: 'insert',
  },
  'host-degraded': {
    code: 'CG-HOST-CONTRACT',
    dot: 'ring',
    text: 'ChatGoose · CG-HOST-CONTRACT ChatSpace обновился. Вставка недоступна — только «Копировать».',
    button: 'Подробнее',
    action: { type: 'OpenSettings', route: { section: 'status', code: 'CG-HOST-CONTRACT' } },
    mode: 'copy-only',
  },
  'hub-down': {
    code: 'CG-HUB-UNAVAILABLE',
    dot: 'danger',
    text: 'ChatGoose · CG-HUB-UNAVAILABLE Хаб недоступен. ChatSpace работает как обычно. AI вернётся, когда хаб ответит.',
    button: 'Повторить',
    action: { type: 'RecheckStatus' },
    mode: 'insert',
  },
  'blocked-fan': {
    code: 'CG-GATE-FAN-BLOCKED',
    dot: 'ring',
    text: 'ChatGoose · CG-GATE-FAN-BLOCKED Фан заблокирован. Можно только копировать.',
    button: null,
    action: null,
    mode: 'copy-only',
  },
};

describe('status banners', () => {
  for (const status of DOCK_STATUSES) {
    if (status === 'reload-needed') continue;
    const expected = EXPECTED[status];
    it(`${status}: ${expected.code ?? 'no banner'}`, async () => {
      kit = mountDock(dockScenario(dockVm(status)));
      expect(kit.$('.cg-dock')?.getAttribute('data-cg-dock')).toBe(status);
      expect(kit.$('.cg-dock')?.getAttribute('data-cg-mode')).toBe(expected.mode);
      const row = banner();
      if (expected.code === null) {
        expect(row).toBeNull();
        expect(kit.$('.cg-sheet')).toBeNull();
        return;
      }
      expect(row?.getAttribute('role')).toBe('status');
      expect(row?.getAttribute('data-cg-code')).toBe(expected.code);
      expect(text(row?.querySelector('.cg-banner__text'))).toBe(expected.text);
      expect(row?.querySelector(`.cg-gut .cg-dot--${expected.dot ?? ''}`)).not.toBeNull();
      // A banner without a result is a sheet of one row above the strip.
      expect((kit.$('.cg-sheet') as HTMLElement).children).toHaveLength(1);
      const action = bannerButton();
      expect(action === null ? null : text(action)).toBe(expected.button);
      if (expected.action !== null) {
        await flush(() => action?.click());
        expect(kit.client.dispatched).toEqual([expected.action]);
      }
    });
  }

  it('[UI-011] an unbound account: «Скопировать код» copies the code through the clipboard port', async () => {
    kit = mountDock(dockScenario(dockVm('no-binding')));
    await flush(() => bannerButton()?.click());
    expect(kit.deps.clipboard.written).toEqual(['CG-BINDING-MISSING']);
    kit.unmount();
    kit = mountDock('no-rights');
    expect(banner()?.getAttribute('data-cg-code')).toBe('CG-BINDING-NOT-GRANTED');
  });

  it('[UI-027] a composer without its bridge is `host-degraded` with CG-HOST-COMPOSER-MISSING: the banner is the last row under the copy-only parts', () => {
    kit = mountDock('host-contract-partial');
    kit.client.goTo(0);
    kit.unmount();
    const scenario = dockScenario(dockVm('host-degraded', { code: 'CG-HOST-COMPOSER-MISSING', result: kit.client.getSnapshot({ of: 'dock' }).result }));
    kit = mountDock(scenario);
    const sheet = kit.$('.cg-sheet') as HTMLElement;
    expect(sheet.lastElementChild).toBe(banner());
    expect(banner()?.getAttribute('data-cg-code')).toBe('CG-HOST-COMPOSER-MISSING');
    expect(kit.$$('.cg-part .cg-copy-main')).toHaveLength(3);
    expect(kit.$$('.cg-part .cg-ins')).toHaveLength(0);
  });

  it('«расширение обновилось» is a card, not a banner: a ring, the technical line, «Перезагрузить вкладку» and «Скопировать код»', async () => {
    kit = mountDock(dockScenario(dockVm('reload-needed')));
    expect(banner()).toBeNull();
    const card = kit.$('.cg-card') as HTMLElement;
    expect(card.getAttribute('data-cg-code')).toBe('CG-RUNTIME-RELOADED');
    expect(card.querySelector('.cg-gut .cg-dot--ring')).not.toBeNull();
    expect(text(card.querySelector('.cg-card__tech'))).toBe('old tab script detached • build 0.4.3');
    expect([...card.querySelectorAll('button')].map(text)).toEqual(['Перезагрузить вкладку', 'Скопировать код']);
    await flush(() => card.querySelector('button')?.click());
    expect(kit.client.dispatched).toEqual([{ type: 'ReloadTab' }]);
  });

  it('[UI-013] a blocked fan: the banner and the strip stand without ChatSpace\'s composer; parts are copy-only', () => {
    kit = mountDock('blocked-fan');
    expect(banner()?.getAttribute('data-cg-code')).toBe('CG-GATE-FAN-BLOCKED');
    expect(bannerButton()).toBeNull();
    expect(kit.$$('.cg-part .cg-ins')).toHaveLength(0);
  });
});

describe('what the sheet shows first', () => {
  it('[UI-015] «расширение обновилось» over the refusal over Recap and Review over the result; the banner is always the last row', async () => {
    const done = scenarioById('debug-off').views.find((view) => view.selector.of === 'dock')?.vm as DockVM;
    const refusal = { feature: 'reply' as const, error: cgError(ctx, 'CG-OP-TAB-LIMIT'), running: [] };
    const head = (): string | null => kit?.$('.cg-head__title')?.textContent ?? null;
    expect(done.result?.state).toBe('done');
    // Everything at once: only the reload card.
    kit = mountDock(dockScenario(dockVm('reload-needed', { result: done.result, analysis: 'review', refusal })));
    await settle(1);
    expect(kit.$('.cg-card')?.getAttribute('data-cg-code')).toBe('CG-RUNTIME-RELOADED');
    expect(kit.$$('.cg-part')).toEqual([]);
    expect(head()).toBeNull();
    kit.unmount();
    // The refusal of a new generation covers Review and the finished result.
    kit = mountDock(dockScenario(dockVm('ready', { result: done.result, analysis: 'review', refusal })));
    await settle(1);
    expect(kit.$('.cg-card')?.getAttribute('data-cg-code')).toBe('CG-OP-TAB-LIMIT');
    expect(kit.$$('.cg-part')).toEqual([]);
    kit.unmount();
    // Review covers the draft result, which the dock keeps.
    kit = mountDock(dockScenario(dockVm('ready', { result: done.result, analysis: 'review' })));
    await settle(2);
    expect(head()).toBe('Review');
    expect(kit.$$('.cg-part')).toEqual([]);
    kit.unmount();
    kit = mountDock(dockScenario(dockVm('hub-down', { result: done.result })));
    await settle(1);
    expect(head()).toBe('Reply');
    expect(kit.$$('.cg-part').length).toBeGreaterThan(0);
    expect((kit.$('.cg-sheet') as HTMLElement).lastElementChild).toBe(banner());
  });
});

describe('the dot of an error', () => {
  it('a ring for a state (quota 0, the limit, a lease, no sign-in, ChatSpace updated, a gate), red for a failure of our work', () => {
    const state = ['CG-QUOTA-DAILY', 'CG-OP-TAB-LIMIT', 'CG-OP-CHAT-BUSY', 'CG-CLAIM-BUSY', 'CG-RUNTIME-RELOADED', 'CG-AUTH-REQUIRED', 'CG-BINDING-MISSING', 'CG-PERSONA-UNASSIGNED', 'CG-HOST-CONTRACT', 'CG-HOST-COMPOSER-MISSING', 'CG-GATE-FAN-BLOCKED', 'CG-GATE-DRAFT'];
    const failure = ['CG-PROVIDER-RATE-LIMIT', 'CG-OP-INTERRUPTED', 'CG-HUB-UNAVAILABLE', 'CG-INSERT-FAILED', 'CG-CLIPBOARD', 'CG-HUB-TIMEOUT', 'CG-UI-FAILED', 'CG-RECAP-SAVE'];
    for (const code of state) expect(errorToneOf(code), code).toBe('state');
    for (const code of failure) expect(errorToneOf(code), code).toBe('failure');
    // Every code the rule names exists in the registry.
    for (const code of [...state, ...failure]) expect(CG_CODES as readonly string[], code).toContain(code);
  });

  it('[ER-005] the view says its own dot when its producer decided it (CgErrorView.tone); the list is read only for a view without one', () => {
    expect(toneOf({ code: 'CG-QUOTA-DAILY' })).toBe('state');
    expect(toneOf({ code: 'CG-QUOTA-DAILY', tone: 'failure' })).toBe('failure');
    expect(toneOf({ code: 'CG-PROVIDER-STREAM', tone: 'state' })).toBe('state');
    // In the sheet: a result card and a refusal draw the dot the view carries, whatever the list says of the code.
    const failed = failedResult(ctx, uuid(101), 'reply', { ...cgError(ctx, 'CG-PROVIDER-STREAM'), tone: 'state' }, []);
    kit = mountDock(dockScenario(dockVm('ready', { result: failed })));
    expect(kit.$('.cg-card .cg-gut .cg-dot--ring')).not.toBeNull();
    expect(kit.$('.cg-card .cg-dot--danger')).toBeNull();
    kit.unmount();
    kit = mountDock(dockScenario(dockVm('ready', { refusal: { feature: 'reply', error: { ...cgError(ctx, 'CG-OP-TAB-LIMIT'), tone: 'failure' }, running: [] } })));
    expect(kit.$('.cg-card .cg-gut .cg-dot--danger')).not.toBeNull();
  });
});
