// core/domain/output: Split markers, the answer cleanup, parts and Hi
// variants, the Review frame and its blocks, Coach drafts as parts, Recap
// text, and the stream preview (architecture.md §7 «Разбор и Split», D-15).
// Property tests run on a seeded generator: the same seed replays a failure.

import { describe, expect, it } from 'vitest';

import { CoachAnswerSchema, OpResultSchema, PART_LIMITS, ReviewDocSchema, SPLIT_MARKERS, type FeatureId } from '@cg/contracts';
import {
  NEXT_MARKER,
  VARIANT_MARKER,
  cleanPart,
  coachAnswerText,
  coachPreview,
  hasSplitMarker,
  hideOpenThinkBlock,
  isOnePartOfSplit,
  isUnparsedResult,
  isUsablePart,
  parseCoachAnswer,
  parseDraft,
  parseOutput,
  parseParts,
  parseReviewDoc,
  parseVariants,
  partialMarkerLength,
  recapBlocks,
  recapHeadingOf,
  recapText,
  reviewCopyText,
  reviewPreview,
  reviewTags,
  splitByNext,
  splitByVariant,
  splitCoachDrafts,
  streamPreview,
  withoutMarkers,
} from '@cg/core/domain/output';
import { SSE_SCENARIOS, parseResult } from '@cg/testing/hub';

import { seeded, type Random } from './support/random';

const GEN = '00000000-0000-4000-8000-000000000200';
const ctx = (splitRequested = false) => ({ splitRequested, generationRef: GEN });

