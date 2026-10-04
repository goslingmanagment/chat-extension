// The debug views as pure functions (architecture.md §9.3 «выключение отладки
// или выход очищают всё»): what a slot still holds is never shown once debug
// is off or the person signed out. The controller drops that data too; these
// tests keep the views honest by themselves.

import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, type PromptSnapshotView, type SessionIdentity, type SettingsState, type SettingsV1 } from '@cg/contracts';

import { createTranslator } from '../../domain/i18n';
import { type JournalData, type Slot } from './model';
import { debugPromptView, journalArtifact, journalView, PROMPT_ARTIFACT, type DebugModel } from './view-debug';

const AT = Date.parse('2026-10-03T09:20:00Z');
const TOKEN = 'prompt-token-1';
const SIGNED_IN: SessionIdentity = { hubOrigin: DEFAULT_SETTINGS.hub.baseUrl, userId: 7, login: 'chatter1', role: 'chatter', epoch: 3 };

const PROMPT: PromptSnapshotView = {
  state: 'ok',
  fromCache: false,
  capturedAt: '2026-10-03T09:19:00Z',
  feature: 'reply',
  manifest: '{"context":"v1"}',
  blocks: [
    { name: 'system', text: 'synthetic system block', truncated: false },
    { name: 'user', text: 'synthetic user block', truncated: false },
  ],
};

const JOURNAL: JournalData = {
  records: [
    { ts: '2026-10-03T09:19:30Z', seq: 41, level: 'info', scope: 'bg.ops', msg: 'operation done', fields: { ms: 3800 } },
    { ts: '2026-10-03T09:19:50Z', seq: 42, level: 'warn', scope: 'tab.insert', msg: 'insert rejected', code: 'CG-DRAFT-CHANGED' },
  ],
  truncated: false,
  runs: null,
};

const debugOf = (enabled: boolean): SettingsV1 => ({ ...DEFAULT_SETTINGS, debug: { ...DEFAULT_SETTINGS.debug, enabled } });
const ok = <T>(value: T): Slot<T> => ({ s: 'ok', value, at: AT });

/** A model whose slots hold a read prompt and a read journal, whatever else is said about it. */
function modelOf(over: Partial<DebugModel> = {}): DebugModel {
  const effective = over.effective === undefined ? debugOf(true) : over.effective;
  const state: SettingsState | null = effective === null ? null : { settings: effective, revision: 7, readOnly: false };
  return {
    unreachable: false,
    settings: state === null ? { s: 'idle' } : ok(state),
    effective,
    session: ok<SessionIdentity | null>(SIGNED_IN),
    sessionKnown: true,
    prompts: new Map([[TOKEN, ok(PROMPT)]]),
    journals: new Map([['operations', ok(JOURNAL)]]),
    t: createTranslator('ru'),
    ...over,
  };
}

