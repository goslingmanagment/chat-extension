// OnlyMonster's notes as the panel's lines and back: what ChatSpace's editor writes reads as the lines it shows, and a
// write keeps Monster's own HTML of every line left as it was — a changed line never takes its neighbours' formatting
// with it.

import { describe, expect, it } from 'vitest';

import { isOmNoteHtml, omNoteText, omNoteWrite } from './notes-html';

/** ChatSpace's editor (TipTap): one paragraph per line, a bullet list's items hold a paragraph, a heading is a span. */
const QUESTIONNAIRE = '<p><span class="m-editor-fs__heading">Анкета</span></p><p><strong>Имя:</strong> Анна</p><p>Локация: Берлин</p><p>Возраст: 34</p>';
const FETISHES = '<p>Фетиши:</p><ul><li><p>ноги</p></li><li><p><em>латекс</em></p></li><li><p>чулки</p></li></ul>';

describe('a note as lines', () => {
  it('plain text, as the team writes it: its lines as they are', () => {
    expect(omNoteText('Любит долгие разговоры\nПишет по вечерам')).toBe('Любит долгие разговоры\nПишет по вечерам');
    expect(omNoteText('Имя: Анна\r\nЛокация: Берлин')).toBe('Имя: Анна\nЛокация: Берлин');
    // ChatSpace shows a body that does not start with `<p` or `<ul` as text, tags and all.
    expect(isOmNoteHtml('<b>важно</b> не забыть')).toBe(false);
    expect(omNoteText('<b>важно</b> не забыть')).toBe('<b>важно</b> не забыть');
  });

  it('paragraphs, a heading and bold: a line each, tags stripped', () => {
    expect(isOmNoteHtml(QUESTIONNAIRE)).toBe(true);
    expect(omNoteText(QUESTIONNAIRE)).toBe('Анкета\nИмя: Анна\nЛокация: Берлин\nВозраст: 34');
  });

  it('`br` ends a line; one at a paragraph’s end adds none; ChatSpace’s own empty line between paragraphs is one', () => {
    expect(omNoteText('<p>Имя: Анна<br>Локация: Берлин</p>')).toBe('Имя: Анна\nЛокация: Берлин');
    expect(omNoteText('<p>Имя: Анна<br></p><p>Локация: Берлин<br> </p>')).toBe('Имя: Анна\nЛокация: Берлин');
    expect(omNoteText('<p>а</p><br><p>б</p>')).toBe('а\n\nб');
    expect(omNoteText('<p>а<br><br>б</p>')).toBe('а\n\nб');
  });

  it('a list: an item a line, with or without its paragraph', () => {
    expect(omNoteText(FETISHES)).toBe('Фетиши:\nноги\nлатекс\nчулки');
    expect(omNoteText('<ul><li>ноги</li><li>латекс</li></ul><p>Итог</p>')).toBe('ноги\nлатекс\nИтог');
  });

  it('an empty paragraph is an empty line; whitespace shows as a browser shows it', () => {
    expect(omNoteText('<p>а</p><p></p><p>б</p>')).toBe('а\n\nб');
    expect(omNoteText('<p>\n  Имя:   <strong>Анна</strong>\n</p>\n<p>Город</p>')).toBe('Имя: Анна\nГород');
  });

  it('entities: the named few and any number', () => {
    expect(omNoteText('<p>Tom &amp; Jerry &lt;3 &quot;привет&quot; it&#39;s&nbsp;ok &#x1F600; &#128512; &hellip;</p>')).toBe('Tom & Jerry <3 "привет" it\'s ok 😀 😀 &hellip;');
  });

  it('a body cut in the middle of a tag still reads', () => {
    expect(omNoteText('<p>Имя: Анна</p><p>Локация: <str')).toBe('Имя: Анна\nЛокация:');
  });
});

