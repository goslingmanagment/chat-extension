// Recap text (architecture.md §10.1 «Markdown разбирается один раз, по
// готовому результату», AI-069, AI-137). The answer is prepared once, on
// `done`: reasoning removed, line ends normalised. A full Recap is also cut
// into its headed blocks for the two-column sheet («Кто он», «Что любит»…);
// a short one stays one paragraph. Recap is never a message to the fan: no
// Split, no markers, nothing insertable.

import { normalizeNewlines } from '../text';
import { stripThinkBlocks } from './cleanup';

export interface RecapBlock {
  readonly heading: string;
  readonly markdown: string;
}

/** Headings longer than this are sentences, not headings. */
const HEADING_MAX_CHARS = 80;
const BLOCKS_MAX = 24;

/** AI-137: the finished text as it is stored, shown and copied. */
export function recapText(raw: string): string {
  return normalizeNewlines(stripThinkBlocks(raw))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const hasLetters = (text: string): boolean => /\p{L}/u.test(text);
const isUpperCase = (text: string): boolean => hasLetters(text) && text === text.toUpperCase() && text !== text.toLowerCase();

/**
 * A heading line: a Markdown heading, a line that is bold as a whole, or a
 * line of capitals (with an optional «1.» number and a trailing colon), as
 * the hub's fan-summary prompt asks for («clear headers, plain text»).
 */
export function recapHeadingOf(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > HEADING_MAX_CHARS + 8) return null;
  const hash = /^#{1,6}[ \t]+(.+?)[ \t]*#*$/.exec(trimmed);
  const bold = /^(?:\d{1,2}[.)][ \t]+)?(?:\*\*|__)(.+?)(?:\*\*|__):?$/.exec(trimmed);
  const title = (hash?.[1] ?? bold?.[1] ?? null)?.replace(/:$/, '').trim() ?? null;
  if (title !== null) return title.length > 0 && title.length <= HEADING_MAX_CHARS && hasLetters(title) ? title : null;
  const plain = /^(?:\d{1,2}[.)][ \t]+)?(.+?):?$/.exec(trimmed)?.[1]?.trim() ?? '';
  return plain.length >= 3 && plain.length <= HEADING_MAX_CHARS && /^\p{L}/u.test(plain) && isUpperCase(plain) && !/[.!?…]$/.test(plain) ? plain : null;
}

/**
 * The headed blocks of a full Recap, or null when the text has fewer than
 * two headings (it is then shown as one text). Text before the first
 * heading becomes a block without a heading.
 */
export function recapBlocks(markdown: string): RecapBlock[] | null {
  const blocks: { heading: string; lines: string[] }[] = [];
  let headings = 0;
  for (const line of markdown.split('\n')) {
    const heading = recapHeadingOf(line);
    if (heading !== null) {
      headings += 1;
      blocks.push({ heading, lines: [] });
      continue;
    }
    if (blocks.length === 0) blocks.push({ heading: '', lines: [] });
    blocks[blocks.length - 1]?.lines.push(line);
  }
  if (headings < 2) return null;
  const out = blocks
    .map((block) => ({ heading: block.heading, markdown: block.lines.join('\n').trim() }))
    .filter((block) => block.markdown.length > 0);
  return out.length < 2 || out.length > BLOCKS_MAX ? null : out;
}
