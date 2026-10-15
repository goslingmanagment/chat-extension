import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { readSources, readTree } from '../lib/files.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import {
  checkBrowserApiScope,
  checkFanslyAddresses,
  checkFetchScope,
  checkHtmlSinks,
  checkIsolatedStart,
  checkMainWorldBundles,
  checkMainWorldGuards,
  checkMessageAck,
  checkOnlyMonsterReferences,
  checkReleaseBundle,
  checkSdkCustody,
  checkSendQueueReferences,
  checkStandHooks,
  checkTabStorageListeners,
  checkUiTexts,
  deriveSdkMarkers,
  FANSLY_API_PREFIX,
  FETCH_EXCEPTIONS,
  HOST_KIT_MAIN_SOURCES,
  isMainWorldSource,
  ISOLATED_BUNDLES,
  MAIN_WORLD_BUNDLES,
  missingSdkMarkerKinds,
  onlyMonsterAllowed,
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
      file('apps/extension/src/hosts/runtime/chatspace.ts', "export const M = ['https://chat.onlymonster.ai/*'];"),
      file('packages/host-chatspace/src/isolated/host-contract.ts', "export const O = 'https://chat.onlymonster.ai';"),
      file('apps/extension/src/hosts.ts', "export const M = ['https://chat.onlymonster.ai/*'];"),
      file('packages/host-chatspace/src/isolated/adapter.ts', "export const O = 'https://chat.onlymonster.ai';"),
    ]);
    expect(violations.map((violation) => [violation.path, violation.line])).toEqual([
      ['packages/core/src/domain/x.ts', 2],
      ['packages/ui/src/y.tsx', 1],
      ['apps/extension/src/hosts.ts', 1],
      ['packages/host-chatspace/src/isolated/adapter.ts', 1],
    ]);
  });

  it('the allowlist is the host registry and each site’s contract module from it', () => {
    expect(onlyMonsterAllowed('apps/extension/src/hosts/index.ts')).toBe(true);
    expect(onlyMonsterAllowed('packages/host-chatspace/src/isolated/host-contract.ts')).toBe(true);
    expect(onlyMonsterAllowed('apps/extension/src/composition/background.ts')).toBe(false);
    expect(onlyMonsterAllowed('packages/host-chatspace/src/isolated/host-contract.ts', [])).toBe(false);
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
  it('allows Russian enable/disable verbs without allowing a credential key', () => {
    expect(checkUiTexts([file('apps/extension/src/composition/pages.ts', "const labels = ['Включить Fansly', 'Выключить Fansly', 'Подключение'];")])).toEqual([]);
    expect(checkUiTexts([file('apps/extension/src/composition/pages.ts', "const label = 'Введите ключ доступа';")])).toHaveLength(1);
  });
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
      file('packages/host-chatspace/src/main/runtime.ts', "store['enqueue'](x); store.enqueue(y); // enqueue in a comment is fine"),
    ]);
    expect(violations).toHaveLength(2);
    expect(gates(violations)).toEqual(['send-queue-scope', 'send-queue-scope']);
  });

  it('reads strings by whole identifier: a hub wire token is not the method', () => {
    const violations = checkSendQueueReferences([
      file('packages/contracts/src/hub/newcomers.ts', "const reasons = ['not_enqueued', 'native_rejected'] as const;"),
      file('packages/host-chatspace/src/isolated/x.ts', "const path = 'pendingMessages.enqueue'; const t = `${a}.enqueue(`;"),
    ]);
    expect(violations.map((v) => v.path)).toEqual(['packages/host-chatspace/src/isolated/x.ts', 'packages/host-chatspace/src/isolated/x.ts']);
  });
});

