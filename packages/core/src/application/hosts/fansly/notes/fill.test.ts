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
    expect(mergeNoteFill(OLD, ASKED.map((label) => ({ label, value: '' })))).toEqual({ text: OLD, wrote: [], suggestions: [] });
    expect(mergeNoteFill(OLD, [{ label: 'Имя', value: 'WAYNE' }])).toEqual({ text: OLD, wrote: [], suggestions: [] });
  });
});
