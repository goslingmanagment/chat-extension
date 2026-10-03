// Parity manifest checks (architecture.md §3 «pnpm check» п. 8). R01 adds
// docs/parity/parity-manifest.json: one machine row per checklist row, each
// with an owner work package and a check. Until then (contracts still at the
// R00 version) the gate warns and passes; afterwards a missing manifest fails.

export interface ParityRow {
  readonly id: string;
  /** Owning work package, R00–R20. */
  readonly owner: string;
  /** How the row is proven: a test file, an e2e scenario, a gate or a manual smoke item. */
  readonly check: string;
}

export const CHECKLIST_ROW = /^\| ([A-Z0-9]+-\d{3}) \|/gm;

/** CONTRACTS_VERSION of the R00 scaffold; R01 bumps it when it freezes the interfaces. */
export const R00_CONTRACTS_VERSION = '0.0.0-r00';

/**
 * Reads CONTRACTS_VERSION from packages/contracts/src/index.ts. Returns a
 * reason string when the parity manifest is required (contracts past R00 or
 * the version unreadable), null while R00's stub may still pass.
 */
export function manifestRequired(contractsIndex: string): string | null {
  const version = /export const CONTRACTS_VERSION = '([^']+)'/.exec(contractsIndex)?.[1];
  if (version === undefined) return 'CONTRACTS_VERSION not found in packages/contracts/src/index.ts';
  return version === R00_CONTRACTS_VERSION ? null : `CONTRACTS_VERSION ${version}`;
}

export function checklistIds(markdown: string): string[] {
  return [...markdown.matchAll(CHECKLIST_ROW)].map((match) => match[1] ?? '').filter(Boolean);
}

export function checkParityManifest(rows: unknown, ids: readonly string[]): string[] {
  if (!Array.isArray(rows)) return ['parity manifest must be a JSON array of rows'];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const value = row as Partial<ParityRow> | null;
    const where = `row ${index}${typeof value?.id === 'string' ? ` (${value.id})` : ''}`;
    if (typeof value?.id !== 'string' || !/^[A-Z0-9]+-\d{3}$/.test(value.id)) problems.push(`${where}: id missing or malformed`);
    else if (seen.has(value.id)) problems.push(`${where}: duplicate id`);
    else seen.add(value.id);
    if (typeof value?.owner !== 'string' || !/^R(0\d|1\d|20)$/.test(value.owner)) problems.push(`${where}: owner must be a work package R00–R20`);
    if (typeof value?.check !== 'string' || value.check.trim() === '') problems.push(`${where}: check missing`);
  }
  for (const id of ids) if (!seen.has(id)) problems.push(`${id}: checklist row has no manifest row`);
  return problems;
}
