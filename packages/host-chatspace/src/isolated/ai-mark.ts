// ChatSpace's own «text from AI» mark, for the X8 queue call's `isAiGenerated`
// (architecture.md §6.7.1 «Флаги»). The rule is the one ChatSpace applies to
// its own AI suggestions (0.172.0, messages:18139-18184, 2623-2640), written
// again here: line breaks and edges normalized; a non-empty exact match
// first (short strings have no bigrams); otherwise Dice's coefficient over
// lowercase bigrams of at least 0,85. The text that goes out is compared
// with the ORIGINAL chosen AI part, kept from before any edit: a small edit
// keeps the mark, a rewrite loses it.
//
// The mark says where the text came from — nothing about `sent`, `edited`,
// freshness or custody, which go by identities, revisions and the receipt.

const THRESHOLD = 0.85;

/** ChatSpace's normalization: runs of line breaks become one, empty lines go, the edges are trimmed. */
const normalize = (text: string): string =>
  text
    .split(/(?:\r?\n)+/)
    .filter((line) => line !== '')
    .join('\n')
    .trim();

/** Dice's coefficient over bigrams, lowercase; 0 when either text is shorter than a bigram. */
export function bigramSimilarity(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const remaining = counts.get(gram) ?? 0;
    if (remaining > 0) {
      counts.set(gram, remaining - 1);
      shared += 1;
    }
  }
  return (shared * 2) / (a.length + b.length - 2);
}

/** Whether `sentText` still counts as the AI's `originalPart` by ChatSpace's rule. */
export function aiGeneratedMark(sentText: string, originalPart: string): boolean {
  const original = normalize(originalPart);
  const sent = normalize(sentText);
  return sent !== '' && original !== '' && (sent === original || bigramSimilarity(original, sent) >= THRESHOLD);
}
