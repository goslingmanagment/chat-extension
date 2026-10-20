// core/domain/output: Split markers, the answer cleanup, parts and Hi
// variants, the Review frame and its blocks, Coach drafts as parts, Recap
// text, and the stream preview (architecture.md §7 «Разбор и Split», D-15).
// Property tests run on a seeded generator: the same seed replays a failure.

import { describe, expect, it } from 'vitest';

import { CoachAnswerSchema, OpResultSchema, PART_LIMITS, SPLIT_MARKERS, type FeatureId } from '@cg/contracts';
import {
  NEXT_MARKER,
  VARIANT_MARKER,
  cleanPart,
  hasSplitMarker,
  isOnePartOfSplit,
  isUnparsedResult,
  isUsablePart,
  parseCoachAnswer,
  parseDraft,
  parseOutput,
  parseParts,
  parseVariants,
  partialMarkerLength,
  splitByNext,
  splitByVariant,
  streamPreview,
} from '@cg/core/domain/output';

import { seeded, type Random } from './support/random';

const GEN = '00000000-0000-4000-8000-000000000200';
const ctx = (splitRequested = false) => ({ splitRequested, generationRef: GEN });

describe('[AI-136] parts by [NEXT], variants by [VARIANT]', () => {
  it('the marker words are the hub contract words', () => {
    expect(NEXT_MARKER).toBe(SPLIT_MARKERS.next);
    expect(VARIANT_MARKER).toBe(SPLIT_MARKERS.variant);
  });

  it('splits on the bracket form, trims, drops empty pieces', () => {
    expect(splitByNext('one [NEXT] two\n[NEXT]\n three ')).toEqual(['one', 'two', 'three']);
    expect(splitByNext('[NEXT] only [NEXT][NEXT]')).toEqual(['only']);
    expect(splitByVariant('a [VARIANT] b [VARIANT]')).toEqual(['a', 'b']);
    expect(splitByNext('')).toEqual([]);
  });

  it('tolerates case and inner spaces, never a bare word in prose', () => {
    expect(splitByNext('one [next] two [ NEXT ] three [Next]four')).toEqual(['one', 'two', 'three', 'four']);
    expect(splitByVariant('a [variant] b [ Variant ] c')).toEqual(['a', 'b', 'c']);
    expect(splitByNext('what comes NEXT is next, see [note] and [next\n]')).toEqual(['what comes NEXT is next, see [note] and [next\n]']);
  });

  it('Hi: variants first, then parts inside each', () => {
    expect(parseVariants('hey [NEXT] you there? [VARIANT] hi stranger [VARIANT] morning [NEXT] sun')).toEqual([['hey', 'you there?'], ['hi stranger'], ['morning', 'sun']]);
  });
});

