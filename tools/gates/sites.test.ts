// The gates that keep the two sites apart (docs/project-unite/architecture.md §1.8; R20 F9a): site literals with the
// debt list, whose path is whose (a fixture for every kind of Fansly path), the measure of ChatSpace's bytes
// (`pnpm gates:bytes`), Fansly's marker strings, build data in a bundle.

import { describe, expect, it } from 'vitest';

import { HOSTS, hostOf, type HostDescriptor } from '../../apps/extension/src/hosts/index.ts';
import { HOST_KINDS, HOST_PLATFORM } from '../../packages/contracts/src/hosts.ts';
import { readSources } from '../lib/files.ts';
import type { SourceFile } from './checks.ts';
import {
  BACKGROUND_CORE_FILE,
  checkBuildData,
  checkSiteLiterals,
  checkSiteMarkers,
  deriveSiteMarkers,
  describeByteChange,
  diffSiteBytes,
  findSiteLiterals,
  forbiddenSiteValues,
  isNeutralPath,
  isSiteArtifact,
  measureSiteBytes,
  parseSiteBytes,
  registryBuildFields,
  serializeSiteBytes,
  SITE_LITERAL_DEBT,
  SITES,
  siteOfPath,
  type SiteBytes,
  type SiteLiteralDebt,
} from './sites.ts';

const file = (path: string, text: string): SourceFile => ({ path, text });
const chatspace = hostOf('chatspace') as HostDescriptor;
const fansly = SITES.find((site) => site.kind === 'fansly-web') as (typeof SITES)[number];
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Every kind of path that is Fansly's own (architecture.md §1.8), one or two of each. */
const FANSLY_PATHS: ReadonlyArray<readonly [string, string]> = [
  ['its slice of the feature manifest (features/fansly.ts)', 'packages/contracts/src/features/fansly.ts'],
  ['a contract module (*-fansly.ts)', 'packages/contracts/src/tab-messages-fansly.ts'],
  ['a contract module (errors-fansly.ts)', 'packages/contracts/src/errors-fansly.ts'],
  ['a contract module (bridge-*-fansly.ts)', 'packages/contracts/src/bridge-messages-fansly.ts'],
  ['a contract module (send-fansly.ts)', 'packages/contracts/src/send-fansly.ts'],
  ['its contract types (fansly.ts)', 'packages/contracts/src/fansly.ts'],
  ['a lazy entry of its build (lazy/fansly/**)', 'apps/extension/lazy/fansly/notes.ts'],
  ['its background chunk (bg/fansly.ts)', 'apps/extension/bg/fansly.ts'],
  ['a module of its background chunk (bg/fansly/**)', 'apps/extension/bg/fansly/pacer.ts'],
  ['the package host-fansly', 'packages/host-fansly/src/main/ws-tap.ts'],
  ['the package fansly-api', 'packages/fansly-api/src/client.ts'],
  ['its services in the core (**/hosts/fansly/**)', 'packages/core/src/services/hosts/fansly/followers.ts'],
  ['its surfaces in ui (**/hosts/fansly/**)', 'packages/ui/src/hosts/fansly/Notes.tsx'],
  ['its half of the adapter in the composition (**/hosts/fansly/**)', 'apps/extension/src/composition/tab/hosts/fansly/app.ts'],
  ['its texts (hosts/fansly/i18n)', 'packages/core/src/domain/hosts/fansly/i18n/ru.ts'],
  ['its host registry entry (hosts/fansly.ts)', 'apps/extension/src/hosts/fansly.ts'],
  ['its MAIN entry point (entrypoints/fansly*)', 'apps/extension/src/entrypoints/fansly-main.content.ts'],
  ['its isolated entry point (entrypoints/fansly*)', 'apps/extension/src/entrypoints/fansly.content.ts'],
  ['the relay frame (entrypoints/fansly*)', 'apps/extension/src/entrypoints/fansly-relay/main.ts'],
];

