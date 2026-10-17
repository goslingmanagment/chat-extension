import { describe, expect, it } from 'vitest';

import { mergeNoteFill, noteFillRequest } from './fill';
import { applyFieldSuggestion, diffNoteFacts, moveFieldToOther } from './form';
import { NOTE_OTHER_LABEL, NOTE_TEMPLATE_LABELS } from './template';

/** A questionnaire the Fansly extension 2.10 left: eight entries, a stamped month, a line under a field, free text below. */
const OLD = 'Имя: Wayne\nЛокация: Флорида (08.2026)\nВозраст: \nРабота: медбрат\nХобби: \nФетиши: \nХарактеристика: депрессивный чел\nнужно поддерживать вайб\nМедиа: \n\nпросил кастом';
const ASKED = ['Имя', 'Локация', 'Возраст', 'Работа', 'Хобби', 'Фетиши', 'Характеристика', 'Медиа', 'График', 'Планы и даты', 'Другое'];
const VALUES = ['Wayne', 'Флорида (08.2026)', '', 'медбрат', '', '', 'депрессивный чел', '', '', '', ''];
const many = (count: number, value = 'x') => Array.from({ length: count }, (_, n) => `Поле ${String(n)}: ${value}`).join('\n');
const labels = (count: number) => Array.from({ length: count }, (_, n) => `Поле ${String(n)}`);

describe('[host:fansly] «✨ Дополнить из чата»: what is asked (R20 P11c, P11b2; X43)', () => {
  it('[FX-015] [FX-024] [FS-NOTE-5] the questionnaire’s labels in note order with the values of their own lines, then the template’s it lacks with empty ones, at most 30', () => {
    expect(noteFillRequest(OLD)).toEqual({ fields: ASKED, values: VALUES });
    // The lines under a field and the free lines never travel: only what stands on a field's own line.
    expect(JSON.stringify(noteFillRequest(OLD))).not.toMatch(/вайб|кастом/);
    // A full questionnaire leaves room for none of the template; «- Имя» of a list is the template's «Имя».
    expect(noteFillRequest(`${many(29)}\n- Имя: Wayne`)).toEqual({ fields: [...labels(29), '- Имя'], values: [...labels(29).map(() => 'x'), 'Wayne'] });
    expect(noteFillRequest(many(29))).toEqual({ fields: [...labels(29), NOTE_TEMPLATE_LABELS[0]], values: [...labels(29).map(() => 'x'), ''] });
    expect(noteFillRequest('просто текст')).toBeNull();
    expect(noteFillRequest('Имя: Wayne')).toBeNull();
  });

  it('[FX-024] [FS-NOTE-5] a value is one trimmed line (a line break inside never parses as a field, and is flattened besides); a field over 2000 characters is not asked, label and all, yet keeps its place in the count of 30', () => {
    const long = 'я'.repeat(2001);
    const text = `Имя:  Wayne Брюс \nРабота: ${long}\nХобби: ${'х'.repeat(2000)}\nВозраст:   41  `;
    const asked = noteFillRequest(text);
    expect(asked?.fields.slice(0, 3)).toEqual(['Имя', 'Хобби', 'Возраст']);
    expect(asked?.values.slice(0, 3)).toEqual(['Wayne Брюс', 'х'.repeat(2000), '41']);
    expect(asked?.fields).not.toContain('Работа');
    expect(JSON.stringify(asked)).not.toContain(long);
    expect(asked?.values.every((value) => !/[\r\n\u2028\u2029]/.test(value) && value === value.trim())).toBe(true);
    // 29 fields and the long one: 30 in the note, so no template label joins.
    expect(noteFillRequest(`${many(29)}\nРабота: ${long}`)?.fields).toEqual(labels(29));
  });

  it('[FX-015] [FS-NOTE-5] a continuation with 23:00 never becomes a label sent to the hub; real custom fields still do', () => {
    const text = `${OLD.replace('нужно поддерживать вайб', 'нужно поддерживать вайб\nпишет после работы в 23:00')}\nПитомцы: кот`;
    const asked = noteFillRequest(text);
    expect(asked?.fields).toEqual([...ASKED.slice(0, 8), 'Питомцы', ...ASKED.slice(8)]);
    expect(asked?.values).toEqual([...VALUES.slice(0, 8), 'кот', ...VALUES.slice(8)]);
    expect(JSON.stringify(asked)).not.toMatch(/пишет|23:00/);
  });
});

