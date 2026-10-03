// When the hub address of the settings may change (`settings.patchRestricted`,
// the options page only): never while signed in (ST-042 — the sign-in, the
// caches and the personas belong to one hub), and in a release build only to
// an https origin (a test build also talks to the loopback fake hub). The
// facade checks the scheme again at sign-in; this refusal comes earlier, with
// the save.

export type HubAddressRefusal = 'signed in' | 'https only';

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
  if (!input.testBuild && !input.next.startsWith('https://')) return 'https only';
  return null;
}
