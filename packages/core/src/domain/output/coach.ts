// Coach answers (architecture.md §7 «черновики Coach: [NEXT] → части»;
// AI-084, AI-085, AI-092, NEW-04). The hub's coach-chat prompt keeps advice
// outside fences and wraps each proposed fan message in a fenced block that
// starts with a line ```draft and ends with a line ```: at most two blocks,
// each under 1500 characters. This reader lifts the well-formed drafts out,
// splits each into `[NEXT]` parts (H-10) and cleans them like any message
// to the fan; everything else — the advice and every fence that breaks the
// grammar — stays in the prose with its fence markers neutralised, so it
// can neither re-parse as a draft nor render as a code fence. Advice with
// the pinned labels «СИТУАЦИЯ / ЧТО УПУЩЕНО / СЛЕДУЮЩИЙ ХОД / РИСК» also
// comes as blocks. An answer with neither prose nor a draft is not saved.
// 2026-10-27 (`coach-depth-v1`): a ```more block — Coach's note that older
// messages would change its advice — is lifted out first and kept apart: it
// is never prose, never a draft, never replayed.

import { COACH_LIMITS, PART_LIMITS } from '@cg/contracts/limits';
import { CoachAnswerSchema, type COACH_BLOCK_KINDS, type CoachAnswer } from '@cg/contracts/ops';

import { hideOpenThinkBlock, stripThinkBlocks } from './cleanup';
import { parseParts } from './drafts';
import { withoutMarkers } from './markers';
import { splitLabelledSections, type SectionSpec } from './sections';

type CoachBlockKind = (typeof COACH_BLOCK_KINDS)[number];

/** The block labels as the hub's situation preset pins them. */
export const COACH_SECTION_LABELS: readonly SectionSpec<CoachBlockKind>[] = [
  { label: 'СИТУАЦИЯ', kind: 'situation' },
  { label: 'ЧТО УПУЩЕНО', kind: 'missed' },
  { label: 'СЛЕДУЮЩИЙ ХОД', kind: 'move' },
  { label: 'РИСК', kind: 'risk' },
];

/** A line that opens a draft fence: column 0, optional trailing blanks only. */
const DRAFT_OPEN_RE = /^```draft[ \t]*$/;
/** A line that closes a fence. */
const DRAFT_CLOSE_RE = /^```[ \t]*$/;
/** A line that opens Coach's note that it would read further back (`coach-depth-v1`). */
const MORE_OPEN_RE = /^```more[ \t]*$/;
/** A leftover line-anchored backtick run, neutralised in the prose. */
const FENCE_MARKER_RE = /^`{3,}/;

/** Trimmed first, so a fence marker the trim moved to a line start is caught too. */
function neutraliseFences(text: string): string {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .split('\n')
    .map((line) => (FENCE_MARKER_RE.test(line) ? line.replace(FENCE_MARKER_RE, (run) => `\\${run}`) : line))
    .join('\n');
}

/**
 * Coach's ```more note, said as the window says it: one paragraph, no long dash (the owner's rule for what chatters
 * read: a comma instead), within its bound by code points.
 */
function cleanMoreNote(body: string): string | null {
  const text = body
    .replace(/\s+/g, ' ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
  if (text.length === 0) return null;
  const points = Array.from(text);
  return points.length <= COACH_LIMITS.moreMaxChars ? text : `${points.slice(0, COACH_LIMITS.moreMaxChars - 1).join('').trimEnd()}…`;
}

/**
 * Lifts Coach's ```more note out of an answer (`coach-depth-v1`): every such block leaves the text, the last one with
 * words in it is the note. An opener never closed takes the rest of the answer — the model ended inside its note.
 */
export function liftCoachMore(raw: string): { readonly note: string | null; readonly rest: string } {
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  let note: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!MORE_OPEN_RE.test(line)) {
      kept.push(line);
      continue;
    }
    let close = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (DRAFT_CLOSE_RE.test(lines[j] ?? '')) {
        close = j;
        break;
      }
    }
    const body = cleanMoreNote(lines.slice(i + 1, close === -1 ? lines.length : close).join('\n'));
    if (body !== null) note = body;
    if (close === -1) break;
    i = close;
  }
  return { note, rest: note === null && kept.length === lines.length ? raw : kept.join('\n') };
}

export interface CoachDraftBlocks {
  /** Draft bodies in order, at most two, each well-formed. */
  readonly drafts: readonly string[];
  readonly prose: string;
}