describe('[host:fansly] «✨ Дополнить из чата»: the merge mode’s answer joins (R20 P11b2; X43; the Fansly extension 2.11.0, decision 164)', () => {
  const answer = (values: Readonly<Record<string, { value: string; quotes?: string[] }>>) => ASKED.map((label) => ({ label, value: '', ...values[label] }));

  it('[FX-016] [FX-024] [FS-NOTE-6] `=` and the same value give nothing; an empty field is filled in place; another value is the hub’s whole rewrite, offered as the facts it adds and drops', () => {
    const merged = mergeNoteFill(OLD, answer({
      Имя: { value: 'WAYNE ' },
      Локация: { value: 'Тампа, Флорида (10.2026)', quotes: ['moved to Tampa'] },
      Возраст: { value: '41', quotes: ['I am 41'] },
      Работа: { value: 'медбрат; ночные смены' },
      Характеристика: { value: 'одинок' },
      График: { value: 'пишет по ночам' },
    }));
    expect(merged.wrote).toEqual(['Возраст', 'График']);
    expect(merged.text).toBe('Имя: Wayne\nЛокация: Флорида (08.2026)\nВозраст: 41\nРабота: медбрат\nХобби: \nФетиши: \nХарактеристика: депрессивный чел\nнужно поддерживать вайб\nМедиа: \nГрафик: пишет по ночам\n\nпросил кастом');
    expect(merged.sources).toEqual([{ label: 'Возраст', quotes: ['I am 41'] }]);
    expect(merged.suggestions).toEqual([
      { label: 'Локация', current: 'Флорида (08.2026)', proposed: 'Тампа, Флорида (10.2026)', quotes: ['moved to Tampa'] },
      { label: 'Работа', current: 'медбрат', proposed: 'медбрат; ночные смены', quotes: [] },
      { label: 'Характеристика', current: 'депрессивный чел', proposed: 'одинок', quotes: [] },
    ]);
    expect(diffNoteFacts('Флорида (08.2026)', 'Тампа, Флорида (10.2026)')).toEqual({ added: ['Тампа, Флорида (10.2026)'], removed: ['Флорида (08.2026)'] });
    expect(diffNoteFacts('медбрат', 'медбрат; ночные смены')).toEqual({ added: ['ночные смены'], removed: [] });
    // «Принять» rewrites that field's line alone: the line written under it stays.
    const character = merged.suggestions[2];
    if (character === undefined) throw new Error('no rewrite of «Характеристика»');
    expect(applyFieldSuggestion(merged.text, character)).toBe(merged.text.replace('Характеристика: депрессивный чел\n', 'Характеристика: одинок\n'));
    // A field the chatter has since edited is left alone.
    const edited = merged.text.replace('депрессивный чел', 'весёлый');
    expect(applyFieldSuggestion(edited, character)).toBe(edited);
    // Nothing found, `=` read as nothing, or the same value: the text keeps its bytes.
    const nothing = { text: OLD, wrote: [], suggestions: [], sources: [], proposed: [], unplaced: [] };
    expect(mergeNoteFill(OLD, ASKED.map((label) => ({ label, value: '' })))).toEqual(nothing);
    expect(mergeNoteFill(OLD, [{ label: 'Имя', value: 'WAYNE' }, { label: 'Локация', value: ' флорида  (08.2026)' }])).toEqual(nothing);
  });

  it('[FX-016] [FS-NOTE-6] an empty line with lines written under it is filled on its line; those lines stay', () => {
    const text = 'Имя: \nкажется Брюс\nРабота: медбрат';
    expect(mergeNoteFill(text, [{ label: 'Имя', value: 'Wayne' }, { label: 'Работа', value: '' }]).text).toBe('Имя: Wayne\nкажется Брюс\nРабота: медбрат');
  });

  it('[FX-024] a field over 2000 characters was not asked and is never touched, even when the answer names it', () => {
    const long = 'я'.repeat(2001);
    const text = `Имя: Wayne\nДругое: ${long}`;
    const merged = mergeNoteFill(text, [{ label: 'Имя', value: '' }, { label: 'Другое', value: 'есть брат' }], [{ label: 'Имя', value: 'Брюс' }]);
    expect(merged.text).toBe(text);
    expect(merged.suggestions).toEqual([]);
    expect(merged.unplaced).toEqual(['Имя']);
  });

  it('[FX-023] [FS-NOTE-6] the fan’s words stay beside the draft: under a filled field as its sources, under a rewrite as its own; the month stays on its fact', () => {
    const merged = mergeNoteFill(OLD, answer({ Возраст: { value: '41', quotes: ['I am 41'] }, Работа: { value: 'медбрат; ночные смены (10.2026)', quotes: ['night shifts again'] }, График: { value: 'ночи (10.2026)' } }));
    expect(merged.wrote).toEqual(['Возраст', 'График']);
    expect(merged.sources).toEqual([{ label: 'Возраст', quotes: ['I am 41'] }]);
    expect(merged.suggestions).toEqual([{ label: 'Работа', current: 'медбрат', proposed: 'медбрат; ночные смены (10.2026)', quotes: ['night shifts again'] }]);
    expect(merged.text).toContain('\nГрафик: ночи (10.2026)\n');
    expect(JSON.stringify(merged.text)).not.toContain('I am 41');
  });

  it('[FX-023] [FX-024] [FS-NOTE-6] a field the hub named itself gets a line of its own (with «В Другое»); one the note already has joins «Другое» as `Label: value`, on both sides of a pending «Другое» rewrite', () => {
    const merged = mergeNoteFill(OLD, answer({ Другое: { value: 'есть брат' } }), [
      { label: 'Питомцы', value: 'кот', quotes: ['my cat'] },
      { label: 'работа', value: 'ночные смены', quotes: ['nights'] },
    ]);
    expect(merged.proposed).toEqual(['Питомцы']);
    expect(merged.wrote).toEqual(['Другое', 'Питомцы']);
    expect(merged.text).toBe('Имя: Wayne\nЛокация: Флорида (08.2026)\nВозраст: \nРабота: медбрат\nХобби: \nФетиши: \nХарактеристика: депрессивный чел\nнужно поддерживать вайб\nМедиа: \nДругое: есть брат; работа: ночные смены\nПитомцы: кот\n\nпросил кастом');
    expect(merged.sources).toEqual([{ label: 'Питомцы', quotes: ['my cat'] }, { label: 'работа', quotes: ['nights'] }]);
    // A filled «Другое»: the moved fact on its line and on both sides of its pending rewrite, so «Принять» still applies;
    // the line written under «Другое» stays.
    const filled = OLD.replace('Медиа: ', 'Медиа: \nДругое: из Техаса\nбрат-близнец');
    const both = mergeNoteFill(filled, answer({ Другое: { value: 'есть брат' } }), [{ label: 'Работа', value: 'ночные смены' }, { label: 'Другое', value: 'любит джаз' }]);
    expect(both.text).toContain('\nДругое: из Техаса; Работа: ночные смены; любит джаз\nбрат-близнец\n');
    expect(both.wrote).toEqual(['Другое']);
    expect(both.suggestions).toEqual([{ label: 'Другое', current: 'из Техаса; Работа: ночные смены; любит джаз', proposed: 'есть брат; Работа: ночные смены; любит джаз', quotes: [] }]);
    const other = both.suggestions[0];
    if (other === undefined) throw new Error('no rewrite of «Другое»');
    expect(applyFieldSuggestion(both.text, other)).toContain('\nДругое: есть брат; Работа: ночные смены; любит джаз\nбрат-близнец\n');
  });

  it('[FX-024] [FS-NOTE-6] the rule of 30: a named field past it joins «Другое»; creating «Другое» takes the last named line’s place; with no «Другое» and no room the fact is named, never lost unseen', () => {
    // 28 fields, room for two lines: «Питомцы» gets one; «Другое» needs the 30th place, so «Машина» gives it up.
    const full = mergeNoteFill(many(28), labels(28).map((label) => ({ label, value: '' })), [{ label: 'Питомцы', value: 'кот' }, { label: 'Машина', value: 'пикап' }, { label: 'Хобби', value: 'гольф' }]);
    expect(full.proposed).toEqual(['Питомцы']);
    expect(full.text.split('\n').slice(28)).toEqual(['Другое: Машина: пикап; Хобби: гольф', 'Питомцы: кот']);
    expect(full.unplaced).toEqual([]);
    // 30 fields and no «Другое»: nowhere to go, the notice names it.
    const none = mergeNoteFill(many(30), [{ label: 'Поле 0', value: '' }], [{ label: 'Питомцы', value: 'кот' }]);
    expect(none.text).toBe(many(30));
    expect(none.unplaced).toEqual(['Питомцы']);
    // 30 fields with «Другое»: the fact joins it.
    expect(mergeNoteFill(`${many(29)}\nДругое: `, [{ label: 'Поле 0', value: '' }], [{ label: 'Питомцы', value: 'кот' }])).toMatchObject({ text: `${many(29)}\nДругое: Питомцы: кот`, wrote: ['Другое'], unplaced: [] });
  });

  it('[FX-023] [FS-NOTE-6] «В Другое» moves a named line onto «Другое»’s own line and gives back the fact, which the panel adds to a pending «Другое» rewrite', () => {
    const text = 'Имя: Wayne\nДругое: из Техаса\nбрат-близнец\nПитомцы: кот';
    expect(moveFieldToOther(text, 'Питомцы', NOTE_OTHER_LABEL)).toEqual({ text: 'Имя: Wayne\nДругое: из Техаса; Питомцы: кот\nбрат-близнец', fact: 'Питомцы: кот' });
    expect(moveFieldToOther('Имя: Wayne\nПитомцы: кот', 'Питомцы', NOTE_OTHER_LABEL)).toEqual({ text: 'Имя: Wayne\nДругое: Питомцы: кот', fact: null });
    expect(moveFieldToOther(text, 'Другое', NOTE_OTHER_LABEL)).toEqual({ text, fact: null });
  });
});
