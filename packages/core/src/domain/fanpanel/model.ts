// The fan panel (architecture.md D-29, §10.2 FanPanelVM; CS-017, CS-031…
// CS-037, DB-026): who the fan of the open chat is, what they spent and on
// what, how their subscription to THIS page stands. Facts come from the hub
// — `spenderDetail` and only its element of the target page (a fan
// subscribed to another page of the agency says nothing about this one),
// the hub's profile of the fan (its body is the panel's bio, CS-035) and the
// hub archive of the thread (its coverage, DB-026). ChatSpace's own memory
// adds decoration (last seen, buying power, scores, lists, and its «О себе»
// while the hub has no profile) only when it already holds it. A missing
// source is null, never a guess; every block says how old and how complete
// its data is.

import { type HostFan } from '@cg/contracts/host';
import { type Dossier, type SPENDER_RETENTION_STATUSES, type SpenderDetail } from '@cg/contracts/hub';
import { type CoverageLevel } from '@cg/contracts/ops';
import { type IsoTimestamp, type MoneyMills } from '@cg/contracts/primitives';

export type SpendKind = 'messages' | 'tips' | 'subscription' | 'posts' | 'other';
/** Order of the «Потратил всего» rows. */
export const SPEND_KINDS = ['messages', 'tips', 'subscription', 'posts', 'other'] as const satisfies readonly SpendKind[];

type CanonicalType = SpenderDetail['typeBreakdown'][number]['canonicalType'];
type Retention = (typeof SPENDER_RETENTION_STATUSES)[number];
export type ChurnRisk = 'low' | 'medium' | 'high';

/** The hub's transaction types → the panel's kinds; refunds and chargebacks reduce «other». */
const KIND_OF: Readonly<Record<CanonicalType, SpendKind>> = {
  subscription: 'subscription',
  tip: 'tips',
  stream_tip: 'tips',
  message_purchase: 'messages',
  post_purchase: 'posts',
  chargeback: 'other',
  refund: 'other',
  payout_reversal: 'other',
  other: 'other',
};

/** CHURN_RISK_BY_RETENTION of the contracts, repeated so this module loads no schema module (a test pins them equal). */
const RISK_OF: Readonly<Record<Retention, ChurnRisk>> = { active: 'low', cooling: 'medium', inactive: 'high', needs_reactivation: 'high' };

export type TargetPage = SpenderDetail['pages'][number];

/** The element of the page the chat belongs to; null — the hub has none for it. */
export function targetPage(detail: SpenderDetail | null, pageId: number): TargetPage | null {
  return detail?.pages.find((page) => page.pageId === pageId) ?? null;
}

/** Spend by kind, in SPEND_KINDS order; kinds with no transactions are left out. */
export function spendByKind(breakdown: SpenderDetail['typeBreakdown']): { readonly kind: SpendKind; readonly mills: MoneyMills }[] {
  const sums = new Map<SpendKind, number>();
  for (const item of breakdown) {
    const kind = KIND_OF[item.canonicalType];
    sums.set(kind, (sums.get(kind) ?? 0) + item.grossAmountMills);
  }
  return SPEND_KINDS.filter((kind) => sums.has(kind)).map((kind) => ({ kind, mills: sums.get(kind) ?? 0 }));
}

/** CS-017 «фан уже N мес»: whole calendar months from `since` to `now` (UTC); null — no start or a start in the future. */
export function subscriptionMonths(since: IsoTimestamp | null, now: number): number | null {
  if (since === null) return null;
  const start = Date.parse(since);
  if (Number.isNaN(start) || start > now) return null;
  const a = new Date(start);
  const b = new Date(now);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * «Риск ухода». A fan who is not subscribed to the page any more, or whose
 * auto-renewal is off, is at high risk (the desktop's «РИСК ОТТОКА» rule).
 * Otherwise the hub's retention status of the fan's board row decides; with
 * no row, a live subscription that renews itself is low risk. Nothing known
 * — null («нет данных»).
 */
export function churnRisk(page: TargetPage | null, retention: Retention | null): ChurnRisk | null {
  if (page !== null) {
    const lapsed = page.subscriberSince !== null && !page.isSubscriber;
    if (lapsed) return 'high';
    if (page.isSubscriber && (page.autoRenew === false || page.autoRenewOffDetectedAt !== null)) return 'high';
  }
  if (retention !== null) return RISK_OF[retention];
  if (page !== null && page.isSubscriber && page.autoRenew === true) return 'low';
  return null;
}

/** Initials for the avatar circle: no remote images are ever loaded. */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/u)
    .filter((word) => word.length > 0);
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? '');
  const text = letters.join('').toUpperCase();
  return text.length > 0 ? text : '?';
}

export interface FanPanelInput {
  readonly fanRef: string;
  /** The hub page of the open chat. */
  readonly pageId: number;
  /** `spenderDetail` over the lifetime: the total and the kinds. */
  readonly lifetime: SpenderDetail | null;
  /** The same over 30 days: «+$N за 30 дней». */
  readonly last30: SpenderDetail | null;
  /** What ChatSpace already holds about the fan; null — nothing in memory. */
  readonly hostFan: HostFan | null;
  /** The hub's profile of the fan (`pageFanProfile`); null — the hub has none, or it was not read. */
  readonly dossier?: Dossier | null;
  /** The hub archive of this thread as its feed states it; null — not read. */
  readonly archive?: { readonly coverage: CoverageLevel } | null;
  /** The fan's row of the Spenders board, when one was loaded. */
  readonly row: { readonly retention: Retention | null; readonly storedMessages: number; readonly history: 'complete' | 'partial' | 'none' } | null;
  readonly now: number;
}

