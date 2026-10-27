// «✨ Дополнить из чата» (FS-NOTE-5, FS-NOTE-6; FX-014…FX-016, FX-021…FX-024): what a fill asks of the hub and how its
// answer joins the questionnaire. Pure.
//
// - Asked (the owner's ruling of 2026-10-17, decision X43): the questionnaire's labels in note order with the value of
//   each field's own line, then the template's labels it lacks with `''`, at most 30 — the hub's merge mode
//   (`noteFields` + `noteValues`). A value is one line (its line breaks flattened), trimmed; a field whose value is over
//   2000 characters is not asked, and nothing here touches it. The lines written under a field, the free lines, the
//   other notes and the custom name never leave the tab.
// - The answer: `Label: =` — nothing for that field; `Label: value` — the field's value as the chat makes it, with the
//   fan's words behind it; `+ Label: value` — a field the hub named itself.
// - 2026-10-26: the answer is a list of findings (`noteFindings`): a value for an empty field, the hub's rewrite of a
//   filled one (the facts it adds and drops), a template's field the note lacks, a field the hub named. 2026-10-27 (the
//   owner chose «Подсказки прямо в строках»): each stands in its field's row as a suggestion (`noteSuggestion`: it
//   refines a fact, rewrites the field, adds to it, fills it, or is a field of its own), and the chatter's ✓ writes it
//   (`applyNoteFindings`) into the questionnaire as it is then, never wiping what the chatter wrote (FX-016): a field's
//   line takes the hub's value only while it still holds what the hub saw (else the row asks «Заменить?»); the lines
//   written under it stay; a new line goes after the last field and the lines under it while the questionnaire has
//   room under 30, and one that cannot have a line of its own joins «Другое» as `Label: value` (`mergeNoteFill`), or is
//   named. The fan's words stay on the suggestion's hover, never in the note.

import { NOTE_FILL_LIMITS } from '@cg/contracts/limits';

import { NOTE_FIELDS_MAX, appendNoteFact, applyFieldSuggestion, diffNoteFacts, noteFieldLineValue, noteFieldValue, noteLabelKey, parseNoteForm, parseNoteTemplate, sameNoteValue, splitFactDate, splitNoteFacts, withNoteFieldValue, type NoteFieldSuggestion, type NoteFormField, type NoteFormPart } from './form';
import { NOTE_OTHER_LABEL, NOTE_TEMPLATE_LABELS } from './template';

const isField = (part: NoteFormPart): part is NoteFormField => part.kind === 'field';

/** A label the hub takes as is (`NoteFieldLabelSchema`): trimmed, one line, none of `:`, `<`, `>`, `&`, within its length. */
const askable = (label: string): boolean => label !== '' && label.trim() === label && label.length <= NOTE_FILL_LIMITS.labelMaxChars && !/[\r\n\u2028\u2029:<>&]/.test(label);

/** A line of the note is one value: a stray separator inside it would be a line break to the hub. */
const oneLine = (value: string): string => value.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

/** A value the hub takes (`aiNoteValueSchema`): within 2000 UTF-16 code units, the hub's unit. */
const sendable = (value: string): boolean => value.length <= NOTE_FILL_LIMITS.valueMaxChars;

/** What a fill sends: the labels and, index-aligned, their values (`''` — an empty field or a template label the note lacks). */
export interface NoteFillRequest {
  readonly fields: string[];
  readonly values: string[];
}

/** Only the parser's field lines and the missing template labels go out, never continuation lines (including times);
 * a field over 2000 characters is left out, label and all. null when the text is not a questionnaire (nothing to fill). */
export function noteFillRequest(text: string): NoteFillRequest | null {
  const template = parseNoteTemplate(text);
  if (template.length === 0) return null;
  const fields: string[] = [];
  const values: string[] = [];
  for (const field of template) {
    const value = oneLine(field.value);
    if (!askable(field.label) || !sendable(value)) continue;
    fields.push(field.label);
    values.push(value);
  }
  const present = new Set(template.map((field) => noteLabelKey(field.label)));
  const room = Math.max(0, NOTE_FILL_LIMITS.fieldsMax - template.length);
  for (const label of NOTE_TEMPLATE_LABELS.filter((entry) => !present.has(noteLabelKey(entry))).slice(0, room)) {
    fields.push(label);
    values.push('');
  }
  return fields.length === 0 ? null : { fields, values };
}

/** The fan's words behind what the fill wrote straight into the draft (an empty field filled, a new line, a fact that
 * joined «Другое»): `label` — the field they speak of. Shown by «Слова фана», never saved. */
