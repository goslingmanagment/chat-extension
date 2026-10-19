// «Новые» on Fansly as pure rules (R20 P10a; docs/project-unite/architecture.md §8.7, §8.17; FS-NEW-1; NF-003,
// NF-005, NF-006, NF-009…NF-011): the window's periods as the old extension had them, the list's pages and the
// conversation's cap, and what the background's pass says (tab-messages-fansly.ts `fansly.followers.*`) in the neutral
// words of a pass (domain/newcomers/pass.ts) — the verdict of a row, its failure, the messages, the way into its chat.

import { type CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import { FANSLY_TAB_LIMITS, type FanslyFollowerRow, type FanslyPassView, type FanslyPreviewMessage } from '@cg/contracts/tab-messages-fansly';
import { type NewcomerCheck, type NewcomerMessageVM, type NewcomersFailureVM } from '@cg/contracts/vm';

import { type PassChange, type PassRow, type PassState } from '../../../newcomers/pass';

/** The periods of the old window (NF-003: 1–720 hours, 48 by default): 1, 3, 6, 12, 24, 48, 72 hours, 7, 14 and 30 days. */
export const FANSLY_NEWCOMERS_WINDOWS = {
  options: [1, 3, 6, 12, 24, 48, 72, 168, 336, 720],
  initial: FANSLY_TAB_LIMITS.windowHoursDefault,
  min: FANSLY_TAB_LIMITS.windowHoursMin,
  max: FANSLY_TAB_LIMITS.windowHoursMax,
} as const;

/** Rows of one page of the list (NF-006: pages of 100, as the hub's list); one read takes at most 500. */
export const FANSLY_NEWCOMERS_PAGE = 100;
export const FANSLY_NEWCOMERS_READ_MAX = FANSLY_TAB_LIMITS.followerRowsPerRead;

/** A conversation is read 250 messages at a time, up to 750 in the card (NF-010, as the old window). */
export const FANSLY_NEWCOMERS_HISTORY = { page: FANSLY_TAB_LIMITS.historyMessagesPerRead, cap: 750 } as const;

/**
 * The verdict of a row (NF-005). `ready` without a full read of the chat is not «nobody wrote» — it is
 * «not checked» (the old window's fail-closed rule); `ready` where the fan wrote first is «Ждёт ответа».
 */
export function checkOf(row: Pick<FanslyFollowerRow, 'status' | 'historyRevision' | 'fanWrote'>): NewcomerCheck {
  if (row.status !== 'ready') return row.status;
  if (row.historyRevision === null) return 'unverified';
  return row.fanWrote === true ? 'reply' : 'ready';
}

export function failureOf(error: CgAnyErrorWire): NewcomersFailureVM {
  return { code: error.code, retryAt: error.retryAt ?? null };
}

export function messageOf(message: FanslyPreviewMessage): NewcomerMessageVM {
  return { id: message.messageId, fromFan: message.fromFan, at: message.at, text: message.text, automated: message.automated, attachments: message.attachments };
}

export function passRowOf(row: FanslyFollowerRow): PassRow {
  return {
    fanRef: row.fanRef,
    // The group: never the fan's id (FS-IDN-6).
    conversationRef: row.groupId,
    username: row.username,
    displayName: row.displayName,
    customName: row.customName ?? null,
    bio: row.bio ?? null,
    followedAt: row.followedAt,
    check: checkOf(row),
    dmClosed: row.dmClosed,
    dmPriceMills: row.dmPriceMills ?? null,
    checkedAt: row.checkedAt,
    proof: row.proof === undefined || row.proof === null ? null : messageOf(row.proof),
    failure: row.error === undefined || row.error === null ? null : failureOf(row.error),
    historyRevision: row.historyRevision,
    avatarUrl: row.avatarUrl ?? null,
  };
}

export function passStateOf(pass: FanslyPassView): PassState {
  return {
    passId: pass.passId,
    hostAccountId: pass.hostAccountId,
    windowHours: pass.windowHours,
    state: pass.state,
    phase: pass.phase ?? null,
    startedAt: pass.startedAt,
    total: pass.counts.total,
    checked: pass.counts.checked,
    partial: pass.partial,
    cooldownUntil: pass.cooldownUntil,
    failure: pass.error === null ? null : failureOf(pass.error),
  };
}

export function passChangeOf(change: { readonly pass: FanslyPassView; readonly seq: number; readonly rows: readonly FanslyFollowerRow[] }): PassChange {
  return { pass: passStateOf(change.pass), seq: change.seq, rows: change.rows.map(passRowOf) };
}

/** The chat of a group on the page's own site: `/messages/<groupId>` (host-fansly isolated/route.ts). */
export function fanslyChatPath(groupId: string): string {
  return `/messages/${groupId}`;
}
