// Review answers (architecture.md §7; AI-052, AI-053, AI-054). The hub's
// chat-review prompt answers in a small XML frame — `<rating>` (an integer
// 1–10), `<evaluation>` with the pinned blocks «ВЕРДИКТ / ДЕНЬГИ / ПЕРСОНА /
// ОШИБКИ / ЧТО РАБОТАЕТ», `<recommendations>`. The parse is lenient and for
// display only: a frame that does not read is not an error — the result
// keeps the raw text and `doc: null` («ответ не разобран», shown as is).
// Review is never a message to the fan: no Split, nothing insertable.

import { ReviewDocSchema, type REVIEW_SECTION_KINDS, type ReviewDoc } from '@cg/contracts/ops';

import { splitLabelledSections, splitNumberedItems, type NumberedItem, type SectionSpec } from './sections';

type ReviewSectionKind = (typeof REVIEW_SECTION_KINDS)[number];

/** The block labels as the hub's prompt pins them. */
export const REVIEW_SECTION_LABELS: readonly SectionSpec<ReviewSectionKind>[] = [
  { label: 'ВЕРДИКТ', kind: 'verdict' },
  { label: 'ДЕНЬГИ', kind: 'money' },
  { label: 'ПЕРСОНА', kind: 'persona' },
  { label: 'ОШИБКИ', kind: 'mistakes' },
  { label: 'ЧТО РАБОТАЕТ', kind: 'works' },
];

/** Items the document holds per block (contract); the rest stays readable in the raw text. */
const ITEMS_MAX = 20;

export interface ReviewTags {
  /** 1–10; null — absent or not a bare integer in range («8/10», «7.5»). */
  readonly rating: number | null;
  readonly evaluation: string | null;
  readonly recommendations: string | null;
}

function tagContent(raw: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(raw);
  const inner = match?.[1];
  return inner === undefined ? null : inner.trim();
}

/** AI-052: the three tags, leniently. */
export function reviewTags(raw: string): ReviewTags {
  const ratingText = tagContent(raw, 'rating');
  const parsed = ratingText !== null && /^\d+$/.test(ratingText) ? Number(ratingText) : null;
  return {
    rating: parsed !== null && parsed >= 1 && parsed <= 10 ? parsed : null,
    evaluation: tagContent(raw, 'evaluation'),
    recommendations: tagContent(raw, 'recommendations'),
  };
}

const itemOf = (item: NumberedItem): ReviewDoc['sections'][number]['items'][number] => ({
  body: item.body,
  fix: item.fix,
  fixWhere: item.fixWhere,
  afterFix: item.afterFix,
});

/**
 * The display document, or null when the frame does not read: the rating,
 * the evaluation and the recommendations must all be there (AI-052). An
 * evaluation without the pinned labels is a document with the whole
 * evaluation as its lead and no blocks.
 */
export function parseReviewDoc(raw: string): ReviewDoc | null {
  const tags = reviewTags(raw);
  if (tags.rating === null || tags.evaluation === null || tags.evaluation.length === 0 || tags.recommendations === null || tags.recommendations.length === 0) return null;
  const labelled = splitLabelledSections(tags.evaluation, REVIEW_SECTION_LABELS);
  const seen = new Set<ReviewSectionKind>();
  const sections: ReviewDoc['sections'][number][] = [];
  for (const section of labelled?.sections ?? []) {
    // A label written twice keeps its first block; the raw text has both.
    if (seen.has(section.kind)) continue;
    seen.add(section.kind);
    if (section.kind === 'mistakes') {
      const { lead, items } = splitNumberedItems(section.body, true);
      if (items.length > 0) {
        sections.push({ kind: section.kind, body: lead, items: items.slice(0, ITEMS_MAX).map(itemOf) });
        continue;
      }
    }
    sections.push({ kind: section.kind, body: section.body, items: [] });
  }
  const numbered = splitNumberedItems(tags.recommendations, false);
  const doc: ReviewDoc = {
    rating: tags.rating,
    lead: labelled === null ? tags.evaluation : labelled.lead,
    sections,
    recommendations:
      numbered.items.length > 0
        ? { lead: numbered.lead, items: numbered.items.slice(0, ITEMS_MAX).map(itemOf) }
        : { lead: tags.recommendations, items: [] },
  };
  return ReviewDocSchema.safeParse(doc).success ? doc : null;
}

