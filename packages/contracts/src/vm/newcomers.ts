// «Новые» (architecture.md §8.5, H-7, §6.7.9; ui-design §3.6, §4.17): who
// subscribed, renewed or came back in the window, and the per-part progress.
// A fan counts as greeted only after a linked receipt and echo with one id. A
// part whose outcome is unknown says so and holds nothing (2026-10-20 audit,
// row 2): the person looks at the chat and may send again by their own click.

import { type CgErrorView } from '../errors';
import { type StaleReason } from '../ops';
import { type IsoTimestamp, type MoneyMills } from '../primitives';
import { type BatchRowVM, type BatchVM } from './batch';
import { type GreetingFilter, type NewcomerCheckFilter, type NewcomersTab } from './actions';
import { type Msg } from './i18n';
import { type TargetHandle } from './selectors';
import { type ActionButtonVM, type DataStamp, type VmView } from './view';

export const NEWCOMER_KINDS = ['new', 'renewed', 'returning'] as const;
export type NewcomerKind = (typeof NEWCOMER_KINDS)[number];

/**
 * The «Приветствие» column (ui-design §4.17). No lease is a status (2026-10-22): nobody takes one, and what an
 * older client holds blocks nothing here.
 */
export type GreetingStatusVM =
  | { readonly s: 'none' }
  /** «отправляется другим чаттером»: somebody's part is on its way to the fan now (the hub's custody `dispatching`): a note, not a hold. */
  | { readonly s: 'sending-other' }
  | { readonly s: 'sending'; readonly sent: number; readonly total: number }
  /** «не подтвердилось: 1 из 3»: part `part` has an unknown outcome; it holds nothing — the person checks the chat. */
  | { readonly s: 'stopped'; readonly sent: number; readonly total: number; readonly part: number }
  | { readonly s: 'greeted'; readonly at: IsoTimestamp | null }
  /** The archive contains an incoming message: continue the conversation instead of a first greeting. */
  | { readonly s: 'replied' };

export const GREETING_STATUSES = ['none', 'sending-other', 'sending', 'stopped', 'greeted', 'replied'] as const satisfies readonly GreetingStatusVM['s'][];

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
  /** CG-CLAIM-BUSY: the hub refused a send because a colleague's older client holds the fan (never named, H-7). */
  | { readonly s: 'other'; readonly error: CgErrorView }
  /** CG-CLAIM-EXPIRED: the hub refused a send under an expired lease. */
  | { readonly s: 'expired'; readonly error: CgErrorView }
  /** A part's outcome is unknown (CG-SEND-UNCERTAIN): said, holding nothing — «Не подтвердилось — откройте чат». */
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
  /** 1.15.0 (R20 P10a): the verdict of the background's pass, where a pass checks the list (`NewcomersVM.pass`). */
  readonly check?: NewcomerCheckVM;
  /** 1.32.0: the row in a batch of Hi (`SetBatchPick`, `GenerateBatch`); absent — the list has no batch. */
  readonly batch?: BatchRowVM;
  /** 1.34.0 (X59): the fan's picture as the site gives it (a list a pass checks); absent or null — the initial. */
  readonly avatarUrl?: string | null;
  /**
   * 1.34.0 (X59): the row's own «Отправить» of a batch's draft (a list a pass checks) — the card's send by one click
   * in the list (`SendNewcomerGreeting` with the row's handle); absent — the row has no draft to send.
   */
  readonly send?: NewcomerRowSendVM;
}

/** 1.34.0 (X59): «Отправить» in a row of «Новые» a pass checks. */
export interface NewcomerRowSendVM {
  /** The card's checks let the draft go now (a proven history, a fresh or own text, nothing running). */
  readonly can: boolean;
  /** The last click was refused and nothing went: why; null — it was not. */
  readonly refused: NewcomersFailureVM | null;
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
  /** 1.32.0: the batch of Hi over the list — ticked fans, how their generations go; absent — no batch here. */
  readonly batch?: BatchVM;
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
  /** 1.15.0 (R20 P10b2): the lowest known paid-DM price per message, USD mills; absent or null — unknown. */
  readonly dmPriceMills?: MoneyMills | null;
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
  /**
   * 1.15.0 (R20 P10b1): «Проверить следующим» (`next` — the queue runs: this fan goes first) or «Проверить чат» (`now`
   * — the queue stands: this fan alone is checked now), NF-038; null or absent — nothing left to check of this fan.
   */
  readonly checkNext?: 'next' | 'now' | null;
  /**
   * 1.15.0 (R20 P10b2): a fan nobody can write to (FS-NEW-2) — «Исключить из очереди» (`exclude`: out of «К
   * обработке») or «Вернуть в очередь» (`restore`), `ExcludeNewcomer`; the exclusion is kept in this browser and goes
   * once the fan's DMs open. Null or absent — the fan can be written to, or nothing is known yet.
   */
  readonly exclude?: 'exclude' | 'restore' | null;
  /**
   * 1.15.0 (R20 P10c): the greeting of a fan the pass checked (FS-NEW-3, FS-NEW-6, FS-NEW-7): the draft field, «Сгенерировать»,
   * «Отправить», «Открыть и вставить». Absent or null — no greeting for this fan (written to already, nobody can write).
   */
  readonly greeting?: NewcomerGreetingVM | null;
  /** 1.34.0 (X59): the fan's picture as the site gives it; absent or null — the initial. */
  readonly avatarUrl?: string | null;
  /**
   * 2026-10-21 (as the old Fansly window): the fan the person is on left the list on screen — a check found them written
   * to, or they no longer match the filter —; the card stays on them and says so instead of jumping. Absent — in the list.
   */
  readonly moved?: boolean;
}