describe('gate: our requests — fetch, Fansly\'s addresses, no /message/ack (R20 P9b)', () => {
  it('the global fetch only in the hub layer, fansly-api, the relay frame and the stand; a property, a key or a type is not it', () => {
    const violations = checkFetchScope([
      file('packages/hub/src/x.ts', "export const a = () => fetch('/api');"),
      file('packages/fansly-api/src/client.ts', 'export const a = (u: string) => fetch(u);'),
      file('apps/extension/src/entrypoints/fansly-relay/main.ts', 'export const a = (u: string) => globalThis.fetch(u);'),
      file('packages/testing/src/fake-fansly/neighbor/own.ts', "export const a = () => fetch('/x');"),
      file('packages/core/src/services/a.ts', "export const a = () => fetch('/x');"),
      file('apps/extension/bg/fansly.ts', "export const a = () => self['fetch']('/x');"),
      file('packages/platform/src/b.ts', 'export const b = { fetch };'),
      file('packages/host-fansly/src/isolated/c.ts', "export const c = () => window.fetch('/x');"),
      file('packages/host-chatspace/src/testing/live.ts', 'type F = typeof fetch;\nexport const net = { fetch: (x: string) => x };\nexport const c = (win: { fetch(x: string): void }) => win.fetch("/x");\nexport interface W { readonly nativeFetch: typeof fetch }'),
      file('packages/ui/src/d.ts', 'export function d(fetch: (x: string) => void) { fetch("/x"); }'),
    ]);
    expect(violations.map((violation) => `${violation.path}:${violation.line}`)).toEqual([
      'packages/core/src/services/a.ts:1',
      'apps/extension/bg/fansly.ts:1',
      'packages/platform/src/b.ts:1',
      'packages/host-fansly/src/isolated/c.ts:1',
    ]);
    expect(gates(violations)).toEqual(['fetch-scope', 'fetch-scope', 'fetch-scope', 'fetch-scope']);
  });

  it('an exception holds its counted references only: one more is red, one fewer is a stale entry', () => {
    const background = FETCH_EXCEPTIONS.find((entry) => entry.path === 'apps/extension/src/composition/background.ts');
    expect(background?.count).toBe(1);
    const one = 'export const hubFetch = (input: string) => fetch(input);';
    expect(checkFetchScope([file('apps/extension/src/composition/background.ts', one)])).toEqual([]);
    expect(gates(checkFetchScope([file('apps/extension/src/composition/background.ts', `${one}\nexport const more = () => fetch('/x');`)]))).toEqual(['fetch-scope', 'fetch-scope']);
    expect(checkFetchScope([file('apps/extension/src/composition/background.ts', 'export const none = 1;')])[0]?.message).toMatch(/stale|shrink/);
  });

  it('in the code that requests Fansly every absolute address is under https://apiv3.fansly.com/api/v1/', () => {
    expect(FANSLY_API_PREFIX).toBe('https://apiv3.fansly.com/api/v1/');
    const violations = checkFanslyAddresses([
      file('packages/fansly-api/src/allowlist.ts', "export const BASE = 'https://apiv3.fansly.com/api/v1/';"),
      file('packages/fansly-api/src/a.ts', "export const a = 'https://apiv3.fansly.com/api/v2/account';"),
      file('packages/fansly-api/src/b.ts', 'export const b = `https://fansly.com/api/v1/${x}`;'),
      file('packages/fansly-api/src/c.ts', "export const c = 'http://localhost:4000/api/v1/';"),
      file('apps/extension/src/entrypoints/fansly-relay/main.ts', "export const d = 'wss://wsv3.fansly.com';"),
      file('packages/fansly-api/src/d.ts', '// https://example.com in prose\nexport const e = "a path, not an address: account/me";'),
      file('apps/extension/bg/fansly/api-probe.ts', 'export const STAND = /^http:\\/\\/localhost:[0-9]+$/;'),
    ]);
    expect(violations.map((violation) => `${violation.gate} ${violation.path}`)).toEqual([
      'fansly-addresses packages/fansly-api/src/a.ts',
      'fansly-addresses packages/fansly-api/src/b.ts',
      'fansly-addresses packages/fansly-api/src/c.ts',
      'fansly-addresses apps/extension/src/entrypoints/fansly-relay/main.ts',
    ]);
  });

  it('the string /message/ack is in no code of ours but the stand\'s — strings, templates, regular expressions; prose is free', () => {
    const violations = checkMessageAck([
      file('packages/fansly-api/src/x.ts', "export const x = '/api/v1/message/ack';"),
      file('packages/host-fansly/src/main/y.ts', 'export const y = /\\/message\\/ack$/;'),
      file('apps/extension/bg/fansly.ts', 'export const z = `${base}message/ack?ngsw-bypass=true`;\nexport const w = `${base}/message/ack`;'),
      file('packages/host-fansly/src/main/send-gesture.ts', '// `/message/ack`, `/typing`: the response table\nexport const t = 1;'),
      file('packages/testing/src/fake-fansly/api.ts', "export const route = /^\\/message\\/ack$/;\nexport const p = '/message/ack';"),
      file('packages/fansly-api/src/z.ts', "export const typing = '/message/typing'; export const acks = '/message/acknowledged';"),
    ]);
    expect(violations.map((violation) => `${violation.gate} ${violation.path}:${violation.line}`)).toEqual([
      'message-ack packages/fansly-api/src/x.ts:1',
      'message-ack packages/host-fansly/src/main/y.ts:1',
      'message-ack apps/extension/bg/fansly.ts:1',
      'message-ack apps/extension/bg/fansly.ts:2',
    ]);
  });

  it('this repository is clean, and the send-queue gate does not touch fansly-api', () => {
    const sources = readSources();
    expect(sources.some((source) => source.path.startsWith('packages/fansly-api/src/'))).toBe(true);
    expect(checkFetchScope(sources)).toEqual([]);
    expect(checkFanslyAddresses(sources)).toEqual([]);
    expect(checkMessageAck(sources)).toEqual([]);
    expect(checkSendQueueReferences(sources.filter((source) => source.path.startsWith('packages/fansly-api/') || source.path.startsWith('apps/extension/bg/fansly')))).toEqual([]);
  });
});

