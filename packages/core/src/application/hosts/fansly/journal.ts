// Fansly's own surfaces in the chatter's log (2026-10-21, «Скачать лог»): «Заметки» and the vault uploader as maps
// of what is on and off (core/application/journal), and their clicks as machine facts. Fansly's file: a ChatSpace
// bundle never reaches it.

import { type NotesAction, type NotesPanelVM, type NotesTriggerVM } from '@cg/contracts/notes-fansly';
import { type VaultPanelAction, type VaultPanelVM } from '@cg/contracts/vault-fansly';

import { AVAILABLE, Collect, off, type AvailabilityMap } from '../../journal/availability';

/** Fansly's «Заметки»: the button (admitted in this chat), the panel's read, its editor's lock, the fill. */
export function notesAvailability(trigger: NotesTriggerVM, panel: NotesPanelVM): AvailabilityMap {
  const out = new Collect();
  out.set('button', trigger.shown ? AVAILABLE : off('not-admitted', null, null));
  if (panel.shown) {
    out.set('read', panel.body === 'error' ? off('read-failed', panel.error?.code ?? null, null) : panel.body === 'loading' ? null : AVAILABLE);
    const editor = panel.editor;
    if (editor !== null) {
      out.set('save', editor.blocked ? off('create-unconfirmed', null, null) : AVAILABLE);
      if (editor.fill !== null) out.set('fill', editor.fill.status === 'failed' ? off('fill-failed', editor.fill.error?.code ?? null, null) : editor.fill.status === 'running' ? null : AVAILABLE);
    }
  }
  return out.map;
}

/** Fansly's vault uploader: the entry (admitted on this page), «Старт» and why not, a stopped run's code. */
export function vaultAvailability(vm: VaultPanelVM): AvailabilityMap {
  const out = new Collect();
  out.set('entry', vm.shown ? AVAILABLE : off('not-admitted', null, null));
  if (vm.shown && vm.mode !== 'closed') {
    const blocked = vm.controls.blocked;
    // «Старт» waits for files to be picked and for a run to end: no decision of ours.
    out.set('start', blocked === null ? AVAILABLE : blocked === 'files' || blocked === 'running' || blocked === 'done' || blocked === 'checking' ? null : off(blocked, null, null));
    out.set('run', vm.run?.code === null || vm.run === null ? AVAILABLE : off(vm.run.stop?.kind ?? vm.run.state, vm.run.code, null));
    out.set('checkpoint', vm.note === null || vm.note === 'moved' ? AVAILABLE : off(vm.note, null, null));
  }
  return out.map;
}

/** A click of «Заметки» as machine facts: its type, its switches and the note's id — never a title, a text or a name. */
export function notesActionFacts(action: NotesAction): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(action)) {
    if (key === 'type') continue;
    if (typeof value === 'boolean' || typeof value === 'number') out[key] = value;
    else if (key === 'noteId' || key === 'view') out[key] = value;
  }
  return out;
}

/** A click of the vault uploader as machine facts: the files are counted, never named. */
export function vaultActionFacts(action: VaultPanelAction<unknown>): Record<string, unknown> {
  if (action.type === 'pick') return { fileCount: action.files.length };
  if (action.type === 'order') return { choice: action.order };
  if (action.type === 'answer') return { choice: action.answer };
  return {};
}
