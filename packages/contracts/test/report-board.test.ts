import { describe, expect, it } from 'vitest';

import { PRODUCTION_TEAM_ORIGIN, teamOriginOf } from '../src/report-board';

describe('teamOriginOf: where Workboard draws its frames for a hub address', () => {
  it('maps both of production Hub\'s API names to the team\'s name (round 2, N8)', () => {
    expect(teamOriginOf('https://gosling-agency.ru')).toBe(PRODUCTION_TEAM_ORIGIN);
    expect(teamOriginOf('https://hub.gosling-agency.ru')).toBe(PRODUCTION_TEAM_ORIGIN);
  });

  it('keeps any other hub as it is (a dev hub, the stand)', () => {
    expect(teamOriginOf('http://127.0.0.1:4100')).toBe('http://127.0.0.1:4100');
    expect(teamOriginOf('https://hub.example.test')).toBe('https://hub.example.test');
    expect(teamOriginOf('https://chatgoose.gosling-agency.ru')).toBe('https://chatgoose.gosling-agency.ru');
  });
});
