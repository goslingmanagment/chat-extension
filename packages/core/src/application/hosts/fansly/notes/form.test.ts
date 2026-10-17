// The questionnaire's text both ways (R20 P11b2): what the Fansly extension 2.10–2.12 wrote reads here field by field,
// and what this panel writes is the text the old one reads — its template, a field written back, every other line
// byte for byte. The cases of the old `tests/fan-notes-form.test.ts` (E166) come along.
import { describe, expect, it } from 'vitest';

import { applyFieldSuggestion, diffNoteFacts, isQuestionnaire, moveFieldToOther, parseNoteForm, parseNoteTemplate, setNoteFieldFacts, splitFactDate, splitNoteFacts, type NoteFormField } from './form';
import { NOTE_TEMPLATE_LABELS, NOTE_TEMPLATE_TEXT, NOTE_TEMPLATE_TITLE } from './template';

const fields = (text: string) =>
  (parseNoteForm(text) ?? []).filter((part): part is NoteFormField => part.kind === 'field').map((part) => [part.label, part.facts] as const);

/** The old extension's «+ Анкета» since 2.11.0 (`FAN_NOTE_TEMPLATE_TEXT`, E164), as it stores it. */
const OLD_212_TEMPLATE = 'Имя: \nЛокация: \nВозраст: \nРабота: \nГрафик: \nХобби: \nПланы и даты: \nФетиши: \nХарактеристика: \nМедиа: \nДругое: ';
/** Its 2.9–2.10 template: the spec's eight entries. */
const OLD_210_TEMPLATE = 'Имя: \nЛокация: \nВозраст: \nРабота: \nХобби: \nФетиши: \nХарактеристика: \nМедиа: ';
/** A questionnaire as the old one leaves it after a chatter and its fill: stamped months, «; » facts, a line written
 * under a field, a line before the first field and one after a blank line. */
const OLD_FILLED = [
  'whale',
  'Имя: Wayne',
  'Локация: Флорида (08.2026)',
  'Возраст: ',
  'Работа: медбрат; ночные смены (09.2026)',
  'Хобби: качалка',
  'Фетиши: не говорил конкретного',
  'топ фетиши в жизни - public, edging',
  'Характеристика: депрессивный чел; нету девушки',
  'Медиа: ',
  '',
  'просил кастом',
].join('\n');

