// What is automated among the model's messages (docs/project-unite/
// architecture.md §5.8; NF-033, AI-033): the old extension's classifier
// (fansly-chat/src/shared/followers.ts:74-87, greeting-context.ts:73-79),
// carried over for the tab's count of personal messages and for
// `fx.incoming.automated`:
// - a message of the model is automated when its `type` is 2, or it was made
//   by something — a `correlationId` — without being a reply (`inReplyTo`), or
//   its text equals a welcome text of the page's own `GET /message/automated`
//   after whitespace is folded (the owner's rule: the exact text, nothing
//   fuzzier);
// - a message of the fan is always personal; a sign MAIN does not know is no
//   automation (the start proof never counts a message as automated on a
//   guess, §5.8).
// The page asks `/message/automated` at every composer it makes and drops the
// answer (main:55930); MAIN reads it as it passes. Texts edited since stay
// known (the old one kept them too). Neither the welcome texts nor a message's
// text are kept for this: only a 32-bit hash of the folded text — the record
// of a message carries its hash (observation.ts), so the rule holds for
// messages that came before the welcome texts did.

import { isPlain } from '@cg/host-kit/main/check';

import { WELCOME_MAX } from './protocol';

/** The owner's rule (fansly-chat normalizeWelcome): runs of whitespace fold to one space, the ends trimmed. */
export const fold = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/** FNV-1a over the folded text's UTF-16 units; 0 — no text (a folded empty text is no welcome). */
export function textHash(text: string): number {
  const folded = fold(text);
  if (folded === '') return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < folded.length; i += 1) hash = Math.imul(hash ^ folded.charCodeAt(i), 0x01000193);
  return hash >>> 0 || 1;
}

/** The structural half of the rule: `type 2`, or a `correlationId` without `inReplyTo` (fx.incoming had it from P7a). */
export const madeBySomething = (type: number, correlationId: string | null, inReplyTo: string | null): boolean => type === 2 || (correlationId !== null && inReplyTo === null);

export interface Automation {
  /** Reads an answer of `/message/automated`: `[{messageTemplate: JSON string or object with `content`}]`. */
  read(list: readonly unknown[]): void;
  /** The folded text with this hash is a welcome text. */
  welcome(hash: number): boolean;
  size(): number;
}

export function createAutomation(parse: (text: string) => unknown): Automation {
  const hashes = new Set<number>();
  return {
    read(list) {
      for (const item of list) {
        if (!isPlain(item)) continue;
        let template = item['messageTemplate'];
        if (typeof template === 'string') {
          try {
            template = parse(template);
          } catch {
            continue;
          }
        }
        if (!isPlain(template) || typeof template['content'] !== 'string') continue;
        const hash = textHash(template['content']);
        if (hash !== 0 && (hashes.size < WELCOME_MAX || hashes.has(hash))) hashes.add(hash);
      }
    },
    welcome: (hash) => hash !== 0 && hashes.has(hash),
    size: () => hashes.size,
  };
}
