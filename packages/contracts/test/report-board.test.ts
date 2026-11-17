import { describe, expect, it } from 'vitest';

import { PRODUCTION_HUB_ORIGIN, PRODUCTION_TEAM_ORIGIN, frameOriginOf, teamOriginOf } from '../src/report-board';

describe('where Workboard is for a hub address: frames on the hub\'s root name, tabs on the team\'s', () => {
  it('maps both of production Hub\'s API names: the frames to the root (2026-11-17), a tab to the team\'s name (round 2, N8)', () => {
    for (const hub of ['https://gosling-agency.ru', 'https://hub.gosling-agency.ru']) {
      expect(frameOriginOf(hub)).toBe(PRODUCTION_HUB_ORIGIN);
      expect(teamOriginOf(hub)).toBe(PRODUCTION_TEAM_ORIGIN);
    }
  });

  it('keeps any other hub as it is (a dev hub, the stand)', () => {
    for (const hub of ['http://127.0.0.1:4100', 'https://hub.example.test', 'https://chatgoose.gosling-agency.ru']) {
      expect(frameOriginOf(hub)).toBe(hub);
      expect(teamOriginOf(hub)).toBe(hub);
    }
  });
});