/**
 * The fence grammar. The first two well-formed, non-empty bodies of at most
 * 1500 characters (code points: an emoji is one) become drafts. Empty bodies
 * are dropped. Every violation — an unclosed opener, an opener before the
 * previous closer, an oversized body, a well-formed block beyond the limit —
 * stays in the prose.
 */
export function splitCoachDrafts(raw: string): CoachDraftBlocks {
  const lines = raw.split(/\r?\n/);
  const drafts: string[] = [];
  const prose: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!DRAFT_OPEN_RE.test(line)) {
      prose.push(line);
      i += 1;
      continue;
    }
    const open = i;
    const body: string[] = [];
    let close = -1;
    let nested = -1;
    for (let j = open + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? '';
      // A second opener before any closer: the model left this block open. Without this the
      // nested opener would be swallowed as body text and two fan messages merge into one.
      if (DRAFT_OPEN_RE.test(next)) {
        nested = j;
        break;
      }
      if (DRAFT_CLOSE_RE.test(next)) {
        close = j;
        break;
      }
      body.push(next);
    }
    if (nested !== -1) {
      prose.push(...lines.slice(open, nested));
      i = nested;
      continue;
    }
    if (close === -1) {
      prose.push(...lines.slice(open));
      break;
    }
    const text = body.join('\n');
    if (text.trim().length > 0) {
      const oversized = Array.from(text).length > COACH_LIMITS.draftMaxChars;
      if (oversized || drafts.length >= COACH_LIMITS.draftsMax) prose.push(...lines.slice(open, close + 1));
      else drafts.push(text);
    }
    i = close + 1;
  }
  return { drafts, prose: neutraliseFences(prose.join('\n')) };
}

/**
 * AI-084, AI-085: the answer for display and for the draft buttons, or null
 * when nothing usable is left (AI-092: an empty answer is not saved).
 */
export function parseCoachAnswer(raw: string): CoachAnswer | null {
  const { note, rest } = liftCoachMore(stripThinkBlocks(raw));
  const { drafts: bodies, prose: proseText } = splitCoachDrafts(rest);
  const leftovers: string[] = [];
  const drafts: CoachAnswer['drafts'][number][] = [];
  for (const body of bodies) {
    const parts = parseParts(body);
    const holds = parts.length > 0 && parts.length <= PART_LIMITS.maxParts && parts.every((part) => part.length <= COACH_LIMITS.draftMaxChars);
    if (holds) drafts.push({ index: drafts.length, parts });
    // A draft the result cannot hold is still advice the person can read and copy.
    else if (body.trim().length > 0) leftovers.push(body.trim());
  }
  const prose = neutraliseFences([proseText, ...leftovers].filter((piece) => piece.length > 0).join('\n\n'));
  if (prose.length === 0 && drafts.length === 0) return null;
  const labelled = splitLabelledSections(prose, COACH_SECTION_LABELS);
  const seen = new Set<CoachBlockKind>();
  const blocks =
    labelled === null
      ? null
      : labelled.sections.filter((section) => {
          if (seen.has(section.kind)) return false;
          seen.add(section.kind);
          return true;
        });
  const answer: CoachAnswer = {
    prose,
    blocks: blocks === null || blocks.length < 2 ? null : blocks.map((block) => ({ kind: block.kind, body: block.body })),
    drafts,
    ...(note === null ? {} : { more: note }),
  };
  return CoachAnswerSchema.safeParse(answer).success ? answer : null;
}

/** The raw answer a finished turn replays as history: the prose and the drafts in their fences again. */
export function coachAnswerText(answer: CoachAnswer): string {
  const drafts = answer.drafts.map((draft) => ['```draft', draft.parts.join('\n[NEXT]\n'), '```'].join('\n'));
  return [answer.prose, ...drafts].filter((piece) => piece.length > 0).join('\n\n');
}

/** The stream as a preview: no reasoning, no fence lines, no Split markers or pieces of them, no ```more note (it shows under the answer). */
export function coachPreview(text: string): string {
  return liftCoachMore(withoutMarkers(hideOpenThinkBlock(text)))
    .rest.split('\n')
    .filter((line) => !/^```(?:draft)?[ \t]*$/.test(line))
    .join('\n')
    .replace(/\n`{1,3}(?:d(?:r(?:a(?:f(?:t)?)?)?)?|m(?:o(?:r(?:e)?)?)?)?$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
