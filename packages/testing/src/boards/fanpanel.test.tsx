// The fan panel (R15; ui-design §3.7, §4.18, §10; D-29): a 320 px side panel
// — who the fan is, the money by kind, the subscription and the churn risk,
// ChatSpace's own estimates when it holds them, the bio, the Recap tab, and
// how old and how complete the data is. With no chat open: «Выберите чат».

import { afterEach, describe, expect, it } from 'vitest';

import { type FanPanelVM, type RecapViewVM } from '@cg/contracts';

import { cgError, ctxOf, entry, iso, MIN, recapView, scenarioById, views, type AppClientScenario } from '../scenarios/app-client';
import { flush, keydown, mountBoardSettled, textOf, type MountedBoard } from './harness';
import { boardScenario } from './states';

let ui: MountedBoard | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const ctx = ctxOf({ lang: 'ru', platform: 'mac' });

function panel(change: (vm: FanPanelVM) => FanPanelVM, recap?: RecapViewVM, state = '14a'): AppClientScenario {
  const base = boardScenario(state);
  return {
    ...base,
    views: [
      ...base.views.filter((view) => view.selector.of !== 'recap.view' || recap === undefined).map((view) => (view.selector.of === 'fan-panel' ? entry({ of: 'fan-panel' }, change(view.vm as FanPanelVM)) : view)),
      ...(recap === undefined ? [] : [entry({ of: 'recap.view' }, recap)]),
    ],
  };
}

const rows = (index: number): string[][] => {
  const list = ui?.$$('.cg-fp__kv')[index] as HTMLElement;
  const terms = [...list.querySelectorAll('dt')].map(textOf);
  const values = [...list.querySelectorAll('dd')].map(textOf);
  return terms.map((term, n) => [term, values[n] ?? '']);
};

