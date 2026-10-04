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
  const { drafts: bodies, prose: proseText } = splitCoachDrafts(stripThinkBlocks(raw));
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
  const answer: CoachAnswer = { prose, blocks: blocks === null || blocks.length < 2 ? null : blocks.map((block) => ({ kind: block.kind, body: block.body })), drafts };
  return CoachAnswerSchema.safeParse(answer).success ? answer : null;
}

/** The raw answer a finished turn replays as history: the prose and the drafts in their fences again. */
export function coachAnswerText(answer: CoachAnswer): string {
  const drafts = answer.drafts.map((draft) => ['```draft', draft.parts.join('\n[NEXT]\n'), '```'].join('\n'));
  return [answer.prose, ...drafts].filter((piece) => piece.length > 0).join('\n\n');
}

/** The stream as a preview: no reasoning, no fence lines, no Split markers or pieces of them. */
export function coachPreview(text: string): string {
  return withoutMarkers(hideOpenThinkBlock(text))
    .split('\n')
    .filter((line) => !/^```(?:draft)?[ \t]*$/.test(line))
    .join('\n')
    .replace(/\n`{1,3}(?:d(?:r(?:a(?:f(?:t)?)?)?)?)?$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
