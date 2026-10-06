import { describe, expect, it } from 'vitest';

import { AFTER_PUBLISHING, BEFORE_SIGNING, noteProblems, readNote, renderNote } from './note.ts';

const tickAll = (note: string, ids: readonly string[]): string => ids.reduce((text, id) => text.replace(`- [ ] \`${id}\``, `- [x] \`${id}\``), note);
const required = BEFORE_SIGNING.map((item) => item.id);

describe('the release note', () => {
  it('a fresh note lists every line unticked, and the gate names each', () => {
    const note = renderNote('0.1.0');
    expect(note.startsWith('# Выпуск 0.1.0\n')).toBe(true);
    expect([...readNote(note)]).toEqual([...BEFORE_SIGNING, ...AFTER_PUBLISHING].map((item) => [item.id, false]));
    expect(noteProblems(note, '0.1.0')).toEqual(required.map((id) => `not ticked: \`${id}\``));
  });

  it('[UP-003] passes only when every line of «Перед подписью» is ticked; the lines after publishing do not hold a release', () => {
    const note = renderNote('0.1.0');
    expect(noteProblems(tickAll(note, required), '0.1.0')).toEqual([]);
    expect(noteProblems(tickAll(note, required.slice(1)), '0.1.0')).toEqual([`not ticked: \`${required[0]}\``]);
    expect(noteProblems(tickAll(note, AFTER_PUBLISHING.map((item) => item.id)), '0.1.0')).toHaveLength(required.length);
  });

  it('a tick is x in either alphabet and may be followed by what was seen', () => {
    const note = renderNote('0.1.0').replace('- [ ] `smoke` —', '- [х] `smoke` — ChatSpace 0.172.0, 12 октября.').replace('- [ ] `e2e`', '- [X] `e2e`');
    expect(readNote(note).get('smoke')).toBe(true);
    expect(readNote(note).get('e2e')).toBe(true);
    expect(readNote(note).get('perf')).toBe(false);
  });

  it('no note, the note of another version or a removed line do not pass', () => {
    expect(noteProblems(null, '0.1.0')[0]).toMatch(/no release note for 0\.1\.0/);
    expect(noteProblems(tickAll(renderNote('0.0.9'), required), '0.1.0')[0]).toMatch(/note of another version/);
    const cut = tickAll(renderNote('0.1.0'), required).split('\n').filter((line) => !line.includes('`hub-383`')).join('\n');
    expect(noteProblems(cut, '0.1.0')).toEqual(['the line `hub-383` is missing from the note']);
  });
});
