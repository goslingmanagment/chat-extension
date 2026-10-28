import { describe, expect, it, vi } from 'vitest';

import type { SiteOpView } from '@cg/contracts/ops';
import type { NoteData, NotesView } from '@cg/contracts/notes';

import { createNotesController, type NotesPort, type NotesTarget } from './controller';
import { NOTE_TEMPLATE_TEXT, NOTE_TEMPLATE_TITLE } from './template';

const A: NotesTarget = { accountId: '7', groupId: '81', fanId: '91', fan: { name: 'Alex', handle: 'alex' } };
const B: NotesTarget = { accountId: '7', groupId: '82', fanId: '92', fan: null };
const note = (noteId: string, title = 'T', text = 'x', foreign = false): NoteData => ({ noteId, title, text, foreign });
const FORM = 'Имя: Алекс\nЛокация: Рига\nРабота: \nХобби: бег\nпо утрам';

type FillAnswer = Awaited<ReturnType<NotesPort['fill']>>;

function world() {
  let target: NotesTarget | null = A;
  let session = '7|1';
  let opIds = 0;
  const stored = new Map<string, NoteData[]>([['91', [note('1', 'Анкета', FORM), note('2', 'FBuddy Notes', 'likes cats', true), note('3', '', 'старая заметка')]], ['92', []]]);
  const port = {
    session: () => session,
    target: () => target,
    read: vi.fn((t: NotesTarget) => Promise.resolve({ ok: true as const, fanRef: t.fanId ?? '91', notes: [...(stored.get(t.fanId ?? '91') ?? [])], customName: t.fanId === '91' ? { noteId: '5', name: 'Алекс' } : null })),
    create: vi.fn((_who, title: string, text: string) => Promise.resolve({ ok: true as const, note: note('9', title, text) })),
    edit: vi.fn((_who, noteId: string, title: string, text: string, _current: Pick<NoteData, 'title' | 'text'>) => Promise.resolve<Awaited<ReturnType<NotesPort['edit']>>>({ ok: true as const, note: note(noteId, title, text) })),
    remove: vi.fn(() => Promise.resolve({ ok: true as const })),
    name: vi.fn((_who, name: string) => Promise.resolve({ ok: true as const, customName: name === '' ? null : { noteId: '5', name } })),
    setView: vi.fn((_view: NotesView) => undefined),
    fillAllowed: () => true,
    fill: vi.fn((_t: NotesTarget, _fanId: string, _fields: readonly string[], _values: readonly string[]) => Promise.resolve<FillAnswer>({ ok: true, opId: `op${String((opIds += 1))}`, view: null })),
    stopFill: vi.fn((_opId: string) => undefined),
    fits: () => false,
    place: () => ({ kind: 'over' as const, top: 60, bottom: 12, left: 900, width: 340 }),
    setTimer: (_ms: number, _run: () => void) => ({}),
    clearTimer: (_handle: unknown) => undefined,
  } satisfies NotesPort;
  const notes = createNotesController(port);
  const settle = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  /** The hub's answer to the fill `opId`: the fields asked, by label, and the ones it named itself. */
  const answer = (opId: string, fields: Readonly<Record<string, string>>, proposed: Readonly<Record<string, string>> = {}): SiteOpView =>
    ({
      opId,
      feature: 'notes-fill',
      state: 'done',
      result: { kind: 'note-fields', fields: Object.entries(fields).map(([label, value]) => ({ label, value })), proposed: Object.entries(proposed).map(([label, value]) => ({ label, value })) },
    }) as unknown as SiteOpView;
  return {
    port,
    notes,
    settle,
    answer,
    go(next: NotesTarget | null) {
      target = next;
      notes.sync();
    },
    relog(next: string) {
      session = next;
    },
  };
}

async function opened() {
  const w = world();
  w.notes.toggle();
  await w.settle();
  return w;
}

