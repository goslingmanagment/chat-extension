// One-time consents of Б2 (architecture.md §6.4 п. 2–3): «Заменить /
// Добавить в конец / Отмена» is asked for one draft revision of one chat's
// composer and answered once. The answer is valid only for the revision it
// was asked about: a draft that changed meanwhile voids it and the question
// is asked again («черновик изменился», CG-DRAFT-CHANGED). MAIN checks the
// consent id again in the same synchronous step as the write and refuses a
// used one, so a replayed answer never writes twice. A question is bound to
// its operation's chat: a draft of another chat is never asked about, and an
// answer given while another chat is open voids the question
// (CG-INSERT-CHAT-CHANGED) instead of re-asking about that chat's draft.

import { type CgCode } from '@cg/contracts/errors';
import { type ChatRef, type DraftSnapshot, type PartRef } from '@cg/contracts/ids';

import { type ConfirmReason } from './draft-rule';
import { sameChat } from './intent';

export interface PendingConfirmation {
  readonly confirmationId: string;
  readonly opId: string;
  readonly part: PartRef;
  /** The operation's chat: the only chat this consent may ever write into. */
  readonly target: ChatRef;
  readonly kind: ConfirmReason;
  /** The draft the question is about: revision, document fingerprint and where it lives. */
  readonly draftRevision: number;
  readonly draftDigest: string;
  readonly composerInstanceId: string | null;
  readonly routeEpoch: number;
  readonly documentEpoch: string;
  /** No observed editor: an append goes through setText and loses formatting. */
  readonly formatLoss: boolean;
  readonly createdAt: number;
}

export type ConfirmChoice = 'replace' | 'append' | 'cancel';

export type ConfirmAnswer =
  /** Write with this consent on exactly this revision. */
  | { readonly kind: 'insert'; readonly mode: 'replace' | 'append'; readonly confirmation: PendingConfirmation }
  | { readonly kind: 'canceled' }
  /** The draft changed since the question: ask again about the current revision. */
  | { readonly kind: 'ask-again'; readonly confirmation: PendingConfirmation }
  /** The open chat is not the operation's: the question is void, nothing is written or asked. */
  | { readonly kind: 'chat-changed'; readonly code: Extract<CgCode, 'CG-INSERT-CHAT-CHANGED'> }
  /** Unknown or already answered: nothing happens. */
  | { readonly kind: 'unknown' };

export interface ConfirmationRequest {
  readonly opId: string;
  readonly part: PartRef;
  /** `op.target.chat`. */
  readonly target: ChatRef;
  readonly kind: ConfirmReason;
  readonly draft: DraftSnapshot;
  readonly formatLoss: boolean;
}

const sameDraft = (pending: PendingConfirmation, draft: DraftSnapshot): boolean =>
  pending.draftRevision === draft.revision &&
  pending.draftDigest === draft.digest &&
  pending.composerInstanceId === draft.identity.composerInstanceId &&
  pending.routeEpoch === draft.identity.routeEpoch &&
  pending.documentEpoch === draft.identity.documentEpoch;

/** Pending consents of one tab; at most one per operation (a new question replaces the old one). */
export class ConfirmationBook {
  private readonly pending = new Map<string, PendingConfirmation>();

  constructor(
    private readonly newId: () => string,
    private readonly now: () => number,
  ) {}

  /** A new question about `request.draft`; null — the draft is not of the operation's chat (nothing is asked). */
  ask(request: ConfirmationRequest): PendingConfirmation | null {
    for (const [id, existing] of this.pending) if (existing.opId === request.opId) this.pending.delete(id);
    if (!sameChat(request.draft.identity.chat, request.target)) return null;
    const confirmation: PendingConfirmation = {
      confirmationId: this.newId(),
      opId: request.opId,
      part: request.part,
      target: request.target,
      kind: request.kind,
      draftRevision: request.draft.revision,
      draftDigest: request.draft.digest,
      composerInstanceId: request.draft.identity.composerInstanceId,
      routeEpoch: request.draft.identity.routeEpoch,
      documentEpoch: request.draft.identity.documentEpoch,
      formatLoss: request.formatLoss,
      createdAt: this.now(),
    };
    this.pending.set(confirmation.confirmationId, confirmation);
    return confirmation;
  }

  /** The person's answer, checked against the draft as it is now. One answer per question. */
  answer(confirmationId: string, choice: ConfirmChoice, current: DraftSnapshot): ConfirmAnswer {
    const pending = this.pending.get(confirmationId);
    if (pending === undefined) return { kind: 'unknown' };
    this.pending.delete(confirmationId);
    if (choice === 'cancel') return { kind: 'canceled' };
    if (!sameChat(current.identity.chat, pending.target)) return { kind: 'chat-changed', code: 'CG-INSERT-CHAT-CHANGED' };
    if (!sameDraft(pending, current)) {
      const again = this.ask({ opId: pending.opId, part: pending.part, target: pending.target, kind: 'draft-changed', draft: current, formatLoss: pending.formatLoss });
      return again === null ? { kind: 'chat-changed', code: 'CG-INSERT-CHAT-CHANGED' } : { kind: 'ask-again', confirmation: again };
    }
    return { kind: 'insert', mode: choice, confirmation: pending };
  }

  pendingFor(opId: string): PendingConfirmation | null {
    for (const confirmation of this.pending.values()) if (confirmation.opId === opId) return confirmation;
    return null;
  }

  /** The operation went away (canceled, persona or sign-in change): its question is void. */
  dropOp(opId: string): void {
    for (const [id, existing] of this.pending) if (existing.opId === opId) this.pending.delete(id);
  }

  clear(): void {
    this.pending.clear();
  }
}
