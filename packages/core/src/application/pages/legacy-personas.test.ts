import { describe, expect, it } from 'vitest';

import { legacyPersonaOf, readLegacyPersonas } from './legacy-personas';

const CREATOR = '700000000000000001';
const ALIAS = '700000000000000099';

/** The shape of fansly-chat's `buildLegacyPersonaExport` (src/shared/persona-preservation.ts). */
const exportOf = (mappings: Record<string, unknown>, aliases: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    exportedAt: '2026-10-21T10:00:00.000Z',
    origin: { client: 'chatgoose-firefox-extension', extensionVersion: '2.13.0' },
    preservedSnapshot: { personalities: [{ id: 'local-1', prompt: 'a long local persona text' }], accountMappings: { [CREATOR]: 'local-1' } },
    preservedSnapshotValid: true,
    currentLegacyData: { personalities: [], accountMappings: mappings, accountAliases: aliases },
  });

describe('the old Fansly extension persona export', () => {
  it('reads the current mappings, never the preserved local snapshot', () => {
    const legacy = readLegacyPersonas(exportOf({ [CREATOR]: 'lora-vip' }));
    expect(legacy).not.toBeNull();
    expect(legacyPersonaOf(legacy!, CREATOR)).toBe('lora-vip');
  });

  it('finds a mapping kept under an alias of the creator, and the creator of an alias', () => {
    const underAlias = readLegacyPersonas(exportOf({ [ALIAS]: 'mia' }, { [ALIAS]: CREATOR }))!;
    expect(legacyPersonaOf(underAlias, CREATOR)).toBe('mia');
    const underCreator = readLegacyPersonas(exportOf({ [CREATOR]: 'mia' }, { [ALIAS]: CREATOR }))!;
    expect(legacyPersonaOf(underCreator, ALIAS)).toBe('mia');
  });

  it('takes the old storage shape too (top-level accountMappings), with surrounding blanks', () => {
    const legacy = readLegacyPersonas(`\n  ${JSON.stringify({ accountMappings: { [CREATOR]: 'lora' }, accountAliases: {} })}  \n`);
    expect(legacy === null ? null : legacyPersonaOf(legacy, CREATOR)).toBe('lora');
  });

  it('is no export: not JSON, not an object, no mappings', () => {
    expect(readLegacyPersonas('lora-vip')).toBeNull();
    expect(readLegacyPersonas('[1,2]')).toBeNull();
    expect(readLegacyPersonas(JSON.stringify({ settings: {} }))).toBeNull();
  });

  it('drops what cannot be an account or a persona key, and answers null for an unmapped creator', () => {
    const legacy = readLegacyPersonas(exportOf({ [CREATOR]: 42, 'not an id': 'lora', [ALIAS]: 'x'.repeat(121) }))!;
    expect(legacy.mappings.size).toBe(0);
    expect(legacyPersonaOf(legacy, CREATOR)).toBeNull();
  });
});
