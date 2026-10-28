import { describe, expect, it, vi } from 'vitest';
import type { FanslyClient } from '@cg/fansly-api';
import { FanslyApiError } from '@cg/fansly-api';
import { createNotesController, type NotesPort } from '@cg/core/application/notes';
import type { BackgroundKit, HostSiteSender } from '../src/composition/background/host-module';
import { createNotesService, writeFailure } from '../bg/fansly/notes';

const FAN = '789';
const target = { pageId: 7, hostAccountId: '123', fanRef: FAN };
const sender: HostSiteSender = { kind: 'tab', host: 'fansly-web', tabId: 1, tabSessionId: 'tab', url: 'https://fansly.com/messages/456' };
const account = { id: FAN, notes: [{ id: '801', contentType: 12000, contentId: FAN, title: 'Анкета', note: 'Имя: Алекс' }, { id: '802', contentType: 12002, contentId: FAN, title: 'Custom Username', note: 'Алекс' }, { id: '803', contentType: 12000, contentId: FAN, title: 'FBuddy Notes', note: 'x' }] };

function world() {
  let enabled = true;
  const written = vi.fn<BackgroundKit['noteAttributions']['written']>();
  const kit = {
    hub: {
      session: () => ({ hubOrigin: 'test', userId: 1 }),
      page: () => Promise.resolve({ ok: true }),
      bootstrap: () => ({ pages: [{ pageId: 7, platform: 'fansly', platformAccountId: '123', features: { notes: { available: enabled } } }] }),
    },
    router: { tabs: () => ['tab', 'tab2'] },
    clock: { now: () => Date.UTC(2026, 9, 16) },
    noteAttributions: { written },
  } as unknown as BackgroundKit;
  const answers: unknown[] = [];
  const start = vi.fn(() => Promise.resolve({ response: answers.shift(), status: 200 }));
  const cancel = vi.fn();
  const prepare = vi.fn((_call: unknown) => Promise.resolve({ start, cancel }));
  const client = { prepare } as unknown as FanslyClient;
  const notes = createNotesService(kit, () => Promise.resolve(client));
  return { notes, prepare, start, cancel, answers, written, disable: () => { enabled = false; } };
}

