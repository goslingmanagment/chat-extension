import { describe, expect, it, vi } from 'vitest';

import type { FanslyNotesView } from '@cg/contracts/settings-ext';
import type { FanslyNote } from '@cg/contracts/tab-messages-fansly';

import { NOTES_FOLLOW_DELAY_MS, createNotesController, type NotesPort, type NotesTarget } from './controller';
import { NOTE_TEMPLATE_LABELS, NOTE_TEMPLATE_TEXT, NOTE_TEMPLATE_TITLE, isQuestionnaire } from './template';

const A: NotesTarget = { accountId: '7', groupId: '81', fanId: '91', fan: { name: 'Alex', handle: 'alex' } };
const B: NotesTarget = { accountId: '7', groupId: '82', fanId: '92', fan: null };
const note = (noteId: string, title = 'T', text = 'x', foreign = false): FanslyNote => ({ noteId, title, text, foreign });

function world(opts: { fits?: boolean } = {}) {
  let target: NotesTarget | null = A;
  let session = '7|1';
  let fits = opts.fits ?? false;
  const timers: Array<{ run: () => void; ms: number; live: boolean }> = [];
  const stored = new Map<string, FanslyNote[]>([['91', [note('1', 'Анкета', 'Имя: Алекс\nЛокация: Рига'), note('2', 'FBuddy Notes', 'likes cats', true)]], ['92', []]]);
  const port = {
    session: () => session,
    target: () => target,
    read: vi.fn((t: NotesTarget) => Promise.resolve({ ok: true as const, fanRef: t.fanId ?? '91', notes: [...(stored.get(t.fanId ?? '91') ?? [])], customName: t.fanId === '91' ? { noteId: '5', name: 'Алекс' } : null })),
    create: vi.fn((_who, title: string, text: string) => Promise.resolve({ ok: true as const, note: note('9', title, text) })),
    edit: vi.fn((_who, noteId: string, title: string, text: string) => Promise.resolve({ ok: true as const, note: note(noteId, title, text) })),
    remove: vi.fn(() => Promise.resolve({ ok: true as const })),
    name: vi.fn((_who, name: string) => Promise.resolve({ ok: true as const, customName: name === '' ? null : { noteId: '5', name } })),
    setView: vi.fn((_view: FanslyNotesView) => undefined),
    fits: () => fits,
    place: () => ({ kind: fits ? ('docked' as const) : ('over' as const), top: 60, bottom: 12, left: 900, width: 340 }),
    setTimer: (ms: number, run: () => void) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle: unknown) => {
      (handle as { live: boolean }).live = false;
    },
  } satisfies NotesPort;
  const notes = createNotesController(port);
  const tick = async () => {
    for (const timer of timers.splice(0)) if (timer.live) timer.run();
    await Promise.resolve();
    await Promise.resolve();
  };
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return {
    port,
    notes,
    timers,
    tick,
    settle,
    go(next: NotesTarget | null) {
      target = next;
      notes.sync();
    },
    relog(next: string) {
      session = next;
    },
    room(next: boolean) {
      fits = next;
    },
  };
}

