// «Ждут вас» (hub ecosystem K, #1232; contracts hub/matters.ts): how many matters wait for the person, as a number on
// the toolbar icon, and the popup's one line over «Мои смены».
//
// - The number comes with the beat's answer (activity-beat.ts: once a minute while a tab of a page is open) and with
//   the popup's own read when it opens. No polling of its own, no sound, no window: only the icon's text changes.
// - 0 — no number. A hub that does not send a count (older, or it could not count this minute) changes nothing: the
//   icon keeps what it shows. Another sign-in, or none: the number goes at once.
// - The popup's line: the count, the title of the longest waiting matter, and the shift to hand in — the newest
//   `shift.report.missing` matter's screen in Workboard. The hub opens that kind only for a person whose switch
//   «сдаёт смену в системе» is on, and closes it when the switch goes off: the matter is the hub's word on both.

import { SHIFT_REPORT_MISSING_KIND, WEB_LINK_NEXT_MAX_CHARS, WORKBOARD_PATH_PREFIX, type ClientMatters } from '@cg/contracts/hub';

import { NO_LOG, type LogSink } from './ports';

/** The icon holds four characters at most: past this, «99+». */
export const WAITING_BADGE_MAX = 99;
/** The longest title the popup's line takes (it ends in «…» on its own). */
export const WAITING_TITLE_MAX = 200;

/** The icon's text for a count: '' at 0, «99+» past 99; null — no count (an older hub, a wrong value). Pure. */
export function waitingBadgeText(count: unknown): string | null {
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null;
  if (count === 0) return '';
  return count > WAITING_BADGE_MAX ? `${String(WAITING_BADGE_MAX)}+` : String(count);
}

/** The popup's line: how many wait, the longest waiting one's title, the shift's screen to hand in (null — none). */
export interface WaitingLine {
  readonly count: number;
  readonly title: string | null;
  readonly handIn: string | null;
}

const at = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
};

/** The hub's answer as the popup's line. Pure. */
export function waitingLineOf(answer: ClientMatters): WaitingLine {
  const oldest = [...answer.matters].sort((a, b) => at(a.openedAt) - at(b.openedAt) || a.id - b.id)[0];
  const title = oldest?.title.trim().slice(0, WAITING_TITLE_MAX) ?? '';
  // The person's LAST shift: the newest of the shifts not handed in, by the moment its matter opened.
  const shift = answer.matters
    .filter((matter) => matter.kind === SHIFT_REPORT_MISSING_KIND && matter.link !== null && matter.link.startsWith(WORKBOARD_PATH_PREFIX) && matter.link.length <= WEB_LINK_NEXT_MAX_CHARS)
    .sort((a, b) => at(b.openedAt) - at(a.openedAt) || b.id - a.id)[0];
  return { count: answer.count, title: title === '' ? null : title, handIn: shift?.link ?? null };
}

export interface WaitingBadgeDeps {
  /** Sets the toolbar icon's text ('' — none). */
  readonly show: (text: string) => Promise<void>;
  readonly log?: LogSink;
}

/** The toolbar icon's number. One per background; it remembers only what it set, to set nothing twice. */
export class WaitingBadge {
  private shown: string | null = null;
  private readonly log: LogSink;

  constructor(private readonly deps: WaitingBadgeDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** A count from the hub: the icon follows it; no count — the icon stays as it is. */
  count(value: unknown): void {
    const text = waitingBadgeText(value);
    if (text !== null) this.set(text);
  }

  /** Another person, or nobody: no number of the previous sign-in stays. */
  clear(): void {
    this.set('');
  }

  private set(text: string): void {
    if (text === this.shown) return;
    this.shown = text;
    this.deps.show(text).catch(() => {
      // The browser refused: the next count sets it again.
      this.shown = null;
      this.log.write({ level: 'info', scope: 'bg.waiting', msg: 'badge not set', fields: {} });
    });
  }
}
