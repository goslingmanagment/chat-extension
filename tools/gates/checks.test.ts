import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { readTree } from '../lib/files.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import {
  checkBrowserApiScope,
  checkHtmlSinks,
  checkMainWorldBundles,
  checkOnlyMonsterReferences,
  checkReleaseBundle,
  checkSdkCustody,
  checkSendQueueReferences,
  checkUiTexts,
  deriveSdkMarkers,
  missingSdkMarkerKinds,
  SEND_PORT_FILE,
  type SdkMarker,
  type SourceFile,
} from './checks.ts';

const file = (path: string, text: string): SourceFile => ({ path, text });
const gates = (violations: ReadonlyArray<{ gate: string }>): string[] => violations.map((violation) => violation.gate);

describe('gate: onlymonster references', () => {
  it('flags the origin in code outside the allowlist, ignores comments', () => {
    const violations = checkOnlyMonsterReferences([
      file('packages/core/src/domain/x.ts', "// talks about chat.onlymonster.ai in prose\nexport const u = 'https://chat.onlymonster.ai/api';"),
      file('packages/ui/src/y.tsx', 'export const t = `wss://${host}.onlymonster.ai/`;'),
      file('apps/extension/src/hosts.ts', "export const M = ['https://chat.onlymonster.ai/*'];"),
    ]);
    expect(violations.map((violation) => [violation.path, violation.line])).toEqual([
      ['packages/core/src/domain/x.ts', 2],
      ['packages/ui/src/y.tsx', 1],
    ]);
  });

  it('sees through regex literals and escaped RegExp strings', () => {
    const violations = checkOnlyMonsterReferences([
      file('packages/core/src/domain/a.ts', 'export const a = /^https:\\/\\/chat\\.onlymonster\\.ai\\/api\\//;'),
      file('packages/core/src/domain/b.ts', 'export const b = /chat.onlymonster.ai\\/api/;'),
      file('packages/core/src/domain/c.ts', "export const c = new RegExp('chat\\\\.onlymonster\\\\.ai');"),
      file('packages/core/src/domain/d.ts', 'export const d = /onlymonster[.]ai/i;'),
      file('packages/core/src/domain/ok.ts', 'export const ok = /onlymonster/; // not the origin'),
    ]);
    expect(violations.map((violation) => violation.path)).toEqual([
      'packages/core/src/domain/a.ts',
      'packages/core/src/domain/b.ts',
      'packages/core/src/domain/c.ts',
      'packages/core/src/domain/d.ts',
    ]);
  });
});

describe('gate: HTML sinks', () => {
  it('flags innerHTML, insertAdjacentHTML, dangerouslySetInnerHTML and document.write', () => {
    const violations = checkHtmlSinks([
      file('packages/ui/src/a.ts', "el.innerHTML = data;\nel['outerHTML'] = x;\nel.insertAdjacentHTML('beforeend', x);\ndocument.write(x);"),
      file('packages/ui/src/b.tsx', 'export const B = () => <div dangerouslySetInnerHTML={{ __html: x }} />;'),
      file('packages/ui/src/c.ts', "el.textContent = data; // innerHTML is banned"),
    ]);
    expect(violations).toHaveLength(5);
    expect(new Set(violations.map((violation) => violation.path))).toEqual(new Set(['packages/ui/src/a.ts', 'packages/ui/src/b.tsx']));
  });
});

describe('gate: browser.* scope', () => {
  it('allows packages/platform only — entry points and composition roots go through it', () => {
    const code = 'browser.runtime.getURL("x"); chrome.storage.local.get();';
    const violations = checkBrowserApiScope([
      file('packages/platform/src/runtime.ts', code),
      file('apps/extension/src/entrypoints/background.ts', code),
      file('apps/extension/src/composition/tab.ts', code),
      file('packages/core/src/domain/x.ts', '// no browser.* here\nconst browserName = "x";'),
    ]);
    expect(violations.map((violation) => violation.path)).toEqual([
      'apps/extension/src/entrypoints/background.ts',
      'apps/extension/src/entrypoints/background.ts',
      'apps/extension/src/composition/tab.ts',
      'apps/extension/src/composition/tab.ts',
    ]);
  });
});

describe('gate: UI vocabulary (AU-019)', () => {
  it('flags token/key/API/bearer in JSX text, text attributes and page strings', () => {
    const violations = checkUiTexts([
      file('packages/ui/src/a.tsx', 'export const A = () => <p title="Paste your API key">Enter the token</p>;'),
      file('packages/ui/src/b.tsx', 'export const B = () => <p>{"Введите токен"}</p>;'),
      file('packages/ui/src/c.tsx', 'export const C = () => <p class="hotkeys" key="k">Горячие клавиши</p>;'),
      file('apps/extension/src/composition/pages.ts', "const T = { popup: 'Bearer setup' };"),
    ]);
    expect(violations.map((violation) => violation.path)).toEqual([
      'packages/ui/src/a.tsx',
      'packages/ui/src/a.tsx',
      'packages/ui/src/b.tsx',
      'apps/extension/src/composition/pages.ts',
    ]);
  });
});

describe('gate: send queue scope', () => {
  it('allows the method only in the MAIN send port', () => {
    const violations = checkSendQueueReferences([
      file(SEND_PORT_FILE, 'store.enqueue(item);'),
      file('packages/host-chatspace/src/main/bridge.ts', "store['enqueue'](x); store.enqueue(y); // enqueue in a comment is fine"),
    ]);
    expect(violations).toHaveLength(2);
    expect(gates(violations)).toEqual(['send-queue-scope', 'send-queue-scope']);
  });
});