describe('whose path is whose (site-paths.cjs)', () => {
  it('there is a site for every host kind of the contracts, named by its kind and its platform', () => {
    expect(SITES.map((site) => site.kind)).toEqual([...HOST_KINDS]);
    for (const site of SITES) expect(site.values).toEqual([site.kind, HOST_PLATFORM[site.kind]]);
  });

  it.each(FANSLY_PATHS)('Fansly’s own: %s', (_what, path) => {
    expect(siteOfPath(path)?.kind).toBe('fansly-web');
    expect(isNeutralPath(path)).toBe(false);
  });

  it.each([
    ['Fansly’s row of the runtime table: the background core and the pages read the whole table', 'apps/extension/src/hosts/runtime/fansly.ts'],
    ['the runtime table with every stand’s loopback name (P6a)', 'apps/extension/src/hosts/runtime/index.ts'],
    ['the host registry’s index: it reads every site’s entry', 'apps/extension/src/hosts/index.ts'],
    ['the settings key of the sites, read by the core', 'packages/core/src/domain/settings/ext.ts'],
    ['the hosts table of the contracts', 'packages/contracts/src/hosts.ts'],
    ['a shared module whose name only starts like the site', 'packages/core/src/domain/fanslyish.ts'],
    ['a shared component named in another case', 'packages/ui/src/pages/FanslySection.tsx'],
    ['ChatSpace’s own code', 'packages/host-chatspace/src/main/runtime.ts'],
    ['the shared mechanics of the page, which every site’s bundles carry', 'packages/host-kit/src/main/bridge.ts'],
    ['the build', 'apps/extension/lazy/vite.config.ts'],
    ['the dependencies', 'pnpm-lock.yaml'],
  ])('not Fansly’s, and built into a bundle: %s', (_what, path) => {
    expect(siteOfPath(path)?.kind).not.toBe('fansly-web');
    expect(isNeutralPath(path)).toBe(false);
  });

  it.each([
    'docs/project-unite/plan.md',
    'README.md',
    'site/index.html',
    'tools/gates/sites.ts',
    'tests/lint-boundaries.test.ts',
    '.github/workflows/ci.yml',
    // The Fansly stand (P6a) is the test package's: named by Fansly, built into no bundle.
    'packages/testing/fixture-fansly/src/composer.ts',
    'packages/testing/fixture-fansly.vite.config.ts',
    'packages/testing/src/fixture-fansly/harness.ts',
    'packages/testing/e2e/specs/fansly-stand.e2e.ts',
    'packages/testing/src/fake-fansly/api.ts',
    'packages/testing/src/fake-fansly/neighbor/guard.ts',
    'packages/testing/fansly-neighbor.vite.config.ts',
    'packages/contracts/test/fixtures/fansly.ts',
    'apps/extension/test/hosts.test.ts',
    'packages/host-fansly/src/main/ws-tap.test.ts',
    'packages/core/src/domain/ops/flags.test.ts',
  ])('nothing is built from %s: it is neutral', (path) => {
    expect(isNeutralPath(path)).toBe(true);
  });

  it('ChatSpace’s own paths are ChatSpace’s — but its row of the runtime table', () => {
    for (const path of ['packages/host-chatspace/src/isolated/starter.ts', 'apps/extension/bg/chatspace.ts', 'apps/extension/src/composition/tab/hosts/chatspace/app.ts', 'apps/extension/src/entrypoints/chatspace-ws.ts']) {
      expect(siteOfPath(path)?.kind, path).toBe('chatspace');
    }
    expect(siteOfPath('apps/extension/src/hosts/runtime/chatspace.ts')).toBeNull();
  });
});

