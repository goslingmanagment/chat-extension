import { describe, expect, it } from 'vitest';

import { parseNoteFillAnswer } from './notes-fill-answer';

const ASKED = ['Имя', 'Локация', 'Возраст', 'Другое'];

describe('[host:fansly] «✨ Дополнить из чата»: the hub’s merge answer (R20 P11b2; the Fansly extension’s parseFilledFields, decision 164)', () => {
  it('[FX-023] [FS-NOTE-6] a value per asked label with the fan’s words under it; `=` and an empty line are nothing; the month stays on its fact', () => {
    const answer = [
      'Имя: Алекс',
      '> «call me Alex»',
      '> "Alex here"',
      'Локация: Тампа, Флорида (08.2026)',
      '> “just moved to Tampa”',
      '> «a»',
      '> «b»',
      '> «a fourth is ignored»',
      'Возраст: =',
      '> «no words under an unchanged field»',
      'Другое:',
    ].join('\n');
    expect(parseNoteFillAnswer(answer, ASKED)).toEqual({
      kind: 'note-fields',
      fields: [
        { label: 'Имя', value: 'Алекс', quotes: ['call me Alex', 'Alex here'] },
        { label: 'Локация', value: 'Тампа, Флорида (08.2026)', quotes: ['just moved to Tampa', 'a', 'b'] },
        { label: 'Возраст', value: '' },
        { label: 'Другое', value: '' },
      ],
    });
  });

  it('[FX-023] [FS-NOTE-6] fields the hub named itself — with a value, none an asked label, five at most; escapes decoded; a missing label is nothing; preambles ignored', () => {
    const answer = [
      'Вот анкета:',
      '> «a quote with nothing above it»',
      '- имя: Tom &amp; Jerry',
      '+ Питомцы: кот',
      '> «my cat»',
      '+ Возраст: 41',
      '+ Пусто: =',
      '+ Плохая<метка: x',
      ...Array.from({ length: 6 }, (_, n) => `+ Поле ${String(n)}: x`),
    ].join('\n');
    const result = parseNoteFillAnswer(answer, ASKED);
    expect(result?.fields).toEqual([
      { label: 'Имя', value: 'Tom & Jerry' },
      { label: 'Локация', value: '' },
      { label: 'Возраст', value: '' },
      { label: 'Другое', value: '' },
    ]);
    expect(result?.proposed).toEqual([
      { label: 'Питомцы', value: 'кот', quotes: ['my cat'] },
      ...Array.from({ length: 4 }, (_, n) => ({ label: `Поле ${String(n)}`, value: 'x' })),
    ]);
  });

  it('[FS-NOTE-6] the labels-only answer of an older hub still reads; an answer of no asked label is no answer; a long quote is cut, not refused', () => {
    expect(parseNoteFillAnswer('Имя: Алекс\nЛокация: \nВозраст: 41\nДругое: ', ASKED)?.fields.map((field) => field.value)).toEqual(['Алекс', '', '41', '']);
    expect(parseNoteFillAnswer('Sorry, I cannot help with that.', ASKED)).toBeNull();
    expect(parseNoteFillAnswer('', ASKED)).toBeNull();
    const quote = parseNoteFillAnswer(`Имя: Алекс\n> «${'я'.repeat(500)}»`, ASKED)?.fields[0]?.quotes?.[0] ?? '';
    expect(Array.from(quote)).toHaveLength(400);
    expect(quote.endsWith('…')).toBe(true);
  });
});