describe('[host:fansly] «Заметки»: the controller (R20 P11b)', () => {
  it('[FX-004] [FX-005] [FS-NOTE-1] the button and the key open and close the panel in a one-to-one chat only; the count once read', async () => {
    const w = world();
    w.notes.sync();
    expect(w.notes.trigger()).toEqual({ shown: true, count: null, open: false });
    expect(w.notes.toggle()).toBe(true);
    await w.settle();
    expect(w.notes.trigger()).toEqual({ shown: true, count: 2, open: true });
    w.notes.dispatch({ type: 'toggle' });
    expect(w.notes.panel().shown).toBe(false);
    w.go(null);
    expect(w.notes.trigger().shown).toBe(false);
    expect(w.notes.toggle()).toBe(false);
  });

  it('[FX-010] [FS-NOTE-3] «Справа по кнопке» reads once at the opening and keeps the answer; «Обновить» reads again; a failure waits for the person', async () => {
    const w = world();
    w.notes.sync();
    expect(w.port.read).not.toHaveBeenCalled();
    w.notes.toggle();
    await w.settle();
    expect(w.port.read).toHaveBeenCalledTimes(1);
    w.go(B);
    await w.tick();
    w.go(A);
    await w.tick();
    // A is kept; B was read by the follow of the open panel after 0.7 s.
    expect(w.port.read.mock.calls.map(([t]) => t.groupId)).toEqual(['81', '82']);
    w.notes.dispatch({ type: 'refresh' });
    await w.settle();
    expect(w.port.read).toHaveBeenLastCalledWith(A, true);
    w.port.read.mockResolvedValueOnce({ ok: false, error: { code: 'CG-FAN-RATE-LIMIT' } } as never);
    w.notes.dispatch({ type: 'refresh' });
    await w.settle();
    expect(w.notes.panel()).toMatchObject({ body: 'error', error: { code: 'CG-FAN-RATE-LIMIT' } });
    w.go(B);
    w.go(A);
    await w.tick();
    expect(w.port.read).toHaveBeenCalledTimes(4);
  });

  it('[FX-009] [FX-010] [FS-NOTE-2] «Всегда справа» stands beside every chat while there is room and reads each only after 0.7 s on it; without room the button opens it over the chat', async () => {
    const w = world({ fits: true });
    w.notes.sync();
    w.notes.applyView('docked');
    expect(w.notes.panel()).toMatchObject({ shown: true, view: 'docked', place: { kind: 'docked' } });
    expect(w.port.read).not.toHaveBeenCalled();
    expect(w.timers.map((timer) => timer.ms)).toEqual([NOTES_FOLLOW_DELAY_MS]);
    // Through B in passing: its timer is dropped, nothing of B is read.
    w.go(B);
    w.go(A);
    await w.tick();
    expect(w.port.read.mock.calls.map(([t]) => t.groupId)).toEqual(['81']);
    w.room(false);
    w.notes.layout();
    expect(w.notes.panel()).toMatchObject({ shown: false, narrow: true });
    w.notes.toggle();
    expect(w.notes.panel()).toMatchObject({ shown: true, narrow: true, place: { kind: 'over' } });
    w.notes.dispatch({ type: 'close' });
    expect(w.notes.panel().shown).toBe(false);
  });

  it('[FX-009] [FS-NOTE-2] the view is chosen in the panel and stored for every tab; «Окно по центру» belongs to its chat', async () => {
    const w = world();
    w.notes.sync();
    w.notes.dispatch({ type: 'view', view: 'center' });
    expect(w.port.setView).toHaveBeenCalledExactlyOnceWith('center');
    expect(w.notes.panel()).toMatchObject({ shown: true, view: 'center', place: null });
    await w.settle();
    w.go(B);
    expect(w.notes.panel().shown).toBe(false);
    // Another tab chose: this one follows, and its side panel opens only on demand.
    w.notes.applyView('drawer');
    expect(w.notes.panel()).toMatchObject({ view: 'drawer', shown: false });
  });

  it('[FX-007] [FX-011] [FS-NOTE-4] a note is created, edited and deleted by the person’s action, once each; a delete asks first; FBuddy’s note is never touched', async () => {
    const w = world();
    w.notes.toggle();
    await w.settle();
    w.notes.dispatch({ type: 'edit', noteId: '2' });
    w.notes.dispatch({ type: 'ask-delete', noteId: '2' });
    w.notes.dispatch({ type: 'delete' });
    await w.settle();
    expect(w.notes.panel().editor).toBeNull();
    expect(w.port.remove).not.toHaveBeenCalled();
    w.notes.dispatch({ type: 'create', template: false });
    w.notes.dispatch({ type: 'input', title: ' New ', text: 'text  ' });
    w.notes.dispatch({ type: 'save' });
    w.notes.dispatch({ type: 'save' });
    await w.settle();
    expect(w.port.create).toHaveBeenCalledExactlyOnceWith({ accountId: '7', fanId: '91' }, 'New', 'text');
    expect(w.notes.panel().notes.map((n) => n.noteId)).toEqual(['1', '2', '9']);
    w.notes.dispatch({ type: 'edit', noteId: '1' });
    w.notes.dispatch({ type: 'input', title: 'Анкета', text: 'Имя: Саша' });
    w.notes.dispatch({ type: 'save' });
    await w.settle();
    expect(w.port.edit).toHaveBeenCalledExactlyOnceWith({ accountId: '7', fanId: '91' }, '1', 'Анкета', 'Имя: Саша', { title: 'Анкета', text: 'Имя: Алекс\nЛокация: Рига' });
    expect(w.notes.panel().notes[0]?.text).toBe('Имя: Саша');
    w.notes.dispatch({ type: 'ask-delete', noteId: '9' });
    expect(w.notes.panel().confirmDelete).toBe('9');
    expect(w.port.remove).not.toHaveBeenCalled();
    w.notes.dispatch({ type: 'delete' });
    await w.settle();
    expect(w.port.remove).toHaveBeenCalledTimes(1);
    expect(w.notes.panel()).toMatchObject({ confirmDelete: null, notes: [{ noteId: '1' }, { noteId: '2' }] });
  });

  it('[FX-011] [FS-NOTE-4] a failed create blocks «Создать» until a fresh read; an empty or too long note is refused, never cut', async () => {
    const w = world();
    w.notes.toggle();
    await w.settle();
    w.notes.dispatch({ type: 'create', template: false });
    w.notes.dispatch({ type: 'save' });
    expect(w.notes.panel().editor?.problem).toEqual({ kind: 'empty' });
    w.notes.dispatch({ type: 'input', title: 'T', text: 'x'.repeat(50_001) });
    w.notes.dispatch({ type: 'save' });
    expect(w.notes.panel().editor?.problem).toEqual({ kind: 'too-long' });
    expect(w.port.create).not.toHaveBeenCalled();
    w.notes.dispatch({ type: 'input', title: 'T', text: 'x' });
    w.port.create.mockResolvedValueOnce({ ok: false, error: { code: 'CG-NOTE-UNCERTAIN' } } as never);
    w.notes.dispatch({ type: 'save' });
    await w.settle();
    expect(w.notes.panel().editor).toMatchObject({ blocked: true, problem: { kind: 'failed', created: true, error: { code: 'CG-NOTE-UNCERTAIN' } } });
    w.notes.dispatch({ type: 'save' });
    await w.settle();
    expect(w.port.create).toHaveBeenCalledTimes(1);
    w.notes.dispatch({ type: 'refresh' });
    await w.settle();
    expect(w.notes.panel().editor).toMatchObject({ blocked: false, problem: null, text: 'x' });
  });

  it('[FX-006] [FS-NOTE-2] [FS-NOTE-4] the name for oneself: a changed name is written on Enter or leaving the field, an empty one deletes, Esc reverts', async () => {
    const w = world();
    w.notes.toggle();
    await w.settle();
    expect(w.notes.panel().name).toEqual({ value: 'Алекс', status: 'idle', error: null });
    w.notes.dispatch({ type: 'name-commit' });
    w.notes.dispatch({ type: 'name-input', value: 'Алекс' });
    w.notes.dispatch({ type: 'name-commit' });
    await w.settle();
    expect(w.port.name).not.toHaveBeenCalled();
    w.notes.dispatch({ type: 'name-input', value: 'Саша' });
    w.notes.dispatch({ type: 'name-revert' });
    expect(w.notes.panel().name.value).toBe('Алекс');
    w.notes.dispatch({ type: 'name-input', value: ' Саша ' });
    w.notes.dispatch({ type: 'name-commit' });
    w.notes.dispatch({ type: 'name-commit' });
    await w.settle();
    expect(w.port.name).toHaveBeenCalledExactlyOnceWith({ accountId: '7', fanId: '91' }, 'Саша', { noteId: '5', name: 'Алекс' });
    expect(w.notes.panel().name).toMatchObject({ value: 'Саша', status: 'saved' });
    w.notes.dispatch({ type: 'name-input', value: '' });
    w.notes.dispatch({ type: 'name-commit' });
    await w.settle();
    expect(w.port.name).toHaveBeenLastCalledWith({ accountId: '7', fanId: '91' }, '', { noteId: '5', name: 'Саша' });
    w.port.name.mockResolvedValueOnce({ ok: false, error: { code: 'CG-NOTE-UNCERTAIN' } } as never);
    w.notes.dispatch({ type: 'name-input', value: 'Ещё' });
    w.notes.dispatch({ type: 'name-commit' });
    await w.settle();
    expect(w.notes.panel().name.status).toBe('unconfirmed');
    w.notes.dispatch({ type: 'name-input', value: 'x'.repeat(1001) });
    expect(w.notes.panel().name.value).toBe('Ещё');
  });

  it('[FX-012] [FS-NOTE-2] drafts are kept per fan: another chat in the middle of an edit loses nothing', async () => {
    const w = world();
    w.notes.toggle();
    await w.settle();
    w.notes.dispatch({ type: 'create', template: false });
    w.notes.dispatch({ type: 'input', title: 'Half', text: 'typed' });
    w.notes.dispatch({ type: 'name-input', value: 'Полу' });
    w.go(B);
    await w.tick();
    expect(w.notes.panel()).toMatchObject({ editor: null, name: { value: '' } });
    w.notes.dispatch({ type: 'create', template: true });
    w.go(A);
    expect(w.notes.panel()).toMatchObject({ editor: { noteId: null, title: 'Half', text: 'typed' }, name: { value: 'Полу' } });
    w.go(B);
    expect(w.notes.panel().editor).toMatchObject({ title: NOTE_TEMPLATE_TITLE, text: NOTE_TEMPLATE_TEXT });
  });

  it('[FX-012] another account of the tab drops what was read and typed under the previous one', async () => {
    const w = world();
    w.notes.toggle();
    await w.settle();
    w.notes.dispatch({ type: 'create', template: false });
    w.relog('8|1');
    w.notes.sync();
    expect(w.notes.panel()).toMatchObject({ body: 'loading', editor: null });
  });

  it('[FX-008] «+ По шаблону» starts the agency’s questionnaire; one per fan', async () => {
    expect(NOTE_TEMPLATE_LABELS).toEqual(['Имя', 'Локация', 'Возраст', 'Работа', 'Хобби', 'Фетиши', 'Характеристика', 'Медиа']);
    expect(NOTE_TEMPLATE_TEXT).toBe('Имя: \nЛокация: \nВозраст: \nРабота: \nХобби: \nФетиши: \nХарактеристика: \nМедиа: ');
    expect(isQuestionnaire(NOTE_TEMPLATE_TEXT)).toBe(true);
    expect(isQuestionnaire('Имя: Алекс\nрассказал про собаку')).toBe(false);
    const w = world();
    w.notes.toggle();
    await w.settle();
    // Fan A already has one (note 1); B has none.
    expect(w.notes.panel().template).toBe(false);
    w.go(B);
    await w.tick();
    expect(w.notes.panel().template).toBe(true);
  });
});
