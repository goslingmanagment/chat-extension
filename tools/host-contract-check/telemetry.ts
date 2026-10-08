// The telemetry tripwire of the host contract check (decision X22): what of a
// new ChatSpace build could see us. ChatSpace 0.195.0 runs the Sentry browser
// SDK (errors, breadcrumbs of console, clicks, fetch and navigation; no
// Replay, no tracing, no extension detection beyond Sentry's own check whether
// it itself runs inside an extension). A later build that adds Replay or
// tracing, another integration, init options that change what is recorded, or
// code that looks for extensions — their URLs, our names, shadow hosts, symbols
// on `window`, «native code» checks of the globals we stand in front of —
// changes what our presence leaves in their telemetry. That is a warning to
// read the new code before the next pilot day, not a verdict.
//
// It counts each signal by the token that matched, over every script of a copy,
// and compares the counts with a baseline: the 0.195.0 copy's below (numbers
// only — no code of theirs), or, with --against, another copy. A token whose
// count changed (new, gone or more) is a warning with its first places. The SDK
// itself names many options in its own code (it reads them), so a count, not a
// presence, is what moves when the app's init or a new integration adds one.

import { type BundleFile } from './check.ts';

export interface TelemetrySignal {
  readonly id: string;
  /** What it would mean. */
  readonly what: string;
  readonly pattern: RegExp;
}

const QUOTE = '[`"\']';

