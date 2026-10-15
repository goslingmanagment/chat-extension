// The debug pages (architecture.md §9.2, §9.3; DB-004…DB-008, NF-029):
// debug-prompt.html shows a prompt snapshot the background keeps in memory
// for 12 minutes — by an opaque token, to this page only — and says honestly
// why there is none; debug-journal.html shows the journals, which carry no
// message or prompt text at all. Nothing here is ever logged.
//
// «Выключение отладки или выход очищают всё» (§9.3): with debug off, or once
// the person has signed out, neither page shows anything it had read before —
// no blocks, no records, no copy handle — whatever the slot still holds. A
// background that stopped answering is neither: the journal keeps the records
// it read, next to the error; the prompt, which carries the conversation, is
// taken off the page then too.

import { type LogRecord } from '@cg/contracts/logs';
import { DEBUG_LIMITS } from '@cg/contracts/limits';
import { type PromptSnapshotView } from '@cg/contracts/tab-messages';
import { HANDLE_PATTERN, type DebugPromptVM, type JournalKind, type JournalVM, type UiAction, type VmView } from '@cg/contracts/vm';

import { formatRecordLine } from '../../domain/logging';
import { button, codeError, errorOf, msg, signedOutOf, valueOf, type JournalData, type PagesModel, type Slot } from './model';

/** The artifact «Копировать промпт» writes. */
export const PROMPT_ARTIFACT = 'prompt';
export const journalArtifact = (journal: JournalKind): string => `journal:${journal}`;

/** A token a prompt snapshot may have: an opaque handle. Anything else names no snapshot, and is not asked for. */
export const isPromptToken = (token: string): boolean => HANDLE_PATTERN.test(token);

const NO_PROMPT: Omit<DebugPromptVM, 'view'> = { source: null, createdAt: null, expiresAt: null, blocks: [], manifest: null, copyHandle: null };

const DEBUG_OFF_REMEDY: UiAction = { type: 'OpenSettings', route: { section: 'generation' } };
const SIGN_IN_REMEDY: UiAction = { type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } };

/** What the debug views read of the model. */
export type DebugModel = Pick<PagesModel, 'unreachable' | 'settings' | 'effective' | 'session' | 'sessionKnown' | 'prompts' | 'journals' | 't'>;

/** Debug data is not for this page any more (§9.3): debug is off or not known to be on, or the person signed out. */
function debugGone(model: DebugModel): boolean {
  return model.effective === null || !model.effective.debug.enabled || signedOutOf(model);
}

/**
 * Why a debug page does not show its data, before the data itself is looked
 * at: the background is silent, the settings could not be read, debug is
 * off, or the person signed out. null — the page shows what it read.
 */
function closedView(model: DebugModel, reload: UiAction): VmView | null {
  if (model.unreachable) return { s: 'offline', error: codeError(model, 'CG-RUNTIME-UNREACHABLE'), retry: reload, lastGoodAt: null };
  if (model.effective === null) return model.settings.s === 'error' ? { s: 'error', error: errorOf(model, model.settings.error), retry: reload } : { s: 'loading', since: null, stage: null };
  if (!model.effective.debug.enabled) return { s: 'forbidden', error: codeError(model, 'CG-FEATURE-DISABLED'), remedy: DEBUG_OFF_REMEDY };
  if (signedOutOf(model)) return { s: 'forbidden', error: codeError(model, 'CG-AUTH-REQUIRED'), remedy: SIGN_IN_REMEDY };
  return null;
}

