// Putting a part of a result into the composer (architecture.md §6.4, Б2,
// D-10; AI-022, AI-086, AI-087, AI-125, UI-018…UI-020, UI-022, UI-026). One
// click inserts one part of one finished operation into that operation's
// own chat — never into another chat, never by itself, never twice after an
// unknown outcome. The rules are R10's insert domain; this service runs
// them against the host: the isolated-side guard, the draft rule, the
// one-time consent bound to a draft revision, Fix's «Заменить мой черновик»
// and its 30-second «Вернуть мой текст», the receipt, and the telemetry
// report (`inserted` only for an applied write).
//
// The action token of every write is issued for the surface `dock`: the
// write goes into the open chat's composer whichever of our panels shows
// the part.

import { type CgCode, type CgErrorWire } from '@cg/contracts/errors';
import { type InsertIntent, type InsertReceipt } from '@cg/contracts/host';
import { type DraftSnapshot, type HumanCause, type PartRef } from '@cg/contracts/ids';
import { type UnavailableReasonId } from '@cg/contracts/vm';

import { type FanScript, languageGate, policyOf } from '../../domain/features';
import {
  ConfirmationBook,
  FixSession,
  buildOpenInsert,
  decideDraft,
  insertGuard,
  insertGuardEntry,
  insertIntentEntry,
  insertReceiptEntry,
  interpretInsertReceipt,
  type ConfirmChoice,
  type PendingConfirmation,
} from '../../domain/insert';
import { isUnparsedResult } from '../../domain/output';
import { type OpRecord } from './op-store';
import { type AiPorts, type RpcAnswer } from './ports';

export type PartPhase = 'idle' | 'pending' | 'done' | 'failed';

export interface PartState {
  readonly insert: PartPhase;
  readonly insertError: CgErrorWire | null;
}

const IDLE_PART: PartState = { insert: 'idle', insertError: null };

export type WriteOutcome =
  | { readonly kind: 'applied' }
  /** Б2: the person must answer first (ResultVM.confirm). */
  | { readonly kind: 'needs-confirm'; readonly confirmationId: string }
  | { readonly kind: 'canceled' }
  | { readonly kind: 'failed'; readonly error: CgErrorWire };

export interface FixView {
  /** The draft the Fix was made from; null — not known to this tab (the result came from another session). */
  readonly sourceDraft: string | null;
  readonly replaced: boolean;
  readonly restoreUntil: number | null;
  readonly restoreExpired: boolean;
}

/** Why a part can be copied but not inserted: the reason the button shows and the code a click answers with. */
export interface PartBlock {
  readonly reason: UnavailableReasonId;
  readonly code: CgCode;
}

export interface InsertContext {
  /** What the background and the settings say now, for the isolated-side guard. */
  readonly current: { readonly signInEpoch: number | null; readonly bindingRevision: number | null; readonly personaDefinitionId: string | null };
  /** Why nothing can be inserted at all right now (copy-only mode); null — inserting is possible. */
  readonly blocked: PartBlock | null;
  /** The host observes the composer's editor (capability `draftRead`): the full CAS is available. */
  readonly editorObserved: boolean;
  /** The script the fan writes in, read from the page only when a part needs it (the Coach's drafts, AI-087). */
  fanScript(): FanScript;
}

export interface InsertServiceDeps {
  readonly ports: AiPorts;
  record(opId: string): OpRecord | null;
  context(record: OpRecord): InsertContext;
  token(kind: 'insert', cause: HumanCause['kind']): Promise<RpcAnswer<HumanCause>>;
  /** Something a view shows changed. */
  changed(): void;
  /** Rebuild the views at this moment (the restore window closes). */
  wakeAt(at: number): void;
  /** An insert was applied (the Coach panel folds, AI-086). */
  inserted(record: OpRecord, part: PartRef): void;
}

interface PendingWrite {
  readonly opId: string;
  readonly part: PartRef;
  readonly text: string;
  readonly purpose: 'insert' | 'fix-replace' | 'fix-restore';
}

const keyOf = (opId: string, part: PartRef): string => `${opId}:${part.variant ?? '-'}:${part.index}`;
const failed = (code: CgCode): WriteOutcome => ({ kind: 'failed', error: { code } });

