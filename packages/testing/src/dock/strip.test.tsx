// The bar of the dock (ui-design §3.1, §4.1; UI-002…UI-010, UI-012, UI-031,
// AI-001…AI-010): what it shows for a DockVM and what each chip asks for.

import { afterEach, describe, expect, it } from 'vitest';

import { DOCK_ACTION_IDS, TONES } from '@cg/contracts';

import { FANS, PERSONA, ctxOf, dock, dockActions, handles, iso, reason, scenarioById } from '../scenarios/app-client';

/** One sentence under a control's name in its hint (UI-004). */
const HINT = {
  reply: 'Ответ на переписку — от имени персоны, в выбранном тоне',
  fix: 'Переписывает ваш черновик из поля ввода. Нового не сочиняет',
  recap: 'Досье по фану: кто он, на что тратил, о чём уже говорили',
  split: 'Ответ придёт серией из 2–3 сообщений. Вставлять и отправлять — по одному',
  flirt: 'Флирт — тепло, игра, притяжение',
  casual: 'Спокойный дружеский тон — без флирта и продаж',
} as const;
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
  it('[UI-002] is a toolbar: Reply with the capsule of its options — the four tones and, behind a seam, Split — then the other six actions in groups, «Ещё» and the two windows', () => {
    kit = mountDock(dockScenario(dockVm()));
    const strip = kit.$('.cg-strip') as HTMLElement;
    expect(strip.getAttribute('role')).toBe('toolbar');
    expect(strip.getAttribute('aria-label')).toBe('ChatGoose');
    expect(DOCK_ACTION_IDS).toEqual(['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'coach']);
    expect(buttons().map((element) => element.querySelector('.cg-act__t')?.textContent)).toEqual([
      ...['Reply', 'Casual', 'Flirt', 'Sell', 'Spice', 'Split', 'Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach', 'Ещё'],
      ...['Spenders', 'Новые'],
    ]);
    // Reply is the main action; the capsule stands right after it: the four tones are one named group, Split is behind the seam.
    expect(button('Reply').classList.contains('cg-act--main')).toBe(true);
    expect(kit.$('.cg-slot + .cg-tones')).not.toBeNull();
    expect(kit.$('.cg-tones__track')?.getAttribute('role')).toBe('group');
    expect(kit.$('.cg-tones__track')?.getAttribute('aria-label')).toBe('Тон');
    expect(kit.$$('.cg-tones__track .cg-act').map((element) => element.querySelector('.cg-act__t')?.textContent)).toEqual(['Casual', 'Flirt', 'Sell', 'Spice']);
    expect(kit.$$('.cg-tones__track .cg-tone__e').map(text)).toEqual(['😌', '😏', '💰', '🔥']);
    expect(kit.$$('.cg-tones > .cg-tones__seam + .cg-split')).toHaveLength(1);
    expect(kit.$$('.cg-slot--boards .cg-act').map((element) => element.querySelector('.cg-act__t')?.textContent)).toEqual(['Spenders', 'Новые']);
    // A seam opens every group after the first: Fix │ Hi · Ping │ Review · Recap · Coach.
    expect(kit.$$('.cg-strip__acts .cg-div + .cg-act').map((element) => element.querySelector('.cg-act__t')?.textContent)).toEqual(['Fix', 'Hi', 'Review']);
    // Review, Recap and Coach are the ones «Ещё» stands for on a narrow composer.
    expect(kit.$$('.cg-slot--two .cg-act').map(text)).toEqual(['Review⌘⇧B', 'Recap⌘⇧S', 'Coach⌘⇧C']);
    expect(kit.$('.cg-slot--more .cg-act')?.getAttribute('aria-haspopup')).toBe('menu');
    // There is no menu to open for a tone.
    expect(buttons().filter((element) => element.getAttribute('aria-haspopup') === 'menu')).toHaveLength(1);
    // No goose: the bar starts with Reply (decision X31).
    expect(kit.$('.cg-strip .cg-goose')).toBeNull();
    expect(kit.$('.cg-strip > *')?.classList.contains('cg-strip__acts')).toBe(true);
  });

  it('[UI-002] a narrow bar shows Review, Recap, Coach and the two windows as their icons: each chip carries its icon, the word stays its name', () => {
    kit = mountDock(dockScenario(dockVm()));
    const icons = kit.$$('.cg-act--ico');
    expect(icons.map((element) => element.querySelector('.cg-act__t')?.textContent)).toEqual(['Review', 'Recap', 'Coach', 'Spenders', 'Новые']);
    for (const chip of icons) expect(chip.querySelector(':scope > svg.cg-ico'), chip.textContent ?? '').not.toBeNull();
    // Nothing else in the bar turns into an icon.
    expect(kit.$$('.cg-act--ico').filter((element) => !element.closest('.cg-slot--two, .cg-slot--boards'))).toEqual([]);
  });

  it('[UI-012] outside an open chat there is no dock at all', () => {
    kit = mountDock(dockScenario({ ...dockVm(), visible: false }));
    expect(kit.$('.cg-dock')).toBeNull();
    expect(kit.$('.cg-strip')).toBeNull();
  });

  it('[UI-006] an enabled chip carries its key — a cap at its corner — and sets aria-keyshortcuts; labels follow the OS', () => {
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

  it('[UI-005] [UI-004] the hint names the action and its key and says in one sentence what it does; a busy chip says how to cancel', () => {
    kit = mountDock('streaming');
    expect(described(button('Reply'))).toBe('Reply — идёт генерация. Отмена ⌘.');
    kit.unmount();
    kit = mountDock(dockScenario(dockVm()));
    expect(described(button('Reply'))).toBe(`Reply  ⌘E\n${HINT.reply}`);
    expect(described(button('Split'))).toBe(`Split: ответ частями  ⌘⇧L\n${HINT.split}`);
    expect(described(button('Ещё'))).toBe('Review, Recap, Coach');
    // No `title` attribute anywhere: hints are ours.
    expect(kit.$$('[title]')).toEqual([]);
  });

  it('[AI-021] [UI-005] an unavailable action is aria-disabled, keeps focus, drops its key and says why', async () => {
    kit = mountDock(dockScenario(dockVm('ready', { actionsOptions: { gates: { fix: reason('needs-draft') } } })));
    const fix = button('Fix') as HTMLButtonElement;
    expect(fix.disabled).toBe(false);
    expect(fix.getAttribute('aria-disabled')).toBe('true');
    expect(fix.querySelector('kbd')).toBeNull();
    expect(fix.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(described(fix)).toBe(`Fix недоступен: сначала напишите черновик в поле ввода\n${HINT.fix}`);
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
      expect(described(other).split('\n')[0], label).toBe(`${label} недоступен: в этом чате уже идёт генерация`);
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
      for (const label of ['Reply', 'Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach']) expect(described(button(label)).split('\n')[0], `${status} ${label}`).toBe(`${label} недоступен: ${why}`);
      kit.unmount();
      kit = null;
    }
  });

  it('[UI-009] the capsule stays in the bar when everything is off: the tones and Split are unavailable with the same reason', () => {
    kit = mountDock(dockScenario(dockVm('no-binding')));
    for (const label of ['Casual', 'Flirt', 'Sell', 'Spice']) {
      expect(button(label).getAttribute('aria-disabled'), label).toBe('true');
      expect(described(button(label)), label).toBe('Тон недоступен: аккаунт не привязан к странице в хабе');
    }
    expect(button('Split').getAttribute('aria-disabled')).toBe('true');
    expect(described(button('Split'))).toBe('Split недоступен: аккаунт не привязан к странице в хабе');
    // No lock: nothing is generating.
    expect(kit.$('.cg-lock')).toBeNull();
  });

  it('[UI-010] the «Recap готов» point stands on Recap and on «Ещё»', () => {
    kit = mountDock(dockScenario(dockVm('ready', { actionsOptions: { recapReady: true } })));
    expect(button('Recap').querySelector('.cg-badge')?.getAttribute('data-accent-use')).toBe('recap-ready');
    expect(button('Ещё').querySelector('.cg-badge')).not.toBeNull();
    expect(button('Reply').querySelector('.cg-badge')).toBeNull();
    expect(described(button('Recap'))).toBe(`Recap  ⌘⇧S\n${HINT.recap}\nRecap готов`);
  });

  it('[UI-031] the quota shows only when little is left or nothing is: a count on the bar\'s frame over Reply\'s corner, its words in its own hint', () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(kit.$('.cg-quota')).toBeNull();
    kit.unmount();
    kit = mountDock(dockScenario(dockVm('ready', { quota: { remaining: 400, low: false, resetsAt: null } })));
    expect(kit.$('.cg-quota')).toBeNull();
    kit.unmount();
    kit = mountDock('quota-low');
    const low = kit.$('.cg-slot--reply > .cg-quota') as HTMLElement;
    expect(text(low)).toBe('12');
    expect(low.classList.contains('is-zero')).toBe(false);
    expect(described(low)).toMatch(/^Осталось 12 генераций AI на сегодня\. Обновится в \d\d:\d\d$/);
    // Reply keeps its own hint.
    expect(described(button('Reply'))).toBe(`Reply  ⌘E\n${HINT.reply}`);
    kit.unmount();
    // No reset time known: the words without it.
    kit = mountDock(dockScenario(dockVm('ready', { quota: { remaining: 12, low: true, resetsAt: null } })));
    expect(kit.$('.cg-quota')?.getAttribute('aria-label')).toBe('AI: осталось 12');
    kit.unmount();
    kit = mountDock('quota-zero');
    const zero = kit.$('.cg-slot--reply > .cg-quota') as HTMLElement;
    expect(text(zero)).toBe('0');
    expect(zero.classList.contains('is-zero')).toBe(true);
    expect(described(zero)).toContain('Квота AI: 0');
    expect(described(button('Reply')).split('\n')[0]).toMatch(/^Reply недоступен: дневная квота AI исчерпана, обновится в \d\d:\d\d$/);
    kit.unmount();
    // The count speaks whatever the hints setting is, as the goose's hint did.
    kit = mountDock(dockScenario(dockVm('ready', { hints: false, quota: { remaining: 12, low: true, resetsAt: null } })));
    expect(described(kit.$('.cg-quota') as HTMLElement)).toBe('AI: осталось 12');
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

  it('a chosen tone, a running generation and a low quota take no width: the persona keeps its place, the bar carries no state class but the status', () => {
    const classOf = (vm: Parameters<typeof dockScenario>[0]): string => {
      kit?.unmount();
      kit = mountDock(dockScenario(vm));
      expect(text(kit.$('.cg-persona'))).toBe('Лора · VIP');
      return kit.$('.cg-strip')?.className ?? '';
    };
    expect(classOf(dockVm())).toBe('cg-strip');
    expect(classOf(dockVm('ready', { options: { ...dockVm().options, tone: 'flirty' } }))).toBe('cg-strip');
    expect(classOf(dockVm('ready', { quota: { remaining: 12, low: true, resetsAt: null } }))).toBe('cg-strip');
    expect(classOf(scenarioById('streaming').views[0]?.vm as ReturnType<typeof dockVm>)).toBe('cg-strip');
    expect(classOf(dockVm('loading-chat'))).toBe('cg-strip has-status');
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

  it('[AI-002] [AI-005] a tone is a cell of the capsule at every width: one click runs Reply in that tone, with no menu to open', async () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(TONES).toEqual(['casual', 'flirty', 'upsell', 'spicy']);
    expect(button('Flirt').getAttribute('aria-pressed')).toBe('false');
    expect(described(button('Flirt'))).toBe(`😏 Reply · Тон: Flirt\n${HINT.flirt}\nТон на один ответ  ⌘⇧O`);
    await flush(() => button('Flirt').click());
    await flush(() => button('Spice').click());
    await flush(() => button('Sell').click());
    expect(kit.client.dispatched).toEqual([
      { type: 'Generate', targetHandle: HANDLE, feature: 'reply', options: { tone: 'flirty' } },
      { type: 'Generate', targetHandle: HANDLE, feature: 'reply', options: { tone: 'spicy' } },
      { type: 'Generate', targetHandle: HANDLE, feature: 'reply', options: { tone: 'upsell' } },
    ]);
    expect(kit.$('[role="menu"]')).toBeNull();
  });

  it('[AI-006] the chosen tone is the pressed cell; a click on it takes the tone off and runs nothing, another tone still runs Reply in it', async () => {
    kit = mountDock(dockScenario(dockVm('ready', { options: { ...dockVm().options, tone: 'flirty' } })));
    expect(['Casual', 'Flirt', 'Sell', 'Spice'].map((label) => button(label).getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
    expect(described(button('Flirt'))).toBe(`😏 Тон: Flirt\n${HINT.flirt}\nВыбран. Клик снимает тон`);
    await flush(() => button('Flirt').click());
    await flush(() => button('Casual').click());
    expect(kit.client.dispatched).toEqual([
      { type: 'SetTone', targetHandle: HANDLE, tone: null },
      { type: 'Generate', targetHandle: HANDLE, feature: 'reply', options: { tone: 'casual' } },
    ]);
  });

  it('[AI-005] [AI-009] a tone with Reply unavailable is only remembered; while a generation runs the four are off with the reason, and one lock stands in the capsule', async () => {
    kit = mountDock(dockScenario(dockVm('ready', { actionsOptions: { gates: { reply: reason('no-history') } } })));
    expect(described(button('Casual'))).toBe(`😌 Тон: Casual\n${HINT.casual}\nТон на один ответ  ⌘⇧O`);
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
    expect(described(button('Spenders'))).toMatch(/^Spenders {2}\S+\nКто сколько потратил: полки, превью переписки, статистика$/);
    // X49: «Новые» has its key now, next to Spenders'.
    expect(described(button('Новые'))).toBe('Новые  ⌘⇧U\nНовые подписчики: с кем ещё не поздоровались');
    await flush(() => button('Новые').click());
    await flush(() => button('Spenders').click());
    expect(kit.client.dispatched).toEqual([
      { type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: true } },
      { type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } },
    ]);
  });

  it('[AI-009] Split is locked while a generation runs: the reason, nothing asked', async () => {
    kit = mountDock('streaming');
    const option = button('Split');
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(described(option)).toBe('Split нельзя менять, пока идёт генерация');
    await flush(() => option.click());
    await flush(() => option.dispatchEvent(keydown('Enter')));
    expect(kit.$('[role="menu"]')).toBeNull();
    expect(kit.client.dispatched).toEqual([]);
  });

  it('[AI-010] Split is a pressed-state cell of the capsule that writes the setting; for Recap and Review it is off: «это не сообщение фану»', async () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(button('Split').classList.contains('cg-split')).toBe(true);
    expect(button('Split').getAttribute('aria-pressed')).toBe('false');
    await flush(() => button('Split').click());
    expect(kit.client.dispatched).toEqual([{ type: 'SetPreference', key: 'generation.split', value: true }]);
    kit.unmount();
    kit = mountDock(dockScenario(dockVm('ready', { analysis: 'recap', options: { ...dockVm().options, split: true, splitReason: reason('not-a-message') } })));
    expect(button('Split').getAttribute('aria-pressed')).toBe('true');
    expect(button('Split').getAttribute('aria-disabled')).toBe('true');
    expect(described(button('Split'))).toBe('Split: это не сообщение фану');
  });

  it('[UI-003] Review, Recap and Coach live in our bar — in «Ещё» on a narrow composer, a menu with their keys; an item does what its chip does', async () => {
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

  it('is one tab stop: arrows, Home and End move between its chips (ui-design §6.3, §6.4)', async () => {
    kit = mountDock(dockScenario(dockVm()));
    expect(buttons().map((element) => element.tabIndex)).toEqual([0, ...Array.from({ length: 14 }, () => -1)]);
    button('Reply').focus();
    // Right of Reply stands its capsule — the tones, then Split — then the next action.
    await flush(() => button('Reply').dispatchEvent(keydown('ArrowRight')));
    expect(kit.root.activeElement).toBe(button('Casual'));
    button('Spice').focus();
    await flush(() => button('Spice').dispatchEvent(keydown('ArrowRight')));
    expect(kit.root.activeElement).toBe(button('Split'));
    await flush(() => button('Split').dispatchEvent(keydown('ArrowRight')));
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
    await flush(() => button('Новые').dispatchEvent(keydown('ArrowLeft')));
    await flush(() => button('Spenders').dispatchEvent(keydown('ArrowLeft')));
    expect(kit.root.activeElement).toBe(button('Ещё'));
    // The cells of the capsule are stops of the same toolbar, and the tab stop follows focus onto them.
    button('Sell').focus();
    await flush(() => undefined);
    expect(button('Sell').tabIndex).toBe(0);
    await flush(() => button('Sell').dispatchEvent(keydown('Home')));
    expect(kit.root.activeElement).toBe(button('Reply'));
    // ↓ on «Ещё» opens its menu.
    button('Ещё').focus();
    await flush(() => button('Ещё').dispatchEvent(keydown('ArrowDown')));
    expect(kit.$('[role="menu"]')).not.toBeNull();
  });

  it('[UI-004] with hints off descriptions are gone, reasons stay — bare, without the sentence of the hint', () => {
    kit = mountDock(dockScenario(dockVm('ready', { hints: false, actionsOptions: { gates: { fix: reason('needs-draft') } } })));
    expect(button('Reply').hasAttribute('aria-describedby')).toBe(false);
    expect(button('Flirt').hasAttribute('aria-describedby')).toBe(false);
    expect(described(button('Fix'))).toBe('Fix недоступен: сначала напишите черновик в поле ввода');
    // A chip a narrow bar shows as its icon alone keeps its name in the hint.
    expect(described(button('Recap'))).toBe('Recap');
    expect(described(button('Spenders'))).toBe('Spenders');
  });

  it('builds every action from the view model: with no target nothing is asked', async () => {
    kit = mountDock(dockScenario(dockVm('ready', { targetHandle: null, actions: dockActions(ctx) })));
    await flush(() => button('Reply').click());
    await flush(() => button('Casual').click());
    expect(kit.client.dispatched).toEqual([]);
  });

  it('[UI-031] «по Москве» is Moscow\'s clock: the quota resets at 00:00 UTC, the hint of a zero quota says 03:00 whatever zone the port prints in', () => {
    // The stand's port prints in UTC — a chatter who is not in Moscow.
    const resetsAt = iso(Date.UTC(2026, 9, 4, 0, 0, 0));
    kit = mountDock(dockScenario(dockVm('ready', { quota: { remaining: 0, low: true, resetsAt } })));
    expect(described(kit.$('.cg-quota') as HTMLElement)).toBe('Квота AI: 0\nДневная квота AI исчерпана. Обновится в 03:00 по Москве');
    kit.unmount();
    // The low-quota words name no zone: it is the chatter's own time.
    kit = mountDock(dockScenario(dockVm('ready', { quota: { remaining: 12, low: true, resetsAt } })));
    expect(described(kit.$('.cg-quota') as HTMLElement)).toBe('Осталось 12 генераций AI на сегодня. Обновится в 00:00');
  });
});

describe('[R20-F4] the bar draws its chips from data (`DockVM.chips`)', () => {
  const chipTexts = (): (string | null | undefined)[] => buttons().map((element) => element.querySelector('.cg-act__t')?.textContent);
  const CAPSULE = ['Casual', 'Flirt', 'Sell', 'Spice', 'Split'];

  it('[UI-002] the scenarios’ chips are the ones the dock’s controller builds for ChatSpace: the seven actions and the two windows', () => {
    const vm = dockVm();
    expect(vm.chips?.map((chip) => `${chip.group}:${chip.id}`)).toEqual(['reply:reply', 'draft:fix', 'openers:hi', 'openers:ping', 'analysis:review', 'analysis:recap', 'analysis:coach', 'windows:spenders', 'windows:newcomers']);
    // Each of the seven carries the state of `actions`.
    for (const id of DOCK_ACTION_IDS) expect(vm.chips?.find((chip) => chip.id === id), id).toMatchObject(vm.actions[id]);
  });

  it('a chip that is not in the data is not drawn — and nothing stands in its place; a seam opens each group that is left', () => {
    const vm = dockVm();
    const without = (ids: readonly string[]) => dockVm('ready', { chips: (vm.chips ?? []).filter((chip) => !ids.includes(chip.id)) });
    kit = mountDock(dockScenario(without(['fix', 'recap', 'newcomers'])));
    expect(chipTexts()).toEqual(['Reply', ...CAPSULE, 'Hi', 'Ping', 'Review', 'Coach', 'Ещё', 'Spenders']);
    // The draft group is gone with its one chip: the seams are the openers' and the analysis'.
    expect(kit.$$('.cg-strip__acts .cg-div + .cg-act').map((element) => element.querySelector('.cg-act__t')?.textContent)).toEqual(['Hi', 'Review']);
    expect(kit.$$('.cg-slot--two .cg-act').map((element) => element.querySelector('.cg-act__t')?.textContent)).toEqual(['Review', 'Coach']);
    kit.unmount();
    // No window on this site: the right block has no slot for them.
    kit = mountDock(dockScenario(without(['spenders', 'newcomers'])));
    expect(kit.$('.cg-slot--boards')).toBeNull();
    expect(chipTexts()).toEqual(['Reply', ...CAPSULE, 'Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach', 'Ещё']);
    kit.unmount();
    // Without Reply there is no capsule of its options and no main chip: they are Reply's group's.
    kit = mountDock(dockScenario(without(['reply'])));
    expect(chipTexts()).toEqual(['Fix', 'Hi', 'Ping', 'Review', 'Recap', 'Coach', 'Ещё', 'Spenders', 'Новые']);
    expect(kit.$('.cg-tones')).toBeNull();
    expect(kit.$('.cg-act--main')).toBeNull();
    // The first chip of the bar has no seam before it, whichever group it is of.
    expect(kit.$$('.cg-strip__acts .cg-div + .cg-act').map((element) => element.querySelector('.cg-act__t')?.textContent)).toEqual(['Hi', 'Review']);
  });

  it('a model without chips draws none: the bar is its right block alone', () => {
    const { chips: _chips, ...bare } = dockVm();
    kit = mountDock(dockScenario(bare));
    expect(chipTexts()).toEqual(['Ещё']);
    expect(kit.$('.cg-strip')?.getAttribute('role')).toBe('toolbar');
  });

  it('a chip of another feature stands where its group and its place in the data put it, with its own words, icon and click — the bar has no branch for it', async () => {
    const vm = dockVm();
    const extra = { id: 'voice', group: 'draft', icon: null, label: { key: 'common.copy' }, hint: { key: 'dock.hint.fix' }, action: { type: 'Navigate', to: { kind: 'surface', surface: 'cheatsheet', open: true } }, enabled: true, busy: false, active: false, reason: null, hotkey: null, badge: null } as const;
    const chips = (vm.chips ?? []).flatMap((chip) => (chip.id === 'fix' ? [chip, extra] : [chip]));
    kit = mountDock(dockScenario(dockVm('ready', { chips })));
    expect(chipTexts()).toEqual(['Reply', ...CAPSULE, 'Fix', 'Копировать', 'Hi', 'Ping', 'Review', 'Recap', 'Coach', 'Ещё', 'Spenders', 'Новые']);
    // The same group as Fix: no seam between them, and the next group still opens with one.
    expect(kit.$$('.cg-strip__acts .cg-div + .cg-act').map((element) => element.querySelector('.cg-act__t')?.textContent)).toEqual(['Fix', 'Hi', 'Review']);
    expect(described(button('Копировать'))).toBe(`Копировать\n${HINT.fix}`);
    await flush(() => button('Копировать').click());
    expect(kit.client.dispatched).toEqual([extra.action]);
    // Arrows walk it as any other chip: one tab stop for the whole bar.
    button('Fix').focus();
    await flush(() => button('Fix').dispatchEvent(keydown('ArrowRight')));
    expect(kit.root.activeElement).toBe(button('Копировать'));
  });

  it('a click asks for what the chip says, and for nothing when the chip says nothing', async () => {
    const vm = dockVm();
    const cheatsheet = { type: 'Navigate', to: { kind: 'surface', surface: 'cheatsheet', open: true } } as const;
    const chips = (vm.chips ?? []).map((chip) => (chip.id === 'ping' ? { ...chip, action: cheatsheet } : chip.id === 'hi' ? { ...chip, action: null } : chip));
    kit = mountDock(dockScenario(dockVm('ready', { chips })));
    await flush(() => button('Ping').click());
    await flush(() => button('Hi').click());
    await flush(() => button('Spenders').click());
    expect(kit.client.dispatched).toEqual([cheatsheet, { type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } }]);
  });
});
