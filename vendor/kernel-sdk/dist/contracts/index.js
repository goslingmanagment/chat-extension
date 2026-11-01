// House primitives (mills, platformEnum, the error body, pagination) — extracted
// from routes.ts so the agent route module shares ONE declaration of each.
export * from "./primitives";
export * from "./routes";
// Agent Read Plane operations #1-#10 (spread into routeSchemas by routes.ts).
export * from "./routes-agent";
// Slice B: owner administration of the plane's keys (issue / list / revoke).
export * from "./routes-agent-keys";
// Fansly Sync Engine owner routes (history requests), spread by routes.ts.
export * from "./routes-sync";
// The chat extension's routes (client bootstrap…), spread by routes.ts.
export * from "./routes-client";
// Publications: wall posts through Hub (owner + agent drafts), spread by routes.ts.
export * from "./publications";
export * from "./routes-publications";
export * from "./fan-queues";
export * from "./routes-fan-queues";
// «Рассылки» kept by Hub (outreach-store-v1), spread by routes.ts.
export * from "./outreach";
export * from "./routes-outreach";
export * from "./publication-files";
export * from "./routes-publication-files";
// Narrow device-token profiles (the chat extension's route allowlist, H-3).
export * from "./client-token-scopes";
export * from "./authorization-policy";
export * from "./domain-event-cursor";
export * from "./sdk-runtime";
export * from "./contract-hash";
// Agent Read Plane vocabulary. Declared once and derived, so a drift between
// the enum, the counts and the per-operation matrices becomes a compile error
// rather than an inconsistent response body (see the file header).
export * from "./agent-read-registry";
// Slice 0a vocabularies: the closed capability matrix a key grant is drawn from,
// and the dataset registry that is the ONLY bridge from a dataset name to code.
export * from "./agent-read-capabilities";
export * from "./agent-read-datasets";
// Client-side stop-reason predicate (coach-chat spec §8): surfaced through the
// contracts barrel — the same path that carries shared TYPES to the SDK — so
// out-of-workspace consumers (the extension) can import it from @kernel/sdk and
// apply it to a terminal stop reason before committing/attaching a generation.
export { isOutputExhausted } from "../shared/index";
// The `hub` CLI's dollar flags (`hub cross-spenders --min-source-spend 20`)
// become mills through the money codec, never through a CLI copy of it.
export { millsFromDollars } from "../shared/index";
export * from "./ofapi-vendor-usage";
export * from "./routes-ofapi-vendor";
export * from "./routes-ofapi-collection";
export * from "./of-links";
export * from "./routes-of-links";
// The owner's login of a page's server browser (Project Browser PR 15).
export * from "./routes-page-browser";
// The operator screen's one read (`GET /api/v1/ops/live`), spread by routes.ts.
export * from "./routes-ops-live";
// The Anthropic accounts Hub spends (`/api/v1/admin/ai/accounts`), spread by routes.ts.
export * from "./routes-ai-accounts";
export * from "./routes-ai-spend";
export * from "./routes-ai-openers";
export * from "./ofapi-extended-commands";
export * from "./routes-ofapi-banned-words";
export * from "./routes-ofapi-read-collections";
export * from "./ofapi-smart-links";
export * from "./routes-ofapi-exports";
export * from "./routes-ofapi-media";
export * from "./routes-ofapi-media-images";
export * from "./ofapi-actions";
export * from "./ofapi-actions-collections";
export * from "./ofapi-actions-publishing";
export * from "./ofapi-actions-account";
