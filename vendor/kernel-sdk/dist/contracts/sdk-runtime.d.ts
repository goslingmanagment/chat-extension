import type { z } from "zod";
import { routeSchemas } from "./routes";
export interface KernelOperationDef {
    method: string;
    path: string;
}
type Schemas = typeof routeSchemas;
export type KernelOperationKey = keyof Schemas & string;
/**
 * Operations without a plain request/JSON-response shape. The webhook is
 * HMAC-authenticated server intake; the AI gateway stream is SSE (dedicated
 * helper); the ledger CSV returns text/csv; the voice-note audio route returns binary
 * audio/mpeg (dedicated `fetchVoiceNoteAudio` helper). All remain reachable via
 * `client.raw(...)`.
 */
export declare const SDK_EXCLUDED_OPERATIONS: readonly ["ofapiWebhookReceive", "aiGatewayStream", "adminOfapiCreditsLedgerCsv", "voiceNoteAudio", "pageBrowserLoginScreenshot", "pageBrowserScreen", "pageBrowserProfileLoginScreenshot", "pageBrowserProfileScreen", "chatspaceBrowserScreenOpen", "chatspaceBrowserScreen", "publicVaultUploadFile"];
export type KernelSdkExcludedKey = (typeof SDK_EXCLUDED_OPERATIONS)[number];
export type KernelSdkMethodKey = Exclude<KernelOperationKey, KernelSdkExcludedKey>;
type InputOf<S> = S extends z.ZodType ? z.input<S> : never;
type OutputOf<S> = S extends z.ZodType ? z.output<S> : never;
type SuccessStatus = 200 | 201 | 202 | 204;
export type KernelOperationRequest<K extends KernelOperationKey> = (Schemas[K] extends {
    params: infer P;
} ? {
    params: InputOf<P>;
} : object) & (Schemas[K] extends {
    querystring: infer Q;
} ? {
    query: InputOf<Q>;
} : object) & (Schemas[K] extends {
    body: infer B;
} ? {
    body: InputOf<B>;
} : object);
export type KernelOperationResponse<K extends KernelOperationKey> = Schemas[K] extends {
    response: infer R;
} ? OutputOf<R[Extract<keyof R, SuccessStatus>]> : never;
type HasRequestFields<K extends KernelOperationKey> = Schemas[K] extends {
    params: unknown;
} ? true : Schemas[K] extends {
    querystring: unknown;
} ? true : Schemas[K] extends {
    body: unknown;
} ? true : false;
export type KernelClient = {
    [K in KernelSdkMethodKey]: HasRequestFields<K> extends true ? (input: KernelOperationRequest<K>) => Promise<KernelOperationResponse<K>> : () => Promise<KernelOperationResponse<K>>;
} & {
    /**
     * Escape hatch: send any operation (including the excluded ones) with the
     * manifest's method/path and the client's auth plumbing, and get the raw
     * Response back — no validation, no JSON assumption.
     */
    raw(key: KernelOperationKey, input?: {
        params?: Record<string, string | number>;
        query?: Record<string, unknown>;
        body?: unknown;
        headers?: Record<string, string>;
    }): Promise<Response>;
};
export type KernelErrorCategory = "auth" | "validation" | "not_found" | "conflict" | "rate_limit" | "server" | "http" | "network" | "contract";
export declare class KernelApiError extends Error {
    readonly category: KernelErrorCategory;
    readonly status: number | null;
    readonly code: string | null;
    readonly body: unknown;
    constructor(message: string, category: KernelErrorCategory, status: number | null, code: string | null, body: unknown);
}
export interface KernelClientOptions {
    baseUrl: string;
    auth?: {
        mode: "cookie";
    } | {
        mode: "bearer";
        token: () => string | Promise<string>;
    };
    /** Extra headers on every request (tests use this to carry a session cookie). */
    headers?: Record<string, string>;
    fetch?: typeof fetch;
    /**
     * Called on every 401/403 before the error is thrown (logout hooks). The
     * second argument names the operation (null for raw/stream calls), so a
     * failed `login` can be told apart from an expired session.
     */
    onAuthError?: (error: KernelApiError, operation: KernelOperationKey | null) => void;
}
export declare function executeKernelRequest(input: {
    def: KernelOperationDef;
    options: KernelClientOptions;
    params?: Record<string, string | number>;
    query?: Record<string, unknown> | undefined;
    body?: unknown;
    headers?: Record<string, string> | undefined;
}): Promise<Response>;
export declare function createKernelClient(operations: Record<KernelOperationKey, KernelOperationDef>, options: KernelClientOptions): KernelClient;
import { type AiFeatureStreamFrame, type AiGatewayStreamFrame } from "./routes";
import type { z as zod } from "zod";
export interface KernelStreamHandle {
    /** Resolves when the stream ends (server bound, snapshot-required, or close()). */
    done: Promise<void>;
    close: () => void;
}
/**
 * What a client may advertise on the AI feature stream in the
 * `x-kernel-ai-capabilities` header. Each token is compatibility negotiation,
 * not authorization: "this client understands the matching frame or field".
 * The server ignores tokens it does not know (so a hub that does not serve a
 * token yet behaves exactly as without it), and the SDK writes the header in
 * this order.
 */
export declare const AI_STREAM_CAPABILITIES: readonly ["debug-input-v1", "context-v1", "split-all-v1", "coverage-check-v1", "hi-start-proof-v1", "hi-fan-account-v1", "coach-depth-v1", "fan-custom-name-v1"];
export type AiStreamCapability = (typeof AI_STREAM_CAPABILITIES)[number];
/**
 * Stream one AI generation through the gateway
 * (`POST /api/v1/ai/gateway/stream`, `event: ai` frames).
 */
/** Stream a kernel-assembled feature generation.
 * Same SSE framing as the raw gateway stream — one helper per entry path.
 * `debugPromptEcho` is kept for existing callers: it equals advertising
 * `debug-input-v1` in `capabilities`. */
export declare function streamAiFeature(options: KernelClientOptions, input: {
    feature: string;
    body: zod.input<(typeof routeSchemas)["aiFeatureStream"]["body"]>;
    onFrame: (frame: AiFeatureStreamFrame) => void;
    debugPromptEcho?: boolean;
    capabilities?: readonly AiStreamCapability[];
    signal?: AbortSignal;
}): KernelStreamHandle;
export declare function streamAiGateway(options: KernelClientOptions, input: {
    body: zod.input<(typeof routeSchemas)["aiGatewayStream"]["body"]>;
    onFrame: (frame: AiGatewayStreamFrame) => void;
    signal?: AbortSignal;
}): KernelStreamHandle;
/**
 * Fetch a completed voice-note's audio bytes (`GET
 * /api/v1/pages/:pageLabel/voice-notes/:id/audio`, Task 6). The response is
 * binary `audio/mpeg`, so there is no JSON shape to validate — the caller gets
 * the raw Response (200 with the bytes on success). On failure the body carries
 * a structured `{ error, message, statusCode }`; NOTE a 410 `artifact_expired`
 * (the audio was purged) is matched on the body `error` code, NOT a distinct
 * SDK error category — the existing gate-code pattern.
 */
export declare function fetchVoiceNoteAudio(options: KernelClientOptions, input: {
    pageLabel: string;
    id: number;
}): Promise<Response>;
export {};