describe('gate: site literals (architecture §1.8)', () => {
  const found = (path: string, text: string): string[] => findSiteLiterals([file(path, text)]).map((literal) => `${literal.line}: ${literal.value} (${literal.use})`);

  it('in shared code, flags a site value wherever it stands: a value, a comparison, a case, a type, a key', () => {
    const text = [
      "const chat = { host: 'chatspace', id };",
      "if (binding.platform === 'fansly') skip();",
      "if ('onlyfans' !== page.platform) skip();",
      "switch (host) { case 'fansly-web': break; }",
      "type Kind = 'chatspace' | 'fansly-web';",
      "const TONES = { onlyfans: 'blip', fansly: 'chime', 'fansly-web': 1 };",
      'const tone = TONES.fansly;',
      "const other = TONES['onlyfans'];",
      'const { chatspace, fansly: theirs } = hosts;',
      'const scripted = `fansly`;',
      'interface Rows { readonly chatspace: string }',
    ].join('\n');
    expect(found('packages/core/src/application/x.ts', text)).toEqual([
      '1: chatspace (value)',
      '2: fansly (comparison)',
      '3: onlyfans (comparison)',
      '4: fansly-web (comparison)',
      '5: chatspace (type)',
      '5: fansly-web (type)',
      '6: onlyfans (key)',
      '6: fansly (key)',
      '6: fansly-web (key)',
      '7: fansly (key)',
      '8: onlyfans (key)',
      '9: chatspace (key)',
      '9: fansly (key)',
      '10: fansly (value)',
      '11: chatspace (key)',
    ]);
  });

  it('by meaning: only a value counts — not another platform, null, a comment, a longer text, a name or a path', () => {
    const text = [
      "// ChatSpace is 'chatspace', fansly.com is 'fansly-web'",
      "if (os.platform === 'mac' || host === null) return;",
      "const title = msg('settings.status.row.chatspace');",
      'const path = `hosts.${site}.sound`;',
      "const note = 'Fansly through the tab';",
      'const fansly = sectionOf(hosts);',
      'function chatspace(): void {}',
      'export const value = fansly ?? chatspace;',
      "import { x } from './fansly';",
      "export { y } from 'onlyfans';",
      "const lazy = import('fansly');",
      "type T = import('chatspace').T;",
      'const picked = table[fansly];',
    ].join('\n');
    expect(found('packages/ui/src/pages/x.tsx', text)).toEqual([]);
  });

  it('is scoped: shared code of core, ui and hub; a site’s own code may name its site and no other; the rest is not gated', () => {
    const text = "export const a = 'chatspace'; export const b = 'fansly';";
    expect(found('packages/hub/src/facade.ts', text)).toEqual(['1: chatspace (value)', '1: fansly (value)']);
    // The shared mechanics of the page know no site either (F9b).
    expect(found('packages/host-kit/src/isolated/keep-bottom.ts', text)).toEqual(['1: chatspace (value)', '1: fansly (value)']);
    // A site's own folder inside a shared package, and a site's own package: the other site alone.
    expect(found('packages/core/src/domain/hosts/fansly/freshness.ts', text)).toEqual(['1: chatspace (value)']);
    expect(found('packages/core/src/services/hosts/chatspace/custody.ts', text)).toEqual(['1: fansly (value)']);
    expect(found('packages/host-chatspace/src/main/requests.ts', text)).toEqual(['1: fansly (value)']);
    expect(found('apps/extension/bg/fansly.ts', text)).toEqual(['1: chatspace (value)']);
    // Where the sites are told apart by design.
    for (const path of [
      'packages/core/src/domain/features/admission.ts',
      'packages/contracts/src/hosts.ts',
      'packages/contracts/src/ids.ts',
      'packages/platform/src/rpc-background.ts',
      'apps/extension/src/composition/background.ts',
      'apps/extension/src/hosts/runtime/index.ts',
      'packages/core/src/domain/ops/flags.test.ts',
      'packages/testing/src/fake-hub/pages.ts',
    ]) {
      expect(forbiddenSiteValues(path), path).toBeNull();
      expect(found(path, text), path).toEqual([]);
    }
  });

  describe('the debt list', () => {
    const path = 'packages/core/src/application/preview/controller.ts';
    const debt: SiteLiteralDebt[] = [{ path, value: 'chatspace', count: 2, note: 'binding.host' }];
    const twice = "const a = { host: 'chatspace' };\nconst b = { host: 'chatspace' };";
    const messages = (files: readonly SourceFile[], list: readonly SiteLiteralDebt[] = debt): string[] =>
      checkSiteLiterals(files, list).map((violation) => `${violation.gate}: ${violation.path}:${violation.line} — ${violation.message}`);

    it('lets through exactly what it names', () => {
      expect(messages([file(path, twice)])).toEqual([]);
    });

    it('a new literal in a file of the list is red, with its lines', () => {
      const [message, ...rest] = messages([file(path, `${twice}\nconst c = { host: 'chatspace' };`)]);
      expect(rest).toEqual([]);
      expect(message).toContain(`site-literal: ${path}:1 — 'chatspace' ×3 (lines 1, 2, 3), the debt list allows ×2 (binding.host)`);
    });

    it('a literal of another value in the same file, and a literal in a file the list does not name, are red at their lines', () => {
      expect(messages([file(path, `${twice}\nif (platform === 'fansly') skip();`)])).toEqual([
        `site-literal: ${path}:3 — 'fansly' as a comparison — shared code names no site: take it from the binding, the site profile or the feature manifest (docs/project-unite/architecture.md §1.8).`,
      ]);
      expect(messages([file(path, twice), file('packages/ui/src/dock/Strip.tsx', "const variant = 'fansly-web';")])).toEqual([
        "site-literal: packages/ui/src/dock/Strip.tsx:1 — 'fansly-web' as a value — shared code names no site: take it from the binding, the site profile or the feature manifest (docs/project-unite/architecture.md §1.8).",
      ]);
    });

    it('a site’s own code naming the other site is red too', () => {
      expect(messages([file(path, twice), file('packages/host-fansly/src/isolated/route.ts', "const other = 'chatspace';")])).toEqual([
        "site-literal: packages/host-fansly/src/isolated/route.ts:1 — 'chatspace' as a value — fansly-web's own code names no other site (docs/project-unite/architecture.md §1.8).",
      ]);
    });

    it('the list only shrinks: an entry the file has outgrown is red until it is lowered or dropped', () => {
      expect(messages([file(path, "const a = { host: 'chatspace' };")])).toEqual([
        `site-literal-debt: ${path}:1 — names 'chatspace' ×1 now, the debt list says ×2 (binding.host): lower it to 1 in tools/gates/sites.ts — the list only shrinks.`,
      ]);
      expect(messages([file(path, 'const a = { host: binding.host };')])).toEqual([
        `site-literal-debt: ${path}:1 — names 'chatspace' ×0 now, the debt list says ×2 (binding.host): drop the entry in tools/gates/sites.ts — the list only shrinks.`,
      ]);
      // The file itself is gone.
      expect(messages([])).toHaveLength(1);
    });

    it('an entry written twice, without a count, or for a place the gate does not forbid is an error of the list', () => {
      const gates = (list: readonly SiteLiteralDebt[]): string[] => checkSiteLiterals([file(path, twice)], list).map((violation) => violation.message);
      expect(gates([...debt, ...debt])[0]).toContain('twice');
      expect(gates([{ ...debt[0]!, count: 0 }])[0]).toContain('has no count');
      expect(gates([...debt, { path: 'packages/contracts/src/hosts.ts', value: 'chatspace', count: 1, note: '' }])[0]).toContain('is not debt');
    });
  });

  it('this repo: the debt list is exactly what shared code still names', () => {
    expect(checkSiteLiterals(readSources(), SITE_LITERAL_DEBT)).toEqual([]);
    for (const entry of SITE_LITERAL_DEBT) expect(entry.note.length, entry.path).toBeGreaterThan(0);
  });
});