describe('gate: stand-only hooks', () => {
  it('flags data-stand-*, __stand and x-stand-* in our code, not in the stand package or in comments', () => {
    const violations = checkStandHooks([
      file('packages/host-chatspace/src/isolated/dock.ts', "// unlike the stand's data-stand-composer, ChatSpace has no such hook\nconst slot = root.querySelector('[data-stand-composer-slot]');"),
      file('packages/core/src/x.ts', 'const s = window.__stand; const h = { [`x-stand-native`]: 1 };'),
      file('packages/testing/src/stand/control.ts', "const hook = '[data-stand-composer]';"),
      file('packages/ui/src/y.tsx', "const id = 'data-standalone';"),
    ]);
    expect(violations.map((violation) => [violation.path, violation.line])).toEqual([
      ['packages/host-chatspace/src/isolated/dock.ts', 2],
      ['packages/core/src/x.ts', 1],
      ['packages/core/src/x.ts', 1],
    ]);
    expect(gates(violations)).toEqual(['stand-hooks', 'stand-hooks', 'stand-hooks']);
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

  it("flags Fansly's API probe of the e2e (R20 P9b)", () => {
    expect(gates(checkReleaseBundle([file('bg/fansly.js', 'const k={origin:"dev.fanslyApi.origin"};')]))).toEqual(['release-bundle']);
    expect(gates(checkReleaseBundle([file('lazy/fansly/tab-app.js', 'const k="data-cg-ops-command";')]))).toEqual(['release-bundle']);
    expect(checkReleaseBundle([file('bg/fansly.js', 'const k="dev.compatPageAccounts";')])).toEqual([]);
  });

  it('flags the background egress probe', () => {
    expect(gates(checkReleaseBundle([file('background.js', 'fetch("https://cg-bg-probe.invalid/probe")')]))).toEqual(['release-bundle']);
    // The sentry-gate e2e's throwing MAIN probe (a TEST build's only, decision X22).
    expect(gates(checkReleaseBundle([file('content-scripts/chatspace-main.js', 'addEventListener("cg-e2e-main-throw",function(){throw new Error("x")})')]))).toEqual(['release-bundle']);
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

describe('gate: no storage listener in a ChatSpace tab (§14)', () => {
  it('flags `storage.onChanged` in the content script and in a lazy chunk; the background and the pages may listen', () => {
    const violations = checkTabStorageListeners([
      file('content-scripts/chatspace.js', 'let a=e.storage.local.get(k);e.storage.onChanged.addListener(n)'),
      file('lazy/boards-preview.js', 'b?.storage?.local?.onChanged.addListener(f)'),
      file('lazy/chunks/shared.js', 'api.storage.local.set({k:v})'),
      file('content-scripts/chatspace-main.js', 'x.storage.onChanged'),
      file('background.js', 'e.storage.onChanged.addListener(n)'),
      file('chunks/pages.js', 'e.storage.onChanged.addListener(n)'),
    ]);
    expect(violations.map((violation) => [violation.gate, violation.path])).toEqual([
      ['tab-storage-listener', 'content-scripts/chatspace.js'],
      ['tab-storage-listener', 'lazy/boards-preview.js'],
    ]);
  });
});

describe('gate: the isolated start (§11)', () => {
  it("flags WXT's ContentScriptContext and entry wrapper in the isolated content script — not elsewhere", () => {
    const violations = checkIsolatedStart([
      file('content-scripts/chatspace.js', 'var o=class e{static SCRIPT_STARTED_MESSAGE_TYPE=r(`wxt:content-script-started`)}'),
      file('content-scripts/chatspace.js', 'throw a.error(`The content script "chatspace" crashed on startup!`,e),e'),
      file('content-scripts/chatspace.js', '(function(){var n={main(){c({win:window})}};n.main()})()'),
      file('background.js', 'var o=`wxt:content-script-started`'),
      file('lazy/dock.js', 'crashed on startup'),
    ]);
    expect(violations.map((violation) => [violation.gate, violation.path, violation.line])).toEqual([
      ['isolated-start', 'content-scripts/chatspace.js', 1],
      ['isolated-start', 'content-scripts/chatspace.js', 1],
    ]);
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

  it('[X22] flags a console call, a debugger statement and WXT’s rethrowing entry wrapper in a MAIN bundle — not elsewhere', () => {
    const violations = checkMainWorldBundles([
      file('content-scripts/chatspace-main.js', '(function(){try{a()}catch(e){console.error(e)}})()'),
      file('chatspace-ws.js', '(function(){debugger;})()'),
      file('chatspace-ws.js', '(function(){var c=console;c?.["log"]("x")})()'),
      file('content-scripts/chatspace-main.js', 'throw $.error(`The content script "chatspace-main" crashed on startup!`,e),e'),
      file('content-scripts/chatspace.js', 'console.log("isolated")'),
      // A no-op logger object and a longer word are not a console reference.
      file('chatspace-ws.js', 'var $={debug:(...e)=>void 0};var t=`consoles`;'),
    ]);
    expect(violations.map((violation) => [violation.path, violation.message.match(/carries (.+?) «/)?.[1]])).toEqual([
      ['content-scripts/chatspace-main.js', 'a console reference'],
      ['chatspace-ws.js', 'a debugger statement'],
      ['chatspace-ws.js', 'a console reference'],
      ['content-scripts/chatspace-main.js', 'WXT\'s entry wrapper (it rethrows into the page)'],
    ]);
  });
});

describe('[X22] gate: MAIN-world guards', () => {
  const main = (name: string, text: string): ReturnType<typeof file> => file(`packages/host-chatspace/src/main/${name}.ts`, text);

  it('flags a callback handed to the page or the browser without guard(…)', () => {
    const violations = checkMainWorldGuards([
      main(
        'a',
        [
          'store.$onAction(({ after }) => after(() => undefined));',
          'router?.afterEach(onRoute);',
          'host.queue()?.$subscribe?.(() => sync(), { flush: "sync" });',
          'win.setInterval(tick, 30_000);',
          'new (win as W).MutationObserver(() => undefined);',
          'port.onmessage = (event) => handle(event);',
          'editor.on("transaction", listener);',
          'socket.addEventListener("message", onMessage);',
          'queueMicrotask(release);',
          'listenOn(socket, "message", (event) => read(event));',
        ].join('\n'),
      ),
    ]);
    expect(violations.map((violation) => violation.line)).toEqual([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(violations.every((violation) => violation.gate === 'main-world-guard')).toBe(true);
  });

  it('a guard(…) call, or a const of the same file bound to one, passes; so does a null handler and what is not a registration', () => {
    const violations = checkMainWorldGuards([
      main(
        'b',
        [
          "const onMessage = guard('message', (event: MessageEvent) => read(event));",
          "const onRoute: Listener = guard('route', () => undefined);",
          'socket.addEventListener("message", onMessage);',
          'socket.removeEventListener("message", onMessage);',
          'router.afterEach(onRoute);',
          "store.$onAction(guard('cache', ({ after }) => after(guard('cacheAfter', () => undefined))), true);",
          "new MutationObserver(guard('watch', () => undefined));",
          'port.onmessage = null;',
          'setTimer(stop, 15_000);',
          'frame(() => composerNow());',
          'livePort()?.sent(args[0], after, onError);',
        ].join('\n'),
      ),
      // Another folder and tests are not MAIN.
      file('packages/host-chatspace/src/isolated/x.ts', 'store.$onAction(() => undefined);'),
      file('packages/host-kit/src/isolated/x.ts', 'win.addEventListener("message", onWindowMessage, true);'),
      main('x.test', 'store.$onAction(() => undefined);'),
    ]);
    expect(violations).toEqual([]);
  });

  it('[host:chatspace] [host:fansly] the MAIN part of host-kit — the boot every site carries, and what both worlds share — is held to the same rule', () => {
    const violations = checkMainWorldGuards([
      file('packages/host-kit/src/main/x.ts', 'listen("message", onWindowMessage, true);\nport.onmessage = onPortMessage;'),
      file('packages/host-kit/src/common/y.ts', 'queueMicrotask(flush);'),
      file('packages/host-kit/src/main/ok.ts', "const onWindowMessage = guard('handshake', () => undefined);\nlisten('message', onWindowMessage, true);"),
    ]);
    expect(violations.map((violation) => [violation.path, violation.line])).toEqual([
      ['packages/host-kit/src/main/x.ts', 1],
      ['packages/host-kit/src/main/x.ts', 2],
      ['packages/host-kit/src/common/y.ts', 1],
    ]);
  });

  it('a `let` bound to a guard can be reassigned: it does not count', () => {
    expect(checkMainWorldGuards([main('c', "let cb = guard('x', () => undefined);\nsocket.addEventListener('close', cb);")])).toHaveLength(1);
  });

  it('the MAIN source of this repo is clean', () => {
    for (const dir of ['packages/host-chatspace/src/main', ...HOST_KIT_MAIN_SOURCES.map((source) => source.replace(/\/$/, ''))]) {
      const files = readTree(`${REPO_ROOT}${dir}`, (path) => path.endsWith('.ts')).map((entry) => ({ ...entry, path: `${dir}/${entry.path}` }));
      expect(files.length, dir).toBeGreaterThan(0);
      expect(checkMainWorldGuards(files), dir).toEqual([]);
    }
  });
});

describe('gates: the sites’ bundles and MAIN-world sources come from the host registry', () => {
  it('ChatSpace: the bridge and the WS tap in the page’s world, chatspace.js the isolated start; Fansly: fansly-main.js and fansly.js (R20 P7a0)', () => {
    expect(MAIN_WORLD_BUNDLES).toEqual(['content-scripts/chatspace-main.js', 'chatspace-ws.js', 'fansly-main.js']);
    expect(ISOLATED_BUNDLES).toEqual(['content-scripts/chatspace.js', 'fansly.js']);
    expect(isMainWorldSource('packages/host-fansly/src/main/index.ts')).toBe(true);
    expect(isMainWorldSource('packages/host-fansly/src/isolated/starter.ts')).toBe(false);
  });

  it('the MAIN-world source is the top level of host-chatspace/src/main, not its subfolders or other packages', () => {
    expect(isMainWorldSource('packages/host-chatspace/src/main/runtime.ts')).toBe(true);
    expect(isMainWorldSource('packages/host-chatspace/src/main/sub/x.ts')).toBe(false);
    expect(isMainWorldSource('packages/host-chatspace/src/isolated/adapter.ts')).toBe(false);
    expect(isMainWorldSource('packages/host-chatspace/src/main/runtime.ts', [])).toBe(false);
  });

  it('…and the MAIN part of host-kit, whatever the registry lists: the boot and `common`, not the isolated mechanics', () => {
    expect(HOST_KIT_MAIN_SOURCES).toEqual(['packages/host-kit/src/main/', 'packages/host-kit/src/common/']);
    expect(isMainWorldSource('packages/host-kit/src/main/bridge.ts')).toBe(true);
    expect(isMainWorldSource('packages/host-kit/src/main/bridge.ts', [])).toBe(true);
    expect(isMainWorldSource('packages/host-kit/src/common/digest.ts', [])).toBe(true);
    expect(isMainWorldSource('packages/host-kit/src/isolated/bridge-client.ts')).toBe(false);
    expect(isMainWorldSource('packages/host-kit/src/main/sub/x.ts')).toBe(false);
  });
});


describe('review regressions: request boundaries', () => {
  it('allows Fansly queues but still rejects ChatSpace enqueue outside the send port', () => {
    expect(checkSendQueueReferences([
      file('packages/fansly-api/src/pacer/queue.ts', 'queue.enqueue(item);'),
      file('apps/extension/bg/fansly/service.ts', 'queue.enqueue(item);'),
    ])).toEqual([]);
    expect(checkSendQueueReferences([file('packages/host-chatspace/src/main/oops.ts', 'queue.enqueue(item);')])).toHaveLength(1);
  });
  it.each([
    'const t = { send: fetch }; t.send(url);',
    'const t = { send: fetch }; t.send(url); function local(fetch: unknown) {}',
    'const t = { send: globalThis.fetch }; t.send(url);',
    'const t = { send: self["fetch"] }; t.send(url);',
  ])('rejects a transport alias: %s', (code) => {
    expect(checkFetchScope([file('packages/core/src/services/oops.ts', code)])).toHaveLength(1);
  });
});