export interface NoteFillSource {
  readonly label: string;
  readonly quotes: readonly string[];
}

export interface NoteFillMerge {
  readonly text: string;
  /** The fields the Goose wrote into: the empty ones it filled, «Другое» when a fact joined it, then its new lines. */
  readonly wrote: string[];
  /** Its rewrites of filled fields: the line's value the hub saw, then the hub's — accepted, that line takes it. */
  readonly suggestions: NoteFieldSuggestion[];
  readonly sources: NoteFillSource[];
  /** The fields the hub named itself that got a line of their own. */
  readonly proposed: string[];
  /** The fields the hub named itself that found no place — no line of their own and no «Другое» to join: named. */
  readonly unplaced: string[];
}

type AnswerField = { readonly label: string; readonly value: string; readonly quotes?: readonly string[] | undefined };
type Line = { readonly label: string; value: string };

/** «+ Другое: x» is already about «Другое»: its value alone. */
const movedText = (label: string, value: string): string => (noteLabelKey(label) === noteLabelKey(NOTE_OTHER_LABEL) ? value : `${label}: ${value}`);

/**
 * Join a fill's answer (each asked label with its value, `''` — nothing for it, and the fan's words behind it) and the
 * fields the hub named itself into the questionnaire's text.
 */
export function mergeNoteFill(text: string, answer: readonly AnswerField[], named: readonly AnswerField[] = []): NoteFillMerge {
  const parts = parseNoteForm(text);
  if (parts === null) return { text, wrote: [], suggestions: [], sources: [], proposed: [], unplaced: [] };
  const fields = parts.filter(isField);
  const byKey = new Map(fields.map((field) => [noteLabelKey(field.label), field] as const));
  const lines = text.split('\n');
  const valueOf = (field: NoteFormField): string => noteFieldLineValue(lines[field.line] ?? '');
  const wrote: string[] = [];
  const additions: Line[] = [];
  const suggestions: NoteFieldSuggestion[] = [];
  const sources: NoteFillSource[] = [];
  const source = (label: string, quotes: readonly string[] | undefined): void => {
    if (quotes !== undefined && quotes.length > 0) sources.push({ label, quotes });
  };
  for (const { label, value: raw, quotes } of answer) {
    const value = raw.trim();
    if (value === '') continue;
    const field = byKey.get(noteLabelKey(label));
    if (field === undefined) {
      additions.push({ label, value });
      source(label, quotes);
      continue;
    }
    const current = valueOf(field);
    // A value over the bound was not asked: the merge leaves it alone.
    if (!sendable(oneLine(current))) continue;
    if (current === '') {
      // Its own line only: the lines under it stay where they are.
      lines[field.line] = withNoteFieldValue(lines[field.line] ?? '', value);
      wrote.push(field.label);
      source(field.label, quotes);
    } else if (!sameNoteValue(current, value)) suggestions.push({ label: field.label, current, proposed: value, quotes: quotes ?? [] });
  }

  // Fields the hub named itself: a line of their own while the label is free and the questionnaire has room under 30;
  // the rest join «Другое».
  const otherKey = noteLabelKey(NOTE_OTHER_LABEL);
  const taken = new Set([...byKey.keys(), ...answer.map((field) => noteLabelKey(field.label))]);
  const usable = named.filter((field) => field.value.trim() !== '');
  const accepted: number[] = [];
  const overflow: number[] = [];
  const count = (): number => fields.length + additions.length + accepted.length;
  usable.forEach((field, index) => {
    const key = noteLabelKey(field.label);
    if (!taken.has(key) && count() < NOTE_FIELDS_MAX) {
      taken.add(key);
      accepted.push(index);
    } else overflow.push(index);
  });
  const unplaced: string[] = [];
  const moved: AnswerField[] = [];
  if (overflow.length > 0) {
    const other = byKey.get(otherKey);
    const otherAddition = additions.find((entry) => noteLabelKey(entry.label) === otherKey);
    // Creating «Другое» takes a place of its own: the last of the hub's lines gives its place up when none is left.
    const last = accepted.at(-1);
    if (other === undefined && otherAddition === undefined && count() >= NOTE_FIELDS_MAX && last !== undefined) {
      accepted.pop();
      overflow.push(last);
      overflow.sort((a, b) => a - b);
    }
    const fresh = overflow.flatMap((index) => usable[index] ?? []);
    const extra = fresh.map((field) => movedText(field.label, field.value.trim())).join('; ');
    let landed = true;
    if (other !== undefined) {
      const current = valueOf(other);
      if (!sendable(oneLine(current))) landed = false;
      else {
        lines[other.line] = withNoteFieldValue(lines[other.line] ?? '', appendNoteFact(current, extra));
        if (!wrote.includes(other.label)) wrote.push(other.label);
        // A rewrite of «Другое» waiting under it keeps applying: the moved facts are on both of its sides.
        for (const [index, suggestion] of suggestions.entries()) {
          if (noteLabelKey(suggestion.label) === otherKey) suggestions[index] = { ...suggestion, current: appendNoteFact(suggestion.current, extra), proposed: appendNoteFact(suggestion.proposed, extra) };
        }
      }
    } else if (otherAddition !== undefined) otherAddition.value = appendNoteFact(otherAddition.value, extra);
    else if (count() < NOTE_FIELDS_MAX) additions.push({ label: NOTE_OTHER_LABEL, value: extra });
    // No «Другое» and no room for one: the fact stays where it was, and the notice names it.
    else landed = false;
    if (landed) moved.push(...fresh);
    else unplaced.push(...fresh.map((field) => field.label));
  }

  const proposedLines = accepted.flatMap((index) => usable[index] ?? []);
  for (const field of proposedLines) source(field.label, field.quotes);
  for (const field of moved) source(field.label, field.quotes);
  const fresh = [...additions, ...proposedLines.map((field) => ({ label: field.label, value: field.value.trim() }))];
  if (fresh.length > 0) {
    // Under the last field and the lines written under it: a line in between would take those lines for its own.
    lines.splice((fields.at(-1)?.lastLine ?? lines.length - 1) + 1, 0, ...fresh.map((entry) => `${entry.label}: ${entry.value}`));
  }
  return {
    text: lines.join('\n'),
    wrote: [...wrote, ...fresh.map((entry) => entry.label)],
    suggestions,
    sources,
    proposed: proposedLines.map((field) => field.label),
    unplaced,
  };
}

