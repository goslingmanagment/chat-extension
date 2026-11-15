// Workboard's screens in the extension's frame (hub package R, 2026-11-15; contracts report-board.ts): what the
// background lets a screen ask of Hub, the pulse's `report` read loosely, and the words of the bar over the site.
// Pure: no DOM, no browser API.

import { formatMills, formatTimeOfDay } from '@hub/look';
import { ReportPulseSchema, type ReportPulse, type ReportSale, type ReportFetchMethod, type WorkboardFrameScreen } from '@cg/contracts/report-board';

/** One allowed operation: a method and a path pattern; `:name` is a path parameter of digits only. */
export interface FrameOperation {
  readonly method: ReportFetchMethod;
  readonly path: string;
}

/**
 * The allow-list of each frame screen (R-protocol «The background's allow-list»): nothing else passes, whatever the
 * frame asks. A screen added to WORKBOARD_FRAME_SCREENS needs its table here (the compiler says so). When Hub renames or
 * adds an operation of the board, R-protocol.md is updated in the same change and this table follows it.
 */
export const FRAME_ALLOW_LISTS: Readonly<Record<WorkboardFrameScreen, readonly FrameOperation[]>> = {
  report: [
    { method: 'GET', path: '/api/v1/shift-reports' },
    { method: 'GET', path: '/api/v1/shift-reports/current' },
    { method: 'GET', path: '/api/v1/shift-reports/:shiftId' },
    { method: 'GET', path: '/api/v1/shift-reports/:shiftId/claimable' },
    { method: 'PUT', path: '/api/v1/shift-reports/:shiftId/lines/:transactionId' },
    { method: 'PUT', path: '/api/v1/shift-reports/:shiftId/comment' },
    { method: 'POST', path: '/api/v1/shift-reports/:shiftId/off-platform' },
    { method: 'DELETE', path: '/api/v1/shift-reports/:shiftId/off-platform/:offPlatformId' },
    { method: 'POST', path: '/api/v1/shift-reports/:shiftId/submit' },
    { method: 'POST', path: '/api/v1/shift-reports/:shiftId/confirm' },
    { method: 'POST', path: '/api/v1/shift-reports/:shiftId/reopen' },
    { method: 'POST', path: '/api/v1/shift-reports/:shiftId/reopen/cancel' },
    { method: 'POST', path: '/api/v1/shift-reports/:shiftId/resend' },
    { method: 'POST', path: '/api/v1/shift-reports/:shiftId/asks' },
    { method: 'DELETE', path: '/api/v1/shift-reports/:shiftId/asks/:transactionId' },
    { method: 'POST', path: '/api/v1/shift-reports/:shiftId/proposals/:proposalId/answer' },
    { method: 'POST', path: '/api/v1/shift-reports/:shiftId/sightings/:sightingId/add' },
    { method: 'POST', path: '/api/v1/sale-claims/:claimId/answer' },
    { method: 'GET', path: '/api/v1/auth/me' },
  ],
};

/** A query string of plain characters only (no `#`, no second `?`, no spaces or quotes). */
const QUERY = /^[A-Za-z0-9_.,~=&%:-]{0,400}$/;
const DIGITS = /^[1-9][0-9]{0,18}$/;

/**
 * Whether a frame's request may go to Hub: its method and path are an operation of the screen's table, path
 * parameters digits only, an optional query of plain characters. Never another origin, never `..`. Pure.
 */
export function frameRequestAllowed(screen: WorkboardFrameScreen, method: string, target: string): boolean {
  const table = FRAME_ALLOW_LISTS[screen] as readonly FrameOperation[] | undefined;
  if (table === undefined || !target.startsWith('/api/v1/')) return false;
  const cut = target.indexOf('?');
  const path = cut < 0 ? target : target.slice(0, cut);
  if (cut >= 0 && !QUERY.test(target.slice(cut + 1))) return false;
  const parts = path.split('/');
  return table.some((operation) => {
    if (operation.method !== method) return false;
    const pattern = operation.path.split('/');
    if (pattern.length !== parts.length) return false;
    return pattern.every((piece, index) => {
      const part = parts[index] ?? '';
      return piece.startsWith(':') ? DIGITS.test(part) : piece === part;
    });
  });
}

/** The pulse's `report` read loosely: absent, null or of a wrong shape is null (the fifth row is not drawn). Pure. */
export function reportPulseOf(value: unknown): ReportPulse | null {
  if (value === undefined || value === null) return null;
  const parsed = ReportPulseSchema.safeParse(value);
  return parsed.success ? { shiftId: parsed.data.shiftId, phase: parsed.data.phase, needsMe: parsed.data.needsMe } : null;
}

/**
 * How a site's own list shows a sale (R-board §3): its words of each sale kind (Fansly's wallet «Media Sale to», OnlyFans'
 * statement «Payment for message from»…) and whether it prints the transaction's number (Fansly's `#…5305`; OnlyFans'
 * statement shows the time instead). The site's adapter gives it (host-fansly wallet-finder.ts, host-chatspace
 * transactions-finder.ts): shared code names no site.
 */
export interface SaleLook {
  readonly words: Readonly<Record<string, string>>;
  readonly number: boolean;
}

/** The site's words and the fan: «Media Sale to Viggo». Pure. */
export function saleWords(sale: ReportSale, look: SaleLook | null): string {
  const words = look?.words[sale.kind] ?? '';
  const fan = sale.fanName ?? sale.fanHandle ?? '';
  return [words, fan].filter((part) => part !== '').join(' ');
}

/** What the sale is found by on the site: «#…5305» where the list prints numbers, else the time. Pure. */
export function saleMark(sale: ReportSale, look: SaleLook | null): string {
  if (look?.number === true && sale.platformRef !== null) return `#…${sale.platformRef.slice(-4)}`;
  return timeOf(sale.occurredAt);
}

const timeOf = (iso: string): string => {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? formatTimeOfDay(at) : '';
};

/** The bar's compare line: «Сверка: Mia-2, Media Sale to Viggo, #…5305». Pure. */
export function compareWords(sale: ReportSale, look: SaleLook | null): { readonly page: string; readonly rest: string } {
  return { page: sale.pageLabel, rest: [saleWords(sale, look), saleMark(sale, look)].filter((part) => part !== '').join(', ') };
}

/** The bar when the row is not on the site: «Строка на сайте не найдена: 22:30, $48, Viggo». Never a similar row. Pure. */
export function notFoundWords(sale: ReportSale): string {
  const fan = sale.fanName ?? sale.fanHandle ?? '';
  const parts = [timeOf(sale.occurredAt), formatMills(sale.netMills), fan].filter((part) => part !== '');
  return `Строка на сайте не найдена: ${parts.join(', ')}`;
}

/** The bar when the sale's page has no tab here: «Откройте вкладку Mia-2, строка найдётся сама». Pure. */
export function openTabWords(pageLabel: string): string {
  return `Откройте вкладку ${pageLabel}, строка найдётся сама`;
}

/** The bar's count: «Ваши продажи: 17, $477.40». Pure. */
export function salesWords(count: number, totalMills: number): { readonly label: string; readonly total: string } {
  return { label: `Ваши продажи: ${String(count)},`, total: formatMills(totalMills) };
}
