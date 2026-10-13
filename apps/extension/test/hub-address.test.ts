// The hub address rule of `settings.patchRestricted` and the quiet-mode guard
// of the background's fetch (composition/background/hub-address.ts).

import { describe, expect, it, vi } from 'vitest';

import { hubAddressRefusal, quietFetch } from '../src/composition/background/hub-address';
import { HUB_HOST_PERMISSION } from '../src/hosts/index.ts';
import { CHATSPACE_MATCHES, RUNTIME_HOSTS, isQuietHost } from '../src/hosts/runtime/index.ts';

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

  it('[ST-042] the host platform is never a hub address, in a release and in a test build alike (quiet mode, X3)', () => {
    const chatSpace = new URL(CHATSPACE_MATCHES[0] ?? '').origin;
    const domain = RUNTIME_HOSTS.chatspace.quietDomains[0] ?? '';
    const addresses = [chatSpace, `https://${domain}`, `https://api.${domain}`, `https://${domain}:8443`, `https://API.${domain.toUpperCase()}`, `https://${domain}.`, `http://chat.${domain}`];
    for (const next of addresses) {
      for (const testBuild of [false, true]) {
        expect({ next, testBuild, refusal: hubAddressRefusal({ next, current: HUB, signedIn: false, testBuild }) }).toEqual({ next, testBuild, refusal: 'host platform' });
      }
    }
    // A look-alike is another site: only the domain itself and its subdomains are the host platform.
    expect(hubAddressRefusal({ next: `https://not${domain}`, current: HUB, signedIn: false, testBuild: false })).toBeNull();
    expect(hubAddressRefusal({ next: `https://${domain}.example.test`, current: HUB, signedIn: false, testBuild: false })).toBeNull();
    // The sign-in rule still comes first.
    expect(hubAddressRefusal({ next: chatSpace, current: HUB, signedIn: true, testBuild: false })).toBe('signed in');
  });
});

describe('the background’s fetch in quiet mode', () => {
  it('the host platform is recognized by its host, the hub and everything else is not', () => {
    for (const pattern of CHATSPACE_MATCHES) expect(isQuietHost(pattern.replace('*', 'api/v2/users/me'))).toBe(true);
    expect(isQuietHost(HUB_HOST_PERMISSION.replace('*', 'api/v1/health'))).toBe(false);
    expect(isQuietHost('http://127.0.0.1:8787/api/v1/health')).toBe(false);
    expect(isQuietHost('not a url')).toBe(false);
  });

  it('a request to the host platform never leaves: it fails as a network error, and the hub’s own requests pass untouched', async () => {
    const sent: string[] = [];
    const refused = vi.fn();
    const guarded = quietFetch((input) => {
      sent.push(input);
      return Promise.resolve(new Response('{}'));
    }, refused);
    const chatSpace = new URL(CHATSPACE_MATCHES[0] ?? '').origin;
    await expect(guarded(`${chatSpace}/api/v1/health`)).rejects.toBeInstanceOf(TypeError);
    await expect(guarded(`${chatSpace}/api/v1/auth/device-tokens`, { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(TypeError);
    expect(refused).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([]);
    expect((await guarded(`${HUB}/api/v1/health`)).ok).toBe(true);
    expect(sent).toEqual([`${HUB}/api/v1/health`]);
  });
});
