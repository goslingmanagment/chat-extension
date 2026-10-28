// Payment details in a draft (docs/specs/2026-10-27-telegram-site.md §4.4): when the draft under Fix holds a token that
// looks like a wallet, a card, an IBAN, a link or an amount, and Fix's result does not hold the same token character
// for character, the dock warns «Реквизиты изменились, сверьте» before the insert. A warning the chatter passes, never
// a block. What the tab keeps of the draft for that check is the tokens' fingerprints, never their text.

import { digestHex } from '../../ops/digest';

/**
 * The tokens, longest first so a link holding a number is one token: links; crypto addresses (TRON, Ethereum, Bitcoin,
 * any long base58 string); IBANs; card numbers (13–19 digits in groups); amounts with a currency on either side.
 */
const DETAILS: readonly RegExp[] = [
  /\bhttps?:\/\/[^\s<>"«»]+/giu,
  /\b(?:t\.me|telegram\.me|wa\.me)\/[^\s<>"«»]+/giu,
  /\bwww\.[^\s<>"«»]+/giu,
  /\b0x[a-fA-F0-9]{40}\b/gu,
  /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/gu,
  /\b(?:bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/gu,
  /\b[1-9A-HJ-NP-Za-km-z]{32,64}\b/gu,
  /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/gu,
  /\b\d{4}(?:[ -]?\d{4}){2}(?:[ -]?\d{1,7})\b/gu,
  /[$€£₽₴¥]\s?\d[\d.,]*/gu,
  /\b\d[\d.,]*\s?(?:\$|€|£|₽|₴|usdt|usd|eur|rub|руб(?:\.|лей|ля|ль)?|р\.|долл(?:\.|ар(?:ов|а)?)?|бакс(?:ов|а)?|tl|uah|грн)(?=$|[\s.,!?;:)»])/giu,
];

/** The payment-detail tokens of a text, trimmed of trailing punctuation, in the order found, each once. */
export function paymentDetailsOf(text: string): string[] {
  const found: string[] = [];
  let rest = text;
  for (const pattern of DETAILS) {
    for (const match of rest.matchAll(pattern)) {
      const token = match[0].replace(/[.,;:!?)\]]+$/u, '').trim();
      if (token.length >= 2 && !found.includes(token)) found.push(token);
    }
    // A token taken once is not taken again by a looser pattern (a link's digits as an amount).
    rest = rest.replace(pattern, ' ');
  }
  return found;
}

/** Each token's fingerprint: what the tab keeps of the draft with the operation (never the text). */
export function detailPrints(text: string): string[] {
  return paymentDetailsOf(text).map((token) => digestHex(token));
}

/** Whether every token of the draft (`prints`) stands in `result` character for character. */
export function detailsKept(prints: readonly string[], result: string): boolean {
  if (prints.length === 0) return true;
  const kept = new Set(paymentDetailsOf(result).map((token) => digestHex(token)));
  return prints.every((print) => kept.has(print));
}
