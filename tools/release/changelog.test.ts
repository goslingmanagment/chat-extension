import { describe, expect, it } from 'vitest';

import { blocksHtml, blocksMarkdown, ChangelogError, parseChangelog, parseInline, sectionOf } from './changelog.ts';

const SAMPLE = [
  '# Что нового',
  '',
  '## 0.2.0 — 12 октября',
  '',
  'Короткое вступление,',
  'в две строки.',
  '',
  '### Новое',
  '',
  '- **Сигнал.** Звучит, когда `Reply` готов,',
  '  и это продолжение пункта.',
  '- Стоит $5 & <b>не тег</b>. [Подробнее](https://example.test/a?b=1&c=2)',
  '',
  '## 0.1.0',
  '',
  'Первая версия.',
  '',
].join('\n');

describe('CHANGELOG.md', () => {
  it('reads sections newest first, with paragraphs, subheadings, wrapped list items and inline marks', () => {
    const changelog = parseChangelog(SAMPLE);
    expect(changelog.sections.map((section) => [section.version, section.label])).toEqual([
      ['0.2.0', '12 октября'],
      ['0.1.0', ''],
    ]);
    const [intro, heading, list] = sectionOf(changelog, '0.2.0').blocks;
    expect(intro).toEqual({ kind: 'paragraph', inline: [{ kind: 'text', text: 'Короткое вступление, в две строки.' }] });
    expect(heading).toMatchObject({ kind: 'heading' });
    expect(list).toMatchObject({ kind: 'list' });
    if (list?.kind !== 'list') throw new Error('a list was expected');
    expect(list.items[0]).toEqual([
      { kind: 'bold', text: 'Сигнал.' },
      { kind: 'text', text: ' Звучит, когда ' },
      { kind: 'code', text: 'Reply' },
      { kind: 'text', text: ' готов, и это продолжение пункта.' },
    ]);
  });

  it('[UP-014] renders HTML with everything escaped: text never becomes markup', () => {
    const html = blocksHtml(sectionOf(parseChangelog(SAMPLE), '0.2.0').blocks, '  ');
    expect(html).toContain('  <p>Короткое вступление, в две строки.</p>');
    expect(html).toContain('  <h3>Новое</h3>');
    expect(html).toContain('<li><strong>Сигнал.</strong> Звучит, когда <code>Reply</code> готов, и это продолжение пункта.</li>');
    expect(html).toContain('Стоит $5 &amp; &lt;b&gt;не тег&lt;/b&gt;. <a href="https://example.test/a?b=1&amp;c=2" rel="noopener">Подробнее</a>');
    expect(html).not.toMatch(/<b>/);
  });

  it('[UP-005] writes the section back as Markdown for Telegram: a bare dollar escaped, a code span untouched', () => {
    const blocks = parseChangelog('# T\n\n## 1.0.0\n\nЦена $5 и `$HOME`, **за $1**.\n').sections[0]?.blocks ?? [];
    expect(blocksMarkdown(blocks)).toBe('Цена \\$5 и `$HOME`, **за \\$1**.');
    expect(blocksMarkdown(sectionOf(parseChangelog(SAMPLE), '0.2.0').blocks)).toContain('### Новое\n\n- **Сигнал.** Звучит');
  });

  it('refuses what it would render wrong, with the line', () => {
    const section = (body: string): string => `# T\n\n## 1.0.0\n\n${body}\n`;
    for (const [body, reason] of [
      ['#### глубже', /deeper than ###/],
      ['```\ncode\n```', /code fences/],
      ['> цитата', /quotes/],
      ['| a | b |', /tables/],
      ['1. первый', /numbered lists/],
      ['- пункт\n  - вложенный', /nested lists/],
      ['* пункт', /marked with \*/],
      ['<div>html</div>', /HTML/],
      ['---', /horizontal rules/],
      ['текст с **незакрытым жирным', /unmatched/],
      ['текст с `незакрытым кодом', /unmatched/],
      ['![картинка](https://example.test/a.png)', /image/],
      ['[ссылка](http://example.test)', /https/],
      ['[ссылка](javascript:alert(1))', /https|broken link/],
      ['  отступ без списка', /indented line/],
    ] as const) {
      expect(() => parseChangelog(section(body)), body).toThrow(reason);
      expect(() => parseChangelog(section(body)), body).toThrow(ChangelogError);
    }
    expect(() => parseChangelog(section('- пункт\n  - вложенный'))).toThrow(/CHANGELOG\.md:6:/);
  });

  it('refuses a file that is not a changelog: no title, a wrong heading, a wrong order, a repeat, an empty section', () => {
    expect(() => parseChangelog('## 1.0.0\n\nтекст\n')).toThrow(/no «# » title/);
    expect(() => parseChangelog('текст\n')).toThrow(/starts with a «# » title/);
    expect(() => parseChangelog('# T\n\nвступление\n\n## 1.0.0\n\nтекст\n')).toThrow(/between the title and the first/);
    expect(() => parseChangelog('# T\n\n## Версия 1\n\nтекст\n')).toThrow(/starts with its version/);
    expect(() => parseChangelog('# T\n\n## 1.0.0\n\nа\n\n## 1.1.0\n\nб\n')).toThrow(/newest version down/);
    expect(() => parseChangelog('# T\n\n## 1.0.0\n\nа\n\n## 1.0.0\n\nб\n')).toThrow(/each once/);
    expect(() => parseChangelog('# T\n\n## 1.0.0\n\n## 0.9.0\n\nб\n')).toThrow(/section of 1\.0\.0 is empty/);
    expect(() => sectionOf(parseChangelog(SAMPLE), '0.3.0')).toThrow(/no «## 0\.3\.0» section/);
    expect(parseInline('просто текст')).toEqual([{ kind: 'text', text: 'просто текст' }]);
  });
});
