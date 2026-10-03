// Fix «Заменить мой черновик» and «Вернуть мой текст» (architecture.md §6.4
// «Fix», Б2, AI-022). The result waits for the explicit replace click: that
// click is the consent for the revision the Fix was made from, so it travels
// as a one-time confirmation on exactly that revision — no second dialog. A
// draft that changed during the generation voids it: ask again («Заменить /
// Добавить / Отмена»). After the replacement, for 30 s, «Вернуть мой текст»
// writes the person's text back with a CAS on the revision the replacement
// produced; a person who typed after the Fix gets a question, never a silent
// overwrite. The source text stays in the tab's memory only. Both writes go
// only into the operation's own chat.

import { type CgCode } from '@cg/contracts/errors';
import { type InsertIntent, type InsertReceipt } from '@cg/contracts/host';
import { type ChatRef, type DraftSnapshot, type HumanCause, type PartRef } from '@cg/contracts/ids';

import { buildOpenInsert, sameChat } from './intent';

export const FIX_RESTORE_WINDOW_MS = 30_000;

export interface FixSource {
  readonly revision: number;
  readonly digest: string;
  /** The person's text the Fix was made from (StartOp.draft.text); never leaves the tab. */
  readonly text: string;
}

export type FixStep =
  | { readonly kind: 'intent'; readonly intent: InsertIntent }
  /** The draft is not the one this step was meant for: ask the person (CG-DRAFT-CHANGED). */
  | { readonly kind: 'confirm'; readonly reason: 'draft-changed' }
  | { readonly kind: 'unavailable'; readonly code: CgCode };

export interface FixIds {
  readonly intentId: string;
  readonly confirmationId: string;
}

const sameRevision = (draft: DraftSnapshot, revision: number, digest: string): boolean => draft.revision === revision && draft.digest === digest;

export class FixSession {
  private replaced: { readonly revision: number; readonly digest: string; readonly until: number } | null = null;
  private restored = false;

  constructor(
    readonly opId: string,
    readonly part: PartRef,
    /** The operation's chat (`op.target.chat`). */
    readonly target: ChatRef,
    private readonly source: FixSource,
    /** No verified editor: «Заменить мой черновик» and «Вернуть мой текст» are off (§6.4). */
    private readonly editorObserved: boolean,
  ) {}

  /** «Заменить мой черновик»: the click is the consent for the source revision. */
  replace(current: DraftSnapshot, fixedText: string, ids: FixIds, cause: HumanCause, now: number): FixStep {
    if (!this.editorObserved) return { kind: 'unavailable', code: 'CG-HOST-NOT-READY' };
    if (this.replaced !== null) return { kind: 'unavailable', code: 'CG-INSERT-FAILED' };
    if (!sameChat(current.identity.chat, this.target)) return { kind: 'unavailable', code: 'CG-INSERT-CHAT-CHANGED' };
    if (!sameRevision(current, this.source.revision, this.source.digest)) return { kind: 'confirm', reason: 'draft-changed' };
    const built = buildOpenInsert({
      intentId: ids.intentId,
      operationId: this.opId,
      part: this.part,
      text: fixedText,
      mode: 'replace',
      target: this.target,
      draft: current,
      confirmationId: ids.confirmationId,
      cause,
      now,
    });
    return built.ok ? { kind: 'intent', intent: built.intent } : { kind: 'unavailable', code: built.code };
  }

  /** The host's answer to the replacement: an applied write opens the 30-second restore window. */
  onReplaced(receipt: InsertReceipt, now: number): void {
    if (receipt.state === 'applied') this.replaced = { revision: receipt.draftRevision, digest: receipt.draftDigest, until: now + FIX_RESTORE_WINDOW_MS };
  }

  /** «Вернуть мой текст» is shown until this moment; null — not available. */
  restoreUntil(now: number): number | null {
    if (this.replaced === null || this.restored || now >= this.replaced.until) return null;
    return this.replaced.until;
  }

  restoreExpired(now: number): boolean {
    return this.replaced !== null && !this.restored && now >= this.replaced.until;
  }

  get wasReplaced(): boolean {
    return this.replaced !== null;
  }

  /** «Вернуть мой текст»: CAS on the revision the replacement produced; our own text, so no consent. */
  restore(current: DraftSnapshot, intentId: string, cause: HumanCause, now: number): FixStep {
    if (this.replaced === null || this.restored) return { kind: 'unavailable', code: 'CG-INSERT-FAILED' };
    if (now >= this.replaced.until) return { kind: 'unavailable', code: 'CG-TIMEOUT' };
    if (!sameChat(current.identity.chat, this.target)) return { kind: 'unavailable', code: 'CG-INSERT-CHAT-CHANGED' };
    if (!sameRevision(current, this.replaced.revision, this.replaced.digest)) return { kind: 'confirm', reason: 'draft-changed' };
    const built = buildOpenInsert({ intentId, operationId: this.opId, part: this.part, text: this.source.text, mode: 'replace', target: this.target, draft: current, confirmationId: null, cause, now });
    return built.ok ? { kind: 'intent', intent: built.intent } : { kind: 'unavailable', code: built.code };
  }

  onRestored(receipt: InsertReceipt): void {
    if (receipt.state === 'applied') this.restored = true;
  }
}
