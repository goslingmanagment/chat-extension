import { describe, expect, it } from 'vitest';

import { mergeNoteFill, noteFillFields } from './fill';
import { applyFieldSuggestion } from './form';
import { NOTE_TEMPLATE_LABELS } from './template';

/** A questionnaire the Fansly extension 2.10 left: eight entries, a stamped month, a line under a field, free text below. */
const OLD = 'Имя: Wayne\nЛокация: Флорида (08.2026)\nВозраст: \nРабота: медбрат\nХобби: \nФетиши: \nХарактеристика: депрессивный чел\nнужно поддерживать вайб\nМедиа: \n\nпросил кастом';
const ASKED = ['Имя', 'Локация', 'Возраст', 'Работа', 'Хобби', 'Фетиши', 'Характеристика', 'Медиа', 'График', 'Планы и даты', 'Другое'];

describe('[host:fansly] «✨ Заполнить из чата»: what is asked and how the answer joins (R20 P11c)', () => {
  it('[FX-015] [FS-NOTE-5] asks the labels only, never a value: the questionnaire’s in note order, then the template’s it lacks, at most 30', () => {
    const fields = noteFillFields(OLD);
    expect(fields).toEqual(ASKED);
    expect(JSON.stringify(fields)).not.toMatch(/Wayne|Флорида|медбрат|вайб|кастом/);
    // A full questionnaire leaves room for none of the template; «- Имя» of a list is the template's «Имя».
    const many = Array.from({ length: 29 }, (_, n) => `Поле ${String(n)}: x`).join('\n');
    expect(noteFillFields(`${many}\n- Имя: Wayne`)).toEqual([...Array.from({ length: 29 }, (_, n) => `Поле ${String(n)}`), '- Имя']);
    expect(noteFillFields(many)).toEqual([...Array.from({ length: 29 }, (_, n) => `Поле ${String(n)}`), NOTE_TEMPLATE_LABELS[0]]);
    expect(noteFillFields('просто текст')).toBeNull();
    expect(noteFillFields('Имя: Wayne')).toBeNull();
  });

  it('[FX-015] [FS-NOTE-5] a continuation with 23:00 never becomes a label sent to the hub; real custom fields still do', () => {
    const text = `${OLD.replace('нужно поддерживать вайб', 'нужно поддерживать вайб\nпишет после работы в 23:00')}\nПитомцы: кот`;
    expect(noteFillFields(text)).toEqual([...ASKED.slice(0, 8), 'Питомцы', ...ASKED.slice(8)]);
    expect(JSON.stringify(noteFillFields(text))).not.toMatch(/пишет|23|00|Wayne|медбрат|кот/);
  });

  it('[FX-016] [FS-NOTE-6] adds, never wipes: an empty field takes the answer, a filled one offers its facts and the new ones, the template’s new lines go under the last field', () => {
    const answer = ASKED.map((label) => ({ label, value: '' }));
    const set = (label: string, value: string) => {
      const entry = answer.find((field) => field.label === label);
      if (entry !== undefined) entry.value = value;
    };
    set('Имя', 'wayne');
    set('Локация', 'Тампа, Флорида');
    set('Возраст', '41');
    set('Работа', 'медбрат; ночные смены');
    set('Характеристика', 'одинок');
    set('График', 'пишет по ночам');
    const merged = mergeNoteFill(OLD, answer);
    expect(merged.wrote).toEqual(['Возраст', 'График']);
    expect(merged.text).toBe(
      'Имя: Wayne\nЛокация: Флорида (08.2026)\nВозраст: 41\nРабота: медбрат\nХобби: \nФетиши: \nХарактеристика: депрессивный чел\nнужно поддерживать вайб\nМедиа: \nГрафик: пишет по ночам\n\nпросил кастом',
    );
    expect(merged.suggestions).toEqual([
      { label: 'Локация', current: 'Флорида (08.2026)', proposed: 'Флорида (08.2026); Тампа, Флорида', quotes: [] },
      { label: 'Работа', current: 'медбрат', proposed: 'медбрат; ночные смены', quotes: [] },
      { label: 'Характеристика', current: 'депрессивный чел; нужно поддерживать вайб', proposed: 'депрессивный чел; нужно поддерживать вайб; одинок', quotes: [] },
    ]);
    // «Принять»: the field written as if typed — the line under it joined, every other line as it was.
    const character = merged.suggestions[2];
    if (character === undefined) throw new Error('no rewrite of «Характеристика»');
    const accepted = applyFieldSuggestion(merged.text, character);
    expect(accepted).toBe(merged.text.replace('Характеристика: депрессивный чел\nнужно поддерживать вайб', 'Характеристика: депрессивный чел; нужно поддерживать вайб; одинок'));
    // Nothing found, or nothing new: the text keeps its bytes.
    const nothing = { text: OLD, wrote: [], suggestions: [], sources: [], proposed: [] };
    expect(mergeNoteFill(OLD, ASKED.map((label) => ({ label, value: '' })))).toEqual(nothing);
    expect(mergeNoteFill(OLD, [{ label: 'Имя', value: 'WAYNE' }])).toEqual(nothing);
  });
});

