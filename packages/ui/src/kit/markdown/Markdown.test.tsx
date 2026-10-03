import { render, type ComponentChild } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';

import { Markdown, MarkdownView } from './Markdown';
import { parseMarkdown } from './parse';

let host: HTMLElement | null = null;
function draw(node: ComponentChild): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  render(node, host);
  return host;
}

afterEach(() => {
  if (host !== null) render(null, host);
  host?.remove();
  host = null;
});

describe('safe Markdown renderer (architecture.md §14: no innerHTML with data)', () => {
  it('renders the AST as elements; markup in the text stays text', () => {
    const root = draw(<Markdown source={'## Вердикт\n\n**Хорошо:** <img src=x onerror=alert(1)>\n\n- раз\n- два\n\n1. a\n\n> q\n\n```\n<b>x</b>\n```\n\n---\n\n*тихо* `код`'} />);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('h4')?.textContent).toBe('Вердикт');
    expect(root.querySelector('strong')?.textContent).toBe('Хорошо:');
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.querySelectorAll('ul > li')).toHaveLength(2);
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('1');
    expect(root.querySelector('blockquote')?.textContent).toBe('q');
    expect(root.querySelector('pre code')?.textContent).toBe('<b>x</b>');
    expect(root.querySelector('hr')).not.toBeNull();
    expect(root.querySelector('em')?.textContent).toBe('тихо');
    expect(root.querySelector('p > code')?.textContent).toBe('код');
  });

  it('links are https only and open in a new tab without an opener', () => {
    const root = draw(<Markdown source="[a](https://ex.com/a) [b](javascript:alert(1)) https://ex.com/c" class="cg-x" />);
    const links = [...root.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://ex.com/a', 'https://ex.com/c']);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(root.querySelector('.cg-md')?.classList.contains('cg-x')).toBe(true);
  });

  it('[AI-137] parses once per text, not per render', () => {
    const ast = parseMarkdown('# A\n\nb');
    const root = draw(<MarkdownView ast={ast} />);
    expect(root.querySelector('h3')?.textContent).toBe('A');
    render(<MarkdownView ast={ast} />, root);
    expect(root.querySelectorAll('.cg-md')).toHaveLength(1);
  });
});
