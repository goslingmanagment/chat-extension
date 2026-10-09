// The telemetry tripwire (telemetry.ts, decision X22) on synthetic inputs: a
// few lines shaped like minified bundles, written for this test — never
// ChatSpace's own code.

import { describe, expect, it } from 'vitest';

import { TELEMETRY_BASELINE, TELEMETRY_SIGNALS, telemetryCounts, telemetryTripwire } from './telemetry.ts';

const js = (name: string, text: string) => ({ name, text });

/** A copy that matches a baseline exactly: each `signal:token` written as many times as counted. */
const copyOf = (counts: Readonly<Record<string, number>>) => {
  const tokens = Object.entries(counts).flatMap(([key, count]) => {
    const token = key.slice(key.indexOf(':') + 1);
    const text = token === '[nativecode]' ? '"[native code]"' : key.startsWith('integration:') ? `name:"${token}"` : token === '.shadowRoot' ? 'e.shadowRoot' : token;
    return Array.from({ length: count }, () => text);
  });
  return [js('index-synthetic.js', tokens.join(';\n'))];
};

describe('[X22] telemetry tripwire', () => {
  it('a copy that matches the baseline is quiet; the shipped 0.195.0 baseline round-trips', () => {
    expect(telemetryTripwire(copyOf(TELEMETRY_BASELINE.counts))).toEqual([]);
    expect(telemetryCounts(copyOf(TELEMETRY_BASELINE.counts)).counts).toEqual(TELEMETRY_BASELINE.counts);
  });

  it.each([
    ['Replay', 'var x={blockClass:"rr-block",maskTextClass:"rr-mask"},replaysSessionSampleRate:.1', ['replay:replaysSessionSampleRate', 'replay:rr-block', 'replay:rr-mask']],
    ['BrowserTracing', 'const n=`BrowserTracing`;init({tracesSampleRate:1})', ['tracing:BrowserTracing', 'tracing:tracesSampleRate']],
    ['a new integration', 'var i="HttpClient",c={name:"CaptureConsole"};', ['integration:CaptureConsole', 'integration:HttpClient']],
    ['the Pinia plugin', 'b.addBreadcrumb({category:"pinia.action"})', ['integration:pinia.action']],
    ['a new init option', 'init({dsn:d,beforeBreadcrumb:f})', ['option:beforeBreadcrumb']],
    ['a look for extension frames', 'if(/moz-extension:/.test(f.filename))t.ext=!0', ['extension-url:moz-extension']],
    ['our own names', 'document.querySelector("[data-cg]");window[Symbol.for("wsTap")]', ['our-name:data-cg', 'our-name:wsTap']],
    ['symbols on window', 'Object.getOwnPropertySymbols( window ).map(e=>Symbol.keyFor(e))', ['global-probe:Symbol.keyFor', 'global-probe:getOwnPropertySymbols(window']],
    ['a native check of a global', 'String(WebSocket).includes("[native code]")', ['native-check:[nativecode]']],
    ['a closed-root probe', 'for(const e of document.querySelectorAll("div"))e.openOrClosedShadowRoot', ['shadow-probe:openOrClosedShadowRoot']],
  ])('%s fires: the new tokens, with where they are', (_name, extra, keys) => {
    const copy = [...copyOf(TELEMETRY_BASELINE.counts), js('chunk-new.js', `// synthetic\n${extra}`)];
    const warnings = telemetryTripwire(copy);
    expect(warnings.map((warning) => warning.key).sort()).toEqual([...keys].sort());
    for (const warning of warnings) {
      expect(warning.to).toBeGreaterThan(warning.from);
      // The first places of the token: a new one is found where it came; one that grew shows its earlier ones too.
      if (warning.from === 0) expect(warning.at).toEqual(['chunk-new.js:2']);
      else expect(warning.at.length).toBeGreaterThan(0);
    }
  });

  it('a token the build dropped is a warning too (a filter removed, an integration re-enabled)', () => {
    const counts = { ...TELEMETRY_BASELINE.counts, 'integration:BrowserSession': 1 };
    expect(telemetryTripwire(copyOf(counts)).map((warning) => [warning.key, warning.from, warning.to])).toEqual([['integration:BrowserSession', 2, 1]]);
  });

  it('against another copy instead of the baseline; stylesheets and pages are not scripts', () => {
    const older = [js('a.js', 'e.shadowRoot;e.shadowRoot')];
    const newer = [js('a.js', 'e.shadowRoot;e.shadowRoot;e.shadowRoot'), js('a.css', '.rr-block{}'), js('index.html', '<p>moz-extension</p>')];
    expect(telemetryTripwire(newer, telemetryCounts(older).counts).map((warning) => [warning.key, warning.from, warning.to])).toEqual([['shadow-probe:.shadowRoot', 2, 3]]);
  });

  it('every signal has a description and a global pattern', () => {
    for (const signal of TELEMETRY_SIGNALS) {
      expect(signal.what.length).toBeGreaterThan(10);
      expect(signal.pattern.flags).toContain('g');
    }
  });
});
