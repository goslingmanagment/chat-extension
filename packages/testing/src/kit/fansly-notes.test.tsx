// «Заметки» of a Fansly tab drawn (R20 P11b): the panel and the header button over the real controller and a port
// that answers like the background — what a person sees and presses, before the stand's e2e (`suite-fansly-notes`).
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FanslyNote } from '@cg/contracts/tab-messages-fansly';
import { createNotesController, type NotesPort, type NotesTarget } from '@cg/core/application/hosts/fansly/notes';
import { NOTES_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';
import { NotesButton, NotesPanel } from '@cg/ui/hosts/fansly/notes';

import { flush, mountKitSettled, type MountedKit } from './harness';

const A: NotesTarget = { accountId: '7', groupId: '81', fanId: '91', fan: { name: 'Alex', handle: 'alex' } };
const notes: FanslyNote[] = [
  { noteId: '1', title: 'Hobbies', text: 'Plays chess', foreign: false },
  { noteId: '2', title: 'FBuddy Notes', text: 'likes cats', foreign: true },
];

function controller() {
  const port = {
    session: () => '7|1',
    target: () => A,
    read: vi.fn(() => Promise.resolve({ ok: true as const, fanRef: '91', notes, customName: null })),
    create: vi.fn((_who, title: string, text: string) => Promise.resolve({ ok: true as const, note: { noteId: '9', title, text, foreign: false } })),
    edit: vi.fn((_who, noteId: string, title: string, text: string) => Promise.resolve({ ok: true as const, note: { noteId, title, text, foreign: false } })),
    remove: vi.fn(() => Promise.resolve({ ok: true as const })),
    name: vi.fn((_who, name: string) => Promise.resolve({ ok: true as const, customName: { noteId: '5', name } })),
    setView: vi.fn(),
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

async function open() {
  const c = controller();
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

  it('[FX-007] [FX-008] [FS-NOTE-4] «+ По шаблону» opens the questionnaire; «Создать» writes it once; a delete asks first', async () => {
    const ui = await open();
    await flush(() => button(ui.panel, '+ По шаблону').click());
    expect(ui.panel.$('[data-notes-editor="new"] textarea')).not.toBeNull();
    expect((ui.panel.$('[data-notes-editor="new"] textarea') as HTMLTextAreaElement).value).toContain('Локация: ');
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
});