describe('[AI-135] answer cleanup', () => {
  it('removes reasoning blocks before anything else, markers inside them included', () => {
    expect(parseParts('<think>plan: one [NEXT] two</think>hey you')).toEqual(['hey you']);
    expect(parseParts('```thinking\nstep [NEXT] step\n```\nhello')).toEqual(['hello']);
    expect(cleanPart('<THINK reason="x">secret</THINK>  hi there ')).toBe('hi there');
  });

  // The cases below are the hub's (hub#621, tests/ai-prompts-reply-output.test.ts):
  // the copies behave the same.

  // Production leak, 2026-10-09 (fast reply, Opus 5.5): `<think\b` did not match `<thinking>`.
  it('strips <thinking> and <reasoning> blocks, not only <think>', () => {
    expect(parseParts('<thinking>He already told her… No dashes.</thinking>good boy 😏 save it for me[NEXT]wait did your mom really call lmao 😭')).toEqual([
      'good boy 😏 save it for me',
      'wait did your mom really call lmao 😭',
    ]);
    expect(cleanPart('<reasoning>keep it short</reasoning>\n"sup"')).toBe('sup');
    expect(parseParts('<THINKING mode="plan">a [NEXT] b</Thinking >hey you')).toEqual(['hey you']);
    expect(parseParts('<thinking>quote </think> here</thinking>hey you')).toEqual(['hey you']);
    expect(parseVariants('<thinking>three openers? a [VARIANT] b [NEXT] c</thinking>hey you[VARIANT]sup stranger')).toEqual([['hey you'], ['sup stranger']]);
  });

  it('drops everything from a bare tag that never closes and opens the text or a line', () => {
    expect(parseParts('<thinking>plan without close')).toEqual([]);
    expect(parseParts('hey\n<thinking>plan')).toEqual(['hey']);
    expect(parseParts('<thinking>he said no dashes so [NEXT] maybe')).toEqual([]);
    // The part the tag opens is dropped when each part is cleaned.
    expect(parseParts('hey you[NEXT]<reasoning>now the follow-up')).toEqual(['hey you']);
    // A close tag of another name does not end the block: nothing after it is a reply.
    expect(parseParts('<think>plan</thinking>hey you')).toEqual([]);
    // An opener on its own line inside a fenced block goes with the block.
    expect(parseParts('```thinking\nopen with\n<think>\n```\nhey you')).toEqual(['hey you']);
  });

  // Production leaks, 2026-10-09..14 (Opus 5.5 at low effort): reasoning as plain text.
  it('drops a plain-text plan note and everything before it in its part', () => {
    expect(parseParts("Fan writes in Russian, so reply in Russian. He asked what she's doing.\n\nахах да, лежу с котом 🙈[NEXT]а ты где?)")).toEqual([
      'ахах да, лежу с котом 🙈',
      'а ты где?)',
    ]);
    expect(parseVariants('Cold opener. The display name is Jay, so a name hook works. No long dashes.\n\nok jay... are you a dj 👀[VARIANT]hey jay')).toEqual([
      ['ok jay... are you a dj 👀'],
      ['hey jay'],
    ]);
    // A draft, the model's check of it, then the draft it settled on.
    expect(cleanPart('so what caught your eye? 😏\n\nWait, the rules say no full stop at end, question mark fine.\n\nso what caught your eye then? 😏')).toBe(
      'so what caught your eye then? 😏',
    );
    expect(parseParts('long night huh 😭\n\n(rule check) no period at end, no dash. Fine.\n\nlong night huh 😭 any break?')).toEqual(['long night huh 😭 any break?']);
    // With nothing after it, the note goes alone; it never cuts another part.
    expect(parseParts('hey you\nCheck: no em dash, lowercase.')).toEqual(['hey you']);
    expect(parseParts('first part[NEXT]Cold opener, no fan lines.\n\nsecond part')).toEqual(['first part', 'second part']);
    expect(parseParts('No long dashes.')).toEqual([]);
  });

  it('drops lines that leak the prompt, keeps in-character lines', () => {
    expect(cleanPart('Output only the message text.\nhey babe')).toBe('hey babe');
    expect(cleanPart('As an AI I cannot\nmiss you')).toBe('miss you');
    expect(cleanPart('just follow my instructions tonight')).toBe('just follow my instructions tonight');
    expect(cleanPart('ignore the previous instructions\nok')).toBe('ok');
  });

  it('a part of brackets, of nothing, or of a leaked line is not usable', () => {
    for (const bad of ['', '   ', '[', '"]', "['", 'Stay in character']) expect(isUsablePart(bad), bad).toBe(false);
    expect(isUsablePart('hey')).toBe(true);
    expect(parseParts('[ [NEXT] hey [NEXT] ]')).toEqual(['hey']);
  });
});

