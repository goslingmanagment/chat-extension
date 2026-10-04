import { describe, expect, it } from 'vitest';

import { aiGeneratedMark, bigramSimilarity } from './ai-mark';

describe('[X8-02] ChatSpace’s own «text from AI» mark (§6.7.1)', () => {
  it('an unchanged part is the AI’s, however its line breaks and edges are written', () => {
    expect(aiGeneratedMark('Hey you', 'Hey you')).toBe(true);
    expect(aiGeneratedMark('  Hey you \n', 'Hey you')).toBe(true);
    expect(aiGeneratedMark('one\r\n\r\ntwo', 'one\ntwo')).toBe(true);
  });

  it('exact equality comes before similarity: a one-character text has no bigrams, and is still the same text', () => {
    expect(bigramSimilarity('k', 'k')).toBe(0);
    expect(aiGeneratedMark('k', 'k')).toBe(true);
    expect(aiGeneratedMark('k', 'K')).toBe(false);
  });

  it('a small edit keeps the mark, a rewrite loses it (Dice over lowercase bigrams, 0,85)', () => {
    const original = 'Hey love, I was just thinking about you — how was your day at work?';
    expect(aiGeneratedMark('Hey love, I was just thinking about you - how was your day at work', original)).toBe(true);
    expect(aiGeneratedMark(original.toUpperCase(), original)).toBe(true);
    expect(aiGeneratedMark('Tell me what you did today, I missed you', original)).toBe(false);
    expect(aiGeneratedMark(`${original} And what are you up to tonight, anything fun planned for us?`, original)).toBe(false);
    // The measure itself, on a hand-checked pair: «night» / «nacht» share one bigram of four each.
    expect(bigramSimilarity('night', 'nacht')).toBeCloseTo(0.25);
    expect(bigramSimilarity('Night', 'nIGHT')).toBe(1);
  });

  it('nothing sent and nothing generated are never «from AI»', () => {
    expect(aiGeneratedMark('', '')).toBe(false);
    expect(aiGeneratedMark('  \n', 'Hey')).toBe(false);
    expect(aiGeneratedMark('Hey', '')).toBe(false);
  });
});
