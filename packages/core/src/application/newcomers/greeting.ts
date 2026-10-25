// The greeting of a card of a «Новые» list a background pass checks (R20 P10c; docs/project-unite/architecture.md §8.6,
// §8.7, §9.4; spec FS-NEW-3, FS-NEW-6, FS-NEW-7; NF-012…NF-019, NF-023, NF-024, NF-028, NF-034, NF-036): the draft
// field, «Сгенерировать», «Отправить» and «Открыть и вставить» of the selected fan, over the source's greeting port
// (./source.ts) — the site keeps the draft, proves the history, sends and registers.
//
// - The field (NF-012) is the draft the site keeps per creator and fan; what the person types is written after a pause
//   (GREETING_DRAFT_DEBOUNCE_MS), never on every key, and at once before a send or an insert.
// - «Сгенерировать» (NF-013…NF-017): only for a fan whose history the pass read to its start (NF-014). The pass's proof
//   of that history is asked first; Hi has no message limit (the owner, 2026-10-21), so its count refuses nothing.
//   While it generates, the site reads the history again (2026-10-25): a colleague's greeting since stops it.
//   Then one Hi with one variant: the hub combines its history with confirmed pass texts
//   (X69); the start carries their ids, proof of the start and fan's avatar (NF-034, FX-018). The sign-in, the
//   binding and the persona are the same before and after (NF-016) — else the result is not taken; an empty, too long
//   or split result is unusable (NF-017, CG-OUTPUT-UNUSABLE). A usable one goes into the field: «AI» while unchanged.
// - «Отправить» (NF-019): one click, one attempt of the site's send; the FIELD's content goes (FS-NEW-6) on the history
//   revision the card shows (as the old window sent, 2026-10-22): an unchanged AI result as that generation (its
//   freshness mark remains advisory, X69), anything else — and an AI text the hub gave no generation for — as the
//   person's own text. A history that changed since the draft is a note, not a hold; only a change between the click and
//   the send refuses (the site's own re-check). Nothing is repeated by itself; an unknown outcome says so with
//   «Открыть чат» and lets the person «Отправить ещё раз» by their own click («как раньше», the owner 2026-10-20); every
//   refusal says why (NF-024); one action at a time per fan (NF-023).
// - «Открыть и вставить»: the fan's chat opens in this tab with the field's text (one navigation, its deferred
//   insert); when the person sends it with the site's own button and the tab links that send to our insert, the site
//   registers it — the fan is greeted for everyone (FS-NEW-3).
// It names no site.

import { isCgCode, type CgCode } from '@cg/contracts/errors';
import { type HostEvent, type HostPort, type NavigationReceipt } from '@cg/contracts/host';
import { LIVE_TEXT_LIMITS, SEND_LIMITS } from '@cg/contracts/limits';
import { OP_TERMINAL_STATES, type GreetingDraftGeneration, type OpView, type StaleReason, type StartOp } from '@cg/contracts/ops';
import { type ActionReceipt, type I18n, type NewcomerGreetingStateVM, type NewcomerGreetingVM, type NewcomersFailureVM, type UiAction } from '@cg/contracts/vm';

import { buildDeferredInsert, buildOpenAndInsert } from '../../domain/insert/intent';
import { FIXED_WINDOWS } from '../../domain/ops/request';
import { type PassRow } from '../../domain/newcomers/pass';
import { noteBatchOp, type BatchOutcome } from '../boards/batch';
import { type PageContextPort } from '../boards/context';
import { issueCause } from '../boards/navigate';
import { type BoardsClock, type TabRpc } from '../boards/ports';
import { type Surfaces } from '../boards/shared';
import { done, refused } from '../boards/surface';
import { localError } from '../boards/views';
import { type PassAdmission, type PassDraft, type PassGreetingSource, type PassSendOutcome } from './source';

/** What the person types is written this long after the last key. */
export const GREETING_DRAFT_DEBOUNCE_MS = 400;
const MAX_CHARS = SEND_LIMITS.previewDraftMaxChars;
/** Insert intents of the card kept for the person's own send at once (the newest). */
const INSERTS_KEPT = 16;
/** A generation whose end the tab never heard (its port went meanwhile) stops waiting after this. */
export const GREETING_GENERATION_WAIT_MS = 180_000;
/** A result that came before the history read again waits this long for it (2026-10-25); then it goes into the field. */
export const GREETING_RECHECK_WAIT_MS = 6_000;

export interface PassGreetingDeps {
  readonly rpc: TabRpc;
  readonly host: HostPort;
  readonly ids: { uuid(): string };
  /** The site's verdict over a finished generation (spec §3.5): the mark's reason, or null — fresh. */
  verdict(view: OpView): StaleReason | null;
}

