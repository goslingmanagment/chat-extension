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
// Actions: `Generate { feature: 'coach', options: {} }` opens the panel and
// generates nothing; with `question` or `preset` it asks. `NewCoachDialog`
// (the UI confirms first), `RefreshArchive` («Обновить переписку»: the
// archive head is read again and the lag behind the chat is shown).

import { type CgErrorWire, type I18nKey } from '@cg/contracts/errors';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { chatKeyOf, type ChatKey } from '@cg/contracts/ids';
import { type COACH_BLOCK_KINDS } from '@cg/contracts/ops';
import {
  type ActionButtonVM,
  type ActionReceipt,
  type CoachHintGroupVM,
  type CoachTurnVM,
  type CoachVM,
  type ReasonVM,
  type UiAction,
  type UiActionOf,
  type UserOptions,
  type VmView,
} from '@cg/contracts/vm';

import {
  CoachSessions,
  autoRecapFor,
  clampHistoryLimit,
  exchangesOf,
  historyFor,
  outsideMemory,
  recapStepVerdict,
  type CoachExchange,
  type CoachFailedTurn,
  type CoachPendingTurn,
  type CoachSession,
  type CoachSessionKey,
} from '../../domain/coach';
import { windowFor } from '../../domain/features';
import { flagRefusal, flagStateOf, flagUsable, isTerminalOpState } from '../../domain/ops';
import { coachAnswerText, streamPreview } from '../../domain/output';
import { latestLength, type ArchivePoint } from '../../domain/recap';
import { type OpRecord, type OpStoreEvent } from '../ai/op-store';
import { confirmVm, partVms } from '../ai/result-vm';
import { createSurface, done, refused, type ActionHandlers, type AiController, type CauseKind } from '../ai/surface';
import { button, debugVm, errorActions, errorVm, msg, phaseVm, views } from '../ai/view-models';
import { type AiWorkspace, type ReadyTarget, type Situation } from '../ai/workspace';
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
/** AI-094: follow-ups under the latest answer. */
const FOLLOW_UP_CHIPS: readonly I18nKey[] = ['coach.chip.another', 'coach.chip.shorter', 'coach.chip.refusal'];

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

  /** A step ended: the turn moves on to its answer step, becomes an exchange, or fails keeping its question. */
  function settle(record: OpRecord): void {
    const { view } = record;
    const session = sessions.byOp(view.opId);
    const pending = session?.pending ?? null;
    if (session === null || pending === null || pending.opId !== view.opId) return;
    const turnId = pending.turnId;
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

  // AI-100: without a turn in flight the panel yields to another feature that starts.
  const offStarted = ws.onStarted((record) => {
    if (record.view.surface === 'coach') return;
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
    if (mode !== 'off' && !session.autoRecapAttempted && exchangesOf(session).length === 0 && flagUsable(ready.bootstrap, ready.page.pageId, 'recap')) {
      const read = await ws.recaps.readStatus(ws.slotKey(ready));
      // The person left the chat while the status was read: nothing is started for another fan.
      if (stillOpen(session) === null) return giveUp({ code: 'CG-CONTEXT-CHANGED' });
      recap = autoRecapFor({ mode, attempted: false, hasExchanges: false, status: read.ok ? read.status : null, deepWindow: windowFor('recap', undefined, ready.settings, ready.bootstrap) });
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

  function retryAction(handle: string, turn: Pick<CoachFailedTurn, 'question' | 'preset'>): UiAction {
    return { type: 'Generate', targetHandle: handle, feature: 'coach', options: turn.preset === null ? { question: turn.question } : { preset: turn.preset } };
  }

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

  function exchangeVm(exchange: CoachExchange, outside: ReadonlySet<string>, situation: Situation): CoachTurnVM {
    const record = ws.ops.get(exchange.opId);
    const state = exchangeState(exchange, outside.has(exchange.turnId), record, situation);
    const known = built.get(exchange.turnId);
    if (known !== undefined && known.state === state) return known.vm;
    const vm = buildExchange(exchange, outside, record);
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
        prose: answer.prose,
        blocks: answer.blocks === null ? null : answer.blocks.map((block) => ({ kind: block.kind, title: msg(BLOCK_TITLES[block.kind]), body: block.body })),
        // Each draft is a message to the fan: its parts insert and copy like any other part.
        drafts: record === null ? [] : answer.drafts.map((draft) => ({ index: draft.index, label: msg('coach.draft', { n: draft.index + 1 }), parts: partVms(ws, record, draft.parts, draft.index, true) })),
      },
      error: null,
      errorActions: [],
      // AI-086: Б2 for one of the draft parts — the id `AnswerConfirm` takes.
      confirm: confirmVm(ws, exchange.opId),
      debug: turnDebug(record),
    };
  }

  function failedVm(turn: CoachFailedTurn, handle: string | null, canAsk: boolean): CoachTurnVM {
    const wire = turn.error;
    const again = handle === null ? null : retryAction(handle, turn);
    let actions: ActionButtonVM[] = [];
    if (wire !== null) actions = errorActions(wire, { catalog, now: clock.now(), again, againHotkey: null, openChat: null });
    // «Остановлено вами»: nothing failed, the question can simply be asked again.
    else if (again !== null) actions = [button('common.retry', again, { enabled: canAsk })];
    return {
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
    // The recap step of a composite turn shows its stages and its cancel; its text is not the Coach's answer.
    const answering = view !== null && view.feature === 'coach';
    const preview = answering && view.text !== undefined ? streamPreview('coach', view.text) : '';
    return {
      id: turn.turnId,
      opId: turn.opId,
      question: turn.question,
      askedAt: turn.askedAt,
      state: view === null || isTerminalOpState(view.state) ? 'admitted' : view.state,
      // The start is still on its way to the background (nothing is admitted yet): the first stage, nothing to cancel.
      phase: view === null ? { startedAt: turn.askedAt, stages: [{ id: 'context', label: msg('result.stage.context'), state: 'current' }], retryAt: null, cancel: null } : phaseVm(view, now),
      // AI-093: «Отправлено коучу…» until the hub's first frame.
      sentToCoach: answering && (view.state === 'admitted' || view.state === 'requesting'),
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
    // Until «Обновить переписку» is pressed: what the latest answer was built from.
    const last = session === null ? undefined : exchangesOf(session).at(-1);
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
    const pending = session?.pending ?? null;
    const { asOf, point } = chat === null ? { asOf: null, point: null } : archivePoint(session, chat.key);
    const lag = chat === null ? null : ws.archiveLag(point, chat.key);

    let view: VmView;
    if (chat === null) view = views.empty(msg('common.empty'));
    else if (ready === null) {
      const error = errorVm(ws.blockedError(situation), i18n);
      view = situation.status === 'loading-chat' ? views.loading(null, msg('dock.status.chatLoading')) : situation.status === 'hub-down' ? views.offline(error, { type: 'ReloadView', selector: { of: 'dock' } }) : views.forbidden(error);
    } else if (flag !== null && !flag.usable) view = views.forbidden(errorVm(flagRefusal(flag), i18n));
    else if (session === null || (session.feed.length === 0 && pending === null)) view = views.empty(msg('coach.empty.title'));
    else view = lag === null ? views.ready() : { s: 'partial', gaps: [{ kind: 'archive-lag', messages: lag.messages, minutes: null }] };

    // The one thing that keeps a question from being asked.
    const running = chat === null ? null : ws.running(chat.key);
    let askReason: ReasonVM | null = null;
    const off = ws.offReason(situation);
    if (off !== null) askReason = off;
    else if (!usable) askReason = flag === null ? catalog.reason('feature-disabled') : flagReasonVm(flag);
    else if (situation.quotaZero) askReason = catalog.reason('quota-zero', situation.quota === null ? undefined : { time: { time: situation.quota.resetsAt } });
    else if (pending !== null) askReason = catalog.reason('coach-busy');
    else if (running !== null) askReason = catalog.reason('chat-busy');
    const canAsk = askReason === null;

    const outside = session === null ? new Set<string>() : outsideMemory(session, historyLimit);
    const feed = session?.feed ?? [];
    const turns: CoachTurnVM[] = feed.map((item) => (item.kind === 'exchange' ? exchangeVm(item, outside, situation) : failedVm(item, chat?.handle ?? null, canAsk)));
    if (pending !== null) turns.push(pendingVm(pending));
    // Views of exchanges no dialog shows any more are not kept.
    if (built.size > feed.length + COACH_BUILT_SLACK) {
      const shown = new Set(feed.map((item) => item.turnId));
      for (const turnId of [...built.keys()]) if (!shown.has(turnId)) built.delete(turnId);
    }

    // AI-095: the recap the Coach stands on — the fresher of the two shared slots.
    const slots = ready === null ? { short: null, full: null } : ws.recaps.both(ws.slotKey(ready));
    const which = latestLength(slots);
    const copy = which === null ? null : slots[which];
    const hasExchange = session !== null && exchangesOf(session).length > 0;
    const chips = hasExchange
      ? FOLLOW_UP_CHIPS.map((key) => ({ label: msg(key), question: i18n.t(key), preset: null }))
      : OPENING_CHIPS.map((chip) => ({ label: msg(chip.key), question: i18n.t(chip.key), preset: chip.preset }));
    // AI-081: the empty dialog also offers three headings of ready questions; a click fills the input, the person sends.
    const emptyDialog = session === null || (session.feed.length === 0 && pending === null);
    const hints: CoachHintGroupVM[] = emptyDialog ? HINT_GROUPS.map((group) => ({ label: msg(group.label), questions: group.questions.map((key) => ({ label: msg(key), question: i18n.t(key) })) })) : [];

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
      recap: copy === null ? null : { length: copy.length, generatedAt: copy.revision, summary: copy.markdown },
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
    };
  }

  // ── actions ──────────────────────────────────────────────────────────────

  const handlers: ActionHandlers = {
    Generate(action, cause) {
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
    },
  });
}
