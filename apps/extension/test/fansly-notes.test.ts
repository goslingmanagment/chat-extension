import { describe, expect, it, vi } from 'vitest';
import type { FanslyClient } from '@cg/fansly-api';
import { FanslyApiError } from '@cg/fansly-api';
import type { BackgroundKit, HostSiteSender } from '../src/composition/background/host-module';
import { createNotesService, writeFailure } from '../bg/fansly/notes';

const FAN = '789';
const target = { pageId: 7, hostAccountId: '123', fanRef: FAN };
const sender: HostSiteSender = { kind: 'tab', host: 'fansly-web', tabId: 1, tabSessionId: 'tab', url: 'https://fansly.com/messages/456' };
const group = { id: '456', type: 1, users: [{ userId: '123' }, { userId: FAN }] };
const account = { id: FAN, notes: [{ id: '801', contentType: 12000, contentId: FAN, title: 'Анкета', note: 'Имя: Алекс' }, { id: '802', contentType: 12002, contentId: FAN, title: 'Custom Username', note: 'Алекс' }, { id: '803', contentType: 12000, contentId: FAN, title: 'FBuddy Notes', note: 'x' }] };

function world() {
  let enabled = true;
  const kit = {
    hub: {
      session: () => ({ hubOrigin: 'test', userId: 1 }),
      page: () => Promise.resolve({ ok: true }),
      bootstrap: () => ({ pages: [{ pageId: 7, platform: 'fansly', platformAccountId: '123', features: { notes: { available: enabled } } }] }),
    },
    router: { tabs: () => ['tab'] },
    clock: { now: () => Date.UTC(2026, 9, 16) },
  } as unknown as BackgroundKit;
  const answers: unknown[] = [];
  const start = vi.fn(() => Promise.resolve({ response: answers.shift(), status: 200 }));
  const cancel = vi.fn();
  const prepare = vi.fn((_call: unknown) => Promise.resolve({ start, cancel }));
  const client = { prepare } as unknown as FanslyClient;
  const notes = createNotesService(kit, () => Promise.resolve(client));
  return { notes, prepare, start, cancel, answers, disable: () => { enabled = false; } };
}

describe('[host:fansly] «Заметки» in the background (R20 P11b)', () => {
  it('[FS-NOTE-3] [FX-010] a known fan: one `GET /account?ids=`; an unknown one: its group once a chat, then the account', async () => {
    const w = world();
    w.answers.push([account]);
    expect(await w.notes.read({ ...target, groupId: '456' }, sender)).toEqual({
      ok: true,
      fanRef: FAN,
      notes: [{ noteId: '801', title: 'Анкета', text: 'Имя: Алекс', foreign: false }, { noteId: '803', title: 'FBuddy Notes', text: 'x', foreign: true }],
      customName: { noteId: '802', name: 'Алекс' },
      readAt: '2026-10-16T00:00:00.000Z',
    });
    expect(w.prepare.mock.calls.map(([call]) => (call as { route: string }).route)).toEqual(['account.byIds']);
    w.answers.push(group, [account], [account]);
    await w.notes.read({ ...target, fanRef: null, groupId: '456' }, sender);
    await w.notes.read({ ...target, fanRef: null, groupId: '456' }, sender);
    expect(w.prepare.mock.calls.map(([call]) => (call as { route: string }).route)).toEqual(['account.byIds', 'group.detail', 'account.byIds', 'account.byIds']);
    expect(w.prepare.mock.calls[1]?.[0]).toEqual({ purpose: 'notes', route: 'group.detail', account: '123', path: { group: '456' } });
  });

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
    w.answers.push({ id: '902', contentType: 12000, contentId: FAN, title: 'T', note: 'y' });
    expect(await w.notes.edit({ ...target, noteId: '901', title: 'T', text: 'y' }, sender)).toEqual({ ok: false, error: { code: 'CG-NOTE-UNCERTAIN' } });
    w.start.mockRejectedValueOnce(new FanslyApiError('timeout', { sent: true }));
    expect(await w.notes.edit({ ...target, noteId: '901', title: 'T', text: 'y' }, sender)).toEqual({ ok: false, error: { code: 'CG-NOTE-UNCERTAIN' } });
    w.prepare.mockRejectedValueOnce(new FanslyApiError('cooling', { sent: false, retryAt: 9 }));
    expect(await w.notes.remove({ ...target, noteId: '901', title: 'T', text: 'y' }, sender)).toMatchObject({ ok: false, error: { code: 'CG-FAN-RATE-LIMIT' } });
    expect(w.start).toHaveBeenCalledTimes(3);
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

  it('[FX-006] [FS-NOTE-2] the name for oneself: created where there was none, edited where there is one, an empty one deletes it', async () => {
    const w = world();
    w.answers.push({ id: '805', contentType: 12002, contentId: FAN, title: 'Custom Username', note: 'Саша' });
    expect(await w.notes.name({ ...target, name: ' Саша ', current: null }, sender)).toEqual({ ok: true, customName: { noteId: '805', name: 'Саша' } });
    expect(w.prepare).toHaveBeenLastCalledWith({ purpose: 'notes', route: 'notes.create', account: '123', body: { contentType: 12002, contentId: FAN, title: 'Custom Username', note: 'Саша' } });
    w.answers.push({ id: '805', contentType: 12002, contentId: FAN, title: 'Custom Username', note: 'Алекс' });
    await w.notes.name({ ...target, name: 'Алекс', current: { noteId: '805', name: 'Саша' } }, sender);
    expect(w.prepare).toHaveBeenLastCalledWith({ purpose: 'notes', route: 'notes.edit', account: '123', body: { id: '805', contentType: 12002, contentId: FAN, title: 'Custom Username', note: 'Алекс' } });
    w.answers.push({});
    expect(await w.notes.name({ ...target, name: '', current: { noteId: '805', name: 'Алекс' } }, sender)).toEqual({ ok: true, customName: null });
    expect((w.prepare.mock.lastCall?.[0] as { route: string }).route).toBe('notes.delete');
    expect(await w.notes.name({ ...target, name: '', current: null }, sender)).toEqual({ ok: true, customName: null });
    expect(w.prepare).toHaveBeenCalledTimes(3);
  });
});
