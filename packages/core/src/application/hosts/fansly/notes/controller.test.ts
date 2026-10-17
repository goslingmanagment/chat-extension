import { describe, expect, it, vi } from 'vitest';

import type { SiteOpView } from '@cg/contracts/ops';
import type { FanslyNotesView } from '@cg/contracts/settings-ext';
import type { FanslyNote } from '@cg/contracts/tab-messages-fansly';

import { NOTES_FOLLOW_DELAY_MS, createNotesController, type NotesPort, type NotesTarget } from './controller';
import { NOTE_TEMPLATE_LABELS, NOTE_TEMPLATE_TEXT, NOTE_TEMPLATE_TITLE, isQuestionnaire } from './template';

const A: NotesTarget = { accountId: '7', groupId: '81', fanId: '91', fan: { name: 'Alex', handle: 'alex' } };
const B: NotesTarget = { accountId: '7', groupId: '82', fanId: '92', fan: null };
const note = (noteId: string, title = 'T', text = 'x', foreign = false): FanslyNote => ({ noteId, title, text, foreign });

type FillAnswer = Awaited<ReturnType<NotesPort['fill']>>;

/** A notes-fill operation as `fansly.ops.done` brings it. */
const fillView = (opId: string, state: SiteOpView['state'], fields: readonly { label: string; value: string }[] = []): SiteOpView => ({
  opId,
  feature: 'notes-fill',
  surface: 'dock',
  target: { chat: { hostAccountId: '7', platformFanId: '91' }, fanRef: '91', conversationRef: '81' },
  state,
  phase: 'done',
  startedAt: 1,
  toneUsed: null,
  ...(state === 'done' ? { result: { kind: 'note-fields', fields }, generationRef: 'g' } : {}),
  ...(state === 'failed' ? { error: { code: 'CG-OUTPUT-UNUSABLE' } } : {}),
}) as unknown as SiteOpView;

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

  it('[FX-008] «+ Анкета» starts the agency’s questionnaire; one per fan', async () => {
    expect(NOTE_TEMPLATE_LABELS).toEqual(['Имя', 'Локация', 'Возраст', 'Работа', 'График', 'Хобби', 'Планы и даты', 'Фетиши', 'Характеристика', 'Медиа', 'Другое']);
    expect(NOTE_TEMPLATE_TEXT).toBe('Имя: \nЛокация: \nВозраст: \nРабота: \nГрафик: \nХобби: \nПланы и даты: \nФетиши: \nХарактеристика: \nМедиа: \nДругое: ');
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

  it('[FX-008] [FS-NOTE-2] a questionnaire reads as fields; a field typed rewrites its own line; «Текстом» edits the one text (R20 P11b2)', async () => {
    const w = world();
    w.notes.toggle();
    await w.settle();
    // Note 1 is a questionnaire, FBuddy’s is someone else’s text.
    expect(w.notes.panel().forms['1']).toEqual([
      { kind: 'field', label: 'Имя', facts: [{ text: 'Алекс', date: null }], value: 'Алекс', suggestions: [] },
      { kind: 'field', label: 'Локация', facts: [{ text: 'Рига', date: null }], value: 'Рига', suggestions: [] },
    ]);
    expect(w.notes.panel().forms['2']).toBeUndefined();
    w.notes.dispatch({ type: 'edit', noteId: '1' });
    expect(w.notes.panel().editor).toMatchObject({ asText: false, suggestions: [], form: [{ label: 'Имя' }, { label: 'Локация' }] });
    w.notes.dispatch({ type: 'field', label: 'Локация', value: 'Рига\n\nпереехал в Берлин (10.2026)\n' });
    expect(w.notes.panel().editor?.text).toBe('Имя: Алекс\nЛокация: Рига; переехал в Берлин (10.2026)');
    expect(w.notes.panel().editor?.form?.[1]).toMatchObject({ facts: [{ text: 'Рига', date: null }, { text: 'переехал в Берлин', date: '10.2026' }], value: 'Рига\nпереехал в Берлин (10.2026)' });
    w.notes.dispatch({ type: 'as-text', on: true });
    expect(w.notes.panel().editor).toMatchObject({ asText: true });
    w.notes.dispatch({ type: 'input', title: 'Анкета', text: 'просто текст' });
    expect(w.notes.panel().editor).toMatchObject({ form: null, text: 'просто текст' });
    // A field of no questionnaire, a rewrite that is not there: nothing changes.
    w.notes.dispatch({ type: 'field', label: 'Имя', value: 'Саша' });
    w.notes.dispatch({ type: 'suggestion', index: 0, accept: true });
    expect(w.notes.panel().editor?.text).toBe('просто текст');
    w.notes.dispatch({ type: 'cancel' });
    w.notes.dispatch({ type: 'create', template: true });
    expect(w.notes.panel().editor?.form?.map((part) => (part.kind === 'field' ? part.label : part.text))).toEqual(NOTE_TEMPLATE_LABELS);
    w.notes.dispatch({ type: 'field', label: 'График', value: 'ночные смены' });
    w.notes.dispatch({ type: 'save' });
    await w.settle();
    expect(w.port.create).toHaveBeenCalledExactlyOnceWith({ accountId: '7', fanId: '91' }, 'Анкета', NOTE_TEMPLATE_TEXT.replace('График: ', 'График: ночные смены').trimEnd());
  });
});

