// Hash routes of the options page (architecture.md §9.5; ST-003, ST-007).

import { describe, expect, it } from 'vitest';

import { SETTINGS_SECTIONS } from '@cg/contracts';

import { DEFAULT_SECTION, hashOfRoute, routeOfHash, sectionOfCode } from './route';

describe('routeOfHash', () => {
  it('[ST-003] every section opens by its name, with or without `#`', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(routeOfHash(`#${section}`)).toEqual({ section });
      expect(routeOfHash(section)).toEqual({ section });
    }
  });

  it('[ST-003] `#section:CODE` keeps the section the link named and carries the code', () => {
    expect(routeOfHash('#account:CG-HUB-URL')).toEqual({ section: 'account', code: 'CG-HUB-URL' });
    expect(routeOfHash('#status:CG-QUOTA-DAILY')).toEqual({ section: 'status', code: 'CG-QUOTA-DAILY' });
    // An unknown code is dropped, the section stays.
    expect(routeOfHash('#account:CG-NO-SUCH-CODE')).toEqual({ section: 'account' });
  });

  it('[ST-007] a code alone opens the section its registry entry names', () => {
    expect(routeOfHash('#CG-HUB-URL')).toEqual({ section: sectionOfCode('CG-HUB-URL'), code: 'CG-HUB-URL' });
    expect(routeOfHash('#:CG-HUB-URL')).toEqual({ section: sectionOfCode('CG-HUB-URL'), code: 'CG-HUB-URL' });
    expect(sectionOfCode('CG-HUB-URL')).toBe('account');
  });

  it('[ST-003] garbage opens «Статус»', () => {
    for (const hash of ['', '#', '#nope', '#a:b:c', '#%E0%A4%A', '#status:CG-HUB-URL:extra', '#<script>']) expect(routeOfHash(hash)).toEqual({ section: DEFAULT_SECTION });
  });

  it('reads an escaped hash and writes a plain one', () => {
    expect(routeOfHash('#account%3ACG-HUB-URL')).toEqual({ section: 'account', code: 'CG-HUB-URL' });
    expect(hashOfRoute({ section: 'status' })).toBe('status');
    expect(hashOfRoute({ section: 'account', code: 'CG-HUB-URL' })).toBe('account:CG-HUB-URL');
    for (const section of SETTINGS_SECTIONS) expect(routeOfHash(`#${hashOfRoute({ section, code: 'CG-AUTH-REQUIRED' })}`)).toEqual({ section, code: 'CG-AUTH-REQUIRED' });
  });
});
