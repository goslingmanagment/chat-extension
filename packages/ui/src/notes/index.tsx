// @cg/ui/notes — «Заметки» (R20 P11b; docs/project-unite/architecture.md §7.4, §8.9), on every site that has them: the
// button in the chat header's slot and the panel in our layer 900, both drawn from the notes' own client (contracts
// notes.ts). One UI for both sites (2026-10-28): each site's notes chunk mounts it with its own words.

import type { NotesClient } from '@cg/contracts/notes';

import { type SurfaceDefinition } from '../kit';
import { NotesButton, type NotesButtonLook, type NotesTexts } from './NotesButton';
import { NotesPanel } from './NotesPanel';
import { NOTES_BUTTON_CSS, NOTES_CSS } from './styles';

export { NotesButton, type NotesButtonLook, type NotesTexts } from './NotesButton';
export { NotesPanel } from './NotesPanel';
export { NOTES_SURFACE } from './styles';

/** The header slot's surface: `mountKitSurface('header-slot', slot.root, deps, notesButtonSurface(…))`. */
export function notesButtonSurface(client: NotesClient, texts: NotesTexts, look: NotesButtonLook = 'row'): SurfaceDefinition {
  return { view: () => <NotesButton client={client} texts={texts} look={look} />, styles: [{ id: 'cg-fansly-notes-button', css: NOTES_BUTTON_CSS }] };
}

/** The panel's surface, in the panel layer: `mountKitSurface(NOTES_SURFACE, root, deps, notesPanelSurface(…))`. */
export function notesPanelSurface(client: NotesClient, texts: NotesTexts): SurfaceDefinition {
  return { view: () => <NotesPanel client={client} texts={texts} />, styles: [{ id: 'cg-fansly-notes', css: NOTES_CSS }] };
}
