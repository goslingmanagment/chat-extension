// The stand's OnlyFans transactions of an account (hub package R, 2026-11-15): invented rows at fixed moments, shown by
// the stand's transactions window (ui/transactions.ts) and named by the fake hub's board stub (fake-hub/report-board.ts).

export interface StandTransaction {
  readonly id: string;
  readonly at: number;
  readonly grossMills: number;
  readonly netMills: number;
  readonly description: string;
}

const NEWEST = Date.UTC(2026, 10, 12, 22, 12);
const ROWS: readonly (readonly [string, number])[] = [
  ['Payment for message from Mason', 18000],
  ['Tip from Lucas', 25000],
  ['Subscription from Theo', 9990],
  ['Payment for message from Noah', 40000],
  ['Tip from Mason', 10000],
  ['Payment for message from Ezra', 15000],
  ['Tip from Theo', 5000],
  ['Payment for message from Lucas', 30000],
];

/** 24 rows, newest first. */
export const STAND_TRANSACTIONS: readonly StandTransaction[] = Array.from({ length: 24 }, (_, index) => {
  const [description, grossMills] = ROWS[index % ROWS.length] ?? ['Tip from Mason', 10000];
  return { id: String(6_100_000_000 - index * 977), at: NEWEST - index * 17 * 60_000, grossMills, netMills: Math.round(grossMills * 0.8), description };
});
