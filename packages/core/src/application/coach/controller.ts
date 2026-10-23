// The Coach controller (architecture.md §10.2 CoachVM, §7 «ход Coach с
// авто-рекапом — один составной слот», §9.4; AI-080…AI-100, NEW-02;
// ui-design §4.19, §10). Coach is a dialog with the AI about the open chat's
// fan: the question goes with the last exchanges as history, the answer is
// advice plus up to two ready drafts, each split into parts that insert like
// any other part. It reads the hub archive only — never fresh page text; the
// one thing it takes from the page is the person's own draft, when they ask
// to attach it, for that one turn.
//
// A turn may first build a recap (auto-recap, once per session). It is still
// one turn and one start: the click's one token admits both steps in the
// background (`StartOp.coach.autoRecap`), the chat's slot is held from the
// first to the last, and the controller only follows — the recap step, then
// the answer step its terminal view names (`OpView.continuedBy`). Nothing is
// started from an event. Sessions live in this tab's memory (five, fifty
// exchanges, two mebibytes) and are wiped by a change of persona or sign-in.
//
// Review is a turn of the dialog too (1.51.0, the owner's «интегрировать
// ревью внутрь коача как фичу»): the «Review» chip by the ready questions, its
// key and the palette run the page's `review` — the same hub feature, flag,
// gates and quota — as the next turn, whose answer is the Review's card. It is
// replayed as history like any exchange, as «Review» and the Review in text,
// so the next question can be about it. A page whose Coach is off but whose
// Review is on opens the window with the «Review» chip alone.
//
// Actions: `Generate { feature: 'coach', options: {} }` opens the panel and
// generates nothing; with `question` or `preset` it asks. `Generate { feature:
// 'review' }` opens the panel when it is closed and runs a Review as the next
// turn — over a dialog that holds one already, a new rating past the cache;
// `Regenerate` of a Review («Ещё раз» of its turn) rates anew as the next turn.
// `NewCoachDialog` (the UI confirms first), `RefreshArchive` («Обновить
// переписку»: the archive head is read again and the lag behind the chat is
// shown).

import { type CgErrorWire, type I18nKey } from '@cg/contracts/errors';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { RECAP_OFF_CAPABILITY, chatKeyOf, type ChatKey } from '@cg/contracts/ids';
import { COVERAGE_LEVELS, type COACH_BLOCK_KINDS, type CoverageLevel, type ReviewDoc } from '@cg/contracts/ops';
import {
  type ActionButtonVM,
  type ActionReceipt,
  type CoachHintGroupVM,
  type CoachRecapVM,
  type CoachReviewVM,
  type CoachTurnVM,
  type CoachVM,
  type ReasonVM,
  type ReviewItemVM,
  type ReviewSectionVM,
  type UiAction,
  type UiActionOf,
  type UserOptions,
  type VmView,
} from '@cg/contracts/vm';

import {
  CoachSessions,
  autoRecapAhead,
  autoRecapFor,
  clampHistoryLimit,
  exchangesOf,
  historyFor,
  outsideMemory,
  recapStepVerdict,
  replayableOf,
  type CoachExchange,
  type CoachFailedTurn,
  type CoachPendingTurn,
  type CoachReviewTurn,
  type CoachSession,
  type CoachSessionKey,
} from '../../domain/coach';
import { featureGate, windowFor } from '../../domain/features';
import { flagRefusal, flagStateOf, flagUsable, isTerminalOpState } from '../../domain/ops';
import { COACH_SECTION_LABELS, coachAnswerText, reviewHistoryText, reviewRawText, reviewTags, splitLabelledSections, streamPreview } from '../../domain/output';
import { analysisMark, type ArchivePoint } from '../../domain/recap';
import { artifactHandle } from '../ai/handles';
import { type OpRecord, type OpStoreEvent } from '../ai/op-store';
import { confirmVm, partVms } from '../ai/result-vm';
import { createSurface, done, refused, type ActionHandlers, type AiController, type CauseKind } from '../ai/surface';
import { button, debugVm, errorActions, errorVm, featureHotkey, msg, phaseVm, views } from '../ai/view-models';
import { isOwnSurface, type AiWorkspace, type ReadyTarget, type Situation } from '../ai/workspace';
import { flagReasonVm } from '../flag-reason';

type CoachBlockKind = (typeof COACH_BLOCK_KINDS)[number];

const BLOCK_TITLES: Readonly<Record<CoachBlockKind, I18nKey>> = {
  situation: 'coach.block.situation',
  missed: 'coach.block.missed',
  move: 'coach.block.move',
  risk: 'coach.block.risk',
};

/** AI-081: the ready questions of an empty dialog that ask at once; the first is the hub's «разбор ситуации» preset. */
const OPENING_CHIPS: readonly { readonly key: I18nKey; readonly preset: 'situation' | null }[] = [
  { key: 'coach.chip.situation', preset: 'situation' },
  { key: 'coach.chip.offer', preset: null },
];
/** AI-081: the ready questions of an empty dialog that fill the input — three headings, three questions each. */
const HINT_GROUPS: readonly { readonly label: I18nKey; readonly questions: readonly I18nKey[] }[] = [
  { label: 'coach.group.sell', questions: ['coach.hint.sell.how', 'coach.hint.sell.price', 'coach.hint.sell.discount'] },
  { label: 'coach.group.return', questions: ['coach.hint.return.revive', 'coach.hint.return.seen', 'coach.hint.return.afterPrice'] },
  { label: 'coach.group.understand', questions: ['coach.hint.understand.likes', 'coach.hint.understand.person', 'coach.hint.understand.topics'] },
];
/** Built views of exchanges of other dialogs are dropped once this many pile up beyond the shown feed. */
const COACH_BUILT_SLACK = 50;
/** Chats whose archive point («Переписка на 09:20») is remembered; the one refreshed longest ago goes first. */
export const COACH_ARCHIVES_MAX = 32;
/** AI-094: follow-ups under the latest answer; «Разбор ситуации» first, as the old window had it on every turn. */
const FOLLOW_UP_CHIPS: readonly { readonly key: I18nKey; readonly preset: 'situation' | null }[] = [
  { key: 'coach.chip.situation', preset: 'situation' },
  { key: 'coach.chip.another', preset: null },
  { key: 'coach.chip.shorter', preset: null },
  { key: 'coach.chip.refusal', preset: null },
];

