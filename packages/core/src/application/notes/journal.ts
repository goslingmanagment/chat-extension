// «Заметки» in the chatter's log (2026-10-21, «Скачать лог»): a map of what is on and off (core/application/journal),
// and their clicks as machine facts, never a note's words. Every site's since 2026-10-28.

import { type NotesAction, type NotesPanelVM, type NotesTriggerVM } from '@cg/contracts/notes';

import { AVAILABLE, Collect, off, type AvailabilityMap } from '../journal/availability';

/** «Заметки»: the button (admitted in this chat), the panel's read, its text editor's lock, the fill. */
export function notesAvailability(trigger: NotesTriggerVM, panel: NotesPanelVM): AvailabilityMap {
  const out = new Collect();
  out.set('button', trigger.shown ? AVAILABLE : off('not-admitted', null, null));
  if (panel.shown) {
    out.set('read', panel.body === 'error' ? off('read-failed', panel.error?.code ?? null, null) : panel.body === 'loading' ? null : AVAILABLE);
    const editor = panel.editor;
    if (editor !== null) out.set('save', editor.blocked ? off('create-unconfirmed', null, null) : AVAILABLE);
    const fill = panel.form?.fill ?? null;
    if (fill !== null) out.set('fill', fill.status === 'failed' ? off('fill-failed', fill.error?.code ?? null, null) : fill.status === 'running' || fill.reason !== null ? null : AVAILABLE);
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