describe('[host:fansly] «✨ Дополнить из чата»: the merge mode’s answer joins (R20 P11b2)', () => {
  const answer = (values: Readonly<Record<string, { value: string; quotes?: string[] }>>) => ASKED.map((label) => ({ label, value: '', ...values[label] }));

  it('[FX-023] [FS-NOTE-6] the fan’s words stay beside the draft: under a filled field as its sources, under a rewrite as its own; the month stays on its fact', () => {
    const merged = mergeNoteFill(OLD, answer({ Возраст: { value: '41', quotes: ['I am 41'] }, Работа: { value: 'медбрат; ночные смены (10.2026)', quotes: ['night shifts again'] }, График: { value: 'ночи (10.2026)' } }));
    expect(merged.wrote).toEqual(['Возраст', 'График']);
    expect(merged.sources).toEqual([{ label: 'Возраст', quotes: ['I am 41'] }]);
    expect(merged.suggestions).toEqual([{ label: 'Работа', current: 'медбрат', proposed: 'медбрат; ночные смены (10.2026)', quotes: ['night shifts again'] }]);
    expect(merged.text).toContain('\nГрафик: ночи (10.2026)\n');
    expect(JSON.stringify(merged.text)).not.toContain('I am 41');
  });

  it('[FX-023] [FS-NOTE-6] a field the hub named itself gets a line of its own (with «В Другое»); one the note already has, or with no room, joins «Другое» as `Label: value`', () => {
    const merged = mergeNoteFill(OLD, answer({ Другое: { value: 'есть брат' } }), [
      { label: 'Питомцы', value: 'кот', quotes: ['my cat'] },
      { label: 'работа', value: 'ночные смены' },
    ]);
    expect(merged.proposed).toEqual(['Питомцы']);
    expect(merged.wrote).toEqual(['Другое', 'Питомцы']);
    expect(merged.text).toBe('Имя: Wayne\nЛокация: Флорида (08.2026)\nВозраст: \nРабота: медбрат\nХобби: \nФетиши: \nХарактеристика: депрессивный чел\nнужно поддерживать вайб\nМедиа: \nДругое: есть брат; работа: ночные смены\nПитомцы: кот\n\nпросил кастом');
    expect(merged.sources).toEqual([{ label: 'Питомцы', quotes: ['my cat'] }]);
    // A filled «Другое» takes the moved fact on both sides of its pending rewrite, so «Принять» still applies.
    const filled = `${OLD.replace('Медиа: ', 'Медиа: \nДругое: из Техаса')}`;
    const both = mergeNoteFill(filled, answer({ Другое: { value: 'есть брат' } }), [{ label: 'Работа', value: 'ночные смены' }]);
    expect(both.suggestions).toEqual([{ label: 'Другое', current: 'из Техаса; Работа: ночные смены', proposed: 'из Техаса; есть брат; Работа: ночные смены', quotes: [] }]);
    const other = both.suggestions[0];
    if (other === undefined) throw new Error('no rewrite of «Другое»');
    expect(applyFieldSuggestion(both.text, other)).toContain('Другое: из Техаса; есть брат; Работа: ночные смены');
  });
});
