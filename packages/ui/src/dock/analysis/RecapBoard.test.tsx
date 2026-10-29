// «Сводка» (2026-10-29): «Что делать сейчас» sets large only what the Recap names as the thing to do; what to avoid
// keeps its label and its colour wherever it stands.

import { describe, expect, it } from 'vitest';

import { type RecapPartVM, type RecapSectionVM } from '@cg/contracts/vm';

import { heroOf } from './RecapBoard';

const text = (label: string | null, body: string, tone: RecapPartVM['tone'] = null): RecapPartVM => ({ kind: 'text', label, note: null, tone, text: body, figure: null, scale: null });

describe('[2026-10-29] «Что делать сейчас» of the board', () => {
  it('never sets what to avoid large as the thing to do', () => {
    const section: RecapSectionVM = { key: 'strategy', name: 'Стратегия', parts: [text('Чего избегать', 'Давить на покупку.', 'avoid'), text('Тактика', 'Спросить про отпуск.')] };
    expect(heroOf(section).pieces.map((piece) => [piece.kind, piece.label, piece.avoid])).toEqual([
      ['para', 'Чего избегать', true],
      ['para', 'Тактика', false],
    ]);
  });

  it('leads with the approach, what to avoid after it', () => {
    const section: RecapSectionVM = { key: 'strategy', name: 'Стратегия', parts: [text('Чего избегать', 'Давить на покупку.', 'avoid'), text('Рекомендуемый подход', 'Спросить про отпуск.', 'act')] };
    expect(heroOf(section).pieces.map((piece) => [piece.kind, piece.label, piece.avoid, piece.text])).toEqual([
      ['lead', null, false, 'Спросить про отпуск.'],
      ['para', 'Чего избегать', true, 'Давить на покупку.'],
    ]);
  });

  it('takes «Следующий ход» for the move, never what to avoid in it', () => {
    const section: RecapSectionVM = { key: 'nextMove', name: 'Следующий ход', parts: [text('Чего избегать', 'Давить на покупку.', 'avoid'), text(null, 'Спросить про перелёт.')] };
    expect(heroOf(section).pieces.map((piece) => [piece.kind, piece.text])).toEqual([
      ['lead', 'Спросить про перелёт.'],
      ['para', 'Давить на покупку.'],
    ]);
  });
});