interface Card {
  readonly passId: string;
  readonly fanRef: string;
  loaded: 'no' | 'loading' | 'yes' | 'failed';
  /** The draft's read under way for the card on screen or a reminder's Hi: they share it. */
  reading: Promise<boolean> | null;
  /** The draft as the site holds it. */
  stored: PassDraft | null;
  /** The field. */
  text: string;
  /** Typed and not written yet. */
  dirty: boolean;
  timer: number | null;
  writing: Promise<void> | null;
  gen: GreetingDraftGeneration | null;
  state: NewcomerGreetingStateVM;
  /** NF-023: a generation, a send or an insert is under way. */
  busy: boolean;
}

interface Inserted {
  readonly card: Card;
  readonly hostAccountId: string;
  readonly conversationRef: string;
  readonly text: string;
  readonly admission: PassAdmission;
}

export interface CardGreeting {
  /** The greeting of the card of `row`; null — none for this fan (written to already, nobody can write). */
  vm(passId: string, row: PassRow): NewcomerGreetingVM | null;
  /** The card is on screen: its draft is read once. */
  open(passId: string, fanRef: string): void;
  /**
   * 2026-10-25, «Hi» of a greeting reminder: true once the card may take its Hi — the draft read (the read under way, or
   * one more when none was made or the last failed), nothing of the fan under way, nothing gone out. A draft that cannot
   * be read: false, and the card says why («Черновик не создан: …»).
   */
  ready(passId: string, fanRef: string): Promise<boolean>;
  /** The port returned: read durable drafts and attempts again. */
  refresh(): void;
  /** An action of the card; null — not the greeting's. */
  dispatch(action: UiAction, passId: string, row: PassRow): Promise<ActionReceipt> | null;
  /**
   * 1.32.0: one fan of a batch — «Сгенерировать» of the fan's card, open or not, with the card's own checks; resolves
   * when the generation ended. A field that holds the person's own text is never written over: that fan is skipped.
   */
  batchStart(passId: string, row: PassRow): Promise<BatchOutcome>;
  /** The card's field as it is now, and whether it went out; null — no card of the fan. */
  batchLive(passId: string, fanRef: string): { readonly text: string | null; readonly sent: boolean } | null;
  /** A batch started this generation (its end is said by its row), or a Hi whose chat was being read again: no toast. */
  fromBatch(opId: string): boolean;
  /** A card's own «Сгенерировать» (or the toast's Hi) started this generation: its result is the card's field. */
  fromCard(opId: string): boolean;
  /** X59: where the fan's greeting stands (a send of «Отправить готовые» ended how); null — no card of the fan yet. */
  stateOf(passId: string, fanRef: string): NewcomerGreetingStateVM | null;
  /** 2026-10-22: the site's kept attempts of the pass's fans, for the list's word before a card is opened. */
  known(passId: string, outcomes: readonly { readonly fanRef: string; readonly outcome: PassSendOutcome }[]): void;
  /** Another pass, sign-in or account: everything of the old one goes. */
  reset(): void;
  dispose(): void;
}

export interface CardGreetingDeps {
  readonly greeting: PassGreetingDeps;
  readonly source: PassGreetingSource;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly context: PageContextPort;
  readonly surfaces: Surfaces;
  readonly changed: () => void;
}

/** The card may be written to: a fan the pass has not found written to, nor closed. */
const greets = (row: PassRow): boolean => row.check !== 'greeted' && row.check !== 'dm-closed' && row.check !== 'excluded';
/** The pass read the fan's history to its start: a greeting may be generated and sent. */
const proven = (row: PassRow): boolean => (row.check === 'ready' || row.check === 'reply') && row.conversationRef !== null && (row.historyRevision ?? null) !== null;
/** NF-017: an empty, too long or split result is no greeting. */
const usable = (text: string): boolean => text.trim() !== '' && text.length <= MAX_CHARS && !/\[(VARIANT|NEXT)\]/.test(text);