/** The text of one part of a finished result; null — no such part. */
export function partText(record: OpRecord, part: PartRef): string | null {
  const result = record.view.state === 'done' ? record.view.result : undefined;
  if (result === undefined) return null;
  switch (result.kind) {
    case 'parts':
      return part.variant === undefined ? (result.parts[part.index] ?? null) : null;
    case 'variants':
      return result.variants[part.variant ?? 0]?.[part.index] ?? null;
    case 'coach':
      return result.answer.drafts.find((draft) => draft.index === (part.variant ?? 0))?.parts[part.index] ?? null;
    case 'review':
    case 'recap':
      return null;
  }
}

export class InsertService {
  private readonly parts = new Map<string, PartState>();
  private readonly book: ConfirmationBook;
  private readonly writes = new Map<string, PendingWrite>();
  private readonly fixes = new Map<string, FixSession>();
  /** Insert intents by id: a human send is linked to its part by the intent the draft descends from (§6.6). */
  private readonly intents = new Map<string, { readonly opId: string; readonly part: PartRef }>();
  /** Hi: the variant the person started inserting. */
  private readonly variants = new Map<string, number>();

  constructor(private readonly deps: InsertServiceDeps) {
    this.book = new ConfirmationBook(
      () => deps.ports.ids.uuid(),
      () => deps.ports.clock.now(),
    );
  }

  // ── reads ────────────────────────────────────────────────────────────────

  partState(opId: string, part: PartRef): PartState {
    return this.parts.get(keyOf(opId, part)) ?? IDLE_PART;
  }

  confirmation(opId: string): PendingConfirmation | null {
    return this.book.pendingFor(opId);
  }

  /** Hi: the variant whose parts are being inserted; null — none chosen yet. */
  chosenVariant(opId: string): number | null {
    return this.variants.get(opId) ?? null;
  }

  fix(record: OpRecord): FixView {
    const session = this.fixes.get(record.view.opId);
    const now = this.deps.ports.clock.now();
    return {
      sourceDraft: record.memo.fixSource?.text ?? null,
      replaced: session?.wasReplaced ?? false,
      restoreUntil: session?.restoreUntil(now) ?? null,
      restoreExpired: session?.restoreExpired(now) ?? false,
    };
  }

  /** The operation and part a draft came from, by the intent the host names in a human send (§6.6). */
  intent(intentId: string): { readonly opId: string; readonly part: PartRef } | null {
    return this.intents.get(intentId) ?? null;
  }

  /** Why this part cannot be inserted while it can be copied (AI-087, UI-027, UI-032); null — it can. */
  blockOf(record: OpRecord, part: PartRef): PartBlock | null {
    const ctx = this.deps.context(record);
    if (ctx.blocked !== null) return ctx.blocked;
    const result = record.view.result;
    const text = partText(record, part);
    if (result === undefined || text === null || !policyOf(record.view.feature).insertable || isUnparsedResult(result)) return { reason: 'unparsed', code: 'CG-OUTPUT-UNUSABLE' };
    // AI-087: the Coach may propose the fan message in the chatter's language.
    const gate = record.view.feature === 'coach' ? languageGate(text, ctx.fanScript()) : null;
    return gate === null ? null : { reason: gate.reason, code: gate.code };
  }

  // ── commands ─────────────────────────────────────────────────────────────

  /** «Вставить»: one part into the operation's own chat. */
  async insertPart(opId: string, part: PartRef, cause: HumanCause['kind']): Promise<WriteOutcome> {
    const record = this.deps.record(opId);
    if (record === null) return failed('CG-CONTEXT-CHANGED');
    const text = partText(record, part);
    // Only a finished, fully parsed result has parts to insert (§7).
    if (text === null) return failed('CG-OUTPUT-UNUSABLE');
    const block = this.blockOf(record, part);
    if (block !== null) return failed(block.code);
    if (this.partState(opId, part).insert === 'pending') return failed('CG-INSERT-FAILED');
    const ready = await this.prepare(record, part);
    if (!ready.ok) return ready.outcome;
    const decision = decideDraft(ready.draft, { editorObserved: this.deps.context(record).editorObserved });
    if (decision.kind === 'confirm') return this.ask(record, part, text, 'insert', decision.reason, ready.draft, decision.formatLoss);
    return this.write(record, part, text, 'replace', ready.draft, null, cause, 'insert');
  }

