// Split markers inside generated text (architecture.md §7 «Разбор и Split»,
// D-15, AI-136, NEW-04): `[VARIANT]` separates Hi variants, `[NEXT]`
// separates the parts of one message. There is no Split frame: the markers
// travel inside `content_delta` text and may be cut anywhere by a chunk
// boundary, so the answer is split only on the whole text after `done`, and
// the stream preview never shows a marker or a piece of one.
//
// Bracket forms only, tolerant of case and inner spaces (`[next]`,
// `[ NEXT ]`): a literal split glued such parts back into one message in
// real model output. A bare «NEXT» in prose never splits.

/** The hub's words (contracts `SPLIT_MARKERS`; pinned equal by a test). */
export const NEXT_MARKER = '[NEXT]';
export const VARIANT_MARKER = '[VARIANT]';

const NEXT_SOURCE = String.raw`\[[^\S\n]*next[^\S\n]*\]`;
const VARIANT_SOURCE = String.raw`\[[^\S\n]*variant[^\S\n]*\]`;
const ANY_MARKER = new RegExp(`${NEXT_SOURCE}|${VARIANT_SOURCE}`, 'i');
/** A marker with the blank space around it, for the preview. */
const ANY_MARKER_SPACED = new RegExp(String.raw`\s*(?:${NEXT_SOURCE}|${VARIANT_SOURCE})\s*`, 'gi');
/** The start of a marker cut by a chunk boundary: `[`, `[NE`, `[ var`, `[next ` at the very end. */
const PARTIAL_MARKER_TAIL = /\[[^\S\n]*(?:n(?:e(?:x(?:t[^\S\n]*)?)?)?|v(?:a(?:r(?:i(?:a(?:n(?:t[^\S\n]*)?)?)?)?)?)?)?$/i;

function pieces(text: string, source: string): string[] {
  return text
    .split(new RegExp(source, 'i'))
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

/** `[NEXT]` parts, trimmed, empty ones dropped. */
export function splitByNext(text: string): string[] {
  return pieces(text, NEXT_SOURCE);
}

/** `[VARIANT]` variants, trimmed, empty ones dropped. */
export function splitByVariant(text: string): string[] {
  return pieces(text, VARIANT_SOURCE);
}

/** Whether a text still carries a marker (a properly split part never does). */
export function hasSplitMarker(text: string): boolean {
  return ANY_MARKER.test(text);
}

/** How many characters at the end may be the beginning of a marker cut by the chunk boundary. */
export function partialMarkerLength(text: string): number {
  const match = PARTIAL_MARKER_TAIL.exec(text);
  return match === null ? 0 : match[0].length;
}

/**
 * The stream text as a preview: whole markers become paragraph breaks, the
 * possible beginning of a marker at the very end is held back until the
 * next chunk shows what it is. The same text in any chunking gives the same
 * preview once it is whole.
 */
export function withoutMarkers(text: string): string {
  const held = partialMarkerLength(text);
  const visible = held === 0 ? text : text.slice(0, text.length - held);
  return visible.replace(ANY_MARKER_SPACED, '\n\n');
}