describe('fan panel', () => {
  it('[CS-031] a complementary side panel «ChatGoose: фан», 320 px, that does not hold focus', async () => {
    ui = await mountBoardSettled('fan-panel', '14a');
    const aside = ui.$('.cg-side') as HTMLElement;
    expect(aside.tagName).toBe('ASIDE');
    expect(aside.getAttribute('role')).toBe('complementary');
    expect(aside.getAttribute('aria-label')).toBe('ChatGoose: фан');
    const css = ui.root.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join('\n');
    expect(css).toMatch(/\.cg-side \{[^}]*width: 320px/);
    // Not a modal: no focus is taken and ChatSpace's Esc is not held.
    expect(ui.root.activeElement).toBeNull();
    expect(ui.host.hasAttribute('data-dismissible-open')).toBe(false);
    expect(ui.$$('.cg-fp [role="tab"]').map(textOf)).toEqual(['Фан', 'Recap']);
    expect(ui.$('.cg-fp [role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('cg-fp-tab-fan');
  });

  it('[CS-032] who this is: initials, the name, «@handle, был 6 мин назад»; no remote image', async () => {
    ui = await mountBoardSettled('fan-panel', '14a');
    expect(ui.text('.cg-fp__av')).toBe('H');
    expect(ui.text('.cg-fp__name')).toBe('Hubert');
    expect(ui.text('.cg-fp__sub')).toBe('@hubert_pl, был 6 мин назад');
    expect(ui.$$('.cg-fp img')).toEqual([]);
  });

  it('presence: someone ChatSpace shows online is «в сети»; an unknown «был» is left out', async () => {
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, fan: vm.fan === null ? null : { ...vm.fan, online: true } })));
    expect(ui.text('.cg-fp__sub')).toBe('@hubert_pl, в сети');
    ui.unmount();
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, fan: vm.fan === null ? null : { ...vm.fan, lastSeenAt: null, online: null } })));
    expect(ui.text('.cg-fp__sub')).toBe('@hubert_pl');
    ui.unmount();
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, fan: vm.fan === null ? null : { ...vm.fan, username: null } })));
    expect(ui.text('.cg-fp__sub')).toBe('был 6 мин назад');
  });

  it('[CS-033] the money: the total, «+$320 за 30 дней» in green, and the kinds', async () => {
    ui = await mountBoardSettled('fan-panel', '14a');
    expect(ui.$$('.cg-fp__sec .cg-fp__cap').map(textOf)).toEqual(['Потратил всего', 'Подписка', 'Био', 'Списки']);
    expect(ui.text('.cg-fp__big')).toBe('$12,480');
    expect(ui.text('.cg-fp__in')).toBe('+$320 за 30 дней');
    expect(ui.$('.cg-fp__in')?.classList.contains('cg-money')).toBe(true);
    expect(rows(0)).toEqual([
      ['Сообщения', '$9,860'],
      ['Чаевые', '$2,140'],
      ['Подписка', '$480'],
    ]);
    // The sums by kind are plain ink.
    expect(ui.$$('.cg-fp__kv .cg-money')).toEqual([]);
  });

  it('[CS-033] a known zero of money is not drawn: «трат нет» under the caption and no rows of kinds that brought nothing — never «$0»', async () => {
    ui = await mountBoardSettled(
      'fan-panel',
      panel((vm) => ({ ...vm, spent: { total: 0, period30: 0, byKind: [{ kind: 'messages', mills: 0 }, { kind: 'tips', mills: 0 }] } })),
    );
    expect(ui.text('.cg-fp__none')).toBe('трат нет');
    expect(ui.$('.cg-fp__big')).toBeNull();
    expect(ui.$('.cg-fp__in')).toBeNull();
    expect(textOf(ui.$('.cg-fp__body'))).not.toContain('$0');
    // Only the subscription's rows are left.
    expect(ui.$$('.cg-fp__kv')).toHaveLength(1);
    ui.unmount();
    // Some kinds are zero, the total is not: the zero rows go, the rest stay.
    ui = await mountBoardSettled(
      'fan-panel',
      panel((vm) => ({ ...vm, spent: { total: 480_000, period30: null, byKind: [{ kind: 'messages', mills: 0 }, { kind: 'subscription', mills: 480_000 }, { kind: 'tips', mills: null }] } })),
    );
    expect(ui.text('.cg-fp__big')).toBe('$480');
    expect(rows(0)).toEqual([
      ['Подписка', '$480'],
      ['Чаевые', '—'],
    ]);
  });

  it('[CS-017] [CS-034] the subscription: «18 мес, с 14 мар 2024», auto-renew, the churn risk in words', async () => {
    ui = await mountBoardSettled('fan-panel', '14a');
    expect(rows(1)).toEqual([
      ['Подписан', '18 мес, с 14 мар 2024'],
      ['Автопродление', 'включено'],
      ['Риск ухода', 'низкий'],
    ]);
    ui.unmount();
    ui = await mountBoardSettled(
      'fan-panel',
      panel((vm) => ({ ...vm, subscription: { months: 3, since: null, autoRenew: false, churnRisk: 'high' } })),
    );
    expect(rows(1)).toEqual([
      ['Подписан', '3 мес'],
      ['Автопродление', 'выключено'],
      ['Риск ухода', 'высокий'],
    ]);
  });

  it('[CS-037] what the sources do not know is «—» or «нет данных», never a guess', async () => {
    ui = await mountBoardSettled(
      'fan-panel',
      panel((vm) => ({ ...vm, view: views.partial({ kind: 'coverage', level: 'partial' }), spent: null, subscription: { months: null, since: null, autoRenew: null, churnRisk: null }, bio: null, lists: [] })),
    );
    expect(ui.text('.cg-fp__big')).toBe('—');
    expect(ui.$('.cg-fp__in')).toBeNull();
    expect(rows(0)).toEqual([
      ['Подписан', '—'],
      ['Автопродление', '—'],
      ['Риск ухода', 'нет данных'],
    ]);
    expect(ui.$$('.cg-fp__sec .cg-fp__cap').map(textOf)).toEqual(['Потратил всего', 'Подписка']);
  });

  it('ChatSpace’s buying power and scores show only when it already holds them, as it names them', async () => {
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, host: { buyingPower: 'High', scores: [{ label: 'Engagement', value: '8/10' }] } })));
    expect(rows(1).slice(3)).toEqual([
      ['Buying power', 'High'],
      ['Engagement', '8/10'],
    ]);
    ui.unmount();
    ui = await mountBoardSettled('fan-panel', '14a');
    expect(rows(1)).toHaveLength(3);
  });

  it('[CS-035] the bio and the lists', async () => {
    ui = await mountBoardSettled('fan-panel', '14a');
    expect(ui.$$('.cg-fp__text').map(textOf)).toEqual(['logistics guy from Poland ✈️ always somewhere between two airports. coffee first, then everything else', 'VIP, Travels a lot']);
  });

  it('[CS-035] the hub’s profile of the fan is a Markdown document and is read as one, not printed as its source; ChatSpace’s own «О себе» is plain text', async () => {
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, bio: '## Кто он\nHubert, 34.\n\n- любит сеты\n- пишет по вечерам', bioSource: 'hub' as const })));
    const bio = ui.$$('.cg-fp__sec').find((section) => textOf(section.querySelector('.cg-fp__cap')) === 'Био') as HTMLElement;
    expect(textOf(bio)).not.toContain('##');
    expect(bio.querySelectorAll('li')).toHaveLength(2);
    expect(textOf(bio)).toContain('Кто он');
    ui.unmount();
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, bio: '## not a heading here', bioSource: 'host' as const })));
    expect(ui.$$('.cg-fp__text').map(textOf)[0]).toBe('## not a heading here');
  });

  it('[CS-035] the hub’s profile comes by its sections, as a full Recap does: each its own caption, never «1. DOSSIER» in capitals (X47)', async () => {
    const bio = '1. DOSSIER\nHubert, 34, logistics.\n\n7. STRATEGY\n- ask about the trip';
    ui = await mountBoardSettled(
      'fan-panel',
      panel((vm) => ({ ...vm, bio, bioSource: 'hub' as const, bioBlocks: [{ heading: 'Досье', markdown: 'Hubert, 34, logistics.' }, { heading: 'Стратегия', markdown: '- ask about the trip' }] })),
    );
    expect(ui.$$('[data-cg-dossier-block]').map((block) => textOf(block.querySelector('.cg-fp__cap')))).toEqual(['Досье', 'Стратегия']);
    expect(textOf(ui.$('.cg-fp__body') as HTMLElement)).not.toContain('DOSSIER');
    expect(ui.$$('[data-cg-dossier-block] li')).toHaveLength(1);
  });

  it('[CS-031] [CS-032] [CS-034] beside ChatSpace’s own panel only what it lacks: the hub’s money, the churn risk, the profile — no subscription dates, scores or lists (X47)', async () => {
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, besideHostPanel: true as const, host: null, lists: [], bio: null })));
    expect(ui.$$('.cg-fp__sec .cg-fp__cap').map(textOf)).toEqual(['Потратил всего', 'Подписка']);
    expect(ui.text('.cg-fp__big')).toBe('$12,480');
    expect(rows(1)).toEqual([['Риск ухода', 'низкий']]);
    expect(ui.$$('.cg-fp [role="tab"]').map(textOf)).toEqual(['Фан', 'Recap']);
  });

  it('[CS-036] the footer says how old and how complete the data is', async () => {
    ui = await mountBoardSettled('fan-panel', '14a');
    expect(ui.$$('.cg-fp__foot span').map(textOf)).toEqual(['Данные на 09:18', 'архив полный, 412 сообщений']);
    ui.unmount();
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, footer: { stamp: { asOf: iso(ctx.now - 2 * MIN), coverage: 'partial' }, archiveMessages: 37 } })));
    expect(ui.$$('.cg-fp__foot span').map(textOf)).toEqual(['Данные на 09:18', 'охват неполный, 37 сообщений']);
    ui.unmount();
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, footer: { stamp: { asOf: null, coverage: 'unknown' }, archiveMessages: null } })));
    expect(ui.$$('.cg-fp__foot span').map(textOf)).toEqual(['', 'охват неизвестен']);
  });

  it('[CS-038] no chat open: «ChatGoose», the persona and «Выберите чат»', async () => {
    ui = await mountBoardSettled('fan-panel', '14c');
    expect(ui.text('.cg-fp__name')).toBe('ChatGoose');
    expect(ui.text('.cg-fp__sub')).toBe('Лора · VIP');
    expect(ui.$('.cg-fp__av')).toBeNull();
    const empty = ui.$('.cg-fp__empty') as HTMLElement;
    expect(textOf(empty.querySelector('b'))).toBe('Выберите чат');
    expect(textOf(empty)).toBe('Выберите чатОткройте переписку слева: здесь появятся деньги фана, подписка и Recap.');
    expect(ui.$('.cg-fp [role="tablist"]')).toBeNull();
    expect(ui.$('.cg-fp__foot')).toBeNull();
  });

  it('× and Esc close the panel; Esc gives focus back to where it was', async () => {
    ui = await mountBoardSettled('fan-panel', '14a');
    const close = ui.$('.cg-fp__head .cg-btn') as HTMLElement;
    expect(close.getAttribute('aria-label')).toBe('Закрыть');
    await flush(() => close.click());
    expect(ui.actions().at(-1)).toEqual({ type: 'Navigate', to: { kind: 'surface', surface: 'fan-panel', open: false } });
    await flush(() => keydown(ui?.$('.cg-fp__body') as HTMLElement, 'Escape'));
    expect(ui.actionsOf('Navigate')).toHaveLength(2);
  });

  it('the tabs: «Recap» asks for the Recap tab', async () => {
    ui = await mountBoardSettled('fan-panel', '14a');
    await flush(() => (ui?.$$('.cg-fp [role="tab"]')[1] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'SetFanPanelTab', tab: 'recap' });
  });

  it('the Recap tab: «Recap для Hubert», short or full, its facts and «Обновить Recap ⌘⇧S»', async () => {
    ui = await mountBoardSettled('fan-panel', '14b');
    expect(ui.$('.cg-stale')).toBeNull();
    expect(ui.$('.cg-fp [role="tab"][aria-selected="true"]')?.textContent).toBe('Recap');
    expect(ui.$('.cg-fp__cap span')?.textContent).toBe('Recap для Hubert');
    const segments = ui.$$('.cg-fp .cg-seg__b');
    expect(segments.map(textOf)).toEqual(['Коротко', 'Полностью']);
    expect(segments.map((segment) => segment.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(ui.text('.cg-fp__md')).toMatch(/^Хуберт, 18 мес подписки/);
    expect(rows(0)).toEqual([
      ['Сделан', '1 д назад'],
      ['Хаб', 'сохранено'],
      ['Архив', 'полный'],
    ]);
    const refresh = ui.$('.cg-fp__acts .cg-btn') as HTMLElement;
    expect(textOf(refresh)).toBe('Обновить Recap⌘⇧S');
    // X49: asked here, the full Recap stays the panel's — the actions say so, and no «Развернуть ↗» window opens over it.
    await flush(() => refresh.click());
    expect(ui.actions().at(-1)).toEqual({ type: 'RefreshRecap', length: 'short', panel: true });
    await flush(() => (segments[1] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'ShowRecap', length: 'full', panel: true });
  });

  it('a full Recap is its blocks; a lagging archive and a failed save are said, and only the save is retried', async () => {
    const full = recapView(ctx, views.partial({ kind: 'archive-lag', messages: 2, minutes: null }), 'full', { saved: { s: 'failed', error: cgError(ctx, 'CG-RECAP-SAVE'), retry: { type: 'RetryRecapSave', length: 'full' } } });
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, tab: 'recap' }), full, '14b'));
    expect(ui.$$('.cg-fp__sec .cg-fp__cap').slice(1).map(textOf)).toEqual(['Кто он', 'Что любит', 'Покупки', 'Чего избегать', 'Сейчас']);
    expect(rows(0)[2]).toEqual(['Архив', 'архив отстаёт от чата на 2 сообщения']);
    expect(rows(0)[1]?.[0]).toBe('Хаб');
    const buttons = ui.$$('.cg-fp__acts .cg-btn');
    expect(buttons.map((button) => button.querySelector('.cg-btn__t')?.textContent)).toEqual(['Обновить Recap', 'Повторить']);
    await flush(() => (buttons[1] as HTMLElement).click());
    expect(ui.actions().at(-1)).toEqual({ type: 'RetryRecapSave', length: 'full' });
    expect(ui.actionsOf('RefreshRecap')).toEqual([]);
  });

  it('[CS-036] a Recap whose coverage is not known says of the archive what the footer says: never «неполный» over «архив полный»', async () => {
    // A Recap read back from the hub carries no coverage of its own.
    const unknown = recapView(ctx, views.ready(), 'short', { stamp: { asOf: iso(ctx.now - 2 * MIN), coverage: 'unknown' } });
    const foot = (): string => textOf(ui?.$$('.cg-fp__foot span')[1] ?? null);
    const archive = (): string[] | undefined => rows(0).find(([term]) => term === 'Архив');

    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, tab: 'recap' }), unknown, '14b'));
    expect(foot()).toBe('архив полный, 412 сообщений');
    expect(archive()).toEqual(['Архив', 'полный']);
    ui.unmount();

    // The panel's archive is known to be cut: both labels say so.
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, tab: 'recap', footer: { stamp: { asOf: iso(ctx.now - 2 * MIN), coverage: 'partial' }, archiveMessages: 37 } }), unknown, '14b'));
    expect(foot()).toBe('охват неполный, 37 сообщений');
    expect(archive()).toEqual(['Архив', 'неполный']);
    ui.unmount();

    // Nobody knows: «неизвестно», not a guess either way.
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, tab: 'recap', footer: { stamp: { asOf: null, coverage: 'unknown' }, archiveMessages: null } }), unknown, '14b'));
    expect(foot()).toBe('охват неизвестен');
    expect(archive()).toEqual(['Архив', 'неизвестно']);
    ui.unmount();

    // A Recap that knows it was built over a cut transcript still says so, whatever the archive is now.
    const cut = recapView(ctx, views.partial({ kind: 'coverage', level: 'partial' }), 'short', { archiveLag: null });
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, tab: 'recap' }), cut, '14b'));
    expect(foot()).toBe('архив полный, 412 сообщений');
    expect(archive()).toEqual(['Архив', 'неполный']);
  });

  it('no Recap yet: the tab says so and offers to build one', async () => {
    const none = recapView(ctx, views.empty({ key: 'cg.recapNotFound.title' }), 'short');
    ui = await mountBoardSettled('fan-panel', panel((vm) => ({ ...vm, tab: 'recap' }), none, '14b'));
    expect(ui.$('.cg-fp .cg-state--empty')).not.toBeNull();
    expect(ui.$$('.cg-fp__kv')).toEqual([]);
    expect(ui.$$('.cg-fp__acts .cg-btn').map((button) => button.querySelector('.cg-btn__t')?.textContent)).toEqual(['Обновить Recap']);
  });

  it('the panel while it loads, when it failed and when the hub is away', async () => {
    ui = await mountBoardSettled('fan-panel', 'gallery-loading');
    expect(ui.$('.cg-fp [role="status"][aria-busy="true"]')).not.toBeNull();
    ui.unmount();
    ui = await mountBoardSettled('fan-panel', 'gallery-error');
    expect(ui.$('.cg-fp .cg-card')?.getAttribute('data-cg-code')).toBe('CG-DATA-UNAVAILABLE');
    ui.unmount();
    ui = await mountBoardSettled('fan-panel', scenarioById('hub-down'));
    expect(ui.$('.cg-fp .cg-card')?.getAttribute('data-cg-code')).toBe('CG-HUB-UNAVAILABLE');
    // The last data stays under the card.
    expect(ui.text('.cg-fp__big')).toBe('$12,480');
  });
});
