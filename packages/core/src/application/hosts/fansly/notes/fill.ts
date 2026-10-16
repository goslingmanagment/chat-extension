// «✨ Заполнить из чата» (R20 P11c; FS-NOTE-6; FX-014…FX-016; the Fansly extension 2.10–2.12, decisions 159–161, 164):
// what a fill asks of the hub and how its answer joins the questionnaire. Pure.
//
// - Asked: the questionnaire's labels in note order, then the template's labels it lacks, at most 30 — labels only, no
//   value of the note leaves the tab (FS-NOTE-5, FX-015). The hub answers one `Label: value` line per label from the
//   whole chat, never having seen what the chatter wrote (its labels-only mode).
// - Joined, never wiping what the chatter wrote (FX-016): an empty field takes the answer; a filled one keeps its facts,
//   and the answer's new facts wait under it as the Goose's rewrite («Принять» adds them, «Не нужно» drops them); a
//   template label the note lacked becomes a new line after the last field and the lines written under it. Nothing is
//   written to Fansly before «Создать» or «Сохранить».

import { NOTE_FILL_LIMITS } from '@cg/contracts/limits';

import { diffNoteFacts, noteLabelKey, parseNoteForm, setNoteFieldFacts, splitNoteFacts, type NoteFieldSuggestion, type NoteFormField, type NoteFormPart } from './form';
import { NOTE_TEMPLATE_LABELS } from './template';

const isField = (part: NoteFormPart): part is NoteFormField => part.kind === 'field';

/** A label the hub takes as is (`NoteFieldLabelSchema`): trimmed, one line, none of `:`, `<`, `>`, `&`, within its length. */
const askable = (label: string): boolean => label !== '' && label.trim() === label && label.length <= NOTE_FILL_LIMITS.labelMaxChars && !/[\r\n\u2028\u2029:<>&]/.test(label);

/** Only the parser's field lines and the missing template labels go out, never continuation lines (including times).
 * null when the text is not a questionnaire (nothing to fill). */
export function noteFillFields(text: string): string[] | null {
  const parts = parseNoteForm(text);
  if (parts === null) return null;
  const fields = parts.filter(isField);
  const present = new Set(fields.map((field) => noteLabelKey(field.label)));
  const room = Math.max(0, NOTE_FILL_LIMITS.fieldsMax - fields.length);
  const labels = [...fields.map((field) => field.label).filter(askable), ...NOTE_TEMPLATE_LABELS.filter((label) => !present.has(noteLabelKey(label))).slice(0, room)];
  return labels.length === 0 ? null : labels;
}

export interface NoteFillMerge {
  readonly text: string;
  /** The fields the Goose wrote into, in note order: the empty ones it filled, then its new lines. */
  readonly wrote: string[];
  /** Its additions to filled fields: the field's facts, then the new ones — accepted, they add and drop nothing. */
  readonly suggestions: NoteFieldSuggestion[];
}

/** Join a fill's answer (each asked label with its value, `''` — nothing found) into the questionnaire's text. */
export function mergeNoteFill(text: string, answer: readonly { readonly label: string; readonly value: string }[]): NoteFillMerge {
  const parts = parseNoteForm(text);
  if (parts === null) return { text, wrote: [], suggestions: [] };
  const fields = parts.filter(isField);
  const byKey = new Map(fields.map((field) => [noteLabelKey(field.label), field] as const));
  let next = text;
  const wrote: string[] = [];
  const lines: string[] = [];
  const suggestions: NoteFieldSuggestion[] = [];
  for (const { label, value } of answer) {
    const facts = splitNoteFacts(value);
    if (facts.length === 0) continue;
    const key = noteLabelKey(label);
    const field = byKey.get(key);
    if (field === undefined) {
      byKey.set(key, { kind: 'field', label, facts, line: -1, lastLine: -1 });
      lines.push(`${label}: ${facts.join('; ')}`);
      wrote.push(label);
    } else if (field.facts.length === 0) {
      // An empty field has no line under it: filling it keeps every line where it was.
      next = setNoteFieldFacts(next, field.label, facts);
      wrote.push(field.label);
    } else if (field.line >= 0) {
      const current = field.facts.join('; ');
      const { added } = diffNoteFacts(current, facts.join('; '));
      if (added.length > 0) suggestions.push({ label: field.label, current, proposed: [...field.facts, ...added].join('; '), quotes: [] });
    }
  }
  if (lines.length > 0) {
    // Under the last field and the lines written under it: a line in between would take those lines for its own.
    const all = next.split('\n');
    all.splice((fields.at(-1)?.lastLine ?? all.length - 1) + 1, 0, ...lines);
    next = all.join('\n');
  }
  return { text: next, wrote, suggestions };
}