describe('[host:fansly] «Заметки» in the background (R20 P11b)', () => {
  it('[FS-NOTE-3] [FS-NOTE-4] the page’s own switch and the same session and account are checked before the call and just before it leaves', async () => {
    const w = world();
    expect(await w.notes.read({ ...target, hostAccountId: '999', groupId: '456' }, sender)).toEqual({ ok: false, error: { code: 'CG-FEATURE-DISABLED' } });
    expect(await w.notes.read({ ...target, groupId: '456' }, { ...sender, tabSessionId: 'gone' })).toMatchObject({ ok: false });
    expect(w.prepare).not.toHaveBeenCalled();
    w.prepare.mockImplementationOnce(() => {
      w.disable();
      return Promise.resolve({ start: w.start, cancel: w.cancel });
    });
    expect(await w.notes.create({ ...target, title: 'T', text: 'x' }, sender)).toEqual({ ok: false, error: { code: 'CG-CONTEXT-CHANGED' } });
    expect(w.start).not.toHaveBeenCalled();
    expect(w.cancel).toHaveBeenCalledTimes(1);
  });

  it('[FS-NOTE-4] [FX-011] writes are Fansly’s own calls, once; an unknown fate is CG-NOTE-UNCERTAIN; a cooldown refuses before anything leaves', async () => {
    const w = world();
    w.answers.push({ id: '901', contentType: 12000, contentId: FAN, title: 'T', note: 'x' });
    expect(await w.notes.create({ ...target, title: 'T', text: 'x' }, sender)).toEqual({ ok: true, note: { noteId: '901', title: 'T', text: 'x', foreign: false } });
    expect(w.prepare).toHaveBeenLastCalledWith({ purpose: 'notes', route: 'notes.create', account: '123', body: { contentType: 12000, contentId: FAN, title: 'T', note: 'x' } });
    const current = { title: 'T', text: 'x' };
    const before = [{ id: FAN, notes: [{ id: '901', contentType: 12000, contentId: FAN, title: 'T', note: 'x' }] }];
    w.answers.push(before, { id: '902', contentType: 12000, contentId: FAN, title: 'T', note: 'y' });
    expect(await w.notes.edit({ ...target, noteId: '901', title: 'T', text: 'y', current }, sender)).toEqual({ ok: false, error: { code: 'CG-NOTE-UNCERTAIN' } });
    w.answers.push(before);
    w.start.mockImplementationOnce(() => Promise.resolve({ response: w.answers.shift(), status: 200 })).mockRejectedValueOnce(new FanslyApiError('timeout', { sent: true }));
    expect(await w.notes.edit({ ...target, noteId: '901', title: 'T', text: 'y', current }, sender)).toEqual({ ok: false, error: { code: 'CG-NOTE-UNCERTAIN' } });
    w.prepare.mockRejectedValueOnce(new FanslyApiError('cooling', { sent: false, retryAt: 9 }));
    expect(await w.notes.remove({ ...target, noteId: '901', title: 'T', text: 'y' }, sender)).toMatchObject({ ok: false, error: { code: 'CG-FAN-RATE-LIMIT' } });
    expect(w.start).toHaveBeenCalledTimes(5);
    w.answers.push({});
    expect(await w.notes.remove({ ...target, noteId: '901', title: 'T', text: 'y' }, sender)).toEqual({ ok: true });
    expect(w.prepare).toHaveBeenLastCalledWith({ purpose: 'notes', route: 'notes.delete', account: '123', body: { id: '901', contentType: 12000, contentId: FAN, title: 'T', note: 'y' } });
    expect(writeFailure(new FanslyApiError('http', { sent: true, httpStatus: 400 }))).toMatchObject({ code: 'CG-FAN-REQUEST' });
    expect(writeFailure(new FanslyApiError('http', { sent: true, httpStatus: 502 }))).toEqual({ code: 'CG-NOTE-UNCERTAIN' });
  });

  it('[FS-NOTE-2] FBuddy’s «FBuddy Notes» is never created, edited or deleted from here', async () => {
    const w = world();
    expect(await w.notes.remove({ ...target, noteId: '803', title: 'FBuddy Notes', text: 'x' }, sender)).toMatchObject({ ok: false, error: { code: 'CG-NOTE-WRITE' } });
    expect(await w.notes.edit({ ...target, noteId: '801', title: 'T', text: 'a [FBUDDY_SYNC] b' }, sender)).toMatchObject({ ok: false });
    expect(await w.notes.create({ ...target, title: 'FBuddy Notes', text: '' }, sender)).toMatchObject({ ok: false });
    expect(w.prepare).not.toHaveBeenCalled();
  });
});

