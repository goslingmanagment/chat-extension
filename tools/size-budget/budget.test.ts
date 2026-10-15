import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CHATSPACE } from '../../apps/extension/src/hosts/chatspace.ts';
import { FANSLY } from '../../apps/extension/src/hosts/fansly.ts';
import { HOSTS, type HostDescriptor, type LazySite } from '../../apps/extension/src/hosts/index.ts';
import { MAX_BACKGROUND_JS_BYTES } from '../archive-check/rules.ts';
import { BACKGROUND_CORE, BUDGETS, backgroundBudgets, computeBudgets, scriptBudgets, staticClosure, type LazyChunk } from './budget.ts';
import { contractsProbes } from './contracts-probes.ts';

/** ChatSpace's build in these tests: its root, the dock its one layer. */
const SITE: LazySite = { site: 'chatspace', build: { ...CHATSPACE.lazy, layers: ['dock'], beforeTheDock: [] }, matches: [] };
const at = (file: string): string => `lazy/chatspace/${file}`;
const chunk = (file: string, kind: LazyChunk['kind'], name: string | null, imports: readonly string[], layer?: number): LazyChunk => ({
  file: at(file),
  kind,
  name,
  imports: imports.map(at),
  ...(layer === undefined ? {} : { layer }),
  site: 'chatspace',
});

const chunks: LazyChunk[] = [
  chunk('dock.js', 'entry', 'dock', ['chunks/preact.js'], 0),
  chunk('coach.js', 'entry', 'coach', ['chunks/preact.js', 'chunks/md.js']),
  chunk('chunks/preact.js', 'chunk', null, []),
  chunk('chunks/md.js', 'chunk', null, []),
];

/** Incompressible bytes so gzip size ≈ raw size. */
const noise = (bytes: number): Uint8Array => randomBytes(bytes);

describe('size budgets', () => {
  it('follows static imports transitively', () => {
    expect(staticClosure(at('coach.js'), chunks)).toEqual([at('chunks/md.js'), at('chunks/preact.js'), at('coach.js')]);
  });

  it('counts shared chunks once, in the dock line', () => {
    const files: Record<string, Uint8Array> = {
      'content-scripts/chatspace-main.js': noise(1000),
      'chatspace-ws.js': noise(500),
      'content-scripts/chatspace.js': noise(9000),
      [at('dock.js')]: noise(4000),
      [at('chunks/preact.js')]: noise(12000),
      [at('coach.js')]: noise(2000),
      [at('chunks/md.js')]: noise(40_000),
    };
    const lines = computeBudgets((file) => files[file] ?? new Uint8Array(), chunks, [CHATSPACE], [SITE]);
    const coach = lines.find((line) => line.label.includes('coach'));
    expect(coach?.label).toBe('chatspace: lazy chunk coach (beyond the layers)');
    expect(coach?.files).toEqual([at('chunks/md.js'), at('coach.js')]);
    expect(coach?.ok).toBe(false);
    expect(coach?.limitBytes).toBe(BUDGETS.lazyChunk);
    expect(lines.filter((line) => !line.ok)).toHaveLength(1);
  });

  it('a layer is measured on top of the layers before it; an entry loaded on demand on top of them all, and never on top of another such entry', () => {
    const layered: LazyChunk[] = [
      chunk('dock.js', 'entry', 'dock', ['chunks/ui.js'], 0),
      chunk('tab-protocol.js', 'entry', 'tab-protocol', ['chunks/protocol.js'], 1),
      chunk('tab-app.js', 'entry', 'tab-app', ['chunks/protocol.js', 'chunks/app.js'], 2),
      chunk('ai.js', 'entry', 'ai', ['chunks/protocol.js', 'chunks/app.js', 'chunks/ai.js'], 3),
      chunk('boards.js', 'entry', 'boards', ['chunks/ai.js', 'chunks/lists.js']),
      chunk('preview.js', 'entry', 'preview', ['chunks/protocol.js', 'chunks/lists.js']),
      ...['ui', 'protocol', 'app', 'ai', 'lists'].map((name) => chunk(`chunks/${name}.js`, 'chunk', null, [])),
    ];
    const files: Record<string, Uint8Array> = {
      [at('chunks/ui.js')]: noise(20_000),
      [at('chunks/protocol.js')]: noise(25_000),
      [at('chunks/app.js')]: noise(8000),
      [at('chunks/ai.js')]: noise(26_000),
      [at('chunks/lists.js')]: noise(9000),
    };
    const lines = computeBudgets((file) => files[file] ?? noise(100), layered, [CHATSPACE], [SITE]);
    const filesOf = (name: string): readonly string[] | undefined => lines.find((line) => line.label.includes(` ${name} `))?.files;
    expect(filesOf('tab-protocol')).toEqual([at('chunks/protocol.js'), at('tab-protocol.js')]);
    // The schemas came with the protocol; the application pays only for its own.
    expect(filesOf('tab-app')).toEqual([at('chunks/app.js'), at('tab-app.js')]);
    expect(filesOf('ai')).toEqual([at('ai.js'), at('chunks/ai.js')]);
    // On demand: the layers are in memory, the other on-demand entry is not.
    expect(filesOf('boards')).toEqual([at('boards.js'), at('chunks/lists.js')]);
    expect(filesOf('preview')).toEqual([at('chunks/lists.js'), at('preview.js')]);
    expect(lines.every((line) => line.ok)).toBe(true);
    // A layer listed out of order is still measured in layer order.
    const shuffled = computeBudgets((file) => files[file] ?? noise(100), [...layered].reverse(), [CHATSPACE], [SITE]);
    expect(shuffled.find((line) => line.label.includes(' tab-app '))?.files).toEqual([at('chunks/app.js'), at('tab-app.js')]);
  });

  it('[EX-007] the MAIN bridge line is the shipped document_start bundle — boot and runtime together — within 10 KiB (X11)', () => {
    const mainBridge = scriptBudgets([CHATSPACE]).find((budget) => budget.file === 'content-scripts/chatspace-main.js')?.limitBytes;
    expect(mainBridge).toBe(10 * 1024);
    const files = (main: number): Record<string, Uint8Array> => ({
      'content-scripts/chatspace-main.js': noise(main),
      'chatspace-ws.js': noise(500),
      'content-scripts/chatspace.js': noise(9000),
      [at('dock.js')]: noise(4000),
      [at('chunks/preact.js')]: noise(12000),
      [at('coach.js')]: noise(2000),
      [at('chunks/md.js')]: noise(2000),
    });
    const line = (main: number) => computeBudgets((file) => files(main)[file] ?? new Uint8Array(), chunks, [CHATSPACE], [SITE]).find((item) => item.files.includes('content-scripts/chatspace-main.js'));
    expect(line(9000)?.ok).toBe(true);
    expect(line(9000)?.limitBytes).toBe(mainBridge);
    expect(line(11_000)?.ok).toBe(false);
  });
});

