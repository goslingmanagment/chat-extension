import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type PartVM } from '@cg/contracts';
import {
  ACCENT_USES,
  Age,
  CheckGlyph,
  Countdown,
  Dot,
  Duration,
  ElapsedTimer,
  GooseMark,
  ICON_NAMES,
  Icon,
  KeysFooter,
  Money,
  PartRow,
  SEARCH_DEBOUNCE_MS,
  SearchBox,
  StageLine,
  TextField,
  Time,
  Caret,
  Spinner,
  useSpokenMoney,
} from '@cg/ui/kit';

import { cgError, ctxOf, part, phase, uuid } from '../scenarios/app-client';
import { type MountedKit, flush, mountKit, mountKitSettled } from './harness';

const ctx = ctxOf({ lang: 'ru' });
const OP = uuid(101);
let kit: MountedKit | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
  vi.useRealTimers();
});

const key = (name: string, init: KeyboardEventInit = {}): KeyboardEvent => new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });

function input(element: HTMLInputElement | HTMLTextAreaElement, value: string, composing = false): void {
  element.value = value;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing }));
}

describe('[SP-019] the search box: 150 ms after the last change, IME-correct', () => {
  it('debounces typing, sends at once on Enter, never mid-composition, and Esc clears it first', async () => {
    vi.useFakeTimers();
    const queries: string[] = [];
    kit = await mountKitSettled(() => <SearchBox value="" onQuery={(q) => queries.push(q)} label="Поиск" placeholder="Имя или @handle" />);
    const box = kit.$('input') as HTMLInputElement;
    expect(box.getAttribute('type')).toBe('search');
    await flush(() => {
      input(box, 'то');
      vi.advanceTimersByTime(100);
      input(box, 'том');
    });
    await flush(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(queries).toEqual([]);
    await flush(() => vi.advanceTimersByTime(1));
    expect(queries).toEqual(['том']);

    // An IME composition: nothing while composing, the result on compositionend.
    await flush(() => {
      box.dispatchEvent(new CompositionEvent('compositionstart'));
      input(box, 'томa', true);
      vi.advanceTimersByTime(500);
    });
    expect(queries).toEqual(['том']);
    await flush(() => {
      box.value = 'тома';
      box.dispatchEvent(new CompositionEvent('compositionend', { data: 'а' }));
    });
    await flush(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(queries).toEqual(['том', 'тома']);

    // Enter mid-composition does nothing; after it, Enter sends at once.
    await flush(() => {
      box.dispatchEvent(key('Enter', { isComposing: true }));
      input(box, 'томаш');
      box.dispatchEvent(key('Enter'));
    });
    expect(queries).toEqual(['том', 'тома', 'томаш']);

    const outer = vi.fn();
    kit.root.addEventListener('keydown', outer);
    await flush(() => box.dispatchEvent(key('Escape')));
    expect(box.value).toBe('');
    expect(queries.at(-1)).toBe('');
    expect(outer).not.toHaveBeenCalled();
    await flush(() => box.dispatchEvent(key('Escape')));
    expect(outer).toHaveBeenCalledTimes(1);
    // Typing the cleared text again is a new query.
    await flush(() => {
      input(box, 'томаш');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(queries.at(-1)).toBe('томаш');
  });

  it('an outside reset of the query clears the field', async () => {
    let reset: () => void = () => undefined;
    function Board() {
      const [query, setQuery] = useState('кит');
      reset = () => setQuery('');
      return <SearchBox value={query} onQuery={setQuery} label="Поиск" placeholder="" />;
    }
    kit = await mountKitSettled(Board);
    const box = kit.$('input') as HTMLInputElement;
    expect(box.value).toBe('кит');
    await flush(() => reset());
    expect(box.value).toBe('');
  });
});

describe('text fields: IME-safe, Enter / Shift+Enter, Esc, a growing textarea', () => {
  it('reports settled text only; Enter asks; Esc is handled when the owner says so', async () => {
    const values: string[] = [];
    const enter = vi.fn();
    const escape = vi.fn(() => true);
    kit = await mountKitSettled(() => <TextField value="" onValue={(v) => values.push(v)} label="Вопрос" multiline minHeight={36} maxHeight={120} onEnter={enter} onEscape={escape} maxLength={5000} placeholder="Спросите коуча" />);
    const area = kit.$('textarea') as HTMLTextAreaElement;
    expect(area.getAttribute('aria-label')).toBe('Вопрос');
    expect(area.getAttribute('maxlength')).toBe('5000');
    await flush(() => {
      area.dispatchEvent(new CompositionEvent('compositionstart'));
      input(area, 'приве', true);
    });
    expect(values).toEqual([]);
    await flush(() => area.dispatchEvent(key('Enter')));
    expect(enter).not.toHaveBeenCalled();
    await flush(() => {
      area.value = 'привет';
      area.dispatchEvent(new CompositionEvent('compositionend'));
    });
    expect(values).toEqual(['привет']);
    // Firefox fires input after compositionend too: reported once.
    await flush(() => input(area, 'привет'));
    expect(values).toEqual(['привет']);
    await flush(() => area.dispatchEvent(key('Enter', { shiftKey: true })));
    expect(enter).not.toHaveBeenCalled();
    await flush(() => area.dispatchEvent(key('Enter')));
    expect(enter).toHaveBeenCalledTimes(1);
    const esc = key('Escape');
    await flush(() => area.dispatchEvent(esc));
    expect(escape).toHaveBeenCalledTimes(1);
    expect(esc.defaultPrevented).toBe(true);
  });

  it('an outside value is written only when it differs and no composition runs; unavailable is read-only with a reason', async () => {
    let set: (v: string) => void = () => undefined;
    function Draft() {
      const [value, setValue] = useState('a');
      set = setValue;
      return <TextField value={value} onValue={setValue} label="Черновик" />;
    }
    kit = await mountKitSettled(Draft);
    const field = kit.$('input') as HTMLInputElement;
    expect(field.value).toBe('a');
    field.focus();
    await flush(() => field.dispatchEvent(new CompositionEvent('compositionstart')));
    await flush(() => set('b'));
    expect(field.value).toBe('a');
    await flush(() => field.dispatchEvent(new CompositionEvent('compositionend')));
    await flush(() => set('c'));
    expect(field.value).toBe('c');
    kit.unmount();
    kit = await mountKitSettled(() => <TextField value="x" onValue={() => undefined} label="Черновик" reason="Поле ввода нельзя проверить" />);
    const off = kit.$('input') as HTMLInputElement;
    expect(off.readOnly).toBe(true);
    expect(off.getAttribute('aria-disabled')).toBe('true');
  });
});

function partVM(patch: Partial<PartVM> = {}): PartVM {
  return part(0, 'Hey you, I was just thinking about you', { opId: OP, next: true, ...patch });
}

describe('the part row (ui-design §4.3)', () => {
  it('number, text, quiet Copy always, «Вставить ↵» on the next part; clicking the text inserts nothing', async () => {
    const onInsert = vi.fn();
    const onCopy = vi.fn();
    kit = await mountKitSettled(() => (
      <div class="cg-body">
        <PartRow part={partVM()} mode="insert" onInsert={onInsert} onCopy={onCopy} tabIndex={0} />
        <PartRow part={part(1, 'Second', { opId: OP })} mode="insert" onInsert={onInsert} onCopy={onCopy} />
      </div>
    ));
    const [first, second] = kit.$$('.cg-part');
    expect(first?.getAttribute('role')).toBe('group');
    expect(first?.getAttribute('aria-label')).toBe('Часть 1');
    expect(first?.tabIndex).toBe(0);
    expect(second?.tabIndex).toBe(-1);
    expect(first?.classList.contains('is-next')).toBe(true);
    expect(first?.querySelector('.cg-part__n')?.textContent).toBe('1');
    expect(first?.querySelector('.cg-ins kbd')?.textContent).toBe('↵');
    expect(first?.querySelector('.cg-ins')?.classList.contains('cg-btn--line')).toBe(true);
    expect(second?.querySelector('.cg-ins')?.classList.contains('cg-btn--plain')).toBe(true);
    expect(second?.querySelector('.cg-ins kbd')).toBeNull();
    expect(first?.querySelector('.cg-part__copy')?.getAttribute('aria-label')).toBe('Копировать часть 1');
    await flush(() => (first?.querySelector('.cg-part__t') as HTMLElement).click());
    expect(onInsert).not.toHaveBeenCalled();
    await flush(() => (first?.querySelector('.cg-ins') as HTMLElement).click());
    await flush(() => (first?.querySelector('.cg-part__copy') as HTMLElement).click());
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('[UI-023] Enter on a focused part inserts THIS part; ⌘C copies it unless text inside is selected', async () => {
    const onInsert = vi.fn();
    const onCopy = vi.fn();
    kit = await mountKitSettled(() => <PartRow part={part(2, 'Third', { opId: OP })} mode="insert" onInsert={onInsert} onCopy={onCopy} />);
    const row = kit.$('.cg-part') as HTMLElement;
    await flush(() => row.dispatchEvent(key('Enter')));
    expect(onInsert.mock.calls[0]?.[0]).toMatchObject({ index: 2 });
    await flush(() => row.dispatchEvent(key('Enter', { isComposing: true })));
    await flush(() => row.dispatchEvent(key('Enter', { shiftKey: true })));
    expect(onInsert).toHaveBeenCalledTimes(1);
    await flush(() => row.dispatchEvent(key('c', { metaKey: true, code: 'KeyC' })));
    expect(onCopy).toHaveBeenCalledTimes(1);
    // A key from a button inside the part belongs to the button.
    await flush(() => (row.querySelector('.cg-part__copy') as HTMLElement).dispatchEvent(key('Enter')));
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it('[UI-023] ⌘C / Ctrl+C is the physical C key: the Russian layout copies too, another key under `c` does not', async () => {
    const onCopy = vi.fn();
    kit = await mountKitSettled(() => <PartRow part={part(0, 'Привет', { opId: OP })} mode="insert" onInsert={() => undefined} onCopy={onCopy} />);
    const row = kit.$('.cg-part') as HTMLElement;
    // ЙЦУКЕН: Ctrl+С gives the Cyrillic `с` on the KeyC key.
    await flush(() => row.dispatchEvent(key('с', { ctrlKey: true, code: 'KeyC' })));
    expect(onCopy).toHaveBeenCalledTimes(1);
    // A layout that puts `c` on another key: not the copy key.
    await flush(() => row.dispatchEvent(key('c', { metaKey: true, code: 'KeyJ' })));
    await flush(() => row.dispatchEvent(key('с', { ctrlKey: true, shiftKey: true, code: 'KeyC' })));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('[UI-022] [UI-023] Enter never puts a collapsed part back: inserted needs «Вставить ещё раз», a sent part has none', async () => {
    const onInsert = vi.fn();
    const again = vi.fn();
    const onCopy = vi.fn();
    kit = await mountKitSettled(() => (
      <>
        <PartRow part={part(0, 'Inserted', { opId: OP, insert: 'done', collapsed: true })} mode="insert" onInsert={onInsert} onCopy={onCopy} onInsertAgain={again} />
        <PartRow part={part(1, 'Sent', { opId: OP, collapsed: true, send: { s: 'sent', at: '2026-10-03T06:21:00.000Z' } })} mode="insert" onInsert={onInsert} onCopy={onCopy} onInsertAgain={again} />
        {/* A sent part the view model forgot to collapse is still the one line, with no «Вставить». */}
        <PartRow part={part(2, 'Sent too', { opId: OP, next: true, send: { s: 'sent', at: '2026-10-03T06:22:00.000Z' } })} mode="insert" onInsert={onInsert} onCopy={onCopy} />
        <PartRow part={part(3, 'Copied only', { opId: OP, collapsed: true })} mode="copy-only" onInsert={onInsert} onCopy={onCopy} />
      </>
    ));
    const rows = kit.$$('.cg-part');
    for (const row of rows) await flush(() => row.dispatchEvent(key('Enter')));
    expect(onInsert).not.toHaveBeenCalled();
    expect(again).not.toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
    expect(rows[2]?.classList.contains('is-done')).toBe(true);
    expect(rows[2]?.querySelector('.cg-ins')).toBeNull();
    expect(rows[2]?.querySelector('.cg-part__state')?.textContent).toBe('Отправлено 06:22');
  });

  it('inserting: «Вставить» is off with a spinner, Copy still works; Enter does not insert twice', async () => {
    const onInsert = vi.fn();
    kit = await mountKitSettled(() => <PartRow part={partVM({ insert: 'pending' })} mode="insert" onInsert={onInsert} onCopy={() => undefined} />);
    const insert = kit.$('.cg-ins') as HTMLElement;
    expect(insert.getAttribute('aria-busy')).toBe('true');
    expect(insert.querySelector('.cg-spin')).not.toBeNull();
    await flush(() => (kit?.$('.cg-part') as HTMLElement).dispatchEvent(key('Enter')));
    await flush(() => insert.click());
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('[UI-026] a failed insert keeps the part next with the inline card «ChatGoose · CG-INSERT-FAILED»', async () => {
    kit = await mountKitSettled(() => <PartRow part={partVM({ insert: 'failed', insertError: cgError(ctx, 'CG-INSERT-FAILED') })} mode="insert" onInsert={() => undefined} onCopy={() => undefined} />);
    const row = kit.$('.cg-part') as HTMLElement;
    expect(row.classList.contains('is-next')).toBe(true);
    expect(row.classList.contains('is-done')).toBe(false);
    const card = row.querySelector('.cg-part__card .cg-card--inline') as HTMLElement;
    expect(card.querySelector('.cg-card__code')?.textContent).toBe('ChatGoose · CG-INSERT-FAILED');
    expect(card.querySelector('.cg-card__code .cg-dot--danger')).not.toBeNull();
    expect([...card.querySelectorAll('.cg-btn')].map((b) => b.textContent)).toEqual(['Скопировать код']);
  });

  it('[UI-027] copy-only: «Копировать» takes the place of «Вставить», Enter copies; a failed copy has no «Скопировать код»', async () => {
    const onCopy = vi.fn();
    kit = await mountKitSettled(() => (
      <>
        <PartRow part={partVM()} mode="copy-only" onInsert={() => undefined} onCopy={onCopy} />
        <PartRow part={part(1, 'B', { opId: OP, copy: 'failed', copyError: cgError(ctx, 'CG-CLIPBOARD') })} mode="insert" onInsert={() => undefined} onCopy={onCopy} />
        <PartRow part={part(2, 'C', { opId: OP, next: true, insertBlocked: { id: 'language', code: 'CG-GATE-LANGUAGE', text: { key: 'dock.reason.language' } } })} mode="insert" onInsert={() => undefined} onCopy={onCopy} />
      </>
    ));
    const [copyOnly, failed, blocked] = kit.$$('.cg-part');
    expect(copyOnly?.querySelector('.cg-ins')).toBeNull();
    // «Копировать» replaces both «Вставить» and the quiet icon (final-7b).
    expect(copyOnly?.querySelector('.cg-part__copy')).toBeNull();
    const main = copyOnly?.querySelector('.cg-copy-main') as HTMLElement;
    expect(main.querySelector('.cg-btn__t')?.textContent).toBe('Копировать');
    expect(main.classList.contains('cg-btn--line')).toBe(true);
    await flush(() => copyOnly?.dispatchEvent(key('Enter')));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(failed?.querySelector('.cg-card__code')?.textContent).toBe('ChatGoose · CG-CLIPBOARD');
    expect(failed?.querySelectorAll('.cg-part__card .cg-btn')).toHaveLength(0);
    expect(blocked?.querySelector('.cg-ins')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('[UI-023] Enter on a part whose «Вставить» is unavailable inserts nothing, copies nothing, and says why', async () => {
    const onInsert = vi.fn();
    const onCopy = vi.fn();
    const blockedPart = part(0, 'Hi there', { opId: OP, next: true, insertBlocked: { id: 'language', code: 'CG-GATE-LANGUAGE', text: { key: 'dock.reason.language' } } });
    kit = await mountKitSettled(() => <PartRow part={blockedPart} mode="insert" onInsert={onInsert} onCopy={onCopy} />);
    const row = kit.$('.cg-part') as HTMLElement;
    await flush(() => row.dispatchEvent(key('Enter')));
    expect(onInsert).not.toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
    const reason = kit.deps.i18n.t('dock.reason.language');
    expect(reason).not.toBe('dock.reason.language');
    expect(kit.$('[data-cg-live]')?.textContent).toBe(reason);
    // Copy still works by its own button.
    await flush(() => (row.querySelector('.cg-part__copy') as HTMLElement).click());
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('[UI-022] copied shows the check; inserted collapses to one line with «✓ вставлено» and «Вставить ещё раз»; sent shows its time', async () => {
    const again = vi.fn();
    kit = await mountKitSettled(() => (
      <>
        <PartRow part={partVM({ copy: 'done' })} mode="insert" onInsert={() => undefined} onCopy={() => undefined} />
        <PartRow part={part(1, 'Inserted part text', { opId: OP, insert: 'done', collapsed: true })} mode="insert" onInsert={() => undefined} onCopy={() => undefined} onInsertAgain={again} />
        <PartRow part={part(2, 'Sent part', { opId: OP, collapsed: true, send: { s: 'sent', at: '2026-10-03T06:21:00.000Z' } })} mode="insert" onInsert={() => undefined} onCopy={() => undefined} onInsertAgain={again} />
      </>
    ));
    const [copied, inserted, sent] = kit.$$('.cg-part');
    expect(copied?.querySelector('.cg-part__copy')?.getAttribute('aria-label')).toBe('Скопировано');
    expect(inserted?.classList.contains('is-done')).toBe(true);
    expect(inserted?.querySelector('.cg-part__state')?.textContent).toBe('вставлено');
    const describedBy = inserted?.querySelector('.cg-part__t')?.getAttribute('aria-describedby') ?? '';
    expect(kit.root.getElementById(describedBy)?.textContent).toBe('Inserted part text');
    await flush(() => (inserted?.querySelector('.cg-part__again') as HTMLElement).click());
    expect(again).toHaveBeenCalledTimes(1);
    expect(sent?.querySelector('.cg-part__state')?.textContent).toBe('Отправлено 06:21');
    expect(sent?.getAttribute('aria-label')).toBe('Часть 3, отправлена');
    expect(sent?.querySelector('.cg-part__again')).toBeNull();
  });

  it('extra rows go under the text; the Б2 question gives the part the sunk background', async () => {
    kit = await mountKitSettled(() => (
      <PartRow part={partVM({ numbered: false })} mode="insert" onInsert={() => undefined} onCopy={() => undefined} confirming>
        <div class="cg-confirm">?</div>
      </PartRow>
    ));
    expect(kit.$('.cg-part')?.classList.contains('is-confirm')).toBe(true);
    expect(kit.$('.cg-part__n')?.textContent).toBe('');
    expect(kit.$('.cg-part__extra .cg-confirm')).not.toBeNull();
  });
});

describe('the stage line (ui-design §4.4)', () => {
  it('passed stages with a check and without «…», the current one strong, an m:ss timer from the click', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ctx.now);
    kit = await mountKitSettled(() => <StageLine phase={phase(OP, ctx.now - 3_000, ['context', 'thinking'], 'writing')} startedAt={ctx.now - 3_000} />, { now: () => Date.now() });
    const stages = kit.$$('.cg-stage');
    expect(stages.map((stage) => stage.textContent)).toEqual(['Читаю переписку', 'Думает', 'Пишет ответ…']);
    expect(stages[0]?.querySelector('svg')).not.toBeNull();
    expect(stages[2]?.classList.contains('is-now')).toBe(true);
    expect(kit.$('.cg-timer')?.textContent).toBe('0:03');
    // One wake per second, just past the boundary.
    await flush(() => vi.advanceTimersByTime(1_010));
    expect(kit.$('.cg-timer')?.textContent).toBe('0:04');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('the transparent 503 retry replaces the stages with its countdown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ctx.now);
    kit = await mountKitSettled(() => <StageLine phase={phase(OP, ctx.now - 2_000, [], 'context', ctx.now + 5_000)} startedAt={ctx.now - 2_000} />, { now: () => Date.now() });
    expect(kit.$('.cg-stage.is-now')?.textContent).toBe('Сервис недоступен, повтор через 5 с…');
    await flush(() => vi.advanceTimersByTime(5_100));
    expect(kit.$('.cg-stage.is-now')?.textContent).toBe('Читаю переписку…');
  });
});

describe('values through I18n: one money notation, ages, times, durations, countdowns', () => {
  it('money: $12,480, green +$320 only for income, −$45, blank zero, — for unknown', () => {
    kit = mountKit(() => (
      <>
        <Money mills={12_480_000} />
        <Money mills={320_000} sign="plus" />
        <Money mills={-45_000} />
        <Money mills={0} />
        <Money mills={0} zero="show" />
        <Money mills={null} class="cg-x" />
      </>
    ));
    const values = kit.$$('.cg-num');
    expect(values.map((value) => value.textContent)).toEqual(['$12,480', '+$320', '−$45', '', '$0', '—']);
    expect(values.map((value) => value.classList.contains('cg-money'))).toEqual([false, true, false, false, false, false]);
    expect(values[5]?.classList.contains('cg-x')).toBe(true);
    // Inside a sentence a span cannot carry a name: no role, no label.
    expect(values.map((value) => value.getAttribute('aria-label'))).toEqual([null, null, null, null, null, null]);
  });

  it('a money cell is named by the amount in words: «+$320» is «плюс 320 долларов» (ui-design §6.2)', async () => {
    let label: string | null = 'not read';
    function Row() {
      label = useSpokenMoney(12_480_000);
      return (
        <div role="row">
          <Money mills={320_000} sign="plus" cell />
          <Money mills={-45_000} cell />
          <Money mills={1_000} cell />
          <Money mills={null} cell />
          <Money mills={0} cell />
        </div>
      );
    }
    kit = mountKit(Row);
    const cells = kit.$$('[role="cell"]');
    expect(cells.map((cell) => cell.textContent)).toEqual(['+$320', '−$45', '$1', '—', '']);
    expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual(['плюс 320 долларов', 'минус 45 долларов', '1 доллар', 'неизвестно', null]);
    expect(label).toBe('12480 долларов');
    await flush(() => kit?.deps.i18n.setLanguage('en'));
    expect(kit.$('[role="cell"]')?.getAttribute('aria-label')).toBe('plus 320 dollars');
  });

  it('ages, times and durations', () => {
    const now = ctx.now;
    kit = mountKit(() => (
      <>
        <Age from={now - 7 * 60_000} />
        <Age from={now - 3 * 3_600_000} suffix />
        <Age from={null} />
        <Time at={now} />
        <Time at={now} style="date" />
        <Time at={null} />
        <Duration ms={84_000} style="m:ss" />
        <ElapsedTimer since={now - 61_500} running={false} />
      </>
    ));
    expect(kit.$$('.cg-num').map((value) => value.textContent)).toEqual(['7 мин', '3 ч назад', 'неизвестно', '06:20', '3 окт', 'неизвестно', '1:24', '1:01']);
  });

  it('a countdown shows minutes and seconds under an hour and disappears at its deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ctx.now);
    kit = await mountKitSettled(() => <Countdown until={ctx.now + 39 * 60_000 + 12_000} />, { now: () => Date.now() });
    expect(kit.$('.cg-num')?.textContent).toBe('39 мин 12 с');
    await flush(() => vi.advanceTimersByTime(39 * 60_000));
    expect(kit.$('.cg-num')?.textContent).toBe('12 с');
    await flush(() => vi.advanceTimersByTime(12_100));
    expect(kit.$('.cg-num')).toBeNull();
  });
});

describe('indicators, icons, the keys footer', () => {
  it('the accent dot exists only for the closed list of uses; the others carry no blue', () => {
    expect([...ACCENT_USES]).toEqual(['result-stale', 'preview-fan-wrote', 'send-held-stale', 'archive-lag', 'recap-ready']);
    kit = mountKit(() => (
      <>
        <Dot kind="accent" use="archive-lag" size={6} />
        <Dot kind="danger" />
        <Dot kind="pulse" />
        <Spinner label="Загрузка" />
        <Spinner />
        <Caret />
      </>
    ));
    const dots = kit.$$('.cg-dot');
    expect(dots[0]?.getAttribute('data-accent-use')).toBe('archive-lag');
    expect(dots[0]?.classList.contains('cg-dot--6')).toBe(true);
    expect(dots[1]?.hasAttribute('data-accent-use')).toBe(false);
    expect(kit.$$('.cg-spin').map((spin) => spin.getAttribute('role'))).toEqual(['img', null]);
    expect(kit.$('.cg-caret')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('our own icon set and the goose mark, hidden from screen readers', () => {
    expect(ICON_NAMES).toEqual(expect.arrayContaining(['copy', 'check', 'x', 'lock', 'search', 'expand', 'collapse', 'info', 'eyeOff', 'refresh']));
    kit = mountKit(() => (
      <>
        {ICON_NAMES.map((name) => (
          <Icon key={name} name={name} size={14} class="cg-i" />
        ))}
        <GooseMark size={24} class="cg-g" />
        <CheckGlyph on />
        <CheckGlyph on={false} size={14} />
      </>
    ));
    expect(kit.$$('svg.cg-i')).toHaveLength(ICON_NAMES.length);
    for (const svg of kit.$$('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(kit.$('.cg-g')?.getAttribute('width')).toBe('24');
    expect(kit.$$('.cg-cb')).toHaveLength(2);
  });

  it('the keys footer: words with keys, optional ones marked, a quiet «Скрыть»', async () => {
    const hide = vi.fn();
    kit = await mountKitSettled(() => (
      <KeysFooter
        label="Клавиши"
        hints={[
          { keys: '↑↓', label: 'часть' },
          { keys: '↵', label: 'вставить' },
          { keys: '⌘C', label: 'копировать', optional: true },
          { keys: 'Esc', label: 'свернуть' },
        ]}
        hide={{ label: 'Скрыть', tooltip: 'Подсказка видна первые 5 ответов', onHide: hide }}
      />
    ));
    expect(kit.$$('.cg-key').map((item) => item.textContent)).toEqual(['↑↓часть', '↵вставить', '⌘Cкопировать', 'Escсвернуть']);
    expect(kit.$$('.cg-key--x')).toHaveLength(1);
    const button = kit.$('.cg-keys__hide') as HTMLElement;
    expect(button.classList.contains('cg-btn--quiet')).toBe(true);
    await flush(() => button.click());
    expect(hide).toHaveBeenCalledTimes(1);
    kit.unmount();
    kit = mountKit(() => <KeysFooter hints={[{ keys: 'J/K', label: 'строка' }]} hide={null} />);
    expect(kit.$('.cg-keys__hide')).toBeNull();
  });
});