  /** Fix «Заменить мой черновик»: the click is the consent for the revision the Fix was made from. */
  async replaceMyDraft(opId: string, index: number, cause: HumanCause['kind']): Promise<WriteOutcome> {
    const record = this.deps.record(opId);
    if (record === null || record.view.feature !== 'fix') return failed('CG-CONTEXT-CHANGED');
    const part: PartRef = { index };
    const text = partText(record, part);
    if (text === null) return failed('CG-OUTPUT-UNUSABLE');
    const block = this.blockOf(record, part);
    if (block !== null) return failed(block.code);
    const ctx = this.deps.context(record);
    const source = record.memo.fixSource;
    // Without the source revision or an observed editor there is no CAS to make: copy instead (§6.4).
    if (source === null || !ctx.editorObserved) return failed('CG-HOST-NOT-READY');
    if (this.partState(opId, part).insert === 'pending') return failed('CG-INSERT-FAILED');
    if (this.fixes.get(opId)?.wasReplaced === true) return failed('CG-INSERT-FAILED');
    const ready = await this.prepare(record, part);
    if (!ready.ok) return ready.outcome;
    // The draft changed during the generation: the consent is void, the person is asked again.
    if (ready.draft.revision !== source.revision || ready.draft.digest !== source.digest) return this.ask(record, part, text, 'fix-replace', 'draft-changed', ready.draft, false);
    const session = new FixSession(opId, part, record.view.target.chat, source, ctx.editorObserved);
    const token = await this.deps.token('insert', cause);
    if (!token.ok) return this.fail(record, part, token.error.code);
    const { ids, clock } = this.deps.ports;
    const step = session.replace(ready.draft, text, { intentId: ids.uuid(), confirmationId: ids.uuid() }, token.payload, clock.now());
    if (step.kind === 'unavailable') return this.fail(record, part, step.code);
    if (step.kind === 'confirm') return this.ask(record, part, text, 'fix-replace', 'draft-changed', ready.draft, false);
    this.fixes.set(opId, session);
    const receipt = await this.send(record, part, step.intent);
    session.onReplaced(receipt, clock.now());
    const until = session.restoreUntil(clock.now());
    if (until !== null) this.deps.wakeAt(until);
    return this.settle(record, part, receipt, { text, purpose: 'fix-replace' });
  }

  /** «Вернуть мой текст»: within 30 s, a CAS on the revision the replacement produced. */
  async restoreMyDraft(opId: string, cause: HumanCause['kind']): Promise<WriteOutcome> {
    const record = this.deps.record(opId);
    const session = this.fixes.get(opId);
    if (record === null || session === undefined) return failed('CG-CONTEXT-CHANGED');
    const part = session.part;
    const source = record.memo.fixSource;
    if (source === null) return failed('CG-CONTEXT-CHANGED');
    const ready = await this.prepare(record, part);
    if (!ready.ok) return ready.outcome;
    const token = await this.deps.token('insert', cause);
    if (!token.ok) return failed(token.error.code);
    const { ids, clock } = this.deps.ports;
    const step = session.restore(ready.draft, ids.uuid(), token.payload, clock.now());
    if (step.kind === 'unavailable') return failed(step.code);
    // The person typed after the Fix: a question, never a silent overwrite.
    if (step.kind === 'confirm') return this.ask(record, part, source.text, 'fix-restore', 'draft-changed', ready.draft, false);
    const receipt = await this.send(record, part, step.intent);
    session.onRestored(receipt);
    const outcome = interpretInsertReceipt(receipt);
    this.deps.changed();
    return outcome.kind === 'applied' ? { kind: 'applied' } : failed(outcome.kind === 'needs-confirm' ? 'CG-DRAFT-CHANGED' : outcome.code);
  }

