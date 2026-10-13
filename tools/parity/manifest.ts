// Parity manifest checks (architecture.md §3 «pnpm check» п. 8, §16 R01;
// R20 P1b — docs/project-unite/plan.md §0 and parity-matrix.md §1):
// docs/parity/parity-manifest.json has one row per checklist row plus the
// map's new rows, each with a plan per host. ChatSpace: an owner work package
// and a planned check; a «не нужно» / «убрано владельцем» row points at its
// negative check in the exceptions registry. Fansly: the owner is one PR of
// the R20 plan (`R20/P7e`) and the check is the matrix's, or the row does not
// concern Fansly (`n/a` with a reason).
//
// The gate on Fansly (fanslyGateProblems): a row of a PR marked done in
// plan.md (`✓`) is closed on Fansly — by a test on its host and at its level,
// by the hub's confirmation (`хаб`) or by the exceptions registry
// (`отрицательная`); once the pilot PR is marked done, no Fansly row is open
// but those after the pilot. Rows of PRs not done yet are planned, not errors.
//
// While the contracts are the R00 scaffold (CONTRACTS_VERSION '0.0.0-r00') a
// missing manifest only warns; past R00 it fails, and a manifest that exists
// is always checked in full.

import type { ParityException } from '../../packages/contracts/src/parity/exceptions.ts';
import type { FanslyClosure } from './coverage-report.ts';
import { CHATSPACE_CHECKS, CHECK_KINDS, EXCEPTION_TARGETS, FANSLY_CHECKS, prOfOwner, type CheckKind, type HostPlan, type ManifestRow } from './derive.ts';
import type { HubConfirmation } from './matrix.ts';

export const CHECKLIST_ROW = /^\| ([A-Z0-9]+-\d{3}) \|/gm;
/** Checklist ids have three digits; the map's new rows (NEW-01, X8-01, REC-01) two. */
export const ROW_ID = /^[A-Z0-9]+-\d{2,3}$/;
const WORK_PACKAGE = /^R(0\d|1\d|20)$/;

/** The PR that starts the Fansly pilot (plan.md stage 16): to it no Fansly row may be open. */
export const PILOT_PR = 'P16c';

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

function negativeProblems(row: Partial<ManifestRow>, check: HostPlan['check'], where: string, exceptions: ReadonlyMap<string, ParityException>): string[] {
  const exception = isText(check.exception) ? exceptions.get(check.exception) : undefined;
  if (exception === undefined) return [`${where}: negative check ${String(check.exception)} is not in the exceptions registry`];
  const problems: string[] = [];
  if (!exception.rows.includes(row.id ?? '')) problems.push(`${where}: ${exception.id} does not list this row`);
  if (exception.verdict !== row.target) problems.push(`${where}: ${exception.id} is «${exception.verdict}», the row is «${String(row.target)}»`);
  return problems;
}

/** Problems common to the plan of either host; null when the check itself is unreadable. */
function checkOf(plan: unknown, kinds: readonly CheckKind[], where: string, problems: string[]): HostPlan['check'] | null {
  const check = (plan as Partial<HostPlan> | null | undefined)?.check;
  if (typeof check !== 'object' || check === null || !(CHECK_KINDS as readonly unknown[]).includes(check.kind) || !kinds.includes(check.kind)) {
    problems.push(`${where}: check missing or of an unknown kind`);
    return null;
  }
  if (check.kind === 'n/a' && !isText(check.reason)) problems.push(`${where}: an n/a check needs a reason`);
  return check;
}

function chatspaceProblems(row: Partial<ManifestRow>, where: string, exceptions: ReadonlyMap<string, ParityException>): string[] {
  const problems: string[] = [];
  const at = `${where} chatspace`;
  if (typeof row.chatspace?.owner !== 'string' || !WORK_PACKAGE.test(row.chatspace.owner)) problems.push(`${at}: owner must be a work package R00–R20`);
  const check = checkOf(row.chatspace, CHATSPACE_CHECKS, at, problems);
  if (check === null) return problems;
  const needsException = typeof row.target === 'string' && EXCEPTION_TARGETS.includes(row.target);
  if (needsException && check.kind !== 'negative') problems.push(`${at}: a «${String(row.target)}» row needs a negative check from the exceptions registry`);
  if (check.kind === 'negative') problems.push(...negativeProblems(row, check, at, exceptions));
  return problems;
}

function fanslyProblems(row: Partial<ManifestRow>, where: string, exceptions: ReadonlyMap<string, ParityException>, prs: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const at = `${where} fansly`;
  const check = checkOf(row.fansly, FANSLY_CHECKS, at, problems);
  if (check === null) return problems;
  const owner = row.fansly?.owner;
  if (check.kind === 'n/a') {
    if (owner !== undefined) problems.push(`${at}: a row Fansly does not concern has no owner`);
    return problems;
  }
  const pr = prOfOwner(owner);
  if (pr === null || !prs.has(pr)) problems.push(`${at}: owner must be a PR of the R20 plan (R20/<PR> of plan.md §2), not ${String(owner)}`);
  const removed = typeof row.target === 'string' && EXCEPTION_TARGETS.includes(row.target);
  if (removed && check.kind !== 'negative') problems.push(`${at}: a «${String(row.target)}» row needs its negative check on Fansly too, or a place in §9 of parity-matrix.md`);
  if (check.kind === 'negative') problems.push(...negativeProblems(row, check, at, exceptions));
  if (check.kind === 'hub' && check.where !== pr) problems.push(`${at}: the hub test is in ${String(check.where)}, the owner is ${String(owner)}`);
  return problems;
}

