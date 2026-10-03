import { describe, expect, it } from 'vitest';

import {
  checkBrowserApiScope,
  checkHtmlSinks,
  checkOnlyMonsterReferences,
  checkReleaseBundle,
  checkSendQueueReferences,
  checkUiTexts,
  SEND_PORT_FILE,
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
  it('allows platform and entry points only', () => {
    const code = 'browser.runtime.getURL("x"); chrome.storage.local.get();';
    const violations = checkBrowserApiScope([
      file('packages/platform/src/runtime.ts', code),
      file('apps/extension/src/entrypoints/background.ts', code),
      file('apps/extension/src/composition/tab.ts', code),
      file('packages/core/src/domain/x.ts', '// no browser.* here\nconst browserName = "x";'),
    ]);
    expect(violations.map((violation) => violation.path)).toEqual(['apps/extension/src/composition/tab.ts', 'apps/extension/src/composition/tab.ts']);
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
});