/** 1.15.0 (R20 P10c): what the card's greeting is doing, or how its last click ended. */
export type NewcomerGreetingStateVM =
  | { readonly s: 'idle' }
  | { readonly s: 'generating' }
  | { readonly s: 'sending' }
  /** «Открыть и вставить» went: the person sends with the site's own button. */
  | { readonly s: 'inserted' }
  | { readonly s: 'sent'; readonly at: IsoTimestamp | null }
  /** Proven not sent: why (NF-024); a new click may try again unless the code says it never can. */
  | { readonly s: 'refused'; readonly failure: NewcomersFailureVM }
  /**
   * 2026-10-22 (as the old window): «Сгенерировать» made no draft — «Черновик не создан: {причина}. Повторите или напишите
   * сами». Nothing was sent; «Не отправлено» is a send's word only.
   */
  | { readonly s: 'not-drafted'; readonly failure: NewcomersFailureVM }
  /** It may have gone out: never repeated (CG-SEND-UNCERTAIN). */
  | { readonly s: 'uncertain'; readonly failure: NewcomersFailureVM };

export const NEWCOMER_GREETING_STATES = ['idle', 'generating', 'sending', 'inserted', 'sent', 'refused', 'not-drafted', 'uncertain'] as const satisfies readonly NewcomerGreetingStateVM['s'][];

/**
 * 1.15.0 (R20 P10c): the card's greeting (NF-012…NF-019, NF-028). The field is the draft (up to 5000 characters, kept per
 * creator and fan); «Отправить» sends the FIELD's content by one click (`SendNewcomerGreeting`), «Сгенерировать» writes
 * a Hi into it (`Generate` with the card's handle), «Открыть и вставить» puts it into the fan's chat for the person's own
 * send (`InsertNewcomerGreeting`). Edits are `SetPreviewDraft` with the card's handle.
 */
export interface NewcomerGreetingVM {
  readonly text: string;
  readonly maxChars: number;
  /** The field holds THIS generation's result unchanged: the «AI» mark (FS-NEW-6). */
  readonly ai: boolean;
  /** The verdict over that result (spec §3.5, FS-TAIL-8): its reason; null — fresh, or no AI text. */
  readonly mark: StaleReason | null;
  /** NF-018: the fan's history changed after the draft was written — «Проверка изменилась — подтвердите черновик». */
  readonly stale: boolean;
  /** The pass has not checked the history in full yet: the draft may be typed, nothing goes (the old «Отправка после проверки»). */
  readonly waiting: boolean;
  readonly canGenerate: boolean;
  readonly canSend: boolean;
  readonly canInsert: boolean;
  /** Why «Отправить» is off while the field has a text; null — it is not, or the field is empty. */
  readonly sendBlocked: NewcomersFailureVM | null;
  readonly state: NewcomerGreetingStateVM;
}

/** 1.15.0 (R20 P10b1): the queue's own buttons (NF-038): `SetNewcomersPassRunning`. */
export interface NewcomersPassRunVM {
  /** «Пауза»: the queue runs and may stop. */
  readonly pause: boolean;
  /** «Проверить оставшихся: N»: the queue stands with `remaining` fans left to check. */
  readonly resume: boolean;
  readonly remaining: number;
  /** A button's request is on its way: the buttons wait. */
  readonly busy: boolean;
}

export interface NewcomersPassVM {
  /** The background's pass identity: another period must reset the window's pagination guard. */
  readonly passId?: string | null;
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
  /** 1.15.0 (R20 P10b1): «Пауза» and «Проверить оставшихся» (NF-038); absent — none. */
  readonly run?: NewcomersPassRunVM;
}