describe('bytes per site, on demand (pnpm gates:bytes)', () => {
  const built = (files: Readonly<Record<string, string>>): SiteBytes => measureSiteBytes(chatspace, Object.entries(files).map(([path, text]) => ({ path, data: bytes(text) })));

  it('ChatSpace’s files are its scripts, its lazy build, its background chunk — and the background core', () => {
    for (const path of ['content-scripts/chatspace-main.js', 'content-scripts/chatspace.js', 'chatspace-ws.js', 'lazy/chatspace/dock.js', 'lazy/chatspace/chunks/kernel-DA8hH5uq.js', 'bg/chatspace.js', BACKGROUND_CORE_FILE]) {
      expect(isSiteArtifact(chatspace, path), path).toBe(true);
    }
    // Another site's files, the extension pages and the manifest are not.
    for (const path of ['fansly-main.js', 'fansly.js', 'lazy/fansly/bridge-validation.js', 'lazy/fansly/notes.js', 'bg/fansly.js', 'chunks/pages-CaMHj_VA.js', 'popup.html', 'manifest.json', 'icons/48.png']) {
      expect(isSiteArtifact(chatspace, path), path).toBe(false);
    }
  });

  it('measures only the site’s files, and the pins round-trip one file a line', () => {
    const pins = built({ 'background.js': 'core', 'lazy/chatspace/dock.js': 'dock', 'lazy/fansly/notes.js': 'notes', 'manifest.json': '{}' });
    expect(Object.keys(pins.files)).toEqual(['background.js', 'lazy/chatspace/dock.js']);
    // The file as it ships: its length in bytes and the sha256 of those bytes.
    expect(pins.files['background.js']).toEqual({ bytes: 4, sha256: '0d45f5fd462b8c70bffb10021ac1bcff3f58f29b1faf7568595095427d42812c' });
    const text = serializeSiteBytes(pins);
    expect(text.split('\n')).toHaveLength(8);
    expect(parseSiteBytes(text)).toEqual(pins);
    expect(serializeSiteBytes(parseSiteBytes(text))).toBe(text);
    expect(() => parseSiteBytes('{"files": {}}')).toThrow(/no `site`/);
    expect(() => parseSiteBytes('{"site": "chatspace", "files": {"a.js": {"bytes": 1}}}')).toThrow(/a\.js/);
  });

  it('a chunk the bundler renamed is one change, with both names', () => {
    const before = built({ 'lazy/chatspace/chunks/ai-CG6HL9UU.js': 'ai', 'lazy/chatspace/chunks/dock-98EVXy2I.js': 'dock' });
    const after = built({ 'lazy/chatspace/chunks/ai-Zx81kQ_p.js': 'ai and more', 'lazy/chatspace/chunks/dock-98EVXy2I.js': 'dock' });
    const changes = diffSiteBytes(before, after);
    expect(changes).toEqual([{ path: 'lazy/chatspace/chunks/ai-Zx81kQ_p.js', was: 'lazy/chatspace/chunks/ai-CG6HL9UU.js', before: 2, after: 11 }]);
    expect(describeByteChange(changes[0]!)).toBe('2 → 11 B (+9) (was lazy/chatspace/chunks/ai-CG6HL9UU.js)');
  });
});

