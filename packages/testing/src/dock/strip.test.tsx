// The strip of the dock (ui-design §3.1, §4.1; UI-002…UI-010, UI-012, UI-031,
// AI-001…AI-010): what it shows for a DockVM and what each button asks for.

import { afterEach, describe, expect, it } from 'vitest';

import { DOCK_ACTION_IDS, TONES } from '@cg/contracts';

import { FANS, PERSONA, ctxOf, dock, dockActions, handles, iso, reason, scenarioById } from '../scenarios/app-client';
import { type MountedKit, ctx, dockScenario, dockVm, flush, keydown, mountDock, settle, text } from './harness';

let kit: MountedKit | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
});

const buttons = (): HTMLElement[] => kit?.$$('.cg-strip .cg-act') ?? [];
const button = (label: string): HTMLElement => {
  const found = buttons().find((element) => element.querySelector('.cg-act__t')?.textContent === label);
  if (found === undefined) throw new Error(`no strip button «${label}»`);
  return found;
};
const described = (element: HTMLElement): string => kit?.root.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
const HANDLE = handles.dock(FANS.hubert);

describe('the strip', () => {
  it('[UI-002] is a toolbar: Reply with its four tones right after it, the other six actions, «Ещё», then the «Тон» menu (a width shows the menu or the four), Split and the two windows', () => {
    kit = mountDock(dockScenario(dockVm()));
    const strip = kit.$('.cg-strip') as HTMLElement;
    expect(strip.getAttribute('role')).toBe('toolbar');
    expect(strip.getAttribute('aria-label')).toBe('ChatGoose');
    expect(DOCK_ACTION_IDS).toEqual(['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'coach']);
    expect(buttons().map((element) => element.querySelector('.cg-act__t')?.textContent)).toEqual([
      ...['Reply', 'Casual', 'Flirt', 'Sell', 'Spice', 'Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach', 'Ещё'],
      ...['Тон', 'Split', 'Spenders', 'Новые'],
    ]);
    // The four tone buttons are one named group, one outlined segment; the menu with the same choices is for a narrow composer.
    expect(kit.$$('.cg-slot--tones > .cg-tones')).toHaveLength(1);
    expect(kit.$('.cg-slot--tones')?.getAttribute('role')).toBe('group');
    expect(kit.$('.cg-slot--tones')?.getAttribute('aria-label')).toBe('Тон');
    expect(kit.$$('.cg-slot--tones .cg-act').map(text)).toEqual(['Casual', 'Flirt', 'Sell', 'Spice']);
    expect(kit.$$('.cg-slot--boards .cg-act').map(text)).toEqual(['Spenders', 'Новые']);
    // Review, Recap and Coach are the ones «Ещё» replaces on a narrow composer.
    expect(kit.$$('.cg-slot--two .cg-act').map(text)).toEqual(['Review⌘⇧B', 'Recap⌘⇧S', 'Coach⌘⇧C']);
    expect(kit.$('.cg-slot--more .cg-act')?.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('[UI-012] outside an open chat there is no dock at all', () => {
    kit = mountDock(dockScenario({ ...dockVm(), visible: false }));
    expect(kit.$('.cg-dock')).toBeNull();
    expect(kit.$('.cg-strip')).toBeNull();
  });

  it('[UI-006] prints the key on an enabled button and sets aria-keyshortcuts; labels follow the OS', () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(button('Reply').querySelector('kbd')?.textContent).toBe('⌘E');
    expect(button('Reply').getAttribute('aria-keyshortcuts')).toBe('Meta+E');
    expect(button('Review').querySelector('kbd')?.textContent).toBe('⌘⇧B');
    kit.unmount();
    const win = ctxOf({ lang: 'en', platform: 'win' });
    kit = mountDock(dockScenario(dock(win, 'ready'), { lang: 'en', platform: 'win' }));
    expect(button('Reply').querySelector('kbd')?.textContent).toBe('Ctrl+E');
    expect(button('Reply').getAttribute('aria-keyshortcuts')).toBe('Control+E');
    expect(button('Recap').querySelector('kbd')?.textContent).toBe('Ctrl+Alt+S');
  });

  it('[UI-005] [UI-004] the tooltip names the action and its key; a busy button says how to cancel', () => {
    kit = mountDock('streaming');
    expect(described(button('Reply'))).toBe('Reply — идёт генерация. Отмена ⌘.');
    kit.unmount();
    kit = mountDock(dockScenario(dockVm()));
    expect(described(button('Reply'))).toBe('Reply  ⌘E');
    expect(described(button('Тон'))).toBe('Тон на один ответ  ⌘⇧O');
    expect(described(button('Split'))).toBe('Split: ответ частями  ⌘⇧L');
    expect(kit.$('.cg-mark')?.getAttribute('aria-label')).toBe(`ChatGoose — персона ${PERSONA.label}`);
    // No `title` attribute anywhere: tooltips are ours.
    expect(kit.$$('[title]')).toEqual([]);
  });

  it('[AI-021] [UI-005] an unavailable action is aria-disabled, keeps focus, drops its key and says why', async () => {
    kit = mountDock(dockScenario(dockVm('ready', { actionsOptions: { gates: { fix: reason('needs-draft') } } })));
    const fix = button('Fix') as HTMLButtonElement;
    expect(fix.disabled).toBe(false);
    expect(fix.getAttribute('aria-disabled')).toBe('true');
    expect(fix.querySelector('kbd')).toBeNull();
    expect(fix.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(described(fix)).toBe('Fix недоступен: сначала напишите черновик в поле ввода');
    await flush(() => fix.click());
    expect(kit.client.dispatched).toEqual([]);
  });

  it('[UI-008] [UI-007] while a generation runs only its own button works: it is busy, the other six are off with the reason', async () => {
    kit = mountDock('streaming');
    const reply = button('Reply');
    expect(reply.classList.contains('is-busy')).toBe(true);
    expect(reply.getAttribute('aria-busy')).toBe('true');
    expect(reply.hasAttribute('aria-disabled')).toBe(false);
    for (const label of ['Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach']) {
      const other = button(label);
      expect(other.getAttribute('aria-disabled'), label).toBe('true');
      expect(described(other), label).toBe(`${label} недоступен: в этом чате уже идёт генерация`);
      expect(other.querySelector('kbd'), label).toBeNull();
      await flush(() => other.click());
    }
    // «Ещё» is off only because all three behind it are.
    expect(button('Ещё').getAttribute('aria-disabled')).toBe('true');
    expect(described(button('Ещё'))).toBe('Review, Recap, Coach недоступны: в этом чате уже идёт генерация');
    expect(kit.client.dispatched).toEqual([]);
  });

  it('[UI-008] without sign-in, a binding, a persona or the hub everything is off with that reason', () => {
    const cases = [
      ['not-signed-in', 'нужно войти в ChatGoose'],
      ['no-binding', 'аккаунт не привязан к странице в хабе'],
      ['no-persona', 'для страницы не выбрана персона'],
      ['hub-down', 'хаб недоступен, AI вернётся, когда он ответит'],
      ['loading-chat', 'чат ещё загружается'],
      ['reload-needed', 'расширение обновилось, перезагрузите вкладку'],
    ] as const;
    for (const [status, why] of cases) {
      kit = mountDock(dockScenario(dockVm(status)));
      for (const label of ['Reply', 'Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach']) expect(described(button(label)), `${status} ${label}`).toBe(`${label} недоступен: ${why}`);
      expect(kit.$('.cg-mark')?.classList.contains('is-off'), status).toBe(true);
      kit.unmount();
      kit = null;
    }
  });

  it('[UI-009] Тон and Split stay in the strip when everything is off, unavailable with the same reason', () => {
    kit = mountDock(dockScenario(dockVm('no-binding')));
    expect(button('Тон').getAttribute('aria-disabled')).toBe('true');
    expect(described(button('Тон'))).toBe('Тон недоступен: аккаунт не привязан к странице в хабе');
    expect(described(button('Split'))).toBe('Split недоступен: аккаунт не привязан к странице в хабе');
    // No lock: nothing is generating.
    expect(kit.$('.cg-lock')).toBeNull();
  });

  it('[UI-010] the «Recap готов» point stands on Recap and on «Ещё»', () => {
    kit = mountDock(dockScenario(dockVm('ready', { actionsOptions: { recapReady: true } })));
    expect(button('Recap').querySelector('.cg-badge')?.getAttribute('data-accent-use')).toBe('recap-ready');
    expect(button('Ещё').querySelector('.cg-badge')).not.toBeNull();
    expect(button('Reply').querySelector('.cg-badge')).toBeNull();
    expect(described(button('Recap'))).toBe('Recap  ⌘⇧S\nRecap готов');
  });

  it('[UI-031] the quota shows only when little is left or nothing is', () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(kit.$('.cg-quota')).toBeNull();
    kit.unmount();
    kit = mountDock(dockScenario(dockVm('ready', { quota: { remaining: 400, low: false, resetsAt: null } })));
    expect(kit.$('.cg-quota')).toBeNull();
    kit.unmount();
    kit = mountDock('quota-low');
    const low = kit.$('.cg-quota') as HTMLElement;
    expect(text(low.querySelector('.cg-long'))).toBe('AI: осталось 12');
    expect(text(low.querySelector('.cg-short'))).toBe('AI: 12');
    expect(described(low)).toMatch(/^Осталось 12 генераций AI на сегодня\. Обновится в \d\d:\d\d$/);
    kit.unmount();
    kit = mountDock('quota-zero');
    const zero = kit.$('.cg-quota') as HTMLElement;
    expect(text(zero)).toBe('Квота AI: 0');
    expect(zero.classList.contains('is-zero')).toBe(true);
    expect(described(button('Reply'))).toMatch(/^Reply недоступен: дневная квота AI исчерпана, обновится в \d\d:\d\d$/);
  });

  it('shows the persona once, «вход не выполнен» without sign-in, the status words while the chat loads', () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(text(kit.$('.cg-persona'))).toBe(PERSONA.label);
    expect(described(kit.$('.cg-persona') as HTMLElement)).toBe(`Персона для ${PERSONA.pageName}`);
    expect(text(kit.$('.cg-hint'))).toBe('⌘K');
    expect(kit.$('.cg-status-word')).toBeNull();
    kit.unmount();
    kit = mountDock(dockScenario(dockVm('not-signed-in')));
    expect(text(kit.$('.cg-persona'))).toBe('вход не выполнен');
    kit.unmount();
    kit = mountDock(dockScenario(dockVm('no-persona')));
    expect(kit.$('.cg-persona')).toBeNull();
    kit.unmount();
    kit = mountDock(dockScenario(dockVm('loading-chat')));
    expect(text(kit.$('.cg-status-word .cg-long'))).toBe('Чат загружается…');
    expect(text(kit.$('.cg-status-word .cg-short'))).toBe('Загрузка…');
    expect(kit.$('.cg-strip')?.classList.contains('has-status')).toBe(true);
  });

  it('is «crowded» with a tone, a generation, the quota or the status words (the persona gives its place below 900 px)', () => {
    const crowded = (vm: Parameters<typeof dockScenario>[0]): boolean => {
      kit?.unmount();
      kit = mountDock(dockScenario(vm));
      return kit.$('.cg-strip')?.classList.contains('is-crowded') === true;
    };
    expect(crowded(dockVm())).toBe(false);
    expect(crowded(dockVm('ready', { options: { ...dockVm().options, tone: 'flirty' } }))).toBe(true);
    expect(crowded(dockVm('ready', { quota: { remaining: 12, low: true, resetsAt: null } }))).toBe(true);
    expect(crowded(dockVm('loading-chat'))).toBe(true);
    expect(crowded(scenarioById('streaming').views[0]?.vm as ReturnType<typeof dockVm>)).toBe(true);
  });
});

describe('what the strip asks for', () => {
  it('[AI-001] [AI-020] [AI-030] [AI-035] [AI-050] Reply, Fix, Hi, Ping and Review start a generation for the open chat with no raw persona or model', async () => {
    kit = mountDock(dockScenario(dockVm()));
    for (const label of ['Reply', 'Fix', 'Hi', 'Ping', 'Review']) await flush(() => button(label).click());
    await settle(1);
    expect(kit.client.dispatched).toEqual(
      (['reply', 'fix', 'hi', 'ping', 'review'] as const).map((feature) => ({ type: 'Generate', targetHandle: HANDLE, feature, options: {} })),
    );
  });

  it('[AI-060] Recap opens the sheet and never generates by itself; [AI-080] Coach opens its panel', async () => {
    kit = mountDock(dockScenario(dockVm()));
    await flush(() => button('Recap').click());
    await flush(() => button('Coach').click());
    expect(kit.client.dispatched).toEqual([
      { type: 'ShowAnalysis', view: 'recap', mode: 'sheet' },
      { type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: true } },
    ]);
    kit.unmount();
    // An open Coach closes on the same button.
    kit = mountDock(dockScenario(dockVm('ready', { actionsOptions: { active: 'coach' } })));
    await flush(() => button('Coach').click());
    expect(kit.client.dispatched).toEqual([{ type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: false } }]);
  });

  it('[AI-002] the tone menu lists Casual, Flirt, Sell, Spice and «Без тона» as radio items', async () => {
    kit = mountDock(dockScenario(dockVm('ready', { options: { ...dockVm().options, tone: 'flirty' } })));
    expect(text(button('Тон'))).toBe('Тон: Flirt⌘⇧O');
    expect(text(kit.$('.cg-tone-val'))).toBe(': Flirt');
    await flush(() => button('Тон').click());
    const menu = kit.$('[role="menu"]') as HTMLElement;
    expect(menu.getAttribute('aria-label')).toBe('Тон');
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(TONES).toEqual(['casual', 'flirty', 'upsell', 'spicy']);
    expect(items.map((item) => item.querySelector('.cg-menu__t')?.textContent)).toEqual(['Casual', 'Flirt', 'Sell', 'Spice', 'Без тона']);
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false']);
    expect(text(menu.querySelector('.cg-menu__cap'))).toBe('Тон на один ответ⌘⇧O');
    expect(button('Тон').getAttribute('aria-expanded')).toBe('true');
    // Opening focuses the chosen item; Esc closes and returns focus to the button.
    expect(kit.root.activeElement).toBe(items[1]);
    await flush(() => items[1]?.dispatchEvent(keydown('Escape')));
    expect(kit.$('[role="menu"]')).toBeNull();
    expect(kit.root.activeElement).toBe(button('Тон'));
  });

  it('[AI-005] choosing a tone runs Reply in it at once; «Без тона» only clears the tone', async () => {
    kit = mountDock(dockScenario(dockVm()));
    await flush(() => button('Тон').click());
    await flush(() => (kit?.$$('[role="menuitemradio"]')[2] as HTMLElement).click());
    await flush(() => button('Тон').click());
    await flush(() => (kit?.$$('[role="menuitemradio"]')[4] as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([
      { type: 'Generate', targetHandle: HANDLE, feature: 'reply', options: { tone: 'upsell' } },
      { type: 'SetTone', targetHandle: HANDLE, tone: null },
    ]);
  });

  it('[AI-006] a second click on the tone that is already chosen takes it off and runs nothing', async () => {
    kit = mountDock(dockScenario(dockVm('ready', { options: { ...dockVm().options, tone: 'flirty' } })));
    await flush(() => button('Тон').click());
    const items = kit.$$('[role="menuitemradio"]');
    expect(items[1]?.getAttribute('aria-checked')).toBe('true');
    await flush(() => items[1]?.click());
    expect(kit.client.dispatched).toEqual([{ type: 'SetTone', targetHandle: HANDLE, tone: null }]);
    expect(kit.$('[role="menu"]')).toBeNull();
    // Another tone still runs Reply in it at once (AI-005).
    await flush(() => button('Тон').click());
    await flush(() => (kit?.$$('[role="menuitemradio"]')[0] as HTMLElement).click());
    expect(kit.client.dispatched[1]).toEqual({ type: 'Generate', targetHandle: HANDLE, feature: 'reply', options: { tone: 'casual' } });
  });

  it('[AI-005] with Reply unavailable a chosen tone is only remembered', async () => {
    kit = mountDock(dockScenario(dockVm('ready', { actionsOptions: { gates: { reply: reason('no-history') } } })));
    await flush(() => button('Тон').click());
    await flush(() => (kit?.$$('[role="menuitemradio"]')[0] as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'SetTone', targetHandle: HANDLE, tone: 'casual' }]);
  });

  it('[AI-002] [AI-005] a tone is a button of its own on a wide composer: one click runs Reply in that tone, with no menu to open', async () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(button('Flirt').getAttribute('aria-pressed')).toBe('false');
    expect(described(button('Flirt'))).toBe('Reply · Тон: Flirt');
    await flush(() => button('Flirt').click());
    await flush(() => button('Spice').click());
    expect(kit.client.dispatched).toEqual([
      { type: 'Generate', targetHandle: HANDLE, feature: 'reply', options: { tone: 'flirty' } },
      { type: 'Generate', targetHandle: HANDLE, feature: 'reply', options: { tone: 'spicy' } },
    ]);
    expect(kit.$('[role="menu"]')).toBeNull();
  });

  it('[AI-006] the chosen tone is the pressed button; a click on it takes the tone off and runs nothing', async () => {
    kit = mountDock(dockScenario(dockVm('ready', { options: { ...dockVm().options, tone: 'flirty' } })));
    expect(['Casual', 'Flirt', 'Sell', 'Spice'].map((label) => button(label).getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
    expect(described(button('Flirt'))).toBe('Тон: Flirt → Без тона');
    await flush(() => button('Flirt').click());
    expect(kit.client.dispatched).toEqual([{ type: 'SetTone', targetHandle: HANDLE, tone: null }]);
  });

  it('[AI-005] [AI-009] a tone button with Reply unavailable only remembers the tone; while a generation runs it is off with the reason, and one lock stands after the four', async () => {
    kit = mountDock(dockScenario(dockVm('ready', { actionsOptions: { gates: { reply: reason('no-history') } } })));
    expect(described(button('Casual'))).toBe('Тон: Casual');
    await flush(() => button('Casual').click());
    expect(kit.client.dispatched).toEqual([{ type: 'SetTone', targetHandle: HANDLE, tone: 'casual' }]);
    kit.unmount();
    kit = mountDock('streaming');
    for (const label of ['Casual', 'Flirt', 'Sell', 'Spice']) {
      expect(button(label).getAttribute('aria-disabled'), label).toBe('true');
      expect(described(button(label)), label).toBe('Тон нельзя менять, пока идёт генерация');
      await flush(() => button(label).click());
    }
    expect(kit.$$('.cg-tones > .cg-lock')).toHaveLength(1);
    expect(kit.client.dispatched).toEqual([]);
  });

  it('[NEW-01] Spenders and «Новые» open from the strip by one click: what their rows of the palette ask for', async () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(described(button('Spenders'))).toContain('Spenders');
    expect(described(button('Новые'))).toBe('Новые');
    await flush(() => button('Новые').click());
    await flush(() => button('Spenders').click());
    expect(kit.client.dispatched).toEqual([
      { type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: true } },
      { type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } },
    ]);
  });

  it('[UI-006] where key labels are spelled out («Ctrl+Alt+B») the strip says so: its widths are other ones (ui-design §3.3)', () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(kit.$('.cg-strip')?.classList.contains('is-longkeys')).toBe(false);
    kit.unmount();
    const win = ctxOf({ lang: 'ru', platform: 'win' });
    kit = mountDock(dockScenario(dock(win, 'ready'), { lang: 'ru', platform: 'win' }));
    expect(kit.$('.cg-strip')?.classList.contains('is-longkeys')).toBe(true);
    // With every action off (a chat that loads) no button carries a key, and the strip still knows: its layout does not jump.
    kit.unmount();
    kit = mountDock(dockScenario(dock(win, 'loading-chat'), { lang: 'ru', platform: 'win' }));
    expect(kit.$$('.cg-strip__acts kbd')).toEqual([]);
    expect(kit.$('.cg-strip')?.classList.contains('is-longkeys')).toBe(true);
  });

  it('[AI-009] Тон and Split are locked while a generation runs: a lock, the reason, no menu', async () => {
    kit = mountDock('streaming');
    for (const label of ['Тон', 'Split']) {
      const option = button(label);
      expect(option.getAttribute('aria-disabled'), label).toBe('true');
      expect(option.querySelector('.cg-lock'), label).not.toBeNull();
      expect(described(option), label).toBe(`${label} нельзя менять, пока идёт генерация`);
      await flush(() => option.click());
      await flush(() => option.dispatchEvent(keydown('Enter')));
    }
    expect(kit.$('[role="menu"]')).toBeNull();
    expect(kit.client.dispatched).toEqual([]);
  });

  it('[AI-010] Split is a pressed-state toggle that writes the setting; for Recap and Review it is off: «это не сообщение фану»', async () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(button('Split').getAttribute('aria-pressed')).toBe('false');
    await flush(() => button('Split').click());
    expect(kit.client.dispatched).toEqual([{ type: 'SetPreference', key: 'generation.split', value: true }]);
    kit.unmount();
    kit = mountDock(dockScenario(dockVm('ready', { analysis: 'recap', options: { ...dockVm().options, split: true, splitReason: reason('not-a-message') } })));
    expect(button('Split').getAttribute('aria-pressed')).toBe('true');
    expect(button('Split').getAttribute('aria-disabled')).toBe('true');
    expect(described(button('Split'))).toBe('Split: это не сообщение фану');
  });

  it('[UI-003] Review, Recap and Coach live in our strip — in «Ещё» on a narrow composer, a menu with their keys; an item does what its button does', async () => {
    kit = mountDock(dockScenario(dockVm('ready', { actionsOptions: { gates: { review: reason('no-history') } } })));
    await flush(() => button('Ещё').click());
    const items = kit.$$('[role="menu"] [role="menuitem"]');
    expect(items.map(text)).toEqual(['Review', 'Recap⌘⇧S', 'Coach⌘⇧C']);
    expect(items[0]?.getAttribute('aria-disabled')).toBe('true');
    await flush(() => items[0]?.click());
    await flush(() => items[1]?.click());
    expect(kit.client.dispatched).toEqual([{ type: 'ShowAnalysis', view: 'recap', mode: 'sheet' }]);
    expect(kit.$('[role="menu"]')).toBeNull();
  });

  it('is one tab stop: arrows, Home and End move between its buttons (ui-design §6.3, §6.4)', async () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(buttons().map((element) => element.tabIndex)).toEqual([0, ...Array.from({ length: 15 }, () => -1)]);
    button('Reply').focus();
    // Right of Reply stand its tones, then the next action.
    await flush(() => button('Reply').dispatchEvent(keydown('ArrowRight')));
    expect(kit.root.activeElement).toBe(button('Casual'));
    button('Spice').focus();
    await flush(() => button('Spice').dispatchEvent(keydown('ArrowRight')));
    expect(kit.root.activeElement).toBe(button('Fix'));
    // The tab stop follows focus.
    expect(button('Fix').tabIndex).toBe(0);
    expect(button('Reply').tabIndex).toBe(-1);
    await flush(() => button('Fix').dispatchEvent(keydown('End')));
    expect(kit.root.activeElement).toBe(button('Новые'));
    await flush(() => button('Новые').dispatchEvent(keydown('ArrowRight')));
    expect(kit.root.activeElement).toBe(button('Reply'));
    await flush(() => button('Reply').dispatchEvent(keydown('ArrowLeft')));
    expect(kit.root.activeElement).toBe(button('Новые'));
    // The tones are stops of the same toolbar, and the tab stop follows focus onto them.
    await flush(() => button('Новые').dispatchEvent(keydown('ArrowLeft')));
    await flush(() => button('Spenders').dispatchEvent(keydown('ArrowLeft')));
    expect(kit.root.activeElement).toBe(button('Split'));
    button('Sell').focus();
    await flush(() => undefined);
    expect(button('Sell').tabIndex).toBe(0);
    await flush(() => button('Sell').dispatchEvent(keydown('Home')));
    expect(kit.root.activeElement).toBe(button('Reply'));
    // ↓ on «Тон» opens its menu.
    button('Тон').focus();
    await flush(() => button('Тон').dispatchEvent(keydown('ArrowDown')));
    expect(kit.$('[role="menu"]')).not.toBeNull();
  });

  it('[UI-004] with hints off descriptions are gone, reasons stay', () => {
    kit = mountDock(dockScenario(dockVm('ready', { hints: false, actionsOptions: { gates: { fix: reason('needs-draft') } } })));
    expect(button('Reply').hasAttribute('aria-describedby')).toBe(false);
    expect(described(button('Fix'))).toBe('Fix недоступен: сначала напишите черновик в поле ввода');
  });

  it('builds every action from the view model: with no target nothing is asked', async () => {
    kit = mountDock(dockScenario({ ...dockVm(), targetHandle: null, actions: dockActions(ctx) }));
    await flush(() => button('Reply').click());
    await flush(() => button('Тон').click());
    await flush(() => (kit?.$$('[role="menuitemradio"]')[0] as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([]);
  });

  it('[UI-031] «по Москве» is Moscow\'s clock: the quota resets at 00:00 UTC, the zero tooltip says 03:00 whatever zone the port prints in', () => {
    // The stand's port prints in UTC — a chatter who is not in Moscow.
    const resetsAt = iso(Date.UTC(2026, 9, 4, 0, 0, 0));
    kit = mountDock(dockScenario(dockVm('ready', { quota: { remaining: 0, low: true, resetsAt } })));
    expect(described(kit.$('.cg-quota') as HTMLElement)).toBe('Дневная квота AI исчерпана. Обновится в 03:00 по Москве');
    kit.unmount();
    // The low-quota tooltip names no zone: it is the chatter's own time.
    kit = mountDock(dockScenario(dockVm('ready', { quota: { remaining: 12, low: true, resetsAt } })));
    expect(described(kit.$('.cg-quota') as HTMLElement)).toBe('Осталось 12 генераций AI на сегодня. Обновится в 00:00');
  });
});
