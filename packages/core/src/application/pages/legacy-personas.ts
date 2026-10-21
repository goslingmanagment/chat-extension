// The personas of the old Fansly extension (fansly-chat 2.x), carried over by the person (2026-10-21 audit, №9). Pure.
//
// Two extensions never read each other's storage, so the person brings it: the old one's Settings → «Персоны» →
// «Архив локальной персоны» → «Копировать» (or «Скачать JSON») gives `buildLegacyPersonaExport`
// (fansly-chat src/shared/persona-preservation.ts): `currentLegacyData.accountMappings` — each Fansly account
// (the creator's id, or an alias of it) → the key of the hub persona it was mapped to — and `accountAliases`
// (alias → the creator's id). Nothing else of the old settings is in it, and nothing else is read: the old local
// persona texts it also carries never leave this function.

/** The old extension's mapping: Fansly account → persona key, and alias → the creator's id. */
export interface LegacyPersonas {
  readonly mappings: ReadonlyMap<string, string>;
  readonly aliases: ReadonlyMap<string, string>;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A Fansly account id (or its alias): a short token. */
const ACCOUNT = /^[\w.:-]{1,64}$/;
/** A persona key or a creator's id as a value: matched exactly against the hub's, never shown. */
const usable = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 120;

function strings(value: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!record(value)) return out;
  for (const [key, entry] of Object.entries(value)) if (ACCOUNT.test(key) && usable(entry)) out.set(key, entry);
  return out;
}

/**
 * The old extension's export as text (the JSON it copies or downloads); null — not such an export. The mappings are
 * read from `currentLegacyData` (the export) or, as the old storage holds them, from the top level.
 */
export function readLegacyPersonas(text: string): LegacyPersonas | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (!record(parsed)) return null;
  const data = record(parsed['currentLegacyData']) ? parsed['currentLegacyData'] : parsed;
  if (!('accountMappings' in data)) return null;
  return { mappings: strings(data['accountMappings']), aliases: strings(data['accountAliases']) };
}

/**
 * The persona key the old extension used for a Fansly creator: mapped by the creator's id, by the id it is an alias
 * of, or by any alias of it — as the old one looked an account up (`buildAccountLookupOrder`). null — none.
 */
export function legacyPersonaOf(legacy: LegacyPersonas, creatorId: string): string | null {
  const canonical = legacy.aliases.get(creatorId) ?? creatorId;
  const keys = [creatorId, canonical, ...[...legacy.aliases].filter(([, target]) => target === creatorId || target === canonical).map(([alias]) => alias)];
  for (const key of keys) {
    const persona = legacy.mappings.get(key);
    if (persona !== undefined) return persona;
  }
  return null;
}