describe('gate: no Fansly data in what ChatSpace loads (architecture §1.8, §3.2)', () => {
  const sources = [
    file('packages/contracts/src/tab-messages-fansly.ts', "export const T = ['fansly.voice.start', 'voice', 'audio/mpeg', 'chatspace'];\nexport const API = 'https://apiv3.example.test/api/v1/';\nimport './errors-fansly';"),
    file('packages/contracts/src/errors-fansly.ts', "export const E = ['CG-FAN-OFF', 'CG-SEND-OFF'] as const; // 'fx.comment'"),
    file('packages/contracts/src/bridge-fansly.ts', "export const B = ['fx.batch', 'fx.gap', 'probe', 'a sentence. with a dot'];"),
    // A namespace of the web platform (X46: the launcher's SVG glyphs) is nobody's marker: Preact names it in ChatSpace's dock too.
    file('packages/host-fansly/src/isolated/launcher-view.ts', "export const NS = 'http://www.w3.org/2000/svg';"),
    file('packages/core/src/domain/hosts/fansly/i18n/ru.ts', "export const RU = { 'cg.fanOff.title': 'Fansly выключен' };"),
    file('packages/contracts/src/errors.ts', "export const SHARED = ['CG-SEND-OFF'];"),
    file('packages/contracts/src/bridge.ts', "export const PROBE = 'probe';"),
    file('vendor/kernel-sdk/dist/index.js', "export const ROUTE = 'fx.gap';"),
    file('packages/contracts/test/fixtures/fansly.ts', "export const F = 'fx.fixtureOnly';"),
    file('packages/contracts/src/fansly.test.ts', "it('fx.testOnly', () => {});"),
  ];

  it('derives the names only Fansly’s own modules carry: dotted names, CG codes, addresses — never a word, a platform token or what shared code names too', () => {
    expect(deriveSiteMarkers(sources, fansly)).toEqual(['CG-FAN-OFF', 'cg.fanOff.title', 'fansly.voice.start', 'fx.batch', 'https://apiv3.example.test/api/v1/']);
  });

  it('a marker in a file ChatSpace loads is red — as a whole string of the bundle, in any quotes', () => {
    const markers = deriveSiteMarkers(sources, fansly);
    const violations = checkSiteMarkers(
      [
        { path: 'background.js', text: 'var a=`fx.batch`,b="CG-FAN-OFF",c=\'fansly.voice.start\',d=`cg.fanOff.title`;' },
        { path: 'lazy/chatspace/chunks/tab-protocol-C6IwgYFo.js', text: 'var t=["tab.register",\n"fansly.voice.start"];' },
        // Not a whole string: a longer text, an identifier.
        { path: 'content-scripts/chatspace.js', text: 'var n=`see fx.batch in the docs`,fx={batch:1};fx.batch;' },
        // Not ChatSpace's: the pages carry both sites, Fansly's files are its own.
        { path: 'chunks/pages-CaMHj_VA.js', text: 'var e=`CG-FAN-OFF`;' },
        { path: 'lazy/fansly/notes.js', text: 'var e=`fx.batch`;' },
        { path: 'bg/chatspace.js.map', text: '`fx.batch`' },
      ],
      chatspace,
      markers,
      'fansly-web',
    );
    expect(violations.map((violation) => `${violation.path}:${violation.line} — ${violation.message}`)).toEqual([
      'background.js:1 — a file chatspace loads carries data of fansly-web: «fx.batch», «CG-FAN-OFF», «fansly.voice.start» and 1 more (docs/project-unite/architecture.md §1.8, §3.2).',
      'lazy/chatspace/chunks/tab-protocol-C6IwgYFo.js:2 — a file chatspace loads carries data of fansly-web: «fansly.voice.start» (docs/project-unite/architecture.md §1.8, §3.2).',
    ]);
  });

  it('refuses to run without markers', () => {
    expect(() => checkSiteMarkers([], chatspace, [], 'fansly-web')).toThrow(/no markers of fansly-web/);
  });

  it('this repo: every registry of Fansly yields markers — its bridge, its tab protocol, its error codes, its texts', () => {
    const markers = deriveSiteMarkers(readSources(), fansly);
    expect(markers).toEqual(expect.arrayContaining(['fx.batch', 'fx.gap', 'fansly.followers.scan', 'CG-FAN-OFF', 'cg.fanOff.title', 'https://apiv3.fansly.com/api/v1/']));
    // What both sites' code names is no marker.
    for (const shared of ['fansly-web', 'fansly', 'chatspace', 'probe']) expect(markers).not.toContain(shared);
  });
});

