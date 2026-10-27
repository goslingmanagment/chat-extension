// The answer of «✨ Дополнить из чата» (R20 P11b2; FS-NOTE-6; the Fansly extension 2.11.0, `parseFilledFields`, decision 164):
// the hub's `fan-notes-fill` in its merge mode, asked with the questionnaire's values (decision X43), read into the
// operation's result. Pure. 2026-10-27: in core/domain, so the notes panel reads the same answer while it streams
// (`noteFillSeen`: the fields the Goose has answered so far) as the background reads it at its end.
//
// - One `Label: value` line per asked label, in order: `Label: =` (the chat adds nothing to what is written) and
//   `Label:` are nothing for that field, and the words under them are dropped; any other value is the field's value as
//   the chat makes it — for a filled field, the hub's whole rewrite of it (the panel offers it); a label is
//   matched as the panel matches labels (trimmed, a list marker dropped, NFC, case-insensitive) and given back as asked.
// - Up to three `> «…»` lines after a field or a `+` line are the fan's words behind it: guillemets or quotes stripped,
//   a fourth ignored, one with nothing above it ignored. They are shown, never written into the note.
// - `+ Label: value` is a field the hub named itself: at most five with a value, none an asked label (an asked label
//   starting with «+» is that field).
// - The prompt escapes `<`, `>`, `&` in what the model reads: `&lt;`, `&gt;`, `&amp;` are decoded once everywhere.
// - Preambles, blank lines and lines of labels nobody asked are ignored; an answer with no asked label at all is no
//   answer (null).
// - One value over the result's 2000 characters is nothing for its field (a field the hub named itself is dropped), never
//   a reason to drop the answer (audit №13: one long «Другое» made the whole fill «не заполнено»); a Unicode line or
//   paragraph separator inside a value is a space.

import { NOTE_FILL_LIMITS } from '@cg/contracts/limits';
import { FANSLY_OP_LIMITS, NoteFieldsResultSchema } from '@cg/contracts/ops-fansly';
import type { NoteFieldValue, SiteOpResult } from '@cg/contracts/ops';

const FIELD_LINE = /^\s*([^:\n]+?)\s*:(.*)$/;
const PROPOSED_LINE = /^\s*\+\s*([^:\n]+?)\s*:(.*)$/;
const QUOTE_LINE = /^\s*>(.*)$/;
/** The hub's answer for a field the chat adds nothing to (merge mode). */
const UNCHANGED = '=';
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['«', '»'],
  ['"', '"'],
  ['“', '”'],
  ['„', '“'],
];

const decodeEntities = (text: string): string => text.replace(/&(lt|gt|amp);/g, (_, name: string) => (name === 'lt' ? '<' : name === 'gt' ? '>' : '&'));
/** A field's value as the result takes it: one line; over the result's bound — nothing (`''`). */
const fieldValue = (raw: string): string => {
  const value = decodeEntities(raw.trim());
  return value.length > NOTE_FILL_LIMITS.valueMaxChars ? '' : value;
};
const labelKey = (label: string): string => label.trim().replace(/^[-*•]+\s*/, '').normalize('NFC').toLocaleLowerCase('ru');
/** A label the result takes (`NoteFieldLabelSchema`): trimmed, one line, none of `:`, `<`, `>`, `&`, within 60. */
const usableLabel = (label: string): boolean => label !== '' && label.length <= 60 && !/[\r\n\u2028\u2029:<>&]/.test(label);

function quoteText(raw: string): string {
  let text = raw.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(open.length, text.length - close.length).trim();
      break;
    }
  }
  const decoded = decodeEntities(text).replace(/\s+/g, ' ');
  const chars = Array.from(decoded);
  // The hub asks for 200 at most; a longer quote is cut, never a reason to drop the answer.
  return chars.length <= FANSLY_OP_LIMITS.noteQuoteMaxChars ? decoded : `${chars.slice(0, FANSLY_OP_LIMITS.noteQuoteMaxChars - 1).join('')}…`;
}

type Mutable = { label: string; value: string; quotes: string[] };

/** The answer as the operation's result, or null when it answers no asked label (or breaks the result's bounds). */
export function parseNoteFillAnswer(text: string, asked: readonly string[]): Extract<SiteOpResult, { kind: 'note-fields' }> | null {
  const wanted = new Map(asked.map((label) => [labelKey(label), label] as const));
  const fields = new Map<string, Mutable>();
  const proposed: Mutable[] = [];
  let anchor: Mutable | null = null;
  // A line or paragraph separator is no line break of the answer's: a space, so the line still reads as its field.
  for (const raw of text.split(/\r?\n/).map((line) => line.replace(/[\u2028\u2029]+/g, ' '))) {
    if (raw.trim() === '') continue;
    const quote = QUOTE_LINE.exec(raw);
    if (quote !== null) {
      const words = quoteText(quote[1] ?? '');
      if (anchor !== null && words !== '' && anchor.quotes.length < FANSLY_OP_LIMITS.noteQuotesMax) anchor.quotes.push(words);
      continue;
    }
    anchor = null;
    const match = FIELD_LINE.exec(raw);
    const label = match === null ? undefined : wanted.get(labelKey(match[1] ?? ''));
    const plus = label === undefined ? PROPOSED_LINE.exec(raw) : null;
    if (plus !== null) {
      const name = decodeEntities((plus[1] ?? '').trim());
      const value = fieldValue(plus[2] ?? '');
      const fresh = !wanted.has(labelKey(name)) && !proposed.some((entry) => labelKey(entry.label) === labelKey(name));
      if (value !== '' && value !== UNCHANGED && usableLabel(name) && fresh && proposed.length < FANSLY_OP_LIMITS.noteProposedMax) {
        anchor = { label: name, value, quotes: [] };
        proposed.push(anchor);
      }
      continue;
    }
    if (label === undefined || fields.has(label)) continue;
    const value = fieldValue(match?.[2] ?? '');
    const entry: Mutable = { label, value: value === UNCHANGED ? '' : value, quotes: [] };
    fields.set(label, entry);
    // Nothing for the field: no words to hang under it.
    if (entry.value !== '') anchor = entry;
  }
  if (fields.size === 0) return null;
  const withQuotes = (entry: Mutable): NoteFieldValue => ({ label: entry.label, value: entry.value, ...(entry.quotes.length === 0 ? {} : { quotes: entry.quotes }) });
  const result = NoteFieldsResultSchema.safeParse({
    kind: 'note-fields',
    fields: asked.map((label) => withQuotes(fields.get(label) ?? { label, value: '', quotes: [] })),
    ...(proposed.length === 0 ? {} : { proposed: proposed.map(withQuotes) }),
  });
  return result.success ? result.data : null;
}

/** The asked labels the answer has a line for so far, in the order they came (a stream's complete lines). */
export function noteFillSeen(text: string, asked: readonly string[]): string[] {
  const wanted = new Map(asked.map((label) => [labelKey(label), label] as const));
  const seen: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (QUOTE_LINE.test(raw) || PROPOSED_LINE.test(raw)) continue;
    const match = FIELD_LINE.exec(raw.replace(/[\u2028\u2029]+/g, ' '));
    const label = match === null ? undefined : wanted.get(labelKey(match[1] ?? ''));
    if (label !== undefined && !seen.includes(label)) seen.push(label);
  }
  return seen;
}
