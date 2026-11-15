import type { ChatterStats } from "./chatter-stats";
import type { AccountShiftReport } from "./routes-account-reports";
import type { ShiftReportsListResponse } from "./routes-shift-handins";
import type { OwnShiftRow } from "./routes-workboard-today";
type StatsShift = ChatterStats["shifts"][number];
type HubShiftReport = ShiftReportsListResponse["shifts"][number];
export interface OwnShiftsWindow {
    days: number;
    /** The shown Moscow days, both included. */
    from: string;
    to: string;
    /** `[startsAt, endsAt)`, ms. */
    startsAt: number;
    endsAt: number;
    /** The report dates to read: a report is dated by the Moscow day its shift BEGAN, so a night begun the evening before is in. */
    reportsFrom: string;
    reportsTo: string;
    previous: {
        startsAt: number;
        endsAt: number;
        reportsFrom: string;
        reportsTo: string;
    };
}
/**
 * The window of `days` Moscow days ending on `until` (default today), as `accountChatterStats` reads it
 * (chatter-stats.ts `statsWindow`): a later `until` keeps today inside and lists the days to come empty. Pure.
 */
export declare function ownShiftsWindow(input: {
    days: number;
    until?: string | undefined;
    now: number;
}): OwnShiftsWindow;
/**
 * The window before, cut at the same point while this one goes on — and at the start of the shift going on, if there
 * is one: its report comes only when it ends, so the same shift of the window before is left out too. Pure.
 */
export declare function comparisonOf(window: Pick<OwnShiftsWindow, "days" | "previous">, now: number, ongoingStartedAt: string | null): {
    startsAt: number;
    endsAt: number;
    sameTime: boolean;
};
/**
 * Whether a report belongs to `[startsAt, endsAt)`: the middle of its window is inside — as Hub puts a shift in a
 * window by the middle of its work. A report without a window (a post written by hand) or an unreadable one: its date.
 */
export declare function reportInWindow(report: AccountShiftReport, startsAt: number, endsAt: number): boolean;
/**
 * Hub's report row of a shift, when the person's switch is on and the shift began after it: the row of the same
 * shift that ran with it the longest. Null — the old way. Pure.
 */
export declare function hubReportOf(shift: Pick<StatsShift, "startedAt" | "endedAt">, hub: ShiftReportsListResponse | null): HubShiftReport | null;
/**
 * Which report is which shift's. The ledger dates a report by the day its shift BEGAN, while a night's own day is the
 * one holding most of it (`dayOfWork`), so the day alone puts a night's report on the night before. Hence:
 *
 * 1. a report goes to the shift its window ran at the same time with the longest (a tie: the shift with more worked
 *    time) — every pair once, the longest overlaps first;
 * 2. a report that overlaps no free shift (the agent's window is the schedule, the work was at another hour) or has
 *    no window at all (a post written without the agent): the ended shift of the report's date — the one that began
 *    on it, as the ledger dates a report, else the one whose day it is; of several the one with the most worked time;
 * 3. a report that still has no shift is a row of its own, when its window belongs to this one (`reportInWindow`) —
 *    reports of the neighbouring windows, read for their nights, are dropped.
 *
 * `reports` null: they did not come — every shift is a row, states `unknown` (a shift going on stays `ongoing`).
 * `postsRead` false: the drafts came, the posts did not — a shift without a draft may still have a post, so it is
 * `unknown`, never `missing`. Hub's own report (the switch on) is the shift's report: handed in, its total; not yet,
 * the draft's total «предварительно». Newest first, a shift going on first. Pure.
 */
export declare function pairShiftsWithReports(input: {
    shifts: readonly StatsShift[];
    reports: readonly AccountShiftReport[] | null;
    postsRead?: boolean;
    window: Pick<OwnShiftsWindow, "startsAt" | "endsAt">;
    hub?: ShiftReportsListResponse | null;
}): OwnShiftRow[];
/**
 * The sum of the report totals of the window before, to compare with; null — nothing to compare with: the reports did
 * not come, or none of that window is in the ledger (the reports began later: unknown, never a zero). Pure.
 */
export declare function previousReportedMills(reports: readonly AccountShiftReport[] | null, previous: {
    startsAt: number;
    endsAt: number;
}): number | null;
export {};
