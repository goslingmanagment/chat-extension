// Who «Рассылка» is for (2026-10-25): the fans of the chosen tiers of the Spenders board — or the fans ticked in
// Spenders when the window opened —, minus those a condition of «Кому» leaves out, each with why. Pure: the controller
// gives the board's rows, what the site said of purchases and the 7-day board, and the person's choices.
//
// - Before the versions are written the list is everyone in, each ticked unless the person unticked them; a fan a
//   condition leaves out stands under «Не войдут» with every reason, the first one leading.
// - Once the versions are written («Написать N версий») who is in no longer moves: the list is the fans of the
//   outreach, whatever the conditions say later; a fan of the chosen tiers the person left unticked is «Снят вручную».
// - A condition the site cannot answer leaves nobody out: «Не купил это видео» with purchases unknown, «Писал или
//   покупал за 7 дней» decides by the archive's «фан писал» alone until the 7-day board is read.

import { type IsoTimestamp, type MoneyMills } from '@cg/contracts/primitives';
import { type OutreachAsideVM, type OutreachCondition, type OutreachTouchWhat } from '@cg/contracts/vm';

/** What a condition of «Кому» holds: on or off, and «Потратил больше» its amount in mills. */
export interface OutreachConditions {
  readonly spent: { readonly on: boolean; readonly minMills: MoneyMills };
  readonly active: { readonly on: boolean };
  readonly notBought: { readonly on: boolean };
  readonly noWaiting: { readonly on: boolean };
  /** 1.70.0: «Без удалённых аккаунтов». */
  readonly noGone: { readonly on: boolean };
  /** 1.72.0: «Без тех, кому писали за 3 дня» (an outreach, a fan queue or «Онлайн», any of the team). */
  readonly noTouched: { readonly on: boolean };
}

export const DEFAULT_CONDITIONS: OutreachConditions = {
  spent: { on: false, minMills: 1_000_000 },
  active: { on: false },
  // The owner's default (2026-10-25): a fan who bought the video is not offered it again.
  notBought: { on: true },
  noWaiting: { on: false },
  // A fan whose account the site no longer finds takes no message (a send to one ends «Не подтвердилось»): left out
  // unless the person says otherwise (Dmitriy, 2026-11-01: «удалённый аккаунт не пометился, должен был»).
  noGone: { on: true },
  // A fan another outreach, a fan queue or «Онлайн» wrote to within 3 days gets no outreach unless the person says
  // otherwise (the owner, 2026-11-01: «пауза 3 дня»; it works both ways — those windows wait for an outreach's send).
  noTouched: { on: true },
};

/** A fan written to in the last 3 days, as «Кому» says it. */
export interface AudienceTouch {
  readonly at: IsoTimestamp;
  readonly what: OutreachTouchWhat;
  /** A colleague's login; null — the person. */
  readonly by: string | null;
}

/** «Писал или покупал за 7 дней». */
export const ACTIVE_DAYS = 7;
const DAY_MS = 86_400_000;

/** A fan as the board knows them: what «Кому» reads. */
export interface AudienceFan {
  readonly fanRef: string;
  readonly lifetime: MoneyMills | null;
  readonly fanWroteAt: IsoTimestamp | null;
  /** The fan wrote last. */
  readonly waiting: boolean;
  /** The site no longer finds the fan's account (deleted, or the page blocked); absent — it does. */
  readonly gone?: boolean;
}

/** A tier: a shelf of the board with its fans in the board's order. */
export interface AudienceTier {
  readonly id: string;
  readonly fans: readonly string[];
}

export type AudienceSource = { readonly kind: 'tiers'; readonly on: ReadonlySet<string> } | { readonly kind: 'picked'; readonly fans: readonly string[] };

export interface AudienceInput {
  readonly fans: ReadonlyMap<string, AudienceFan>;
  /** The board's tiers, richest first. */
  readonly tiers: readonly AudienceTier[];
  readonly source: AudienceSource;
  readonly conditions: OutreachConditions;
  /**
   * The offer has paid media and the site said who of the pool bought them: fan → when (null — not said); null — no
   * paid media, or not known (yet): nobody is left out by it.
   */
  readonly bought: ReadonlyMap<string, IsoTimestamp | null> | null;
  /** Fans who spent something in the last 7 days (the 7-day board); null — not read. */
  readonly recent: ReadonlySet<string> | null;
  /** 1.72.0: fans written to in the last 3 days by another outreach, a fan queue or «Онлайн»; null — not known. */
  readonly touched?: ReadonlyMap<string, AudienceTouch> | null;
  /** Fans unticked by the person. */
  readonly unticked: ReadonlySet<string>;
  /** The fans of the outreach once its versions are written (in their order); null — not written yet. */
  readonly locked: readonly string[] | null;
  readonly now: number;
}

