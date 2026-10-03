// The AI stream's transport seam (architecture.md §8.4). Today: the vendored
// SDK's `streamAiFeature`, which can put only `debug-input-v1` on
// `x-kernel-ai-capabilities` (its `debugPromptEcho`) and parses only the
// frames it knows — a `context_v1` frame would fail its schema. So it
// declares `['debug-input-v1']`, and the facade refuses a request that
// needs more (CG-HUB-CAPABILITY) instead of sending what the hub would 400.
//
// After the hub's H-4 SDK change (hub PR #413: `capabilities?: string[]` on
// `streamAiFeature`, the `context_v1` frame in its union) is re-vendored,
// the SDK transport passes `input.capabilities` through and declares all of
// AI_STREAM_CAPABILITIES — nothing else in the facade changes. Tests inject
// their own transport the same way.

import { type AiFeatureStreamBody, type AiStreamCapability, type HubAiFeature } from '@cg/contracts';
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

export const SDK_STREAM_CAPABILITIES: readonly AiStreamCapability[] = ['debug-input-v1'];

export const sdkStreamTransport: AiStreamTransport = {
  capabilities: SDK_STREAM_CAPABILITIES,
  async open(input) {
    const options = sdkOptions({
      hubOrigin: input.hubOrigin,
      token: input.token,
      headers: input.headers,
      fetch: input.fetch,
      signal: input.signal,
      onAuthError: (error) => input.onAuthError(error),
    });
    const handle = streamAiFeature(options, {
      feature: input.feature,
      // H-4 fields never reach this transport: they need `context-v1`, which it does not declare.
      body: input.body,
      onFrame: (frame) => input.onFrame(frame),
      debugPromptEcho: input.capabilities.includes('debug-input-v1'),
      signal: input.signal,
    });
    await handle.done;
  },
};