describe('debugPromptView', () => {
  it('[DB-007] debug on and signed in: the blocks, the manifest and the copy handle', () => {
    const vm = debugPromptView(modelOf(), TOKEN);
    expect(vm.view.s).toBe('ready');
    expect(vm.blocks).toHaveLength(2);
    expect(vm.manifest).toEqual({ text: '{"context":"v1"}', truncated: false });
    expect(vm.copyHandle).toBe(PROMPT_ARTIFACT);
  });

  it('[DB-007] debug off: nothing of a prompt the slot still holds', () => {
    const vm = debugPromptView(modelOf({ effective: debugOf(false) }), TOKEN);
    expect(vm).toMatchObject({ view: { s: 'forbidden', error: { code: 'CG-FEATURE-DISABLED' } }, blocks: [], manifest: null, copyHandle: null, source: null, createdAt: null });
  });

  it('[DB-007] signed out: nothing of a prompt the slot still holds', () => {
    const vm = debugPromptView(modelOf({ session: ok<SessionIdentity | null>(null) }), TOKEN);
    expect(vm).toMatchObject({ view: { s: 'forbidden', error: { code: 'CG-AUTH-REQUIRED' } }, blocks: [], manifest: null, copyHandle: null });
  });

  it('[PU-002] a sign-in state that could not be read is not a sign-out: the prompt stays', () => {
    const unread: DebugModel['session'] = { s: 'error', error: { code: 'CG-TIMEOUT' }, at: AT, last: null };
    expect(debugPromptView(modelOf({ session: unread, sessionKnown: false }), TOKEN).blocks).toHaveLength(2);
    // Read once as signed in, then a refresh failed: what was known stays known.
    const stale: DebugModel['session'] = { s: 'error', error: { code: 'CG-TIMEOUT' }, at: AT, last: SIGNED_IN };
    expect(debugPromptView(modelOf({ session: stale }), TOKEN).blocks).toHaveLength(2);
  });

  it('the background silent, or the settings unread: the prompt is off the page, with the way to ask again', () => {
    const silent = debugPromptView(modelOf({ unreachable: true }), TOKEN);
    expect(silent).toMatchObject({ view: { s: 'offline', error: { code: 'CG-RUNTIME-UNREACHABLE' }, retry: { type: 'ReloadView' } }, blocks: [], copyHandle: null });
    const unread = debugPromptView(modelOf({ effective: null, settings: { s: 'error', error: { code: 'CG-STORAGE-READ' }, at: AT, last: null } }), TOKEN);
    expect(unread).toMatchObject({ view: { s: 'error', error: { code: 'CG-STORAGE-READ' }, retry: { type: 'ReloadView' } }, blocks: [], copyHandle: null });
    expect(debugPromptView(modelOf({ effective: null }), TOKEN)).toMatchObject({ view: { s: 'loading' }, blocks: [] });
  });
});

describe('journalView', () => {
  it('[NF-029] debug on and signed in: the records, the copy handle, «Сохранить .txt»', () => {
    const vm = journalView(modelOf(), 'operations');
    expect(vm.view.s).toBe('ready');
    expect(vm.entries.map((entry) => [entry.level, entry.scope, entry.code])).toEqual([
      ['info', 'bg.ops', null],
      ['warn', 'tab.insert', 'CG-DRAFT-CHANGED'],
    ]);
    expect(vm.copyHandle).toBe(journalArtifact('operations'));
    expect(vm.save.enabled).toBe(true);
  });

  it('[NF-029] [DB-001] debug off: no record of a journal the slot still holds, no copy, no file', () => {
    const vm = journalView(modelOf({ effective: debugOf(false) }), 'operations');
    expect(vm).toMatchObject({ view: { s: 'forbidden', error: { code: 'CG-FEATURE-DISABLED' } }, entries: [], runs: null, truncated: false, copyHandle: null, save: { enabled: false } });
  });

  it('[NF-029] signed out: no record of a journal the slot still holds', () => {
    const vm = journalView(modelOf({ session: ok<SessionIdentity | null>(null) }), 'operations');
    expect(vm).toMatchObject({ view: { s: 'forbidden', error: { code: 'CG-AUTH-REQUIRED' } }, entries: [], copyHandle: null, save: { enabled: false } });
  });

  it('[NF-029] the background stopped answering: the error with «Повторить», and the records already read stay to be read and copied', () => {
    const vm = journalView(modelOf({ unreachable: true }), 'operations');
    expect(vm.view).toMatchObject({ s: 'offline', error: { code: 'CG-RUNTIME-UNREACHABLE' }, retry: { type: 'ReloadView', selector: { of: 'journal', journal: 'operations' } } });
    expect(vm.entries).toHaveLength(2);
    expect(vm.copyHandle).toBe(journalArtifact('operations'));
  });

  it('the settings unread: nothing is shown as a journal', () => {
    const vm = journalView(modelOf({ effective: null, settings: { s: 'error', error: { code: 'CG-STORAGE-READ' }, at: AT, last: null } }), 'operations');
    expect(vm).toMatchObject({ view: { s: 'error', error: { code: 'CG-STORAGE-READ' } }, entries: [], copyHandle: null });
  });
});