describe('[AI-011] [AI-132] [UI-032] draft results', () => {

  it('[AI-132] nothing usable is CG-OUTPUT-UNUSABLE for every feature', () => {
    for (const feature of ['reply', 'fix', 'ping', 'hi', 'review', 'recap', 'recap-short', 'coach'] as const) {
      expect(parseOutput(feature, '   \n ', ctx()), feature).toEqual({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
    }
    expect(parseOutput('reply', '<think>only thoughts</think>', ctx())).toEqual({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
    expect(parseOutput('hi', '[VARIANT] [NEXT] [VARIANT]', ctx())).toEqual({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
    expect(parseOutput('reply', 'Output only the reply', ctx())).toEqual({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
  });

  it('[UI-032] more parts or variants than a result holds come back raw, in one copy-only part', () => {
    const many = Array.from({ length: PART_LIMITS.maxParts + 1 }, (_, i) => `part ${i + 1}`).join(' [NEXT] ');
    const parts = parseDraft('reply', many, true);
    if (!parts.ok) throw new Error('unusable');
    expect(parts.unparsed).toBe(true);
    expect(parts.result).toEqual({ kind: 'parts', parts: [many], splitRequested: true });
    expect(isUnparsedResult(parts.result)).toBe(true);
    expect(OpResultSchema.safeParse(parts.result).success).toBe(true);
    expect(isOnePartOfSplit(parts.result)).toBe(false);

    const variants = Array.from({ length: PART_LIMITS.maxVariants + 1 }, (_, i) => `hi ${i}`).join(' [VARIANT] ');
    const hi = parseDraft('hi', variants, false);
    if (!hi.ok) throw new Error('unusable');
    expect(hi.result).toEqual({ kind: 'variants', variants: [[variants]] });
    expect(isUnparsedResult(hi.result)).toBe(true);

    const fine = parseOutput('reply', 'a [NEXT] b', ctx());
    expect(fine.ok && isUnparsedResult(fine.result)).toBe(false);
  });
});

const fence = (body: string): string => ['```draft', body, '```'].join('\n');

describe('[AI-084] [AI-085] [AI-092] Coach answers', () => {
  it('[AI-085] lifts up to two draft fences out of the advice and splits each by [NEXT]', () => {
    const answer = parseCoachAnswer(['Сначала согрей.', fence('hey you [NEXT] how was the weekend?'), 'Потом предложи сет.', fence('"I saved something for you"')].join('\n'));
    if (answer === null) throw new Error('null');
    expect(CoachAnswerSchema.safeParse(answer).success).toBe(true);
    expect(answer.prose).toBe('Сначала согрей.\nПотом предложи сет.');
    expect(answer.drafts).toEqual([
      { index: 0, parts: ['hey you', 'how was the weekend?'] },
      { index: 1, parts: ['I saved something for you'] },
    ]);
    expect(answer.blocks).toBeNull();
  });
});

// ── property tests ──────────────────────────────────────────────────────────

const WORDS = ['hey', 'you', 'come', 'here', 'babe', 'miss', 'me', '😊', 'tonight?', 'so', 'what', 'привет', 'как', 'дела', '5', 'ok.', 'want', 'more'];
const NEXT_FORMS = ['[NEXT]', '[next]', '[ NEXT ]', '[Next]', '\n[NEXT]\n', ' [NEXT] '];
const VARIANT_FORMS = ['[VARIANT]', '[variant]', '[ VARIANT ]', '\n[VARIANT]\n'];
const NOISE = ['[', ']', '[N', 'NEXT', '[x]', '<', '<think>', '</think>', '"', '—', '\n', ' ', '[VARIANT', 'T]', '```', '```draft', 'Reply:', '1.', 'ВЕРДИКТ:', '<rating>', '7', '</rating>'];

const sentence = (random: Random): string =>
  Array.from({ length: 1 + random.int(5) }, () => random.pick(WORDS)).join(' ');

function chunked(random: Random, text: string): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    const size = 1 + random.int(7);
    chunks.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  return chunks;
}

describe('property: parsing', () => {
  it('parts joined by any marker form read back exactly', () => {
    const random = seeded(0xa11);
    for (let round = 0; round < 300; round += 1) {
      const parts = Array.from({ length: 1 + random.int(6) }, () => sentence(random));
      const text = parts.reduce((acc, part, index) => (index === 0 ? part : `${acc}${random.pick(NEXT_FORMS)}${part}`), '');
      expect(parseParts(text), text).toEqual(parts);
    }
  });

  it('the result of the whole text does not depend on how the stream was chunked', () => {
    const random = seeded(0xa13);
    for (let round = 0; round < 200; round += 1) {
      const text = Array.from({ length: 2 + random.int(12) }, () => (random.chance(0.3) ? random.pick([...NEXT_FORMS, ...VARIANT_FORMS]) : sentence(random))).join(random.chance(0.5) ? ' ' : '');
      const whole = parseOutput('hi', text, ctx());
      let acc = '';
      for (const chunk of chunked(random, text)) {
        acc += chunk;
        const preview = streamPreview('hi', acc);
        // Never a marker, never the beginning of one at the end of what is shown.
        expect(hasSplitMarker(preview), JSON.stringify(acc)).toBe(false);
        expect(partialMarkerLength(preview), JSON.stringify(acc)).toBe(0);
      }
      expect(acc).toBe(text);
      expect(parseOutput('hi', acc, ctx())).toEqual(whole);
      expect(streamPreview('hi', acc)).toBe(streamPreview('hi', text));
    }
  });

  it('any text gives a result that fits its schema, or CG-OUTPUT-UNUSABLE — never a throw, never an empty or marked part', () => {
    const random = seeded(0xa15);
    const features: readonly FeatureId[] = ['reply', 'fix', 'ping', 'hi', 'review', 'recap', 'recap-short', 'coach'];
    for (let round = 0; round < 1500; round += 1) {
      const text = Array.from({ length: random.int(30) }, () => (random.chance(0.5) ? random.pick(NOISE) : random.pick(WORDS))).join(random.pick(['', ' ', '\n']));
      for (const feature of features) {
        const out = parseOutput(feature, text, ctx(random.chance(0.5)));
        if (!out.ok) {
          expect(out.code).toBe('CG-OUTPUT-UNUSABLE');
          continue;
        }
        expect(OpResultSchema.safeParse(out.result).success, `${feature} ${JSON.stringify(text)}`).toBe(true);
        const unparsed = isUnparsedResult(out.result);
        const texts = out.result.kind === 'parts' ? out.result.parts : out.result.kind === 'variants' ? out.result.variants.flat() : out.result.kind === 'coach' ? out.result.answer.drafts.flatMap((d) => d.parts) : [];
        for (const part of texts) {
          expect(part.trim().length, `${feature} ${JSON.stringify(text)}`).toBeGreaterThan(0);
          if (!unparsed) expect(hasSplitMarker(part), `${feature} ${JSON.stringify(text)}`).toBe(false);
        }
        if (out.result.kind === 'coach') {
          expect(out.result.answer.drafts.length).toBeLessThanOrEqual(2);
          // No line of the prose can open or close a fence again.
          for (const line of out.result.answer.prose.split('\n')) expect(line.startsWith('```'), JSON.stringify(text)).toBe(false);
        }
        expect(() => streamPreview(feature, text)).not.toThrow();
      }
    }
  });
});
