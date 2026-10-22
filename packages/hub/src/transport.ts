// One request to the hub, end to end, as facts: a checked answer or a
// HubFailure. One path: the vendored SDK (sdk-transport.ts) — its manifest
// method and path, its auth plumbing, its response schema first and our
// contract mirror second. A client/* route arrives from the facade as one
// flat request; its path parameters are taken out by the SDK's own manifest
// path (`sdkInputOf`), the rest is the query or the body. Since the re-vendor
// of hub c8514c5c every contract route is an SDK operation; one that is not
// (a route added to the contract before its hub PR is vendored) is refused
// here as a contract failure and never sent.
// Nothing here retries, wipes a sign-in or shows anything: the facade reads
// the facts (errors, dispositions, the 401 rule).

import { VOICE_LIMITS, type AbortSignalLike, type HubFailure, type HubRequestCheck, type HubRouteKey } from '@cg/contracts';
import { fetchVoiceNoteAudio } from '@kernel/sdk';

import { transportFailure } from './errors';
import { type FetchLike, type HubClock } from './ports';
import { checkSdkAnswer, isSdkRoute, sdkInputOf, sdkOptions, sendSdkOperation, type SdkOperation, type SdkRawInput } from './sdk-transport';
import { callScope, httpFailureOf, readJson, thrownFailure } from './wire';

export interface WireCall {
  readonly hubOrigin: string;
  /** null: a public route (sign-in, health). */
  readonly token: string | null;
  /** The caller's signal, the sign-in epoch's signal… any of them cancels the call. */
  readonly signals: readonly (AbortSignalLike | undefined)[];
  readonly timeoutMs: number | null;
}

/** Every client/* route of the contract (`clientBootstrap`, `clientConversationRecaps`, `clientFanClaim`…). */
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

  /**
   * 1.47.0: a voice note's MP3 — the SDK's own `fetchVoiceNoteAudio` (the route answers bytes, not JSON). Taken only as
   * `audio/mpeg` and within the hub's own cap, declared and read; anything else is a contract failure, never handed on.
   */
  async audio(call: WireCall & { readonly token: string }, pageLabel: string, id: number): Promise<WireResult> {
    const scope = callScope(this.deps.clock, call.signals, call.timeoutMs);
    try {
      const options = sdkOptions({ hubOrigin: call.hubOrigin, token: call.token, headers: this.deps.headers(), fetch: this.deps.fetch, signal: scope.signal });
      const response = await fetchVoiceNoteAudio(options, { pageLabel, id });
      if (!response.ok) {
        const { failure, body } = await httpFailureOf(response, this.deps.clock.now());
        return { ok: false, failure, body };
      }
      const type = (response.headers.get('content-type') ?? '').toLowerCase();
      const declared = Number(response.headers.get('content-length') ?? Number.NaN);
      if (!type.startsWith('audio/mpeg') || (Number.isFinite(declared) && declared > VOICE_LIMITS.audioMaxBytes)) return contractFailure();
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > VOICE_LIMITS.audioMaxBytes) return contractFailure();
      return { ok: true, value: bytes, status: response.status };
    } catch (error) {
      return { ok: false, failure: thrownFailure(error, scope), body: null };
    } finally {
      scope.dispose();
    }
  }

  async client(route: ClientFamilyKey, call: WireCall & { readonly token: string }, request: unknown, check?: HubRequestCheck): Promise<WireResult> {
    // A route of the contract the vendored SDK does not have: nobody can send it.
    if (!isSdkRoute(route)) return contractFailure();
    let input: SdkRawInput;
    try {
      input = sdkInputOf(route, request, check);
    } catch {
      return contractFailure();
    }
    return this.sdk(route, call, input);
  }
}