/**
 * AI-054: what «Копировать» writes — the rating, the evaluation and the
 * recommendations as plain text without the XML frame, the recommendations
 * under their own header («Рекомендации:», as the old client's
 * «Recommendations:»); the raw answer when the frame does not read.
 */
export function reviewCopyText(raw: string, recommendationsHeader: string): string {
  const tags = reviewTags(raw);
  const blocks: string[] = [];
  if (tags.rating !== null) blocks.push(`${tags.rating}/10`);
  if (tags.evaluation !== null && tags.evaluation.length > 0) blocks.push(tags.evaluation);
  if (tags.recommendations !== null && tags.recommendations.length > 0) blocks.push(`${recommendationsHeader}:\n${tags.recommendations}`);
  const formatted = blocks.join('\n\n').trim();
  return formatted.length > 0 ? formatted : raw.trim();
}

/** The stream as a preview: the frame's tags (and a tag cut by the chunk boundary) are not shown. */
export function reviewPreview(text: string): string {
  return text
    .replace(/<rating>[\s\S]*?<\/rating>/gi, '')
    .replace(/<rating>[\s\S]*$/i, '')
    .replace(/<\/?(?:evaluation|recommendations)>/gi, '\n')
    .replace(/<\/?[a-z]*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * An answer whose frame does not read, as shown (AI-052): the frame's tags out as in the preview, and any other bare
 * tag a model wrapped it in («<summary>»); the score stays in its badge. The text itself is not touched.
 */
export function reviewRawText(raw: string): string {
  return reviewPreview(raw)
    .replace(/<\/?[a-z][\w-]{0,30}>/gi, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** How the history's text names the score, the recommendations and an example: the hub's own words, whatever the UI's language. */
const HISTORY_WORDS = { score: 'Оценка', recommendations: 'РЕКОМЕНДАЦИИ', fix: 'Как надо было' } as const;

/** A numbered item as text: its body, then its «Как надо было (…): "…"» and what follows the example. */
function itemText(item: ReviewDoc['sections'][number]['items'][number], index: number): string {
  const lines = [`${index + 1}. ${item.body}`.trimEnd()];
  if (item.fix !== null) lines.push(`${HISTORY_WORDS.fix}${item.fixWhere === null ? '' : ` (${item.fixWhere})`}: "${item.fix}"`);
  if (item.afterFix !== null) lines.push(item.afterFix);
  return lines.join('\n');
}

/** A block as text: «ЛЕЙБЛ: тело», then its numbered items. */
function blockText(label: string, body: string, items: ReviewDoc['sections'][number]['items']): string {
  return [body.length > 0 ? `${label}: ${body}` : `${label}:`, ...items.map(itemText)].join('\n');
}

/**
 * 1.51.0: a Review as Coach's history replays it — the answer of its turn «Review» in `coachHistory` — so a question
 * after it («а как исправить вторую ошибку?») reads it: plain text in the hub's own words, the score, the blocks in
 * their order (each mistake with its «Как надо было»), what worked, the recommendations. A frame that did not read is
 * its text as shown, the score kept. Not bounded here: the history's projection (AI-088) holds it to the hub's bounds.
 */
export function reviewHistoryText(doc: ReviewDoc | null, raw: string): string {
  const blocks: string[] = [];
  const rating = doc?.rating ?? reviewTags(raw).rating;
  if (rating !== null) blocks.push(`${HISTORY_WORDS.score}: ${rating}/10`);
  if (doc === null) {
    const text = reviewRawText(raw);
    if (text.length > 0) blocks.push(text);
    return blocks.join('\n\n');
  }
  // The lead is the text before the first block; a block that repeats it says it once.
  if (doc.lead.length > 0 && !doc.sections.some((section) => section.body === doc.lead)) blocks.push(doc.lead);
  for (const section of doc.sections) blocks.push(blockText(REVIEW_SECTION_LABELS.find((spec) => spec.kind === section.kind)?.label ?? section.kind, section.body, section.items));
  const recommendations = doc.recommendations;
  if (recommendations !== null && (recommendations.lead.length > 0 || recommendations.items.length > 0)) blocks.push(blockText(HISTORY_WORDS.recommendations, recommendations.lead, recommendations.items));
  return blocks.join('\n\n');
}