describe('size budgets of the sites’ scripts (host registry)', () => {
  const dockOnly: LazyChunk[] = [chunk('dock.js', 'entry', 'dock', [], 0)];

  it('ChatSpace’s three lines come first, in the size report’s order, with their files and ceilings', () => {
    const lines = computeBudgets(() => noise(100), dockOnly, [CHATSPACE], [SITE]);
    expect(lines.slice(0, 3).map((line) => [line.label, line.files, line.limitBytes])).toEqual([
      ['MAIN bridge: boot + runtime (chatspace-main)', ['content-scripts/chatspace-main.js'], 10 * 1024],
      ['MAIN WS tap (chatspace-ws)', ['chatspace-ws.js'], 6 * 1024],
      ['isolated early bootstrap (chatspace)', ['content-scripts/chatspace.js'], 30 * 1024],
    ]);
  });

  it('a second site brings its own lines after ChatSpace’s and changes none of them', () => {
    const second: HostDescriptor = {
      ...CHATSPACE,
      kind: 'fansly-web',
      scripts: {
        main: { entry: 'site-main', file: 'content-scripts/site-main.js', world: 'MAIN', registration: 'dynamic' },
        isolated: { entry: 'site', file: 'content-scripts/site.js', world: 'ISOLATED', registration: 'dynamic' },
      },
      budgets: {
        scripts: [
          { entry: 'site-main', label: 'MAIN (site-main)', gzipBytes: 16 * 1024 },
          { entry: 'site', label: 'isolated (site)', gzipBytes: 30 * 1024 },
        ],
        contracts: [],
      },
    };
    expect(scriptBudgets([CHATSPACE, second])).toEqual([...scriptBudgets([CHATSPACE]), { label: 'MAIN (site-main)', file: 'content-scripts/site-main.js', limitBytes: 16 * 1024 }, { label: 'isolated (site)', file: 'content-scripts/site.js', limitBytes: 30 * 1024 }]);
  });

  it('a script without its line, or a line without its script, fails instead of going unmeasured', () => {
    const unbudgeted: HostDescriptor = { ...CHATSPACE, budgets: { ...CHATSPACE.budgets, scripts: CHATSPACE.budgets.scripts.filter((budget) => budget.entry !== 'chatspace-ws') } };
    expect(() => scriptBudgets([unbudgeted])).toThrow(/chatspace-ws has 0 budget lines/);
    const stray: HostDescriptor = { ...CHATSPACE, budgets: { ...CHATSPACE.budgets, scripts: [...CHATSPACE.budgets.scripts, { entry: 'gone', label: 'gone', gzipBytes: 1 }] } };
    expect(() => scriptBudgets([stray])).toThrow(/budgets gone, a script it does not declare/);
  });

  it('[R20 F1] the background is measured raw: the core under the 800 KiB signal threshold, each site’s chunk under its registry ceiling; a second site adds its own line', () => {
    const chunk = CHATSPACE.background;
    if (chunk === undefined) throw new Error('ChatSpace has a background chunk');
    expect(backgroundBudgets([CHATSPACE])).toEqual([
      { label: 'background core (background.js), raw', file: BACKGROUND_CORE, limitBytes: MAX_BACKGROUND_JS_BYTES },
      { label: 'background chunk of chatspace (bg/chatspace.js), raw', file: chunk.file, limitBytes: chunk.rawBytes },
    ]);
    const files: Record<string, Uint8Array> = { [at('dock.js')]: noise(10), [BACKGROUND_CORE]: new Uint8Array(MAX_BACKGROUND_JS_BYTES + 1), [chunk.file]: new Uint8Array(1000) };
    const lines = computeBudgets((file) => files[file] ?? new Uint8Array(), [{ file: at('dock.js'), kind: 'entry', name: 'dock', imports: [], layer: 0, site: 'chatspace' }], [CHATSPACE], [SITE]);
    // Raw, not gzip: a megabyte of zeros would be a few hundred bytes compressed.
    expect(lines.find((line) => line.files[0] === BACKGROUND_CORE)).toMatchObject({ unit: 'raw', bytes: MAX_BACKGROUND_JS_BYTES + 1, ok: false });
    expect(lines.find((line) => line.files[0] === chunk.file)).toMatchObject({ unit: 'raw', bytes: 1000, limitBytes: chunk.rawBytes, ok: true });
    const second: HostDescriptor = { ...CHATSPACE, kind: 'fansly-web', background: { source: 'bg/fansly.ts', file: 'bg/fansly.js', rawBytes: 200 * 1024 } };
    expect(backgroundBudgets([CHATSPACE, second])).toEqual([...backgroundBudgets([CHATSPACE]), { label: 'background chunk of fansly-web (bg/fansly.js), raw', file: 'bg/fansly.js', limitBytes: 200 * 1024 }]);
  });
});

