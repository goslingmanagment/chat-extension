import { describe, expect, it } from 'vitest';

import { parseNoteFillAnswer } from './fill-answer';

describe('[host:fansly] «✨ Дополнить из чата»: the hub’s answer (audit №13)', () => {
  const asked = ['Имя', 'Другое', 'Работа'];

  it('one value over 2000 characters is nothing for its field, never the end of the whole answer', () => {
    const long = 'факт; '.repeat(400);
    const result = parseNoteFillAnswer(['Имя: Алекс', `Другое: ${long}`, '> «я из Риги»', 'Работа: врач', `+ Хобби: ${long}`, '+ Питомец: кот'].join('\n'), asked);
    expect(result).toEqual({
      kind: 'note-fields',
      fields: [
        { label: 'Имя', value: 'Алекс' },
        { label: 'Другое', value: '' },
        { label: 'Работа', value: 'врач' },
      ],
      proposed: [{ label: 'Питомец', value: 'кот' }],
    });
  });

  it('a Unicode line separator inside a value reads as a space', () => {
    expect(parseNoteFillAnswer('Имя: Алекс Саша\nРабота: =', asked)?.fields).toEqual([
      { label: 'Имя', value: 'Алекс Саша' },
      { label: 'Другое', value: '' },
      { label: 'Работа', value: '' },
    ]);
  });
});
