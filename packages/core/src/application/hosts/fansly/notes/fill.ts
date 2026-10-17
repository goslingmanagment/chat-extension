// «✨ Дополнить из чата» (R20 P11c, P11b2; FS-NOTE-6; FX-014…FX-016, FX-021…FX-023; the Fansly extension 2.10–2.13,
// decisions 159–161, 164, 166): what a fill asks of the hub and how its answer joins the questionnaire. Pure.
//
// - Asked: the questionnaire's labels in note order, then the template's labels it lacks, at most 30 — labels only, no
//   value of the note leaves the tab (FS-NOTE-5, FX-015). The hub answers in its merge mode with every value empty
//   (decision X43): one `Label: value` line per label from the whole chat, with the fan's words behind it and the month
//   of a stale fact, never having seen what the chatter wrote; then the fields it named itself.
// - Joined, never wiping what the chatter wrote (FX-016): an empty field takes the answer; a filled one keeps its facts,
//   and the answer's new facts wait under it as the Goose's rewrite («Принять» adds them, «Не нужно» drops them); a
//   template label the note lacked becomes a new line after the last field and the lines written under it, and so does
//   a field the hub named itself (`proposed`: «В Другое» moves it); one that cannot have a line of its own — its label
//   is the note's already or the questionnaire is full — joins «Другое» as `Label: value`. Nothing is written to Fansly
//   before «Создать» or «Сохранить».
// - The fan's words stay beside the draft (`sources`, a rewrite's `quotes`), never in it.

import { NOTE_FILL_LIMITS } from '@cg/contracts/limits';

import { NOTE_FIELDS_MAX, diffNoteFacts, noteLabelKey, parseNoteForm, setNoteFieldFacts, splitNoteFacts, type NoteFieldSuggestion, type NoteFormField, type NoteFormPart } from './form';
import { NOTE_OTHER_LABEL, NOTE_TEMPLATE_LABELS } from './template';

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

/** The fan's words behind what the fill wrote straight into the draft (an empty field filled, a new line, a fact that
 * joined «Другое»): `label` — the field they speak of. Shown by «Слова фана», never saved. */
export interface NoteFillSource {
  readonly label: string;
  readonly quotes: readonly string[];
}

export interface NoteFillMerge {
  readonly text: string;
  /** The fields the Goose wrote into, in note order: the empty ones it filled, then its new lines. */
  readonly wrote: string[];
  /** Its additions to filled fields: the field's facts, then the new ones — accepted, they add and drop nothing. */
  readonly suggestions: NoteFieldSuggestion[];
  readonly sources: NoteFillSource[];
  /** The fields the hub named itself that got a line of their own: «В Другое» on each. */
  readonly proposed: string[];
}

type AnswerField = { readonly label: string; readonly value: string; readonly quotes?: readonly string[] | undefined };

/** A field of the questionnaire as the merge sees it: the note's own (`line` ≥ 0) or a new line (`line` -1). */
type Slot = { readonly label: string; facts: string[]; readonly line: number; readonly fresh: boolean };

/**
 * Join a fill's answer (each asked label with its value, `''` — nothing found, and the fan's words behind it) and the
 * fields the hub named itself into the questionnaire's text.
 */
export function mergeNoteFill(text: string, answer: readonly AnswerField[], named: readonly AnswerField[] = []): NoteFillMerge {
  const parts = parseNoteForm(text);
  if (parts === null) return { text, wrote: [], suggestions: [], sources: [], proposed: [] };
  const fields = parts.filter(isField);
  const slots = new Map<string, Slot>(fields.map((field) => [noteLabelKey(field.label), { label: field.label, facts: [...field.facts], line: field.line, fresh: false }] as const));
  let next = text;
  const wrote: string[] = [];
  const added: Slot[] = [];
  const suggestions: NoteFieldSuggestion[] = [];
  const sources: NoteFillSource[] = [];
  const proposed: string[] = [];
  const source = (label: string, quotes: readonly string[] | undefined): void => {
    if (quotes !== undefined && quotes.length > 0) sources.push({ label, quotes });
  };
  const newLine = (label: string, facts: string[]): Slot => {
    const slot: Slot = { label, facts, line: -1, fresh: true };
    slots.set(noteLabelKey(label), slot);
    added.push(slot);
    wrote.push(label);
    return slot;
  };
  for (const { label, value, quotes } of answer) {
    const facts = splitNoteFacts(value);
    if (facts.length === 0) continue;
    const slot = slots.get(noteLabelKey(label));
    if (slot === undefined) {
      newLine(label, facts);
      source(label, quotes);
    } else if (slot.facts.length === 0 && !slot.fresh) {
      // An empty field has no line under it: filling it keeps every line where it was.
      next = setNoteFieldFacts(next, slot.label, facts);
      slot.facts = facts;
      wrote.push(slot.label);
      source(slot.label, quotes);
    } else if (!slot.fresh) {
      const current = slot.facts.join('; ');
      const { added: more } = diffNoteFacts(current, facts.join('; '));
      if (more.length > 0) suggestions.push({ label: slot.label, current, proposed: [...slot.facts, ...more].join('; '), quotes: quotes ?? [] });
    }
  }
  const otherKey = noteLabelKey(NOTE_OTHER_LABEL);
  for (const { label, value, quotes } of named) {
    const facts = splitNoteFacts(value);
    if (facts.length === 0) continue;
    if (!slots.has(noteLabelKey(label)) && slots.size < NOTE_FIELDS_MAX) {
      newLine(label, facts);
      proposed.push(label);
      source(label, quotes);
      continue;
    }
    // No line of its own: the fact joins «Другое», as `Label: value` («+ Другое: x» by its value alone).
    const moved = noteLabelKey(label) === otherKey ? facts.join('; ') : `${label}: ${facts.join('; ')}`;
    const other = slots.get(otherKey) ?? (slots.size < NOTE_FIELDS_MAX ? newLine(NOTE_OTHER_LABEL, []) : undefined);
    if (other === undefined) continue;
    other.facts.push(moved);
    if (!other.fresh) {
      next = setNoteFieldFacts(next, other.label, other.facts);
      // A rewrite of «Другое» waiting under it keeps applying: the moved fact is on both of its sides.
      const pending = suggestions.findIndex((suggestion) => noteLabelKey(suggestion.label) === otherKey);
      const was = suggestions[pending];
      if (was !== undefined) suggestions[pending] = { ...was, current: `${was.current}; ${moved}`, proposed: `${was.proposed}; ${moved}` };
      if (!wrote.includes(other.label)) wrote.push(other.label);
    }
    source(label, quotes);
  }
  const lines = added.filter((slot) => slot.facts.length > 0).map((slot) => `${slot.label}: ${slot.facts.join('; ')}`);
  if (lines.length > 0) {
    // Under the last field and the lines written under it: a line in between would take those lines for its own.
    const all = next.split('\n');
    all.splice((fields.at(-1)?.lastLine ?? all.length - 1) + 1, 0, ...lines);
    next = all.join('\n');
  }
  return { text: next, wrote: wrote.filter((label) => slots.get(noteLabelKey(label))?.facts.length !== 0), suggestions, sources, proposed };
}
