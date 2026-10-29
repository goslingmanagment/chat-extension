// core/domain/output/recap-doc: a Recap as the window's document and its «Шпаргалка» (2026-10-28). The cut guesses
// at structure from plain text, so these pin the guesses that went wrong on a real Recap: a sentence taken for a label,
// a dated line not taken for one.

import { describe, expect, it } from 'vitest';

import { recapBlocks, recapCrib, recapDoc, recapHeadingText, recapWrittenVm } from '@cg/core/domain/output';

const NAMES: Record<string, string> = {
  'recap.section.dossier': 'Досье',
  'recap.section.stage': 'Стадия и траектория',
  'recap.section.money': 'Деньги',
  'recap.section.openLoops': 'Незакрытое',
  'recap.section.strategy': 'Стратегия',
  'recap.section.spend': 'Траты',
  'recap.section.boundaries': 'Границы',
  'recap.section.threads': 'Открытые нити',
  'recap.section.nextMove': 'Следующий ход',
};
const name = (heading: string): string => recapHeadingText(heading, (key) => NAMES[key] ?? key);
const docOf = (text: string) => recapDoc(recapBlocks(text), name);

const FULL = `1. ДОСЬЕ

Имя: Джейми, сам представился в первом сообщении.
Детство и поездки (рассказал сам):
- в сентябре две недели в Лиссабоне;
- мечтает о Японии весной.

Продолжить сцену с того места, где остановились: он ждёт.

3. СТАДИЯ И ТРАЕКТОРИЯ

Текущая стадия: warming up с элементами loyal. Пишет почти каждый день.

Как менялось поведение:
- июль: знакомство, первая покупка;
- конец сентября: неделя тишины;
- 27 сентября: вернулся сам;
- вчера: купил сет.

Ключевые цитаты:
- "you're the first person I text after landing"
- "ok but how do you take your coffee"

5. ФИНАНСОВЫЙ ПРОФИЛЬ

Классификация: moderate spender. За почти 4 месяца 186 $, из них 3 сета.

6. ОТКРЫТЫЕ ПЕТЛИ

Что обещала модель:
- прислать фото утреннего кофе;
- рассказать продолжение сета.

7. СТРАТЕГИЯ

Чего избегать:
- Не слать несколько платных предложений подряд. В сентябре он пропал.

Рекомендуемый подход:
- Сначала спросить про перелёт. Потом тизер.
- Продолжение за 25-30 $, одним сообщением.
- Если устал, закончить тепло.`;

describe('[2026-10-28] a Recap as the window\'s document', () => {
  const doc = docOf(FULL);

  it('cuts the hub\'s sections in the reader\'s names', () => {
    expect(doc?.sections.map((section) => [section.key, section.name])).toEqual([
      ['dossier', 'Досье'],
      ['stage', 'Стадия и траектория'],
      ['money', 'Деньги'],
      ['openLoops', 'Незакрытое'],
      ['strategy', 'Стратегия'],
    ]);
    expect(doc?.labelled).toBe(true);
  });

  it('takes «Подпись: текст» for a label, a sentence with a comma before its colon for a sentence', () => {
    const parts = doc?.sections[0]?.parts ?? [];
    expect(parts[0]).toMatchObject({ kind: 'text', label: 'Имя', note: null, text: 'Джейми, сам представился в первом сообщении.' });
    expect(parts[1]).toMatchObject({ kind: 'list', label: 'Детство и поездки', note: 'рассказал сам', look: 'plain' });
    expect(parts[2]).toMatchObject({ kind: 'text', label: null, text: 'Продолжить сцену с того места, где остановились: он ждёт.' });
  });

  it('sets dated lines as a timeline and the fan\'s words as quotes', () => {
    const [stage, changes, quotes] = doc?.sections[1]?.parts ?? [];
    expect(stage).toMatchObject({ kind: 'text', label: 'Текущая стадия', scale: { kind: 'stage', at: 1, lean: [2] } });
    expect(changes).toMatchObject({ kind: 'list', look: 'timeline' });
    expect(changes?.kind === 'list' ? changes.items.map((item) => item.label) : []).toEqual(['июль', 'конец сентября', '27 сентября', 'вчера']);
    expect(quotes).toMatchObject({ kind: 'list', look: 'quotes', items: [{ text: 'you\'re the first person I text after landing', quoted: true }, { text: 'ok but how do you take your coffee', quoted: true }] });
  });

  it('puts the spender\'s class on its scale and the sum large, with what it covers', () => {
    expect(doc?.sections[2]?.parts[0]).toMatchObject({ scale: { kind: 'spend', at: 2 }, figure: { sum: '186 $', period: 'за почти 4 месяца' } });
    // A paragraph that opens with its sum says it first itself.
    const short = docOf('1. КТО\nДжейми.\n\n2. ТРАТЫ\nLight spender: 81,97 $ за 5 месяцев.');
    expect(short?.sections[1]?.parts[0]).toMatchObject({ label: 'Light spender', scale: { kind: 'spend', at: 1 }, figure: null });
  });

  it('marks what to do and what to avoid by the label', () => {
    expect(doc?.sections[4]?.parts.map((part) => part.tone)).toEqual(['avoid', 'act']);
  });

  it('leaves a text without the hub\'s headings to the reader as it is', () => {
    const other = docOf('## Who he is\nHubert, 34.\n\n## What to avoid\n- long texts');
    expect(other?.sections.map((section) => [section.key, section.name])).toEqual([
      [null, 'Who he is'],
      [null, 'What to avoid'],
    ]);
    expect(other?.labelled).toBe(false);
    expect(recapCrib(other ?? null)).toBeNull();
  });
});