type CoachDraftVM = NonNullable<CoachTurnVM['answer']>['drafts'][number];

/** The titles of a Review's blocks (AI-053), in the hub's order; the recommendations close it. */
const REVIEW_TITLES: Readonly<Record<ReviewSectionVM['kind'], I18nKey>> = {
  verdict: 'review.section.verdict',
  money: 'review.section.money',
  persona: 'review.section.persona',
  mistakes: 'review.section.mistakes',
  works: 'review.section.works',
  recommendations: 'review.section.recommendations',
};

const reviewItemVm = (item: ReviewDoc['sections'][number]['items'][number]): ReviewItemVM => ({ body: item.body, example: item.fix, exampleWhere: item.fixWhere, afterExample: item.afterFix });

/** A Review's blocks as its card shows them: the pinned blocks in the hub's order, then the recommendations. */
function reviewSections(doc: ReviewDoc): ReviewSectionVM[] {
  const sections: ReviewSectionVM[] = doc.sections.map((section) => ({ kind: section.kind, title: msg(REVIEW_TITLES[section.kind]), body: section.body, items: section.items.map(reviewItemVm) }));
  const recommendations = doc.recommendations;
  if (recommendations !== null && (recommendations.lead.length > 0 || recommendations.items.length > 0)) {
    sections.push({ kind: 'recommendations', title: msg(REVIEW_TITLES.recommendations), body: recommendations.lead, items: recommendations.items.map(reviewItemVm) });
  }
  return sections;
}

/** The two drafts of «Разбор ситуации» are a calm one and a flirty one, titled so, as the old window titled them. */
const SITUATION_DRAFTS: readonly I18nKey[] = ['coach.draft.calm', 'coach.draft.flirt'];

/** One draft of an answer: its parts, and the old card's line when the language gate closes them (AI-087). */
function draftVm(ws: AiWorkspace, record: OpRecord, draft: { readonly index: number; readonly parts: readonly string[] }, situation: boolean): CoachDraftVM {
  const parts = partVms(ws, record, draft.parts, draft.index, true);
  const closed = parts.some((part) => part.copyBlocked?.id === 'language');
  const titled = situation ? SITUATION_DRAFTS[draft.index] : undefined;
  return { index: draft.index, label: titled === undefined ? msg('coach.draft', { n: draft.index + 1 }) : msg(titled), parts, note: closed ? msg('coach.draftLanguage') : null };
}

interface ArchiveRead {
  readonly state: 'loading' | 'ready' | 'error';
  readonly asOf: string | null;
  readonly head: ArchivePoint | null;
}

export type CoachController = AiController;

