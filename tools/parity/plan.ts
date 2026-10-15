// The single filesystem reader of R20 completion state, shared by all gates and coverage.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DONE_PATH, parsePlanPrs, PLAN_PATH, type PlanPrs } from './matrix.ts';

export function readPlanPrs(root: string): PlanPrs {
  const markdown = readFileSync(join(root, PLAN_PATH), 'utf8');
  let entries;
  try {
    entries = readdirSync(join(root, DONE_PATH), { withFileTypes: true });
  } catch (error) {
    // Older branches have only the inline marks; other filesystem errors must fail the gate.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return parsePlanPrs(markdown);
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile()) throw new Error(`${DONE_PATH}/${entry.name}: expected a regular done file`);
  }
  return parsePlanPrs(markdown, entries.map((entry) => entry.name).sort());
}