describe('[2026-10-28] what a tile of the board shows', () => {
  const MONEY = `5. ФИНАНСОВЫЙ ПРОФИЛЬ

Классификация: light spender. За почти 5 месяцев 81,97 $, все за платные сообщения. Покупки только в двух месяцах: июнь 51,97 $ и сентябрь 30 $. В июле, августе и пока в октябре ноль.
Тренд: нерегулярный, с тенденцией к снижению.

3. СТАДИЯ И ТРАЕКТОРИЯ

Текущая стадия: warming up с элементами loyal-light. Пишет почти каждый день.
Направление: растёт, если не давить.`;
  const doc = docOf(MONEY);

  it('gives the months a money section names sums for, round the year from its longest pause', () => {
    const part = doc?.sections[0]?.parts[0];
    expect(part).toMatchObject({ scale: { kind: 'spend', at: 1, said: 'light spender' }, figure: { sum: '81,97 $' } });
    expect(part?.kind === 'text' ? part.months : null).toEqual([
      { month: 5, sum: 51.97 },
      { month: 6, sum: 0 },
      { month: 7, sum: 0 },
      { month: 8, sum: 30 },
      { month: 9, sum: 0 },
    ]);
    expect(doc?.sections[0]?.parts[1]).toMatchObject({ label: 'Тренд', trend: 'down' });
  });

  it('says the stage in the text\'s own words, apart from what the sentence adds, and its first sentence', () => {
    expect(doc?.sections[1]?.parts[0]).toMatchObject({ scale: { kind: 'stage', said: 'warming up', rest: 'с элементами loyal-light' }, lead: 'warming up с элементами loyal-light.' });
    expect(doc?.sections[1]?.parts[1]).toMatchObject({ label: 'Направление', trend: 'up' });
  });

  it('names a class by its label when the label is the class', () => {
    const short = docOf('1. КТО\nДжейми.\n\n2. ТРАТЫ\nLight spender: 81,97 $ за 5 месяцев.');
    expect(short?.sections[1]?.parts[0]).toMatchObject({ scale: { said: 'Light spender' } });
  });
});