const partsOf = (feature: FeatureId, text: string, split = false): string[] => {
  const out = parseOutput(feature, text, ctx(split));
  if (!out.ok || out.result.kind !== 'parts') throw new Error(`not parts: ${JSON.stringify(out)}`);
  return out.result.parts;
};

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

  it('agrees with the fake hub reference reading on every stream scenario that ends with done', () => {
    for (const scenario of SSE_SCENARIOS) {
      const last = scenario.responses[scenario.responses.length - 1];
      if (last === undefined || last.kind !== 'stream') continue;
      const frames = last.steps.flatMap((step) => (step.kind === 'frame' ? [step.frame] : []));
      if (!frames.some((frame) => frame.type === 'done')) continue;
      const text = frames.flatMap((frame) => (frame.type === 'content_delta' ? [frame.text] : [])).join('');
      if (text.length === 0) continue;
      const hubFeature = scenario.request.feature;
      if (hubFeature === 'hi-greeting') expect(parseVariants(text), scenario.name).toEqual(parseResult(hubFeature, text));
      else if (hubFeature === 'fast-reply' || hubFeature === 'improve-draft' || hubFeature === 'ping') expect([parseParts(text)], scenario.name).toEqual(parseResult(hubFeature, text));
    }
  });

  it('a marker cut by the chunk boundary still splits: the split runs on the whole text', () => {
    const scenario = SSE_SCENARIOS.find((s) => s.name === 'reply-split-across-chunks');
    if (scenario === undefined) throw new Error('scenario');
    const response = scenario.responses[0];
    if (response === undefined || response.kind !== 'stream') throw new Error('stream');
    const chunks = response.steps.flatMap((step) => (step.kind === 'frame' && step.frame.type === 'content_delta' ? [step.frame.text] : []));
    expect(chunks.some((chunk) => /\[N?E?X?$/.test(chunk) || /^N?E?X?T?\]/.test(chunk))).toBe(true);
    const parts = partsOf('reply', chunks.join(''), true);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(hasSplitMarker(part)).toBe(false);
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

  it('keeps replies that only mention thinking or quote a reasoning tag', () => {
    expect(parseParts("can't stop thinking about you <3")).toEqual(["can't stop thinking about you <3"]);
    expect(parseParts('i think so[NEXT]<thinkpad> lol')).toEqual(['i think so', '<thinkpad> lol']);
    expect(parseParts('omg <thinking of you> all day[NEXT]come here')).toEqual(['omg <thinking of you> all day', 'come here']);
    expect(parseParts('what does `<think>` mean lol')).toEqual(['what does `<think>` mean lol']);
    expect(parseParts('<think-tank> lol')).toEqual(['<think-tank> lol']);
  });

  // Production leaks, 2026-10-10..11 (fast reply, Opus 5.5 at low effort).
  it('strips <thinking_mode> and <mental_model> blocks', () => {
    expect(
      parseParts("<thinking_mode>\nThe fan joked about being a gentleman. Keep it short, no em dashes.\n</thinking_mode>\n\nhaha such a gentleman 😏 i'm holding you to that"),
    ).toEqual(["haha such a gentleman 😏 i'm holding you to that"]);
    expect(parseParts('<mental_model>\nHe asks what would excite her. A trip fits.\n</mental_model>\n\nhonestly a random trip to japan 😌[NEXT]what about you?')).toEqual([
      'honestly a random trip to japan 😌',
      'what about you?',
    ]);
    expect(parseParts('<Reasoning_Trace step="1">a [NEXT] b</reasoning_trace>hey you')).toEqual(['hey you']);
    expect(parseParts('<thinking_mode>never closed\nso no reply')).toEqual([]);
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

  it('keeps replies that mention dashes, display names, fans or thinking in passing', () => {
    for (const reply of [
      'no dash cam?? lol\n\nok tell me everything',
      'your display name is giving superhero lol\n\nso what are you up to',
      'haha ur in the fan club for everything 😂\n\na fan wrote me a poem once',
      'thinking of me while busy is the bare minimum 😂\n\nwhen are you back',
    ]) {
      expect(parseParts(reply)).toEqual([reply]);
    }
  });

  it('drops lines that leak the prompt, keeps in-character lines', () => {
    expect(cleanPart('Output only the message text.\nhey babe')).toBe('hey babe');
    expect(cleanPart('As an AI I cannot\nmiss you')).toBe('miss you');
    expect(cleanPart('just follow my instructions tonight')).toBe('just follow my instructions tonight');
    expect(cleanPart('ignore the previous instructions\nok')).toBe('ok');
  });

  it('strips a reply prefix and wrapping quotes', () => {
    expect(cleanPart('Reply: hey you')).toBe('hey you');
    expect(cleanPart("Here's a reply: hey you")).toBe('hey you');
    expect(cleanPart('Message 2 - come here')).toBe('come here');
    expect(cleanPart('"hey you"')).toBe('hey you');
    expect(cleanPart('\u201c\u2018hey you\u2019\u201d')).toBe('hey you');
    expect(cleanPart('she said "hi" to me')).toBe('she said "hi" to me');
  });

  it('turns long dashes into commas, ranges into hyphens, and keeps line breaks', () => {
    expect(cleanPart('ok — come here')).toBe('ok, come here');
    expect(cleanPart('5–10 minutes')).toBe('5-10 minutes');
    expect(cleanPart('first line —\nsecond line')).toBe('first line,\nsecond line');
    expect(cleanPart('— hey')).toBe('hey');
  });

  it('a part of brackets, of nothing, or of a leaked line is not usable', () => {
    for (const bad of ['', '   ', '[', '"]', "['", 'Stay in character']) expect(isUsablePart(bad), bad).toBe(false);
    expect(isUsablePart('hey')).toBe(true);
    expect(parseParts('[ [NEXT] hey [NEXT] ]')).toEqual(['hey']);
  });
});

describe('[AI-011] [AI-132] [UI-032] draft results', () => {
  it('Reply, Fix and Ping come as parts with the Split snapshot of the start', () => {
    for (const feature of ['reply', 'fix', 'ping'] as const) {
      const out = parseOutput(feature, 'one [NEXT] two', ctx(true));
      expect(out).toEqual({ ok: true, result: { kind: 'parts', parts: ['one', 'two'], splitRequested: true } });
    }
  });

  it('[AI-011] Split asked and one part back is a result with a notice, never a failure or a new request', () => {
    const out = parseOutput('reply', 'just one message', ctx(true));
    if (!out.ok) throw new Error('unusable');
    expect(out.result).toEqual({ kind: 'parts', parts: ['just one message'], splitRequested: true });
    expect(isOnePartOfSplit(out.result)).toBe(true);
    const single = parseOutput('reply', 'just one message', ctx(false));
    expect(single.ok && isOnePartOfSplit(single.result)).toBe(false);
    const three = parseOutput('reply', 'a [NEXT] b [NEXT] c', ctx(true));
    expect(three.ok && isOnePartOfSplit(three.result)).toBe(false);
  });

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

  it('a text too long to hold even raw is unusable', () => {
    const huge = Array.from({ length: PART_LIMITS.maxParts + 1 }, () => 'x'.repeat(2500)).join(' [NEXT] ');
    expect(parseDraft('reply', huge, true)).toEqual({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
  });

  it('[NEW-04] Recap and Review are never split: markers in them are text', () => {
    const recap = parseOutput('recap', 'КТО ОН\nfan [NEXT] text', ctx(true));
    expect(recap.ok && recap.result.kind === 'recap' && recap.result.markdown).toBe('КТО ОН\nfan [NEXT] text');
    const review = parseOutput('review', 'no frame [NEXT] here', ctx(true));
    expect(review.ok && review.result.kind === 'review' && review.result.raw).toBe('no frame [NEXT] here');
  });

  it('a recap without the generation ref is not a shared artifact', () => {
    expect(parseOutput('recap', 'text', { splitRequested: false, generationRef: null })).toEqual({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
    const out = parseOutput('recap-short', 'text', ctx());
    expect(out).toEqual({ ok: true, result: { kind: 'recap', markdown: 'text', coverage: null, shared: { generationRef: GEN } } });
  });
});

const REVIEW = `<rating>7</rating>

<evaluation>
Коротко о диалоге.
ВЕРДИКТ: Диалог тёплый, но апселл пришёл рано.
ДЕНЬГИ: Сет за $30 куплен после чаевых; ещё один оффер упущен.
ПЕРСОНА: Голос держится.
ОШИБКИ:
1. Оффер сразу после чаевых: "want more?" — давит. Как надо было (после "[Photo]"): "missed you today, want to see what I saved?" Это мягче.
2) Нет вопроса о выходных. Как надо было: tell me about your weekend first
ЧТО РАБОТАЕТ: Короткие тёплые сообщения.
</evaluation>

<recommendations>
Общий совет.
1. Вместо оффера в лоб делай разогрев.
2. Спрашивай про день.
</recommendations>`;

describe('[AI-052] [AI-053] [AI-054] Review', () => {
  it('[AI-052] reads the three tags leniently; the rating is a bare integer 1–10', () => {
    expect(reviewTags(REVIEW).rating).toBe(7);
    expect(reviewTags('<RATING> 10 </RATING>').rating).toBe(10);
    for (const bad of ['8/10', '7.5', '0', '11', '-3', 'seven']) expect(reviewTags(`<rating>${bad}</rating>`).rating, bad).toBeNull();
    expect(reviewTags('no tags').evaluation).toBeNull();
  });

  it('[AI-053] blocks «Вердикт / Деньги / Персона / Ошибки / Что работает» with «Как надо было», then recommendations', () => {
    const doc = parseReviewDoc(REVIEW);
    if (doc === null) throw new Error('no doc');
    expect(ReviewDocSchema.safeParse(doc).success).toBe(true);
    expect(doc.rating).toBe(7);
    expect(doc.lead).toBe('Коротко о диалоге.');
    expect(doc.sections.map((section) => section.kind)).toEqual(['verdict', 'money', 'persona', 'mistakes', 'works']);
    expect(doc.sections[0]?.body).toBe('Диалог тёплый, но апселл пришёл рано.');
    const mistakes = doc.sections[3];
    expect(mistakes?.items).toEqual([
      { body: 'Оффер сразу после чаевых: "want more?" — давит.', fix: 'missed you today, want to see what I saved?', fixWhere: 'после "[Photo]"', afterFix: 'Это мягче.' },
      { body: 'Нет вопроса о выходных.', fix: 'tell me about your weekend first', fixWhere: null, afterFix: null },
    ]);
    expect(doc.recommendations).toEqual({
      lead: 'Общий совет.',
      items: [
        { body: 'Вместо оффера в лоб делай разогрев.', fix: null, fixWhere: null, afterFix: null },
        { body: 'Спрашивай про день.', fix: null, fixWhere: null, afterFix: null },
      ],
    });
  });

  it('[AI-052] a frame that does not read is the raw text, not an error', () => {
    for (const raw of ['plain words', '<rating>7</rating><evaluation>x</evaluation>', '<rating>12</rating><evaluation>x</evaluation><recommendations>y</recommendations>']) {
      expect(parseReviewDoc(raw), raw).toBeNull();
      const out = parseOutput('review', raw, ctx());
      expect(out).toEqual({ ok: true, result: { kind: 'review', doc: null, raw } });
      expect(out.ok && isUnparsedResult(out.result)).toBe(true);
    }
  });

  it('an evaluation without the pinned labels is a document with a lead and no blocks', () => {
    const doc = parseReviewDoc('<rating>5</rating><evaluation>Свободный текст. РИСК: один раз.</evaluation><recommendations>Совет без номеров.</recommendations>');
    expect(doc).toEqual({ rating: 5, lead: 'Свободный текст. РИСК: один раз.', sections: [], recommendations: { lead: 'Совет без номеров.', items: [] } });
  });

  it('a repeated label keeps its first block', () => {
    const doc = parseReviewDoc('<rating>5</rating><evaluation>ВЕРДИКТ: a\nДЕНЬГИ: b\nВЕРДИКТ: c</evaluation><recommendations>r</recommendations>');
    expect(doc?.sections).toEqual([
      { kind: 'verdict', body: 'a', items: [] },
      { kind: 'money', body: 'b', items: [] },
    ]);
  });

  it('[AI-054] Copy writes the formatted text without the frame; raw when there is no frame', () => {
    const copy = reviewCopyText(REVIEW);
    expect(copy.startsWith('7/10\n\nКоротко о диалоге.')).toBe(true);
    expect(copy).not.toMatch(/<\/?(rating|evaluation|recommendations)>/);
    expect(copy).toContain('Общий совет.');
    expect(reviewCopyText('  plain words ')).toBe('plain words');
  });

  it('the preview hides the frame and a tag cut by the chunk boundary', () => {
    expect(reviewPreview('<rating>7</rating>\n<evaluation>\nВЕРДИКТ: ок')).toBe('ВЕРДИКТ: ок');
    expect(reviewPreview('<rating>7</ra')).toBe('');
    expect(reviewPreview('<rating>7</rating><evaluation>text</evalua')).toBe('text');
    expect(reviewPreview('<rating>7</rating><evaluation>a</evaluation><recommendations>b')).toBe('a\n\nb');
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

  it('[AI-085] a third draft, an oversized one and an unclosed one stay in the prose, neutralised', () => {
    const third = splitCoachDrafts([fence('one'), fence('two'), fence('three')].join('\n'));
    expect(third.drafts).toEqual(['one', 'two']);
    expect(third.prose).toBe('\\```draft\nthree\n\\```');

    const oversized = splitCoachDrafts(fence('x'.repeat(1501)));
    expect(oversized.drafts).toEqual([]);
    expect(oversized.prose.startsWith('\\```draft')).toBe(true);

    const emoji = splitCoachDrafts(fence('😊'.repeat(800)));
    expect(emoji.drafts.length).toBe(1);

    const unclosed = splitCoachDrafts('advice\n```draft\nhey');
    expect(unclosed).toEqual({ drafts: [], prose: 'advice\n\\```draft\nhey' });

    const nested = splitCoachDrafts('```draft\nfirst without a closer\n```draft\nsecond\n```');
    expect(nested.drafts).toEqual(['second']);
    expect(nested.prose).toBe('\\```draft\nfirst without a closer');

    expect(splitCoachDrafts(fence('  \n ')).drafts).toEqual([]);
    expect(splitCoachDrafts('text ```draft inline``` stays').drafts).toEqual([]);
  });

  it('a draft the result cannot hold (an emoji-dense one) stays advice the person can read', () => {
    const answer = parseCoachAnswer(['Совет.', fence('😊'.repeat(800))].join('\n'));
    expect(answer?.drafts).toEqual([]);
    expect(answer?.prose.startsWith('Совет.\n\n😊')).toBe(true);
  });

  it('[AI-084] pinned labels come as blocks «Ситуация / Что упущено / Следующий ход / Риск»', () => {
    const answer = parseCoachAnswer('СИТУАЦИЯ: фан остыл.\nЧТО УПУЩЕНО: вопрос про отпуск.\nСЛЕДУЮЩИЙ ХОД: спросить.\nРИСК: уйдёт.');
    expect(answer?.blocks).toEqual([
      { kind: 'situation', body: 'фан остыл.' },
      { kind: 'missed', body: 'вопрос про отпуск.' },
      { kind: 'move', body: 'спросить.' },
      { kind: 'risk', body: 'уйдёт.' },
    ]);
    expect(parseCoachAnswer('Один РИСК: в прозе не меняет вид.')?.blocks).toBeNull();
  });

  it('[AI-092] an answer with neither advice nor a draft is not saved', () => {
    expect(parseCoachAnswer('<think>hm</think>')).toBeNull();
    expect(parseCoachAnswer(fence('  '))).toBeNull();
    expect(parseOutput('coach', fence(' '), ctx())).toEqual({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
  });

  it('the history text of an answer reads back to the same answer', () => {
    const answer = parseCoachAnswer(['Совет.', fence('one [NEXT] two')].join('\n'));
    if (answer === null) throw new Error('null');
    expect(parseCoachAnswer(coachAnswerText(answer))).toEqual(answer);
  });

  it('the preview shows neither fences nor markers nor their pieces', () => {
    expect(coachPreview('Совет.\n```draft\nhey [NEXT] you\n```\nещё')).toBe('Совет.\nhey\n\nyou\nещё');
    expect(coachPreview('Совет.\n``')).toBe('Совет.');
    expect(coachPreview('Совет.\n```dra')).toBe('Совет.');
    expect(coachPreview('hey [NE')).toBe('hey');
  });
});

describe('[AI-137] [AI-069] Recap text', () => {
  it('[AI-137] is prepared once: reasoning out, line ends normalised, blank runs collapsed', () => {
    expect(recapText('<think>x</think>\r\nКТО ОН  \r\nHubert\r\n\r\n\r\n\r\nСЕЙЧАС\nждёт ')).toBe('КТО ОН\nHubert\n\nСЕЙЧАС\nждёт');
  });

  it('[AI-069] a full recap is cut into its headed blocks', () => {
    const blocks = recapBlocks(recapText('Вступление.\n\n1. DOSSIER\nHubert, 34.\n\n## Что любит\nТёплый разогрев.\n\n**Покупки**\n$30 сеты.\n\nСЕЙЧАС:\nждёт ответа'));
    expect(blocks).toEqual([
      { heading: '', markdown: 'Вступление.' },
      { heading: 'DOSSIER', markdown: 'Hubert, 34.' },
      { heading: 'Что любит', markdown: 'Тёплый разогрев.' },
      { heading: 'Покупки', markdown: '$30 сеты.' },
      { heading: 'СЕЙЧАС', markdown: 'ждёт ответа' },
    ]);
  });

  it('a short recap, or a text with fewer than two headings, stays one text', () => {
    expect(recapBlocks('Hubert, 34, Warsaw. Buys sets after a warm build-up.')).toBeNull();
    expect(recapBlocks('ONLY ONE\ntext')).toBeNull();
  });

  it('sentences and list items are not headings', () => {
    for (const line of ['He wrote first.', '1. Likes photos', 'OK.', '- ITEM', 'A', 'ЧТО ЭТО?']) expect(recapHeadingOf(line), line).toBeNull();
    for (const [line, heading] of [['### Stage ##', 'Stage'], ['2) OPEN LOOPS:', 'OPEN LOOPS'], ['__Strategy__:', 'Strategy'], ['3. **Финансы**', 'Финансы']] as const) {
      expect(recapHeadingOf(line), line).toBe(heading);
    }
  });
});

describe('stream preview: no marker, no piece of a marker, no reasoning', () => {
  it('holds back the possible start of a marker at the very end', () => {
    for (const tail of ['[', '[N', '[ne', '[NEX', '[NEXT', '[ next ', '[V', '[VARIAN', '[variant ']) {
      expect(partialMarkerLength(`hello ${tail}`), tail).toBe(tail.length);
      expect(withoutMarkers(`hello ${tail}`), tail).toBe('hello ');
    }
    for (const tail of ['[x', '[nope', 'NEXT', '[NEXT]', '[next] a']) expect(partialMarkerLength(`hello ${tail}`), tail).toBe(0);
  });

  it('whole markers become paragraph breaks', () => {
    expect(streamPreview('reply', 'one [NEXT] two[next]three')).toBe('one\n\ntwo\n\nthree');
    expect(streamPreview('hi', 'a [VARIANT] b [NE')).toBe('a\n\nb');
  });

  it('an open reasoning block and the start of its tag are not shown', () => {
    expect(hideOpenThinkBlock('<think>plan</think>hey <thi')).toBe('hey ');
    expect(streamPreview('reply', '<think>still thinking about [NEXT]')).toBe('');
    expect(streamPreview('reply', 'hey <think>a</think>you')).toBe('hey you');
    expect(streamPreview('recap', '<think>x</think> text <')).toBe('text');
  });

  it('hides every reasoning tag name while it streams, and only the start of one at the end', () => {
    for (const opener of ['<thinking>', '<reasoning>', '<thinking_mode>', '<mental_model>', '<REASONING mode="x">']) {
      expect(hideOpenThinkBlock(`hey ${opener}plan [NEXT]`), opener).toBe('hey ');
    }
    for (const tail of ['<', '<thi', '<thinki', '<thinking', '<r', '<reaso', '<m', '<mental_', '<thinking_mo']) {
      expect(hideOpenThinkBlock(`hey ${tail}`), tail).toBe('hey ');
    }
    for (const tail of ['<3', '<thinkpad', '<rating', '<b']) expect(hideOpenThinkBlock(`hey ${tail}`), tail).toBe(`hey ${tail}`);
    expect(streamPreview('reply', '<thinking_mode>x</thinking_mode>hey [NEXT] you')).toBe('hey\n\nyou');
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

  it('variants of parts joined by any marker form read back exactly', () => {
    const random = seeded(0xa12);
    for (let round = 0; round < 300; round += 1) {
      const variants = Array.from({ length: 1 + random.int(3) }, () => Array.from({ length: 1 + random.int(3) }, () => sentence(random)));
      const text = variants.map((parts) => parts.join(random.pick(NEXT_FORMS))).join(random.pick(VARIANT_FORMS));
      expect(parseVariants(text), text).toEqual(variants);
      const out = parseOutput('hi', text, ctx());
      expect(out.ok && out.result.kind === 'variants' && out.result.variants).toEqual(variants);
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

  it('a prefix of the stream never shows text the whole answer does not have', () => {
    const random = seeded(0xa14);
    const squash = (text: string): string => text.replace(/\s+/g, '');
    for (let round = 0; round < 200; round += 1) {
      const parts = Array.from({ length: 1 + random.int(5) }, () => sentence(random));
      const text = parts.join(random.pick(NEXT_FORMS));
      const full = squash(parts.join(''));
      for (let cut = 0; cut <= text.length; cut += 1 + random.int(3)) {
        const shown = squash(streamPreview('reply', text.slice(0, cut)));
        expect(full.startsWith(shown), `${JSON.stringify(text)} @${cut}`).toBe(true);
      }
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

  it('a review document, when there is one, always fits its schema', () => {
    const random = seeded(0xa16);
    const labels = ['ВЕРДИКТ:', 'ДЕНЬГИ:', 'ПЕРСОНА:', 'ОШИБКИ:', 'ЧТО РАБОТАЕТ:', '1.', '2)', 'Как надо было:', 'как надо было (после "x"):', '"quoted"', '«цитата»'];
    for (let round = 0; round < 500; round += 1) {
      const body = (): string => Array.from({ length: random.int(14) }, () => (random.chance(0.4) ? random.pick(labels) : sentence(random))).join(random.pick([' ', '\n']));
      const raw = `<rating>${1 + random.int(10)}</rating><evaluation>${body()}</evaluation><recommendations>${body()}</recommendations>`;
      const doc = parseReviewDoc(raw);
      if (doc !== null) expect(ReviewDocSchema.safeParse(doc).success, raw).toBe(true);
      expect(typeof reviewCopyText(raw)).toBe('string');
    }
  });
});
