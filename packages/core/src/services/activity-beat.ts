// The extension's beat (Chat Memory week 1; hub `clientActivity`, capability `chatter-activity-v1`): the hub computes
// the person's actual shift from it — in at the first active minute, a pause after 10 idle minutes, out when the
// extension closes.
//
// - Once a minute (the background's alarm) while the person is signed in and at least one registered tab is bound to
//   a page: one report with every bound page and how long ago the person was last active on it — the most recent
//   input over that page's tabs (a key, a click, a scroll; never what). The first bound tab beats at once, so a shift
//   starts when the person opens the site, not a minute later.
// - When the last bound tab goes, and on sign-out before the token is revoked: one beat with `closed` and no pages —
//   the hub ends the shift there and drops «в разговоре» of this person. Best effort: a browser that dies says
//   nothing, and the hub ends the shift after 3 silent minutes.
// - A report of what is, never owed: nothing is journaled or repeated; a lost beat is just lost.

import { ACTIVITY_INSTANCE_PATTERN, ACTIVITY_LIMITS, type ActivityBeatRequest, type HubFacade } from '@cg/contracts/hub';

import { NO_LOG, type Clock, type LogSink } from './ports';

/** One registered tab as the beat reads it: the page its account is bound to (null — none) and its last input. */
export interface BeatTab {
  readonly pageLabel: string | null;
  readonly lastInputAt: number | null;
}

/** A registered tab as presence knows it: which account its route is on (null — none) and its last input. */
export interface BeatTabSeen {
  readonly tabSessionId: string;
  readonly routeAccount: string | null;
  readonly lastInputAt: number | null;
}

/**
 * The beat's tabs. On an account's route: that account's page (null — not bound) and the tab's input. Off every
 * route (ChatSpace's overview «/», on the way from one account to another): the page it was last on and the input it
 * had there — the shift neither closes nor splits for that moment, and the overview adds no page it merely lists,
 * nor input made off them. A tab that opened on the overview has no page yet. `last` holds each open tab's last
 * page between beats; closed tabs leave it.
 */
export function beatTabsOf(
  tabs: readonly BeatTabSeen[],
  pageOfAccount: (account: string | null) => string | null,
  last: Map<string, BeatTab>,
): BeatTab[] {
  const out: BeatTab[] = [];
  for (const tab of tabs) {
    if (tab.routeAccount === null) {
      out.push(last.get(tab.tabSessionId) ?? { pageLabel: null, lastInputAt: tab.lastInputAt });
      continue;
    }
    const beat: BeatTab = { pageLabel: pageOfAccount(tab.routeAccount), lastInputAt: tab.lastInputAt };
    if (beat.pageLabel === null) last.delete(tab.tabSessionId);
    else last.set(tab.tabSessionId, beat);
    out.push(beat);
  }
  const open = new Set(tabs.map((tab) => tab.tabSessionId));
  for (const id of [...last.keys()]) if (!open.has(id)) last.delete(id);
  return out;
}

/** The pages of a beat at `now`: each bound page once, idle from its most recent input; at most ACTIVITY_LIMITS.maxPages. Pure. */
export function beatPagesOf(tabs: readonly BeatTab[], now: number): ActivityBeatRequest['pages'] {
  const latest = new Map<string, number | null>();
  for (const tab of tabs) {
    if (tab.pageLabel === null) continue;
    const known = latest.get(tab.pageLabel) ?? null;
    latest.set(tab.pageLabel, tab.lastInputAt === null ? known : Math.max(known ?? tab.lastInputAt, tab.lastInputAt));
  }
  return [...latest.entries()].slice(0, ACTIVITY_LIMITS.maxPages).map(([pageLabel, at]) => ({
    pageLabel,
    idleMs: at === null ? null : Math.min(ACTIVITY_LIMITS.maxIdleMs, Math.max(0, Math.round(now - at))),
  }));
}

export interface ActivityBeatDeps {
  readonly clock: Pick<Clock, 'now'>;
  readonly hub: () => Pick<HubFacade, 'activityBeat'> | null;
  /** Signed in and the hub lists `chatter-activity-v1`. */
  readonly enabled: () => boolean;
  /** The install's own id; one that does not fit the hub's pattern beats nothing. */
  readonly instanceId: () => string;
  readonly tabs: () => readonly BeatTab[];
  readonly log?: LogSink;
}

export class ActivityBeat {
  /** A beat with pages went since the last `closed`: the install is open at the hub. */
  private open = false;
  private readonly log: LogSink;

  constructor(private readonly deps: ActivityBeatDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** The alarm's beat: the bound pages now; none left after an open beat — `closed`. */
  async beat(): Promise<void> {
    if (!this.deps.enabled()) return;
    const pages = beatPagesOf(this.deps.tabs(), this.deps.clock.now());
    if (pages.length === 0) return this.close();
    this.open = true;
    await this.send({ pages });
  }

  /** The tabs changed: the first bound tab beats at once, the last one going closes. */
  async tabsChanged(): Promise<void> {
    const bound = this.deps.tabs().some((tab) => tab.pageLabel !== null);
    if (bound && !this.open) return this.beat();
    if (!bound && this.open) return this.close();
  }

  /** The last bound tab went, or the person signs out (before the token is revoked): one beat with `closed`. */
  async close(): Promise<void> {
    if (!this.open) return;
    this.open = false;
    await this.send({ pages: [], closed: true });
  }

  private async send(body: Omit<ActivityBeatRequest, 'instanceId'>): Promise<void> {
    const hub = this.deps.hub();
    const instanceId = this.deps.instanceId();
    if (hub === null || !this.deps.enabled() || !ACTIVITY_INSTANCE_PATTERN.test(instanceId)) return;
    try {
      await hub.activityBeat({ instanceId, ...body });
    } catch {
      // Lost: the next minute beats again; a lost `closed` ends the shift after the hub's 3 silent minutes.
      this.log.write({ level: 'info', scope: 'bg.activity', msg: 'beat lost', fields: { pages: body.pages.length, closed: body.closed === true } });
    }
  }
}
