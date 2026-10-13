// Derives docs/parity/parity-manifest.json from the parity map, the R20
// parity matrix and the exceptions registry. Every row gets a plan per host —
// an owner and a planned check on ChatSpace and on Fansly; the rules below are
// the only place the check kind is decided, so the manifest is never
// hand-edited (generate.ts writes it, a test and `pnpm parity` fail on drift).
//
// ChatSpace: the owner is the row's work package R00–R20, the check comes
// from the row's module (MODULE_CHECKS). Fansly: the owner is the row's one PR
// of the R20 plan (`R20/P7e`) and the check is the matrix's «Проверка»
// (MATRIX_CHECKS); a row of the matrix's §9 does not concern Fansly (`n/a`
// with its reason).

import type { ParityException } from '../../packages/contracts/src/parity/exceptions.ts';
import type { MapRow } from './map.ts';
import type { MatrixRow, ParityMatrix } from './matrix.ts';

export const MANIFEST_PATH = 'docs/parity/parity-manifest.json';

/**
 * Check kinds. ChatSpace: `unit`, `e2e`, `stand-visual`, `manual-smoke`,
 * `negative`, `n/a`. Fansly (parity-matrix.md §1): `e2e` and `stand-visual`
 * (браузер), `unit` (юнит), `hub` (хаб — a hub test, confirmed externally),
 * `shared` (общий — a host-free test), `negative` (отрицательная),
 * `after-pilot` (после пилота), `n/a` (§9: the row does not concern Fansly).
 */
export const CHECK_KINDS = ['unit', 'e2e', 'stand-visual', 'manual-smoke', 'hub', 'shared', 'negative', 'after-pilot', 'n/a'] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export const CHATSPACE_CHECKS: readonly CheckKind[] = ['unit', 'e2e', 'stand-visual', 'manual-smoke', 'negative', 'n/a'];
export const FANSLY_CHECKS: readonly CheckKind[] = ['unit', 'e2e', 'stand-visual', 'hub', 'shared', 'negative', 'after-pilot', 'n/a'];

export interface ManifestCheck {
  readonly kind: CheckKind;
  /** Why there is no check on this host (`n/a`). */
  readonly reason?: string;
  /** The negative check id from the exceptions registry (`negative`). */
  readonly exception?: string;
  /** Where the matrix plans the check: the spec, the package, `метка fansly`, `гейт`, the hub PR. */
  readonly where?: string;
}

export interface HostPlan {
  /** ChatSpace: a work package R00–R20. Fansly: a PR of the R20 plan, `R20/<PR>`; none for a row Fansly does not concern. */
  readonly owner?: string;
  readonly check: ManifestCheck;
}

export interface ManifestRow {
  readonly id: string;
  readonly function: string;
  readonly target: string;
  readonly module: string;
  readonly packages: readonly string[];
  readonly milestones: readonly string[];
  readonly mark: string | null;
  readonly chatspace: HostPlan;
  readonly fansly: HostPlan;
}

export interface ParityManifest {
  readonly generated: string;
  readonly rows: readonly ManifestRow[];
}

/** Outcomes that are proven by a negative check (parity-map.md: «Строки „не нужно“ и „убрано владельцем“ тоже проверяются»). */
export const EXCEPTION_TARGETS: readonly string[] = ['не нужно', 'убрано владельцем'];

/** The package that runs negative and independent checks (§16 R02). */
export const INDEPENDENT_CHECK_OWNER = 'R02';

/** The owner of a row on Fansly: its PR of the R20 plan. */
export const fanslyOwner = (pr: string): string => `R20/${pr}`;
/** The PR of a Fansly owner `R20/<PR>`, or null. */
export const prOfOwner = (owner: string | undefined): string | null => (owner === undefined ? null : (/^R20\/(.+)$/.exec(owner)?.[1] ?? null));

/**
 * Planned ChatSpace check by the first module of a row (architecture.md §12):
 * MAIN and host behaviour is proven by e2e on the stand, surfaces by the
 * visual check on the rendered stand, logic in core/hub/platform/contracts by
 * unit tests, release steps by the owner's smoke. First match wins.
 */
export const MODULE_CHECKS: ReadonlyArray<readonly [RegExp, CheckKind]> = [
  [/^testing \(smoke\)/, 'manual-smoke'],
  [/^tools\/release(\s|$)/, 'manual-smoke'],
  [/^(host-chatspace|testing|ChatSpace)(\/|\s|$)/, 'e2e'],
  [/^apps\/extension \(вкладка\)/, 'e2e'],
  [/^ui\//, 'stand-visual'],
  [/^(core|hub|platform|contracts|vendor|apps\/extension)(\/|\s|$)/, 'unit'],
];

/** The matrix's «Проверка» cell → the Fansly check (parity-matrix.md §1). First match wins. */
export const MATRIX_CHECKS: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => ManifestCheck]> = [
  [/^браузер · галерея `host=fansly`$/, () => ({ kind: 'stand-visual', where: 'галерея host=fansly' })],
  [/^браузер · `([^`]+)`$/, (match) => ({ kind: 'e2e', where: match[1] ?? '' })],
  [/^юнит · `([^`]+)`$/, (match) => ({ kind: 'unit', where: match[1] ?? '' })],
  [/^юнит · (метка fansly|гейт)$/, (match) => ({ kind: 'unit', where: match[1] ?? '' })],
  [/^хаб · эталон в (HF-\S+)$/, (match) => ({ kind: 'hub', where: match[1] ?? '' })],
  [/^общий$/, () => ({ kind: 'shared' })],
  [/^отрицательная · (NEG-[A-Z0-9-]+)$/, (match) => ({ kind: 'negative', exception: match[1] ?? '' })],
  [/^после пилота$/, () => ({ kind: 'after-pilot' })],
];

