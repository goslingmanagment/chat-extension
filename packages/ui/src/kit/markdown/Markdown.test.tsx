import { render, type ComponentChild } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';

import { Markdown, decorateText } from './Markdown';

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
    const root = draw(<Markdown source={'**Хорошо:** <img src=x onerror=alert(1)>\n\n```\n<b>x</b>\n```'} />);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.querySelector('pre code')?.textContent).toBe('<b>x</b>');
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
});

describe('[2026-10-29] the sums of a Recap and a Review', () => {
  it('are marked whole, never from the middle of a number', () => {
    const sums = decorateText('всего 1,200 $ за год, сеты по 81,97 $ и 10-20 $, итого 1 200 $').flatMap((piece) => (typeof piece !== 'string' && piece.kind === 'money' ? [piece.text] : []));
    expect(sums).toEqual(['1,200 $', '81,97 $', '10-20 $', '1 200 $']);
  });
});