describe('[host:fansly] «✨ Заполнить из чата»: the controller (R20 P11c)', () => {
  const QUESTIONNAIRE = 'Имя: Алекс\nЛокация: Рига';
  const editing = async (w: ReturnType<typeof world>) => {
    w.notes.toggle();
    await w.settle();
    w.notes.dispatch({ type: 'edit', noteId: '1' });
  };

  it('[FX-014] [FX-016] [FS-NOTE-6] the empty fields filled, the filled ones’ rewrites under them; «Сохранить» waits for the fill and nothing is written before it', async () => {
    const w = world();
    await editing(w);
    expect(w.notes.panel().editor?.fill).toEqual({ status: 'idle', wrote: [], error: null });
    w.notes.dispatch({ type: 'fill' });
    expect(w.notes.panel().editor?.fill?.status).toBe('running');
    await w.settle();
    w.notes.dispatch({ type: 'save' });
    await w.settle();
    expect(w.port.edit).not.toHaveBeenCalled();
    const [, fanId, fields] = w.port.fill.mock.calls[0] ?? [];
    expect(fanId).toBe('91');
    expect(fields).toEqual(['Имя', 'Локация', ...NOTE_TEMPLATE_LABELS.slice(2)]);
    w.notes.fillDone(fillView('op1', 'done', [
      { label: 'Имя', value: 'Алекс; любит шахматы' },
      { label: 'Локация', value: 'Рига' },
      { label: 'Возраст', value: '34' },
      { label: 'Хобби', value: 'шахматы; бег' },
      ...NOTE_TEMPLATE_LABELS.slice(2).filter((label) => label !== 'Возраст' && label !== 'Хобби').map((label) => ({ label, value: '' })),
    ]));
    const editor = w.notes.panel().editor;
    expect(editor?.text).toBe('Имя: Алекс\nЛокация: Рига\nВозраст: 34\nХобби: шахматы; бег');
    expect(editor?.fill).toEqual({ status: 'done', wrote: ['Возраст', 'Хобби'], error: null });
    expect(editor?.suggestions).toEqual([{ index: 0, label: 'Имя', added: ['любит шахматы'], removed: [], proposed: 'Алекс; любит шахматы', quotes: [] }]);
    expect(editor?.form?.[0]).toMatchObject({ label: 'Имя', suggestions: [{ index: 0 }] });
    expect(w.port.create).not.toHaveBeenCalled();
    expect(w.port.edit).not.toHaveBeenCalled();
    w.notes.dispatch({ type: 'suggestion', index: 0, accept: true });
    w.notes.dispatch({ type: 'save' });
    await w.settle();
    expect(w.port.edit).toHaveBeenCalledExactlyOnceWith({ accountId: '7', fanId: '91' }, '1', 'Анкета', 'Имя: Алекс; любит шахматы\nЛокация: Рига\nВозраст: 34\nХобби: шахматы; бег', { title: 'Анкета', text: QUESTIONNAIRE });
  });

  it('[FX-015] [FX-024] [FS-NOTE-5] the labels go out with the values of their lines (X43), nothing else of the note; a stopped fill’s operation is cancelled and its answer never lands', async () => {
    const w = world();
    await editing(w);
    w.holdFill(true);
    w.notes.dispatch({ type: 'fill' });
    expect(w.port.fill.mock.calls[0]?.slice(1)).toEqual(['91', ['Имя', 'Локация', ...NOTE_TEMPLATE_LABELS.slice(2)], ['Алекс', 'Рига', ...NOTE_TEMPLATE_LABELS.slice(2).map(() => '')]]);
    // Stopped before the admission came back: the admitted operation is cancelled as it comes.
    w.notes.dispatch({ type: 'fill-stop' });
    expect(w.notes.panel().editor?.fill?.status).toBe('idle');
    w.admit({ ok: true, opId: 'late', view: null });
    await w.settle();
    expect(w.port.stopFill).toHaveBeenCalledExactlyOnceWith('late');
    w.notes.fillDone(fillView('late', 'done', [{ label: 'Имя', value: 'Пётр' }]));
    expect(w.notes.panel().editor?.text).toBe(QUESTIONNAIRE);
    // Stopped while running.
    w.holdFill(false);
    w.notes.dispatch({ type: 'fill' });
    await w.settle();
    w.notes.dispatch({ type: 'fill-stop' });
    expect(w.port.stopFill).toHaveBeenLastCalledWith('op1');
    w.notes.fillDone(fillView('op1', 'done', [{ label: 'Возраст', value: '34' }]));
    expect(w.notes.panel().editor?.text).toBe(QUESTIONNAIRE);
    // «Отмена» drops a running fill with the draft.
    w.notes.dispatch({ type: 'fill' });
    await w.settle();
    w.notes.dispatch({ type: 'cancel' });
    expect(w.port.stopFill).toHaveBeenLastCalledWith('op2');
    expect(w.notes.panel().editor).toBeNull();
  });

  it('[FX-014] [FS-OPS-1] the shared admission decides: a chat busy with Reply is said, not retried; a failed fill says why; an answer that ended before its start was read lands at once', async () => {
    const w = world();
    await editing(w);
    w.port.fill.mockResolvedValueOnce({ ok: false, error: { code: 'CG-OP-CHAT-BUSY' } });
    w.notes.dispatch({ type: 'fill' });
    await w.settle();
    expect(w.notes.panel().editor?.fill).toEqual({ status: 'failed', wrote: [], error: { code: 'CG-OP-CHAT-BUSY' } });
    expect(w.port.fill).toHaveBeenCalledTimes(1);
    w.notes.dispatch({ type: 'fill' });
    await w.settle();
    w.notes.fillDone(fillView('op1', 'failed'));
    expect(w.notes.panel().editor?.fill).toEqual({ status: 'failed', wrote: [], error: { code: 'CG-OUTPUT-UNUSABLE' } });
    // Done before the start’s read (a reopened one sends no event): it lands with the start; nothing new is nothing new.
    w.port.fill.mockResolvedValueOnce({ ok: true, opId: 'fast', view: fillView('fast', 'done', [{ label: 'Имя', value: 'Алекс' }]) });
    w.notes.dispatch({ type: 'fill' });
    await w.settle();
    expect(w.notes.panel().editor).toMatchObject({ text: QUESTIONNAIRE, suggestions: [], fill: { status: 'done', wrote: [] } });
  });

  it('[FX-014] no fill where the page’s switch is off or the draft is no questionnaire', async () => {
    const w = world();
    await editing(w);
    w.fillSwitch(false);
    w.notes.layout();
    expect(w.notes.panel().editor?.fill).toBeNull();
    w.notes.dispatch({ type: 'fill' });
    await w.settle();
    expect(w.port.fill).not.toHaveBeenCalled();
    w.fillSwitch(true);
    w.notes.dispatch({ type: 'input', title: 'Анкета', text: 'просто текст' });
    expect(w.notes.panel().editor?.fill).toBeNull();
    w.notes.dispatch({ type: 'fill' });
    await w.settle();
    expect(w.port.fill).not.toHaveBeenCalled();
  });
});