describe('[host:fansly] who wrote each note: every write Fansly confirmed, told once to the hub’s record', () => {
  const told = (w: ReturnType<typeof world>) => w.written.mock.calls.map(([fact]) => fact);

  it('a create with its new note, an edit, a delete — with where in the panel and the labels; nothing for a write that did not happen or may not have', async () => {
    const w = world();
    w.answers.push({ id: '901', contentType: 12000, contentId: FAN, title: 'T', note: 'x' });
    await w.notes.create({ ...target, title: 'T', text: 'x', origin: 'quick' }, sender);
    // A create Fansly answered without the note: its fate is unknown, nothing is told.
    w.answers.push({});
    expect(await w.notes.create({ ...target, title: 'T', text: 'x', origin: 'quick' }, sender)).toEqual({ ok: false, error: { code: 'CG-NOTE-UNCERTAIN' } });
    expect(told(w)).toEqual([{ pageId: 7, fanRef: FAN, noteRef: '901', noteKind: 'note', action: 'created', origin: 'quick', fields: undefined }]);
    const held = [{ id: FAN, notes: [{ id: '801', contentType: 12000, contentId: FAN, title: 'Анкета', note: 'Имя: Алекс' }] }];
    // The note holds the text already (a lost answer of the same edit): nothing is written, nothing told.
    w.answers.push(held);
    expect(await w.notes.edit({ ...target, noteId: '801', title: 'Анкета', text: 'Имя: Алекс', current: { title: 'Анкета', text: 'Имя: Алекс' }, origin: 'field', fields: ['Имя'] }, sender)).toMatchObject({ ok: true });
    // An edit whose answer was lost: maybe written, nothing told.
    w.answers.push(held);
    w.start.mockImplementationOnce(() => Promise.resolve({ response: w.answers.shift(), status: 200 })).mockRejectedValueOnce(new FanslyApiError('timeout', { sent: true }));
    expect(await w.notes.edit({ ...target, noteId: '801', title: 'Анкета', text: 'Имя: Саша', current: { title: 'Анкета', text: 'Имя: Алекс' }, origin: 'field', fields: ['Имя'] }, sender)).toEqual({ ok: false, error: { code: 'CG-NOTE-UNCERTAIN' } });
    expect(told(w)).toHaveLength(1);
    w.answers.push(held, {});
    expect(await w.notes.edit({ ...target, noteId: '801', title: 'Анкета', text: 'Имя: Саша', current: { title: 'Анкета', text: 'Имя: Алекс' }, origin: 'fill', fields: ['Имя', 'Работа'] }, sender)).toMatchObject({ ok: true });
    w.answers.push({});
    expect(await w.notes.remove({ ...target, noteId: '801', title: 'Анкета', text: 'Имя: Саша', origin: 'list' }, sender)).toEqual({ ok: true });
    expect(told(w).slice(1)).toEqual([
      { pageId: 7, fanRef: FAN, noteRef: '801', noteKind: 'note', action: 'edited', origin: 'fill', fields: ['Имя', 'Работа'] },
      { pageId: 7, fanRef: FAN, noteRef: '801', noteKind: 'note', action: 'deleted', origin: 'list', fields: undefined },
    ]);
    // A port that throws never fails the write.
    w.written.mockImplementationOnce(() => {
      throw new Error('gone');
    });
    w.answers.push({});
    expect(await w.notes.remove({ ...target, noteId: '801', title: 'Анкета', text: 'Имя: Саша' }, sender)).toEqual({ ok: true });
  });

  it('the name: set where there was none, changed, cleared — each told with the name’s own note; one Fansly holds already is no write', async () => {
    const w = world();
    const none = [{ id: FAN, notes: [] }];
    const named = (name: string) => [{ id: FAN, notes: [{ id: '802', contentType: 12002, contentId: FAN, title: 'Custom Username', note: name }] }];
    w.answers.push(none, { id: '802', contentType: 12002, contentId: FAN, title: 'Custom Username', note: 'Алекс' });
    expect(await w.notes.name({ ...target, name: 'Алекс', current: null }, sender)).toEqual({ ok: true, customName: { noteId: '802', name: 'Алекс' } });
    w.answers.push(named('Алекс'));
    expect(await w.notes.name({ ...target, name: 'Алекс', current: null }, sender)).toEqual({ ok: true, customName: { noteId: '802', name: 'Алекс' } });
    w.answers.push(named('Алекс'), {});
    expect(await w.notes.name({ ...target, name: 'Саша', current: { noteId: '802', name: 'Алекс' } }, sender)).toMatchObject({ ok: true });
    w.answers.push(named('Саша'), {});
    expect(await w.notes.name({ ...target, name: '', current: { noteId: '802', name: 'Саша' } }, sender)).toEqual({ ok: true, customName: null });
    // Nothing to clear: no write.
    w.answers.push(none);
    expect(await w.notes.name({ ...target, name: '', current: null }, sender)).toEqual({ ok: true, customName: null });
    expect(told(w)).toEqual([
      { pageId: 7, fanRef: FAN, noteRef: '802', noteKind: 'custom_name', action: 'created', origin: 'name', fields: undefined },
      { pageId: 7, fanRef: FAN, noteRef: '802', noteKind: 'custom_name', action: 'edited', origin: 'name', fields: undefined },
      { pageId: 7, fanRef: FAN, noteRef: '802', noteKind: 'custom_name', action: 'deleted', origin: 'name', fields: undefined },
    ]);
  });
});

