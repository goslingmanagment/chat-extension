// How the pages' bundle is cut (build/page-chunks.ts): which module goes to
// which file, and that the build config is changed in the one place Vite 8
// reads. The built result is checked by test/manifest.test.ts.

import { describe, expect, it } from 'vitest';

import { PAGE_CHUNK_GROUPS, PAGE_ENTRY_NAMES, splitPageChunks, type PageBuildConfig } from '../build/page-chunks.ts';

const groupOf = (id: string): string | null => PAGE_CHUNK_GROUPS.find((group) => group.test(id))?.name ?? null;

describe('the chunks of the extension pages', () => {
  it('the catalogs go to the texts, contracts and zod to the contracts, the typefaces and drawings to the brand, everything else stays with the pages', () => {
    expect(groupOf('/repo/packages/core/src/domain/i18n/ru.ts')).toBe('page-texts');
    expect(groupOf('/repo/packages/core/src/domain/i18n/en.ts')).toBe('page-texts');
    expect(groupOf('C:\\repo\\packages\\core\\src\\domain\\i18n\\ru.ts')).toBe('page-texts');
    // The port and the plural rules are code, not texts.
    expect(groupOf('/repo/packages/core/src/domain/i18n/live.ts')).toBeNull();
    expect(groupOf('/repo/packages/contracts/src/tab-messages.ts')).toBe('page-contracts');
    expect(groupOf('/repo/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/mini/schemas.js')).toBe('page-contracts');
    expect(groupOf('/repo/node_modules/zod/v4/core/core.js')).toBe('page-contracts');
    expect(groupOf('/repo/packages/ui/src/pages/brand/fonts.ts')).toBe('page-brand');
    expect(groupOf('/repo/packages/ui/src/pages/brand/art.tsx')).toBe('page-brand');
    expect(groupOf('C:\\repo\\packages\\ui\\src\\pages\\brand\\fonts.ts')).toBe('page-brand');
    expect(groupOf('/repo/packages/ui/src/pages/Popup.tsx')).toBeNull();
    expect(groupOf('/repo/packages/core/src/application/pages/client.ts')).toBeNull();
    expect(groupOf('/repo/node_modules/.pnpm/preact@11.0.0/node_modules/preact/dist/preact.mjs')).toBeNull();
    // A group takes only its own modules: what they import stays where the bundler put it.
    expect(PAGE_CHUNK_GROUPS.every((group) => group.includeDependenciesRecursively === false)).toBe(true);
    expect(PAGE_ENTRY_NAMES).toEqual(['popup', 'options', 'debug-prompt', 'debug-journal']);
  });

  it('adds the groups to `build.rolldownOptions.output` in place and keeps what WXT set', () => {
    const entryFileNames = (): string => 'chunks/[name]-[hash].js';
    const output = { chunkFileNames: 'chunks/[name]-[hash].js', entryFileNames };
    const rolldownOptions = { input: { popup: 'popup/index.html' }, output };
    const config: PageBuildConfig = { build: { target: 'firefox142', rolldownOptions } };
    splitPageChunks(config);
    expect(config.build?.rolldownOptions).toBe(rolldownOptions);
    expect(rolldownOptions.output).toBe(output);
    expect(output).toMatchObject({ chunkFileNames: 'chunks/[name]-[hash].js', entryFileNames, codeSplitting: { groups: [...PAGE_CHUNK_GROUPS] } });
    expect(config.build?.['target']).toBe('firefox142');

    const empty: PageBuildConfig = {};
    splitPageChunks(empty);
    expect(empty.build?.rolldownOptions?.output).toEqual({ codeSplitting: { groups: [...PAGE_CHUNK_GROUPS] } });
    expect(() => splitPageChunks({ build: { rolldownOptions: { output: [{}] } } })).toThrow(/one output/);
  });
});
