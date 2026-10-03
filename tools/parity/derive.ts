// Derives docs/parity/parity-manifest.json from the parity map and the
// exceptions registry. Every row gets an owner work package and a planned
// check; the rules below are the only place the check kind is decided, so the
// manifest is never hand-edited (generate.ts writes it, a test and `pnpm
// parity` fail on drift).

import type { ParityException } from '../../packages/contracts/src/parity/exceptions.ts';
import type { MapRow } from './map.ts';

export const MANIFEST_PATH = 'docs/parity/parity-manifest.json';

export const CHECK_KINDS = ['unit', 'e2e', 'stand-visual', 'manual-smoke', 'negative', 'n/a'] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export interface ManifestCheck {
  readonly kind: CheckKind;
  /** Why there is no check of our own (`n/a`). */
  readonly reason?: string;
  /** The negative check id from the exceptions registry (`negative`). */
  readonly exception?: string;
}

export interface ManifestRow {
  readonly id: string;
  readonly function: string;
  readonly target: string;
  readonly module: string;
  readonly packages: readonly string[];
  /** Owning work package R00–R20: the first package, or R02 (stand and independent checks) where the map has none. */
  readonly owner: string;
  readonly milestones: readonly string[];
  readonly mark: string | null;
  readonly check: ManifestCheck;
}

export interface ParityManifest {
  readonly generated: string;
  readonly rows: readonly ManifestRow[];
}

/** Outcomes that are proven by a negative check (parity-map.md: «Строки „не нужно“ и „убрано владельцем“ тоже проверяются»). */
export const EXCEPTION_TARGETS: readonly string[] = ['не нужно', 'убрано владельцем'];

/** The package that runs negative and independent checks (§16 R02). */
export const INDEPENDENT_CHECK_OWNER = 'R02';

/**
 * Planned check by the first module of a row (architecture.md §12): MAIN and
 * host behaviour is proven by e2e on the stand, surfaces by the visual check
 * on the rendered stand, logic in core/hub/platform/contracts by unit tests,
 * release steps by the owner's smoke. First match wins.
 */
export const MODULE_CHECKS: ReadonlyArray<readonly [RegExp, CheckKind]> = [
  [/^testing \(smoke\)/, 'manual-smoke'],
  [/^tools\/release(\s|$)/, 'manual-smoke'],
  [/^(host-chatspace|testing|ChatSpace)(\/|\s|$)/, 'e2e'],
  [/^apps\/extension \(вкладка\)/, 'e2e'],
  [/^ui\//, 'stand-visual'],
  [/^(core|hub|platform|contracts|vendor|apps\/extension)(\/|\s|$)/, 'unit'],
];

const NA_REASONS = {
  fansly: 'фаза Fansly (R20, этап F): проверку заводит адаптер fansly.com',
  chatspace: 'функцию даёт ChatSpace, своего кода нет',
  owner: 'ждёт решения владельца; до ответа действует поведение по умолчанию из пометки',
} as const;

function checkOf(row: MapRow, exceptionOf: ReadonlyMap<string, ParityException>): ManifestCheck {
  if (EXCEPTION_TARGETS.includes(row.target)) {
    const exception = exceptionOf.get(row.id);
    if (exception === undefined) throw new Error(`${row.id}: «${row.target}» row has no entry in packages/contracts/src/parity/exceptions.ts`);
    return { kind: 'negative', exception: exception.id };
  }
  if (row.target === 'Fansly') return { kind: 'n/a', reason: NA_REASONS.fansly };
  if (row.target === 'ждёт владельца') return { kind: 'n/a', reason: NA_REASONS.owner };
  const firstModule = row.module.split(' · ')[0] ?? '';
  if (row.target === 'даёт ChatSpace' && firstModule.startsWith('—')) return { kind: 'n/a', reason: NA_REASONS.chatspace };
  const rule = MODULE_CHECKS.find(([pattern]) => pattern.test(firstModule));
  if (rule === undefined) throw new Error(`${row.id}: no check rule for module «${firstModule}» (tools/parity/derive.ts MODULE_CHECKS)`);
  return { kind: rule[1] };
}

export function deriveManifest(rows: readonly MapRow[], exceptions: readonly ParityException[]): ParityManifest {
  const exceptionOf = new Map<string, ParityException>();
  for (const exception of exceptions) for (const id of exception.rows) exceptionOf.set(id, exception);
  return {
    generated: 'node tools/parity/generate.ts — руками не править; источник: docs/parity/parity-map.md и packages/contracts/src/parity/exceptions.ts',
    rows: rows.map((row) => {
      const check = checkOf(row, exceptionOf);
      return {
        id: row.id,
        function: row.function,
        target: row.target,
        module: row.module,
        packages: row.packages,
        owner: check.kind === 'negative' ? INDEPENDENT_CHECK_OWNER : (row.packages[0] ?? INDEPENDENT_CHECK_OWNER),
        milestones: row.milestones,
        mark: row.mark,
        check,
      };
    }),
  };
}

/** One row per line, so a diff shows exactly the rows that changed. */
export function serializeManifest(manifest: ParityManifest): string {
  const rows = manifest.rows.map((row) => `    ${JSON.stringify(row)}`).join(',\n');
  return `{\n  "generated": ${JSON.stringify(manifest.generated)},\n  "rows": [\n${rows}\n  ]\n}\n`;
}
