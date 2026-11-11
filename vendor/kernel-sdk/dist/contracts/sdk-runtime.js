import { routeSchemas } from "./routes";
/**
 * Operations without a plain request/JSON-response shape. The webhook is
 * HMAC-authenticated server intake; the AI gateway stream is SSE (dedicated
 * helper); the ledger CSV returns text/csv; the voice-note audio route returns binary
 * audio/mpeg (dedicated `fetchVoiceNoteAudio` helper). All remain reachable via
 * `client.raw(...)`.
 */
export const SDK_EXCLUDED_OPERATIONS = [
    "ofapiWebhookReceive",
    "aiGatewayStream",
    "adminOfapiCreditsLedgerCsv",
    "voiceNoteAudio",
    // A page browser's screenshot is image/jpeg; its screen a passthrough of
    // KasmVNC (Project Browser PR 15).
    "pageBrowserLoginScreenshot",
    "pageBrowserScreen",
    // The same of a new page's browser, by its profile (PR 16).
    "pageBrowserProfileLoginScreenshot",
    "pageBrowserProfileScreen",
    // The always-on ChatSpace tab's screen: a redirect and a KasmVNC passthrough.
    "chatspaceBrowserScreenOpen",
    "chatspaceBrowserScreen",
];
export class KernelApiError extends Error {
    category;
    status;
    code;
    body;
    constructor(message, category, status, code, body) {
        super(message);
        this.category = category;
        this.status = status;
        this.code = code;
        this.body = body;
        this.name = "KernelApiError";
    }
}
function categoryForStatus(status) {
    if (status === 400)
        return "validation";
    if (status === 401 || status === 403)
        return "auth";
    if (status === 404)
        return "not_found";
    if (status === 409)
        return "conflict";
    if (status === 429)
        return "rate_limit";
    if (status >= 500)
        return "server";
    return "http";
}
// A param is a whole segment (`/:name`); a colon inside a segment is a
// literal custom method (`/api/v2/spenders:batch`), as the server routes it.
function buildPath(template, params) {
    return template.replace(/(?<=\/):([A-Za-z0-9_]+)/g, (_match, name) => {
        const value = params?.[name];
        if (value === undefined || value === null) {
            throw new KernelApiError(`Missing path param "${name}" for ${template}`, "contract", null, "missing_path_param", null);
        }
        return encodeURIComponent(String(value));
    });
}
function buildQuery(query) {
    if (!query) {
        return "";
    }
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) {
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                search.append(key, String(item));
            }
            continue;
        }
        search.append(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : "";
}
export async function executeKernelRequest(input) {
    const { def, options } = input;
    const fetchImpl = options.fetch ?? fetch;
    const url = `${options.baseUrl}${buildPath(def.path, input.params)}${buildQuery(input.query)}`;
    const headers = { ...options.headers, ...input.headers };
    if (options.auth?.mode === "bearer") {
        headers.authorization = `Bearer ${await options.auth.token()}`;
    }
    const requestInit = {
        method: def.method,
        headers,
        ...(options.auth?.mode === "cookie" ? { credentials: "include" } : {}),
    };
    if (input.body !== undefined) {
        headers["content-type"] = "application/json";
        requestInit.body = JSON.stringify(input.body);
    }
    try {
        return await fetchImpl(url, requestInit);
    }
    catch (error) {
        throw new KernelApiError(`Network error calling ${def.method} ${def.path}: ${error instanceof Error ? error.message : "unknown"}`, "network", null, networkErrorCode(error), null);
    }
}
/** Preserve the abort/timeout distinction through the network wrap — clients
 * with retry discipline (the desktop) must not blind-retry what a caller
 * deliberately aborted, and must classify timeouts as such. */
function networkErrorCode(error) {
    const name = error instanceof Error ? error.name : typeof error === "object" && error !== null && "name" in error ? String(error.name) : null;
    if (name === "TimeoutError")
        return "timeout";
    if (name === "AbortError")
        return "aborted";
    return "network_error";
}
async function throwForErrorResponse(def, response, options, operation) {
    let body;
    const text = await response.text();
    try {
        body = text ? JSON.parse(text) : null;
    }
    catch {
        body = text;
    }
    const envelope = (body ?? {});
    const error = new KernelApiError(typeof envelope.message === "string"
        ? envelope.message
        : `${def.method} ${def.path} failed with ${response.status}`, categoryForStatus(response.status), response.status, typeof envelope.error === "string" ? envelope.error : null, body);
    if (error.category === "auth") {
        options.onAuthError?.(error, operation);
    }
    throw error;
}
/** Raw/stream paths carry a null operation (the options doc's contract):
 * fire the logout hook for 401/403s that never pass throwForErrorResponse. */