export interface Audience {
  /** The fans of the chosen tiers (or the picked fans), in the board's order. */
  readonly pool: readonly string[];
  /** The fans in the outreach: before the versions — everyone a condition does not leave out; after — the locked ones. */
  readonly members: readonly string[];
  /** Of `members`, those who get a version: before — the ticked ones; after — all of them. */
  readonly ticked: readonly string[];
  /** «Не войдут»: fans of the pool not in, with every reason. */
  readonly aside: ReadonlyMap<string, readonly OutreachAsideVM[]>;
}

const time = (iso: IsoTimestamp | null): number | null => {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** The pool: the chosen tiers' fans in the board's order, or the picked fans the board still lists. */
export function poolOf(input: Pick<AudienceInput, 'fans' | 'tiers' | 'source'>): string[] {
  if (input.source.kind === 'picked') return input.source.fans.filter((fanRef) => input.fans.has(fanRef));
  const on = input.source.on;
  return input.tiers.filter((tier) => on.has(tier.id)).flatMap((tier) => tier.fans);
}

/** Why the conditions leave this fan out; empty — they do not. */
export function reasonsOf(fan: AudienceFan, input: Pick<AudienceInput, 'conditions' | 'bought' | 'recent' | 'now' | 'touched'>): OutreachAsideVM[] {
  const { conditions } = input;
  const reasons: OutreachAsideVM[] = [];
  if (conditions.noGone.on && fan.gone === true) reasons.push({ kind: 'gone' });
  const touch = input.touched?.get(fan.fanRef);
  if (conditions.noTouched.on && touch !== undefined) reasons.push({ kind: 'touched', at: touch.at, what: touch.what, by: touch.by });
  if (conditions.notBought.on && input.bought !== null && input.bought.has(fan.fanRef)) reasons.push({ kind: 'bought', at: input.bought.get(fan.fanRef) ?? null });
  if (conditions.noWaiting.on && fan.waiting) reasons.push({ kind: 'waiting', since: fan.fanWroteAt });
  if (conditions.spent.on && (fan.lifetime ?? 0) <= conditions.spent.minMills) reasons.push({ kind: 'spent', lifetime: fan.lifetime, min: conditions.spent.minMills });
  if (conditions.active.on && !active(fan, input)) reasons.push({ kind: 'inactive' });
  return reasons;
}

/** Wrote in the last 7 days, or (the 7-day board read) spent something in them. */
function active(fan: AudienceFan, input: Pick<AudienceInput, 'recent' | 'now'>): boolean {
  const wrote = time(fan.fanWroteAt);
  if (wrote !== null && input.now - wrote <= ACTIVE_DAYS * DAY_MS) return true;
  return input.recent?.has(fan.fanRef) === true;
}

export function audienceOf(input: AudienceInput): Audience {
  const pool = poolOf(input);
  const aside = new Map<string, readonly OutreachAsideVM[]>();
  if (input.locked !== null) {
    const locked = new Set(input.locked);
    for (const fanRef of pool) {
      if (locked.has(fanRef)) continue;
      const fan = input.fans.get(fanRef);
      const reasons = fan === undefined ? [] : reasonsOf(fan, input);
      aside.set(fanRef, reasons.length > 0 ? reasons : [{ kind: 'manual' }]);
    }
    // A fan of the outreach stays in it even if the board no longer lists them (a newer read): their version is theirs.
    const members = [...input.locked];
    return { pool, members, ticked: members, aside };
  }
  const members: string[] = [];
  for (const fanRef of pool) {
    const fan = input.fans.get(fanRef);
    if (fan === undefined) continue;
    const reasons = reasonsOf(fan, input);
    if (reasons.length > 0) aside.set(fanRef, reasons);
    else members.push(fanRef);
  }
  return { pool, members, ticked: members.filter((fanRef) => !input.unticked.has(fanRef)), aside };
}

/**
 * How many conditions narrow the list now: «Whale, Top и Prime · 1 условие». `notBought` counts only while it can act,
 * `noGone` only while the chosen fans have a gone account, `noTouched` only while they have one written to in 3 days.
 */
export function activeConditions(conditions: OutreachConditions, paid: boolean, gone = false, touched = false): number {
  const ids: readonly OutreachCondition[] = ['spent', 'active', 'notBought', 'noWaiting', 'noGone', 'noTouched'];
  return ids.filter((id) => conditions[id].on && (id !== 'notBought' || paid) && (id !== 'noGone' || gone) && (id !== 'noTouched' || touched)).length;
}

/** «1,000», «$1 000», «1000.50» → mills; null — not an amount. */
export function parseAmount(typed: string): MoneyMills | null {
  const text = typed.trim().replace(/^\$\s*/, '').replace(/[\s,]/g, '');
  if (!/^\d{1,7}(?:\.\d{0,2})?$/.test(text)) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  return Number(whole) * 1000 + Number(fraction.padEnd(2, '0').slice(0, 2)) * 10;
}