/** Two tabs with separate caches over the same background and Fansly account. */
function twoTabs() {
  const w = world();
  const stored = [structuredClone(account.notes[0]!)];
  w.prepare.mockImplementation((raw: unknown) => {
    const call = raw as { route: string; body?: (typeof stored)[number] };
    return Promise.resolve({ cancel: w.cancel, start: vi.fn((): Promise<{ status: number; response: unknown }> => {
      if (call.route === 'account.byIds') return Promise.resolve({ status: 200, response: [{ id: FAN, notes: structuredClone(stored) }] });
      const note = { ...call.body!, id: call.route === 'notes.create' ? '901' : call.body!.id };
      if (call.route === 'notes.create') stored.push(note);
      else stored.splice(stored.findIndex((entry) => entry.id === note.id), 1, note);
      return Promise.resolve({ status: 200, response: structuredClone(note) });
    }) });
  });
  function tab(tabSessionId: string) {
    const from = { ...sender, tabSessionId };
    const who = { accountId: target.hostAccountId, groupId: '456', fanId: FAN, fan: null };
    const port: NotesPort = {
      session: () => '123|1', target: () => who,
      read: () => w.notes.read({ ...target, groupId: '456' }, from),
      create: (_who, title, text) => w.notes.create({ ...target, title, text }, from),
      edit: (_who, noteId, title, text, current) => w.notes.edit({ ...target, noteId, title, text, current }, from),
      remove: (_who, note) => w.notes.remove({ ...target, ...note }, from),
      name: (_who, name, current) => w.notes.name({ ...target, name, current }, from),
      setView: () => undefined, fits: () => false, place: () => null,
      fillAllowed: () => false,
      fill: () => Promise.resolve({ ok: false, error: { code: 'CG-FEATURE-DISABLED' } }),
      stopFill: () => undefined,
      setTimer: () => undefined, clearTimer: () => undefined,
    };
    return createNotesController(port);
  }
  const a = tab('tab');
  const b = tab('tab2');
  const writes = () => w.prepare.mock.calls.map(([raw]) => (raw as { route: string }).route).filter((route) => route.startsWith('notes.'));
  return { a, b, stored, writes };
}

