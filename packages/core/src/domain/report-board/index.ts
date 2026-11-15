// Workboard's screens in the extension's frame (hub package R, 2026-11-15; contracts report-board.ts): what the
// background lets a screen ask of Hub, the pulse's `report` read loosely, and the words of the bar over the site.
// Pure: no DOM, no browser API.

import { formatMills, formatTimeOfDay } from '@hub/look';
import { ReportPulseSchema, type ReportPulse, type ReportSale, type ReportFetchMethod, type WorkboardFrameScreen } from '@cg/contracts/report-board';

/**
 * One allowed family of operations: a path prefix (`/api/v1/shift-reports` — itself and everything under it), or an
 * exact pattern (`:name` a path parameter of digits only), and the methods it takes.
 */
export interface FrameOperation {
  readonly methods: readonly ReportFetchMethod[];
  /** The path itself and everything under `<prefix>/`. */
  readonly prefix?: string;
  /** Exactly this path. */
  readonly path?: string;
}

const ALL: readonly ReportFetchMethod[] = ['GET', 'PUT', 'POST', 'DELETE'];

/**
 * The allow-list of each frame screen (R-protocol, the allow-list section, version 2): by path PREFIX, so a new board
 * operation in Hub does not wait for an extension release — the real boundary is the device token's own profile on the
 * server, which lists every operation. One row a screen; a screen added to WORKBOARD_FRAME_SCREENS needs its row (the
 * compiler says so). Nothing else passes, whatever the frame asks.
 */
export const FRAME_ALLOW_LISTS: Readonly<Record<WorkboardFrameScreen, readonly FrameOperation[]>> = {
  report: [
    { methods: ALL, prefix: '/api/v1/shift-reports' },
    { methods: ALL, path: '/api/v1/sale-claims/:claimId/answer' },
    { methods: ['GET'], path: '/api/v1/auth/me' },
  ],
};

/** A query string of plain characters only (no `#`, no second `?`, no spaces or quotes). */
const QUERY = /^[A-Za-z0-9_.,~=&%:-]{0,400}$/;
/** A path segment of plain characters: no dot segments, nothing encoded (an encoded slash or dot would hide one). */
const SEGMENT = /^[A-Za-z0-9_-]{1,80}$/;
const DIGITS = /^[1-9][0-9]{0,18}$/;

/**
 * The path a frame asks, normalised before any check: only `/api/v1/…` of the sign-in's own hub — no scheme or host,
 * no `//`, no `.` or `..`, no encoded characters in the path, a query of plain characters. null — refused as it is.
 */
export function normalFramePath(target: string): { readonly path: string; readonly query: string } | null {
  const cut = target.indexOf('?');
  const path = cut < 0 ? target : target.slice(0, cut);
  const query = cut < 0 ? '' : target.slice(cut + 1);
  if (cut >= 0 && !QUERY.test(query)) return null;
  if (!path.startsWith('/api/v1/') || path.endsWith('/')) return null;
  const segments = path.slice(1).split('/');
  if (!segments.every((segment) => SEGMENT.test(segment))) return null;
  return { path, query };
}

/** Whether a frame's request may go to Hub: its normalised path under the screen's prefixes or one of its exact paths. Pure. */
export function frameRequestAllowed(screen: WorkboardFrameScreen, method: string, target: string): boolean {
  const table = FRAME_ALLOW_LISTS[screen] as readonly FrameOperation[] | undefined;
  const normal = normalFramePath(target);
  if (table === undefined || normal === null) return false;
  const parts = normal.path.split('/');
  return table.some((operation) => {
    if (!(operation.methods as readonly string[]).includes(method)) return false;
    if (operation.prefix !== undefined) return normal.path === operation.prefix || normal.path.startsWith(`${operation.prefix}/`);
    const pattern = (operation.path ?? '').split('/');
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