describe('[host:fansly] the questionnaire’s text, both ways with the Fansly extension (R20 P11b2)', () => {
  it('[FX-008] [FS-NOTE-2] «+ Анкета» is the old extension’s eleven entries, in its order and its stored text', () => {
    expect(NOTE_TEMPLATE_TITLE).toBe('Анкета');
    expect(NOTE_TEMPLATE_LABELS).toEqual(['Имя', 'Локация', 'Возраст', 'Работа', 'График', 'Хобби', 'Планы и даты', 'Фетиши', 'Характеристика', 'Медиа', 'Другое']);
    expect(NOTE_TEMPLATE_TEXT).toBe(OLD_212_TEMPLATE);
    expect(fields(NOTE_TEMPLATE_TEXT)).toEqual(NOTE_TEMPLATE_LABELS.map((label) => [label, []]));
  });

  it('[FX-008] reads the old 2.9–2.12 templates and the spec’s eight-entry form as questionnaires', () => {
    for (const text of [OLD_212_TEMPLATE, OLD_210_TEMPLATE, OLD_FILLED]) expect(isQuestionnaire(text)).toBe(true);
    expect(fields(OLD_210_TEMPLATE).map(([label]) => label)).toEqual(['Имя', 'Локация', 'Возраст', 'Работа', 'Хобби', 'Фетиши', 'Характеристика', 'Медиа']);
    expect(fields(OLD_FILLED)).toEqual([
      ['Имя', ['Wayne']],
      ['Локация', ['Флорида (08.2026)']],
      ['Возраст', []],
      ['Работа', ['медбрат', 'ночные смены (09.2026)']],
      ['Хобби', ['качалка']],
      ['Фетиши', ['не говорил конкретного', 'топ фетиши в жизни - public, edging']],
      ['Характеристика', ['депрессивный чел', 'нету девушки']],
      ['Медиа', []],
    ]);
  });

  it('[FX-008] old notes in, the same text out: a field written back with its own facts changes no byte', () => {
    for (const text of [OLD_212_TEMPLATE, OLD_210_TEMPLATE, OLD_FILLED.replace('\nтоп фетиши в жизни - public, edging', '')]) {
      for (const [label, facts] of fields(text)) expect(setNoteFieldFacts(text, label, facts)).toBe(text);
    }
  });

  it('[FX-008] a field typed rewrites its own line only — the line under it joins it, every other line keeps its bytes', () => {
    const typed = setNoteFieldFacts(OLD_FILLED, 'Фетиши', ['не говорил конкретного', 'топ фетиши в жизни - public, edging', 'ролевые']);
    expect(typed).toBe(OLD_FILLED.replace('Фетиши: не говорил конкретного\nтоп фетиши в жизни - public, edging', 'Фетиши: не говорил конкретного; топ фетиши в жизни - public, edging; ролевые'));
    const other = setNoteFieldFacts(typed, 'График', ['ночью']);
    expect(other).toBe(typed);
    // The old extension reads the same fields back.
    expect(fields(typed).find(([label]) => label === 'Фетиши')?.[1]).toEqual(['не говорил конкретного', 'топ фетиши в жизни - public, edging', 'ролевые']);
  });

  it('[FX-008] reads a value’s facts between «; », and leaves a lone semicolon alone', () => {
    expect(splitNoteFacts('ходит на терапию (10.2026); думает о смене работы')).toEqual(['ходит на терапию (10.2026)', 'думает о смене работы']);
    expect(splitNoteFacts('любит шутки ;) и мемы')).toEqual(['любит шутки ;) и мемы']);
    expect(splitNoteFacts('  ')).toEqual([]);
  });

  it('[FX-008] a note of one field, of links or of no field is not a questionnaire', () => {
    expect(parseNoteForm('есть собака Gigi, 10 лет')).toBeNull();
    expect(parseNoteForm('Имя: Wayne')).toBeNull();
    expect(parseNoteForm('Имя: Алекс\nрассказал про собаку')).toBeNull();
    expect(parseNoteForm('https://fansly.com/a\nhttps://fansly.com/b')).toBeNull();
    expect(parseNoteTemplate(Array.from({ length: 31 }, (_, at) => `Поле ${String(at)}: x`).join('\n'))).toEqual([]);
  });

  it('[FX-008] keeps a line before the first field and one after a blank line as lines of no field', () => {
    const parts = parseNoteForm('whale\nИмя: Ethan\nРабота: \n\nпросил кастом\nи душ') ?? [];
    expect(parts.map((part) => (part.kind === 'field' ? `${part.label}=${part.facts.join('|')}` : `text:${part.text}`))).toEqual(['text:whale', 'Имя=Ethan', 'Работа=', 'text:просил кастом', 'text:и душ']);
  });

  it('[FX-015] [FS-NOTE-5] a time in a continuation belongs to the field’s facts, never to its labels', () => {
    const text = 'Имя: Алекс\nГрафик: ночные смены\nпишет после работы в 23:00\nПитомцы: кот';
    expect(parseNoteTemplate(text).map((field) => field.label)).toEqual(['Имя', 'График', 'Питомцы']);
    expect(fields(text)).toEqual([['Имя', ['Алекс']], ['График', ['ночные смены', 'пишет после работы в 23:00']], ['Питомцы', ['кот']]]);
    expect(setNoteFieldFacts(text, 'График', ['пишет после работы в 23:00'])).toBe(text.replace('ночные смены\n', ''));
  });

  it('[FX-008] writes a field back as one line, the label as the chatter typed it', () => {
    const text = '- Имя:  Ethan\nДругое: кот\nмать после больницы\n\nпросил кастом';
    expect(setNoteFieldFacts(text, 'Другое', ['кот', ' мать после больницы ', '', 'сестра'])).toBe('- Имя:  Ethan\nДругое: кот; мать после больницы; сестра\n\nпросил кастом');
    expect(setNoteFieldFacts(text, 'имя', [])).toBe('- Имя: \nДругое: кот\nмать после больницы\n\nпросил кастом');
    expect(setNoteFieldFacts(text, 'Возраст', ['34'])).toBe(text);
    const grown = setNoteFieldFacts('Имя: Ethan\nХобби: ', 'Хобби', ['качалка', 'бургеры']);
    expect(grown).toBe('Имя: Ethan\nХобби: качалка; бургеры');
    expect(fields(grown)).toEqual([['Имя', ['Ethan']], ['Хобби', ['качалка', 'бургеры']]]);
  });

  it('[FX-008] parts a fact from the month the Goose stamped on it', () => {
    expect(splitFactDate('Флорида (08.2026)')).toEqual({ text: 'Флорида', date: '08.2026' });
    expect(splitFactDate('купил видео (PPV $44)')).toEqual({ text: 'купил видео (PPV $44)', date: null });
    expect(splitFactDate('(08.2026)')).toEqual({ text: '(08.2026)', date: null });
  });

  it('[FX-008] the Goose’s rewrite: the facts it adds and drops; «Принять» writes its field only while it still holds what was rewritten', () => {
    expect(diffNoteFacts('гфешник, делал проверку', 'Гфешник,  делал проверку; любит умных и смешных')).toEqual({ added: ['любит умных и смешных'], removed: [] });
    expect(diffNoteFacts('маори и голландец', 'любит GFE; платит за кастомы')).toEqual({ added: ['любит GFE', 'платит за кастомы'], removed: ['маори и голландец'] });
    expect(diffNoteFacts('a; b', 'b; a')).toEqual({ added: [], removed: [] });
    const suggestion = { label: 'работа', current: 'медбрат; ночные смены (09.2026)', proposed: 'медбрат в больнице; ночные смены (09.2026)', quotes: ['работаю в больнице'] };
    expect(applyFieldSuggestion(OLD_FILLED, suggestion)).toBe(OLD_FILLED.replace('Работа: медбрат;', 'Работа: медбрат в больнице;'));
    expect(applyFieldSuggestion(OLD_FILLED.replace('медбрат;', 'фельдшер;'), suggestion)).toBe(OLD_FILLED.replace('медбрат;', 'фельдшер;'));
  });
});

describe('[host:fansly] «В Другое» (R20 P11b2; the Fansly extension 2.11.0, decision 164)', () => {
  it('[FX-023] a field the Goose named leaves its line and joins «Другое» as one fact; without «Другое» its line becomes one', () => {
    const text = 'Имя: Wayne\nДругое: из Техаса\nПитомцы: кот; собака\n\nпросил кастом';
    expect(moveFieldToOther(text, 'Питомцы', 'Другое')).toBe('Имя: Wayne\nДругое: из Техаса; Питомцы: кот; собака\n\nпросил кастом');
    expect(moveFieldToOther('Имя: Wayne\nПитомцы: кот\nВозраст: 41', 'Питомцы', 'Другое')).toBe('Имя: Wayne\nДругое: Питомцы: кот\nВозраст: 41');
    // Two fields, one of them «Другое»: still a questionnaire while «Другое» takes the fact.
    expect(moveFieldToOther('Другое: \nПитомцы: кот', 'Питомцы', 'Другое')).toBe('Другое: Питомцы: кот');
    expect(moveFieldToOther(text, 'Другое', 'Другое')).toBe(text);
    expect(moveFieldToOther(text, 'Хобби', 'Другое')).toBe(text);
  });
});