describe('gate: no build data in a bundle (architecture §1.2)', () => {
  it('the host registry’s build fields: lazy entry sources, the contract check, MAIN-world sources, archive markers', () => {
    const fields = registryBuildFields(HOSTS);
    expect(fields).toEqual(expect.arrayContaining(['packages/host-chatspace/src/isolated/host-contract.ts', 'CG_CHATSPACE_BUNDLES', 'packages/host-chatspace/src/main/', 'chatspace-bundles']));
    expect(fields.length).toBeGreaterThan(15);
  });

  it('a build field in a built file is red; a binary file is not read', () => {
    const violations = checkBuildData(
      [
        { path: 'background.js', text: 'var a=1;\nvar env=`CG_CHATSPACE_BUNDLES`;' },
        { path: 'lazy/chatspace/dock.js', text: 'var ok=`CG-SEND-OFF`;' },
        { path: 'icons/48.png', text: 'CG_CHATSPACE_BUNDLES' },
      ],
      HOSTS,
    );
    expect(violations.map((violation) => `${violation.path}:${violation.line} — ${violation.message}`)).toEqual([
      'background.js:2 — a build field of the host registry is in the bundle: «CG_CHATSPACE_BUNDLES» (docs/project-unite/architecture.md §1.2).',
    ]);
  });

  it('refuses to run without a field to look for', () => {
    expect(() => checkBuildData([], [])).toThrow(/no build field/);
  });
});
