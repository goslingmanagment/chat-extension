// «Заметки» of a Fansly tab (R20 P11b, P11b2, P11c): the controller, the questionnaire's template, its fields and its fill.
export { NOTES_FOLLOW_DELAY_MS, createNotesController, type NotesController, type NotesPort, type NotesTarget, type NotesWho } from './controller';
export { NOTE_OTHER_LABEL, NOTE_TEMPLATE_LABELS, NOTE_TEMPLATE_TEXT, NOTE_TEMPLATE_TITLE, isQuestionnaire } from './template';
export { applyFieldSuggestion, diffNoteFacts, moveFieldToOther, parseNoteForm, setNoteFieldFacts, splitFactDate, splitNoteFacts, type NoteFieldSuggestion, type NoteFormPart } from './form';
export { mergeNoteFill, noteFillRequest, type NoteFillMerge, type NoteFillRequest, type NoteFillSource } from './fill';
