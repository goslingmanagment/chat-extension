// Egress probe — compiled into CG_TEST_HOSTS builds only (composition checks
// the compile-time constant, so the release bundle drops it; `pnpm gates`
// checks). On a probe message from our own extension page the background
// fetches one fixed `.invalid` URL: the e2e proves with it that the egress
// check sees background requests, which the BiDi network log does not.

export const EGRESS_PROBE_MESSAGE = 'cg-test-egress-probe';
/** Never resolvable (RFC 6761); in e2e the profile's proxy sends it to the egress sink. */
export const EGRESS_PROBE_URL = 'https://cg-bg-probe.invalid/probe';

export function isEgressProbe(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && Object.keys(raw).length === 1 && (raw as Record<string, unknown>)['t'] === EGRESS_PROBE_MESSAGE;
}

export function fireEgressProbe(): void {
  void fetch(EGRESS_PROBE_URL, { cache: 'no-store', credentials: 'omit' }).catch(() => undefined);
}
