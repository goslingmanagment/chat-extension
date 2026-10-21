import { describe, expect, it, vi } from 'vitest';

import type { FanslyNotesView } from '@cg/contracts/settings-ext';
import type { FanslyNote } from '@cg/contracts/tab-messages-fansly';

import { createNotesController, type NotesPort, type NotesTarget } from './controller';
import { NOTE_TEMPLATE_TEXT, NOTE_TEMPLATE_TITLE } from './template';

const A: NotesTarget = { accountId: '7', groupId: '81', fanId: '91', fan: { name: 'Alex', handle: 'alex' } };
const B: NotesTarget = { accountId: '7', groupId: '82', fanId: '92', fan: null };
const note = (noteId: string, title = 'T', text = 'x', foreign = false): FanslyNote => ({ noteId, title, text, foreign });

type FillAnswer = Awaited<ReturnType<NotesPort['fill']>>;

function world(opts: { fits?: boolean } = {}) {
  let target: NotesTarget | null = A;
  let session = '7|1';
  let fits = opts.fits ?? false;
  let fillOn = true;
  let opIds = 0;
  /** The fill's start resolves when the test says so (`admit`), or at once. */
  let held: ((answer: FillAnswer) => void) | null = null;
  let hold = false;
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
    fillAllowed: () => fillOn,
    fill: vi.fn((_t: NotesTarget, _fanId: string, _fields: readonly string[]) =>
      hold ? new Promise<FillAnswer>((resolve) => (held = resolve)) : Promise.resolve<FillAnswer>({ ok: true, opId: `op${String((opIds += 1))}`, view: null }),
    ),
    stopFill: vi.fn((_opId: string) => undefined),
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
    fillSwitch(on: boolean) {
      fillOn = on;
    },
    holdFill(on: boolean) {
      hold = on;
    },
    admit(answer: FillAnswer) {
      held?.(answer);
      held = null;
    },
  };
}

describe('[host:fansly] «Заметки»: the controller (R20 P11b)', () => {

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

  it('audit №13: a note longer than the panel holds is read only — no edit, delete or fill from here', async () => {
    const w = world();
    w.port.read.mockResolvedValueOnce({ ok: true, fanRef: '91', notes: [{ ...note('3', 'Анкета', 'Имя: Алекс'), cut: true }], customName: null });
    w.notes.toggle();
    await w.settle();
    w.notes.dispatch({ type: 'edit', noteId: '3' });
    w.notes.dispatch({ type: 'fill-note', noteId: '3' });
    w.notes.dispatch({ type: 'ask-delete', noteId: '3' });
    w.notes.dispatch({ type: 'delete' });
    await w.settle();
    expect(w.notes.panel()).toMatchObject({ editor: null, confirmDelete: null });
    expect(w.port.remove).not.toHaveBeenCalled();
    expect(w.port.fill).not.toHaveBeenCalled();
  });

  it('audit №13: a name changed elsewhere is shown, and the next Enter writes the typed one over it', async () => {
    const w = world();
    w.notes.toggle();
    await w.settle();
    w.port.name.mockResolvedValueOnce({ ok: false, error: { code: 'CG-NOTE-WRITE', detail: 'changed' }, latest: { noteId: '5', name: 'Шура' } } as never);
    w.notes.dispatch({ type: 'name-input', value: 'Саша' });
    w.notes.dispatch({ type: 'name-commit' });
    await w.settle();
    expect(w.notes.panel().name).toMatchObject({ value: 'Саша', status: 'error', changed: { latest: 'Шура' } });
    w.notes.dispatch({ type: 'name-commit' });
    await w.settle();
    expect(w.port.name).toHaveBeenLastCalledWith({ accountId: '7', fanId: '91' }, 'Саша', { noteId: '5', name: 'Шура' });
    expect(w.notes.panel().name).toMatchObject({ value: 'Саша', status: 'saved' });
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
});
