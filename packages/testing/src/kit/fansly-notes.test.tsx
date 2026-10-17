// «Заметки» of a Fansly tab drawn (R20 P11b, P11b2, P11c): the panel and the header button over the real controller and a port
// that answers like the background — what a person sees and presses, before the stand's e2e (`suite-fansly-notes`).
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotesAction, NotesClient, NotesPanelVM } from '@cg/contracts/notes-fansly';
import type { SiteOpView } from '@cg/contracts/ops';
import type { FanslyNote } from '@cg/contracts/tab-messages-fansly';
import { NOTE_TEMPLATE_LABELS, NOTE_TEMPLATE_TEXT, createNotesController, type NotesPort, type NotesTarget } from '@cg/core/application/hosts/fansly/notes';
import { NOTES_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';
import { NotesButton, NotesPanel } from '@cg/ui/hosts/fansly/notes';

import { flush, mountKitSettled, type MountedKit } from './harness';

const A: NotesTarget = { accountId: '7', groupId: '81', fanId: '91', fan: { name: 'Alex', handle: 'alex' } };
const notes: FanslyNote[] = [
  { noteId: '1', title: 'Hobbies', text: 'Plays chess', foreign: false },
  { noteId: '2', title: 'FBuddy Notes', text: 'likes cats', foreign: true },
];

/** A questionnaire the Fansly extension 2.10 left: its eight entries, a stamped month, a line written under a field. */
const OLD_FORM = 'Имя: Wayne\nЛокация: Флорида (08.2026)\nВозраст: \nРабота: медбрат; ночные смены\nХобби: \nФетиши: \nХарактеристика: депрессивный чел\nнужно поддерживать вайб\nМедиа: ';

function controller(list: readonly FanslyNote[] = notes) {
  const port = {
    session: () => '7|1',
    target: () => A,
    read: vi.fn(() => Promise.resolve({ ok: true as const, fanRef: '91', notes: [...list], customName: null })),
    create: vi.fn((_who, title: string, text: string) => Promise.resolve({ ok: true as const, note: { noteId: '9', title, text, foreign: false } })),
    edit: vi.fn((_who, noteId: string, title: string, text: string) => Promise.resolve({ ok: true as const, note: { noteId, title, text, foreign: false } })),
    remove: vi.fn(() => Promise.resolve({ ok: true as const })),
    name: vi.fn((_who, name: string) => Promise.resolve({ ok: true as const, customName: { noteId: '5', name } })),
    setView: vi.fn(),
    fillAllowed: () => true,
    fill: vi.fn(() => Promise.resolve({ ok: true as const, opId: 'op1', view: null })),
    stopFill: vi.fn(),
    fits: () => false,
    place: () => ({ kind: 'over' as const, top: 60, bottom: 12, left: 600, width: 340 }),
    setTimer: (ms: number, run: () => void) => setTimeout(run, ms),
    clearTimer: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } satisfies NotesPort;
  return { port, notes: createNotesController(port) };
}

const mounted: MountedKit[] = [];
afterEach(() => {
  for (const ui of mounted.splice(0)) ui.unmount();
});

const button = (ui: MountedKit, label: string): HTMLButtonElement => {
  const found = ui.$$('button').find((node) => node.textContent?.trim() === label || node.getAttribute('aria-label') === label);
  if (found === undefined) throw new Error(`no button «${label}»`);
  return found as HTMLButtonElement;
};

async function open(list?: readonly FanslyNote[]) {
  const c = controller(list);
  const header = await mountKitSettled(() => <NotesButton client={c.notes} texts={NOTES_TEXTS} />, { kind: 'header-slot' as never, language: 'ru' });
  const panel = await mountKitSettled(() => <NotesPanel client={c.notes} texts={NOTES_TEXTS} />, { kind: 'notes' as never, language: 'ru' });
  mounted.push(header, panel);
  c.notes.sync();
  await flush(() => header.$('button')?.click());
  await flush();
  return { ...c, header, panel };
}

describe('[host:fansly] «Заметки» drawn (R20 P11b)', () => {
  it('[FX-004] [FX-007] [FS-NOTE-2] the button opens the panel with the fan’s notes; FBuddy’s is someone else’s: marked, with no action', async () => {
    const ui = await open();
    expect(ui.header.$('.cg-nb__button')?.getAttribute('aria-pressed')).toBe('true');
    expect(ui.header.$('.cg-nb__count')?.textContent).toBe('2');
    expect(ui.panel.$('[data-notes-body]')?.getAttribute('data-notes-body')).toBe('ready');
    const foreign = ui.panel.$('[data-note-id="2"]');
    expect(foreign?.getAttribute('data-foreign')).toBe('true');
    expect(foreign?.textContent).toContain('Заметка FBuddy');
    expect(foreign?.querySelector('button')).toBeNull();
    expect(ui.panel.$('[data-note-id="1"]')?.querySelectorAll('button').length).toBe(2);
  });

  it('[FX-007] [FX-008] [FS-NOTE-4] «+ Анкета» opens the questionnaire; «Создать» writes it once; a delete asks first', async () => {
    const ui = await open();
    await flush(() => button(ui.panel, '+ Анкета').click());
    expect(ui.panel.$$('[data-notes-editor="new"] [data-notes-field]').map((row) => row.getAttribute('data-notes-field'))).toEqual(NOTE_TEMPLATE_LABELS);
    await flush(() => ui.panel.$('[data-notes-save]')?.click());
    await flush();
    expect(ui.port.create).toHaveBeenCalledTimes(1);
    expect(ui.port.create.mock.calls[0]?.[1]).toBe('Анкета');
    await flush(() => (ui.panel.$('[data-note-id="1"]')?.querySelectorAll('button')[1] as HTMLButtonElement).click());
    expect(ui.panel.$('[data-notes-confirm]')?.textContent).toContain('Удалить заметку из Fansly?');
    expect(ui.port.remove).not.toHaveBeenCalled();
    await flush(() => (ui.panel.$('[data-notes-confirm] button') as HTMLButtonElement).click());
    await flush();
    expect(ui.port.remove).toHaveBeenCalledTimes(1);
    expect(ui.panel.$('[data-note-id="1"]')).toBeNull();
  });

  it('[FX-006] the name for oneself: typed in the head, written on Enter, once', async () => {
    const ui = await open();
    const field = ui.panel.$('[data-notes-name]') as HTMLInputElement;
    expect(field.placeholder).toBe('Alex');
    field.value = 'Саша';
    await flush(() => field.dispatchEvent(new Event('input', { bubbles: true })));
    await flush(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await flush();
    await flush(() => field.dispatchEvent(new FocusEvent('blur')));
    expect(ui.port.name).toHaveBeenCalledExactlyOnceWith({ accountId: '7', fanId: '91' }, 'Саша', null);
    expect(ui.panel.$('.cg-notes__hint')?.getAttribute('data-status')).toBe('saved');
  });

  it('[FX-009] the view is chosen at the panel’s foot; Esc closes a panel opened by the button', async () => {
    const ui = await open();
    const select = ui.panel.$('select') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(['Всегда справа', 'Справа по кнопке', 'Окно по центру']);
    select.value = 'center';
    await flush(() => select.dispatchEvent(new Event('change', { bubbles: true })));
    expect(ui.port.setView).toHaveBeenCalledWith('center');
    expect(ui.panel.$('.cg-notes')?.classList.contains('is-center')).toBe(true);
    await flush(() => ui.panel.$('.cg-notes')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(ui.panel.$('.cg-notes')).toBeNull();
  });

  it('[FX-009] a change of view keeps the card and the select in it; Esc on the header button puts the panel away', async () => {
    const ui = await open();
    const select = ui.panel.$('select') as HTMLSelectElement;
    select.value = 'center';
    await flush(() => select.dispatchEvent(new Event('change', { bubbles: true })));
    const card = ui.panel.$('.cg-notes');
    // Narrow: «Всегда справа» opens over the chat — the same card, the select still in it.
    const again = ui.panel.$('select') as HTMLSelectElement;
    again.value = 'docked';
    await flush(() => again.dispatchEvent(new Event('change', { bubbles: true })));
    expect(ui.panel.$('.cg-notes')).toBe(card);
    expect(ui.panel.$('select')).toBe(again);
    const button = ui.header.$('.cg-nb__button') as HTMLButtonElement;
    await flush(() => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(ui.panel.$('.cg-notes')).toBeNull();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('[FS-NOTE-4] a version conflict shows the notice and keeps the note and name drafts', async () => {
    const ui = await open();
    const conflict = { ok: false, error: { code: 'CG-NOTE-WRITE', detail: 'changed' } } as const;
    ui.port.edit.mockResolvedValueOnce(conflict as never);
    await flush(() => ui.notes.dispatch({ type: 'edit', noteId: '1' }));
    await flush(() => ui.notes.dispatch({ type: 'input', title: 'Hobbies', text: 'My draft' }));
    await flush(() => ui.notes.dispatch({ type: 'save' }));
    await flush();
    expect(ui.panel.$('[role="alert"]')?.textContent).toBe(NOTES_TEXTS.ru.problem.changed);
    expect((ui.panel.$('[data-notes-editor] textarea') as HTMLTextAreaElement).value).toBe('My draft');
    ui.port.name.mockResolvedValueOnce(conflict as never);
    await flush(() => ui.notes.dispatch({ type: 'name-input', value: 'Саша' }));
    await flush(() => ui.notes.dispatch({ type: 'name-commit' }));
    await flush();
    expect(ui.panel.$('.cg-notes__hint')?.textContent).toBe(NOTES_TEXTS.ru.problem.changed);
    expect((ui.panel.$('[data-notes-name]') as HTMLInputElement).value).toBe('Саша');
  });

  it('[FX-008] [FS-NOTE-2] a questionnaire the old extension wrote reads as a table: facts one per line, the month at the right, the empty fields in one line (R20 P11b2)', async () => {
    const ui = await open([{ noteId: '1', title: '', text: OLD_FORM, foreign: false }]);
    const card = ui.panel.$('[data-note-id="1"]');
    expect(card?.querySelector('.cg-notes__note-title')?.textContent).toBe('Анкета');
    expect([...(card?.querySelectorAll('[data-notes-form] dt') ?? [])].map((node) => node.textContent)).toEqual(['Имя', 'Локация', 'Работа', 'Характеристика']);
    const facts = (label: string) => [...(card?.querySelectorAll(`[data-notes-field="${label}"] .cg-notes__fact-t`) ?? [])].map((node) => node.textContent);
    expect(facts('Работа')).toEqual(['медбрат', 'ночные смены']);
    expect(facts('Характеристика')).toEqual(['депрессивный чел', 'нужно поддерживать вайб']);
    expect(card?.querySelector('[data-notes-field="Локация"] .cg-notes__fact-date')?.textContent).toBe('08.2026');
    expect(card?.querySelector('.cg-notes__blank')?.textContent).toBe('Не заполнено: Возраст, Хобби, Фетиши, Медиа');
    // One questionnaire per fan.
    expect(() => button(ui.panel, '+ Анкета')).toThrow();
  });

  it('[FX-008] [FS-NOTE-2] the questionnaire is edited field by field, one fact per line; «Текстом» shows the one text Fansly keeps (R20 P11b2)', async () => {
    const ui = await open();
    await flush(() => button(ui.panel, '+ Анкета').click());
    const field = (label: string) => ui.panel.$(`[data-notes-editor="new"] [data-notes-field="${label}"] textarea`) as HTMLTextAreaElement;
    // The first field takes the focus.
    expect(ui.panel.root.activeElement).toBe(field('Имя'));
    const typeIn = async (label: string, value: string) => {
      field(label).value = value;
      await flush(() => field(label).dispatchEvent(new Event('input', { bubbles: true })));
    };
    await typeIn('Имя', 'Alex');
    await typeIn('График', 'ночные смены\n');
    // A new line being typed stays in its box.
    expect(field('График').value).toBe('ночные смены\n');
    await typeIn('График', 'ночные смены\nвыходные — суббота');
    await flush(() => button(ui.panel, 'Текстом').click());
    const text = NOTE_TEMPLATE_TEXT.replace('Имя: ', 'Имя: Alex').replace('График: ', 'График: ночные смены; выходные — суббота');
    expect((ui.panel.$('[data-notes-editor="new"] textarea') as HTMLTextAreaElement).value).toBe(text);
    await flush(() => button(ui.panel, 'Полями').click());
    expect(field('График').value).toBe('ночные смены\nвыходные — суббота');
    await flush(() => ui.panel.$('[data-notes-save]')?.click());
    await flush();
    expect(ui.port.create).toHaveBeenCalledExactlyOnceWith({ accountId: '7', fanId: '91' }, 'Анкета', text.trimEnd());
  });

  it('[FS-NOTE-2] typing two field-like lines in «+ Заметка» keeps the same textarea and focus until «Полями» is clicked', async () => {
    const ui = await open();
    await flush(() => button(ui.panel, '+ Заметка').click());
    const text = ui.panel.$('[data-notes-editor="new"] textarea') as HTMLTextAreaElement;
    expect(ui.panel.root.activeElement).toBe(text);
    for (const value of ['Сегодня: спросил про кастом', 'Сегодня: спросил про кастом\nЗавтра:', 'Сегодня: спросил про кастом\nЗавтра: обсудить']) {
      text.value = value;
      await flush(() => text.dispatchEvent(new Event('input', { bubbles: true })));
      expect(ui.panel.$('[data-notes-editor="new"] textarea')).toBe(text);
      expect(ui.panel.root.activeElement).toBe(text);
      expect(text.value).toBe(value);
      expect(ui.panel.$('[data-notes-fields]')).toBeNull();
      expect(ui.notes.panel().editor?.text).toBe(value);
    }
    // Detection may offer the switch, but only the person's click changes the view.
    await flush(() => button(ui.panel, 'Полями').click());
    expect(ui.panel.$('[data-notes-fields]')).not.toBeNull();
    await flush(() => button(ui.panel, 'Текстом').click());
    expect((ui.panel.$('[data-notes-editor="new"] textarea') as HTMLTextAreaElement).value).toBe('Сегодня: спросил про кастом\nЗавтра: обсудить');
  });

  it('[FX-008] the Goose’s rewrite stands under its field: what it adds and drops, the fan’s words, «Принять» and «Не нужно» (R20 P11b2; the fill is P11c)', async () => {
    const c = controller([{ noteId: '1', title: 'Анкета', text: OLD_FORM, foreign: false }]);
    const live = c.notes;
    const suggestion = { index: 0, label: 'Работа', added: ['медбрат в больнице'], removed: ['медбрат'], proposed: 'медбрат в больнице; ночные смены', quotes: ['я работаю в больнице'] };
    const loose = { index: 1, label: 'Питомцы', added: [], removed: [], proposed: 'кот', quotes: [] };
    const panel = (): NotesPanelVM => {
      const vm = live.panel();
      const editor = vm.editor;
      if (editor === null) return vm;
      const form = editor.form?.map((part) => (part.kind === 'field' && part.label === 'Работа' ? { ...part, suggestions: [suggestion] } : part)) ?? null;
      return { ...vm, editor: { ...editor, form, suggestions: [suggestion, loose] } };
    };
    const dispatch = vi.fn<(action: NotesAction) => void>();
    const client: NotesClient = {
      panel,
      trigger: () => live.trigger(),
      subscribe: (listener) => live.subscribe(listener),
      dispatch: (action) => {
        if (action.type === 'suggestion') dispatch(action);
        else live.dispatch(action);
      },
    };
    const ui = await mountKitSettled(() => <NotesPanel client={client} texts={NOTES_TEXTS} />, { kind: 'notes' as never, language: 'ru' });
    mounted.push(ui);
    live.sync();
    live.toggle();
    await flush();
    await flush(() => live.dispatch({ type: 'edit', noteId: '1' }));
    const under = ui.$('[data-notes-field="Работа"] [data-notes-suggestion="0"]');
    expect(under?.querySelector('.cg-notes__suggest-t')?.textContent).toBe('Гусь предлагает заменить');
    expect(under?.querySelector('del')?.textContent).toBe('медбрат');
    expect(under?.querySelector('ins')?.textContent).toBe('медбрат в больнице');
    expect(under?.querySelector('.cg-notes__quotes')?.textContent).toBe('«я работаю в больнице»');
    // A rewrite of no field in the form stands after the fields, named.
    const after = ui.$('[data-notes-editor="1"] > [data-notes-suggestion="1"]');
    expect(after?.querySelector('.cg-notes__suggest-t')?.textContent).toBe('Гусь предлагает заменить в «Питомцы»');
    expect(after?.querySelector('ins')?.textContent).toBe('кот');
    await flush(() => (under?.querySelector('button') as HTMLButtonElement).click());
    await flush(() => (after?.querySelector('button[aria-label="Не нужно"]') as HTMLButtonElement).click());
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'suggestion', index: 0, accept: true },
      { type: 'suggestion', index: 1, accept: false },
    ]);
  });

  it('[FX-014] [FX-016] «✨ Дополнить из чата» at the foot of a questionnaire: «Сохранить» waits while the Goose reads, «Остановить» stops it; then the line of what it wrote and its rewrites under their fields (R20 P11c, X43)', async () => {
    const c = controller([{ noteId: '1', title: 'Анкета', text: OLD_FORM, foreign: false }]);
    const ui = await mountKitSettled(() => <NotesPanel client={c.notes} texts={NOTES_TEXTS} />, { kind: 'notes' as never, language: 'ru' });
    mounted.push(ui);
    c.notes.sync();
    c.notes.toggle();
    await flush();
    await flush(() => c.notes.dispatch({ type: 'edit', noteId: '1' }));
    await flush(() => button(ui, '✨ Дополнить из чата').click());
    expect(ui.$('[data-notes-editor="1"]')?.getAttribute('data-notes-fill')).toBe('running');
    expect(ui.$('[data-notes-fill-line]')?.textContent).toBe('Гусь читает переписку…');
    expect(ui.$('[data-notes-save]')?.getAttribute('aria-disabled')).toBe('true');
    expect(button(ui, 'Остановить')).toBeDefined();
    const view = {
      opId: 'op1',
      feature: 'notes-fill',
      state: 'done',
      result: { kind: 'note-fields', fields: [{ label: 'Возраст', value: '41' }, { label: 'Работа', value: 'медбрат; ночные смены; в больнице' }, { label: 'Другое', value: 'просил кастом' }] },
    } as unknown as SiteOpView;
    await flush(() => c.notes.fillDone(view));
    expect(ui.$('[data-notes-editor="1"]')?.getAttribute('data-notes-fill')).toBe('done');
    expect(ui.$('[data-notes-fill-line]')?.textContent).toBe('Гусь вписал: Возраст, Другое. Правки под полями: 1.');
    expect((ui.$('[data-notes-field="Возраст"] textarea') as HTMLTextAreaElement | null)?.value).toBe('41');
    const under = ui.$('[data-notes-field="Работа"] [data-notes-suggestion="0"]');
    expect(under?.querySelector('.cg-notes__suggest-t')?.textContent).toBe('Гусь предлагает добавить');
    expect(under?.querySelector('del')).toBeNull();
    expect(under?.querySelector('ins')?.textContent).toBe('в больнице');
    expect(ui.$('[data-notes-save]')?.getAttribute('aria-disabled')).toBeNull();
    expect(c.port.edit).not.toHaveBeenCalled();
    await flush(() => button(ui, '✨ Дополнить из чата').click());
    await flush(() => button(ui, 'Остановить').click());
    expect(c.port.stopFill).toHaveBeenCalledExactlyOnceWith('op1');
    expect(ui.$('[data-notes-fill-line]')).toBeNull();
  });
});

describe('[host:fansly] «Заметки» drawn as in the Fansly extension 2.11–2.13 (R20 P11b2)', () => {
  it('[FX-019] [FX-022] a free note is dated in its head, an untitled one by the date alone, the questionnaire not; «✨ Дополнить из чата» stands on the questionnaire being read and opens it filling', async () => {
    const created = new Date(new Date().getFullYear(), 0, 2, 9, 7).getTime();
    const c = controller([
      { noteId: '1', title: 'Анкета', text: OLD_FORM, foreign: false, createdAtMs: created },
      { noteId: '3', title: 'кастом', text: 'хочет видео', foreign: false, createdAtMs: created },
      { noteId: '4', title: '', text: 'без заголовка', foreign: false, createdAtMs: created },
    ]);
    const ui = await mountKitSettled(() => <NotesPanel client={c.notes} texts={NOTES_TEXTS} />, { kind: 'notes' as never, language: 'ru' });
    mounted.push(ui);
    c.notes.sync();
    c.notes.toggle();
    await flush();
    await flush();
    const head = (id: string) => ui.$(`[data-note-id="${id}"] .cg-notes__note-head`);
    expect(head('3')?.querySelector('.cg-notes__note-title')?.textContent).toBe('кастом');
    expect(head('3')?.querySelector('time')?.textContent).toBe('02.01');
    expect(head('3')?.querySelector('time')?.getAttribute('title')).toBe(`Создана 02.01.${String(new Date().getFullYear())} в 09:07`);
    expect(head('4')?.querySelector('.cg-notes__note-title')).toBeNull();
    expect(head('4')?.querySelector('time')?.textContent).toBe('02.01');
    expect(head('1')?.querySelector('time')).toBeNull();
    expect([...(head('3')?.querySelectorAll('button') ?? [])].map((node) => node.textContent)).toEqual(['Изменить', 'Удалить']);
    await flush(() => (head('1')?.querySelector('button') as HTMLButtonElement).click());
    expect(head('1')?.querySelector('button')?.textContent).toBe(undefined);
    expect(ui.$('[data-notes-editor="1"]')?.getAttribute('data-notes-fill')).toBe('running');
    expect(c.port.fill).toHaveBeenCalledOnce();
  });

  it('[FX-023] the fan’s words: under a rewrite at once, under the fields the Goose wrote by «Слова фана»; its rows marked; «Принять все»; «В Другое»', async () => {
    const c = controller([{ noteId: '1', title: 'Анкета', text: OLD_FORM, foreign: false }]);
    const ui = await mountKitSettled(() => <NotesPanel client={c.notes} texts={NOTES_TEXTS} />, { kind: 'notes' as never, language: 'ru' });
    mounted.push(ui);
    c.notes.sync();
    c.notes.toggle();
    await flush();
    await flush(() => c.notes.dispatch({ type: 'fill-note', noteId: '1' }));
    const view = {
      opId: 'op1',
      feature: 'notes-fill',
      state: 'done',
      result: {
        kind: 'note-fields',
        fields: [
          { label: 'Возраст', value: '41', quotes: ['I am 41'] },
          { label: 'Работа', value: 'медбрат; ночные смены; в больнице', quotes: ['at the hospital'] },
          { label: 'Характеристика', value: 'одинок' },
        ],
        proposed: [{ label: 'Питомцы', value: 'кот', quotes: ['my cat'] }],
      },
    } as unknown as SiteOpView;
    await flush(() => c.notes.fillDone(view));
    const row = (label: string) => ui.$(`[data-notes-editor="1"] [data-notes-field="${label}"]`);
    expect(row('Возраст')?.hasAttribute('data-notes-ai')).toBe(true);
    expect(row('Имя')?.hasAttribute('data-notes-ai')).toBe(false);
    expect(row('Работа')?.querySelector('[data-notes-suggestion] [data-notes-quotes]')?.textContent).toBe('«at the hospital»');
    expect(row('Возраст')?.querySelector('[data-notes-quotes]')).toBeNull();
    await flush(() => button(ui, 'Слова фана').click());
    expect(row('Возраст')?.querySelector('[data-notes-quotes]')?.textContent).toBe('«I am 41»');
    expect(button(ui, 'Скрыть слова фана')).toBeDefined();
    expect(row('Питомцы')?.querySelector('[data-notes-proposed]')?.textContent).toContain('Это поле завёл Гусь');
    // A whole rewrite (X43): what it drops struck out, what it brings in.
    expect([...(row('Характеристика')?.querySelectorAll('[data-notes-suggestion] del, [data-notes-suggestion] ins') ?? [])].map((node) => `${node.tagName}:${node.textContent ?? ''}`)).toEqual(['DEL:депрессивный чел', 'INS:одинок']);
    await flush(() => button(ui, 'Принять все').click());
    expect((row('Работа')?.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('медбрат\nночные смены\nв больнице');
    // «Принять» rewrites the field's own line: the line written under it stays.
    expect((row('Характеристика')?.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('одинок\nнужно поддерживать вайб');
    expect(ui.$('[data-notes-suggestion]')).toBeNull();
    await flush(() => button(ui, 'В Другое').click());
    expect(row('Питомцы')).toBeNull();
    expect((row('Другое')?.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('Питомцы: кот');
    expect(row('Другое')?.querySelector('[data-notes-quotes]')?.textContent).toBe('Питомцы — «my cat»');
    expect(c.port.edit).not.toHaveBeenCalled();
  });

  it('[FX-024] a field the hub named with no place in a full questionnaire is named in the fill’s line (X43)', async () => {
    const full = Array.from({ length: 30 }, (_, n) => `Поле ${String(n)}: x`).join('\n');
    const c = controller([{ noteId: '1', title: 'Анкета', text: full, foreign: false }]);
    const ui = await mountKitSettled(() => <NotesPanel client={c.notes} texts={NOTES_TEXTS} />, { kind: 'notes' as never, language: 'ru' });
    mounted.push(ui);
    c.notes.sync();
    c.notes.toggle();
    await flush();
    await flush(() => c.notes.dispatch({ type: 'fill-note', noteId: '1' }));
    const view = { opId: 'op1', feature: 'notes-fill', state: 'done', result: { kind: 'note-fields', fields: [{ label: 'Поле 0', value: '' }], proposed: [{ label: 'Питомцы', value: 'кот' }] } } as unknown as SiteOpView;
    await flush(() => c.notes.fillDone(view));
    expect(ui.$('[data-notes-fill-line]')?.textContent).toBe('Не хватило места в анкете: Питомцы.');
  });
});