/**
 * A fact the Goose found (nothing joins the questionnaire before the chatter's ✓): `add` — into a field with nothing written, a template's field the questionnaire lacks (`missing`), or
 * the hub's rewrite of a filled field that only adds to it; `change` — a rewrite that also drops what is written;
 * `new` — a field the hub named itself.
 */
export interface NoteFinding {
  readonly label: string;
  readonly kind: 'add' | 'change' | 'new';
  /** The value of the field's own line the hub saw: '' — nothing written, or no such field. */
  readonly current: string;
  /** The hub's value for that line: ✓ puts it there. */
  readonly proposed: string;
  /** The questionnaire has no such field: ✓ adds its line. */
  readonly missing: boolean;
  /** The fan's words behind it: shown, never saved. */
  readonly quotes: readonly string[];
}

/** What the Goose found against the questionnaire's text the fill was asked with: its answer field by field, then the
 * fields it named itself. A value equal to what is written, or a rewrite that only reorders or respaces, is nothing. */
export function noteFindings(text: string, answer: readonly AnswerField[], named: readonly AnswerField[] = []): NoteFinding[] {
  const parts = parseNoteForm(text);
  if (parts === null) return [];
  const lines = text.split('\n');
  const byKey = new Map(parts.filter(isField).map((field) => [noteLabelKey(field.label), field] as const));
  const seen = new Set<string>();
  const found: NoteFinding[] = [];
  for (const { label, value: raw, quotes } of answer) {
    const value = raw.trim();
    const key = noteLabelKey(label);
    if (value === '' || seen.has(key)) continue;
    seen.add(key);
    const field = byKey.get(key);
    if (field === undefined) {
      found.push({ label, kind: 'add', current: '', proposed: value, missing: true, quotes: quotes ?? [] });
      continue;
    }
    const current = noteFieldLineValue(lines[field.line] ?? '');
    // A value over the bound was not asked: left alone.
    if (!sendable(oneLine(current)) || sameNoteValue(current, value)) continue;
    const { added, removed } = diffNoteFacts(current, value);
    if (added.length === 0 && removed.length === 0) continue;
    found.push({ label: field.label, kind: removed.length === 0 ? 'add' : 'change', current, proposed: value, missing: false, quotes: quotes ?? [] });
  }
  for (const { label, value: raw, quotes } of named) {
    const value = raw.trim();
    const key = noteLabelKey(label);
    if (value === '' || seen.has(key) || byKey.has(key)) continue;
    seen.add(key);
    found.push({ label, kind: 'new', current: '', proposed: value, missing: true, quotes: quotes ?? [] });
  }
  return found;
}

