/** CI's parallel Firefox jobs check a regression bound; local e2e keeps the strict budget. */
export function budgetMs(ms: number): number {
  const slack = Number(process.env['CG_E2E_TIMING_SLACK'] ?? '1');
  if (!Number.isFinite(slack) || slack < 1) {
    throw new Error('CG_E2E_TIMING_SLACK must be a finite number >= 1');
  }
  return ms * slack;
}
