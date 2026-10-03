// The hub address rule of `settings.patchRestricted` (composition/background/hub-address.ts).

import { describe, expect, it } from 'vitest';

import { hubAddressRefusal } from '../src/composition/background/hub-address';

const HUB = 'https://gosling-agency.ru';

describe('hub address changes', () => {
  it('[ST-042] the address changes only while signed out', () => {
    expect(hubAddressRefusal({ next: 'https://other.example.test', current: HUB, signedIn: true, testBuild: false })).toBe('signed in');
    expect(hubAddressRefusal({ next: 'https://other.example.test', current: HUB, signedIn: false, testBuild: false })).toBeNull();
  });

  it('[ST-042] a patch that leaves the address as it is passes while signed in (other restricted settings change then)', () => {
    expect(hubAddressRefusal({ next: undefined, current: HUB, signedIn: true, testBuild: false })).toBeNull();
    expect(hubAddressRefusal({ next: HUB, current: HUB, signedIn: true, testBuild: false })).toBeNull();
  });

  it('a release build takes an https hub only; a test build also the loopback fake hub', () => {
    expect(hubAddressRefusal({ next: 'http://127.0.0.1:8787', current: HUB, signedIn: false, testBuild: false })).toBe('https only');
    expect(hubAddressRefusal({ next: 'http://hub.example.test', current: HUB, signedIn: false, testBuild: false })).toBe('https only');
    expect(hubAddressRefusal({ next: 'http://127.0.0.1:8787', current: HUB, signedIn: false, testBuild: true })).toBeNull();
  });
});
