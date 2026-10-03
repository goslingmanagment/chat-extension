// «Новые» (architecture.md §8.5, H-7, §6.7.9; ui-design §3.6, §4.17): who
// subscribed, renewed or came back in the window, the greeting lease and the
// per-part progress. A fan counts as greeted only after a linked receipt and
// echo with one id; one uncertain part holds the fan and the group until an
// owner or a team lead resolves it in the hub.

import { type CgErrorView } from '../errors';
import { type LEASE_HOLDERS } from '../hub/newcomers';
import { type IsoTimestamp } from '../primitives';
import { type GreetingFilter, type NewcomersTab } from './actions';
import { type Msg } from './i18n';
import { type TargetHandle } from './selectors';
import { type ActionButtonVM, type DataStamp, type VmView } from './view';

export const NEWCOMER_KINDS = ['new', 'renewed', 'returning'] as const;
export type NewcomerKind = (typeof NEWCOMER_KINDS)[number];

/**
 * The «Приветствие» column (ui-design §4.17). The hub never names a lease's
 * holder (H-7 `heldBy`): `claim-other` is a colleague, `claim-elsewhere` is
 * this person in another tab or on another device — Hi stays off here too,
 * so two greeting flows never run for one fan.
 */
export type GreetingStatusVM =
  | { readonly s: 'none' }
  | { readonly s: 'claim-mine' }
  /**
   * «бронь: другой чаттер». No countdown (ui-design §12 п. 5): the colleague's 120 s lease renews
   * every 40 s while they work with the fan and has no overall cap.
   */
  | { readonly s: 'claim-other' }
  /** «бронь: вы, в другой вкладке». */
  | { readonly s: 'claim-elsewhere' }
  | { readonly s: 'sending'; readonly sent: number; readonly total: number }
  /** «отправлено 1 из 3, остановлено»: part `part` is uncertain. */
  | { readonly s: 'stopped'; readonly sent: number; readonly total: number; readonly part: number }
  | { readonly s: 'greeted'; readonly at: IsoTimestamp | null };

export const GREETING_STATUSES = ['none', 'claim-mine', 'claim-other', 'claim-elsewhere', 'sending', 'stopped', 'greeted'] as const satisfies readonly GreetingStatusVM['s'][];

/** The greeting lease of the open card (H-7: 120 s, renewed every 40 s while the person works). */
export type ClaimVM =
  | { readonly s: 'none' }
  /** `until`: the lease deadline on the local clock (send-rules localDeadline of `lease.expiresAt` and `serverNow`). */
  | { readonly s: 'mine'; readonly until: number; readonly renew: ActionButtonVM; readonly release: ActionButtonVM }
  /** CG-CLAIM-BUSY: a colleague holds the lease (never named, H-7); Hi off while they do; no countdown. */
  | { readonly s: 'other'; readonly error: CgErrorView }
  /** This person holds it in another tab or on another device: Hi off here, no release from here (the lease token lives there). */
  | { readonly s: 'elsewhere'; readonly note: Msg }
  /** CG-CLAIM-EXPIRED: «бронь истекла — нажмите Hi ещё раз». */
  | { readonly s: 'expired'; readonly error: CgErrorView }
  /** An uncertain part keeps the fan held (CG-SEND-UNCERTAIN); only a hub `resolve` releases it. */
  | { readonly s: 'held-uncertain'; readonly part: number; readonly error: CgErrorView }
  /** CG-CLAIM-ROW-CHANGED / CG-CLAIM-ROW-BUSY. */
  | { readonly s: 'row-changed'; readonly error: CgErrorView };

export const CLAIM_STATES = ['none', 'mine', 'other', 'elsewhere', 'expired', 'held-uncertain', 'row-changed'] as const satisfies readonly ClaimVM['s'][];

/** The hub's `heldBy` → the views: the only two holders H-7 tells apart. */
export const LEASE_HOLDER_STATES = {
  'someone-else': { greeting: 'claim-other', claim: 'other' },
  'you-elsewhere': { greeting: 'claim-elsewhere', claim: 'elsewhere' },
} as const satisfies Record<(typeof LEASE_HOLDERS)[number], { readonly greeting: GreetingStatusVM['s']; readonly claim: ClaimVM['s'] }>;

export interface NewcomerRowVM {
  readonly handle: TargetHandle;
  readonly name: string;
  readonly username: string | null;
  readonly kind: NewcomerKind;
  readonly subscribedAt: IsoTimestamp;
  readonly greeting: GreetingStatusVM;
  /** A saved greeting draft exists; `draftStale` — «Черновик устарел». */
  readonly hasDraft: boolean;
  readonly draftStale: boolean;
  readonly selected: boolean;
}

export interface NewcomersVM {
  /** `loading` with scan stages; `partial` — «Результат неполный» or coverage; `empty` — nobody in the window. */
  readonly view: VmView;
  readonly pageName: string | null;
  /** «Hi здоровается от имени Лора · VIP». */
  readonly personaLabel: string | null;
  readonly tab: NewcomersTab;
  readonly tabs: readonly { readonly id: NewcomersTab; readonly label: Msg; readonly count: number | null }[];
  readonly windowHours: number;
  readonly windowOptions: readonly number[];
  readonly filters: readonly { readonly id: GreetingFilter; readonly label: Msg; readonly count: number | null; readonly pressed: boolean }[];
  readonly query: string;
  readonly rows: readonly NewcomerRowVM[];
  /** The card on the right is the `preview` view, from `newcomers`. */
  readonly cardOpen: boolean;
  /** Scan phases in the header while the list is read and checked. */
  readonly scan: { readonly stage: Msg; readonly done: number | null; readonly total: number | null } | null;
  /** «Результат неполный» with why (NF-024). */
  readonly incomplete: Msg | null;
  /** «3 за 48 часов, охват полный», «данные на 09:18». */
  readonly footer: { readonly count: number; readonly stamp: DataStamp };
  /** Pages of 100 behind the server cursor. */
  readonly canLoadMore: boolean;
  readonly hint: Msg;
  /** «AI ничего не отправляет сам: только по вашему нажатию.» (NF-028). */
  readonly noAutoSend: Msg;
}