function notifyAuthError(options, error) {
    if (error.category === "auth") {
        options.onAuthError?.(error, null);
    }
}
export function createKernelClient(operations, options) {
    const excluded = new Set(SDK_EXCLUDED_OPERATIONS);
    async function call(key, input) {
        const def = operations[key];
        const response = await executeKernelRequest({ def, options, ...input });
        if (!response.ok) {
            await throwForErrorResponse(def, response, options, key);
        }
        const responseSchemas = routeSchemas[key].response;
        const schema = responseSchemas?.[response.status];
        if (!schema) {
            throw new KernelApiError(`${def.method} ${def.path} returned undeclared status ${response.status}`, "contract", response.status, "undeclared_status", null);
        }
        const payload = await response.json();
        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
            throw new KernelApiError(`${def.method} ${def.path} response failed contract validation: ${parsed.error.message}`, "contract", response.status, "response_validation_failed", payload);
        }
        return parsed.data;
    }
    const client = {
        async raw(key, input) {
            const def = operations[key];
            const response = await executeKernelRequest({ def, options, ...input });
            if (response.status === 401 || response.status === 403) {
                notifyAuthError(options, new KernelApiError(`${def.method} ${def.path} failed with ${response.status}`, "auth", response.status, null, null));
            }
            return response;
        },
    };
    for (const key of Object.keys(operations)) {
        if (excluded.has(key)) {
            continue;
        }
        client[key] = (input) => call(key, input ?? {});
    }
    return client;
}
// --- Stream helpers ---
import { aiFeatureStreamFrameSchema, aiGatewayStreamFrameSchema, } from "./routes";
async function* parseSseStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                return;
            }
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf("\n\n")) >= 0) {
                const raw = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const frame = { id: null, event: null, data: "" };
                for (const line of raw.split("\n")) {
                    if (line.startsWith(":") || line.startsWith("retry:")) {
                        continue; // heartbeat comments and reconnect hints
                    }
                    if (line.startsWith("id: ")) {
                        frame.id = line.slice(4);
                    }
                    else if (line.startsWith("event: ")) {
                        frame.event = line.slice(7);
                    }
                    else if (line.startsWith("data: ")) {
                        frame.data += (frame.data ? "\n" : "") + line.slice(6);
                    }
                }
                if (frame.id !== null || frame.event !== null || frame.data !== "") {
                    yield frame;
                }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
async function openSseResponse(input) {
    const { options } = input;
    const fetchImpl = options.fetch ?? fetch;
    const headers = {
        accept: "text/event-stream",
        ...options.headers,
        ...input.headers,
    };
    if (options.auth?.mode === "bearer") {
        headers.authorization = `Bearer ${await options.auth.token()}`;
    }
    const init = {
        method: input.method,
        headers,
        signal: input.signal,
        ...(options.auth?.mode === "cookie" ? { credentials: "include" } : {}),
    };
    if (input.body !== undefined) {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(input.body);
    }
    try {
        return await fetchImpl(`${options.baseUrl}${input.path}`, init);
    }
    catch (error) {
        throw new KernelApiError(`Network error opening ${input.path}: ${error instanceof Error ? error.message : "unknown"}`, "network", null, "network_error", null);
    }
}
/**
 * What a client may advertise on the AI feature stream in the
 * `x-kernel-ai-capabilities` header. Each token is compatibility negotiation,
 * not authorization: "this client understands the matching frame or field".
 * The server ignores tokens it does not know (so a hub that does not serve a
 * token yet behaves exactly as without it), and the SDK writes the header in
 * this order.
 */
export const AI_STREAM_CAPABILITIES = [
    "debug-input-v1", "context-v1", "split-all-v1",
    // chat-extension R20 HF-8в: the `coverageCheck` answers in the context frame.
    "coverage-check-v1",
    // chat-extension R20 HF-5: Hi on Fansly is admitted by the body's `startProof`.
    "hi-start-proof-v1",
    // Hi on Fansly takes `fanAccount`, the fan's account as the page loaded it.
    "hi-fan-account-v1",
    // Coach reads up to the owner's deep window and may end its answer with a ```more note.
    "coach-depth-v1",
    // OnlyFans takes `fanCustomName`, the chatter's own name for the fan as ChatSpace shows it.
    "fan-custom-name-v1",
];
/** The header value for `streamAiFeature`: the union of `capabilities` and
 * (`debugPromptEcho` → `debug-input-v1`), deduplicated, in the order of
 * AI_STREAM_CAPABILITIES, joined by ", ". Nothing to advertise → no header. */
function aiStreamCapabilitiesHeader(input) {
    const wanted = new Set(input.capabilities ?? []);
    if (input.debugPromptEcho) {
        wanted.add("debug-input-v1");
    }
    const tokens = AI_STREAM_CAPABILITIES.filter((capability) => wanted.has(capability));
    return tokens.length > 0 ? tokens.join(", ") : undefined;
}
/**
 * Stream one AI generation through the gateway
 * (`POST /api/v1/ai/gateway/stream`, `event: ai` frames).
 */
/** Stream a kernel-assembled feature generation.
 * Same SSE framing as the raw gateway stream — one helper per entry path.
 * `debugPromptEcho` is kept for existing callers: it equals advertising
 * `debug-input-v1` in `capabilities`. */
export function streamAiFeature(options, input) {
    const abort = new AbortController();
    input.signal?.addEventListener("abort", () => abort.abort(), { once: true });
    const capabilitiesHeader = aiStreamCapabilitiesHeader(input);
    const done = (async () => {
        const response = await openSseResponse({
            options,
            method: "POST",
            path: `/api/v1/ai/features/${encodeURIComponent(input.feature)}`,
            headers: capabilitiesHeader !== undefined
                ? { "x-kernel-ai-capabilities": capabilitiesHeader }
                : undefined,
            body: input.body,
            signal: abort.signal,
        });
        if (!response.ok || !response.body) {
            let body;
            const text = await response.text().catch(() => "");
            try {
                body = text ? JSON.parse(text) : null;
            }
            catch {
                body = text;
            }
            const envelope = (body ?? {});
            // categoryForStatus, not an auth/server ternary: a 429 quota denial must
            // reach clients as rate_limit (code "quota_denied"), not "validation".
            const error = new KernelApiError(typeof envelope.message === "string" ? envelope.message : `ai/features/${input.feature} failed with ${response.status}`, categoryForStatus(response.status), response.status, typeof envelope.error === "string" ? envelope.error : null, body);
            notifyAuthError(options, error);
            throw error;
        }
        for await (const frame of parseSseStream(response.body)) {
            if (frame.event !== "ai" || frame.data === "") {
                continue;
            }
            const parsed = aiFeatureStreamFrameSchema.safeParse(JSON.parse(frame.data));
            if (!parsed.success) {
                throw new KernelApiError(`ai frame failed contract validation: ${parsed.error.message}`, "contract", 200, "frame_validation_failed", frame.data);
            }
            input.onFrame(parsed.data);
        }
    })().catch((error) => {
        if (abort.signal.aborted) {
            return;
        }
        throw error;
    });
    return {
        done,
        close: () => abort.abort(),
    };
}
export function streamAiGateway(options, input) {
    const abort = new AbortController();
    input.signal?.addEventListener("abort", () => abort.abort(), { once: true });
    const done = (async () => {
        const response = await openSseResponse({
            options,
            method: "POST",
            path: "/api/v1/ai/gateway/stream",
            body: input.body,
            signal: abort.signal,
        });
        if (!response.ok || !response.body) {
            let body;
            const text = await response.text().catch(() => "");
            try {
                body = text ? JSON.parse(text) : null;
            }
            catch {
                body = text;
            }
            const envelope = (body ?? {});
            const error = new KernelApiError(typeof envelope.message === "string" ? envelope.message : `ai/gateway/stream failed with ${response.status}`, categoryForStatus(response.status), response.status, typeof envelope.error === "string" ? envelope.error : null, body);
            notifyAuthError(options, error);
            throw error;
        }
        for await (const frame of parseSseStream(response.body)) {
            if (frame.event !== "ai" || frame.data === "") {
                continue;
            }
            const parsed = aiGatewayStreamFrameSchema.safeParse(JSON.parse(frame.data));
            if (!parsed.success) {
                throw new KernelApiError(`ai frame failed contract validation: ${parsed.error.message}`, "contract", 200, "frame_validation_failed", frame.data);
            }
            input.onFrame(parsed.data);
        }
    })().catch((error) => {
        if (abort.signal.aborted) {
            return;
        }
        throw error;
    });
    return { done, close: () => abort.abort() };
}
/**
 * Fetch a completed voice-note's audio bytes (`GET
 * /api/v1/pages/:pageLabel/voice-notes/:id/audio`, Task 6). The response is
 * binary `audio/mpeg`, so there is no JSON shape to validate — the caller gets
 * the raw Response (200 with the bytes on success). On failure the body carries
 * a structured `{ error, message, statusCode }`; NOTE a 410 `artifact_expired`
 * (the audio was purged) is matched on the body `error` code, NOT a distinct
 * SDK error category — the existing gate-code pattern.
 */
export async function fetchVoiceNoteAudio(options, input) {
    const def = { method: "GET", path: "/api/v1/pages/:pageLabel/voice-notes/:id/audio" };
    const response = await executeKernelRequest({
        def,
        options,
        params: { pageLabel: input.pageLabel, id: input.id },
    });
    // Mirror client.raw(): the caller gets the raw Response, so nothing else fires
    // the logout hook. An expired bearer during audio download must still notify
    // onAuthError (operation=null) like every other 401/403.
    if (response.status === 401 || response.status === 403) {
        notifyAuthError(options, new KernelApiError(`${def.method} ${def.path} failed with ${response.status}`, "auth", response.status, null, null));
    }
    return response;
}
