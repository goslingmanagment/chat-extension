// «Новые» (architecture.md §8.5, H-7, §6.7.9; ui-design §3.6, §4.17): who
// subscribed, renewed or came back in the window, the greeting lease and the
// per-part progress. A fan counts as greeted only after a linked receipt and
// echo with one id; one uncertain part holds the fan and the group until an
// owner or a team lead resolves it in the hub.

import { type CgErrorView } from '../errors';
import { type IsoTimestamp } from '../primitives';
import { type GreetingFilter, type NewcomersTab } from './actions';
import { type Msg } from './i18n';
import { type TargetHandle } from './selectors';
import { type ActionButtonVM, type DataStamp, type VmView } from './view';

export const NEWCOMER_KINDS = ['new', 'renewed', 'returning'] as const;
export type NewcomerKind = (typeof NEWCOMER_KINDS)[number];

/** The «Приветствие» column (ui-design §4.17). */
export type GreetingStatusVM =
  | { readonly s: 'none' }
  | { readonly s: 'claim-mine' }
  /**
   * «бронь: Анна». No countdown (ui-design §12 п. 5): the colleague's 120 s lease renews
   * every 40 s while they work with the fan and has no overall cap.
   */
  | { readonly s: 'claim-other'; readonly by: string | null }
  | { readonly s: 'sending'; readonly sent: number; readonly total: number }
  /** «отправлено 1 из 3, остановлено»: part `part` is uncertain. */
  | { readonly s: 'stopped'; readonly sent: number; readonly total: number; readonly part: number }
  | { readonly s: 'greeted'; readonly at: IsoTimestamp | null };

export const GREETING_STATES = ['none', 'claim-mine', 'claim-other', 'sending', 'stopped', 'greeted'] as const satisfies readonly GreetingStatusVM['s'][];

/** The greeting lease of the open card (H-7: 120 s, renewed every 40 s while the person works). */
export type ClaimVM =
  | { readonly s: 'none' }
  | { readonly s: 'mine'; readonly until: number; readonly renew: ActionButtonVM; readonly release: ActionButtonVM }
  /** CG-CLAIM-BUSY: «Фана сейчас ведёт Анна…», Hi off while the colleague holds the lease; no countdown. */
  | { readonly s: 'other'; readonly by: string | null; readonly error: CgErrorView }
  /** CG-CLAIM-EXPIRED: «бронь истекла — нажмите Hi ещё раз». */
  | { readonly s: 'expired'; readonly error: CgErrorView }
  /** An uncertain part keeps the fan held (CG-SEND-UNCERTAIN); only a hub `resolve` releases it. */
  | { readonly s: 'held-uncertain'; readonly part: number; readonly error: CgErrorView }
  /** CG-CLAIM-ROW-CHANGED / CG-CLAIM-ROW-BUSY. */
  | { readonly s: 'row-changed'; readonly error: CgErrorView };

export const CLAIM_STATES = ['none', 'mine', 'other', 'expired', 'held-uncertain', 'row-changed'] as const satisfies readonly ClaimVM['s'][];

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
