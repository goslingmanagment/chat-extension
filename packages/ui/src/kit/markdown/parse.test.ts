import { describe, expect, it } from 'vitest';

import { MD_MAX_CHARS, markdownText, parseInline, parseMarkdown, safeHref, type MdBlock } from './parse';

describe('safe Markdown: links', () => {
  it('keeps only https targets', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHref(' <https://example.com> ')).toBe('https://example.com/');
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'data:text/html,x', 'moz-extension://x', '//example.com', 'https://', 'HTTPS://ex ample.com']) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });

  it('turns an unsafe link into its plain label and an https one into a link', () => {
    // The URL ends at the first `)`: the label stays as text, the rest too, nothing is a link.
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ t: 'text', v: 'click)' }]);
    expect(parseInline('see [docs](https://ex.com/d)')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'link', href: 'https://ex.com/d', c: [{ t: 'text', v: 'docs' }] },
    ]);
  });

  it('links bare https URLs without trailing punctuation, never inside a word', () => {
    expect(parseInline('go https://ex.com/a.')).toEqual([
      { t: 'text', v: 'go ' },
      { t: 'link', href: 'https://ex.com/a', c: [{ t: 'text', v: 'https://ex.com/a' }] },
      { t: 'text', v: '.' },
    ]);
    expect(parseInline('xhttps://ex.com')).toEqual([{ t: 'text', v: 'xhttps://ex.com' }]);
    expect(parseInline('http://ex.com')).toEqual([{ t: 'text', v: 'http://ex.com' }]);
  });
});

describe('safe Markdown: raw HTML is text', () => {
  it('never interprets tags, entities or event handlers', () => {
    const html = '<img src=x onerror="alert(1)"> <b>bold</b> &amp; <script>x</script>';
    expect(markdownText(parseMarkdown(html))).toBe(html);
    expect(JSON.stringify(parseMarkdown(html))).not.toContain('"t":"html"');
  });
});

describe('safe Markdown: inline', () => {
  it('reads strong, emphasis, code and escapes', () => {
    expect(parseInline('**Деньги:** $320')).toEqual([{ t: 'strong', c: [{ t: 'text', v: 'Деньги:' }] }, { t: 'text', v: ' $320' }]);
    expect(parseInline('a *b* _c_ `d*e`')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'em', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'd*e' },
    ]);
    expect(parseInline('\\*not em\\*')).toEqual([{ t: 'text', v: '*not em*' }]);
    expect(parseInline('snake_case_name')).toEqual([{ t: 'text', v: 'snake_case_name' }]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ t: 'text', v: '2 * 3 * 4' }]);
    expect(parseInline('line\nbreak')).toEqual([{ t: 'text', v: 'line' }, { t: 'br' }, { t: 'text', v: 'break' }]);
    expect(parseInline('`` a ` b ``')).toEqual([{ t: 'code', v: 'a ` b' }]);
    expect(parseInline('`open')).toEqual([{ t: 'text', v: '`open' }]);
  });

  it('bounds nesting depth', () => {
    const deep = parseInline('*'.repeat(1) + '**_*a*_**' + '*');
    expect(markdownText([{ t: 'p', c: deep }])).toContain('a');
  });
});

describe('safe Markdown: blocks', () => {
  it('headings, paragraphs, lists, quotes, code fences and rules', () => {
    const blocks = parseMarkdown(['## Итог ##', '', 'Первый абзац', 'вторая строка', '', '- один', '- два', '  продолжение', '', '3. три', '4. четыре', '', '> цитата', '', '```', '<b>код</b>', '```', '', '---', '# C#'].join('\n'));
    expect(blocks.map((block) => block.t)).toEqual(['h', 'p', 'ul', 'ol', 'quote', 'pre', 'hr', 'h']);
    const [heading, paragraph, list, ordered, , pre, , csharp] = blocks as [MdBlock, MdBlock, MdBlock, MdBlock, MdBlock, MdBlock, MdBlock, MdBlock];
    expect(heading).toEqual({ t: 'h', level: 2, c: [{ t: 'text', v: 'Итог' }] });
    expect(paragraph).toEqual({ t: 'p', c: [{ t: 'text', v: 'Первый абзац' }, { t: 'br' }, { t: 'text', v: 'вторая строка' }] });
    expect(list.t === 'ul' && list.items.length).toBe(2);
    expect(ordered.t === 'ol' && ordered.start).toBe(3);
    expect(pre).toEqual({ t: 'pre', v: '<b>код</b>' });
    expect(csharp).toEqual({ t: 'h', level: 1, c: [{ t: 'text', v: 'C#' }] });
    expect(markdownText(blocks)).toContain('один\nдва\nпродолжение');
  });

  it('nested lists keep their items', () => {
    const blocks = parseMarkdown('- a\n  - b\n  - c\n- d');
    expect(blocks).toHaveLength(1);
    const list = blocks[0] as Extract<MdBlock, { t: 'ul' }>;
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.some((block) => block.t === 'ul')).toBe(true);
  });

  it('cuts input past the limit', () => {
    const text = markdownText(parseMarkdown('a'.repeat(MD_MAX_CHARS + 50)));
    expect(text.length).toBe(MD_MAX_CHARS);
  });
});

describe('[AI-137] Markdown is parsed once per finished text, in linear time on hostile input', () => {
  it('runs of unmatched delimiters and long blank headings stay fast', () => {
    const inputs = [
      '*a '.repeat(30_000),
      '[x'.repeat(40_000),
      '`'.repeat(50_000),
      `#${' '.repeat(90_000)}x`,
      '_a'.repeat(40_000),
      '**a '.repeat(20_000),
    ];
    for (const input of inputs) {
      const started = performance.now();
      parseMarkdown(input);
      expect(performance.now() - started, input.slice(0, 8)).toBeLessThan(400);
    }
  });
});
