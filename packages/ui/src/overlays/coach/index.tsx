// @cg/ui/overlays/coach — the Coach window (ui-design §3.7, §4.19, §10;
// decision X63: the old Fansly extension's Coach — a 720 px window centred
// over the chat on a flat scrim, the owner's ruling of 2026-10-19; it replaces
// the 320 px side panel of §9.1 (б)). AI-080…AI-100.
// The session of the open chat from `CoachVM`, laid out as the old window:
// the head (the micro-caps «Coach» over the fan's name, ×), the topbar (the
// Recap Coach stands on and the freshness of the archive it reads on the left;
// «Recap ▾» — build a short or a full one, refresh the archive — and «Новый
// диалог» on the right), the conversation (questions in terracotta bubbles on
// the right, answers in bubbles on the left, drafts under them split into
// parts with Insert one at a time, as in the dock), the follow-up chips under
// the latest answer, the empty state (the ready questions that ask at once and
// the three headings of questions that fill the field), and the composer
// pinned to the bottom (↵ asks, ⇧↵ a new line, «Приложить мой ответ»,
// «Отменить» while Coach answers, «Спросить»).
// Opening it puts focus into the question field (AI-080); the window does not
// trap focus; Esc, × and a press on the scrim close it and the session stays;
// a draft part inserted into the composer closes it (the controller, AI-086),
// as the old one did, and the composer has the focus. A typed question belongs to the chat it was
// typed for (AI-099). A draft part asks the Б2 question in its place (AI-086);
// in debug mode a turn carries its debug footer (DB-019). What the hub layer
// does stays as it was: the core still treats Coach as a panel, so the AI keys
// keep working under it, and the streamed text repaints one text node a frame.
// A lazy overlay.