describe('[host:fansly] two tabs editing the same fan', () => {
  it('[FS-NOTE-4] audit №13: a stale edit never wipes the other tab’s text unseen — it shows Fansly’s version, and the next «Сохранить» writes over it', async () => {
    const w = twoTabs();
    w.a.toggle(); w.b.toggle();
    await vi.waitFor(() => expect([w.a.panel().body, w.b.panel().body]).toEqual(['ready', 'ready']));
    w.a.dispatch({ type: 'edit', noteId: '801' });
    w.a.dispatch({ type: 'input', title: 'Анкета', text: 'Имя: Алекс\nРабота: врач' });
    w.a.dispatch({ type: 'save' });
    await vi.waitFor(() => expect(w.a.panel().editor).toBeNull());
    w.b.dispatch({ type: 'edit', noteId: '801' });
    const draft = 'Имя: Алекс\nЛокация: Рига';
    w.b.dispatch({ type: 'input', title: 'Анкета', text: draft });
    w.b.dispatch({ type: 'save' });
    const conflict = { kind: 'changed', latest: { title: 'Анкета', text: 'Имя: Алекс\nРабота: врач' } };
    await vi.waitFor(() => expect(w.b.panel().editor).toMatchObject({ saving: false, text: draft, problem: conflict }));
    // Nothing of B's went out, and its list already holds A's text.
    expect(w.stored[0]?.note).toBe('Имя: Алекс\nРабота: врач');
    expect(w.writes()).toEqual(['notes.edit']);
    // A's text is a questionnaire now: B's panel reads it as one.
    expect(w.b.panel().form).toMatchObject({ noteId: '801', parts: [{ label: 'Имя' }, { label: 'Работа' }] });
    w.b.dispatch({ type: 'save' });
    await vi.waitFor(() => expect(w.b.panel().editor).toBeNull());
    expect(w.stored[0]?.note).toBe(draft);
    expect(w.writes()).toEqual(['notes.edit', 'notes.edit']);
    w.a.dispose(); w.b.dispose();
  });

  it('audit №13: «Обновить» under an open editor brings a newer version the same way; one that already holds the draft closes it as saved', async () => {
    const w = twoTabs();
    w.b.toggle();
    await vi.waitFor(() => expect(w.b.panel().body).toBe('ready'));
    w.b.dispatch({ type: 'edit', noteId: '801' });
    w.b.dispatch({ type: 'input', title: 'Анкета', text: 'Имя: Саша' });
    w.stored[0]!.note = 'Имя: Алекс\nРабота: врач';
    w.b.dispatch({ type: 'refresh' });
    await vi.waitFor(() => expect(w.b.panel().editor).toMatchObject({ text: 'Имя: Саша', problem: { kind: 'changed', latest: { text: 'Имя: Алекс\nРабота: врач' } } }));
    w.stored[0]!.note = 'Имя: Саша';
    w.b.dispatch({ type: 'refresh' });
    await vi.waitFor(() => expect(w.b.panel().editor).toBeNull());
    expect(w.writes()).toEqual([]);
    w.b.dispose();
  });
});

describe('[host:fansly] audit №13: a note longer than the panel holds', () => {
  it('is read cut and marked instead of failing the whole read; an edit of it is refused, one already landed is done without a write', async () => {
    const w = world();
    const long = 'я'.repeat(60_000);
    w.answers.push([{ id: FAN, notes: [...account.notes, { id: '804', contentType: 12000, contentId: FAN, title: 'Старое', note: long }] }]);
    const read = await w.notes.read({ ...target, groupId: '456' }, sender);
    expect(read).toMatchObject({ ok: true, notes: [{ noteId: '801' }, { noteId: '803', foreign: true }, { noteId: '804', cut: true }] });
    const cut = read.ok ? read.notes.find((note) => note.noteId === '804') : undefined;
    expect(cut?.text.length).toBe(50_000);
    expect(read.ok ? read.notes[0] : null).not.toHaveProperty('cut');
    w.answers.push([{ id: FAN, notes: [{ id: '804', contentType: 12000, contentId: FAN, title: 'Старое', note: long }] }]);
    expect(await w.notes.edit({ ...target, noteId: '804', title: 'Старое', text: 'x', current: { title: 'Старое', text: long.slice(0, 50_000) } }, sender)).toEqual({ ok: false, error: { code: 'CG-NOTE-WRITE', detail: 'long note' } });
    w.answers.push([{ id: FAN, notes: [{ id: '801', contentType: 12000, contentId: FAN, title: 'Анкета', note: 'Имя: Саша' }] }]);
    expect(await w.notes.edit({ ...target, noteId: '801', title: 'Анкета', text: 'Имя: Саша', current: { title: 'Анкета', text: 'Имя: Алекс' } }, sender)).toEqual({ ok: true, note: { noteId: '801', title: 'Анкета', text: 'Имя: Саша', foreign: false } });
    expect(w.prepare.mock.calls.map(([call]) => (call as { route: string }).route)).toEqual(['account.byIds', 'account.byIds', 'account.byIds']);
  });
});
