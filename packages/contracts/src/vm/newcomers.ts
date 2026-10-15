// «Новые» (architecture.md §8.5, H-7, §6.7.9; ui-design §3.6, §4.17): who
// subscribed, renewed or came back in the window, the greeting lease and the
// per-part progress. A fan counts as greeted only after a linked receipt and
// echo with one id; one uncertain part holds the fan and the group until an
// owner or a team lead resolves it in the hub.

import { type CgErrorView } from '../errors';
import { type LEASE_HOLDERS } from '../hub/newcomers';
import { type IsoTimestamp } from '../primitives';
import { type GreetingFilter, type NewcomerCheckFilter, type NewcomersTab } from './actions';
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
  /**
   * `until`: the lease deadline on the local clock (send-rules localDeadline of `lease.expiresAt` and `serverNow`).
   * `renewError` (1.2.0): the last renewal did not go through (the hub did
   * not answer) — the lease still runs to `until`, the renewal is tried
   * again while the person works with the fan, «Продлить бронь» tries now.
   */
  | { readonly s: 'mine'; readonly until: number; readonly renew: ActionButtonVM; readonly release: ActionButtonVM; readonly renewError?: CgErrorView }
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
  /** 1.15.0 (R20 P10a): the verdict of the background's pass, where a pass checks the list (`NewcomersVM.pass`). */
  readonly check?: NewcomerCheckVM;
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
  /**
   * 1.15.0 (R20 P10a): the list comes from the background's own pass over the site, not from the hub — its progress,
   * its filters and the card it reads. Absent — the hub's list; its card is the `preview` view.
   */
  readonly pass?: NewcomersPassVM;
}

// ── A list a background pass checks (1.15.0, R20 P10a; R20 architecture §8.7) ──
//
// Where no hub list says who is new, the background reads the site itself (a pass: the new followers, their
// profiles, then one queue that checks each one's chat) and the window shows it as it goes: each row's verdict, the
// pass's progress, and a card drawn from what the pass read — never the hub archive, never a chat the person did
// not open. The rows change in place as the pass tells the window; the window never polls. The surface of such a
// site draws `pass`; the words of its statuses are the site's own.

/** The pass's verdict about one fan (NF-005). `unverified` — no personal message was found, but the history was not read to its end. */
export const NEWCOMER_CHECKS = ['checking', 'pending', 'ready', 'reply', 'unverified', 'greeted', 'dm-closed', 'excluded', 'failed'] as const;
export type NewcomerCheck = (typeof NEWCOMER_CHECKS)[number];

/** Why a fan cannot be messaged: a paid DM, or rules of the fan's the creator does not meet (FS-NEW-2). */
export type NewcomerDmClosed = 'paid' | 'permissions';

export interface NewcomerCheckVM {
  readonly status: NewcomerCheck;
  /** The creator's own name for the fan, shown beside the name; null — none. */
  readonly customName: string | null;
  readonly dmClosed: NewcomerDmClosed | null;
}

/** A failure the pass or its window reports: the code may be the site's own (its registry and texts), never a raw text. */
export interface NewcomersFailureVM {
  readonly code: string;
  /** A deadline the code waits for (a cooldown), epoch ms; null — none. */
  readonly retryAt: number | null;
}

/** Where the pass stands: `connecting` — no answer of the background yet; `failed` — the list was not read (FX-017: never «nobody»). */
export const NEWCOMERS_PASS_STAGES = ['connecting', 'scanning', 'queue', 'paused', 'cooldown', 'done', 'stopped', 'failed'] as const;
export type NewcomersPassStage = (typeof NEWCOMERS_PASS_STAGES)[number];

/** What the fast part reads while `scanning` (NF-008). */
export const NEWCOMERS_PASS_PHASES = ['welcome', 'followers', 'profiles', 'checking'] as const;
export type NewcomersPassPhase = (typeof NEWCOMERS_PASS_PHASES)[number];

/** One message of the card's conversation (NF-010), as the pass read it; `automated` — a welcome or a mass message, marked. */
export interface NewcomerMessageVM {
  readonly id: string;
  readonly fromFan: boolean;
  readonly at: IsoTimestamp;
  readonly text: string;
  readonly automated: boolean;
  readonly attachments: number;
}

/** The card's conversation, oldest first (NF-010). */
export interface NewcomerHistoryVM {
  /**
   * `unchecked` — the pass has not read this fan's chat yet; `none` — no conversation to read (the pass found none);
   * `loading` — the first page is on its way; `ready`; `failed` — the read failed (`failure`, «Повторить» is RefreshArchive).
   */
  readonly s: 'unchecked' | 'none' | 'loading' | 'ready' | 'failed';
  readonly messages: readonly NewcomerMessageVM[];
  /** Older messages are there: «Более ранние сообщения» (LoadOlder). */
  readonly more: boolean;
  readonly loadingMore: boolean;
  /** The window's cap is reached (`cap` messages): the rest is in the chat itself. */
  readonly capped: boolean;
  readonly cap: number;
  readonly failure: NewcomersFailureVM | null;
}

/** The card of the selected fan (NF-009…NF-011): the profile, the verdict, the conversation the pass read, and the way into the chat. */
export interface NewcomerCardVM {
  readonly handle: TargetHandle;
  readonly name: string;
  readonly username: string | null;
  readonly customName: string | null;
  readonly followedAt: IsoTimestamp;
  /** When the pass checked the fan; null — not yet. */
  readonly checkedAt: IsoTimestamp | null;
  readonly bio: string | null;
  readonly check: NewcomerCheck;
  readonly dmClosed: NewcomerDmClosed | null;
  /** `failed`: why. */
  readonly failure: NewcomersFailureVM | null;
  /** `greeted` — «Уже писали»: the creator's personal message that proves it, shown folded. */
  readonly proof: NewcomerMessageVM | null;
  readonly history: NewcomerHistoryVM;
  /**
   * «Открыть … ↗» (NF-011): the fan's chat on the site, opened by the person's own click in a new tab — the window
   * stays open; null — no conversation is known.
   */
  readonly openHref: string | null;
}

export interface NewcomersPassVM {
  /** The creator whose followers these are, «@lora» (NF-008); null — unknown. */
  readonly creator: string | null;
  readonly stage: NewcomersPassStage;
  /** The fast part's step while `scanning`; null otherwise. */
  readonly phase: NewcomersPassPhase | null;
  /** «Проверено 40 из 120»; null — not known yet. */
  readonly checked: number | null;
  readonly total: number | null;
  /** The window's dates (NF-008): from when to when the pass looks; null — no pass yet. */
  readonly range: { readonly from: IsoTimestamp; readonly to: IsoTimestamp } | null;
  /** `cooldown`: when the pass goes on, epoch ms. */
  readonly cooldownUntil: number | null;
  /** The status filters with counts (NF-006): `SetNewcomersCheckFilter`. */
  readonly filters: readonly { readonly id: NewcomerCheckFilter; readonly count: number | null; readonly pressed: boolean }[];
  /** The list was not read (`failed`) or the pass stopped (`stopped`): why. */
  readonly failure: NewcomersFailureVM | null;
  /** The selected fan's card; null — the list is empty. */
  readonly card: NewcomerCardVM | null;
}