/** The signals; each counted by the token it matched (quotes and spaces dropped). */
export const TELEMETRY_SIGNALS: readonly TelemetrySignal[] = [
  { id: 'replay', what: 'Sentry Replay (rrweb): records the DOM, our hosts with their attributes and the pointer', pattern: /\brr-(?:block|mask|ignore|unmask)\b|\brrweb\b|\breplays(?:SessionSampleRate|OnErrorSampleRate)\b|\bReplayCanvas\b/g },
  { id: 'tracing', what: 'Sentry tracing: interaction spans and timings, trace headers on requests', pattern: new RegExp(`${QUOTE}BrowserTracing${QUOTE}|\\bbrowserTracingIntegration\\b|\\btraces(?:SampleRate|Sampler)\\b|\\btracePropagationTargets\\b|\\bprofilesSampleRate\\b`, 'g') },
  {
    id: 'integration',
    what: 'another Sentry integration (console capture, HTTP client errors, feature flags, the Pinia plugin…)',
    pattern: new RegExp(
      `${QUOTE}(?:HttpClient|CaptureConsole|ReportingObserver|ExtraErrorData|ContextLines|RewriteFrames|Feedback|BrowserProfiling|Spotlight|ModuleMetadata|ThirdPartyErrorsFilter|ZodErrors|GraphQLClient|Supabase|FeatureFlags|LaunchDarkly|OpenFeature|Unleash|Statsig|GrowthBook|WebWorker|BrowserSession|Pinia)${QUOTE}|\\bpinia\\.(?:action|state)\\b|\\bcreateSentryPiniaPlugin\\b`,
      'g',
    ),
  },
  { id: 'option', what: 'a Sentry option that changes what is recorded or sent (filters, PII, logs, breadcrumb attributes, the user)', pattern: /\b(?:beforeSend|beforeSendTransaction|beforeBreadcrumb|denyUrls|allowUrls|sendDefaultPii|enableLogs|serializeAttribute|maxBreadcrumbs|attachStacktrace|setUser)\b/g },
  { id: 'extension-url', what: 'code that names extension URLs (a stack frame or a script of an extension)', pattern: /\b(?:moz|chrome|safari-web|ms-browser)-extension\b|\bwebkit-masked-url\b/g },
  { id: 'our-name', what: 'one of our own names, old or new (the extension, its globals, its handshake)', pattern: /chatgoose|\bdata-cg\b|\bdata-cg-|\bcg-root\b|\bwsTap\b|\bmainRuntime\b|\bmain-ready\b|\biso-hello\b/gi },
  { id: 'shadow-probe', what: 'code that looks at shadow roots (a closed one is how our hosts look)', pattern: /\battachShadow\b|\.shadowRoot\b|\bopenOrClosedShadowRoot\b/g },
  { id: 'global-probe', what: 'code that lists the symbols on `window` (where the tap leaves its handle)', pattern: /\bgetOwnPropertySymbols\s*\(\s*(?:window|globalThis|self)\b|\bSymbol\.keyFor\b/g },
  { id: 'native-check', what: '«[native code]» checks: a wrapped `WebSocket` or `fetch` does not print as native', pattern: /\[native code\]/g },
  { id: 'composer-bridge', what: 'reads of the composer bridge from new places (the one we insert through)', pattern: /__omComposerBridge/g },
];

/** Counts of the 0.195.0 copy (its `pretty/` folder), by `signal:token` (quotes and spaces dropped) — numbers only. */
export const TELEMETRY_BASELINE: { readonly version: string; readonly counts: Readonly<Record<string, number>> } = {
  version: '0.195.0',
  counts: {
    'tracing:tracesSampleRate': 4,
    'tracing:tracesSampler': 5,
    'integration:Spotlight': 1,
    'integration:BrowserSession': 2,
    'option:beforeSend': 5,
    'option:beforeSendTransaction': 1,
    'option:beforeBreadcrumb': 1,
    'option:denyUrls': 5,
    'option:allowUrls': 5,
    'option:sendDefaultPii': 2,
    'option:enableLogs': 5,
    'option:serializeAttribute': 1,
    'option:maxBreadcrumbs': 1,
    'option:attachStacktrace': 5,
    'option:setUser': 1,
    'extension-url:moz-extension': 1,
    'extension-url:chrome-extension': 1,
    'extension-url:safari-web-extension': 3,
    'extension-url:ms-browser-extension': 1,
    'shadow-probe:attachShadow': 1,
    'shadow-probe:.shadowRoot': 19,
    'native-check:[nativecode]': 2,
    'composer-bridge:__omComposerBridge': 3,
  },
};

const keyOf = (signal: TelemetrySignal, match: string): string => `${signal.id}:${match.replace(/[`"'\s]/g, '')}`;

/** Every signal of a copy's scripts, by `signal:token`, with the first places of each (`file:line`). */
export function telemetryCounts(files: readonly BundleFile[], limit = 3): { readonly counts: Record<string, number>; readonly at: Record<string, string[]> } {
  const counts: Record<string, number> = {};
  const at: Record<string, string[]> = {};
  for (const file of files) {
    if (!file.name.endsWith('.js')) continue;
    for (const signal of TELEMETRY_SIGNALS) {
      for (const match of file.text.matchAll(signal.pattern)) {
        const key = keyOf(signal, match[0]);
        counts[key] = (counts[key] ?? 0) + 1;
        const places = (at[key] ??= []);
        if (places.length < limit) places.push(`${file.name}:${file.text.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  return { counts, at };
}

export interface TelemetryWarning {
  /** `signal:token`. */
  readonly key: string;
  readonly what: string;
  readonly from: number;
  readonly to: number;
  /** First places in the new copy (none when the token is gone). */
  readonly at: readonly string[];
}

/** The tokens whose count is not the baseline's: new, more, fewer or gone. Sorted: new and grown first. */
export function telemetryTripwire(files: readonly BundleFile[], baseline: Readonly<Record<string, number>> = TELEMETRY_BASELINE.counts): TelemetryWarning[] {
  const { counts, at } = telemetryCounts(files);
  const warnings: TelemetryWarning[] = [];
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(counts)])) {
    const from = baseline[key] ?? 0;
    const to = counts[key] ?? 0;
    if (from === to) continue;
    const signal = TELEMETRY_SIGNALS.find((item) => key.startsWith(`${item.id}:`));
    warnings.push({ key, what: signal?.what ?? key, from, to, at: at[key] ?? [] });
  }
  return warnings.sort((a, b) => Number(b.to > b.from) - Number(a.to > a.from) || a.key.localeCompare(b.key));
}