export interface FanPanelModel {
  readonly name: string;
  readonly username: string | null;
  readonly initials: string;
  readonly lastSeenAt: IsoTimestamp | null;
  readonly online: boolean | null;
  readonly spent: {
    readonly total: MoneyMills | null;
    readonly period30: MoneyMills | null;
    readonly byKind: readonly { readonly kind: SpendKind; readonly mills: MoneyMills | null }[];
  } | null;
  readonly subscription: {
    readonly months: number | null;
    readonly since: IsoTimestamp | null;
    readonly autoRenew: boolean | null;
    readonly churnRisk: ChurnRisk | null;
  } | null;
  readonly host: { readonly buyingPower: string | null; readonly scores: readonly { readonly label: string; readonly value: string }[] } | null;
  readonly bio: string | null;
  /** `hub` — the body of the hub's profile; `host` — ChatSpace's own «О себе», standing in while the hub has no profile. */
  readonly bioSource: 'hub' | 'host' | null;
  readonly lists: readonly string[];
  /** When the hub's money data was current. */
  readonly asOf: IsoTimestamp | null;
  /** Coverage of the hub archive of this thread: the archive's own word, else the board row's; unknown without either. */
  readonly coverage: CoverageLevel;
  /** Messages the archive stores for the thread: only the board row carries the number. */
  readonly archiveMessages: number | null;
}

/** A field of ChatSpace's insights that is bookkeeping, not an estimate of the fan: a moment, an id, a version. */
const META_LABEL = /(^|[a-z_])(at|id|ids|version|revision)$|^(updated|created|generated|fetched|expires)/i;
const MOMENT_VALUE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * «buyingPower» → «Buying power»: a field name of ChatSpace's own data as a
 * person reads it. The names are ChatSpace's (D-29: «shown as it names
 * them»); only their spelling is ours — words apart, the first one
 * capitalized. Which fields the real ChatSpace sends is checked live.
 */
export function insightLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.length === 0 ? key : words.charAt(0).toUpperCase() + words.slice(1);
}

/** ChatSpace's estimates of the fan as rows of the panel: without its bookkeeping fields, with readable names. */
export function hostScores(insights: readonly { readonly label: string; readonly value: string }[]): { readonly label: string; readonly value: string }[] {
  return insights
    .filter((item) => !META_LABEL.test(item.label) && !MOMENT_VALUE.test(item.value) && item.value.trim() !== '')
    .map((item) => ({ label: insightLabel(item.label), value: item.value }));
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

export function fanPanelModel(input: FanPanelInput): FanPanelModel {
  const detail = input.lifetime ?? input.last30;
  const host = input.hostFan;
  const dossier = input.dossier ?? null;
  // Who the fan is, as the hub names them: the money read's fan, else the profile's.
  const hubFan = detail?.fan ?? dossier?.fan ?? null;
  const username = (text(host?.username) ?? text(hubFan?.username))?.replace(/^@/, '') ?? null;
  const name = text(hubFan?.pageAlias) ?? text(host?.displayName) ?? text(hubFan?.displayName) ?? username ?? input.fanRef;
  const page = targetPage(detail, input.pageId);
  const retention = input.row?.retention ?? null;

  const spent =
    detail === null
      ? null
      : {
          total: detail.metrics.lifetime.scopeGrossAmountMills,
          period30: input.last30?.metrics.window?.grossAmountMills ?? null,
          // The kinds are the lifetime read's; without it they are unknown, not the 30-day ones.
          byKind: input.lifetime === null ? [] : spendByKind(input.lifetime.typeBreakdown),
        };

  const subscription =
    page === null && retention === null
      ? null
      : {
          months: page !== null && page.isSubscriber ? subscriptionMonths(page.subscriberSince, input.now) : null,
          since: page?.subscriberSince ?? null,
          autoRenew: page === null ? null : page.autoRenewOffDetectedAt !== null ? false : page.autoRenew,
          churnRisk: churnRisk(page, retention),
        };

  const scores = hostScores(host?.insights ?? []);
  const buyingPower = text(host?.buyingPowerLabel);
  // CS-035, D-29: the bio is the hub's profile of the fan; ChatSpace's own «О себе» is decoration, shown while the hub has none.
  const hubBio = text(dossier?.profile?.body);
  const hostBio = text(host?.bio);
  const rowCoverage: CoverageLevel = input.row === null ? 'unknown' : input.row.history === 'complete' ? 'complete' : 'partial';
  return {
    name,
    username,
    initials: initials(name),
    lastSeenAt: host?.lastSeenAt ?? null,
    online: host?.isOnline ?? null,
    spent,
    subscription,
    host: host === null || (buyingPower === null && scores.length === 0) ? null : { buyingPower, scores },
    bio: hubBio ?? hostBio,
    bioSource: hubBio !== null ? 'hub' : hostBio !== null ? 'host' : null,
    lists: host?.lists ?? [],
    asOf: detail?.period.asOf ?? null,
    coverage: input.archive?.coverage ?? rowCoverage,
    archiveMessages: input.row === null ? null : input.row.storedMessages,
  };
}
