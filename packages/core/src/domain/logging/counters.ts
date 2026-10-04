// Error counters by CG code for the day (LG-010): «ошибки хаба за сегодня» in
// «Аккаунт», the counters of «Диагностика» and of the export. The day is the
// browser's local calendar day; a new day starts the count from zero, the
// previous day stays readable until the next change. The background may
// persist a snapshot (storage.session) to survive an event-page restart.

import { CG_CODES, isCgCode, type CgCode, type CgKind } from '@cg/contracts/errors';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';

/** `YYYY-MM-DD` of the local calendar day of `ms`. */
export function localDayKey(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface CodeCountersSnapshot {
  readonly day: string;
  readonly today: Readonly<Partial<Record<CgCode, number>>>;
  readonly previousDay: string | null;
  readonly previous: Readonly<Partial<Record<CgCode, number>>>;
  readonly session: Readonly<Partial<Record<CgCode, number>>>;
}

export interface CodeCount {
  readonly code: CgCode;
  readonly count: number;
}

const MAX_COUNT = 1_000_000_000;

function sorted(record: Readonly<Partial<Record<CgCode, number>>>): CodeCount[] {
  return CG_CODES.flatMap((code) => {
    const count = record[code];
    return count === undefined || count <= 0 ? [] : [{ code, count }];
  }).sort((a, b) => b.count - a.count);
}

export class CodeCounters {
  private day: string;
  private today = new Map<CgCode, number>();
  private previousDay: string | null = null;
  private previous = new Map<CgCode, number>();
  private readonly session = new Map<CgCode, number>();

  constructor(now: number) {
    this.day = localDayKey(now);
  }

  /** Moves to a later day only: a late record from before midnight never rolls the count back. */
  private roll(now: number): void {
    const day = localDayKey(now);
    // `YYYY-MM-DD` keys compare as dates.
    if (day <= this.day) return;
    this.previousDay = this.day;
    this.previous = this.today;
    this.today = new Map();
    this.day = day;
  }

  /**
   * Counts one occurrence at `now` (a tab record brings its own time); an
   * unknown code is ignored (never throws). A late record of the previous day
   * counts there; an older one only since the start.
   */
  count(code: unknown, now: number, by = 1): void {
    if (!isCgCode(code) || !Number.isFinite(by) || by <= 0) return;
    this.roll(now);
    const day = localDayKey(now);
    const step = Math.floor(by);
    const bucket = day === this.day ? this.today : day === this.previousDay ? this.previous : null;
    if (bucket !== null) bucket.set(code, Math.min(MAX_COUNT, (bucket.get(code) ?? 0) + step));
    this.session.set(code, Math.min(MAX_COUNT, (this.session.get(code) ?? 0) + step));
  }

  /** Today's counts, largest first. */
  todayCounts(now: number): CodeCount[] {
    this.roll(now);
    return sorted(Object.fromEntries(this.today));
  }

  /** Today's counts of one kind (`hub` for «ошибки хаба за сегодня»). */
  todayOfKind(now: number, kind: CgKind): CodeCount[] {
    return this.todayCounts(now).filter(({ code }) => CG_REGISTRY[code].kind === kind);
  }

  /** Since this background started. */
  sessionCounts(): CodeCount[] {
    return sorted(Object.fromEntries(this.session));
  }

  snapshot(now: number): CodeCountersSnapshot {
    this.roll(now);
    return {
      day: this.day,
      today: Object.fromEntries(this.today),
      previousDay: this.previousDay,
      previous: Object.fromEntries(this.previous),
      session: Object.fromEntries(this.session),
    };
  }

  /** Restores today's and the previous day's counts (not the session's): unknown codes and bad numbers are skipped. */
  restore(snapshot: unknown, now: number): void {
    if (snapshot === null || typeof snapshot !== 'object') return;
    const read = (value: unknown): Map<CgCode, number> => {
      const out = new Map<CgCode, number>();
      if (value === null || typeof value !== 'object') return out;
      for (const [code, count] of Object.entries(value)) {
        if (isCgCode(code) && typeof count === 'number' && Number.isInteger(count) && count > 0) out.set(code, Math.min(MAX_COUNT, count));
      }
      return out;
    };
    const record = snapshot as Partial<Record<keyof CodeCountersSnapshot, unknown>>;
    const today = localDayKey(now);
    if (record.day === today) {
      for (const [code, count] of read(record.today)) this.today.set(code, Math.max(count, this.today.get(code) ?? 0));
      if (typeof record.previousDay === 'string') {
        this.previousDay = record.previousDay;
        this.previous = read(record.previous);
      }
    } else if (typeof record.day === 'string') {
      this.previousDay = record.day;
      this.previous = read(record.today);
    }
  }
}