  /** Б2: «Заменить / Добавить в конец / Отмена», valid only for the revision it was asked about. */
  async answerConfirm(confirmationId: string, choice: ConfirmChoice, cause: HumanCause['kind']): Promise<WriteOutcome> {
    const pending = this.writes.get(confirmationId);
    if (pending === undefined) return failed('CG-DRAFT-CHANGED');
    const record = this.deps.record(pending.opId);
    if (record === null) {
      this.writes.delete(confirmationId);
      return failed('CG-CONTEXT-CHANGED');
    }
    if (choice === 'cancel') {
      this.book.dropOp(pending.opId);
      this.writes.delete(confirmationId);
      this.deps.changed();
      return { kind: 'canceled' };
    }
    const ready = await this.prepare(record, pending.part);
    if (!ready.ok) {
      this.book.dropOp(pending.opId);
      this.writes.delete(confirmationId);
      return ready.outcome;
    }
    const answer = this.book.answer(confirmationId, choice, ready.draft);
    this.writes.delete(confirmationId);
    switch (answer.kind) {
      case 'unknown':
        return failed('CG-DRAFT-CHANGED');
      case 'canceled':
        this.deps.changed();
        return { kind: 'canceled' };
      case 'chat-changed':
        return this.fail(record, pending.part, answer.code);
      case 'ask-again':
        // The draft moved again since the question: the new question is about the revision it has now.
        this.writes.set(answer.confirmation.confirmationId, pending);
        this.deps.changed();
        return { kind: 'needs-confirm', confirmationId: answer.confirmation.confirmationId };
      case 'insert':
        return this.write(record, pending.part, pending.text, answer.mode, ready.draft, answer.confirmation.confirmationId, cause, pending.purpose);
    }
  }

