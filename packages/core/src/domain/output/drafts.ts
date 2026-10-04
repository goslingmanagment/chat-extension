// Draft answers — Reply, Fix, Ping and Hi (architecture.md §7 «Разбор и
// Split», D-15; AI-011, AI-132, AI-135, AI-136, UI-032, NEW-04). After
// `done` the whole text is split and every part is cleaned: Hi into
// `[VARIANT]` variants, each into `[NEXT]` parts; Reply, Fix and Ping into
// `[NEXT]` parts. Nothing usable left is CG-OUTPUT-UNUSABLE — never a
// silent empty result and never an automatic new paid generation.
//
// A structure the result cannot hold (more parts or variants than the
// contract allows) is not thrown away: the answer comes back as ONE part
// with its markers still in it. That is the «ответ не разобран» result
// (UI-032): it can be read and copied, never inserted. `isUnparsedResult`
// tells it apart — a properly split part never holds a marker.
//
// Split asked for and one part back is a normal result with a notice
// («Получилась одна часть», AI-011): `splitRequested` travels with it.

import { type CgCode } from '@cg/contracts/errors';
import { PART_LIMITS } from '@cg/contracts/limits';
import { type OpResult } from '@cg/contracts/ops';

import { cleanPart, isUsablePart, stripThinkBlocks } from './cleanup';
import { hasSplitMarker, splitByNext, splitByVariant } from './markers';

/** One part of a result (`OpResultSchema` PartsSchema): at most this long. */
export const PART_MAX_CHARS = 20_000;

export type DraftFeature = 'reply' | 'fix' | 'ping' | 'hi';

export type DraftParse =
  | { readonly ok: true; readonly result: Extract<OpResult, { kind: 'parts' | 'variants' }>; readonly unparsed: boolean }
  | { readonly ok: false; readonly code: Extract<CgCode, 'CG-OUTPUT-UNUSABLE'> };

const UNUSABLE: DraftParse = { ok: false, code: 'CG-OUTPUT-UNUSABLE' };

const fits = (part: string): boolean => part.length <= PART_MAX_CHARS;

/** AI-136 + AI-135: `[NEXT]` parts, each cleaned, unusable ones dropped. */
export function parseParts(text: string): string[] {
  return splitByNext(stripThinkBlocks(text)).map(cleanPart).filter(isUsablePart);
}

/** Hi: `[VARIANT]` variants, each split into cleaned parts; empty variants dropped. */
export function parseVariants(text: string): string[][] {
  return splitByVariant(stripThinkBlocks(text))
    .map(parseParts)
    .filter((variant) => variant.length > 0);
}

/** The answer as one unsplit part, for the «ответ не разобран» result; null when even that cannot be shown. */
function rawPart(text: string): string | null {
  const raw = stripThinkBlocks(text).trim();
  return raw.length > 0 && fits(raw) ? raw : null;
}

export function parseDraft(feature: DraftFeature, text: string, splitRequested: boolean): DraftParse {
  if (feature === 'hi') {
    const variants = parseVariants(text);
    if (variants.length === 0) return UNUSABLE;
    const holds = variants.length <= PART_LIMITS.maxVariants && variants.every((parts) => parts.length <= PART_LIMITS.maxParts && parts.every(fits));
    if (holds) return { ok: true, result: { kind: 'variants', variants }, unparsed: false };
    const raw = rawPart(text);
    return raw === null ? UNUSABLE : { ok: true, result: { kind: 'variants', variants: [[raw]] }, unparsed: true };
  }
  const parts = parseParts(text);
  if (parts.length === 0) return UNUSABLE;
  if (parts.length <= PART_LIMITS.maxParts && parts.every(fits)) return { ok: true, result: { kind: 'parts', parts, splitRequested }, unparsed: false };
  const raw = rawPart(text);
  return raw === null ? UNUSABLE : { ok: true, result: { kind: 'parts', parts: [raw], splitRequested }, unparsed: true };
}

/** UI-032: the result is the raw answer in one part (its markers still inside): copy only. */
export function isUnparsedResult(result: OpResult): boolean {
  if (result.kind === 'parts') return result.parts.length === 1 && hasSplitMarker(result.parts[0] ?? '');
  if (result.kind === 'variants') return result.variants.length === 1 && result.variants[0]?.length === 1 && hasSplitMarker(result.variants[0][0] ?? '');
  if (result.kind === 'review') return result.doc === null;
  return false;
}

/** AI-011: Split was on at the start and the answer came back as one message. */
export function isOnePartOfSplit(result: OpResult): boolean {
  return result.kind === 'parts' && result.splitRequested && result.parts.length === 1 && !isUnparsedResult(result);
}