describe('gate: release bundle', () => {
  it('flags loopback hosts, the spike probe and the test id', () => {
    const violations = checkReleaseBundle([
      file('background.js', 'const m=["http://127.0.0.1/*"]'),
      file('content-scripts/chatspace.js', 'setAttribute("data-cg-spike",x)'),
      file('manifest.json', '{"id":"chat-extension-test@gosling.agency"}'),
      file('lazy/dock.js', 'export{}'),
    ]);
    expect(violations.map((violation) => violation.path)).toEqual(['background.js', 'content-scripts/chatspace.js', 'manifest.json']);
  });

  it('flags the spike timing marks', () => {
    expect(gates(checkReleaseBundle([file('content-scripts/chatspace.js', 'globalThis.__cgBundleMarks={t0:performance.now()};')]))).toEqual([
      'release-bundle',
    ]);
  });
});

describe('gate: SDK custody (§4, D-13)', () => {
  const markers = deriveSdkMarkers(readTree(`${REPO_ROOT}vendor/kernel-sdk/dist`, (path) => path.endsWith('.js')));
  const texts = (kind: SdkMarker['kind']): string[] => markers.filter((marker) => marker.kind === kind).map((marker) => marker.text);
  // Excerpts of a real release build in which composition/tab.ts, pages.ts and
  // lazy/entries/dock.ts imported composition/background.ts (and with it @cg/hub).
  const bundle = readTree(`${REPO_ROOT}tests/fixtures/sdk-bundle`);

  it('derives markers of every kind from the vendored SDK', () => {
    const vendored = JSON.parse(readFileSync(`${REPO_ROOT}vendor/kernel-sdk/kernel-sdk.vendor.json`, 'utf8')) as { contractHash: string };
    expect(missingSdkMarkerKinds(markers)).toEqual([]);
    expect(texts('contract-hash')).toEqual([vendored.contractHash]);
    expect(texts('error-class')).toEqual(['KernelApiError']);
    expect(texts('kernel-header')).toEqual(['x-kernel-ai-capabilities']);
    expect(texts('hub-route')).toEqual(
      expect.arrayContaining(['/api/v1/ai/features/', '/api/v1/events/v2/stream', '/api/v1/ofapi/read/', '/api/v1/auth/login']),
    );
    expect(texts('hub-route').length).toBeGreaterThan(100);
  });

  it('derives markers from code only: literals and template heads, never comments', () => {
    const derived = deriveSdkMarkers([
      file(
        'dist/a.js',
        [
          '// "/api/v1/in-a-comment", "x-kernel-in-a-comment"',
          'export class FooError extends Error { constructor(m) { super(m); this.name = "FooError"; } }',
          'export const path = (id) => `/api/v2/things/${id}`;',
          'export const headers = { "x-kernel-trace": "1", other: "/not/api" };',
          `export const HASH = "${'a'.repeat(64)}";`,
        ].join('\n'),
      ),
    ]);
    expect(derived).toHaveLength(4);
    expect(derived).toEqual(
      expect.arrayContaining([
        { kind: 'error-class', text: 'FooError' },
        { kind: 'hub-route', text: '/api/v2/things/' },
        { kind: 'kernel-header', text: 'x-kernel-trace' },
        { kind: 'contract-hash', text: 'a'.repeat(64) },
      ]),
    );
    expect(missingSdkMarkerKinds(derived.filter((marker) => marker.kind !== 'error-class'))).toEqual(['error-class']);
  });

  it('flags SDK code in every built JS file but background.js (fixture bundle)', () => {
    const violations = checkSdkCustody(bundle, markers);
    expect(violations.map((violation) => [violation.path, violation.line])).toEqual([
      ['chunks/pages-fixture.js', 2],
      ['content-scripts/chatspace.js', 3],
      ['lazy/dock.js', 2],
    ]);
    expect(violations[1]?.message).toContain('error-class «KernelApiError»');
    expect(violations[2]?.message).toContain('kernel-header «x-kernel-ai-capabilities»');
    // background.js carries the same SDK code: only the allowlist lets it pass.
    const background = bundle.filter((entry) => entry.path === 'background.js');
    expect(checkSdkCustody(background, markers, []).map((violation) => violation.path)).toEqual(['background.js']);
  });

  it('ignores lookalikes and non-JS files, refuses to run without markers', () => {
    expect(bundle.map((entry) => entry.path)).toContain('content-scripts/chatspace-main.js');
    expect(
      checkSdkCustody(
        [file('popup.html', '<p>KernelApiError</p>'), file('manifest.json', '{"x":"/api/v1/auth/login"}'), file('lazy/x.js', 'const u=`https://hub.example.test/api/v1/auth/login`;')],
        markers,
      ),
    ).toEqual([]);
    expect(() => checkSdkCustody(bundle, [])).toThrow(/no SDK markers/);
  });
});

describe('gate: MAIN-world bundles (§4, D-06)', () => {
  it('flags extension API, runtime calls and zod in the bridge and the tap only', () => {
    const violations = checkMainWorldBundles([
      file('content-scripts/chatspace-main.js', 'var n=globalThis.browser?.runtime?.id==null?globalThis.browser:globalThis.chrome;function r(e){return n.runtime.getURL(e)}'),
      file('chatspace-ws.js', 'class $ZodType{}'),
      file('content-scripts/chatspace.js', 'browser.runtime.getURL("x")'),
      file('content-scripts/chatspace-main.js', '(function(){let n=t.performance.now.bind(t.performance)})()'),
    ]);
    expect(violations.map((violation) => violation.path)).toEqual([
      'content-scripts/chatspace-main.js',
      'content-scripts/chatspace-main.js',
      'chatspace-ws.js',
    ]);
  });
});
