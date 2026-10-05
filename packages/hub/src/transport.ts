// One request to the hub, end to end, as facts: a checked answer or a
// HubFailure. Two paths: the vendored SDK (sdk-transport.ts) and the
// RouteTransport for client/* routes not vendored yet (route-transport.ts).
// A client/* route takes whichever of the two has it: the day a route arrives
// in the SDK (HUB_ROUTES `since: 'sdk'`) it goes through the SDK's manifest
// and schemas, and nothing above this file changes.
// Nothing here retries, wipes a sign-in or shows anything: the facade reads
// the facts (errors, dispositions, the 401 rule).

import { HUB_ROUTE_SCHEMAS, type AbortSignalLike, type HubFailure, type HubRouteKey } from '@cg/contracts';

import { transportFailure } from './errors';
import { type FetchLike, type HubClock } from './ports';
import { clientWireRequest, isClientRoute, sendClientRoute } from './route-transport';
import { checkSdkAnswer, isSdkRoute, sdkInputOf, sendSdkOperation, type SdkOperation, type SdkRawInput } from './sdk-transport';
import { callScope, httpFailureOf, readJson, thrownFailure } from './wire';

export interface WireCall {
  readonly hubOrigin: string;
  /** null: a public route (sign-in, health). */
  readonly token: string | null;
  /** The caller's signal, the sign-in epoch's signal… any of them cancels the call. */
  readonly signals: readonly (AbortSignalLike | undefined)[];
  readonly timeoutMs: number | null;
}

/** Every client/* route of the contract (`clientBootstrap`, `clientConversationRecaps`…), whichever transport carries it. */
export type ClientFamilyKey = Extract<HubRouteKey, `client${string}`>;

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

  async client(route: ClientFamilyKey, call: WireCall & { readonly token: string }, request: unknown): Promise<WireResult> {
    if (isSdkRoute(route)) {
      let input: SdkRawInput;
      try {
        input = sdkInputOf(route, request);
      } catch {
        return contractFailure();
      }
      return this.sdk(route, call, input);
    }
    // Neither the SDK nor the RouteTransport has it: a route of the contract nobody can send.
    if (!isClientRoute(route)) return contractFailure();
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
