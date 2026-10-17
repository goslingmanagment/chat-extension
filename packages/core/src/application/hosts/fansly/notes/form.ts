// The questionnaire as fields (R20 P11b2; FS-NOTE-2; the Fansly extension 2.12.0, `src/shared/fan-notes.ts`, decisions 164,
// 166). Pure. The note itself stays what Fansly stores and the old extension writes and reads: `Label: value` lines,
// a value's facts joined with «; »; a line without a label right under a field is that field's continuation (chatters
// write them by hand) and joins the field's own line only when the chatter edits that field. Every other line keeps
// its bytes, so a chatter who switches between the old extension and this one sees the same questionnaire.

/** Fewer `Label: value` lines than this is a note, not a questionnaire; more than the kernel's bound — not one either. */
export const NOTE_FIELDS_MIN = 2;
export const NOTE_FIELDS_MAX = 30;
export const NOTE_FIELD_LABEL_MAX_CHARS = 60;

const FIELD_LINE = /^\s*([^:\n]+?)\s*:(.*)$/;

/** One `Label: value` line of a note. */
export interface NoteTemplateField {
  readonly label: string;
  readonly value: string;
  /** Index of the line in the note's text. */
  readonly line: number;
}

/** A field of the questionnaire: the value's «; » parts, then its continuation lines. */
export interface NoteFormField {
  readonly kind: 'field';
  readonly label: string;
  readonly facts: string[];
  /** First and last line of the field in the note's text. */
  readonly line: number;
  lastLine: number;
}

/** A line that belongs to no field: before the first one, or after a blank line. */
export interface NoteFormText {
  readonly kind: 'text';
  readonly text: string;
  readonly line: number;
}

export type NoteFormPart = NoteFormField | NoteFormText;

/** A rewrite of a filled field the Goose offers (R20 P11c fills it; shown under its field, never saved by itself);
 * `current` — the value of the field's own line the hub saw, `proposed` — the hub's whole rewrite of it. */
export interface NoteFieldSuggestion {
  readonly label: string;
  readonly current: string;
  readonly proposed: string;
  /** The fan's words behind it: shown, never saved. */
  readonly quotes: readonly string[];
}

const charCount = (text: string): number => Array.from(text).length;

/** Labels compare trimmed, case-insensitively and composed (NFC): «- Имя» of a list is the template's «Имя». */
export function noteLabelKey(label: string): string {
  return label.trim().replace(/^[-*•]+\s*/, '').normalize('NFC').toLocaleLowerCase('ru');
}

function isLabel(label: string): boolean {
  const trimmed = label.trim();
  return (
    trimmed.length > 0 &&
    charCount(trimmed) <= NOTE_FIELD_LABEL_MAX_CHARS &&
    /\p{L}/u.test(trimmed) &&
    // The kernel refuses these in a label: they would break the `Label: value` line or change under its escaping.
    !/[<>&\r\u2028\u2029]/.test(trimmed) &&
    // «https://…» is a link in a free note, not a field.
    !/^https?$/i.test(trimmed)
  );
}

/** Every `Label: value` line of a text, the first of each label, in order. */
function fieldLines(text: string): NoteTemplateField[] {
  const fields: NoteTemplateField[] = [];
  const seen = new Set<string>();
  text.split('\n').forEach((raw, line) => {
    const match = FIELD_LINE.exec(raw);
    if (match === null || !isLabel(match[1] ?? '')) return;
    // A colon inside a time is part of a fact, e.g. «пишет после работы в 23:00», never a field separator.
    if (/(?:^|\s)(?:[01]?\d|2[0-3])$/.test(match[1] ?? '') && /^[0-5]\d(?:\D|$)/.test(match[2] ?? '')) return;
    const label = (match[1] ?? '').trim();
    const key = noteLabelKey(label);
    if (seen.has(key)) return;
    seen.add(key);
    fields.push({ label, value: (match[2] ?? '').trim(), line });
  });
  return fields;
}

/** The questionnaire's `Label: value` lines; empty when the note is not a questionnaire. */
export function parseNoteTemplate(text: string): NoteTemplateField[] {
  const fields = fieldLines(text);
  return fields.length >= NOTE_FIELDS_MIN && fields.length <= NOTE_FIELDS_MAX ? fields : [];
}

/** A value's facts: its parts between «; » (a lone «;» stays inside a fact). */
export function splitNoteFacts(value: string): string[] {
  return value
    .split(/;\s+/)
    .map((fact) => fact.trim())
    .filter(Boolean);
}

/** The questionnaire's fields and the free lines around them, in note order; null when the note is not one. Blank
 * lines are layout only. */
export function parseNoteForm(text: string): NoteFormPart[] | null {
  const fields = parseNoteTemplate(text);
  if (fields.length === 0) return null;
  const starts = new Map(fields.map((field) => [field.line, field] as const));
  const parts: NoteFormPart[] = [];
  let open: NoteFormField | null = null;
  const lines = text.split('\n');
  for (let line = 0; line < lines.length; line += 1) {
    const raw = lines[line] ?? '';
    const field = starts.get(line);
    if (field !== undefined) {
      open = { kind: 'field', label: field.label, facts: splitNoteFacts(field.value), line, lastLine: line };
      parts.push(open);
    } else if (raw.trim() === '') {
      open = null;
    } else if (open !== null) {
      open.facts.push(raw.trim());
      open.lastLine = line;
    } else {
      parts.push({ kind: 'text', text: raw, line });
    }
  }
  return parts;
}

