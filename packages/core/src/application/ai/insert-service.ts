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
// One write of an operation at a time: the mark is taken synchronously when
// the click arrives, before anything is awaited, so a double click or a key
// repeat is one write and one report — the second call answers `busy`.
//
// The action token of every write is issued for the surface `dock`: the
// write goes into the open chat's composer whichever of our panels shows
// the part.

import { type CgCode, type CgErrorWire } from '@cg/contracts/errors';
import { type InsertIntent, type InsertReceipt } from '@cg/contracts/host';
import { type DraftSnapshot, type HumanCause, type PartRef } from '@cg/contracts/ids';
import { type ReasonVM, type UnavailableReasonId } from '@cg/contracts/vm';

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
  /** A write of this operation is already on its way: this click changes nothing. */
  | { readonly kind: 'busy' }
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
  /** The reason as the button says it, when the plain text of `reason` is not the whole story (an owner switch: the hub's own reason picks the words). */
  readonly view?: ReasonVM;
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
  /** Why this very part is not inserted now, beyond the chat's own state (a board's result in the dock: a sent part, a held fan, §6.5); null — nothing. */
  hold?(record: OpRecord, part: PartRef): PartBlock | null;
  /**
   * The same question asked at the person's click, right before a write, of whoever knows more than this tab
   * last heard (a board's result in the dock: the journal of the fan's sends is read now — another tab may hold
   * the fan since). null — nothing holds the part.
   */
  recheck?(record: OpRecord, part: PartRef): Promise<PartBlock | null>;
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
  /** Fix: the session of a replacement and the text «Вернуть мой текст» writes back (what the replacement replaced). */
  private readonly fixes = new Map<string, { readonly session: FixSession; readonly restoreText: string }>();
  /**
   * Fix after «Вернуть мой текст»: the field holds the person's text again, at the revision that write produced.
   * The next «Заменить мой черновик» is a consent for exactly that draft.
   */
  private readonly restoredSources = new Map<string, { readonly text: string; readonly revision: number; readonly digest: string }>();
  /** Operations with a write in flight. */
  private readonly busy = new Set<string>();
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
    const session = this.fixes.get(record.view.opId)?.session;
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
    const hold = this.deps.hold?.(record, part) ?? null;
    if (hold !== null) return hold;
    const result = record.view.result;
    const text = partText(record, part);
    if (result === undefined || text === null || !policyOf(record.view.feature).insertable || isUnparsedResult(result)) return { reason: 'unparsed', code: 'CG-OUTPUT-UNUSABLE' };
    // AI-087: the Coach may propose the fan message in the chatter's language.
    const gate = record.view.feature === 'coach' ? languageGate(text, ctx.fanScript()) : null;
    return gate === null ? null : { reason: gate.reason, code: gate.code };
  }

  // ── commands ─────────────────────────────────────────────────────────────

  /** Runs one write of an operation; a second one arriving meanwhile is `busy` and touches nothing. */
  private async exclusive(opId: string, run: () => Promise<WriteOutcome>): Promise<WriteOutcome> {
    if (this.busy.has(opId)) return { kind: 'busy' };
    this.busy.add(opId);
    try {
      return await run();
    } finally {
      this.busy.delete(opId);
    }
  }

  /** «Вставить»: one part into the operation's own chat. */
  insertPart(opId: string, part: PartRef, cause: HumanCause['kind']): Promise<WriteOutcome> {
    return this.exclusive(opId, () => this.runInsertPart(opId, part, cause));
  }

  private async runInsertPart(opId: string, part: PartRef, cause: HumanCause['kind']): Promise<WriteOutcome> {
    const record = this.deps.record(opId);
    if (record === null) return failed('CG-CONTEXT-CHANGED');
    const text = partText(record, part);
    // Only a finished, fully parsed result has parts to insert (§7).
    if (text === null) return failed('CG-OUTPUT-UNUSABLE');
    const block = this.blockOf(record, part) ?? (await this.heldNow(record, part));
    if (block !== null) return failed(block.code);
    const ready = await this.prepare(record, part);
    if (!ready.ok) return ready.outcome;
    const decision = decideDraft(ready.draft, { editorObserved: this.deps.context(record).editorObserved });
    if (decision.kind === 'confirm') return this.ask(record, part, text, 'insert', decision.reason, ready.draft, decision.formatLoss);
    return this.write(record, part, text, 'replace', ready.draft, null, cause, 'insert');
  }

  /** `recheck` of the deps: what holds the part by a look taken at this very click; the views hear what it found. */
  private async heldNow(record: OpRecord, part: PartRef): Promise<PartBlock | null> {
    if (this.deps.recheck === undefined) return null;
    const held = await this.deps.recheck(record, part);
    this.deps.changed();
    return held;
  }

  /**
   * §6.5: «Открыть и вставить» of a board put this part into the composer — in the dock that shows the rest of
   * the result it reads «вставлено», as a part inserted from here does. The write itself was the board's; a human
   * send of that draft is reported by whoever wrote it (the tab's host facts), so no intent is remembered here.
   */
  noteInserted(record: OpRecord, part: PartRef): void {
    this.parts.set(keyOf(record.view.opId, part), { insert: 'done', insertError: null });
    if (part.variant !== undefined && record.view.result?.kind === 'variants') this.variants.set(record.view.opId, part.variant);
    this.deps.changed();
  }

  /**
   * §6.5 п. 4: the chat a board opened holds the person's own text, so «Открыть и вставить» wrote nothing. The Б2
   * question about that part is asked here, in the chat's dock — and only asked: nothing is written until the
   * person answers, and their answer is a click of its own. `canceled` — the field needs no question any more
   * (the person emptied it meanwhile): «Вставить» is one click away. `failed` — it cannot be asked now; the part
   * is left as it is.
   */
  askAbout(opId: string, part: PartRef): Promise<WriteOutcome> {
    return this.exclusive(opId, async () => {
      const record = this.deps.record(opId);
      const text = record === null ? null : partText(record, part);
      if (record === null || text === null) return failed('CG-CONTEXT-CHANGED');
      const block = this.blockOf(record, part);
      if (block !== null) return failed(block.code);
      const ready = await this.prepare(record, part, false);
      if (!ready.ok) return ready.outcome;
      const decision = decideDraft(ready.draft, { editorObserved: this.deps.context(record).editorObserved });
      return decision.kind === 'confirm' ? this.ask(record, part, text, 'insert', decision.reason, ready.draft, decision.formatLoss) : { kind: 'canceled' };
    });
  }

  /** Fix «Заменить мой черновик»: the click is the consent for the revision the Fix was made from. */
  replaceMyDraft(opId: string, index: number, cause: HumanCause['kind']): Promise<WriteOutcome> {
    return this.exclusive(opId, () => this.runReplaceMyDraft(opId, index, cause));
  }

  private async runReplaceMyDraft(opId: string, index: number, cause: HumanCause['kind']): Promise<WriteOutcome> {
    const record = this.deps.record(opId);
    if (record === null || record.view.feature !== 'fix') return failed('CG-CONTEXT-CHANGED');
    const part: PartRef = { index };
    const text = partText(record, part);
    if (text === null) return failed('CG-OUTPUT-UNUSABLE');
    const block = this.blockOf(record, part);
    if (block !== null) return failed(block.code);
    const ctx = this.deps.context(record);
    const source = this.restoredSources.get(opId) ?? record.memo.fixSource;
    // Without the source revision or an observed editor there is no CAS to make: copy instead (§6.4).
    if (source === null || !ctx.editorObserved) return failed('CG-HOST-NOT-READY');
    if (this.fixes.get(opId)?.session.wasReplaced === true) return failed('CG-INSERT-FAILED');
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
    const receipt = await this.send(record, part, step.intent);
    this.replaced(session, source.text, receipt);
    return this.settle(record, part, receipt, { text, purpose: 'fix-replace' });
  }

  /** The host answered a Fix replacement: an applied one opens the restore window for the text it replaced. */
  private replaced(session: FixSession, restoreText: string, receipt: InsertReceipt): void {
    const { clock } = this.deps.ports;
    session.onReplaced(receipt, clock.now());
    if (!session.wasReplaced) return;
    this.fixes.set(session.opId, { session, restoreText });
    const until = session.restoreUntil(clock.now());
    if (until !== null) this.deps.wakeAt(until);
  }

  /** «Вернуть мой текст»: within 30 s, a CAS on the revision the replacement produced. */
  restoreMyDraft(opId: string, cause: HumanCause['kind']): Promise<WriteOutcome> {
    return this.exclusive(opId, () => this.runRestoreMyDraft(opId, cause));
  }

  private async runRestoreMyDraft(opId: string, cause: HumanCause['kind']): Promise<WriteOutcome> {
    const record = this.deps.record(opId);
    const fix = this.fixes.get(opId);
    if (record === null || fix === undefined) return failed('CG-CONTEXT-CHANGED');
    const { session, restoreText } = fix;
    const part = session.part;
    const ready = await this.prepare(record, part, false);
    if (!ready.ok) return ready.outcome;
    const token = await this.deps.token('insert', cause);
    if (!token.ok) return failed(token.error.code);
    const { ids, clock } = this.deps.ports;
    const step = session.restore(ready.draft, ids.uuid(), token.payload, clock.now());
    if (step.kind === 'unavailable') return failed(step.code);
    // The person typed after the Fix: a question, never a silent overwrite.
    if (step.kind === 'confirm') return this.ask(record, part, restoreText, 'fix-restore', 'draft-changed', ready.draft, false);
    return this.restored(record, part, await this.send(record, part, step.intent));
  }

  /** The host answered «Вернуть мой текст»: the person's text is back, or the Fix text stays where it was. */
  private restored(record: OpRecord, part: PartRef, receipt: InsertReceipt): WriteOutcome {
    const opId = record.view.opId;
    const key = keyOf(opId, part);
    const fix = this.fixes.get(opId);
    fix?.session.onRestored(receipt);
    const outcome = interpretInsertReceipt(receipt);
    // The part is no longer in the field once the person's text is back; otherwise it still is.
    if (outcome.kind === 'applied') {
      this.parts.delete(key);
      // The replacement is undone: the result is what it was before it — never «Черновик заменён» over a field
      // that holds the person's text. What it holds now is the draft a new replacement would be a consent for.
      this.fixes.delete(opId);
      if (fix !== undefined && receipt.state === 'applied') this.restoredSources.set(opId, { text: fix.restoreText, revision: receipt.draftRevision, digest: receipt.draftDigest });
    } else this.parts.set(key, { insert: 'done', insertError: null });
    this.deps.changed();
    return outcome.kind === 'applied' ? { kind: 'applied' } : failed(outcome.kind === 'needs-confirm' ? 'CG-DRAFT-CHANGED' : outcome.code);
  }

  /** Б2: «Заменить / Добавить в конец / Отмена», valid only for the revision it was asked about. */
  answerConfirm(confirmationId: string, choice: ConfirmChoice, cause: HumanCause['kind']): Promise<WriteOutcome> {
    const pending = this.writes.get(confirmationId);
    if (pending === undefined) return Promise.resolve(failed('CG-DRAFT-CHANGED'));
    return this.exclusive(pending.opId, () => this.runAnswerConfirm(confirmationId, pending, choice, cause));
  }

  private async runAnswerConfirm(confirmationId: string, pending: PendingWrite, choice: ConfirmChoice, cause: HumanCause['kind']): Promise<WriteOutcome> {
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
    // The answer is a write of its own: what holds the part is asked again now — the question may have stood for
    // minutes, and a part sent meanwhile, or a fan held by another tab, is not written over an old «да».
    const held = pending.purpose === 'insert' ? (this.blockOf(record, pending.part) ?? (await this.heldNow(record, pending.part))) : null;
    if (held !== null) {
      this.book.dropOp(pending.opId);
      this.writes.delete(confirmationId);
      this.deps.changed();
      return failed(held.code);
    }
    const ready = await this.prepare(record, pending.part, pending.purpose !== 'fix-restore');
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
    this.restoredSources.delete(opId);
    this.variants.delete(opId);
    for (const [id, write] of this.writes) if (write.opId === opId) this.writes.delete(id);
    for (const [id, origin] of this.intents) if (origin.opId === opId) this.intents.delete(id);
    for (const key of [...this.parts.keys()]) if (key.startsWith(`${opId}:`)) this.parts.delete(key);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The isolated-side checks of §6.4 п. 1, then the draft as the host holds it now. */
  private async prepare(record: OpRecord, part: PartRef, mark = true): Promise<{ readonly ok: true; readonly draft: DraftSnapshot } | { readonly ok: false; readonly outcome: WriteOutcome }> {
    const { host, journal } = this.deps.ports;
    const snapshot = host.current();
    const ctx = this.deps.context(record);
    // «Вернуть мой текст» that cannot run leaves the part as it is: the Fix text is still in the field.
    const fail = (code: CgCode): WriteOutcome => (mark ? this.fail(record, part, code) : failed(code));
    const code = insertGuard({
      // An operation whose persona this tab does not know is never taken for one of the current persona (§7 «Ограда»).
      op: { target: record.view.target, personaDefinitionId: record.memo.personaDefinitionId ?? '', signInEpoch: record.view.target.binding.loginEpoch },
      current: ctx.current,
      host: { route: snapshot.route, composer: snapshot.composer, identity: snapshot.identity },
    });
    if (code !== null || snapshot.identity === null) {
      journal?.write(insertGuardEntry(record.view.opId, code ?? 'CG-HOST-NOT-READY', snapshot.route.epoch));
      return { ok: false, outcome: fail(code ?? 'CG-HOST-NOT-READY') };
    }
    try {
      return { ok: true, draft: await host.readDraft(snapshot.identity) };
    } catch {
      return { ok: false, outcome: fail('CG-HOST-NOT-READY') };
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
    if (purpose === 'fix-restore') return this.restored(record, part, receipt);
    if (purpose === 'fix-replace' && mode === 'replace') {
      // The person agreed to replace the draft as it was at the answer — changed since the Fix was made:
      // «Вернуть мой текст» brings back that text, not the older one the Fix was made from.
      const replacedDraft = { text: draft.plainText, revision: draft.revision, digest: draft.digest };
      this.replaced(new FixSession(record.view.opId, part, record.view.target.chat, replacedDraft, true), draft.plainText, receipt);
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