describe('size budgets of the sites’ lazy builds and contract probes (R20 F2b)', () => {
  /** A second site's build: its dock layer, one panel on demand, its files under its own folder. */
  const second: LazySite = { site: 'fansly-web', build: { root: 'lazy/site', entries: {}, layers: ['dock'], beforeTheDock: [] }, matches: [] };
  const own = (file: string, imports: readonly string[], layer?: number): LazyChunk => ({
    file: `lazy/site/${file}`,
    kind: file.startsWith('chunks/') ? 'chunk' : 'entry',
    name: file.startsWith('chunks/') ? null : file.replace(/\.js$/, ''),
    imports: imports.map((item) => `lazy/site/${item}`),
    ...(layer === undefined ? {} : { layer }),
    site: 'fansly-web',
  });
  const both: LazyChunk[] = [...chunks, own('dock.js', ['chunks/preact.js'], 0), own('notes.js', ['chunks/preact.js']), own('chunks/preact.js', [])];

  it('each build is measured by itself, its lines named by its site: a second build changes no line of ChatSpace’s', () => {
    const read = (file: string): Uint8Array => new TextEncoder().encode(file.repeat(50));
    const alone = computeBudgets(read, chunks, [CHATSPACE], [SITE]);
    const lines = computeBudgets(read, both, [CHATSPACE], [SITE, second]);
    const own = (line: { readonly label: string }): boolean => line.label.startsWith('fansly-web: ');
    expect(lines.filter((line) => !own(line))).toEqual(alone);
    expect(lines.filter(own).map((line) => [line.label, line.files])).toEqual([
      ['fansly-web: first dock chunk with Preact (lazy/site/dock + shared)', ['lazy/site/chunks/preact.js', 'lazy/site/dock.js']],
      // Its own copy of Preact came with its own dock: ChatSpace's is no file of its tab.
      ['fansly-web: lazy chunk notes (beyond the layers)', ['lazy/site/notes.js']],
    ]);
  });

  it('a lazy file of no measured build, or a build without its dock, fails instead of going unmeasured', () => {
    expect(() => computeBudgets(() => noise(10), both, [CHATSPACE], [SITE])).toThrow(/lazy files of no measured build: lazy\/site\/dock\.js \(fansly-web\)/);
    expect(() => computeBudgets(() => noise(10), chunks.filter((item) => item.name !== 'dock'), [CHATSPACE], [SITE])).toThrow(/lazy chunk list has no lazy\/chatspace\/dock\.js/);
  });

  it('a build without layers — Fansly’s until its application came (R20 P7d) — has its entries measured on demand, no dock line', () => {
    const bare: LazySite = { site: FANSLY.kind, build: { ...FANSLY.lazy, entries: { 'bridge-validation': 'fansly/bridge-validation.ts' }, layers: [], beforeTheDock: [] }, matches: [] };
    const schemas: LazyChunk = { file: 'lazy/fansly/bridge-validation.js', kind: 'entry', name: 'bridge-validation', imports: [], site: FANSLY.kind };
    const lines = computeBudgets(() => noise(10), [...chunks, schemas], [CHATSPACE], [SITE, bare]);
    expect(lines.filter((line) => line.label.startsWith('fansly-web: ')).map((line) => [line.label, line.files])).toEqual([['fansly-web: lazy chunk bridge-validation (beyond the layers)', ['lazy/fansly/bridge-validation.js']]]);
  });

  it('Fansly’s build carries the application (R20 P7d): cut by ChatSpace’s plan of layers, its first dock chunk has its own line', () => {
    expect([FANSLY.lazy.layers, FANSLY.lazy.beforeTheDock]).toEqual([CHATSPACE.lazy.layers, CHATSPACE.lazy.beforeTheDock]);
    const fansly: LazySite = { site: FANSLY.kind, build: { ...FANSLY.lazy, layers: ['dock'], beforeTheDock: [] }, matches: [] };
    const dock: LazyChunk = { file: 'lazy/fansly/dock.js', kind: 'entry', name: 'dock', imports: [], layer: 0, site: FANSLY.kind };
    const lines = computeBudgets(() => noise(10), [...chunks, dock], [CHATSPACE], [SITE, fansly]);
    expect(lines.filter((line) => line.label.startsWith('fansly-web: ')).map((line) => [line.label, line.limitBytes])).toEqual([['fansly-web: first dock chunk with Preact (lazy/fansly/dock + shared)', BUDGETS.firstDockChunk]]);
  });

  it('every script of the registry has its one line: Fansly’s MAIN ≤ 16 KiB and its early isolated start ≤ 30 KiB come after ChatSpace’s (R20 P7a0)', () => {
    expect(scriptBudgets(HOSTS).map((line) => [line.file, line.limitBytes])).toEqual([
      ...scriptBudgets([CHATSPACE]).map((line) => [line.file, line.limitBytes]),
      ['fansly-main.js', 16 * 1024],
      ['fansly.js', 30 * 1024],
      ['fansly-notice.js', 2 * 1024],
    ]);
  });

  it('the contract probes: the common one, then each site’s own, named by it; a second site adds its lines after ChatSpace’s', () => {
    expect(contractsProbes([CHATSPACE]).map((probe) => [probe.label, probe.limitBytes])).toEqual([
      ['contracts: limits only', 2 * 1024],
      ['chatspace: contracts: early isolated (bridge guard, envelopes, tab.register)', 12 * 1024],
      ['chatspace: contracts: UiAction schema', 16 * 1024],
      ['chatspace: contracts: tab request registry (parseTabPayload)', 30 * 1024],
    ]);
    const fansly: HostDescriptor = { ...CHATSPACE, kind: 'fansly-web', budgets: { ...CHATSPACE.budgets, contracts: [{ label: 'contracts: its bridge registry', entry: 'export {};', gzipBytes: 30 * 1024 }] } };
    expect(contractsProbes([CHATSPACE, fansly])).toEqual([...contractsProbes([CHATSPACE]), { label: 'fansly-web: contracts: its bridge registry', entry: 'export {};', limitBytes: 30 * 1024 }]);
  });
});