import { type ReadonlySignal } from '@preact/signals';
import { type JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { COACH_LIMITS } from '@cg/contracts/limits';
import { COACH_AUTO_RECAP } from '@cg/contracts/settings';
import { type ActionButtonVM, type CoachTurnVM, type CoachVM, type MountDeps } from '@cg/contracts/vm';

import {
  Button,
  Caret,
  Checkbox,
  Dot,
  ErrorCard,
  Icon,
  Markdown,
  Menu,
  MenuAnchor,
  OverlayLayer,
  Spinner,
  StageLine,
  TextField,
  ViewState,
  focusQuietly,
  menuTriggerKeys,
  mountKitSurface,
  useDispatch,
  useI18n,
  useKit,
  useMinuteClock,
  useNowFn,
  useView,
  type KitMount,
  type KitMountOptions,
  type MenuItem,
  type StyleSource,
  type SurfaceDefinition,
} from '../../kit';
import { RetryAnnouncer, useReadyAnnouncement, useStageAnnouncements } from '../../dock/announce';
import { CancelButton } from '../../dock/Head';
import { DEFAULT_PARTS } from '../../dock/lazy';
import { DebugSlot } from '../../dock/lazy-part';
import { isRunning, toneOf } from '../../dock/model';
import { Parts } from '../../dock/Parts';
import { StaleRow } from '../../dock/Result';
import { StreamText, useSteadyView, useStreamText } from '../../dock/Stream';
import { DOCK_STYLE } from '../../dock/styles';
import { overlayRootCss } from '../layer';

/**
 * Questions typed and not yet asked, by the handle of the chat they were typed
 * for (AI-099): a question survives closing the window and a switch to another
 * chat and back, and is never asked about a chat it was not written for. In
 * memory only, never stored; the chats written in last are kept.
 */
const unsent = new Map<string, string>();
/** How many chats keep an unasked question. */
export const UNSENT_QUESTIONS_MAX = 50;

/** The window: as wide as the old one, top-inset, at most this share of the window's height and never taller (X63). */
export const COACH_WINDOW = { width: 720, heightShare: 0.84, maxHeight: 860, inset: 20 } as const;

/**
 * Drops every unasked question. For the composition root when the person
 * signs out: the next one to sign in on this tab must not find them.
 */
export function forgetUnsentQuestions(): void {
  unsent.clear();
}

function remember(chat: string, question: string): void {
  // Written last, dropped last.
  unsent.delete(chat);
  if (question === '') return;
  unsent.set(chat, question);
  for (const oldest of unsent.keys()) {
    if (unsent.size <= UNSENT_QUESTIONS_MAX) break;
    unsent.delete(oldest);
  }
}

function Turn({ turn, raw, mode }: { readonly turn: CoachTurnVM; readonly raw: ReadonlySignal<CoachVM>; readonly mode: 'insert' | 'copy-only' }): JSX.Element {
  const i18n = useI18n();
  const text = useStreamText(raw, (coach) => coach.turns.find((item) => item.id === turn.id)?.streamText ?? null);
  const answer = turn.answer;
  const confirm = turn.confirm ?? null;
  const debug = turn.debug ?? null;
  const mark = turn.stale ?? null;
  const again = turn.again ?? null;
  const dispatch = useDispatch();
  // The live region: the stages of the wait, then «Ответ готов: 2 части» when the answer brought a draft.
  const said = turn.opId ?? turn.id;
  const waiting = isRunning(turn.state);
  useStageAnnouncements(i18n.t('coach.title'), waiting ? said : null, turn.phase);
  useReadyAnnouncement(said, waiting, turn.state === 'done', () => {
    const parts = answer?.drafts[0]?.parts.length ?? 0;
    return parts === 0 ? null : i18n.plural('result.announce.ready', parts);
  });
  const blocks = answer?.blocks ?? [];
  return (
    <>
      <div class="cg-co__q" data-cg-turn={turn.id}>
        <p class="cg-co__bubble">{turn.question}</p>
        {turn.attachedDraft ? (
          <span class="cg-co__with">
            <Icon name="check" size={12} />
            {i18n.t('coach.attached')}
          </span>
        ) : null}
      </div>
      <div class="cg-co__a" data-cg-answer={turn.id}>
        {waiting ? (
          // The wait and the answer as it is written: one bubble, the stage and its timer over the text (the old «Думаю… 12 с»).
          <div class="cg-co__bubble cg-co__wait" aria-busy="true">
            <div class="cg-co__stages">
              {turn.sentToCoach || turn.phase === null ? <span class="cg-co__sent">{i18n.t('coach.sentToCoach')}</span> : <StageLine phase={turn.phase} startedAt={turn.phase.startedAt} />}
            </div>
            <p class="cg-co__stream">
              <StreamText text={text} />
              <Caret />
            </p>
          </div>
        ) : null}
        {answer === null ? null : (
          <>
            {/* The site's verdict over the answer (R20 P8c): «Ещё раз» asks the question again. */}
            {mark === null ? null : <StaleRow mark={mark} onAgain={again === null ? null : () => void dispatch(again.action)} reason={again === null || again.enabled ? null : again.reason === null ? i18n.t('common.unknown') : i18n.text(again.reason.text)} />}
            {answer.prose === '' && blocks.length === 0 ? null : (
              <div class="cg-co__bubble">
                {answer.prose === '' ? null : <Markdown source={answer.prose} class="cg-co__md" />}
                {blocks.map((block, index) => (
                  <div key={index} class="cg-co__block" data-cg-block={block.kind}>
                    <div class="cg-co__cap">{i18n.text(block.title)}</div>
                    <Markdown source={block.body} class="cg-co__md" />
                  </div>
                ))}
              </div>
            )}
            {answer.drafts.map((draft) => (
              <div key={draft.index} class="cg-co__drafts" role="group" aria-label={i18n.text(draft.label)}>
                {/* The old card's title: «ЧЕРНОВИК», «ЧЕРНОВИК 2» when the answer brought two. */}
                <div class="cg-co__draft-cap">{answer.drafts.length > 1 ? i18n.text(draft.label) : i18n.t('coach.draftOne')}</div>
                <Parts
                  parts={draft.parts}
                  opId={turn.opId ?? ''}
                  mode={turn.opId === null ? 'copy-only' : mode}
                  // Б2 opens in the part it names (AI-086): with two drafts their parts carry the draft as `variant`.
                  confirm={confirm}
                  // The old card: only its buttons insert — a click to select a word of a draft does not put it into the
                  // composer and close the window.
                  rowClick={false}
                />
                {/* The old card's line: a draft in Cyrillic for a fan who does not write it is neither inserted nor copied (AI-087). */}
                {draft.note === null ? null : (
                  <p class="cg-co__draft-note" role="status">
                    {i18n.text(draft.note)}
                  </p>
                )}
              </div>
            ))}
          </>
        )}
        {turn.error === null ? null : <ErrorCard error={turn.error} tone={toneOf(turn.error)} actions={turn.errorActions} inline />}
        {turn.error !== null || turn.state !== 'canceled' ? null : (
          // «Остановлено вами» and «Повторить» (AI-092, the old window's stopped turn): nothing failed, the question can be asked again.
          <div class="cg-co__stopped">
            <span>{i18n.t('coach.canceled')}</span>
            {turn.errorActions.map((action, index) => (
              <Button
                key={index}
                label={i18n.text(action.label)}
                variant="line"
                size="sm"
                reason={action.enabled ? null : action.reason === null ? i18n.t('common.unknown') : i18n.text(action.reason.text)}
                onClick={() => void dispatch(action.action)}
              />
            ))}
          </div>
        )}
        <RetryAnnouncer error={turn.error} actions={turn.errorActions} />
        {debug === null ? null : (
          <div class="cg-co__debug">
            <DebugSlot loader={DEFAULT_PARTS.debug} debug={debug} startedAt={turn.phase?.startedAt ?? turn.askedAt} running={waiting} />
          </div>
        )}
      </div>
    </>
  );
}

/**
 * What Coach stands on (AI-095), always said: «Recap · полный · 3 д назад · короткий · 2 ч назад» — the Recaps the hub
 * attaches to every question, unfolding into their texts; «Recap · нет» — Coach answers from the chat alone;
 * «Recap · собирается…» while one is built.
 */
function RecapNote({ recaps, running }: { readonly recaps: CoachVM['recaps']; readonly running: boolean }): JSX.Element {
  const i18n = useI18n();
  const now = useNowFn();
  useMinuteClock();
  const label = <b>{i18n.t('dock.action.recap')}</b>;
  if (running)
    return (
      <span class="cg-co__recap is-running" role="status">
        {label}
        <Spinner />
        <span>{i18n.t('coach.recapRunning')}</span>
      </span>
    );
  if (recaps.length === 0)
    return (
      <span class="cg-co__recap is-none">
        {label}
        <span>{i18n.t('coach.recap.none')}</span>
      </span>
    );
  const said = (recap: CoachVM['recaps'][number]): string => i18n.t(recap.length === 'full' ? 'coach.recap.full' : 'coach.recap.short', { age: i18n.formatAge(recap.generatedAt, now()) });
  return (
    <details class="cg-co__recap">
      <summary>
        {label}
        <span>{recaps.map(said).join(' · ')}</span>
      </summary>
      {/* A Recap is a Markdown document: read as one, not as its source; two read one under the other, each named. */}
      <div class="cg-co__recap-text">
        {recaps.map((recap) => (
          <section key={recap.length}>
            {recaps.length > 1 ? <div class="cg-co__cap">{said(recap)}</div> : null}
            <Markdown source={recap.summary} />
          </section>
        ))}
      </div>
    </details>
  );
}

/** What Coach reads (AI-097): «Переписка на 06:20»; a lagging archive is the accent line with the refresh at hand. */
function Freshness({ freshness }: { readonly freshness: CoachVM['freshness'] }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { lag, asOf, refresh } = freshness;
  if (lag === null) return asOf === null ? null : <span class="cg-co__asof">{i18n.t('coach.archiveAsOf', { time: i18n.formatTime(asOf) })}</span>;
  return (
    <span class="cg-co__lag">
      <span class="is-lag">
        <Dot kind="accent" use="archive-lag" />
        {lag.messages === null ? i18n.t('common.coverage.partial') : i18n.t('coach.archiveLag', { n: lag.messages })}
      </span>
      <Button
        label={i18n.text(refresh.label)}
        icon="refresh"
        size="sm"
        variant="line"
        reason={refresh.enabled ? null : refresh.reason === null ? i18n.t('common.unknown') : i18n.text(refresh.reason.text)}
        onClick={() => void dispatch(refresh.action)}
      />
    </span>
  );
}

/**
 * «Recap ▾» (the old window's menu): build a short or a full Recap of this fan — the Recap sheet's own buttons with
 * their own reasons, the build shows where every Recap does — «Авто-Recap перед первым вопросом» (the setting
 * `generation.coach.autoRecap`, chosen where it acts), and «Обновить переписку».
 */
function RecapMenu({ refresh, auto }: { readonly refresh: CoachVM['freshness']['refresh']; readonly auto: CoachVM['autoRecap'] }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const picker = useSteadyView(useView({ of: 'recap.picker' })).value;
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const why = (button: ActionButtonVM): string | null => (button.enabled ? null : button.reason === null ? i18n.t('common.unknown') : i18n.text(button.reason.text));
  const buttons = { short: picker.build.short, full: picker.build.full, refresh } as const;
  const autoGroup = i18n.t('coach.recapMenu.auto');
  const items: MenuItem[] = [
    ...(['short', 'full'] as const).map((id) => ({ id, label: i18n.text(buttons[id].label), reason: why(buttons[id]) })),
    ...COACH_AUTO_RECAP.map((mode) => ({ id: `auto:${mode}`, label: i18n.t(`coach.recapMenu.auto.${mode}`), checked: mode === auto, kind: 'radio' as const, group: autoGroup })),
    { id: 'refresh', label: i18n.text(refresh.label), reason: why(refresh), group: '' },
  ];
  const label = i18n.t('dock.action.recap');
  return (
    <MenuAnchor>
      <Button
        label={`${label} ▾`}
        variant="line"
        class="cg-co__menu"
        haspopup="menu"
        expanded={open}
        buttonRef={trigger}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => menuTriggerKeys(event, () => setOpen(true))}
      />
      <Menu
        open={open}
        kind="action"
        label={label}
        items={items}
        align="end"
        placement="bottom"
        onSelect={(id) => {
          const mode = COACH_AUTO_RECAP.find((value) => id === `auto:${value}`);
          if (mode !== undefined) {
            if (mode !== auto) void dispatch({ type: 'SetPreference', key: 'generation.coach.autoRecap', value: mode });
            return;
          }
          const button = id === 'short' || id === 'full' || id === 'refresh' ? buttons[id] : null;
          if (button === null || !button.enabled) return;
          // Built from here, the Recap opens no window over Coach: the topbar follows it and shows it when it is done.
          void dispatch(button.action.type === 'RefreshRecap' ? { ...button.action, panel: true } : button.action);
        }}
        onClose={() => setOpen(false)}
        returnFocusTo={() => trigger.current}
      />
    </MenuAnchor>
  );
}