describe('[host:fansly] «Заметки»: the controller', () => {
  it('[FS-NOTE-2] the questionnaire reads as a table of what is written; the empty fields and the template’s missing ones are offered as «+ Метка»; the other notes newest first', async () => {
    const w = await opened();
    const panel = w.notes.panel();
    expect(panel.form).toMatchObject({ noteId: '1', title: 'Анкета', locked: false });
    expect(panel.form?.parts.map((part) => (part.kind === 'field' ? `${part.label}: ${part.facts.map((fact) => fact.text).join(' | ')}` : part.text))).toEqual(['Имя: Алекс', 'Локация: Рига', 'Хобби: бег | по утрам']);
    expect(panel.form?.blank).toEqual(['Работа', 'Возраст', 'График', 'Планы и даты', 'Фетиши', 'Характеристика', 'Медиа', 'Другое']);
    expect(panel.items.map((item) => item.noteId)).toEqual(['2', '3']);
  });

  it('[FS-NOTE-4] a field is written in place: only its line changes, an unchanged one writes nothing, a missing one gets its line', async () => {
    const w = await opened();
    w.notes.dispatch({ type: 'field-open', label: 'Хобби' });
    expect(w.notes.panel().form?.field).toMatchObject({ label: 'Хобби', value: 'бег\nпо утрам', blank: false });
    w.notes.dispatch({ type: 'field-save' });
    await w.settle();
    expect(w.port.edit).not.toHaveBeenCalled();
    w.notes.dispatch({ type: 'field-open', label: 'Работа' });
    w.notes.dispatch({ type: 'field-input', value: 'врач\nв клинике' });
    w.notes.dispatch({ type: 'field-save' });
    w.notes.dispatch({ type: 'field-save' });
    await w.settle();
    expect(w.port.edit).toHaveBeenCalledExactlyOnceWith({ accountId: '7', fanId: '91' }, '1', 'Анкета', 'Имя: Алекс\nЛокация: Рига\nРабота: врач; в клинике\nХобби: бег\nпо утрам', { title: 'Анкета', text: FORM }, expect.objectContaining({ origin: 'field' }));
    expect(w.notes.panel().form?.field).toBeNull();
    w.notes.dispatch({ type: 'field-open', label: 'Возраст' });
    w.notes.dispatch({ type: 'field-input', value: '34' });
    w.notes.dispatch({ type: 'field-save' });
    await w.settle();
    expect(w.port.edit).toHaveBeenLastCalledWith(expect.anything(), '1', 'Анкета', 'Имя: Алекс\nЛокация: Рига\nРабота: врач; в клинике\nХобби: бег\nпо утрам\nВозраст: 34', expect.anything(), expect.objectContaining({ origin: 'field' }));
  });

  it('[FS-NOTE-4] a fan without a questionnaire gets «Анкета» with the template’s fields by the first field written', async () => {
    const w = world();
    w.go(B);
    w.notes.toggle();
    await w.settle();
    expect(w.notes.panel().form).toMatchObject({ noteId: null, parts: [] });
    w.notes.dispatch({ type: 'field-open', label: 'Имя' });
    w.notes.dispatch({ type: 'field-input', value: 'Маркус' });
    w.notes.dispatch({ type: 'field-save' });
    await w.settle();
    expect(w.port.create).toHaveBeenCalledExactlyOnceWith({ accountId: '7', fanId: '92' }, NOTE_TEMPLATE_TITLE, NOTE_TEMPLATE_TEXT.replace('Имя: ', 'Имя: Маркус'), expect.objectContaining({ origin: 'field' }));
  });

  it('[FS-NOTE-4] a quick note is one line and Enter, written once; a note is edited as text; a delete asks first; FBuddy’s note is never touched', async () => {
    const w = await opened();
    w.notes.dispatch({ type: 'quick-input', text: '  обещал фото  ' });
    w.notes.dispatch({ type: 'quick-save' });
    w.notes.dispatch({ type: 'quick-save' });
    await w.settle();
    expect(w.port.create).toHaveBeenCalledExactlyOnceWith({ accountId: '7', fanId: '91' }, '', 'обещал фото', expect.objectContaining({ origin: 'quick' }));
    expect(w.notes.panel().quick.text).toBe('');
    expect(w.notes.panel().items.map((item) => item.noteId)).toEqual(['9', '2', '3']);
    w.notes.dispatch({ type: 'edit', noteId: '2' });
    w.notes.dispatch({ type: 'ask-delete', noteId: '2' });
    w.notes.dispatch({ type: 'delete' });
    await w.settle();
    expect(w.notes.panel().editor).toBeNull();
    expect(w.port.remove).not.toHaveBeenCalled();
    w.notes.dispatch({ type: 'edit', noteId: '3' });
    w.notes.dispatch({ type: 'input', title: ' Важно ', text: 'новая  ' });
    w.notes.dispatch({ type: 'save' });
    await w.settle();
    expect(w.port.edit).toHaveBeenCalledExactlyOnceWith({ accountId: '7', fanId: '91' }, '3', 'Важно', 'новая', { title: '', text: 'старая заметка' }, expect.objectContaining({ origin: 'editor' }));
    w.notes.dispatch({ type: 'ask-delete', noteId: '9' });
    expect(w.notes.panel().confirmDelete).toBe('9');
    expect(w.port.remove).not.toHaveBeenCalled();
    w.notes.dispatch({ type: 'delete' });
    await w.settle();
    expect(w.port.remove).toHaveBeenCalledTimes(1);
    expect(w.notes.panel().items.map((item) => item.noteId)).toEqual(['2', '3']);
  });

  it('[FS-NOTE-6] «Дополнить из чата»: each finding stands in its row; one ✓ is one write, «Отменить» puts it back, «Принять все» writes the rest at once', async () => {
    const w = await opened();
    w.notes.dispatch({ type: 'fill' });
    await w.settle();
    expect(w.port.fill).toHaveBeenCalledTimes(1);
    const [, , fields, values] = w.port.fill.mock.calls[0] ?? [];
    expect(fields?.slice(0, 4)).toEqual(['Имя', 'Локация', 'Работа', 'Хобби']);
    // The lines written under a field never leave the tab: «по утрам» is not asked.
    expect(values?.slice(0, 4)).toEqual(['Алекс', 'Рига', '', 'бег']);
    expect(w.notes.panel().form?.fill?.status).toBe('running');
    w.notes.fillDone(w.answer('op1', { Имя: '', Локация: 'Рига, Латвия (10.2026)', Работа: 'врач', Хобби: 'бег; плавание', Возраст: '34' }, { Питомцы: 'кот' }));
    const rows = (): unknown[] =>
      (w.notes.panel().form?.parts ?? []).map((part) =>
        part.kind === 'text' ? part.text : [part.label, part.facts.map((fact) => fact.text).join(' | '), part.suggestion === undefined ? null : `${part.suggestion.kind}: ${part.suggestion.base ?? ''}+${part.suggestion.text}`, part.ghost === true],
      );
    expect(w.notes.panel().form?.fill).toMatchObject({ status: 'review', pending: 5, written: 0 });
    // In place: a refinement after the words it extends, an empty field as a faint row where it stands, an addition to
    // what is written, the template's field and the Goose's own after the last field.
    expect(rows()).toEqual([
      ['Имя', 'Алекс', null, false],
      ['Локация', 'Рига', 'refine: Рига+, Латвия', false],
      ['Работа', '', 'fill: +врач', true],
      ['Хобби', 'бег | по утрам', 'add: +плавание', false],
      ['Возраст', '', 'fill: +34', true],
      ['Питомцы', '', 'new: +кот', true],
    ]);
    expect(w.notes.panel().form?.blank).not.toContain('Возраст');
    expect(w.port.edit).not.toHaveBeenCalled();

    w.notes.dispatch({ type: 'suggestion-accept', index: 0 });
    await w.settle();
    const after = 'Имя: Алекс\nЛокация: Рига, Латвия (10.2026)\nРабота: \nХобби: бег\nпо утрам';
    expect(w.port.edit).toHaveBeenCalledExactlyOnceWith(expect.anything(), '1', 'Анкета', after, { title: 'Анкета', text: FORM }, expect.objectContaining({ origin: 'fill' }));
    expect(w.notes.panel().form?.fill).toMatchObject({ status: 'review', pending: 4, written: 1, undo: { labels: ['Локация'] } });
    expect(w.notes.panel().form?.parts[1]).toMatchObject({ label: 'Локация', fresh: true });

    // «Отменить»: the questionnaire as it was, the suggestion waiting again.
    w.notes.dispatch({ type: 'suggestion-undo' });
    await w.settle();
    expect(w.port.edit).toHaveBeenLastCalledWith(expect.anything(), '1', 'Анкета', FORM, { title: 'Анкета', text: after }, expect.objectContaining({ origin: 'undo' }));
    expect(w.notes.panel().form?.fill).toMatchObject({ pending: 5, written: 0, undo: null });

    w.notes.dispatch({ type: 'suggestion-dismiss', index: 0 });
    w.notes.dispatch({ type: 'suggestions-accept-all' });
    await w.settle();
    expect(w.port.edit).toHaveBeenLastCalledWith(expect.anything(), '1', 'Анкета', 'Имя: Алекс\nЛокация: Рига\nРабота: врач\nХобби: бег; плавание\nпо утрам\nВозраст: 34\nПитомцы: кот', { title: 'Анкета', text: FORM }, expect.objectContaining({ origin: 'fill' }));
    expect(w.notes.panel().form?.fill).toMatchObject({ status: 'done', pending: 0, written: 4, dismissed: 1 });
    expect(w.notes.panel().form?.parts.flatMap((part) => (part.kind === 'field' && part.fresh === true ? [part.label] : []))).toEqual(['Работа', 'Хобби', 'Возраст', 'Питомцы']);
  });

  it('[FS-NOTE-6] while the answer streams: how much of the chat the model reads, the fields answered so far, what is new in them standing in their rows not yet to take', async () => {
    const w = await opened();
    w.notes.dispatch({ type: 'fill' });
    await w.settle();
    const progress = () => w.notes.panel().form?.fill?.progress;
    expect(progress()).toMatchObject({ stage: 'gather', read: null, checked: 0 });
    w.notes.fillUpdate({ opId: 'op1', seq: 1, append: '', phase: { name: 'awaiting-first-chunk', since: 1 }, served: 860 });
    expect(progress()).toMatchObject({ stage: 'read', read: 860 });
    // A line half written is not read yet: «Рабо» is no field.
    w.notes.fillUpdate({ opId: 'op1', seq: 2, append: 'Имя: =\nЛокация: Рига, Латвия (10.2026)\n> «I moved to Latvia»\nРабо', phase: { name: 'streaming', since: 2 } });
    expect(progress()).toMatchObject({ stage: 'check', read: 860, checked: 2, total: 11, found: 1, current: 'Работа' });
    const parts = (): readonly unknown[] => (w.notes.panel().form?.parts ?? []).map((part) => (part.kind === 'field' ? [part.label, part.suggestion?.state ?? null, part.seen === true, part.current === true] : part.text));
    expect(parts().slice(0, 2)).toEqual([
      ['Имя', null, true, false],
      ['Локация', 'arriving', false, false],
    ]);
    // An arriving suggestion is not taken yet.
    w.notes.dispatch({ type: 'suggestion-accept', index: 0 });
    await w.settle();
    expect(w.port.edit).not.toHaveBeenCalled();
    // The end: the same suggestions, now to take.
    w.notes.fillDone(w.answer('op1', { Имя: '', Локация: 'Рига, Латвия (10.2026)', Работа: 'врач' }));
    expect(w.notes.panel().form?.fill).toMatchObject({ status: 'review', progress: null, pending: 2 });
    expect(parts().slice(0, 3)).toEqual([
      ['Имя', null, false, false],
      ['Локация', 'pending', false, false],
      ['Работа', 'pending', false, false],
    ]);
  });

  it('[FX-016] a ✓ never writes over a field typed since the Goose read it: the row asks «Заменить?», the rest goes into Fansly’s newer version', async () => {
    const w = await opened();
    w.notes.dispatch({ type: 'fill' });
    await w.settle();
    w.notes.fillDone(w.answer('op1', { Работа: 'врач', Локация: 'Рига, Латвия' }));
    // Another tab wrote «Работа» meanwhile: the edit is refused as changed, with Fansly's version.
    const latest = note('1', 'Анкета', FORM.replace('Работа: ', 'Работа: юрист'));
    w.port.edit.mockResolvedValueOnce({ ok: false, error: { code: 'CG-NOTE-WRITE', detail: 'changed' }, latest } as never);
    w.notes.dispatch({ type: 'suggestions-accept-all' });
    await w.settle();
    expect(w.port.edit).toHaveBeenLastCalledWith(expect.anything(), '1', 'Анкета', 'Имя: Алекс\nЛокация: Рига, Латвия\nРабота: юрист\nХобби: бег\nпо утрам', { title: 'Анкета', text: latest.text }, expect.objectContaining({ origin: 'fill' }));
    const work = w.notes.panel().form?.parts.find((part) => part.kind === 'field' && part.label === 'Работа');
    expect(work).toMatchObject({ facts: [{ text: 'юрист' }], suggestion: { state: 'conflict', now: 'юрист', value: 'врач' } });
    // The chatter's own call: «Заменить» writes it over.
    w.notes.dispatch({ type: 'suggestion-replace', index: 0 });
    await w.settle();
    expect(w.port.edit).toHaveBeenLastCalledWith(expect.anything(), '1', 'Анкета', 'Имя: Алекс\nЛокация: Рига, Латвия\nРабота: врач\nХобби: бег\nпо утрам', expect.anything(), expect.objectContaining({ origin: 'fill' }));
    expect(w.notes.panel().form?.fill).toMatchObject({ status: 'done', written: 2 });
  });

  it('[FS-NOTE-6] «Остановить» drops the fill and its late answer; nothing found is said once', async () => {
    const w = await opened();
    w.notes.dispatch({ type: 'fill' });
    await w.settle();
    w.notes.dispatch({ type: 'fill-stop' });
    expect(w.port.stopFill).toHaveBeenCalledWith('op1');
    w.notes.fillDone(w.answer('op1', { Работа: 'врач' }));
    expect(w.notes.panel().form?.fill?.status).toBe('idle');
    w.notes.dispatch({ type: 'fill' });
    await w.settle();
    w.notes.fillDone(w.answer('op2', { Имя: '', Локация: 'Рига' }));
    expect(w.notes.panel().form?.fill?.status).toBe('empty');
  });

  it('[FX-012] what is typed is kept per fan: another chat in the middle loses nothing; a moment without the chat never hides it', async () => {
    const w = await opened();
    w.notes.dispatch({ type: 'quick-input', text: 'половина' });
    w.notes.dispatch({ type: 'field-open', label: 'Работа' });
    w.notes.dispatch({ type: 'field-input', value: 'вра' });
    w.go(null);
    expect(w.notes.panel()).toMatchObject({ shown: true, fan: { name: 'Alex', handle: 'alex' }, quick: { text: 'половина' } });
    w.go(B);
    w.notes.dispatch({ type: 'refresh' });
    await w.settle();
    expect(w.notes.panel()).toMatchObject({ body: 'ready', quick: { text: '' }, form: { noteId: null, field: null } });
    w.go(A);
    expect(w.notes.panel()).toMatchObject({ quick: { text: 'половина' }, form: { field: { label: 'Работа', value: 'вра' } } });
  });

  it('audit №13: a note longer than the panel holds is read only: no field, text, delete or fill from here', async () => {
    const w = world();
    w.port.read.mockResolvedValueOnce({ ok: true, fanRef: '91', notes: [{ ...note('3', 'Анкета', FORM), cut: true }], customName: null });
    w.notes.toggle();
    await w.settle();
    expect(w.notes.panel().form).toMatchObject({ noteId: '3', locked: true, fill: null });
    w.notes.dispatch({ type: 'field-open', label: 'Имя' });
    w.notes.dispatch({ type: 'edit', noteId: '3' });
    w.notes.dispatch({ type: 'fill' });
    w.notes.dispatch({ type: 'ask-delete', noteId: '3' });
    w.notes.dispatch({ type: 'delete' });
    await w.settle();
    expect(w.notes.panel()).toMatchObject({ editor: null, confirmDelete: null, form: { field: null } });
    expect(w.port.remove).not.toHaveBeenCalled();
    expect(w.port.fill).not.toHaveBeenCalled();
  });

  it('audit №13: a name changed elsewhere is shown, and the next Enter writes the typed one over it', async () => {
    const w = await opened();
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
    const w = await opened();
    w.notes.dispatch({ type: 'quick-input', text: 'x' });
    w.relog('8|1');
    w.notes.sync();
    expect(w.notes.panel()).toMatchObject({ body: 'loading', quick: { text: '' } });
  });
});
