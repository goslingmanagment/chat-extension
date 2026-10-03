// One request to the hub, end to end, as facts: a checked answer or a
// HubFailure. Two paths: the vendored SDK (sdk-transport.ts) and the
// RouteTransport for client/* routes not vendored yet (route-transport.ts).
// Nothing here retries, wipes a sign-in or shows anything: the facade reads
// the facts (errors, dispositions, the 401 rule).

import { HUB_ROUTE_SCHEMAS, type AbortSignalLike, type HubFailure } from '@cg/contracts';

import { transportFailure } from './errors';
import { type FetchLike, type HubClock } from './ports';
import { clientWireRequest, sendClientRoute, type ClientRouteKey } from './route-transport';
import { checkSdkAnswer, sendSdkOperation, type SdkOperation, type SdkRawInput } from './sdk-transport';
import { callScope, httpFailureOf, readJson, thrownFailure } from './wire';

export interface WireCall {
  readonly hubOrigin: string;
  /** null: a public route (sign-in, health). */
  readonly token: string | null;
  /** The caller's signal, the sign-in epoch's signal… any of them cancels the call. */
  readonly signals: readonly (AbortSignalLike | undefined)[];
  readonly timeoutMs: number | null;
}

export type WireResult = { readonly ok: true; readonly value: unknown; readonly status: number } | { readonly ok: false; readonly failure: HubFailure; readonly body: unknown };

export interface WireDeps {
  readonly fetch: FetchLike;
  readonly clock: HubClock;
  readonly headers: () => Readonly<Record<string, string>>;
}

const contractFailure = (): WireResult => ({ ok: false, failure: transportFailure('contract'), body: null });

export class HubWire {
  constructor(private readonly deps: WireDeps) {}

  async sdk(operation: SdkOperation, call: WireCall, input: SdkRawInput = {}): Promise<WireResult> {
    const scope = callScope(this.deps.clock, call.signals, call.timeoutMs);
    try {
      const response = await sendSdkOperation(
        { hubOrigin: call.hubOrigin, token: call.token, headers: this.deps.headers(), fetch: this.deps.fetch, signal: scope.signal },
        operation,
        input,
      );
      // `health` answers 503 with its own shape: a degraded hub, not an error.
      if (!response.ok && !(operation === 'health' && response.status === 503)) {
        const { failure, body } = await httpFailureOf(response, this.deps.clock.now());
        return { ok: false, failure, body };
      }
      const read = await readJson(response);
      if (!read.ok) return scope.signal.aborted ? { ok: false, failure: thrownFailure(null, scope), body: null } : contractFailure();
      const checked = checkSdkAnswer(operation, response.status, read.value);
      return checked.ok ? { ok: true, value: checked.value, status: response.status } : contractFailure();
    } catch (error) {
      return { ok: false, failure: thrownFailure(error, scope), body: null };
    } finally {
      scope.dispose();
    }
  }

  async client(route: ClientRouteKey, call: WireCall & { readonly token: string }, request: unknown): Promise<WireResult> {
    let wire;
    try {
      wire = clientWireRequest(route, request);
    } catch {
      return contractFailure();
    }
    const scope = callScope(this.deps.clock, call.signals, call.timeoutMs);
    try {
      const response = await sendClientRoute(
        { hubOrigin: call.hubOrigin, token: call.token, headers: this.deps.headers(), fetch: this.deps.fetch, signal: scope.signal },
        wire,
      );
      if (!response.ok) {
        const { failure, body } = await httpFailureOf(response, this.deps.clock.now());
        return { ok: false, failure, body };
      }
      const read = await readJson(response);
      if (!read.ok) return scope.signal.aborted ? { ok: false, failure: thrownFailure(null, scope), body: null } : contractFailure();
      const checked = HUB_ROUTE_SCHEMAS[route].response.safeParse(read.value);
      return checked.success ? { ok: true, value: checked.data, status: response.status } : contractFailure();
    } catch (error) {
      return { ok: false, failure: thrownFailure(error, scope), body: null };
    } finally {
      scope.dispose();
    }
  }
}