export interface NoteFindingsApplied {
  readonly text: string;
  /** The fields written, as the questionnaire names them («Другое» when a fact joined it). */
  readonly wrote: string[];
  /** Findings whose field changed since the Goose read it: left as they are, never written over. */
  readonly skipped: string[];
  /** Findings with no place: 30 fields and no «Другое» to join. */
  readonly unplaced: string[];
}

/**
 * ✓ or «Принять все»: the chosen findings into the questionnaire's text as it is now. A field's line takes the
 * hub's value only while it still holds what the hub saw (a field typed since is skipped, never written over, FX-016);
 * a field the questionnaire lacks and a field the hub named get a line after the last field, while there is room under
 * 30 — the rest join «Другое» or are named (`mergeNoteFill`).
 */
export function applyNoteFindings(text: string, findings: readonly NoteFinding[]): NoteFindingsApplied {
  let out = text;
  const wrote: string[] = [];
  const skipped: string[] = [];
  const lines: AnswerField[] = [];
  const named: AnswerField[] = [];
  for (const finding of findings) {
    if (finding.kind === 'new') {
      named.push({ label: finding.label, value: finding.proposed });
      continue;
    }
    const now = noteFieldValue(out, finding.label);
    if (now === null) {
      lines.push({ label: finding.label, value: finding.proposed });
      continue;
    }
    if (sameNoteValue(now, finding.proposed)) continue;
    if (!sameNoteValue(now, finding.current)) {
      skipped.push(finding.label);
      continue;
    }
    const next = applyFieldSuggestion(out, { label: finding.label, current: finding.current, proposed: finding.proposed, quotes: [] });
    if (next !== out) wrote.push(finding.label);
    out = next;
  }
  let unplaced: string[] = [];
  if (lines.length > 0 || named.length > 0) {
    const merged = mergeNoteFill(out, lines, named);
    out = merged.text;
    wrote.push(...merged.wrote.filter((label) => !wrote.some((entry) => noteLabelKey(entry) === noteLabelKey(label))));
    unplaced = merged.unplaced;
  }
  return { text: out, wrote, skipped, unplaced };
}

/** How a finding stands in its field's row (`NotesSuggestionVM`): what kind, and what its pill shows. */
export interface NoteSuggestionShape {
  readonly kind: 'refine' | 'replace' | 'add' | 'fill' | 'new';
  /** `refine`: the fact as written (its words, without the month) that the Goose's one extends. */
  readonly base: string | null;
  /** The pill's words: `refine` — what the Goose's fact adds to `base`; else its new facts joined with «; », no months
   * ('' — a rewrite that only drops). */
  readonly text: string;
  /** The month of the Goose's facts (the first that has one). */
  readonly date: string | null;
  /** `replace`: the facts as written that go, with their months. */
  readonly drops: readonly string[];
}

/**
 * A finding as a suggestion in its row (2026-10-27): a value for a field with nothing written (`fill`) or for a field
 * the Goose named (`new`); facts added after what is written (`add`); a fact as written extended by the Goose's one,
 * «Чикаго» → «Чикаго, Линкольн-Парк» (`refine`: the pill shows «, Линкольн-Парк» after «Чикаго»); any other rewrite
 * (`replace`: what goes is struck in the row, the pill shows what comes).
 */
export function noteSuggestion(finding: NoteFinding): NoteSuggestionShape {
  const words = (list: readonly string[]): { readonly text: string; readonly date: string | null }[] => list.map(splitFactDate);
  const monthOf = (list: readonly { readonly date: string | null }[]): string | null => list.find((fact) => fact.date !== null)?.date ?? null;
  if (finding.kind === 'new' || finding.current === '') {
    const added = words(splitNoteFacts(finding.proposed));
    return { kind: finding.kind === 'new' ? 'new' : 'fill', base: null, text: added.map((fact) => fact.text).join('; '), date: monthOf(added), drops: [] };
  }
  const diff = diffNoteFacts(finding.current, finding.proposed);
  const added = words(diff.added);
  const text = added.map((fact) => fact.text).join('; ');
  if (diff.removed.length === 0) return { kind: 'add', base: null, text, date: monthOf(added), drops: [] };
  const was = diff.removed.length === 1 ? splitFactDate(diff.removed[0] ?? '').text : '';
  const now = added.length === 1 ? (added[0]?.text ?? '') : '';
  if (was !== '' && now.length > was.length && now.toLocaleLowerCase('ru').startsWith(was.toLocaleLowerCase('ru'))) {
    return { kind: 'refine', base: was, text: now.slice(was.length), date: monthOf(added), drops: [] };
  }
  return { kind: 'replace', base: null, text, date: monthOf(added), drops: diff.removed };
}