function rowProblems(row: Partial<ManifestRow> | null, where: string, exceptions: ReadonlyMap<string, ParityException>, prs: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  if (!isText(row?.target)) problems.push(`${where}: target missing`);
  if (!Array.isArray(row?.packages) || !row.packages.every((item) => typeof item === 'string' && WORK_PACKAGE.test(item))) {
    problems.push(`${where}: packages must be work packages R00–R20`);
  }
  const of = row ?? {};
  return [...problems, ...chatspaceProblems(of, where, exceptions), ...fanslyProblems(of, where, exceptions, prs)];
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

/**
 * Problems of a parsed manifest against the checklist ids, the exceptions
 * registry and the PRs of the R20 plan; empty when it is sound.
 */
export function checkParityManifest(manifest: unknown, ids: readonly string[], exceptions: readonly ParityException[], prs: readonly string[]): string[] {
  const rows = (manifest as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return ['parity manifest must be an object with a `rows` array'];
  const problems: string[] = [];
  const byException = new Map(exceptions.map((exception) => [exception.id, exception]));
  const planPrs = new Set(prs);
  const targetOf = new Map<string, string>();
  for (const [index, raw] of rows.entries()) {
    const row = raw as Partial<ManifestRow> | null;
    const where = `row ${String(index)}${typeof row?.id === 'string' ? ` (${row.id})` : ''}`;
    if (typeof row?.id !== 'string' || !ROW_ID.test(row.id)) problems.push(`${where}: id missing or malformed`);
    else if (targetOf.has(row.id)) problems.push(`${where}: duplicate id`);
    else targetOf.set(row.id, typeof row.target === 'string' ? row.target : '');
    problems.push(...rowProblems(row, where, byException, planPrs));
  }
  for (const id of ids) if (!targetOf.has(id)) problems.push(`${id}: checklist row has no manifest row`);
  problems.push(...exceptionProblems(exceptions, targetOf));
  return problems;
}

const HUB_COMMIT = /^[0-9a-f]{7,40}$/;
/** A path of a test file in the hub repository. */
const HUB_TEST_FILE = /`[^`]+\.(test|spec|e2e)\.tsx?`/;

/** Problems of the hub's confirmations (parity-matrix.md §10): each belongs to a `хаб` row and names its test and commit. */
export function hubConfirmationProblems(confirmations: readonly HubConfirmation[], rows: readonly ManifestRow[]): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const problems: string[] = [];
  for (const confirmation of confirmations) {
    const where = `parity-matrix.md §10 ${confirmation.id}`;
    const row = byId.get(confirmation.id);
    if (row === undefined) {
      problems.push(`${where}: no row of the manifest`);
      continue;
    }
    if (row.fansly.check.kind !== 'hub') problems.push(`${where}: the row's check on Fansly is «${row.fansly.check.kind}», not «hub»`);
    else if (prOfOwner(row.fansly.owner) !== confirmation.pr) problems.push(`${where}: confirmed by ${confirmation.pr}, the owner is ${String(row.fansly.owner)}`);
    if (!HUB_TEST_FILE.test(confirmation.test) || !confirmation.test.includes(`[${confirmation.id}]`)) {
      problems.push(`${where}: the test must name the hub's test file (\`….test.ts\`) and a title with [${confirmation.id}]`);
    }
    if (!HUB_COMMIT.test(confirmation.commit)) problems.push(`${where}: the commit must be 7–40 hex digits of the hub's main, not «${confirmation.commit}»`);
  }
  return problems;
}

/** What closes a Fansly check, for the gate's messages. */
const CLOSED_BY: Readonly<Record<CheckKind, string>> = {
  unit: 'a test on Fansly',
  e2e: 'a browser test on the Fansly stand',
  'stand-visual': 'a gallery snapshot with the Fansly profile',
  'manual-smoke': 'a smoke check',
  hub: "the hub's confirmation in parity-matrix.md §10",
  shared: 'a host-free test or a test on Fansly',
  negative: 'the exceptions registry',
  'after-pilot': 'nothing before the pilot',
  'n/a': 'nothing',
};

/**
 * The gate on Fansly: every row of a PR marked done is closed; at the pilot
 * no row is open but those after it. `done` — the PRs marked done in plan.md.
 */
export function fanslyGateProblems(rows: readonly ManifestRow[], closure: ReadonlyMap<string, FanslyClosure>, done: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const pilot = done.has(PILOT_PR);
  for (const row of rows) {
    const { owner, check } = row.fansly;
    const pr = prOfOwner(owner);
    if (pr === null || check.kind === 'n/a') continue;
    const ownerDone = done.has(pr);
    if (check.kind === 'after-pilot') {
      if (ownerDone) problems.push(`${row.id}: ${pr} is done (✓ in plan.md), but the row's check is still «после пилота» — name it in parity-matrix.md`);
      continue;
    }
    if (closure.get(row.id)?.closed === true) continue;
    const needs = `${CLOSED_BY[check.kind]}${check.where === undefined ? '' : ` (${check.where})`} with [${row.id}]`;
    if (ownerDone) problems.push(`${row.id}: ${pr} is done (✓ in plan.md), but the row is open on Fansly — needs ${needs}`);
    else if (pilot) problems.push(`${row.id}: open on Fansly at the pilot (${PILOT_PR} ✓) — ${pr} must close it: ${needs}`);
  }
  return problems;
}
