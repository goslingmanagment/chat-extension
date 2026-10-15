// Egress probe — compiled into CG_TEST_HOSTS builds only (composition checks
// the compile-time constant, so the release bundle drops it; `pnpm gates`
// checks). When one of our own extension pages writes the probe key to
// storage.local, the background fetches one fixed `.invalid` URL: the e2e
// proves with it that the egress check sees background requests, which the
// BiDi network log does not.

/** storage.local key an extension page of the test build writes to ask for the probe. */
export const EGRESS_PROBE_KEY = 'cg.test.egressProbe';
/** Never resolvable (RFC 6761); in e2e the profile's proxy sends it to the egress sink. */
export const EGRESS_PROBE_URL = 'https://cg-bg-probe.invalid/probe';

export function fireEgressProbe(send: (url: string, init: RequestInit) => Promise<unknown>): void {
  void send(EGRESS_PROBE_URL, { cache: 'no-store', credentials: 'omit' }).catch(() => undefined);
}
