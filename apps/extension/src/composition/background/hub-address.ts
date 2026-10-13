// When the hub address of the settings may change (`settings.patchRestricted`,
// the options page only): never while signed in (ST-042 — the sign-in, the
// caches and the personas belong to one hub), never to the host platform
// (quiet mode, §2, X3: a hub there would make the background send its own
// requests to it — `health` with every status surface, the sign-in with the
// hub login and password — and the browser would not even ask, the host
// permission is already there), and in a release build only to an https
// origin (a test build also talks to the loopback fake hub). The facade checks
// the scheme again at sign-in; this refusal comes earlier, with the save.

import { isQuietHost } from '../../hosts/runtime';

export type HubAddressRefusal = 'signed in' | 'host platform' | 'https only';

export function hubAddressRefusal(input: {
  /** `patch.hub.baseUrl`; undefined — the patch does not touch it. */
  readonly next: string | undefined;
  readonly current: string;
  /** Any sign-in the hub layer holds, usable or not. */
  readonly signedIn: boolean;
  readonly testBuild: boolean;
}): HubAddressRefusal | null {
  if (input.next === undefined || input.next === input.current) return null;
  if (input.signedIn) return 'signed in';
  if (isQuietHost(input.next)) return 'host platform';
  if (!input.testBuild && !input.next.startsWith('https://')) return 'https only';
  return null;
}

/**
 * The background's `fetch` for the hub layer: a request to the host platform
 * is refused before it leaves, as a network failure — whatever address a
 * hand-edited storage or an older build left in the settings.
 */
export function quietFetch(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>, onRefused: () => void): (input: string, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    if (!isQuietHost(input)) return fetchImpl(input, init);
    onRefused();
    return Promise.reject(new TypeError('NetworkError: the hub address points at the host platform'));
  };
}
