import { describe, expect, it, vi } from 'vitest';

import { createReportBoardBackground } from './report-board';

const row = (platformRef: string) => ({ platformRef, kind: '7101', occurredAt: '2026-11-15T12:00:00.000Z', netMills: 8000, grossMills: null, fanRef: null, fanName: null });

function background() {
  const saleSightings = vi.fn(async () => true);
  let now = 1_000_000;
  const board = createReportBoardBackground({
    hub: () => ({ frameRelay: async () => ({ error: 'refused' as const }), saleSightings }),
    tabs: () => [],
    ports: () => [],
    pageOf: (key) => (key === 'fansly-web:42' ? 'test-1' : null),
    focus: async () => true,
    servesCustoms: () => false,
    emit: () => 0,
    now: () => now,
    log: () => undefined,
  });
  return { board, saleSightings, tick: (ms: number) => (now += ms) };
}

describe('sightings go to Hub only for a person with the board', () => {
  it('sends nothing while the pulse says report: null (or before any pulse)', async () => {
    const { board, saleSightings } = background();
    expect(await board.sightings('fansly-web:42', [row('1')])).toBe(false);
    board.pulse(null);
    expect(await board.sightings('fansly-web:42', [row('1')])).toBe(false);
    board.pulse({ shiftId: 1, phase: 'draft', needsMe: false });
    board.pulse(undefined);
    expect(await board.sightings('fansly-web:42', [row('1')])).toBe(false);
    expect(saleSightings).not.toHaveBeenCalled();
  });

  it('with the board: each row once, a page at most every 15 s, nothing for an unbound account', async () => {
    const { board, saleSightings, tick } = background();
    board.pulse({ shiftId: 1, phase: 'draft', needsMe: false });
    expect(await board.sightings('fansly-web:7', [row('1')])).toBe(false);
    expect(await board.sightings('fansly-web:42', [row('1'), row('2')])).toBe(true);
    tick(1_000);
    expect(await board.sightings('fansly-web:42', [row('3')])).toBe(false);
    tick(20_000);
    expect(await board.sightings('fansly-web:42', [row('1'), row('2')])).toBe(false);
    expect(await board.sightings('fansly-web:42', [row('2'), row('3')])).toBe(true);
    expect(saleSightings).toHaveBeenCalledTimes(2);
    expect(saleSightings.mock.calls[1]).toEqual([{ pageLabel: 'test-1', rows: [row('3')] }]);
    board.sessionChanged();
    tick(20_000);
    expect(await board.sightings('fansly-web:42', [row('4')])).toBe(false);
  });
});
