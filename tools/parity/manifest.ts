// Parity manifest checks (architecture.md §3 «pnpm check» п. 8, §16 R01):
// docs/parity/parity-manifest.json has one row per checklist row plus the
// map's new rows, each with an owner work package and a planned check; a
// «не нужно» / «убрано владельцем» row points at its negative check in the
// exceptions registry. While the contracts are the R00 scaffold
// (CONTRACTS_VERSION '0.0.0-r00') a missing manifest only warns; past R00 it
// fails, and a manifest that exists is always checked in full.

import type { ParityException } from '../../packages/contracts/src/parity/exceptions.ts';
import { CHECK_KINDS, EXCEPTION_TARGETS, type ManifestRow } from './derive.ts';

export const CHECKLIST_ROW = /^\| ([A-Z0-9]+-\d{3}) \|/gm;
/** Checklist ids have three digits; the map's new rows (NEW-01, X8-01, REC-01) two. */
export const ROW_ID = /^[A-Z0-9]+-\d{2,3}$/;
const WORK_PACKAGE = /^R(0\d|1\d|20)$/;

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

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function rowProblems(row: Partial<ManifestRow> | null, where: string, exceptions: ReadonlyMap<string, ParityException>): string[] {
  const problems: string[] = [];
  if (!isText(row?.target)) problems.push(`${where}: target missing`);
  if (!Array.isArray(row?.packages) || !row.packages.every((item) => typeof item === 'string' && WORK_PACKAGE.test(item))) {
    problems.push(`${where}: packages must be work packages R00–R20`);
  }
  if (typeof row?.owner !== 'string' || !WORK_PACKAGE.test(row.owner)) problems.push(`${where}: owner must be a work package R00–R20`);
  const check = row?.check;
  if (typeof check !== 'object' || check === null || !(CHECK_KINDS as readonly unknown[]).includes(check.kind)) {
    problems.push(`${where}: check missing or of an unknown kind`);
    return problems;
  }
  if (check.kind === 'n/a' && !isText(check.reason)) problems.push(`${where}: an n/a check needs a reason`);
  const needsException = typeof row?.target === 'string' && EXCEPTION_TARGETS.includes(row.target);
  if (needsException && check.kind !== 'negative') problems.push(`${where}: a «${row.target}» row needs a negative check from the exceptions registry`);
  if (check.kind === 'negative') {
    const exception = isText(check.exception) ? exceptions.get(check.exception) : undefined;
    if (exception === undefined) problems.push(`${where}: negative check ${String(check.exception)} is not in the exceptions registry`);
    else {
      if (!exception.rows.includes(row?.id ?? '')) problems.push(`${where}: ${exception.id} does not list this row`);
      if (exception.verdict !== row?.target) problems.push(`${where}: ${exception.id} is «${exception.verdict}», the row is «${String(row?.target)}»`);
    }
  }
  return problems;
}

function exceptionProblems(exceptions: readonly ParityException[], targetOf: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const covered = new Map<string, string>();
  for (const exception of exceptions) {
    const where = `exception ${exception.id}`;
    if (!/^NEG-[A-Z0-9-]+$/.test(exception.id)) problems.push(`${where}: id must be NEG-<NAME>`);
    if (ids.has(exception.id)) problems.push(`${where}: duplicate id`);
    ids.add(exception.id);
    if (!isText(exception.reason) || !isText(exception.source) || !isText(exception.check.proves)) problems.push(`${where}: reason, source and check must be filled`);
    if (exception.rows.length === 0) problems.push(`${where}: covers no rows`);
    for (const id of exception.rows) {
      const owner = covered.get(id);
      if (owner !== undefined) problems.push(`${where}: ${id} is already covered by ${owner}`);
      covered.set(id, exception.id);
      const target = targetOf.get(id);
      if (target === undefined) problems.push(`${where}: ${id} is not a manifest row`);
      else if (target !== exception.verdict) problems.push(`${where}: ${id} is «${target}», not «${exception.verdict}»`);
    }
  }
  return problems;
}

/** Problems of a parsed manifest against the checklist ids and the exceptions registry; empty when it is sound. */
export function checkParityManifest(manifest: unknown, ids: readonly string[], exceptions: readonly ParityException[]): string[] {
  const rows = (manifest as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return ['parity manifest must be an object with a `rows` array'];
  const problems: string[] = [];
  const byException = new Map(exceptions.map((exception) => [exception.id, exception]));
  const targetOf = new Map<string, string>();
  for (const [index, raw] of rows.entries()) {
    const row = raw as Partial<ManifestRow> | null;
    const where = `row ${index}${typeof row?.id === 'string' ? ` (${row.id})` : ''}`;
    if (typeof row?.id !== 'string' || !ROW_ID.test(row.id)) problems.push(`${where}: id missing or malformed`);
    else if (targetOf.has(row.id)) problems.push(`${where}: duplicate id`);
    else targetOf.set(row.id, typeof row.target === 'string' ? row.target : '');
    problems.push(...rowProblems(row, where, byException));
  }
  for (const id of ids) if (!targetOf.has(id)) problems.push(`${id}: checklist row has no manifest row`);
  problems.push(...exceptionProblems(exceptions, targetOf));
  return problems;
}
