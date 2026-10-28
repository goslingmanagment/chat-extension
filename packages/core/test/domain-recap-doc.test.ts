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

describe('[2026-10-28] «Шпаргалка»', () => {
  it('takes the recommended approach, the promises and what to avoid, a sentence a line', () => {
    expect(recapCrib(docOf(FULL))).toEqual({
      next: ['Сначала спросить про перелёт', 'Продолжение за 25-30 $, одним сообщением'],
      keep: ['Прислать фото утреннего кофе', 'Рассказать продолжение сета'],
      avoid: ['Не слать несколько платных предложений подряд'],
    });
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