  /** The operation went away (a persona or sign-in change): its questions, Fix state and part marks are void. */
  dropOp(opId: string): void {
    this.book.dropOp(opId);
    this.fixes.delete(opId);
    this.variants.delete(opId);
    for (const [id, write] of this.writes) if (write.opId === opId) this.writes.delete(id);
    for (const [id, origin] of this.intents) if (origin.opId === opId) this.intents.delete(id);
    for (const key of [...this.parts.keys()]) if (key.startsWith(`${opId}:`)) this.parts.delete(key);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The isolated-side checks of §6.4 п. 1, then the draft as the host holds it now. */
  private async prepare(record: OpRecord, part: PartRef): Promise<{ readonly ok: true; readonly draft: DraftSnapshot } | { readonly ok: false; readonly outcome: WriteOutcome }> {
    const { host, journal } = this.deps.ports;
    const snapshot = host.current();
    const ctx = this.deps.context(record);
    const code = insertGuard({
      op: { target: record.view.target, personaDefinitionId: record.memo.personaDefinitionId ?? ctx.current.personaDefinitionId ?? '', signInEpoch: record.view.target.binding.loginEpoch },
      current: ctx.current,
      host: { route: snapshot.route, composer: snapshot.composer, identity: snapshot.identity },
    });
    if (code !== null || snapshot.identity === null) {
      journal?.write(insertGuardEntry(record.view.opId, code ?? 'CG-HOST-NOT-READY', snapshot.route.epoch));
      return { ok: false, outcome: this.fail(record, part, code ?? 'CG-HOST-NOT-READY') };
    }
    try {
      return { ok: true, draft: await host.readDraft(snapshot.identity) };
    } catch {
      return { ok: false, outcome: this.fail(record, part, 'CG-HOST-NOT-READY') };
    }
  }

  private ask(record: OpRecord, part: PartRef, text: string, purpose: PendingWrite['purpose'], kind: 'human-draft' | 'draft-changed', draft: DraftSnapshot, formatLoss: boolean): WriteOutcome {
    const noEditor = !this.deps.context(record).editorObserved;
    const confirmation = this.book.ask({ opId: record.view.opId, part, target: record.view.target.chat, kind, draft, formatLoss: formatLoss || noEditor });
    if (confirmation === null) return this.fail(record, part, 'CG-INSERT-CHAT-CHANGED');
    for (const [id, write] of this.writes) if (write.opId === record.view.opId) this.writes.delete(id);
    this.writes.set(confirmation.confirmationId, { opId: record.view.opId, part, text, purpose });
    this.deps.changed();
    return { kind: 'needs-confirm', confirmationId: confirmation.confirmationId };
  }

  private async write(
    record: OpRecord,
    part: PartRef,
    text: string,
    mode: 'replace' | 'append',
    draft: DraftSnapshot,
    confirmationId: string | null,
    cause: HumanCause['kind'],
    purpose: PendingWrite['purpose'],
  ): Promise<WriteOutcome> {
    const token = await this.deps.token('insert', cause);
    if (!token.ok) return this.fail(record, part, token.error.code);
    const { ids, clock } = this.deps.ports;
    const built = buildOpenInsert({ intentId: ids.uuid(), operationId: record.view.opId, part, text, mode, target: record.view.target.chat, draft, confirmationId, cause: token.payload, now: clock.now() });
    if (!built.ok) return this.fail(record, part, built.code);
    const receipt = await this.send(record, part, built.intent);
    if (purpose === 'fix-restore') {
      this.fixes.get(record.view.opId)?.onRestored(receipt);
      const outcome = interpretInsertReceipt(receipt);
      this.deps.changed();
      return outcome.kind === 'applied' ? { kind: 'applied' } : failed(outcome.kind === 'needs-confirm' ? 'CG-DRAFT-CHANGED' : outcome.code);
    }
    if (purpose === 'fix-replace') {
      const source = record.memo.fixSource;
      if (source !== null && mode === 'replace') {
        const session = this.fixes.get(record.view.opId) ?? new FixSession(record.view.opId, part, record.view.target.chat, source, true);
        this.fixes.set(record.view.opId, session);
        session.onReplaced(receipt, clock.now());
        const until = session.restoreUntil(clock.now());
        if (until !== null) this.deps.wakeAt(until);
      }
    }
    return this.settle(record, part, receipt, { text, purpose });
  }

  /** One host write: the part shows «вставляю…» while it runs; the receipt is journaled and reported. */
  private async send(record: OpRecord, part: PartRef, intent: InsertIntent): Promise<InsertReceipt> {
    const { host, journal, rpc } = this.deps.ports;
    const key = keyOf(record.view.opId, part);
    this.intents.set(intent.intentId, { opId: record.view.opId, part });
    this.parts.set(key, { insert: 'pending', insertError: null });
    this.deps.changed();
    journal?.write(insertIntentEntry(intent));
    let receipt: InsertReceipt;
    try {
      receipt = await host.insert(intent);
    } catch {
      // The call was lost after it may have run: the outcome is unknown, never repeated by itself.
      receipt = { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' };
    }
    journal?.write(insertReceiptEntry(intent, receipt));
    // Telemetry `inserted` is the background's to decide: only an applied receipt counts.
    void rpc.request('op.reportInsert', { opId: record.view.opId, part, receipt });
    return receipt;
  }

  private async settle(record: OpRecord, part: PartRef, receipt: InsertReceipt, write: Pick<PendingWrite, 'text' | 'purpose'>): Promise<WriteOutcome> {
    const outcome = interpretInsertReceipt(receipt);
    switch (outcome.kind) {
      case 'applied': {
        this.parts.set(keyOf(record.view.opId, part), { insert: 'done', insertError: null });
        if (part.variant !== undefined && record.view.result?.kind === 'variants') this.variants.set(record.view.opId, part.variant);
        this.deps.changed();
        this.deps.inserted(record, part);
        const identity = this.deps.ports.host.current().identity;
        // The focus goes to the composer, the cursor to the end (UI-019); a host that cannot is not an error.
        if (identity !== null) void this.deps.ports.host.focusComposer(identity).catch(() => false);
        return { kind: 'applied' };
      }
      case 'needs-confirm': {
        // MAIN found another draft than the one the intent was built on (the person typed meanwhile):
        // nothing was written; the question is asked about the draft as it is now.
        this.parts.delete(keyOf(record.view.opId, part));
        const ready = await this.prepare(record, part);
        if (!ready.ok) return ready.outcome;
        return this.ask(record, part, write.text, write.purpose, outcome.reason, ready.draft, false);
      }
      case 'refused':
        return this.fail(record, part, outcome.code);
      case 'uncertain':
        // Never inserted again by itself: «Проверьте поле ввода».
        return this.fail(record, part, outcome.code);
    }
  }

  /** A failed write: the part shows its error under the text and the result stays open (UI-026). */
  private fail(record: OpRecord, part: PartRef, code: CgCode): WriteOutcome {
    this.parts.set(keyOf(record.view.opId, part), { insert: 'failed', insertError: { code } });
    this.deps.changed();
    return failed(code);
  }
}