describe('[host:fansly] «Заметки» as in the Fansly extension 2.11–2.13: the controller (R20 P11b2)', () => {
  const opened = async (w: ReturnType<typeof world>) => {
    w.notes.toggle();
    await w.settle();
  };
  /** A merge-mode answer: the fan's words under a value, a field the hub named itself. */
  const mergeView = (opId: string): SiteOpView => {
    const view = fillView(opId, 'done') as unknown as { result: unknown };
    return {
      ...view,
      result: {
        kind: 'note-fields',
        fields: [
          { label: 'Имя', value: 'Алекс; любит шахматы', quotes: ['I love chess'] },
          { label: 'Локация', value: 'Рига; Юрмала (08.2026)', quotes: ['moved to Jurmala'] },
          { label: 'Возраст', value: '34', quotes: ['I am 34'] },
          { label: 'Работа', value: 'медбрат (09.2026)' },
          ...NOTE_TEMPLATE_LABELS.slice(4).map((label) => ({ label, value: '' })),
        ],
        proposed: [{ label: 'Питомцы', value: 'кот Барсик', quotes: ['my cat Barsik'] }],
      },
    } as unknown as SiteOpView;
  };

  it('[FX-022] [FS-NOTE-6] «✨ Дополнить из чата» on the questionnaire being read opens it and fills; not on a free note or FBuddy’s, not while a note is edited', async () => {
    const w = world();
    await opened(w);
    expect(w.notes.panel().fill).toBe(true);
    w.notes.dispatch({ type: 'fill-note', noteId: '2' });
    await w.settle();
    expect(w.port.fill).not.toHaveBeenCalled();
    expect(w.notes.panel().editor).toBeNull();
    w.notes.dispatch({ type: 'fill-note', noteId: '1' });
    await w.settle();
    expect(w.notes.panel().editor).toMatchObject({ noteId: '1', fill: { status: 'running' } });
    expect(w.notes.panel().fill).toBe(false);
    expect(w.port.fill).toHaveBeenCalledOnce();
    expect(w.port.fill.mock.calls[0]?.[2]).toEqual(['Имя', 'Локация', ...NOTE_TEMPLATE_LABELS.slice(2)]);
    w.notes.dispatch({ type: 'fill-note', noteId: '1' });
    await w.settle();
    expect(w.port.fill).toHaveBeenCalledOnce();
    w.fillSwitch(false);
    w.notes.dispatch({ type: 'cancel' });
    expect(w.notes.panel().fill).toBe(false);
  });

  it('[FX-023] [FS-NOTE-6] the fan’s words wait for «Слова фана» under the fields the Goose wrote (marked); a rewrite shows its own; «Принять все»; a field the hub named gets a line and «В Другое»', async () => {
    const w = world();
    await opened(w);
    w.notes.dispatch({ type: 'fill-note', noteId: '1' });
    await w.settle();
    w.notes.fillDone(mergeView('op1'));
    let editor = w.notes.panel().editor;
    expect(editor?.text).toBe('Имя: Алекс\nЛокация: Рига\nВозраст: 34\nРабота: медбрат (09.2026)\nПитомцы: кот Барсик');
    expect(editor?.fill).toEqual({ status: 'done', wrote: ['Возраст', 'Работа', 'Питомцы'], error: null });
    expect(editor?.sourceCount).toBe(2);
    expect(editor?.sourcesOpen).toBe(false);
    const field = (label: string) => w.notes.panel().editor?.form?.find((part) => part.kind === 'field' && part.label === label);
    expect(field('Возраст')).toMatchObject({ ai: true });
    expect(field('Возраст')).not.toHaveProperty('quotes');
    expect(field('Имя')).not.toHaveProperty('ai');
    expect(field('Работа')).toMatchObject({ ai: true, facts: [{ text: 'медбрат', date: '09.2026' }] });
    expect(field('Питомцы')).toMatchObject({ ai: true, proposed: true });
    expect(editor?.suggestions.map((suggestion) => [suggestion.label, suggestion.added, suggestion.quotes])).toEqual([
      ['Имя', ['любит шахматы'], ['I love chess']],
      ['Локация', ['Юрмала (08.2026)'], ['moved to Jurmala']],
    ]);
    w.notes.dispatch({ type: 'sources', open: true });
    expect(field('Возраст')).toMatchObject({ quotes: [{ label: null, quote: 'I am 34' }] });
    expect(field('Питомцы')).toMatchObject({ quotes: [{ label: null, quote: 'my cat Barsik' }] });
    // The text view: the words follow the text, named; the named field keeps its «В Другое».
    w.notes.dispatch({ type: 'as-text', on: true });
    expect(w.notes.panel().editor?.looseQuotes).toEqual([{ label: 'Возраст', quote: 'I am 34' }, { label: 'Питомцы', quote: 'my cat Barsik' }]);
    expect(w.notes.panel().editor?.proposed).toEqual(['Питомцы']);
    w.notes.dispatch({ type: 'as-text', on: false });
    // «В Другое»: no «Другое» in the note — the line becomes one, its words go with it.
    w.notes.dispatch({ type: 'to-other', label: 'Питомцы' });
    editor = w.notes.panel().editor;
    expect(editor?.text).toBe('Имя: Алекс\nЛокация: Рига\nВозраст: 34\nРабота: медбрат (09.2026)\nДругое: Питомцы: кот Барсик');
    expect(editor?.proposed).toEqual([]);
    expect(field('Другое')).toMatchObject({ ai: true, quotes: [{ label: 'Питомцы', quote: 'my cat Barsik' }] });
    w.notes.dispatch({ type: 'suggestion-all' });
    editor = w.notes.panel().editor;
    expect(editor?.suggestions).toEqual([]);
    expect(editor?.text).toBe('Имя: Алекс; любит шахматы\nЛокация: Рига; Юрмала (08.2026)\nВозраст: 34\nРабота: медбрат (09.2026)\nДругое: Питомцы: кот Барсик');
    expect(field('Имя')).toMatchObject({ ai: true });
    expect(w.port.edit).not.toHaveBeenCalled();
    // A new fill starts clean.
    w.notes.dispatch({ type: 'fill' });
    expect(w.notes.panel().editor).toMatchObject({ sourceCount: 0, sourcesOpen: false, proposed: [] });
  });

  it('[FX-024] [FS-NOTE-6] a rewrite of «Другое» waiting under it takes a fact moved «В Другое» on both sides, so «Принять» still applies; a field with no place is named', async () => {
    const w = world();
    w.port.read.mockResolvedValueOnce({ ok: true, fanRef: '91', notes: [note('1', 'Анкета', 'Имя: Алекс\nДругое: из Техаса\nбрат-близнец')], customName: null });
    await opened(w);
    w.notes.dispatch({ type: 'fill-note', noteId: '1' });
    await w.settle();
    const view = fillView('op1', 'done') as unknown as Record<string, unknown>;
    w.notes.fillDone({
      ...view,
      result: { kind: 'note-fields', fields: [{ label: 'Имя', value: '' }, { label: 'Другое', value: 'есть брат' }, ...NOTE_TEMPLATE_LABELS.slice(1, -1).map((label) => ({ label, value: '' }))], proposed: [{ label: 'Питомцы', value: 'кот' }] },
    } as unknown as SiteOpView);
    expect(w.notes.panel().editor?.suggestions).toMatchObject([{ label: 'Другое', added: ['есть брат'], removed: ['из Техаса'], proposed: 'есть брат' }]);
    w.notes.dispatch({ type: 'to-other', label: 'Питомцы' });
    expect(w.notes.panel().editor?.text).toBe('Имя: Алекс\nДругое: из Техаса; Питомцы: кот\nбрат-близнец');
    expect(w.notes.panel().editor?.suggestions).toMatchObject([{ label: 'Другое', added: ['есть брат'], removed: ['из Техаса'], proposed: 'есть брат; Питомцы: кот' }]);
    w.notes.dispatch({ type: 'suggestion', index: 0, accept: true });
    expect(w.notes.panel().editor?.text).toBe('Имя: Алекс\nДругое: есть брат; Питомцы: кот\nбрат-близнец');
    // A full questionnaire with no «Другое»: the hub's field has nowhere to go, and the line says so.
    w.notes.dispatch({ type: 'cancel' });
    const full = Array.from({ length: 30 }, (_, n) => `Поле ${String(n)}: x`).join('\n');
    w.port.read.mockResolvedValueOnce({ ok: true, fanRef: '91', notes: [note('1', 'Анкета', full)], customName: null });
    w.notes.dispatch({ type: 'refresh' });
    await w.settle();
    w.notes.dispatch({ type: 'fill-note', noteId: '1' });
    await w.settle();
    w.notes.fillDone({ ...(fillView('op2', 'done') as unknown as Record<string, unknown>), result: { kind: 'note-fields', fields: [{ label: 'Поле 0', value: '' }], proposed: [{ label: 'Питомцы', value: 'кот' }] } } as unknown as SiteOpView);
    expect(w.notes.panel().editor?.fill).toEqual({ status: 'done', wrote: [], error: null, unplaced: ['Питомцы'] });
    expect(w.notes.panel().editor?.text).toBe(full);
  });

  it('[FX-019] [FS-NOTE-2] every free note shows when it was created, the questionnaire does not; an edit keeps the time read, a new note without one is dated now', async () => {
    const w = world();
    const created = new Date(2026, 9, 16, 19, 56).getTime();
    const lastYear = new Date(2025, 2, 4, 8, 5).getTime();
    w.port.read.mockResolvedValueOnce({ ok: true, fanRef: '91', notes: [{ ...note('1', 'Анкета', 'Имя: Алекс\nЛокация: Рига'), createdAtMs: created }, { ...note('3', 'кастом', 'хочет видео'), createdAtMs: created }, { ...note('4', '', 'old'), createdAtMs: lastYear }, note('6', 'no time')], customName: null });
    (w.port as NotesPort).now = () => new Date(2026, 9, 17, 12, 0).getTime();
    await opened(w);
    expect(w.notes.panel().dates).toEqual({
      '3': { day: '16.10', full: '16.10.2026', time: '19:56', iso: new Date(created).toISOString() },
      '4': { day: '04.03.2025', full: '04.03.2025', time: '08:05', iso: new Date(lastYear).toISOString() },
    });
    w.notes.dispatch({ type: 'edit', noteId: '3' });
    w.notes.dispatch({ type: 'input', title: 'кастом', text: 'хочет видео!' });
    w.notes.dispatch({ type: 'save' });
    await w.settle();
    expect(w.notes.panel().notes.find((entry) => entry.noteId === '3')).toMatchObject({ text: 'хочет видео!', createdAtMs: created });
    w.notes.dispatch({ type: 'create', template: false });
    w.notes.dispatch({ type: 'input', title: '', text: 'new' });
    w.notes.dispatch({ type: 'save' });
    await w.settle();
    expect(w.notes.panel().dates?.['9']).toMatchObject({ day: '17.10', time: '12:00' });
  });
});
