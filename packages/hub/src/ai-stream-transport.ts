// The AI stream's transport (architecture.md §8.4): the vendored SDK's
// `streamAiFeature`. The SDK puts what the request announces on
// `x-kernel-ai-capabilities` (its `capabilities` option: `debug-input-v1`,
// `context-v1`, `split-all-v1`) and parses every frame it knows, the
// `context_v1` frame among them, by its own schema before the facade checks
// it by the contract.
//
// The SDK may be newer than the hub it talks to (prod deploys lag main): a
// capability the hub's bootstrap does not declare is never announced —
// `StreamService.available()` is «declared by the hub ∩ carried here» — and
// what depends on it reads `hub_not_ready`. The seam stays for tests, which
// inject their own transport, and for the timing facts of one attempt
// (`onRequest`, `onAnswer`): the facade logs when the request left and when
// the hub answered — never a payload.

import { AI_STREAM_CAPABILITIES, type AiFeatureStreamBody, type AiStreamCapability, type HubAiFeature } from '@cg/contracts';
import { streamAiFeature } from '@kernel/sdk';

import { type FetchLike } from './ports';
import { sdkOptions } from './sdk-transport';

export interface AiStreamOpen {
  readonly hubOrigin: string;
  readonly token: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly fetch: FetchLike;
  readonly feature: HubAiFeature;
  readonly body: AiFeatureStreamBody;
  /** Only values of `capabilities` of this transport. */
  readonly capabilities: readonly AiStreamCapability[];
  readonly signal: AbortSignal;
  /** Each SSE `ai` frame as parsed JSON (the facade checks it strictly). */
  readonly onFrame: (frame: unknown) => void;
  /** The SDK's onAuthError hook for the stream (AU-012). */
  readonly onAuthError: (error: unknown) => void;
  /** The request is being handed to the network: from here on the hub may have received it. */
  readonly onRequest?: () => void;
  /** The hub answered the handshake: its status, before any frame is read. */
  readonly onAnswer?: (status: number) => void;
}

export interface AiStreamTransport {
  /** What this transport can put on the header AND parse back. */
  readonly capabilities: readonly AiStreamCapability[];
  /**
   * Resolves at the end of the body, or quietly when `signal` aborts; rejects
   * on a refused handshake (an error with `status`, `code` = hub `error`,
   * `body` = the JSON envelope) or a broken body.
   */
  open(input: AiStreamOpen): Promise<void>;
}

export const SDK_STREAM_CAPABILITIES: readonly AiStreamCapability[] = AI_STREAM_CAPABILITIES;

export const sdkStreamTransport: AiStreamTransport = {
  capabilities: SDK_STREAM_CAPABILITIES,
  async open(input) {
    if (input.signal.aborted) return;
    /** The one request of this attempt, seen where it leaves: when it was handed over and what came back. */
    const observed: FetchLike = async (url, init) => {
      // A call that was cut before this point is never handed to the network — and never said to have been.
      // (The SDK listens for `abort` only from here on: a signal aborted earlier would not stop its request.)
      if (input.signal.aborted) throw new DOMException('The stream was cut before its request was sent', 'AbortError');
      input.onRequest?.();
      const response = await input.fetch(url, init);
      input.onAnswer?.(response.status);
      return response;
    };
    const options = sdkOptions({
      hubOrigin: input.hubOrigin,
      token: input.token,
      headers: input.headers,
      fetch: observed,
      signal: input.signal,
      onAuthError: (error) => input.onAuthError(error),
    });
    const handle = streamAiFeature(options, {
      feature: input.feature,
      body: input.body,
      onFrame: (frame) => input.onFrame(frame),
      capabilities: input.capabilities,
      signal: input.signal,
    });
    await handle.done;
  },
};
