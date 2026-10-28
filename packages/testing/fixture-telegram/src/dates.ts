// Web A's words for days and times (telegram-tt util/localization/dateFormat.ts `formatMessageListDate`): the day line
// of a message group is «Today», «Yesterday», the weekday within 6 days, «October 19» further back this year and
// «December 12, 2025» for an earlier year; a message's time is the account's clock, «14:02» or «2:05 PM».

const DAY_MS = 86_400_000;
const WEEKDAYS_IN_CALENDAR_WINDOW = 6;

const midnight = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Calendar days from `anchor` to `date` (negative in the past), by local midnights. */
export function calendarDayDiff(date: Date, anchor: Date): number {
  return Math.round((midnight(date) - midnight(anchor)) / DAY_MS);
}

export function dayLabel(date: Date, now: Date): string {
  const diff = calendarDayDiff(date, now);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (date.getFullYear() !== now.getFullYear()) return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  if (Math.abs(diff) <= WEEKDAYS_IN_CALENDAR_WINDOW) return date.toLocaleDateString('en-US', { weekday: 'long' });
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

export function timeText(date: Date, clock: '24h' | '12h'): string {
  const minutes = String(date.getMinutes()).padStart(2, '0');
  if (clock === '24h') return `${String(date.getHours()).padStart(2, '0')}:${minutes}`;
  const hours = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
  return `${hours}:${minutes} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** The chat list's time of a row: the time today, the short weekday within a week, else the short date. */
export function listTime(date: Date, now: Date, clock: '24h' | '12h'): string {
  const diff = calendarDayDiff(date, now);
  if (diff === 0) return timeText(date, clock);
  if (Math.abs(diff) <= WEEKDAYS_IN_CALENDAR_WINDOW) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
}

/** The instant of a seeded message: so many days before today at a time of day, or so many minutes before now. */
export function seededAt(when: { readonly day: number; readonly time: string } | { readonly ago: number }, now: Date): Date {
  if ('ago' in when) return new Date(now.getTime() - when.ago * 60_000);
  const [hours = 0, minutes = 0] = when.time.split(':').map(Number);
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - when.day, hours, minutes);
  // A time of today that has not come yet would read as the future: such a message is an hour ago instead.
  return date.getTime() > now.getTime() ? new Date(now.getTime() - 3_600_000) : date;
}