/** A note that already is the questionnaire (one per fan): «+ Анкета» leaves, the note reads as a table. */
export function isQuestionnaire(text: string): boolean {
  return parseNoteTemplate(text).length > 0;
}

/** Write a value into its field line, keeping the chatter's label as typed. */
export function withNoteFieldValue(line: string, value: string): string {
  return `${line.slice(0, line.indexOf(':') + 1)} ${value}`;
}
const withValue = withNoteFieldValue;

/** The value on a field's own line (after its `:`), trimmed: what the fill sends and a rewrite replaces — the lines
 * written under the field are not part of it (the Fansly extension 2.11.0, decision 164). */
export function noteFieldLineValue(line: string): string {
  return FIELD_LINE.exec(line)?.[2]?.trim() ?? '';
}

/** A fact appended to a field's line value (to «Другое»): after what is there, with «; ». */
export function appendNoteFact(current: string, extra: string): string {
  const head = current.trim();
  return head === '' ? extra : `${head}; ${extra}`;
}

/** Write a field's facts back as its one `Label: a; b` line; its continuation lines join that line. Every other line
 * keeps its bytes. A text without that field comes back as is. */
export function setNoteFieldFacts(text: string, label: string, facts: readonly string[]): string {
  const key = noteLabelKey(label);
  const field = parseNoteForm(text)?.find((part): part is NoteFormField => part.kind === 'field' && noteLabelKey(part.label) === key);
  if (field === undefined) return text;
  const lines = text.split('\n');
  const value = facts
    .map((fact) => fact.trim())
    .filter(Boolean)
    .join('; ');
  lines.splice(field.line, field.lastLine - field.line + 1, withValue(lines[field.line] ?? '', value));
  return lines.join('\n');
}

/**
 * «В Другое» (the Fansly extension 2.11.0, decision 164): a field the Goose named itself leaves its line (and the lines
 * written under it) and joins «Другое» as one fact `Label: a; b` — at the end of «Другое»'s own line (the lines under
 * «Другое» stay), or, with no «Другое» in the note, as a «Другое» line where it stood. `fact` — what joined «Другое»,
 * null when nothing did: a pending rewrite of «Другое» takes it on both sides, so «Принять» still applies. A text
 * without that field, or that field being «Другое», comes back as is.
 */
export function moveFieldToOther(text: string, label: string, otherLabel: string): { readonly text: string; readonly fact: string | null } {
  const parts = parseNoteForm(text);
  const key = noteLabelKey(label);
  const otherKey = noteLabelKey(otherLabel);
  const field = parts?.find((part): part is NoteFormField => part.kind === 'field' && noteLabelKey(part.label) === key);
  if (parts === null || field === undefined || key === otherKey) return { text, fact: null };
  const fact = field.facts.length === 0 ? null : `${field.label}: ${field.facts.join('; ')}`;
  const other = parts.find((part): part is NoteFormField => part.kind === 'field' && noteLabelKey(part.label) === otherKey);
  const lines = text.split('\n');
  if (other === undefined) {
    lines.splice(field.line, field.lastLine - field.line + 1, ...(fact === null ? [] : [`${otherLabel}: ${fact}`]));
    return { text: lines.join('\n'), fact: null };
  }
  if (fact !== null) lines[other.line] = withValue(lines[other.line] ?? '', appendNoteFact(noteFieldLineValue(lines[other.line] ?? ''), fact));
  lines.splice(field.line, field.lastLine - field.line + 1);
  return { text: lines.join('\n'), fact };
}

/** «Флорида (08.2026)»: the fact and the month the Goose stamped on it. */
export function splitFactDate(fact: string): { readonly text: string; readonly date: string | null } {
  const match = /^(.*\S)\s*\((\d{2}\.\d{4})\)$/.exec(fact);
  return match === null ? { text: fact, date: null } : { text: match[1] ?? fact, date: match[2] ?? null };
}

const decodeEntities = (text: string): string => text.replace(/&(lt|gt|amp);/g, (_, name: string) => (name === 'lt' ? '<' : name === 'gt' ? '>' : '&'));
const comparable = (value: string): string => decodeEntities(value).normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');

/** What a rewrite changes, fact by fact: a rewrite that keeps the field and adds to it shows the addition alone. */
export function diffNoteFacts(current: string, proposed: string): { readonly added: string[]; readonly removed: string[] } {
  const before = splitNoteFacts(current);
  const after = splitNoteFacts(proposed);
  const had = new Set(before.map(comparable));
  const has = new Set(after.map(comparable));
  return { added: after.filter((fact) => !had.has(comparable(fact))), removed: before.filter((fact) => !has.has(comparable(fact))) };
}

/** Same value, as the merge and «Принять» compare them: entities decoded, composed, whitespace and case folded. */
export function sameNoteValue(a: string, b: string): boolean {
  return comparable(a) === comparable(b);
}

/** «Принять» (the Fansly extension 2.11.0, decision 164): the field's own line takes the proposed value — a whole
 * rewrite of what the hub saw; the lines written under it stay where they are. A field the chatter has since edited
 * away from the value the rewrite was made for is left alone. Found past 30 `Label: value` lines too. */
export function applyFieldSuggestion(text: string, suggestion: NoteFieldSuggestion): string {
  const key = noteLabelKey(suggestion.label);
  const field = fieldLines(text).find((entry) => noteLabelKey(entry.label) === key);
  if (field === undefined || !sameNoteValue(field.value, suggestion.current)) return text;
  const lines = text.split('\n');
  lines[field.line] = withValue(lines[field.line] ?? '', suggestion.proposed);
  return lines.join('\n');
}
