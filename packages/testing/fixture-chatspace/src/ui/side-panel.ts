// ChatSpace's own right side of a chat (live check 2026-10-08, 0.195; sizes
// and tabs of 0.233.0, 2026-10-28: `SidePanel` 364 px by default, its rail
// `SidePanelNav` 64 px): next to the conversation a panel of the fan
// («Траты», «Предпочтения», «Списки», «Профиль», «Подписка») and, at the far
// right, an icon rail whose buttons open and close it. Off by default — the
// stand then has the 0.172 layout, where the conversation and its composer
// reach the window's right edge. `__stand.setSidePanel` switches it: `none`
// (0.172), `closed` (rail only: the composer reaches the rail), `open`.

import { defineComponent, h, reactive, type VNode } from 'vue';

import { record } from '../journal';

export type SidePanelState = 'none' | 'closed' | 'open';

const SIDE_PANEL_KEY = 'chat-space:stand-side-panel';

export const sidePanel = reactive<{ state: SidePanelState }>({ state: 'none' });

const isState = (value: unknown): value is SidePanelState => value === 'none' || value === 'closed' || value === 'open';

export function installSidePanel(): void {
  try {
    const stored = localStorage.getItem(SIDE_PANEL_KEY);
    if (isState(stored)) sidePanel.state = stored;
  } catch {
    // The default.
  }
}

export function setSidePanel(state: SidePanelState): void {
  sidePanel.state = state;
  localStorage.setItem(SIDE_PANEL_KEY, state);
  record('side-panel', { state });
}

const SECTIONS: readonly (readonly [title: string, rows: readonly (readonly [string, string])[]])[] = [
  ['Траты', [['Всего потрачено', '$0'], ['Последний платёж', '—'], ['PPV', '—'], ['Чаевые', '—'], ['Buying Power', 'н/д'], ['Риск чарджбэка', 'Низкий']]],
  ['Предпочтения', [['Темы', 'Выберите темы или занятия']]],
  ['Списки', [['Список', 'тест рассылок']]],
  ['Профиль', [['Био', 'Открыть'], ['День рождения и возраст', 'Добавить'], ['Местоположение', 'Добавить страну'], ['Время креатора', '6:35 pm'], ['Последний ответ', '—'], ['Последнее прочтение', '—'], ['Источник трафика', 'Добавить']]],
  ['Подписка', [['Подписан', '—'], ['Автопродление', '—']]],
];

/** The fan's panel of ChatSpace, 364 px next to the conversation; its own content scrolls. */
export const ChatDetailsPanel = defineComponent({
  name: 'ChatDetailsPanel',
  setup: () => (): VNode =>
    h(
      'aside',
      { class: 'chat-details-panel', 'data-stand-side-panel': '', 'aria-label': 'Fan details' },
      SECTIONS.map(([title, rows]) =>
        h('section', { key: title, class: 'chat-details-panel__section' }, [
          h('h3', { class: 'chat-details-panel__title' }, title),
          ...rows.map(([label, value]) => h('div', { key: label, class: 'chat-details-panel__row' }, [h('span', label), h('span', { class: 'chat-details-panel__value' }, value)])),
        ]),
      ),
    ),
});

/** The icon rail at the far right: its first button opens and closes the panel. */
export const SidePanelRail = defineComponent({
  name: 'SidePanelRail',
  setup: () => (): VNode =>
    h('nav', { class: 'chat-side-rail', 'data-stand-side-rail': '', 'aria-label': 'Side panel' }, [
      h('button', { type: 'button', class: ['chat-side-rail__item', sidePanel.state === 'open' ? 'chat-side-rail__item--on' : ''], 'data-stand-side-toggle': '', onClick: () => setSidePanel(sidePanel.state === 'open' ? 'closed' : 'open') }, 'Инсайты'),
      ...['Продажи', 'Шаблоны', 'Заметки', 'Сводка', 'AI'].map((label) => h('button', { key: label, type: 'button', class: 'chat-side-rail__item' }, label)),
    ]),
});