export function createCardGreeting(deps: CardGreetingDeps): CardGreeting {
  const { source, i18n, clock, context, surfaces, changed } = deps;
  const { rpc, host, ids } = deps.greeting;
  const cards = new Map<string, Card>();
  const inserts = new Map<string, Inserted>();
  /** Generations waiting for their end, by operation; null — it never came. */
  const waiting = new Map<string, (view: OpView | null) => void>();
  const ended = new Map<string, OpView>();
  const batchOps = new Set<string>();
  const cardOps = new Set<string>();
  const offs: (() => void)[] = [];
  let generation = 0;
  let disposed = false;

  const keyOf = (passId: string, fanRef: string): string => `${passId}|${fanRef}`;
  const failure = (code: string, retryAt: number | null = null): NewcomersFailureVM => ({ code, retryAt });
  const said = (card: Card, state: NewcomerGreetingStateVM): void => {
    card.state = state;
    changed();
  };

  function cardOf(passId: string, fanRef: string): Card {
    const key = keyOf(passId, fanRef);
    let card = cards.get(key);
    if (card === undefined) {
      card = { passId, fanRef, loaded: 'no', reading: null, stored: null, text: '', dirty: false, timer: null, writing: null, gen: null, state: { s: 'idle' }, busy: false };
      cards.set(key, card);
    }
    return card;
  }

  // ── the draft (NF-012) ──

  function restore(card: Card, draft: PassDraft): void {
    card.stored = draft;
    if (!card.dirty) {
      card.text = draft.text;
      card.gen = draft.generation ?? null;
    } else if (card.gen === null) card.gen = draft.generation ?? null;
    const state = draft.outcome === undefined ? null : stateOfOutcome(draft.outcome);
    if (state !== null) card.state = state;
  }

  /** Where a kept attempt leaves the card: gone out, unknown (also one still under way: never sent again by itself), refused. */
  function stateOfOutcome(outcome: PassSendOutcome): NewcomerGreetingStateVM {
    if (outcome.s === 'sent') return { s: 'sent', at: new Date(clock.now()).toISOString() };
    if (outcome.s === 'uncertain' || outcome.s === 'pending') return { s: 'uncertain', failure: failure(outcome.s === 'pending' ? 'CG-SEND-UNCERTAIN' : outcome.code) };
    return { s: 'refused', failure: failure(outcome.code) };
  }

  /**
   * 2026-10-22 (the old window's «Нужно проверить» in the list): the site's kept attempts of the pass's fans, read when
   * the pass opens — a fan whose card was not opened yet gets its word in the list at once. A card that read its own
   * draft knows better, and a click under way is not overwritten.
   */
  function known(passId: string, outcomes: readonly { readonly fanRef: string; readonly outcome: PassSendOutcome }[]): void {
    let moved = false;
    for (const { fanRef, outcome } of outcomes) {
      if (outcome.s === 'refused') continue;
      const card = cardOf(passId, fanRef);
      if (card.loaded === 'yes' || card.busy || card.state.s !== 'idle') continue;
      card.state = stateOfOutcome(outcome);
      moved = true;
    }
    if (moved) changed();
  }

  async function read(card: Card): Promise<boolean> {
    const at = generation;
    try {
      const answer = await source.draft(card.passId, card.fanRef);
      if (at !== generation || disposed) return false;
      card.loaded = answer.ok ? 'yes' : 'failed';
      if (answer.ok) restore(card, answer.value);
      changed();
      return answer.ok;
    } catch {
      if (at === generation) card.loaded = 'failed';
      return false;
    }
  }

  /** Reads the card's draft; a read under way (the card on screen, a reminder's Hi) is joined, never made twice. */
  function load(card: Card): Promise<boolean> {
    if (card.reading !== null) return card.reading;
    card.loaded = 'loading';
    const reading = read(card).finally(() => {
      if (card.reading === reading) card.reading = null;
    });
    card.reading = reading;
    return reading;
  }

  function open(passId: string, fanRef: string): void {
    const card = cardOf(passId, fanRef);
    if (card.loaded === 'no') void load(card);
  }

  /**
   * 2026-10-25: a reminder's Hi on a card the window opened again shows only now — its draft is read first (a Hi into
   * a card still reading it was refused and wrote nothing). A draft that cannot be read is said on the card, unless it
   * shows a click under way or an attempt of its own.
   */
  async function ready(passId: string, fanRef: string): Promise<boolean> {
    const card = cardOf(passId, fanRef);
    const at = generation;
    if (card.loaded !== 'yes') await load(card);
    if (at !== generation || disposed) return false;
    if (card.loaded !== 'yes') {
      if (!card.busy && card.state.s !== 'sent' && card.state.s !== 'uncertain') said(card, { s: 'not-drafted', failure: failure('CG-RUNTIME-UNREACHABLE') });
      return false;
    }
    return !card.busy && card.state.s !== 'sent';
  }

  /** Writes the field now; a write that failed leaves the field as it is (the next one carries it). */
  function flush(card: Card): Promise<void> {
    if (card.timer !== null) clock.clearTimer(card.timer);
    card.timer = null;
    if (!card.dirty) return card.writing ?? Promise.resolve();
    const text = card.text;
    const gen = card.gen;
    const link = gen !== null && text.trim() === gen.text.trim() && gen.opId !== card.stored?.generation?.opId ? { opId: gen.opId, historyRevision: gen.historyRevision } : undefined;
    card.dirty = false;
    const at = generation;
    const previous = card.writing ?? Promise.resolve();
    const write = previous.then(() =>
      source.draft(card.passId, card.fanRef, text, link).then(
        (answer) => {
          if (at !== generation) return;
          if (answer.ok) {
            card.stored = answer.value;
            if (card.gen === gen) card.gen = answer.value.generation ?? null;
          }
          else {
            card.dirty = card.dirty || card.text === text;
            said(card, { s: 'refused', failure: answer.failure });
          }
        },
        () => {
          if (at === generation) card.dirty = true;
        },
      ),
    );
    card.writing = write.finally(() => {
      if (card.writing === settled) card.writing = null;
    });
    const settled = card.writing;
    return settled;
  }

  function setDraft(card: Card, text: string): void {
    card.text = text.slice(0, MAX_CHARS);
    card.dirty = true;
    // A new text is a new decision: the last refusal (or a draft that was not made) is the old text's.
    if (card.state.s === 'refused' || card.state.s === 'not-drafted' || card.state.s === 'inserted') card.state = { s: 'idle' };
    if (card.timer !== null) clock.clearTimer(card.timer);
    card.timer = clock.setTimer(GREETING_DRAFT_DEBOUNCE_MS, () => {
      card.timer = null;
      void flush(card);
    });
    changed();
  }

  // ── what the field is (FS-NEW-6) ──

  /** The field holds THIS generation's result unchanged. */
  const unchanged = (card: Card): boolean => card.gen !== null && card.text.trim() === card.gen.text.trim();

  function admissionOf(card: Card): PassAdmission {
    const gen = card.gen;
    if (gen === null || gen.generationRef === null) return { kind: 'own' };
    return { kind: unchanged(card) ? 'ai' : 'ai-edited', generationRef: gen.generationRef, variant: 0 };
  }

  /** The mark over an unchanged AI text: its own verdict (FS-TAIL-8); null — fresh, or not an AI text. */
  const markOf = (card: Card): StaleReason | null => (card.gen !== null && unchanged(card) ? card.gen.mark : null);

  /**
   * Why «Отправить» or «Открыть и вставить» may not take the field now; null — it may. Only a history the pass has not
   * read to its start holds the field (the old «Отправка после проверки»). An AI text with no generation of the hub's
   * goes as the person's own, and a history that changed since the draft is the card's note (`stale`), never a hold
   * (2026-10-22): the person sees the chat and clicks.
   */
  function blockedOf(card: Card, row: PassRow): NewcomersFailureVM | null {
    if (card.text.trim() === '') return null;
    if (!proven(row)) return failure('CG-FNEW-UNVERIFIED');
    return null;
  }

  function vm(passId: string, row: PassRow): NewcomerGreetingVM | null {
    if (!greets(row)) return null;
    const card = cardOf(passId, row.fanRef);
    const sendBlocked = blockedOf(card, row);
    const filled = card.text.trim() !== '';
    // Gone out: never again from this card. An unknown outcome holds nothing — «Отправить ещё раз» is the person's click.
    const final = card.state.s === 'sent';
    return {
      text: card.text,
      maxChars: MAX_CHARS,
      ai: card.gen !== null && unchanged(card),
      mark: markOf(card),
      stale: filled && card.stored !== null && card.stored.historyRevision !== null && (row.historyRevision ?? null) !== null && card.stored.historyRevision !== row.historyRevision,
      waiting: !proven(row),
      canGenerate: card.loaded === 'yes' && proven(row) && !card.busy && !final,
      canSend: card.loaded === 'yes' && filled && !card.busy && !final && sendBlocked === null && proven(row),
      canInsert: card.loaded === 'yes' && filled && !card.busy && !final && proven(row),
      sendBlocked: filled ? sendBlocked : null,
      state: card.state,
    };
  }

  // ── «Сгенерировать» (NF-013…NF-017) ──

  offs.push(
    rpc.onEvent('op.done', ({ view }) => {
      if (view.surface === 'newcomers' && view.feature === 'hi') ended.set(view.opId, view);
      const resolve = waiting.get(view.opId);
      if (resolve === undefined) return;
      waiting.delete(view.opId);
      resolve(view);
    }),
  );

  async function generate(type: UiAction['type'], card: Card, row: PassRow): Promise<ActionReceipt> {
    const ctx = context.current();
    const binding = ctx.binding;
    const bootstrap = ctx.bootstrap;
    if (ctx.phase !== 'ready' || binding === null || bootstrap === null) return refused(type, localError('CG-HUB-UNAVAILABLE', i18n));
    if (!proven(row) || row.conversationRef === null) return refused(type, localError('CG-DATA-NOT-READY', i18n));
    const at = generation;
    const epoch = ctx.epoch;
    const persona = ctx.persona?.key ?? null;
    /**
     * NF-016: the same sign-in, binding and persona as at the click — else nothing of it is taken. The persona is its
     * key: an owner's edit of it (a new definition) is the same persona.
     */
    const same = (): boolean => !disposed && at === generation && context.current().epoch === epoch && (context.current().persona?.key ?? null) === persona;
    card.busy = true;
    said(card, { s: 'generating' });
    // No draft came of it: «Черновик не создан: …» (the old window), never «Не отправлено» — nothing was sent.
    const stop = (code: string): ActionReceipt => {
      card.busy = false;
      said(card, { s: 'not-drafted', failure: failure(code) });
      return refused(type, localError(isShared(code) ? code : 'CG-DATA-UNAVAILABLE', i18n));
    };
    const proof = await source.proof(card.passId, card.fanRef);
    if (!same()) return stop('CG-CONTEXT-CHANGED');
    if (!proof.ok) return stop(proof.failure.code);
    const evidence = proof.value;
    // 2026-10-25 (the owner: «если один нажал на hi и там месага уже есть — чтобы генерация стопнулась»): the fan's
    // history is read again alongside — a colleague's greeting since the pass checked it stops this Hi (`CG-SEND-PART`).
    // Not for a batch: its sends check the history anyway, and the batch would read every chat twice.
    // A result that came first waits for that read (GREETING_RECHECK_WAIT_MS at most) before it goes into the field, and
    // its end makes no «AI готово» toast meanwhile: a Hi stopped this way is no result to open.
    const watch: { greeted: boolean; read: boolean; opId: string | null; stop: (() => void) | null } = { greeted: false, read: false, opId: null, stop: null };
    const checking =
      type === 'GenerateBatch' || source.recheck === undefined
        ? null
        : source
            .recheck(card.passId, card.fanRef)
            .then(
              (answer) => {
                if (answer.ok || answer.failure.code !== 'CG-SEND-PART') return;
                watch.greeted = true;
                watch.stop?.();
              },
              () => undefined,
            )
            .finally(() => {
              watch.read = true;
              if (!watch.greeted && watch.opId !== null) batchOps.delete(watch.opId);
            });
    const fanLabel = (row.displayName ?? row.username)?.trim().slice(0, 256) || null;
    const issued = await issueCause(rpc, 'generate', 'newcomers');
    if (!same()) return stop('CG-CONTEXT-CHANGED');
    if (!issued.ok) return stop(issued.code);
    const textItems = Math.min(LIVE_TEXT_LIMITS.maxItems, bootstrap.limits.freshTextMaxItems);
    const textChars = Math.min(LIVE_TEXT_LIMITS.maxChars, bootstrap.limits.freshTextMaxChars);
    const tail = textItems > 0 && textChars > 0 ? evidence.tail?.slice(-textItems).map((message) => ({ ...message, text: message.text.slice(0, textChars) })) : undefined;
    const start: StartOp = {
      feature: 'hi',
      surface: 'newcomers',
      // The conversation is the group the pass resolved, never the fan's id (FS-IDN-6).
      target: { binding, chat: { host: binding.host, hostAccountId: binding.hostAccountId, platformFanId: card.fanRef }, fanRef: card.fanRef, conversationRef: evidence.conversationRef },
      cause: issued.cause,
      tone: null,
      split: false,
      window: Math.min(FIXED_WINDOWS.hi, bootstrap.limits.deepMax),
      variantCount: 1,
      // Every deliberate click asks for a new result, as Reply's «Ещё раз» does.
      force: true,
      ...(card.gen === null ? {} : { regenerateOf: card.gen.opId }),
      // FS-NEW-7, X69: the same checked history the card shows supplies both ids and live text.
      proof: {
        kind: 'pass',
        conversationRef: evidence.conversationRef,
        completeness: 'complete',
        takenAt: evidence.capturedAt ?? new Date(clock.now()).toISOString(),
        ...(tail === undefined ? {} : { tail }),
        window: [...evidence.window],
        knownFanMessageIds: [...evidence.knownFanMessageIds],
        deletedIds: [],
      },
      startProof: evidence.startProof,
      personalMessageCount: evidence.startProof.personalCount,
      ...(evidence.fanAvatarUrl === null ? {} : { fanAvatarUrl: evidence.fanAvatarUrl }),
      // 2026-10-26: the names and «about» the pass read — the hub has not met a new follower yet.
      ...(evidence.fanAccount === undefined ? {} : { fanAccount: evidence.fanAccount }),
      // 1.20.0 (X47): the name the pass already read, for «Идут сейчас» — display only, never sent to the hub.
      ...(fanLabel === null ? {} : { fanLabel }),
    };
    if (watch.greeted) return stop('CG-SEND-PART');
    const admission = await rpc.request('op.start', start);
    if (!same()) return stop('CG-CONTEXT-CHANGED');
    if (!admission.ok) return stop(admission.error.code);
    if (!admission.payload.ok) return stop(admission.payload.code);
    const opId = admission.payload.opId;
    noteBatchOp(type === 'GenerateBatch' ? batchOps : cardOps, opId);
    // While the chat is read again its end makes no toast either: the window may be gone by then (a Hi stopped this way).
    if (type !== 'GenerateBatch' && checking !== null && !watch.read) noteBatchOp(batchOps, opId);
    watch.opId = opId;
    const greetedMeanwhile = (): ActionReceipt => {
      void rpc.request('op.cancel', { opId }).catch(() => undefined);
      return stop('CG-SEND-PART');
    };
    if (watch.greeted) return greetedMeanwhile();
    const view = await new Promise<OpView | null>((resolve) => {
      const timer = clock.setTimer(GREETING_GENERATION_WAIT_MS, () => {
        if (waiting.get(opId) !== undefined) waiting.delete(opId);
        resolve(null);
      });
      waiting.set(opId, (ended) => {
        clock.clearTimer(timer);
        resolve(ended);
      });
      const finish = (view: OpView): void => {
        const settle = waiting.get(opId);
        if (settle === undefined) return;
        waiting.delete(opId);
        settle(view);
      };
      // The history says somebody wrote meanwhile: nothing more is waited for.
      watch.stop = () => {
        const settle = waiting.get(opId);
        if (settle === undefined) return;
        waiting.delete(opId);
        settle(null);
      };
      const known = ended.get(opId);
      if (known !== undefined) finish(known);
      else {
        // A cached/reopened operation emits no new op.done. Install the listener BEFORE this read, closing both races.
        void rpc.request('op.list', { scope: 'all' }).then((answer) => {
          if (!answer.ok || at !== generation || disposed) return;
          const known = answer.payload.ops.find((view) => view.opId === opId);
          if (known !== undefined && (OP_TERMINAL_STATES as readonly string[]).includes(known.state)) finish(known);
        }).catch(() => undefined);
      }
    });
    watch.stop = null;
    if (checking !== null && !watch.greeted) {
      await new Promise<void>((resolve) => {
        const timer = clock.setTimer(GREETING_RECHECK_WAIT_MS, resolve);
        void checking.then(() => {
          clock.clearTimer(timer);
          resolve();
        });
      });
    }
    if (!same()) return stop('CG-CONTEXT-CHANGED');
    if (watch.greeted) return greetedMeanwhile();
    if (view === null) return stop('CG-OP-INTERRUPTED');
    if (view.state !== 'done') return stop(view.error?.code ?? 'CG-OP-INTERRUPTED');
    const parts = view.result?.kind === 'variants' ? view.result.variants[0] : undefined;
    const text = parts?.length === 1 ? (parts[0] ?? '') : '';
    if (!usable(text)) return stop('CG-OUTPUT-UNUSABLE');
    card.gen = { opId, generationRef: view.generationRef ?? null, text: text.trim(), historyRevision: evidence.historyRevision, mark: deps.greeting.verdict(view) };
    card.text = text.trim();
    card.dirty = true;
    card.busy = false;
    said(card, { s: 'idle' });
    await flush(card);
    return done(type, 'started', { opId });
  }

  // ── «Отправить» (NF-019) ──

  async function send(type: UiAction['type'], card: Card, row: PassRow): Promise<ActionReceipt> {
    const account = context.current().account?.hostAccountId ?? null;
    const blocked = blockedOf(card, row);
    if (card.text.trim() === '' || account === null || row.conversationRef === null || (row.historyRevision ?? null) === null) return refused(type, localError('CG-DATA-NOT-READY', i18n));
    if (blocked !== null) {
      said(card, { s: 'refused', failure: blocked });
      return refused(type, localError(isShared(blocked.code) ? blocked.code : 'CG-DATA-UNAVAILABLE', i18n));
    }
    const at = generation;
    const clickedText = card.text;
    card.busy = true;
    said(card, { s: 'sending' });
    const stop = (code: string, uncertain = false, retryAt: number | null = null): ActionReceipt => {
      card.busy = false;
      said(card, code === 'CG-SEND-PART' ? { s: 'sent', at: new Date(clock.now()).toISOString() } : uncertain || code === 'CG-SEND-UNCERTAIN' ? { s: 'uncertain', failure: failure(code) } : { s: 'refused', failure: failure(code, retryAt) });
      return refused(type, localError(isShared(code) ? code : 'CG-DATA-UNAVAILABLE', i18n));
    };
    // The field as it goes is the field as stored: its revision is the one the send's final check compares (FS-NEW-6).
    await flush(card);
    if (!await read(card)) return stop('CG-RUNTIME-UNREACHABLE');
    if (at !== generation || disposed) return stop('CG-CONTEXT-CHANGED');
    if (card.state.s === 'sent') {
      card.busy = false;
      return refused(type, localError('CG-SEND-PART', i18n));
    }
    if (card.text !== clickedText) return stop('CG-DRAFT-CHANGED');
    const currentBlock = blockedOf(card, row);
    if (currentBlock !== null) return stop(currentBlock.code);
    const text = card.text.trim();
    if (card.dirty || card.stored === null || card.stored.text.trim() !== text) return stop('CG-DRAFT-CHANGED');
    const issued = await issueCause(rpc, 'send', 'newcomers');
    if (at !== generation || disposed) return stop('CG-CONTEXT-CHANGED');
    if (!issued.ok) return stop(issued.code);
    const admission = admissionOf(card);
    const gen = card.gen;
    let answer: Awaited<ReturnType<PassGreetingSource['send']>>;
    try {
      answer = await source.send({
        attemptId: ids.uuid(),
        passId: card.passId,
        hostAccountId: account,
        fanRef: card.fanRef,
        conversationRef: row.conversationRef,
        text,
        draftRevision: card.stored.revision,
        // The history the card shows, whatever the field holds (as the old window sent): the site re-checks it at the send.
        historyRevision: row.historyRevision as string,
        admission,
        cause: issued.cause,
        ...(admission.kind === 'ai' && gen !== null ? { opId: gen.opId } : {}),
      });
    } catch {
      return stop('CG-SEND-UNCERTAIN', true);
    }
    if (at !== generation || disposed) return refused(type, localError('CG-CONTEXT-CHANGED', i18n));
    // A cooldown of Fansly's refuses at once with its end: the card says how long to wait.
    if (!answer.ok) return stop(answer.failure.code, answer.failure.code === 'CG-RUNTIME-UNREACHABLE' || answer.failure.code === 'CG-RUNTIME-RELOADED' || answer.failure.code === 'CG-TIMEOUT', answer.failure.retryAt);
    const outcome = answer.value;
    card.busy = false;
    if (outcome.s === 'sent') {
      said(card, { s: 'sent', at: new Date(clock.now()).toISOString() });
      return done(type, 'done');
    }
    if (outcome.s === 'uncertain') return stop(outcome.code, true);
    if (outcome.s === 'refused') return stop(outcome.code);
    // Still under way (the site stopped waiting): it is never sent again from here.
    said(card, { s: 'uncertain', failure: failure('CG-SEND-UNCERTAIN') });
    return done(type, 'started');
  }

  // ── «Открыть и вставить» (FS-NEW-3) ──

  async function insert(type: UiAction['type'], card: Card, row: PassRow): Promise<ActionReceipt> {
    const ctx = context.current();
    const account = ctx.account?.hostAccountId ?? null;
    const identity = host.current().identity;
    if (card.text.trim() === '' || account === null || row.conversationRef === null || !proven(row)) return refused(type, localError('CG-DATA-NOT-READY', i18n));
    if (identity === null) return refused(type, localError('CG-HOST-NOT-READY', i18n));
    const at = generation;
    const clickedText = card.text;
    card.busy = true;
    changed();
    const stop = (code: CgCode): ActionReceipt => {
      card.busy = false;
      said(card, { s: 'refused', failure: failure(code) });
      return refused(type, localError(code, i18n));
    };
    await flush(card);
    if (!await read(card)) return stop('CG-RUNTIME-UNREACHABLE');
    if (at !== generation || disposed) return stop('CG-CONTEXT-CHANGED');
    if (card.state.s === 'sent') {
      card.busy = false;
      return refused(type, localError('CG-SEND-PART', i18n));
    }
    if (card.text !== clickedText || card.dirty) return stop('CG-DRAFT-CHANGED');
    const issued = await issueCause(rpc, 'navigate', 'newcomers');
    if (at !== generation || disposed) return stop('CG-CONTEXT-CHANGED');
    if (!issued.ok) return stop(issued.code);
    const text = card.text.trim();
    const binding = ctx.binding;
    if (binding === null) return stop('CG-HUB-UNAVAILABLE');
    const chat = { host: binding.host, hostAccountId: account, platformFanId: card.fanRef };
    const now = clock.now();
    const timeoutMs = (ctx.bootstrap?.limits.navInsertTimeoutSec ?? 20) * 1000;
    // The insert names an operation of its own: the card's text is no part of a result the tab could report (P7f).
    const deferred = buildDeferredInsert({ intentId: ids.uuid(), operationId: ids.uuid(), part: { variant: 0, index: 0 }, target: chat, text, documentEpoch: identity.documentEpoch, now, timeoutMs });
    if (!deferred.ok) return stop(deferred.code);
    const navigation = buildOpenAndInsert({ intentId: ids.uuid(), cause: issued.cause, insert: deferred.intent, conversationRef: row.conversationRef });
    if (!navigation.ok) return stop(navigation.code);
    inserts.set(deferred.intent.intentId, { card, hostAccountId: account, conversationRef: row.conversationRef, text, admission: admissionOf(card) });
    if (inserts.size > INSERTS_KEPT) inserts.delete(inserts.keys().next().value ?? '');
    const receipt = await host.navigate(navigation.intent).catch((): NavigationReceipt => ({ state: 'failed', code: 'CG-NAV-FAILED', insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } }));
    card.busy = false;
    if (receipt.insert === null || receipt.insert.state === 'rejected') inserts.delete(deferred.intent.intentId);
    if (receipt.state !== 'navigated') return stop(receipt.state === 'failed' ? receipt.code : 'CG-NAV-FAILED');
    said(card, { s: 'inserted' });
    // The chat is open behind the window: the window gets out of the way (as a board does, SP-035).
    surfaces.setList('newcomers', false);
    return done(type, 'opened');
  }

  /** The person's own send of an inserted card text, linked by the tab to our insert (P7f): the site registers it. */
  function heard(event: HostEvent): void {
    if (event.type !== 'humanSend') return;
    const { draft, platformMessageId, chat } = event.fact;
    if (platformMessageId === null || draft.insertIntentId === null) return;
    const origin = inserts.get(draft.insertIntentId);
    // Linked by our insert's id, and in the chat of that fan (never by the text).
    if (origin === undefined || chat.platformFanId !== origin.card.fanRef || chat.hostAccountId !== origin.hostAccountId) return;
    inserts.delete(draft.insertIntentId);
    // Edited in the site's own field after the insert: the person's text, not the generation's.
    const admission: PassAdmission = draft.editedSinceInsert === false || origin.admission.kind === 'own' ? origin.admission : { ...origin.admission, kind: 'ai-edited' };
    const { card } = origin;
    void source
      .sent({ passId: card.passId, hostAccountId: origin.hostAccountId, fanRef: card.fanRef, conversationRef: origin.conversationRef, platformMessageId, text: origin.text, admission })
      .then((answer) => {
        if (answer.ok && answer.value) said(card, { s: 'sent', at: new Date(clock.now()).toISOString() });
      })
      .catch(() => undefined);
  }

  const offHost = host.subscribe(heard);

  function reset(): void {
    generation += 1;
    for (const card of cards.values()) if (card.timer !== null) clock.clearTimer(card.timer);
    cards.clear();
    // Our inserts stay: a send the person makes after the window closed is still theirs to register.
    for (const resolve of [...waiting.values()]) resolve(null);
    waiting.clear();
    ended.clear();
  }

  async function batchStart(passId: string, row: PassRow): Promise<BatchOutcome> {
    const card = cardOf(passId, row.fanRef);
    if (card.loaded !== 'yes') {
      card.loaded = 'loading';
      if (!(await read(card))) return { s: 'failed', code: 'CG-RUNTIME-UNREACHABLE' };
    }
    if (card.busy) return { s: 'failed', code: 'CG-SEND-BUSY' };
    if (card.state.s === 'sent' || card.state.s === 'uncertain') return { s: 'failed', code: card.state.s === 'sent' ? 'CG-SEND-PART' : 'CG-SEND-UNCERTAIN' };
    if (!greets(row)) return { s: 'failed', code: row.check === 'greeted' ? 'CG-SEND-PART' : 'CG-DATA-NOT-READY' };
    if (!proven(row)) return { s: 'failed', code: 'CG-FNEW-UNVERIFIED' };
    // The person's own text in the field is theirs: a batch never writes over it.
    if (card.text.trim() !== '' && !unchanged(card)) return { s: 'failed', code: 'CG-DRAFT-CHANGED' };
    const receipt = await generate('GenerateBatch', card, row);
    if (receipt.ok) return { s: 'ready', text: card.text.trim() === '' ? null : card.text };
    const code = card.state.s === 'not-drafted' || card.state.s === 'refused' ? card.state.failure.code : receipt.code;
    if (code === 'CG-OP-TAB-LIMIT') return { s: 'busy' };
    // No token: the click's grant is spent, or the window is no longer on screen.
    if (code === 'CG-UI-FAILED') return { s: 'spent', code };
    return { s: 'failed', code };
  }

  return {
    vm,
    open,
    ready,
    batchStart,
    batchLive(passId, fanRef) {
      const card = cards.get(keyOf(passId, fanRef));
      return card === undefined ? null : { text: card.text.trim() === '' ? null : card.text, sent: card.state.s === 'sent' };
    },
    fromBatch: (opId) => batchOps.has(opId),
    fromCard: (opId) => cardOps.has(opId),
    stateOf: (passId, fanRef) => cards.get(keyOf(passId, fanRef))?.state ?? null,
    known,
    refresh() {
      for (const card of cards.values()) {
        card.loaded = 'loading';
        void read(card);
      }
    },
    dispatch(action, passId, row) {
      const card = cardOf(passId, row.fanRef);
      const type = action.type;
      if (action.type === 'SetPreviewDraft') {
        if (!greets(row)) return Promise.resolve(refused(type, localError('CG-SEND-PART', i18n)));
        setDraft(card, action.text);
        return Promise.resolve(done(type));
      }
      if (action.type !== 'Generate' && action.type !== 'SendNewcomerGreeting' && action.type !== 'InsertNewcomerGreeting') return null;
      if (action.type === 'Generate' && action.feature !== 'hi') return Promise.resolve(refused(type, localError('CG-FEATURE-DISABLED', i18n)));
      if (card.loaded !== 'yes') return Promise.resolve(refused(type, localError('CG-DATA-NOT-READY', i18n)));
      // NF-023: one action of a fan at a time.
      if (card.busy) return Promise.resolve(refused(type, localError('CG-SEND-BUSY', i18n)));
      // Gone out: never again from this card (FS-NEW-3). An unknown outcome is the person's to judge: their own click goes.
      if (card.state.s === 'sent') return Promise.resolve(refused(type, localError('CG-SEND-PART', i18n)));
      if (!greets(row)) return Promise.resolve(refused(type, localError(row.check === 'greeted' ? 'CG-SEND-PART' : 'CG-DATA-NOT-READY', i18n)));
      if (action.type === 'Generate') return generate(type, card, row);
      if (action.type === 'SendNewcomerGreeting') return send(type, card, row);
      return insert(type, card, row);
    },
    reset,
    dispose() {
      disposed = true;
      reset();
      offHost();
      for (const off of offs.splice(0)) off();
      inserts.clear();
    },
  };
}

/** A code of the shared registry renders as its own card in a shared receipt; a site's own reads «данные недоступны» there. */
const isShared = (code: string): code is CgCode => isCgCode(code);
