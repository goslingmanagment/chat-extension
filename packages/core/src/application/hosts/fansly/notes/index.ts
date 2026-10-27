// «Заметки» of a Fansly tab: the controller, the questionnaire's template, its fields and its fill.
export { NOTES_FOLLOW_DELAY_MS, createNotesController, noteWriteHow, type NoteWriteHow, type NotesController, type NotesPort, type NotesTarget, type NotesWho } from './controller';
export { NOTE_OTHER_LABEL, NOTE_TEMPLATE_LABELS, NOTE_TEMPLATE_TEXT, NOTE_TEMPLATE_TITLE, isQuestionnaire } from './template';
export { applyFieldSuggestion, diffNoteFacts, parseNoteForm, setNoteFieldFacts, splitFactDate, splitNoteFacts, writeNoteField, type NoteFieldSuggestion, type NoteFormPart } from './form';
export { applyNoteFindings, mergeNoteFill, noteFillRequest, noteFindings, noteSuggestion, type NoteFillMerge, type NoteFillRequest, type NoteFillSource, type NoteFinding, type NoteSuggestionShape } from './fill';
