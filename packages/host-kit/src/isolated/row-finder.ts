// «Show on the site» (hub package R, 2026-11-15; R-board §6): what both sites' finders of a sale's row share. A row is
// framed only when it is THE row: by the platform's own transaction number where the site prints it, else by time,
// amount and fan together, and only when exactly one row matches. A similar row is never framed: not found is said.

/** A sale as the finders read it (contracts report-board.ts `ReportSale`, its parts the sites print). */
export interface SaleToFind {
  readonly platformRef: string | null;
  /** ISO time of the sale. */
  readonly occurredAt: string;
  readonly netMills: number;
  readonly grossMills: number | null;
  readonly fanName: string | null;
  readonly fanHandle: string | null;
}

/** Waits for `test` to give a value (not null), looking every `everyMs`; null after `timeoutMs`. */
export async function waitFor<T>(win: Window, test: () => T | null, timeoutMs: number, everyMs = 150): Promise<T | null> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = test();
    if (value !== null) return value;
    if (Date.now() >= until) return null;
    await new Promise<void>((resolve) => win.setTimeout(resolve, everyMs));
  }
}

/** The money a row prints, in mills: «+$48», «$18.00», «48.5» → 48000, 18000, 48500; null — none. */
export function millsOf(text: string): number | null {
  const match = /(\d[\d,]*(?:\.\d{1,2})?)/.exec(text.replace(/\s+/g, ''));
  if (match === null) return null;
  const value = Number((match[1] ?? '').replace(/,/g, ''));
  return Number.isFinite(value) ? Math.round(value * 1000) : null;
}

/** The sale's minute in this browser's own zone, as the sites print their rows: «22:30». */
export function localMinute(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** Whether a fan's name or handle is in the row's text (case-insensitive, `@` optional). */
export function fanIn(text: string, sale: Pick<SaleToFind, 'fanName' | 'fanHandle'>): boolean {
  const hay = text.toLowerCase();
  const name = sale.fanName?.trim().toLowerCase() ?? '';
  const handle = sale.fanHandle?.trim().replace(/^@/, '').toLowerCase() ?? '';
  if (name === '' && handle === '') return false;
  return (name !== '' && hay.includes(name)) || (handle !== '' && hay.includes(handle));
}

/** The one element of `rows` that `test` takes; null — none, or more than one (never a guess). */
export function onlyOne<T>(rows: readonly T[], test: (row: T) => boolean): T | null {
  let found: T | null = null;
  for (const row of rows) {
    if (!test(row)) continue;
    if (found !== null) return null;
    found = row;
  }
  return found;
}