export function createCoachController(ws: AiWorkspace): CoachController {
  const { catalog, clock, i18n, ids, rpc } = ws.ports;
  const sessions = new CoachSessions({ newId: () => ids.uuid() });
  const archives = new Map<ChatKey, ArchiveRead>();
  /** The hub page of each session: a persona change of that page wipes it. */
  const pages = new Map<string, number>();

  const keyOf = (ready: ReadyTarget): CoachSessionKey => ({ chatKey: chatKeyOf(ready.target.chat), personaDefinitionId: ready.persona.definitionId });

  /** The page of a session; pages of sessions the store no longer keeps (five at most) go. */
  function rememberPage(sessionId: string, pageId: number): void {
    pages.set(sessionId, pageId);
    const kept = new Set(sessions.all().map((session) => session.sessionId));
    for (const id of [...pages.keys()]) if (!kept.has(id)) pages.delete(id);
  }

  // The answers of the dialogs are kept as long as their sessions are.
  const offKeep = ws.ops.keep((opId) => sessions.all().some((session) => session.pending?.opId === opId || session.feed.some((item) => item.opId === opId)));

  // ── turns ────────────────────────────────────────────────────────────────

  /** The chat of this session is the one that is open: a click is for the chat the person sees. */
  function stillOpen(session: CoachSession): ReadyTarget | null {
    const { chat, ready } = ws.situation();
    return chat !== null && ready !== null && chat.key === session.key.chatKey && ready.persona.definitionId === session.key.personaDefinitionId ? ready : null;
  }

  function failTurn(session: CoachSession, turnId: string, outcome: CoachFailedTurn['outcome'], error: CgErrorWire | null): void {
    sessions.fail(session.sessionId, turnId, { outcome, error, endedAt: clock.now() });
    ws.bump();
  }

  /** A step ended: the turn moves on to its answer step, becomes an exchange (or a Review), or fails keeping its question. */
  function settle(record: OpRecord): void {
    const { view } = record;
    const session = sessions.byOp(view.opId);
    const pending = session?.pending ?? null;
    if (session === null || pending === null || pending.opId !== view.opId) return;
    const turnId = pending.turnId;
    if (view.feature === 'review') {
      // 1.51.0: the Review turn — its structured Review for the card, its text for the history.
      if (view.state === 'done' && view.result?.kind === 'review') {
        const { doc, raw } = view.result;
        sessions.completeReview(session.sessionId, turnId, { opId: view.opId, generationRef: view.generationRef ?? null, answerRaw: reviewHistoryText(doc, raw), review: { doc, raw }, completedAt: view.endedAt ?? clock.now() });
        ws.bump();
        return;
      }
      if (view.state === 'canceled') return failTurn(session, turnId, 'canceled', null);
      return failTurn(session, turnId, view.state === 'interrupted' ? 'interrupted' : 'failed', view.error ?? { code: view.state === 'interrupted' ? 'CG-OP-INTERRUPTED' : 'CG-OUTPUT-UNUSABLE' });
    }
    if (view.feature !== 'coach') {
      // The recap step of a composite turn. Whether the question goes on is the background's decision: when it
      // does, the answer step took the chat's slot the moment this one ended, and this view names it.
      const answer = view.continuedBy;
      if (answer !== undefined) {
        sessions.step(session.sessionId, turnId, 'coach', answer);
        ws.bump();
        // It may have ended before this was heard.
        const next = ws.ops.get(answer);
        if (next !== null && isTerminalOpState(next.view.state)) settle(next);
        return;
      }
      if (view.state === 'canceled') return failTurn(session, turnId, 'canceled', null);
      // Nothing follows: the recap stopped the turn with its own error — or the turn could not go on although
      // the recap did not stand in its way (the tab, the sign-in or the persona is no longer the turn's).
      const wire = view.state === 'failed' || view.state === 'interrupted' ? (view.error ?? { code: 'CG-OP-INTERRUPTED' as const }) : null;
      const error: CgErrorWire = wire === null || recapStepVerdict(wire.code) === 'proceed' ? { code: 'CG-CONTEXT-CHANGED' } : wire;
      return failTurn(session, turnId, view.state === 'interrupted' ? 'interrupted' : 'failed', error);
    }
    if (view.state === 'done' && view.result?.kind === 'coach') {
      const answer = view.result.answer;
      sessions.complete(session.sessionId, turnId, {
        opId: view.opId,
        generationRef: view.generationRef ?? null,
        // The raw finished answer is what history replays; a text too long for the view is rebuilt from its parts.
        answerRaw: view.text ?? coachAnswerText(answer),
        answer,
        completedAt: view.endedAt ?? clock.now(),
        ...(view.recapsUsed === undefined ? {} : { recapsUsed: view.recapsUsed }),
      });
      ws.bump();
      return;
    }
    if (view.state === 'canceled') return failTurn(session, turnId, 'canceled', null);
    failTurn(session, turnId, view.state === 'interrupted' ? 'interrupted' : 'failed', view.error ?? { code: view.state === 'interrupted' ? 'CG-OP-INTERRUPTED' : 'CG-OUTPUT-UNUSABLE' });
  }

  const offOps = ws.onOpEvent((event: OpStoreEvent) => {
    if (event.kind === 'done') settle(event.record);
  });

  // AI-100: without a turn in flight the panel yields to another feature that starts. A Recap does not take it:
  // Coach stands on it, the topbar's «Собрать Recap» builds it from here and the topbar follows it.
  const offStarted = ws.onStarted((record) => {
    if (record.view.surface === 'coach' || record.view.feature === 'recap' || record.view.feature === 'recap-short') return;
    const busy = sessions.all().some((session) => session.pending !== null);
    if (!busy) ws.ports.overlays?.close('coach');
  });

  // AI-086: after a draft went into the composer the panel folds, so the field and Send are in view.
  const offInserted = ws.onInserted((record) => {
    if (record.view.feature === 'coach') ws.ports.overlays?.close('coach');
  });

  // AI-089: a change of persona, account or sign-in wipes the dialogs it belonged to. The background
  // cancels what was running; a late terminal view of a wiped dialog finds no session and changes nothing.
  const offReset = ws.onReset((affected) => {
    const wiped = sessions.all().filter((session) => affected(session.key.chatKey, pages.get(session.sessionId) ?? -1));
    for (const session of wiped) pages.delete(session.sessionId);
    const ids = new Set(wiped.map((session) => session.sessionId));
    sessions.reset((session) => ids.has(session.sessionId));
    archives.clear();
    ws.bump();
  });
  // The owner edited the persona (its key stays): the dialogs go on under its new definition.
  const offFollowed = ws.onPersonaFollowed((moves) => {
    let moved = 0;
    for (const move of moves) moved += sessions.follow(move.from, move.to);
    if (moved > 0) ws.bump();
  });

  // ── asking ───────────────────────────────────────────────────────────────

  /** The toast of a question that could not start; a click for a chat the person already left stays quiet. */
  function notStarted(error: CgErrorWire): void {
    if (error.code === 'CG-CONTEXT-CHANGED') return;
    const entry = CG_REGISTRY[error.code];
    ws.ports.toasts?.show({ kind: entry.severity === 'error' ? 'error' : 'warning', code: error.code, scope: 'coach.ask', title: msg(entry.title), body: msg(entry.body) });
  }

  async function ask(action: UiActionOf<'Generate'>, cause: CauseKind): Promise<ActionReceipt> {
    const situation = ws.situation();
    const { chat, ready } = situation;
    if (chat === null || chat.handle !== action.targetHandle) return refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' });
    if (ready === null) return refused(ws, action.type, ws.blockedError(situation));
    const question = action.options.question?.trim() ?? '';
    const preset = action.options.preset ?? null;
    // AI-082: whitespace is not a question — nothing is asked and no turn appears.
    if (question.length === 0 && preset === null) return refused(ws, action.type, { code: 'CG-UI-FAILED' });
    const now = clock.now();
    const session = sessions.open(keyOf(ready), now);
    rememberPage(session.sessionId, ready.page.pageId);
    // One turn at a time: the question stays in the field (AI-099).
    if (session.pending !== null) return refused(ws, action.type, { code: 'CG-OP-COACH-BUSY' });

    const turnId = ids.uuid();
    // The turn exists from the click on: the question is in the feed while its start is on the way.
    const begun = sessions.begin(session.sessionId, {
      turnId,
      // The preset's own question lives on the hub; the dialog shows the chip's words.
      question: question.length > 0 ? question : i18n.t('coach.chip.situation'),
      preset,
      attachedDraft: action.options.attachMyDraft === true,
      askedAt: now,
      step: 'coach',
    });
    if (!begun.ok) return refused(ws, action.type, { code: 'CG-OP-COACH-BUSY' });
    ws.bump();
    /** Nothing ran: no turn is left behind, the question stays with the person (AI-099). */
    const giveUp = (error: CgErrorWire): ActionReceipt => {
      sessions.abandon(session.sessionId, turnId);
      ws.bump();
      return refused(ws, action.type, error);
    };

    // AI-096: before the first question of a session the hub may need a fresh recap. What it holds is asked
    // first; a status that cannot be read is no reason to build one — the question then goes right away.
    const mode = ready.settings.generation.coach.autoRecap;
    let recap: 'short' | 'full' | null = null;
    // «Учитывать Recap» unticked: a Recap the question would not read is not built for it either.
    const recapOn = ws.recapOn(chatKeyOf(ready.target.chat), 'coach');
    if (mode !== 'off' && recapOn && !session.autoRecapAttempted && exchangesOf(session).length === 0 && flagUsable(ready.bootstrap, ready.page.pageId, 'recap')) {
      // The depth a full recap is built at takes the person's deep window the site keeps (R20 §12): one built at it is no stale one.
      const [read, extended] = await Promise.all([ws.recaps.readStatus(ws.slotKey(ready)), ws.windows()]);
      // The person left the chat while the status was read: nothing is started for another fan.
      if (stillOpen(session) === null) return giveUp({ code: 'CG-CONTEXT-CHANGED' });
      const deepWindow = windowFor('recap', undefined, ready.settings, ready.bootstrap, extended);
      recap = autoRecapFor({ mode, attempted: false, hasExchanges: false, status: read.ok ? read.status : null, deepWindow });
    }

    // One start for the whole turn: the question, the history, the draft read now (AI-091) — and, when a recap
    // is due, the recap step in front of it. The background admits both under this click's one token.
    const options: UserOptions = { ...(question.length > 0 ? { question } : {}), ...(preset === null ? {} : { preset }), ...(action.options.attachMyDraft === true ? { attachMyDraft: true } : {}) };
    const limit = clampHistoryLimit(ready.settings.generation.coach.historyLimit);
    const result = await ws.startFeature({ feature: 'coach', surface: 'coach', options, cause, coachHistory: historyFor(session, limit), ...(recap === null ? {} : { autoRecap: recap }) });
    // A question that did not start is said, never dropped in silence: the panel keeps the question (AI-099) and
    // a toast names the code. A refusal that names what runs also takes the chat's sheet, as any other start's.
    if (result.kind === 'failed') {
      notStarted(result.error);
      return giveUp(result.error);
    }
    if (result.kind === 'refused') {
      ws.showRefusal(chat.key, result.refusal);
      notStarted(result.refusal.error);
      return giveUp(result.refusal.error);
    }
    const record = ws.ops.get(result.opId);
    // The admitted operation is the recap step when one was due and can be built here; otherwise the answer itself.
    const stepped = sessions.step(session.sessionId, turnId, record !== null && record.view.feature !== 'coach' ? 'recap' : 'coach', result.opId);
    if (stepped === null) {
      // The dialog was wiped while the start was on its way (a persona or sign-in change): nobody would read
      // the answer, so it is not left running.
      void ws.ops.cancel(result.opId);
      return refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' });
    }
    ws.bump();
    // The operation may have ended before this answer arrived.
    if (record !== null && isTerminalOpState(record.view.state)) settle(record);
    return done(action.type, 'started', { opId: result.opId });
  }

  // ── a Review as a turn (1.51.0) ──────────────────────────────────────────

  /** The window opens for what asks a Review from outside it (its key, the palette); the header's Recaps are read, as at any opening. */
  function openWindow(ready: ReadyTarget): void {
    if (ws.ports.overlays?.isOpen?.('coach') === true) return;
    ws.ports.overlays?.open('coach');
    if (flagUsable(ready.bootstrap, ready.page.pageId, 'recap')) ws.recaps.loadShared(ws.slotKey(ready));
  }

  /**
   * A Review of the open chat as the next turn: the «Review» chip, its key, the palette — or `original`, the «Ещё раз»
   * of a Review turn. The page's own `review`: its switch, its gates and its quota, as the bar's Review button had
   * them. Over a dialog that holds a Review already it rates anew, past the cache (the old window's «Ещё раз»); the
   * first one of a dialog may reopen a Review of the chat the background still keeps (AI-128).
   */
  async function review(type: UiAction['type'], cause: CauseKind, original: OpRecord | null): Promise<ActionReceipt> {
    const situation = ws.situation();
    const { chat, ready } = situation;
    if (chat === null) return refused(ws, type, { code: 'CG-CONTEXT-CHANGED' });
    if (ready === null) return refused(ws, type, ws.blockedError(situation));
    // The Review is read where it is shown: the window opens before anything is asked of the hub.
    openWindow(ready);
    const now = clock.now();
    const session = sessions.open(keyOf(ready), now);
    rememberPage(session.sessionId, ready.page.pageId);
    // One turn at a time (AI-099).
    if (session.pending !== null) return refused(ws, type, { code: 'CG-OP-COACH-BUSY' });
    const rated = replayableOf(session).some((turn) => turn.kind === 'review');
    const turnId = ids.uuid();
    const begun = sessions.begin(session.sessionId, { turnId, question: i18n.t('coach.chip.review'), preset: null, attachedDraft: false, askedAt: now, step: 'review' });
    if (!begun.ok) return refused(ws, type, { code: 'CG-OP-COACH-BUSY' });
    ws.bump();
    /** Nothing ran: no turn is left behind. */
    const giveUp = (error: CgErrorWire): ActionReceipt => {
      sessions.abandon(session.sessionId, turnId);
      ws.bump();
      return refused(ws, type, error);
    };
    const result = await ws.startFeature({ feature: 'review', surface: 'coach', options: {}, cause, ...(original !== null ? { regenerateOf: original, force: true } : rated ? { force: true } : {}) });
    // As a question that did not start: said in a toast, a refusal that names what runs also in the chat's sheet.
    if (result.kind === 'failed') {
      notStarted(result.error);
      return giveUp(result.error);
    }
    if (result.kind === 'refused') {
      ws.showRefusal(chat.key, result.refusal);
      notStarted(result.refusal.error);
      return giveUp(result.refusal.error);
    }
    if (sessions.step(session.sessionId, turnId, 'review', result.opId) === null) {
      // The dialog was wiped while the start was on its way: nobody would read the Review.
      void ws.ops.cancel(result.opId);
      return refused(ws, type, { code: 'CG-CONTEXT-CHANGED' });
    }
    ws.bump();
    // A Review the background kept (AI-128), or one that ended before this answer arrived.
    const record = ws.ops.get(result.opId);
    if (record !== null && isTerminalOpState(record.view.state)) settle(record);
    return done(type, result.reopened ? 'noop' : 'started', { opId: result.opId });
  }

  // ── «Обновить переписку» (AI-097, Б6) ────────────────────────────────────

  /** What is known of a chat's archive; a shift opens hundreds of chats, a bounded number of them is remembered. */
  function setArchive(key: ChatKey, read: ArchiveRead): void {
    archives.delete(key);
    archives.set(key, read);
    while (archives.size > COACH_ARCHIVES_MAX) {
      const oldest = archives.keys().next().value;
      if (oldest === undefined) break;
      archives.delete(oldest);
    }
  }

  /** Why the archive feed of the open chat cannot be read («Обновить переписку»): the page's `preview` switch with the hub's own reason, or what keeps the whole chat off; null — it can. */
  function archiveSwitch(situation: Situation): ReasonVM | null {
    const { ready } = situation;
    if (ready === null) return ws.offReason(situation) ?? catalog.reason('chat-loading');
    const feed = flagStateOf(ready.bootstrap, ready.page.pageId, 'preview');
    return feed.usable ? null : flagReasonVm(feed);
  }

  async function refreshArchive(action: UiActionOf<'RefreshArchive'>): Promise<ActionReceipt> {
    const situation = ws.situation();
    const { chat, ready } = situation;
    if (chat === null || ready === null) return refused(ws, action.type, ws.blockedError(situation));
    // The page's own `preview` feature: nothing is asked of the hub that it would answer 409 to.
    const feed = flagStateOf(ready.bootstrap, ready.page.pageId, 'preview');
    if (!feed.usable) return refused(ws, action.type, flagRefusal(feed));
    const before = archives.get(chat.key);
    setArchive(chat.key, { state: 'loading', asOf: before?.asOf ?? null, head: before?.head ?? null });
    ws.bump();
    // The head of the hub archive: database only on the hub, so nothing is marked read.
    // R20 F6b: the head of the chat's own conversation — on Fansly the group of the route, apart from the fan.
    const { fanRef, conversationRef } = ready.target;
    const answer = await rpc.request('feed.read', { pageId: ready.page.pageId, fanRef, cursor: null, limit: 1, ...(conversationRef === fanRef ? {} : { conversationRef }) });
    if (!answer.ok) {
      setArchive(chat.key, { state: 'error', asOf: before?.asOf ?? null, head: before?.head ?? null });
      ws.bump();
      return refused(ws, action.type, answer.error);
    }
    const head = answer.payload.head;
    setArchive(chat.key, { state: 'ready', asOf: answer.payload.asOf, head: head === null ? { messageRef: null, at: answer.payload.newestKnownAt } : { messageRef: head.messageRef, at: head.at } });
    ws.bump();
    return done(action.type);
  }

  // ── the view ─────────────────────────────────────────────────────────────

  /** The same question again — with the person's draft read anew when the turn was asked with it, as the old «Повторить». */
  function retryAction(handle: string, turn: Pick<CoachFailedTurn, 'question' | 'preset' | 'attachedDraft'>): UiAction {
    const asked = turn.preset === null ? { question: turn.question } : { preset: turn.preset };
    return { type: 'Generate', targetHandle: handle, feature: 'coach', options: { ...asked, ...(turn.attachedDraft ? { attachMyDraft: true } : {}) } };
  }

  /** 1.51.0: a Review of the open chat, as the «Review» chip asks it. */
  const reviewAction = (handle: string): UiAction => ({ type: 'Generate', targetHandle: handle, feature: 'review', options: {} });

  /**
   * A finished exchange reads the same until something its parts show
   * changes: an insert or a copy of one of them, the copy-only mode, the
   * fan's script (the language gate), the memory boundary, the language. Its
   * view is built once per such state and handed out again as the same
   * object, so a stream batch or a redraw does not rebuild — or compare —
   * a long dialog (§11).
   */
  const built = new Map<string, { readonly state: string; readonly vm: CoachTurnVM }>();

  function exchangeState(exchange: CoachExchange, outside: boolean, record: OpRecord | null, situation: Situation): string {
    const asked = ws.inserts.confirmation(exchange.opId);
    const state: unknown[] = [outside, record !== null, i18n.language, situation.copyOnly?.code ?? '', situation.chat === null ? '' : ws.fanScript(situation.chat.key), asked?.confirmationId ?? '', debugOn()];
    for (const draft of exchange.answer.drafts) {
      for (let index = 0; index < draft.parts.length; index += 1) {
        const part = { variant: draft.index, index };
        const insert = ws.inserts.partState(exchange.opId, part);
        state.push(insert.insert, insert.insertError?.code ?? '', ws.copyState(ws.partHandle(exchange.opId, part)));
      }
    }
    return state.join('|');
  }

  function exchangeVm(exchange: CoachExchange, outside: ReadonlySet<string>, situation: Situation, handle: string | null, askReason: ReasonVM | null): CoachTurnVM {
    const record = ws.ops.get(exchange.opId);
    // The site's verdict over the answer (R20 P8c): its «Ещё раз» asks the same question again, when a question may be asked.
    const mark = analysisMark(record === null ? null : ws.ports.policy.verdict(record.view, record.memo.fingerprint));
    const again = mark === null || handle === null ? null : button('common.again', retryAction(handle, exchange), { enabled: askReason === null, reason: askReason });
    const state = [exchangeState(exchange, outside.has(exchange.turnId), record, situation), mark?.reason ?? '', again === null ? '' : `${handle ?? ''}:${askReason?.id ?? ''}`].join('|');
    const known = built.get(exchange.turnId);
    if (known !== undefined && known.state === state) return known.vm;
    const vm = { ...buildExchange(exchange, outside, record), stale: mark, again };
    built.set(exchange.turnId, { state, vm });
    return vm;
  }

  /** `debug.enabled` as the tab knows it. */
  const debugOn = (): boolean => ws.env.settings?.settings.debug.enabled ?? false;
  /**
   * DB-019: the debug footer of a turn — time, tokens, cost, «Промпт», the stage profile — from its operation's
   * own debug view, in debug mode only. A turn in the panel is an opened result. null — debug is off, or the
   * operation is no longer held.
   */
  const turnDebug = (record: OpRecord | null): NonNullable<CoachTurnVM['debug']> | null => (record === null ? null : debugVm(record.view, { enabled: debugOn(), opened: true, now: clock.now(), i18n }));

  function buildExchange(exchange: CoachExchange, outside: ReadonlySet<string>, record: OpRecord | null): CoachTurnVM {
    const answer = exchange.answer;
    // The labelled sections are drawn as blocks: the bubble's prose is only what stands before the first of them,
    // or every section would read twice (the old window drew the lead and the sections, nothing else).
    const prose = answer.blocks === null ? answer.prose : (splitLabelledSections(answer.prose, COACH_SECTION_LABELS)?.lead ?? '');
    const situation = exchange.preset === 'situation' && answer.drafts.length === SITUATION_DRAFTS.length;
    return {
      id: exchange.turnId,
      opId: exchange.opId,
      question: exchange.question,
      askedAt: exchange.askedAt,
      state: 'done',
      phase: null,
      sentToCoach: false,
      streamText: null,
      attachedDraft: exchange.attachedDraft,
      outsideMemory: outside.has(exchange.turnId),
      answer: {
        prose,
        blocks: answer.blocks === null ? null : answer.blocks.map((block) => ({ kind: block.kind, title: msg(BLOCK_TITLES[block.kind]), body: block.body })),
        // Each draft is a message to the fan: its parts insert and copy like any other part. One in Cyrillic for a fan
        // who does not write Cyrillic does neither, and says so under it (AI-087, the old card's note).
        drafts: record === null ? [] : answer.drafts.map((draft) => draftVm(ws, record, draft, situation)),
      },
      error: null,
      errorActions: [],
      // AI-086: Б2 for one of the draft parts — the id `AnswerConfirm` takes.
      confirm: confirmVm(ws, exchange.opId),
      debug: turnDebug(record),
      // «с Recap · 3 д назад» / «без Recap» under the answer: what the hub put into it, never a guess.
      recapsUsed: exchange.recapsUsed ?? null,
    };
  }

  /**
   * 1.51.0: a finished Review turn — the question line «Review», the Review's card as its answer. The site's verdict over
   * it marks it as an answer is marked (R20 P8c); its «Ещё раз» is always there: a new Review as the next turn, when the
   * «Review» chip could run one now. Built once per state, as an exchange is.
   */
  function reviewTurnVm(turn: CoachReviewTurn, outside: ReadonlySet<string>, handle: string | null, chip: ActionButtonVM | null): CoachTurnVM {
    const record = ws.ops.get(turn.opId);
    const mark = analysisMark(record === null ? null : ws.ports.policy.verdict(record.view, record.memo.fingerprint));
    const again = handle === null || chip === null ? null : button('common.again', { type: 'Regenerate', operationId: turn.opId }, { enabled: chip.enabled, reason: chip.reason });
    const state = [outside.has(turn.turnId), record !== null, mark?.reason ?? '', again === null ? '' : `${handle ?? ''}:${chip?.reason?.id ?? ''}`, debugOn()].join('|');
    const known = built.get(turn.turnId);
    if (known !== undefined && known.state === state) return known.vm;
    const { doc, raw } = turn.review;
    // Whether the archive it read was whole is known only from the hub's context frame (debug); never guessed.
    const context = record?.view.debug?.context ?? null;
    const coverage: CoverageLevel = context !== null && (COVERAGE_LEVELS as readonly string[]).includes(context.coverage) ? (context.coverage as CoverageLevel) : 'unknown';
    const card: CoachReviewVM = {
      // An answer whose frame does not read keeps its score when its <rating> does (AI-052).
      rating: doc?.rating ?? reviewTags(raw).rating,
      lead: doc === null || doc.lead.length === 0 ? null : doc.lead,
      sections: doc === null ? [] : reviewSections(doc),
      raw: reviewRawText(raw),
      unparsed: doc === null,
      copyHandle: record === null ? null : artifactHandle({ kind: 'review', opId: turn.opId }),
      generatedAt: new Date(turn.completedAt).toISOString(),
      partial: coverage === 'partial',
    };
    const vm: CoachTurnVM = {
      feature: 'review',
      id: turn.turnId,
      opId: turn.opId,
      question: turn.question,
      askedAt: turn.askedAt,
      state: 'done',
      phase: null,
      sentToCoach: false,
      streamText: null,
      attachedDraft: false,
      outsideMemory: outside.has(turn.turnId),
      answer: null,
      review: card,
      error: null,
      errorActions: [],
      confirm: null,
      debug: turnDebug(record),
      stale: mark,
      again,
    };
    built.set(turn.turnId, { state, vm });
    return vm;
  }

  function failedVm(turn: CoachFailedTurn, handle: string | null, canAsk: boolean): CoachTurnVM {
    const wire = turn.error;
    // A Review that did not finish is run again as the «Review» chip runs it.
    const again = handle === null ? null : turn.review ? reviewAction(handle) : retryAction(handle, turn);
    let actions: ActionButtonVM[] = [];
    if (wire !== null) actions = errorActions(wire, { catalog, now: clock.now(), again, againHotkey: null, openChat: null });
    // «Остановлено вами»: nothing failed, the question can simply be asked again.
    else if (again !== null) actions = [button('common.retry', again, { enabled: canAsk })];
    return {
      ...(turn.review ? { feature: 'review' as const } : {}),
      id: turn.turnId,
      opId: turn.opId,
      question: turn.question,
      askedAt: turn.askedAt,
      state: turn.outcome,
      phase: null,
      sentToCoach: false,
      streamText: null,
      attachedDraft: turn.attachedDraft,
      outsideMemory: false,
      answer: null,
      error: wire === null ? null : errorVm(wire, i18n),
      errorActions: actions,
      confirm: null,
      // A failed turn's stages say where it stopped.
      debug: turnDebug(turn.opId === null ? null : ws.ops.get(turn.opId)),
    };
  }

  function pendingVm(turn: CoachPendingTurn): CoachTurnVM {
    const record = turn.opId === null ? null : ws.ops.get(turn.opId);
    const view = record?.view ?? null;
    const now = clock.now();
    // The recap step of a composite turn shows its timer and its cancel under its own name (the old «Полный рекап
    // (авто) · обновляется…»); its text is not the Coach's answer. A Review (1.51.0) is its own one step.
    const answering = view !== null && (view.feature === 'coach' || view.feature === 'review');
    const preview = answering && view.text !== undefined ? streamPreview(view.feature, view.text) : '';
    const phase = view === null ? null : phaseVm(view, now);
    return {
      ...(turn.step === 'review' ? { feature: 'review' as const } : {}),
      id: turn.turnId,
      opId: turn.opId,
      question: turn.question,
      askedAt: turn.askedAt,
      state: view === null || isTerminalOpState(view.state) ? 'admitted' : view.state,
      // The start is still on its way to the background (nothing is admitted yet): the first stage, nothing to cancel.
      phase:
        phase === null
          ? { startedAt: turn.askedAt, stages: [{ id: 'context', label: msg('result.stage.context'), state: 'current' }], retryAt: null, cancel: null }
          : answering
            ? phase
            : { ...phase, stages: [{ id: 'context', label: msg(view?.feature === 'recap-short' ? 'coach.recapStep.short' : 'coach.recapStep.full'), state: 'current' }] },
      // AI-093: «Отправлено коучу…» until the hub's first frame — of a question; a Review shows its stages.
      sentToCoach: view?.feature === 'coach' && (view.state === 'admitted' || view.state === 'requesting'),
      streamText: preview.length > 0 ? preview : null,
      attachedDraft: turn.attachedDraft,
      outsideMemory: false,
      answer: null,
      error: null,
      errorActions: [],
      confirm: null,
      // DB-012: the live timer of the wait — of the answer step; the recap step in front of it has its own sheet.
      debug: answering ? turnDebug(record) : null,
    };
  }

  function archivePoint(session: CoachSession | null, chatKey: ChatKey): { readonly asOf: string | null; readonly point: ArchivePoint | null } {
    const read = archives.get(chatKey);
    if (read !== undefined && read.state === 'ready') return { asOf: read.asOf, point: read.head };
    // Until «Обновить переписку» is pressed: what the latest answer (or Review) was built from.
    const last = session === null ? undefined : replayableOf(session).at(-1);
    const head = last === undefined ? null : (ws.ops.get(last.opId)?.view.servedContext?.servedHead ?? null);
    return head === null ? { asOf: read?.asOf ?? null, point: read?.head ?? null } : { asOf: head.at, point: { messageRef: head.messageRef, at: head.at } };
  }

  function build(): CoachVM {
    const situation: Situation = ws.situation();
    const { chat, ready } = situation;
    const session = ready === null ? null : sessions.peek(keyOf(ready));
    const historyLimit = clampHistoryLimit(ready?.settings.generation.coach.historyLimit ?? ws.env.settings?.settings.generation.coach.historyLimit ?? 10);
    // The owner's `coach` switch of this chat's page (its own feature).
    const flag = ready === null ? null : flagStateOf(ready.bootstrap, ready.page.pageId, 'coach');
    const usable = flag !== null && flag.usable;
    // 1.51.0: the page's `review` — what the bar's Review button asked of the page: its switch and what it needs.
    const reviewAdmitted = ready === null ? null : ws.admitted(situation.host, ready, 'review', 'generate');
    // Coach's questions are off while its Review is on: the window is there for the «Review» chip alone.
    const reviewOnly = !usable && reviewAdmitted !== null && reviewAdmitted.usable;
    const pending = session?.pending ?? null;
    const { asOf, point } = chat === null ? { asOf: null, point: null } : archivePoint(session, chat.key);
    const lag = chat === null ? null : ws.archiveLag(point, chat.key);

    let view: VmView;
    if (chat === null) view = views.empty(msg('common.empty'));
    else if (ready === null) {
      const error = errorVm(ws.blockedError(situation), i18n);
      view = situation.status === 'loading-chat' ? views.loading(null, msg('dock.status.chatLoading')) : situation.status === 'hub-down' ? views.offline(error, { type: 'ReloadView', selector: { of: 'dock' } }) : views.forbidden(error);
    } else if (flag !== null && !flag.usable && !reviewOnly) view = views.forbidden(errorVm(flagRefusal(flag), i18n));
    else if (session === null || (session.feed.length === 0 && pending === null)) view = views.empty(msg(reviewOnly ? 'coach.reviewOnly.title' : 'coach.empty.title'));
    else view = lag === null ? views.ready() : { s: 'partial', gaps: [{ kind: 'archive-lag', messages: lag.messages, minutes: null }] };

    // The one thing that keeps a question from being asked.
    const running = chat === null ? null : ws.running(chat.key);
    let askReason: ReasonVM | null = null;
    const off = ws.offReason(situation);
    if (off !== null) askReason = off;
    else if (!usable) askReason = flag === null ? catalog.reason('feature-disabled') : flagReasonVm(flag);
    else if (pending !== null) askReason = catalog.reason('coach-busy');
    else if (running !== null) askReason = catalog.reason('chat-busy');
    const canAsk = askReason === null;

    // 1.51.0: the «Review» chip, off for the reason the bar's Review button gave — the page, a turn or a generation in
    // the chat, the shared gate (a short history, AI-051).
    let reviewReason: ReasonVM | null = off;
    if (reviewReason === null) {
      if (ready === null || reviewAdmitted === null) reviewReason = catalog.reason('chat-loading');
      else if (!reviewAdmitted.usable) reviewReason = flagReasonVm(reviewAdmitted);
      else if (pending !== null) reviewReason = catalog.reason('coach-busy');
      else if (running !== null) reviewReason = catalog.reason('chat-busy');
      else {
        const composer = situation.host.composer;
        const gate = featureGate('review', { window: situation.window, draftEmpty: composer === null ? null : composer.draft.provenance === 'empty' }, ws.ports.policy);
        if (gate !== null) reviewReason = catalog.reason(gate.reason);
      }
    }
    const reviewChip: ActionButtonVM | null =
      chat === null ? null : button('coach.chip.review', reviewAction(chat.handle), { enabled: reviewReason === null, reason: reviewReason, hotkey: reviewReason === null ? featureHotkey(catalog, 'review') : null });

    const outside = session === null ? new Set<string>() : outsideMemory(session, historyLimit);
    const feed = session?.feed ?? [];
    const handle = chat?.handle ?? null;
    const turns: CoachTurnVM[] = feed.map((item) =>
      item.kind === 'exchange'
        ? exchangeVm(item, outside, situation, handle, askReason)
        : item.kind === 'review'
          ? reviewTurnVm(item, outside, handle, reviewChip)
          : failedVm(item, handle, item.review ? reviewReason === null : canAsk),
    );
    if (pending !== null) turns.push(pendingVm(pending));
    // Views of exchanges no dialog shows any more are not kept.
    if (built.size > feed.length + COACH_BUILT_SLACK) {
      const shown = new Set(feed.map((item) => item.turnId));
      for (const turnId of [...built.keys()]) if (!shown.has(turnId)) built.delete(turnId);
    }

    // AI-095: the Recaps Coach stands on, as the hub attaches them to every question — the full one, and the short one
    // when it is newer (an older short one adds nothing the full one does not carry).
    const slots = ready === null ? { short: null, full: null } : ws.recaps.both(ws.slotKey(ready));
    const recaps: CoachRecapVM[] = [];
    if (slots.full !== null) recaps.push({ length: 'full', generatedAt: slots.full.revision, summary: slots.full.markdown });
    if (slots.short !== null && (slots.full === null || Date.parse(slots.short.revision) > Date.parse(slots.full.revision)))
      recaps.push({ length: 'short', generatedAt: slots.short.revision, summary: slots.short.markdown });
    // A Recap of this chat being built — from «Recap ▾», the strip or a turn's own step: the topbar says so.
    const recapRunning = running !== null && (running.view.feature === 'recap' || running.view.feature === 'recap-short');
    // The follow-ups are about an answer of Coach; before one — a Review alone, too — the opening questions stand. Where
    // Coach's questions are off (its Review on) there are none.
    const hasExchange = session !== null && exchangesOf(session).length > 0;
    const chips = reviewOnly ? [] : (hasExchange ? FOLLOW_UP_CHIPS : OPENING_CHIPS).map((chip) => ({ label: msg(chip.key), question: i18n.t(chip.key), preset: chip.preset }));
    // AI-081: the empty dialog also offers three headings of ready questions; a click fills the input, the person sends.
    const emptyDialog = session === null || (session.feed.length === 0 && pending === null);
    const hints: CoachHintGroupVM[] = emptyDialog && !reviewOnly ? HINT_GROUPS.map((group) => ({ label: msg(group.label), questions: group.questions.map((key) => ({ label: msg(key), question: i18n.t(key) })) })) : [];
    // No question asked yet — the dialog holds nothing but Reviews, if anything: the first question may build its Recap first (AI-096).
    const beforeQuestion = session === null || (session.feed.every((item) => item.kind === 'review') && (pending === null || pending.step === 'review'));

    const autoRecap = ready?.settings.generation.coach.autoRecap ?? ws.env.settings?.settings.generation.coach.autoRecap ?? 'off';
    // «Учитывать Recap»: Coach's own «с Recap» of the chat, where the hub can leave the Recaps out.
    const recapOn = ready === null || !ready.bootstrap.capabilities.includes(RECAP_OFF_CAPABILITY) ? null : ws.recapOn(chatKeyOf(ready.target.chat), 'coach');
    const composer = situation.host.composer;
    const draftEmpty = composer === null || composer.draft.provenance === 'empty';
    // «Обновить переписку» reads the archive feed: the PAGE's own `preview` feature (the owner's switch and what
    // the hub serves), never the hub capability alone — a page whose preview is off would answer 409 to the click.
    const archiveOff = archiveSwitch(situation);
    const feedAvailable = archiveOff === null;
    const refreshing = chat !== null && archives.get(chat.key)?.state === 'loading';
    return {
      view,
      targetName: chat === null ? null : situation.fanName,
      freshness: {
        asOf,
        lag,
        refresh: button('coach.refresh', chat === null ? { type: 'ReloadView', selector: { of: 'coach' } } : { type: 'RefreshArchive', targetHandle: chat.handle }, {
          enabled: chat !== null && feedAvailable && !refreshing,
          reason: chat !== null ? archiveOff : null,
        }),
      },
      recaps,
      recapRunning,
      window: ready === null ? null : windowFor('coach', undefined, ready.settings, ready.bootstrap),
      recapOn,
      // Before the first question of a session only; a page without Recap builds none (AI-096), nor an unticked chat.
      autoRecapNext:
        beforeQuestion && usable && session?.autoRecapAttempted !== true && ready !== null && recapOn !== false && flagUsable(ready.bootstrap, ready.page.pageId, 'recap')
          ? autoRecapAhead(autoRecap, slots, clock.now())
          : null,
      turns,
      historyLimit,
      chips,
      ask: {
        enabled: canAsk,
        reason: askReason,
        // AI-091: the composer's draft goes with one turn, read once when the question is sent.
        attachDraft: { available: !draftEmpty && composer !== null, reason: draftEmpty ? catalog.reason('needs-draft') : null },
      },
      // AI-090: not while the Coach answers.
      newDialog: button('coach.newDialog', { type: 'NewCoachDialog' }, { enabled: pending === null && ready !== null, reason: pending !== null ? catalog.reason('coach-busy') : null }),
      hints,
      review: reviewChip,
      reviewOnly,
    };
  }

  // ── actions ──────────────────────────────────────────────────────────────

  const handlers: ActionHandlers = {
    Generate(action, cause) {
      if (action.feature === 'review') {
        const chat = ws.situation().chat;
        // A Review of a chat that is gone is neither run nor opened over another one.
        if (chat === null || chat.handle !== action.targetHandle) return Promise.resolve(refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' }));
        return review(action.type, cause, null);
      }
      if (action.feature !== 'coach') return null;
      // AI-080: opening the panel generates nothing.
      if (action.options.question === undefined && action.options.preset === undefined) {
        const chat = ws.situation().chat;
        // The click was for a chat that is gone: its panel is not opened over another one.
        if (chat === null || chat.handle !== action.targetHandle) return Promise.resolve(refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' }));
        ws.ports.overlays?.open('coach');
        const ready = ws.situation().ready;
        // The header's recap: what the hub holds is read when the panel opens.
        if (ready !== null && flagUsable(ready.bootstrap, ready.page.pageId, 'recap')) ws.recaps.loadShared(ws.slotKey(ready));
        return Promise.resolve(done(action.type, 'opened'));
      }
      return ask(action, cause);
    },
    // «Ещё раз» of a Review turn (and of its mark): a new Review as the next turn, past the cache.
    Regenerate(action, cause) {
      const record = ws.ops.get(action.operationId);
      if (record === null || record.view.feature !== 'review' || !isOwnSurface(record.view.surface)) return null;
      const chat = ws.situation().chat;
      if (chat === null || chat.key !== chatKeyOf(record.view.target.chat)) return Promise.resolve(refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' }));
      return review(action.type, cause, record);
    },
    NewCoachDialog(action) {
      const ready = ws.situation().ready;
      if (ready === null) return Promise.resolve(refused(ws, action.type, { code: 'CG-GATE-CHAT-LOADING' }));
      const fresh = sessions.newDialog(keyOf(ready), clock.now());
      if (!fresh.ok) return Promise.resolve(refused(ws, action.type, { code: 'CG-OP-COACH-BUSY' }));
      rememberPage(fresh.session.sessionId, ready.page.pageId);
      ws.bump();
      return Promise.resolve(done(action.type));
    },
    RefreshArchive(action) {
      const chat = ws.situation().chat;
      // Only the open chat's own handle: previews refresh their feeds themselves.
      if (chat === null || action.targetHandle !== chat.handle) return null;
      return refreshArchive(action);
    },
    ReloadView(action) {
      if (action.selector.of !== 'coach') return null;
      ws.env.reload();
      return Promise.resolve(done(action.type));
    },
  };

  return createSurface(ws, {
    kinds: ['coach'],
    build,
    handlers,
    dispose: () => {
      offKeep();
      offOps();
      offStarted();
      offInserted();
      offReset();
      offFollowed();
    },
  });
}