const NA_REASONS = {
  fanslyOnly: 'строка только Fansly: на ChatSpace её нет, проверка — в части fansly',
  chatspace: 'функцию даёт ChatSpace, своего кода нет',
  owner: 'ждёт решения владельца; до ответа действует поведение по умолчанию из пометки',
} as const;

function chatspaceCheckOf(row: MapRow, exceptionOf: ReadonlyMap<string, ParityException>): ManifestCheck {
  if (EXCEPTION_TARGETS.includes(row.target)) {
    const exception = exceptionOf.get(row.id);
    if (exception === undefined) throw new Error(`${row.id}: «${row.target}» row has no entry in packages/contracts/src/parity/exceptions.ts`);
    return { kind: 'negative', exception: exception.id };
  }
  if (row.target === 'Fansly') return { kind: 'n/a', reason: NA_REASONS.fanslyOnly };
  if (row.target === 'ждёт владельца') return { kind: 'n/a', reason: NA_REASONS.owner };
  const firstModule = row.module.split(' · ')[0] ?? '';
  if (row.target === 'даёт ChatSpace' && firstModule.startsWith('—')) return { kind: 'n/a', reason: NA_REASONS.chatspace };
  const rule = MODULE_CHECKS.find(([pattern]) => pattern.test(firstModule));
  if (rule === undefined) throw new Error(`${row.id}: no check rule for module «${firstModule}» (tools/parity/derive.ts MODULE_CHECKS)`);
  return { kind: rule[1] };
}

export function fanslyCheckOf(row: Pick<MatrixRow, 'id' | 'check'>): ManifestCheck {
  for (const [pattern, make] of MATRIX_CHECKS) {
    const match = pattern.exec(row.check);
    if (match !== null) return make(match);
  }
  throw new Error(`${row.id}: unknown check «${row.check}» in parity-matrix.md (tools/parity/derive.ts MATRIX_CHECKS)`);
}

/** The Fansly plan of every row: the matrix row, or the reason of §9; a row in neither, in both or twice stops the derivation. */
function fanslyPlans(rows: readonly MapRow[], matrix: ParityMatrix): Map<string, HostPlan> {
  const plans = new Map<string, HostPlan>();
  const add = (id: string, plan: HostPlan): void => {
    if (plans.has(id)) throw new Error(`${id}: two rows in parity-matrix.md (§7 and §9 together hold each row once)`);
    plans.set(id, plan);
  };
  for (const row of matrix.rows) add(row.id, { owner: fanslyOwner(row.pr), check: fanslyCheckOf(row) });
  for (const row of matrix.notFansly) add(row.id, { check: { kind: 'n/a', reason: row.reason } });
  const known = new Set(rows.map((row) => row.id));
  for (const id of plans.keys()) if (!known.has(id)) throw new Error(`${id}: in parity-matrix.md, but no row of the parity map`);
  for (const row of rows) if (!plans.has(row.id)) throw new Error(`${row.id}: neither in §7 nor in §9 of parity-matrix.md`);
  return plans;
}

export function deriveManifest(rows: readonly MapRow[], exceptions: readonly ParityException[], matrix: ParityMatrix): ParityManifest {
  const exceptionOf = new Map<string, ParityException>();
  for (const exception of exceptions) for (const id of exception.rows) exceptionOf.set(id, exception);
  const fansly = fanslyPlans(rows, matrix);
  return {
    generated:
      'node tools/parity/generate.ts — руками не править; источник: docs/parity/parity-map.md, docs/project-unite/parity-matrix.md и packages/contracts/src/parity/exceptions.ts',
    rows: rows.map((row) => {
      const check = chatspaceCheckOf(row, exceptionOf);
      return {
        id: row.id,
        function: row.function,
        target: row.target,
        module: row.module,
        packages: row.packages,
        milestones: row.milestones,
        mark: row.mark,
        chatspace: { owner: check.kind === 'negative' ? INDEPENDENT_CHECK_OWNER : (row.packages[0] ?? INDEPENDENT_CHECK_OWNER), check },
        fansly: fansly.get(row.id) as HostPlan,
      };
    }),
  };
}

/** One row per line, so a diff shows exactly the rows that changed. */
export function serializeManifest(manifest: ParityManifest): string {
  const rows = manifest.rows.map((row) => `    ${JSON.stringify(row)}`).join(',\n');
  return `{\n  "generated": ${JSON.stringify(manifest.generated)},\n  "rows": [\n${rows}\n  ]\n}\n`;
}