export function debugPromptView(model: DebugModel, token: string): DebugPromptVM {
  const slot: Slot<PromptSnapshotView> = model.prompts.get(token) ?? { s: 'idle' };
  const reload: UiAction = { type: 'ReloadView', selector: { of: 'debug-prompt', token } };
  const closed = closedView(model, reload);
  if (closed !== null) return { ...NO_PROMPT, view: closed };
  // The page was opened without a snapshot's token (by hand, from the history, a cut address): there is nothing
  // to ask the background for — the same honest «Снимок истёк» as for a snapshot that is gone, never a raw
  // «invalid request».
  if (!isPromptToken(token)) return { ...NO_PROMPT, view: { s: 'error', error: codeError(model, 'CG-DATA-UNAVAILABLE', 'prompt snapshot expired'), retry: null } };
  if (slot.s === 'idle' || slot.s === 'loading') return { ...NO_PROMPT, view: { s: 'loading', since: slot.s === 'loading' ? slot.since : null, stage: null } };
  if (slot.s === 'error') return { ...NO_PROMPT, view: { s: 'offline', error: errorOf(model, slot.error), retry: reload, lastGoodAt: null } };
  const snapshot = slot.value;
  switch (snapshot.state) {
    case 'debug-off':
      return { ...NO_PROMPT, view: { s: 'forbidden', error: codeError(model, 'CG-FEATURE-DISABLED'), remedy: DEBUG_OFF_REMEDY } };
    // The event page may have unloaded and lost it: an honest «истёк», no retry that could bring it back.
    case 'expired':
    case 'not-found':
      return { ...NO_PROMPT, view: { s: 'error', error: codeError(model, 'CG-DATA-UNAVAILABLE', 'prompt snapshot expired'), retry: null } };
    case 'echo-off':
      return {
        ...NO_PROMPT,
        ...(snapshot.generation === undefined ? {} : { generation: { text: JSON.stringify(snapshot.generation, null, 2) } }),
        source: snapshot.fromCache ? 'cache' : null,
        createdAt: snapshot.capturedAt === null ? null : Date.parse(snapshot.capturedAt),
        view: { s: 'empty', why: msg(snapshot.fromCache ? 'debugPage.prompt.fromCache' : 'debugPage.prompt.echoOff') },
      };
    case 'ok': {
      const createdAt = snapshot.capturedAt === null ? null : Date.parse(snapshot.capturedAt);
      const cut = snapshot.blocks.filter((block) => block.truncated).length;
      const view: VmView = cut > 0 ? { s: 'partial', gaps: [{ kind: 'truncated', shown: snapshot.blocks.length - cut, total: snapshot.blocks.length }] } : { s: 'ready' };
      return {
        view,
        ...(snapshot.generation === undefined ? {} : { generation: { text: JSON.stringify(snapshot.generation, null, 2) } }),
        source: snapshot.fromCache ? 'cache' : 'echo',
        createdAt,
        expiresAt: createdAt === null ? null : createdAt + DEBUG_LIMITS.promptSnapshotTtlMs,
        blocks: snapshot.blocks,
        manifest: snapshot.manifest === null ? null : { text: snapshot.manifest, truncated: snapshot.manifest.endsWith('…[truncated]') },
        copyHandle: PROMPT_ARTIFACT,
      };
    }
  }
}

/** The whole prompt as one text for «Копировать промпт»: an explicit action on that page only. */
export function promptText(snapshot: PromptSnapshotView): string {
  const parts = snapshot.blocks.map((block) => `=== ${block.name} ===\n${block.text}`);
  if (snapshot.manifest !== null) parts.push(`=== context manifest ===\n${snapshot.manifest}`);
  if (snapshot.generation !== undefined) parts.push(`=== generation snapshot ===\n${JSON.stringify(snapshot.generation, null, 2)}`);
  return parts.join('\n\n');
}

/** A journal line as the page prints it: the fixed message and its machine fields, nothing else exists in a record. */
function entryText(record: LogRecord): string {
  const parts = [record.msg];
  if (record.fields !== undefined) {
    try {
      parts.push(JSON.stringify(record.fields));
    } catch {
      parts.push('[fields]');
    }
  }
  return parts.join(' ');
}

export function journalView(model: DebugModel, journal: JournalKind): JournalVM {
  const slot: Slot<JournalData> = model.journals.get(journal) ?? { s: 'idle' };
  const reload: UiAction = { type: 'ReloadView', selector: { of: 'journal', journal } };
  const data = valueOf(slot);
  const closed = closedView(model, reload);
  let view: VmView;
  if (closed !== null) view = closed;
  else if (slot.s === 'idle' || (slot.s === 'loading' && data === null)) view = { s: 'loading', since: slot.s === 'loading' ? slot.since : null, stage: null };
  else if (slot.s === 'error') view = { s: 'error', error: errorOf(model, slot.error), retry: reload };
  else if (data === null || data.records.length === 0) view = { s: 'empty', why: msg('debugPage.journal.empty') };
  else if (data.truncated) view = { s: 'partial', gaps: [{ kind: 'truncated', shown: data.records.length, total: null }] };
  else view = { s: 'ready' };
  // Gone with debug or the sign-in; a silent background takes nothing that was read off the page.
  const shown = debugGone(model) || data === null ? null : data;
  const has = shown !== null && shown.records.length > 0;
  return {
    view,
    journal,
    entries: (shown?.records ?? []).map((record) => ({ at: Date.parse(record.ts), level: record.level, scope: record.scope, text: entryText(record), code: record.code ?? null })),
    truncated: shown?.truncated ?? false,
    runs: shown?.runs?.map((run) => ({ id: run.runId, startedAt: Date.parse(run.startedAt), events: run.events })) ?? null,
    copyHandle: has ? journalArtifact(journal) : null,
    save: button('debugPage.journal.save', { type: 'SaveJournal', journal }, { reason: has ? null : { id: 'chat-loading', code: null, text: msg('debugPage.journal.empty') } }),
  };
}

/** The journal as a text file and as the clipboard text (NF-029 «Копировать», «Сохранить .txt»). */
export function journalText(data: JournalData): string {
  const lines = data.records.map(formatRecordLine);
  if (data.truncated) lines.unshift('[older records cut]');
  return lines.join('\n');
}
