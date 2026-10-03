import { useState } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type HotkeyLabel } from '@cg/contracts';
import {
  ActionButton,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Divider,
  Hints,
  Menu,
  MenuAnchor,
  Segmented,
  StripButton,
  Tabs,
  TOOLTIP_TIMING,
  hotkeyText,
  menuTriggerKeys,
} from '@cg/ui/kit';

import { button, ctxOf, hotkey, reason } from '../scenarios/app-client';
import { type MountedKit, flush, mountKit, mountKitSettled } from './harness';

const ctx = ctxOf({ lang: 'ru', platform: 'mac' });
let kit: MountedKit | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
  vi.useRealTimers();
});

const key = (event: string, init: KeyboardEventInit = {}): KeyboardEvent => new KeyboardEvent('keydown', { key: event, bubbles: true, cancelable: true, ...init });

describe('[UI-006] buttons: variants, key labels for the OS, unavailable with a reason', () => {
  it('prints the key after the text and sets aria-keyshortcuts', () => {
    kit = mountKit(() => (
      <>
        <Button label="Ещё раз" hotkey={hotkey(ctx, 'reply')} class="cg-a" />
        <Button label="Отправить" variant="send" class="cg-b" />
        <Button label="Копировать" icon="copy" iconOnly variant="quiet" class="cg-c" />
        <Button label="Скрыть" size="sm" variant="quiet" hotkey="Esc" class="cg-d" />
      </>
    ));
    const again = kit.$('.cg-a') as HTMLElement;
    expect(again.querySelector('kbd')?.textContent).toBe('⌘E');
    expect(again.getAttribute('aria-keyshortcuts')).toBe('Meta+E');
    expect(again.getAttribute('type')).toBe('button');
    expect(kit.$('.cg-b')?.classList.contains('cg-btn--send')).toBe(true);
    const icon = kit.$('.cg-c') as HTMLElement;
    expect(icon.getAttribute('aria-label')).toBe('Копировать');
    expect(icon.querySelector('svg.cg-ico')).not.toBeNull();
    expect(icon.querySelector('kbd')).toBeNull();
    expect(kit.$('.cg-d')?.classList.contains('cg-btn--sm')).toBe(true);
    expect(kit.$('.cg-d')?.hasAttribute('aria-keyshortcuts')).toBe(false);
  });

  it('a key the browser keeps is never shown as working; its fallback is', () => {
    const reserved: HotkeyLabel = { display: 'Ctrl+U', aria: 'Control+U', delivery: 'reserved', fallback: { display: 'Alt+U', aria: 'Alt+U', delivery: 'delivered' } };
    expect(hotkeyText(reserved)).toEqual({ display: 'Alt+U', aria: 'Alt+U' });
    expect(hotkeyText({ ...reserved, fallback: null })).toBeNull();
    expect(hotkeyText({ display: '⌘U', aria: 'Meta+U', delivery: 'unverified', fallback: { display: '⌥U', aria: 'Alt+U', delivery: 'delivered' } })).toEqual({ display: '⌘U', aria: 'Meta+U Alt+U' });
    expect(hotkeyText('')).toBeNull();
    expect(hotkeyText(null)).toBeNull();
  });

  it('unavailable: aria-disabled (focus stays), no key label, the reason as the description; a click does nothing', async () => {
    const click = vi.fn();
    kit = mountKit(() => <Button label="Повторить" hotkey={hotkey(ctx, 'reply')} reason="Повторить можно через 24 с" onClick={click} variant="line" />);
    const retry = kit.$('.cg-btn') as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(retry.hasAttribute('aria-keyshortcuts')).toBe(false);
    const described = kit.root.getElementById(retry.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe('Повторить можно через 24 с');
    expect(described?.hidden).toBe(true);
    await flush(() => retry.click());
    expect(click).not.toHaveBeenCalled();
  });

  it('busy: a spinner instead of the key, aria-busy, clicks ignored', async () => {
    const click = vi.fn();
    kit = mountKit(() => <Button label="Вставить" hotkey="↵" busy onClick={click} />);
    const insert = kit.$('.cg-btn') as HTMLElement;
    expect(insert.querySelector('.cg-spin')).not.toBeNull();
    expect(insert.querySelector('kbd')).toBeNull();
    expect(insert.getAttribute('aria-busy')).toBe('true');
    await flush(() => insert.click());
    expect(click).not.toHaveBeenCalled();
  });

  it('an ActionButton dispatches the controller’s action unchanged, and explains why it is off', async () => {
    const vm = button('common.retry', { type: 'RecheckStatus' });
    const off = button('common.retry', { type: 'RecheckStatus' }, { enabled: false, reason: reason('hub-down') });
    const silent = button('common.retry', { type: 'RecheckStatus' }, { enabled: false, reason: null });
    kit = mountKit(() => (
      <>
        <ActionButton vm={vm} icon="refresh" size="sm" class="cg-on" />
        <ActionButton vm={off} class="cg-off" />
        <ActionButton vm={silent} class="cg-silent" />
      </>
    ));
    await flush(() => (kit?.$('.cg-on') as HTMLElement).click());
    await flush(() => (kit?.$('.cg-off') as HTMLElement).click());
    expect(kit.client.dispatched).toEqual([{ type: 'RecheckStatus' }]);
    const describedBy = kit.$('.cg-off')?.getAttribute('aria-describedby') ?? '';
    expect(kit.root.getElementById(describedBy)?.textContent).toMatch(/хаб недоступен/);
    expect(kit.root.getElementById(kit.$('.cg-silent')?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('неизвестно');
  });

  it('[UI-004] the tooltip bubble: shown at once on keyboard focus, on the 970 layer, gone on Esc; hints off keep only reasons', async () => {
    kit = mountKit(() => (
      <>
        <Button label="Ещё раз" tooltip="Сгенерировать заново" class="cg-a" />
        <Hints value={false}>
          <Button label="Скрыть" tooltip="Скрыть результат" class="cg-b" />
          <Button label="Fix" reason="Fix недоступен: нужен черновик" class="cg-c" />
        </Hints>
      </>
    ));
    const again = kit.$('.cg-a') as HTMLElement;
    vi.spyOn(again, 'matches').mockImplementation((selector: string) => selector === ':focus-visible');
    await flush(() => again.dispatchEvent(new FocusEvent('focus')));
    const tip = kit.$('.cg-tip') as HTMLElement;
    expect(tip.textContent).toBe('Сгенерировать заново');
    expect(tip.getAttribute('role')).toBe('tooltip');
    await flush(() => again.dispatchEvent(key('Escape')));
    expect(kit.$('.cg-tip')).toBeNull();
    expect(kit.$('.cg-b')?.hasAttribute('aria-describedby')).toBe(false);
    expect(kit.$('.cg-c')?.hasAttribute('aria-describedby')).toBe(true);
  });

  it('[UI-004] hover shows the tooltip after 1 s, never as a `title`', async () => {
    vi.useFakeTimers();
    kit = mountKit(() => <Button label="Ещё раз" tooltip="Сгенерировать заново" />);
    const again = kit.$('.cg-btn') as HTMLElement;
    expect(again.hasAttribute('title')).toBe(false);
    await flush(() => again.dispatchEvent(new MouseEvent('mouseenter')));
    expect(kit.$('.cg-tip')).toBeNull();
    await flush(() => vi.advanceTimersByTime(TOOLTIP_TIMING.hoverDelayMs));
    expect(kit.$('.cg-tip')?.textContent).toBe('Сгенерировать заново');
    await flush(() => again.dispatchEvent(new MouseEvent('mouseleave')));
    expect(kit.$('.cg-tip')).toBeNull();
  });
});

describe('the dock strip button (ui-design §4.1)', () => {
  it('active, busy, unavailable without its key, the «Recap готов» point, pressed and menu states', () => {
    kit = mountKit(() => (
      <div role="toolbar">
        <StripButton label="Reply" hotkey={hotkey(ctx, 'reply')} active class="cg-1" />
        <Divider />
        <StripButton label="Fix" hotkey={hotkey(ctx, 'fix')} busy class="cg-2" />
        <StripButton label="Hi" hotkey={hotkey(ctx, 'hi')} reason="Hi недоступен: в этом чате уже идёт генерация" class="cg-3" />
        <StripButton label="Recap" ready class="cg-4" />
        <StripButton label="Split" pressed class="cg-5" />
        <StripButton label="Тон" expanded haspopup="menu" tabIndex={-1} class="cg-6" />
      </div>
    ));
    expect(kit.$('.cg-1')?.classList.contains('is-active')).toBe(true);
    expect(kit.$('.cg-2')?.getAttribute('aria-busy')).toBe('true');
    expect(kit.$('.cg-3')?.getAttribute('aria-disabled')).toBe('true');
    expect(kit.$('.cg-3 kbd')).toBeNull();
    expect(kit.$('.cg-3')?.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(kit.$('.cg-4 .cg-badge')?.getAttribute('data-accent-use')).toBe('recap-ready');
    expect(kit.$('.cg-5')?.getAttribute('aria-pressed')).toBe('true');
    expect(kit.$('.cg-6')?.getAttribute('aria-expanded')).toBe('true');
    expect(kit.$('.cg-6')?.getAttribute('aria-haspopup')).toBe('menu');
    expect(kit.$('.cg-div')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('menus (ui-design §4.1 «Тон», «Ещё»; §6.4)', () => {
  function ToneMenu() {
    const [open, setOpen] = useState(true);
    const [tone, setTone] = useState('flirty');
    let trigger: HTMLButtonElement | null = null;
    return (
      <MenuAnchor>
        <StripButton label="Тон" expanded={open} haspopup="menu" buttonRef={(node) => {
            trigger = node;
          }} onClick={() => setOpen(true)} onKeyDown={(event) => menuTriggerKeys(event, () => setOpen(true))} class="cg-trigger" />
        <Menu
          open={open}
          kind="radio"
          label="Тон"
          caption={{ text: 'Тон на один ответ', hint: '⌘⇧O' }}
          align="end"
          items={[
            { id: 'casual', label: 'Casual', checked: tone === 'casual' },
            { id: 'flirty', label: 'Flirt', checked: tone === 'flirty' },
            { id: 'upsell', label: 'Sell', checked: tone === 'upsell', reason: 'Недоступно' },
            { id: 'none', label: 'Без тона', checked: false, hint: '—' },
          ]}
          onSelect={setTone}
          onClose={() => setOpen(false)}
          returnFocusTo={() => trigger}
        />
        <span class="cg-tone">{tone}</span>
      </MenuAnchor>
    );
  }

  it('opens on the checked item; arrows move; Enter chooses; focus goes back to the trigger', async () => {
    kit = await mountKitSettled(ToneMenu);
    const menu = kit.$('[role="menu"]') as HTMLElement;
    const items = kit.$$('[role="menuitemradio"]');
    expect(menu.classList.contains('cg-menu--end')).toBe(true);
    expect(kit.$('.cg-menu__cap')?.textContent).toBe('Тон на один ответ⌘⇧O');
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);
    expect(kit.root.activeElement).toBe(items[1]);
    await flush(() => items[1]?.dispatchEvent(key('ArrowDown')));
    expect(kit.root.activeElement).toBe(items[2]);
    await flush(() => items[2]?.dispatchEvent(key('Enter')));
    expect(kit.$('.cg-tone')?.textContent).toBe('flirty');
    await flush(() => items[2]?.dispatchEvent(key('End')));
    await flush(() => items[0]?.dispatchEvent(key('Home')));
    await flush(() => items[0]?.dispatchEvent(key(' ')));
    expect(kit.$('.cg-tone')?.textContent).toBe('casual');
    expect(kit.$('[role="menu"]')).toBeNull();
    expect(kit.root.activeElement).toBe(kit.$('.cg-trigger'));
  });

  it('Esc closes and returns focus; a press outside closes; Tab closes without stealing focus', async () => {
    kit = await mountKitSettled(ToneMenu);
    await flush(() => kit?.$$('[role="menuitemradio"]')[0]?.dispatchEvent(key('Escape')));
    expect(kit.$('[role="menu"]')).toBeNull();
    expect(kit.root.activeElement).toBe(kit.$('.cg-trigger'));
    await flush(() => kit?.$('.cg-trigger')?.dispatchEvent(key('ArrowDown')));
    expect(kit.$('[role="menu"]')).not.toBeNull();
    await flush(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    });
    expect(kit.$('[role="menu"]')).toBeNull();
    await flush(() => kit?.$('.cg-trigger')?.dispatchEvent(key('Enter')));
    await flush(() => kit?.$$('[role="menuitemradio"]')[0]?.dispatchEvent(key('Tab')));
    expect(kit.$('[role="menu"]')).toBeNull();
  });
});

describe('dialogs (architecture.md §10.1: modal windows hold focus and give it back)', () => {
  it('the confirmation dialog focuses «Отмена», traps Tab, answers, and gives focus back', async () => {
    const answers: string[] = [];
    function Asker() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button class="cg-opener" onClick={() => setOpen(true)}>
            open
          </button>
          <ConfirmDialog
            request={open ? { title: { key: 'common.cancel' }, body: { key: 'common.empty' }, confirm: { key: 'common.retry' }, cancel: { key: 'common.cancel' }, tone: 'destructive' } : null}
            onAnswer={(answer) => {
              answers.push(answer);
              setOpen(false);
            }}
          />
        </>
      );
    }
    kit = mountKit(Asker, { kind: 'palette' });
    const opener = kit.$('.cg-opener') as HTMLElement;
    opener.focus();
    await flush(() => opener.click());
    const dialog = kit.$('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-label')).toBe('Отмена');
    expect(kit.$('.cg-scrim')).not.toBeNull();
    const [cancel, confirm] = kit.$$('.cg-confirm-dlg__acts .cg-btn');
    expect(kit.root.activeElement).toBe(cancel);
    await flush(() => {
      confirm?.focus();
      dialog.dispatchEvent(key('Tab'));
    });
    expect(kit.root.activeElement).toBe(cancel);
    await flush(() => confirm?.click());
    expect(answers).toEqual(['confirm']);
    expect(kit.$('[role="dialog"]')).toBeNull();
    expect(kit.root.activeElement).toBe(opener);
    await flush(() => opener.click());
    await flush(() => kit?.$('.cg-scrim')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(answers).toEqual(['confirm', 'cancel']);
  });

  it('closing a window whose opener is outside our root asks the host side to return focus', async () => {
    const restore = vi.fn(() => true);
    function Win() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} label="Палитра" onClose={() => setOpen(false)} size="wide">
          <input class="cg-field" />
        </Dialog>
      );
    }
    kit = mountKit(Win, { kind: 'palette' });
    Object.assign(kit.deps.focus, { restore });
    expect(kit.root.activeElement).toBe(kit.$('.cg-field'));
    await flush(() => kit?.$('.cg-field')?.dispatchEvent(key('Escape')));
    expect(kit.$('[role="dialog"]')).toBeNull();
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('a re-render while open does not move focus or return it early', async () => {
    let bump: () => void = () => undefined;
    function Win() {
      const [n, setN] = useState(0);
      bump = () => setN((value) => value + 1);
      return (
        <Dialog open label={`Окно ${n}`} onClose={() => undefined} initialFocus={() => null}>
          <button class="cg-x1">1</button>
          <button class="cg-x2">2</button>
        </Dialog>
      );
    }
    kit = mountKit(Win, { kind: 'palette' });
    (kit.$('.cg-x2') as HTMLElement).focus();
    await flush(() => bump());
    expect(kit.root.activeElement).toBe(kit.$('.cg-x2'));
    expect(kit.$('[role="dialog"]')?.getAttribute('aria-label')).toBe('Окно 1');
  });
});

describe('segments, check boxes and tabs (ui-design §6.1: aria-pressed, role=checkbox, tablist)', () => {
  beforeEach(() => undefined);

  it('a segment presses one value and refuses an unavailable one', async () => {
    const change = vi.fn();
    kit = mountKit(() => (
      <Segmented
        label="Длина"
        value="short"
        onChange={change}
        options={[
          { value: 'short', label: 'Коротко' },
          { value: 'full', label: 'Полностью' },
          { value: 'off', label: 'Нет', reason: 'Недоступно' },
        ]}
      />
    ));
    const [short, full, off] = kit.$$('.cg-seg__b');
    expect(kit.$('.cg-seg')?.getAttribute('role')).toBe('group');
    expect([short, full].map((b) => b?.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    await flush(() => short?.click());
    await flush(() => off?.click());
    await flush(() => full?.click());
    expect(change.mock.calls).toEqual([['full']]);
  });

  it('Split is an aria-pressed toggle; a settings flag is a checkbox with its state word', async () => {
    const split = vi.fn();
    const flag = vi.fn();
    kit = mountKit(() => (
      <>
        <Checkbox label="Split" semantics="toggle" checked onChange={split} tooltip="Split: ответ частями" />
        <Checkbox label="Подсказки" size={14} checked={false} onChange={flag} stateWord="Выключено" />
        <Checkbox label="Split" semantics="toggle" checked={false} onChange={split} reason="Split нельзя менять, пока идёт генерация" />
      </>
    ));
    const [toggle, box, locked] = kit.$$('.cg-check');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(box?.getAttribute('role')).toBe('checkbox');
    expect(box?.getAttribute('aria-checked')).toBe('false');
    expect(box?.getAttribute('aria-label')).toBe('Подсказки');
    expect(box?.textContent).toBe('Выключено');
    await flush(() => toggle?.click());
    await flush(() => box?.click());
    await flush(() => locked?.click());
    expect(split.mock.calls).toEqual([[false]]);
    expect(flag.mock.calls).toEqual([[true]]);
    expect(locked?.getAttribute('aria-disabled')).toBe('true');
  });

  it('tabs: one tab stop, arrows move and select', async () => {
    function Period() {
      const [value, setValue] = useState<'all' | 'd30' | 'd7'>('all');
      return (
        <Tabs
          label="Период"
          idPrefix="cg-period"
          value={value}
          onChange={setValue}
          tabs={[
            { value: 'all', label: 'Всё время' },
            { value: 'd30', label: '30 дней' },
            { value: 'd7', label: '7 дней' },
          ]}
        />
      );
    }
    kit = mountKit(Period);
    const tabs = kit.$$('[role="tab"]');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[0]?.getAttribute('aria-controls')).toBe('cg-period-all');
    await flush(() => tabs[0]?.dispatchEvent(key('ArrowLeft')));
    expect(kit.$$('[role="tab"]').map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect(kit.root.activeElement).toBe(kit.$$('[role="tab"]')[2]);
    await flush(() => kit?.$$('[role="tab"]')[0]?.click());
    expect(kit.$$('[role="tab"]')[0]?.getAttribute('aria-selected')).toBe('true');
    await flush(() => kit?.$$('[role="tab"]')[0]?.dispatchEvent(key('x')));
  });

  it('an unavailable tab is aria-disabled with its reason: arrows reach it without selecting it, a click does nothing', async () => {
    const change = vi.fn();
    function Period() {
      const [value, setValue] = useState<'all' | 'd30' | 'd7'>('all');
      return (
        <Tabs
          label="Период"
          value={value}
          onChange={(next) => {
            change(next);
            setValue(next);
          }}
          tabs={[
            { value: 'all', label: 'Всё время' },
            { value: 'd30', label: '30 дней', reason: 'Хаб не отдаёт это окно' },
            { value: 'd7', label: '7 дней' },
          ]}
        />
      );
    }
    kit = mountKit(Period);
    const tabs = (): HTMLElement[] => kit?.$$('[role="tab"]') ?? [];
    const off = tabs()[1] as HTMLElement;
    expect(off.getAttribute('aria-disabled')).toBe('true');
    expect(kit.root.getElementById(off.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Хаб не отдаёт это окно');
    expect(tabs()[0]?.hasAttribute('aria-disabled')).toBe(false);
    await flush(() => off.click());
    expect(change).not.toHaveBeenCalled();
    // → from «Всё время» lands on the unavailable tab: focus, no selection.
    tabs()[0]?.focus();
    await flush(() => tabs()[0]?.dispatchEvent(key('ArrowRight')));
    expect(kit.root.activeElement).toBe(tabs()[1]);
    expect(change).not.toHaveBeenCalled();
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    // → again goes on from where focus is and selects the next available one.
    await flush(() => tabs()[1]?.dispatchEvent(key('ArrowRight')));
    expect(change.mock.calls).toEqual([['d7']]);
    expect(kit.root.activeElement).toBe(tabs()[2]);
  });
});