describe('lines as a note', () => {
  it('a plain note, or a new one, is written as plain text', () => {
    expect(omNoteWrite('Имя: Анна\nЛокация: Берлин', 'Имя: Анна\nЛокация: Мюнхен')).toBe('Имя: Анна\nЛокация: Мюнхен');
    expect(omNoteWrite(null, 'Имя: Анна')).toBe('Имя: Анна');
    // Text ChatSpace would take for HTML goes as paragraphs, so it shows as typed.
    expect(omNoteWrite(null, '<p>не тег</p>\nи всё')).toBe('<p>&lt;p&gt;не тег&lt;/p&gt;</p><p>и всё</p>');
    expect(omNoteText(omNoteWrite(null, '<p>не тег</p>\nи всё'))).toBe('<p>не тег</p>\nи всё');
  });

  it('nothing left: nothing to write', () => {
    expect(omNoteWrite(QUESTIONNAIRE, ' \n ')).toBe('');
    expect(omNoteWrite(null, '')).toBe('');
  });

  it('unchanged: the very body', () => {
    expect(omNoteWrite(QUESTIONNAIRE, omNoteText(QUESTIONNAIRE))).toBe(QUESTIONNAIRE);
    expect(omNoteWrite(FETISHES, omNoteText(FETISHES))).toBe(FETISHES);
  });

  it('a changed line is a paragraph of its own; the bold and the heading of the others stay', () => {
    expect(omNoteWrite(QUESTIONNAIRE, 'Анкета\nИмя: Анна\nЛокация: Мюнхен\nВозраст: 34')).toBe(
      '<p><span class="m-editor-fs__heading">Анкета</span></p><p><strong>Имя:</strong> Анна</p><p>Локация: Мюнхен</p><p>Возраст: 34</p>',
    );
  });

  it('a removed line goes, a new one comes, escaped', () => {
    expect(omNoteWrite(QUESTIONNAIRE, 'Анкета\nИмя: Анна\nВозраст: 34\nРабота: <дизайнер> & "фриланс"')).toBe(
      '<p><span class="m-editor-fs__heading">Анкета</span></p><p><strong>Имя:</strong> Анна</p><p>Возраст: 34</p><p>Работа: &lt;дизайнер&gt; &amp; &quot;фриланс&quot;</p>',
    );
  });

  it('list items that stay together keep their list; a changed one leaves it', () => {
    expect(omNoteWrite(FETISHES, 'Фетиши:\nноги\nлатекс\nкожа')).toBe('<p>Фетиши:</p><ul><li><p>ноги</p></li><li><p><em>латекс</em></p></li></ul><p>кожа</p>');
    expect(omNoteWrite(FETISHES, 'Фетиши:\nноги\nЛАТЕКС\nчулки')).toBe('<p>Фетиши:</p><ul><li><p>ноги</p></li></ul><p>ЛАТЕКС</p><ul><li><p>чулки</p></li></ul>');
    // The whole list untouched: as it was, whatever changed around it.
    expect(omNoteWrite(FETISHES, 'Что любит:\nноги\nлатекс\nчулки')).toBe('<p>Что любит:</p><ul><li><p>ноги</p></li><li><p><em>латекс</em></p></li><li><p>чулки</p></li></ul>');
  });

  it('a kept line of a paragraph split by `br` keeps its own inline HTML, its tags closed', () => {
    expect(omNoteWrite('<p>Имя: Анна<br><strong>Город:</strong> Берлин</p>', 'Имя: Анна\nГород: Мюнхен')).toBe('<p>Имя: Анна</p><p>Город: Мюнхен</p>');
    expect(omNoteWrite('<p><em>Имя: Анна<br>Город: Берлин</em></p>', 'Имя: Анна\nГород: Мюнхен')).toBe('<p><em>Имя: Анна</em></p><p>Город: Мюнхен</p>');
    expect(omNoteWrite('<p><em>Имя: Анна<br>Город: Берлин</em></p>', 'Возраст: 34\nГород: Берлин')).toBe('<p>Возраст: 34</p><p><em>Город: Берлин</em></p>');
  });

  it('stays HTML to ChatSpace: a first piece of another kind goes as paragraphs', () => {
    const body = omNoteWrite('<p>Анкета</p><h2>Имя: Анна</h2>', 'Имя: Анна');
    expect(body).toBe('<p>Имя: Анна</p>');
    expect(isOmNoteHtml(body)).toBe(true);
  });

  it('round trip: what is written reads back as the lines the panel had', () => {
    const originals = [QUESTIONNAIRE, FETISHES, '<p>а<br>б</p><p></p><ul><li>в</li></ul>', 'Важная информация\nНИЧЕГО КРАСНОГО', null];
    const texts = ['Анкета\nИмя: Анна', 'Фетиши:\nчулки\nноги', 'а\n\nв\nг', 'Новая строка', 'Имя: Анна\n\nЛокация: Берлин'];
    for (const original of originals) {
      for (const text of texts) {
        const body = omNoteWrite(original, text);
        expect(omNoteText(body), `${original} ← ${text}`).toBe(text);
        if (original !== null && isOmNoteHtml(original)) expect(isOmNoteHtml(body), `${original} ← ${text}`).toBe(true);
      }
    }
  });
});
