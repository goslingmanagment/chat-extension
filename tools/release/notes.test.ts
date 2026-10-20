import { describe, expect, it } from 'vitest';

import { parseChangelog, sectionOf } from './changelog.ts';
import { changelogSection, chatterLine, githubNotes, withSections } from './notes.ts';

describe('what is new, from the commits', () => {
  it('a chatter reads features and fixes without the prefix and the PR number; docs, tests, CI and chores are left out', () => {
    expect(chatterLine('feat(ai): reply drafts keep the last messages (#240)')).toBe('Reply drafts keep the last messages.');
    expect(chatterLine('fix: Spenders opens on the first click!')).toBe('Spenders opens on the first click!');
    expect(chatterLine('Align the browser snapshot check (#233)')).toBe('Align the browser snapshot check.');
    for (const subject of ['docs(release): record 0.5.7 (#234)', 'test(ai): verify (#235)', 'ci: faster', 'chore!: lean', 'refactor(core): split']) expect(chatterLine(subject), subject).toBeNull();
  });

  it('what the changelog would refuse is made plain: stray marks, links, an odd backtick', () => {
    expect(chatterLine('fix: **bold** and [a](b) and `one')).toBe('Bold and [a] (b) and one.');
    expect(chatterLine('fix: the `Reply` button')).toBe('The `Reply` button.');
  });

  it('a section that parses, a fallback line when nothing is for chatters, and the sections on top of the committed file', () => {
    const committed = '# Что нового\n\n## 0.5.7\n\n- Старое.\n';
    const text = withSections(committed, [changelogSection('0.5.9', ['feat: new **thing** (#2)']), changelogSection('0.5.8', ['docs: x'])]);
    const changelog = parseChangelog(text);
    expect(changelog.sections.map((section) => section.version)).toEqual(['0.5.9', '0.5.8', '0.5.7']);
    expect(sectionOf(changelog, '0.5.8').blocks).toEqual([{ kind: 'list', items: [[{ kind: 'text', text: 'Исправления и улучшения.' }]] }]);
    expect(withSections(committed, [])).toBe(committed);
  });

  it('the GitHub release lists every commit as it is, with the comparison to the previous tag', () => {
    expect(githubNotes({ version: '0.5.8', previous: '0.5.7', subjects: ['docs: x (#1)', 'feat: y (#2)'], repo: 'org/repo' })).toBe(
      '- docs: x (#1)\n- feat: y (#2)\n\nhttps://github.com/org/repo/compare/v0.5.7...v0.5.8\n',
    );
  });
});