export function CoachView(): JSX.Element {
  const i18n = useI18n();
  const { deps, geometry } = useKit();
  const dispatch = useDispatch();
  const raw = useView({ of: 'coach' });
  const vm = useSteadyView(raw).value;
  // Coach follows the open chat: its target and the copy-only mode are the dock's.
  const dock = useSteadyView(useView({ of: 'dock' })).value;
  const handle = dock.targetHandle;
  // The chat the field belongs to now: what is typed is kept under it and read back from it.
  const chat = handle ?? '';
  const [, repaint] = useState(0);
  const question = unsent.get(chat) ?? '';
  /** «Приложить мой ответ» is pressed for one chat: another chat does not inherit it, and it is there again on the way back. */
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const attach = attachFor === chat;
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const last = vm.turns[vm.turns.length - 1];
  const answering = last !== undefined && isRunning(last.state);
  /** The feed is read at its end (the old window's rule): only then does it follow the answer; scrolled up, it stays put. */
  const pinned = useRef(true);
  const turnsSeen = useRef(vm.turns.length);
  // A new turn scrolls into view; its answer only while the feed is read at its end. A finished answer taller than the
  // feed opens at its start — its first lines, not the ready questions under it (third live check).
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null) return;
    const added = vm.turns.length !== turnsSeen.current;
    turnsSeen.current = vm.turns.length;
    // The empty dialog reads from its top: the invitation, then the ready questions under it.
    if (last === undefined) {
      element.scrollTop = 0;
      return;
    }
    if (!added && !pinned.current) return;
    pinned.current = true;
    const done = isRunning(last.state) ? null : [...element.querySelectorAll<HTMLElement>('[data-cg-answer]')].find((node) => node.dataset['cgAnswer'] === last.id);
    if (done !== undefined && done !== null && done.offsetHeight > element.clientHeight) {
      element.scrollTop += done.getBoundingClientRect().top - element.getBoundingClientRect().top;
    } else element.scrollTop = element.scrollHeight;
  }, [vm.turns.length, last?.state]);
  // The answer as it is written grows its bubble: the feed follows it to the end while it is read there.
  useLayoutEffect(() => {
    const element = list.current;
    const tail = element === null ? undefined : [...element.querySelectorAll<HTMLElement>('.cg-co__pair')].at(-1);
    if (element === null || tail === undefined || !answering || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(tail);
    return () => observer.disconnect();
  }, [vm.turns.length, answering]);
  const onFeedScroll = (): void => {
    const element = list.current;
    if (element !== null) pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  };
  // The window is mounted when the person opens Coach: the question field takes focus (AI-080).
  // A switch of the chat under an open window mounts nothing and moves no focus.
  useLayoutEffect(() => {
    focusQuietly(field.current);
  }, []);

  const close = (): void => void dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: false } });

  const keep = (where: string, value: string): void => {
    remember(where, value);
    repaint((count) => count + 1);
  };
  const canAsk = vm.ask.enabled && handle !== null;
  const whyNot = canAsk ? null : vm.ask.reason === null ? i18n.t('common.unknown') : i18n.text(vm.ask.reason.text);
  /** Asks about the open chat: the field's text (Enter, «Спросить») or a ready question. */
  const ask = (text: string, preset: 'situation' | null = null): void => {
    const body = text.trim();
    if (!canAsk || body === '') return;
    const withDraft = attach && vm.ask.attachDraft.available;
    void dispatch({
      type: 'Generate',
      targetHandle: handle,
      feature: 'coach',
      options: { question: body, ...(preset === null ? {} : { preset }), ...(withDraft ? { attachMyDraft: true } : {}) },
    }).then((receipt) => {
      // The question leaves the field only once its turn started (AI-099) — the field of the chat it was
      // asked in, and only if that field still holds exactly it: a ready question never wipes what is
      // being typed, and neither does the start of a turn the person has already typed past.
      if (receipt?.ok === true && unsent.get(chat) === text) keep(chat, '');
    });
  };
  /** A question of the empty dialog's headings goes into the field for the person to edit and ask (AI-081). */
  const fill = (text: string): void => {
    keep(chat, text);
    focusQuietly(field.current);
  };
  /** «Новый диалог» asks in its own place, as the old window did: «Точно начать заново?» and «Оставить». */
  const [arming, setArming] = useState(false);
  // Another chat's dialog is not reset by a question asked over this one.
  useLayoutEffect(() => setArming(false), [handle]);
  const newDialog = (): void => {
    if (vm.turns.length > 0 && !arming) return setArming(true);
    setArming(false);
    void dispatch(vm.newDialog.action);
  };

  const firstRemembered = vm.turns.findIndex((turn) => !turn.outsideMemory);
  const blocked = vm.view.s === 'loading' || vm.view.s === 'error' || vm.view.s === 'forbidden';
  const empty = !blocked && vm.turns.length === 0;
  const mode = dock.mode;
  // «Отменить» while Coach answers (the old window's red button): the running turn's own cancel, ⌘. as everywhere.
  const cancel = last !== undefined && isRunning(last.state) ? (last.phase?.cancel ?? null) : null;
  const chips = vm.chips.map((chip, index) => (
    <Button
      key={index}
      label={i18n.text(chip.label)}
      variant="line"
      class={chip.preset === null ? 'cg-co__chip' : 'cg-co__chip is-preset'}
      reason={whyNot}
      onClick={() => ask(chip.question, chip.preset)}
    />
  ));
  const hints = vm.hints ?? [];

  // Over the middle of the host's container (ChatSpace: right of its account rail, under its top bar), top-inset; the
  // CSS keeps it inside the window when the container's middle is nearer an edge than half the window's width.
  const box = geometry.value.container;
  const style =
    box === null
      ? {}
      : {
          '--cg-co-x': `${box.left + box.width / 2}px`,
          top: `${box.top + COACH_WINDOW.inset}px`,
          '--cg-co-room': `${Math.max(0, box.height - 2 * COACH_WINDOW.inset)}px`,
        };

  return (
    <OverlayLayer>
      <div class="cg-co-scrim" aria-hidden="true" onPointerDown={close} />
      <section
        class="cg-coach"
        role="dialog"
        aria-modal="false"
        aria-label={i18n.t('coach.title')}
        style={style}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            close();
            deps.focus.restore();
          }
        }}
      >
        <header class="cg-co__head">
          <div class="cg-co__title">
            <div class="cg-co__eyebrow">{i18n.t('coach.title')}</div>
            <div class="cg-co__name">{vm.targetName ?? i18n.t('coach.title')}</div>
          </div>
          <Button label={i18n.t('common.close')} icon="x" iconOnly variant="line" class="cg-co__close" onClick={close} />
        </header>
        <div class="cg-co__top">
          <div class="cg-co__status">
            <RecapNote recaps={vm.recaps} running={vm.recapRunning === true} />
            <Freshness freshness={vm.freshness} />
          </div>
          <div class="cg-co__tools">
            <RecapMenu refresh={vm.freshness.refresh} auto={vm.autoRecap} />
            <Button
              label={arming ? i18n.t('coach.newDialog.confirm') : i18n.text(vm.newDialog.label)}
              variant="line"
              class={arming ? 'cg-co__reset is-arming' : 'cg-co__reset'}
              tooltip={i18n.t('coach.newDialogTooltip')}
              reason={vm.newDialog.enabled ? null : vm.newDialog.reason === null ? i18n.t('common.unknown') : i18n.text(vm.newDialog.reason.text)}
              onClick={newDialog}
            />
            {arming ? <Button label={i18n.t('coach.newDialog.keep')} variant="quiet" onClick={() => setArming(false)} /> : null}
          </div>
        </div>
        <div ref={list} class="cg-co__feed" role="log" aria-label={i18n.t('coach.title')} onScroll={onFeedScroll}>
          {blocked || vm.view.s === 'offline' ? <ViewState view={vm.view} /> : null}
          {empty ? (
            <div class="cg-co__empty">
              <b>{i18n.t('coach.empty.title')}</b>
              <p>{i18n.t('coach.empty.body', { name: vm.targetName ?? i18n.t('common.unknown') })}</p>
              {vm.autoRecapNext === null ? null : <p class="cg-co__ahead">{i18n.t(vm.autoRecapNext === 'full' ? 'coach.empty.autoRecap.full' : 'coach.empty.autoRecap.short')}</p>}
              {chips.length === 0 ? null : <div class="cg-co__chips">{chips}</div>}
              {hints.length === 0 ? null : (
                <div class="cg-co__groups">
                  {hints.map((group, index) => (
                    <div key={index} class="cg-co__group" role="group" aria-label={i18n.text(group.label)}>
                      <div class="cg-co__cap">{i18n.text(group.label)}</div>
                      {group.questions.map((hint, at) => (
                        <Button key={at} label={i18n.text(hint.label)} variant="line" class="cg-co__hint" reason={whyNot} onClick={() => fill(hint.question)} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          {blocked
            ? null
            : vm.turns.map((turn, index) => (
                <div key={turn.id} class="cg-co__pair">
                  {index === firstRemembered && index > 0 ? (
                    <div class="cg-co__memory" role="separator">
                      <span>{i18n.t('coach.memoryBoundary')}</span>
                    </div>
                  ) : null}
                  <Turn turn={turn} raw={raw} mode={mode} />
                </div>
              ))}
          {!empty && !blocked && chips.length > 0 && last !== undefined && !isRunning(last.state) ? <div class="cg-co__chips is-follow">{chips}</div> : null}
        </div>
        <div class="cg-co__ask">
          <TextField
            value={question}
            onValue={(value) => keep(chat, value)}
            inputRef={field}
            label={i18n.t('coach.ask.aria')}
            placeholder={i18n.t('coach.ask.placeholder')}
            multiline
            minHeight={44}
            maxHeight={160}
            maxLength={COACH_LIMITS.questionMaxChars}
            onEnter={() => ask(question)}
          />
          <div class="cg-co__acts">
            <div class="cg-co__attach">
              <Checkbox
                label={i18n.t('coach.attachDraft')}
                checked={attach && vm.ask.attachDraft.available}
                semantics="toggle"
                onChange={(on) => setAttachFor(on ? chat : null)}
                reason={vm.ask.attachDraft.available ? null : vm.ask.attachDraft.reason === null ? i18n.t('common.unknown') : i18n.text(vm.ask.attachDraft.reason.text)}
              />
              <span class="cg-co__help">
                {vm.ask.attachDraft.available ? i18n.t('coach.attachHint') : vm.ask.attachDraft.reason === null ? i18n.t('coach.attachHint') : i18n.text(vm.ask.attachDraft.reason.text)}
              </span>
            </div>
            <div class="cg-co__send">
              <span class="cg-co__keys">{i18n.t('coach.ask.hint')}</span>
              {cancel === null ? null : <CancelButton action={cancel} />}
              <Button label={i18n.t('coach.ask.button')} variant="line" class="cg-co__go" reason={whyNot} onClick={() => ask(question)} />
            </div>
          </div>
        </div>
      </section>
    </OverlayLayer>
  );
}

export const COACH_CSS = `
${overlayRootCss('coach', 'panel')}
${/* The old window's scrim: flat, no blur; a press on it closes Coach as Esc does. */ ''}
.cg-co-scrim { position: fixed; inset: 0; background: var(--cg-scrim); }
${/* The window: 720 px over the middle of the host's container, 20 px from its top, a fixed height whose feed scrolls. */ ''}
.cg-coach {
  --cg-co-half: min(${COACH_WINDOW.width / 2}px, calc(50vw - ${COACH_WINDOW.inset}px));
  position: fixed; top: ${COACH_WINDOW.inset}px; translate: -50% 0; container: cg / inline-size;
  left: clamp(calc(var(--cg-co-half) + ${COACH_WINDOW.inset}px), var(--cg-co-x, 50vw), calc(100vw - var(--cg-co-half) - ${COACH_WINDOW.inset}px));
  width: calc(2 * var(--cg-co-half));
  height: min(${COACH_WINDOW.heightShare * 100}vh, ${COACH_WINDOW.maxHeight}px, var(--cg-co-room, 100vh));
  display: flex; flex-direction: column; gap: 12px; padding: 20px; box-sizing: border-box; overflow: hidden;
  background: var(--cg-surface); border: 1px solid var(--cg-rule-float); border-radius: var(--cg-r-xl); box-shadow: var(--cg-shadow-float);
  font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink);
  animation: cg-co-up 250ms cubic-bezier(0.16, 1, 0.3, 1);
}
.cg-coach > * { flex: none; }
@keyframes cg-co-up { from { opacity: 0; transform: translateY(8px); } }

${/* ── head: the micro-caps «Coach» in terracotta over the fan's name in serif, × in a square; a hairline under it ── */ ''}
.cg-co__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--cg-rule); }
.cg-co__title { display: grid; gap: 3px; min-width: 0; }
.cg-co__eyebrow { font-family: var(--cg-mono); font-size: 10px; line-height: 14px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cg-clay-ink); }
.cg-co__name { font-family: var(--cg-serif); font-size: 20px; line-height: 26px; font-weight: 600; letter-spacing: -0.01em; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-co__close { width: 32px; height: 32px; padding: 0; justify-content: center; flex: none; }

${/* ── topbar: what Coach stands on at the left, «Recap ▾» and «Новый диалог» at the right ── */ ''}
.cg-co__top { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 28px; }
.cg-co__status { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; min-width: 0; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-co__tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; flex: none; }
.cg-co__recap { min-width: 0; }
.cg-co__recap summary { display: flex; gap: 6px; cursor: pointer; list-style: none; }
.cg-co__recap summary::-webkit-details-marker { display: none; }
.cg-co__recap summary b { font-weight: 400; color: var(--cg-ink-muted); }
.cg-co__recap summary span { font-weight: 600; color: var(--cg-ink-2); }
.cg-co__recap.is-running { display: inline-flex; align-items: center; gap: 6px; }
.cg-co__recap.is-running b { font-weight: 400; color: var(--cg-ink-muted); }
.cg-co__recap.is-running span { color: var(--cg-ink-2); }
.cg-co__recap.is-none { display: inline-flex; gap: 6px; }
.cg-co__recap.is-none b { font-weight: 400; color: var(--cg-ink-muted); }
.cg-co__recap.is-none span { color: var(--cg-ink-muted); }
.cg-co__reset.is-arming { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); font-weight: 600; }
.cg-co__recap-text { position: absolute; left: 20px; right: 20px; z-index: 4; margin-top: 6px; padding: 10px 12px; max-height: 40vh; overflow-y: auto; overflow-wrap: anywhere; scrollbar-width: thin; background: var(--cg-surface); border: 1px solid var(--cg-rule-float); border-radius: var(--cg-r-lg); box-shadow: var(--cg-shadow-float); font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink-2); }
.cg-co__recap-text p, .cg-co__recap-text li { max-width: none; }
.cg-co__recap-text section + section { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--cg-rule-float); }
.cg-co__lag { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; }
.cg-co__lag .is-lag { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-strong); font-weight: 500; }
.cg-co__tools .cg-menu { min-width: 200px; }
.cg-co__top .cg-menu--bottom { top: calc(100% + 4px); }

${/* ── the conversation: a log of its own that scrolls; questions right, answers left; 20 px between turns ── */ ''}
.cg-co__feed { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding-right: 4px; }
.cg-co__pair { display: flex; flex-direction: column; gap: 8px; }
.cg-co__q { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.cg-co__a { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
.cg-co__a > * { max-width: 92%; }
.cg-co__a > .cg-co__drafts, .cg-co__a > .cg-card, .cg-co__a > .cg-co__debug { align-self: stretch; max-width: none; }
.cg-co__bubble { margin: 0; padding: 10px 12px; border-radius: 12px 12px 12px 4px; background: var(--cg-sunk); color: var(--cg-ink); font-size: var(--cg-text-base); line-height: 1.5; overflow-wrap: anywhere; min-width: 0; }
.cg-co__q .cg-co__bubble { max-width: 82%; padding: 8px 12px; border-radius: 12px 12px 4px 12px; background: var(--cg-clay-bg); line-height: 18px; white-space: pre-wrap; }
.cg-co__with { display: inline-flex; align-items: center; gap: 4px; font-size: var(--cg-text-xs); color: var(--cg-ink-muted); }
${/* The answer reads in the UI face, as in the old window (its approved exception); the drafts for the fan keep the serif. */ ''}
.cg-co__md, .cg-co__md p, .cg-co__md li { font-size: var(--cg-text-base); line-height: 1.5; color: var(--cg-ink); max-width: none; }
.cg-co__block { margin-top: 10px; }
.cg-co__block:first-child { margin-top: 0; }
.cg-co__block[data-cg-block="move"] { padding: 8px 10px; border: 1px dashed var(--cg-clay-line); border-radius: 9px; background: var(--cg-draft); }
.cg-co__cap { margin-bottom: 4px; font-family: var(--cg-mono); font-size: 10px; line-height: 14px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--cg-ink-muted); text-align: left; }
.cg-co__wait { display: grid; gap: 4px; min-width: 200px; }
.cg-co__stages { display: flex; align-items: center; min-width: 0; font-size: var(--cg-text-sm2); color: var(--cg-ink-2); }
.cg-co__stages .cg-timer { padding-left: 8px; color: var(--cg-ink-muted); }
.cg-co__sent { color: var(--cg-ink-2); }
.cg-co__stream { margin: 0; white-space: pre-wrap; }
.cg-co__stream:has(> .cg-stream__t:empty) { line-height: 14px; }
.cg-co__a > .cg-stale { align-self: stretch; max-width: none; margin: 0; grid-template-columns: 22px minmax(0, 1fr); row-gap: 4px; padding-bottom: 6px; }
.cg-co__a > .cg-stale > .cg-btn { grid-column: 2; justify-self: start; }
.cg-co__stopped { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-co__drafts { display: grid; gap: 6px; margin-top: 2px; }
.cg-co__drafts .cg-parts { padding: 0; }
.cg-co__draft-note { margin: 0; font-size: var(--cg-text-sm); line-height: 18px; color: var(--cg-danger); }
.cg-co__draft-cap { font-family: var(--cg-mono); font-size: 10px; line-height: 14px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--cg-clay-ink); }
.cg-co__debug .cg-debug { grid-template-columns: 32px minmax(0, 1fr); padding-right: 8px; }
${/* The memory line: centred words between two dashed hairlines. */ ''}
.cg-co__memory { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: var(--cg-text-xs); color: var(--cg-ink-muted); white-space: nowrap; }
.cg-co__memory::before, .cg-co__memory::after { content: ""; flex: 1 1 auto; border-top: 1px dashed var(--cg-rule-3); }
.cg-co__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cg-co__chips.is-follow { margin-top: -12px; max-width: 92%; }
.cg-co__chip { font-weight: 600; }
.cg-co__chip.is-preset:not([aria-disabled="true"]) { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); font-weight: 600; }
.cg-co__chip.is-preset:not([aria-disabled="true"]):hover { box-shadow: inset 0 0 0 1px var(--cg-clay-ink); }

${/* ── the empty dialog: in the middle of the feed, the ready questions under it, three headings in three columns ── */ ''}
.cg-co__empty { flex: 1 0 auto; display: flex; flex-direction: column; align-items: center; justify-content: safe center; gap: 10px; padding: 12px 2px; text-align: center; color: var(--cg-ink-2); }
.cg-co__empty b { font-size: var(--cg-text-xl); line-height: 20px; font-weight: 600; color: var(--cg-ink-strong); }
.cg-co__empty p { margin: 0; max-width: 46ch; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-co__empty p.cg-co__ahead { color: var(--cg-clay-ink); }
.cg-co__empty .cg-co__chips { justify-content: center; }
.cg-co__groups { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; width: 100%; margin-top: 6px; }
.cg-co__group { display: flex; flex-direction: column; align-items: stretch; gap: 6px; min-width: 0; }
.cg-co__hint { height: auto; min-height: 28px; padding-top: 5px; padding-bottom: 5px; justify-content: flex-start; text-align: left; white-space: normal; }
.cg-co__hint .cg-btn__t { white-space: normal; font-weight: 400; }

${/* ── the composer, pinned under the feed: the field, then «Приложить мой ответ» at the left and the buttons at the right ── */ ''}
.cg-co__ask { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid var(--cg-rule); }
.cg-co__acts { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.cg-co__attach { display: flex; flex-direction: column; gap: 2px; min-width: 0; margin-left: -7px; }
.cg-co__attach .cg-check { font-size: var(--cg-text-sm); font-weight: 400; }
.cg-co__help { padding-left: 29px; font-size: var(--cg-text-xs); line-height: 15px; color: var(--cg-ink-muted); }
.cg-co__help::first-letter { text-transform: uppercase; }
.cg-co__send { display: flex; align-items: center; gap: 6px; margin-left: auto; flex: none; }
.cg-co__keys { margin-right: 4px; font-size: var(--cg-text-xs); color: var(--cg-ink-muted); white-space: nowrap; }
.cg-co__send .cg-cancel { background: color-mix(in srgb, var(--cg-danger) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cg-danger) 35%, transparent); color: var(--cg-danger); }
${/* «Спросить» filled terracotta, a step larger than the rest, as the old «Отправить». */ ''}
.cg-co__go { height: 32px; padding: 0 16px; font-weight: 600; }
.cg-co__go:not([aria-disabled="true"]) { background: var(--cg-clay); box-shadow: none; color: #fff; }
.cg-co__go:not([aria-disabled="true"]):hover { background: var(--cg-clay-ink); }

${/* ── a narrow window (the old ≤ 720 px rules): less padding, the headings in one column, the keys line goes ── */ ''}
@container cg (max-width: 700px) {
  .cg-coach { padding: 14px; }
  .cg-co__name { font-size: 17px; line-height: 22px; }
}
@container cg (max-width: 560px) {
  .cg-co__groups { grid-template-columns: minmax(0, 1fr); }
  .cg-co__keys { display: none; }
  .cg-co__top { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) { .cg-coach { animation: none; } }
`;
export const COACH_STYLE: StyleSource = { id: 'cg-coach', css: COACH_CSS };

export const coachSurface: SurfaceDefinition = { view: CoachView, styles: [DOCK_STYLE, COACH_STYLE] };

export function mountCoach(root: ShadowRoot, deps: MountDeps, options: KitMountOptions = {}): KitMount {
  return mountKitSurface('coach', root, deps, coachSurface, options);
}