describe('[2026-10-29] the sum a Recap names, all of it', () => {
  const figureOf = (classified: string) => {
    const part = docOf(`1. ДОСЬЕ\nИмя: Джейми.\n\n5. ФИНАНСОВЫЙ ПРОФИЛЬ\n\nКлассификация: ${classified}`)?.sections[1]?.parts[0];
    return part?.kind === 'text' ? part.figure : undefined;
  };

  it('takes thousands and ranges whole, never the digits after a separator or a dash', () => {
    expect(figureOf('moderate spender, всего 1,200 $ за год.')).toEqual({ sum: '1,200 $', period: 'за год' });
    expect(figureOf('light spender, обычно 10-20 $ за покупку.')).toEqual({ sum: '10-20 $', period: null });
    expect(figureOf('big spender, 12 500,50 $ за полгода.')).toEqual({ sum: '12 500,50 $', period: 'за полгода' });
    expect(figureOf('big spender, $1,200.50 за 3 месяца.')).toEqual({ sum: '$1,200.50', period: 'за 3 месяца' });
    expect(figureOf('moderate spender, чек $25-30.')).toEqual({ sum: '$25-30', period: null });
    expect(figureOf('moderate spender, чек $10 - $20.')).toEqual({ sum: '$10 - $20', period: null });
    expect(figureOf('big spender, $1.5k за год.')).toEqual({ sum: '$1.5k', period: 'за год' });
    expect(figureOf('moderate spender, январь 2026 - $250.')).toEqual({ sum: '$250', period: null });
  });

  it('sets no sum large rather than a part of it', () => {
    expect(figureOf('light spender, обычно 10 - 20 $ за покупку.')).toBeNull();
    expect(figureOf('light spender, 1,2000 $.')).toBeNull();
  });

  it('charts a month as empty only by the zero of its own clause', () => {
    const part = docOf('1. ДОСЬЕ\nИмя: Джейми.\n\n5. ФИНАНСОВЫЙ ПРОФИЛЬ\n\nКлассификация: light spender, 80 $ за 4 месяца.\nТраты: В июне $50, в июле ноль, в сентябре 30 $.')?.sections[1]?.parts[0];
    // June's $50 is written in a way the chart does not read: June is left out, not shown as empty.
    expect(part?.kind === 'text' ? part.months : null).toEqual([
      { month: 6, sum: 0 },
      { month: 8, sum: 30 },
    ]);
    const after = docOf('1. ДОСЬЕ\nИмя: Джейми.\n\n5. ФИНАНСОВЫЙ ПРОФИЛЬ\n\nКлассификация: light spender, 1 230 $ за год.\nТраты: июнь 1,200 $ и сентябрь 30 $, потом полгода ноль и разовые $15 в марте.')?.sections[1]?.parts[0];
    expect(after?.kind === 'text' ? after.months : null).toEqual([
      { month: 5, sum: 1200 },
      { month: 8, sum: 30 },
    ]);
  });
});

describe('[2026-10-28] «Шпаргалка»', () => {
  it('takes the recommended approach, the promises and what to avoid, a sentence a line', () => {
    expect(recapCrib(docOf(FULL))).toEqual({
      next: ['Сначала спросить про перелёт', 'Продолжение за 25-30 $, одним сообщением'],
      keep: ['Прислать фото утреннего кофе', 'Рассказать продолжение сета'],
      avoid: ['Не слать несколько платных предложений подряд'],
    });
  });

  it('never takes what to avoid for the next move', () => {
    expect(recapCrib(docOf('1. ДОСЬЕ\nИмя: Джейми.\n\n7. СТРАТЕГИЯ\n\nЧто делать: Спросить про отпуск.\n\nЧего избегать: Давить на покупку.'))).toEqual({
      next: ['Спросить про отпуск'],
      keep: [],
      avoid: ['Давить на покупку'],
    });
    expect(recapCrib(docOf('1. ДОСЬЕ\nИмя: Джейми.\n\n7. СТРАТЕГИЯ\n\nЧего избегать: Давить на покупку.'))).toEqual({ next: [], keep: [], avoid: ['Давить на покупку'] });
    expect(recapCrib(docOf('1. КТО\nДжейми.\n\n6. СЛЕДУЮЩИЙ ХОД\nЧего избегать: давить на покупку.\n\nСпросить про перелёт.'))?.next).toEqual(['Спросить про перелёт']);
  });

  it('takes the short Recap\'s next move, open threads and boundaries', () => {
    const short = '1. КТО\nДжейми.\n\n4. ГРАНИЦЫ\nЯвных отказов нет. После нескольких платных предложений подряд пропадает на неделю.\n\n5. ОТКРЫТЫЕ НИТИ\n- модель обещала фото кофе\n\n6. СЛЕДУЮЩИЙ ХОД\nСпросить про перелёт. Потом тизер. Цена 25-30 $.';
    expect(recapCrib(docOf(short))).toEqual({
      next: ['Спросить про перелёт', 'Потом тизер'],
      keep: ['Модель обещала фото кофе'],
      avoid: ['После нескольких платных предложений подряд пропадает на неделю'],
    });
  });
});

describe('[2026-10-28] a Recap being written', () => {
  it('names the finished sections and the one being written', () => {
    const written = recapWrittenVm('1. ДОСЬЕ\nИмя: Джейми.\n\n3. СТАДИЯ И ТРАЕКТОРИЯ\nТекущая ста', name);
    expect(written?.done.map((section) => section.key)).toEqual(['dossier']);
    expect(written?.writing).toEqual({ key: 'stage', name: 'Стадия и траектория' });
    expect(recapWrittenVm('Читаю переписку', name)).toBeNull();
  });
});
