// The card of «Новые» where the hub keeps the list (ChatSpace; architecture.md §8.5, §6.7; ui-design §4.17, X8): the
// family's card (./card.tsx) over the preview of the fan — the hub's archive only, the chat never opened. The field is
// the greeting: Hi's result as it came (one click per part: a greeting in parts goes part after part, each by its own
// «Отправить →»), the person's edit of it, or the person's own text (the preview's draft) when there is no result to
// send. «Отправить →» sends through ChatSpace's own queue (X8) with every check of the part's send; «Открыть и
// вставить» opens the chat with the part in its field. Where a send stands — queued, sent, refused, unknown — says the
// line under the bar, in the words of the preview's send (SendRow.tsx). The picked media go with the next send (X53).
// It renders PreviewVM and nothing else: it never reads ChatSpace and never loads a chat's history.

import { type JSX } from 'preact';

import { OP_TERMINAL_STATES, type OpState } from '@cg/contracts/ops';
import { type I18n, type NewcomersVM, type PartVM, type PreviewVM, type ResultVM, type UiAction } from '@cg/contracts/vm';

import { Button, Dot, Icon, Spinner, ViewState, useDispatch, useI18n, useMinuteClock, useTooltip, useView } from '../kit';
import { SeenMark } from '../spenders/preview/Feed';
import { MediaPicker, MediaToggle, sendWithMediaLabel } from '../spenders/preview/MediaPicker';
import { generateAction } from '../spenders/preview/MiniStrip';
import { LeaseNote, OwnLease, PreviewFeed, hasBody, metaLine, unreadWords, usePreviewKeys } from '../spenders/preview/Preview';
import { CodeLine, offersOpenInsert, rejectedText } from '../spenders/preview/SendRow';
import { coverageWord, timeOrUnknown } from '../spenders/window';
import { CardOpen, GreetingEditor, GreetingState, NewcomerCard, NoCard, type EditorButton, type EditorSend, type GreetingModel } from './card';

const running = (state: OpState): boolean => !(OP_TERMINAL_STATES as readonly OpState[]).includes(state);

/** The parts of a finished Hi (one variant in «Новые»). */
function partsOf(result: ResultVM | null): readonly PartVM[] {
  if (result === null || result.state !== 'done') return [];
  return result.parts ?? result.variants?.[0]?.parts ?? [];
}

const sentOf = (part: PartVM): boolean => part.send?.s === 'sent' || part.collapsed;

const ref = (opId: string, part: PartVM): { readonly operationId: string; readonly part: number; readonly variant?: number } =>
  part.variant === null ? { operationId: opId, part: part.index } : { operationId: opId, variant: part.variant, part: part.index };

/** «Хаб недоступен» → «хаб недоступен» after a colon; «AI…», «ChatSpace…» stay as they are. */
function inSentence(title: string): string {
  const first = title.charAt(0);
  const next = title.charAt(1);
  return /[А-ЯЁ]/.test(first) && next === next.toLowerCase() ? first.toLowerCase() + title.slice(1) : title;
}

/** The archive's time and that the chat stays unread, in one quiet line under the head, with «Обновить архив». */
function Notes({ vm }: { readonly vm: PreviewVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { words, tooltip } = unreadWords(i18n, vm.unread);
  const tip = useTooltip(tooltip);
  const { archive } = vm;
  const refresh = archive.refresh;
  const time = timeOrUnknown(i18n, archive.stamp.asOf);
  const asOf = archive.lagMinutes === null ? i18n.t('common.archiveAsOf', { time }) : i18n.t('preview.archiveLag', { time, n: archive.lagMinutes });
  return (
    <div class="cg-nc__note" data-cg-unread={vm.unread}>
      <Icon name="eyeOff" size={14} />
      <span {...tip.props}>
        {words}
        {tip.description}
      </span>
      <span class="cg-nw__grow" />
      {vm.fanWroteNew ? (
        // The fan's new text is not shown until the archive has it (§6.7.5): only this line.
        <span class="cg-nc__lag" role="status">
          <Dot kind="accent" use="preview-fan-wrote" />
          {i18n.t('preview.fanWroteNew')}
        </span>
      ) : (
        <span class="cg-num">
          {asOf}
          {archive.stamp.coverage === 'partial' ? ` · ${coverageWord(i18n, archive.stamp.coverage)}` : ''}
        </span>
      )}
      <Button
        label={i18n.text(refresh.label)}
        variant="quiet"
        size="sm"
        busy={archive.refreshing}
        reason={refresh.enabled ? null : refresh.reason === null ? i18n.t('common.unknown') : i18n.text(refresh.reason.text)}
        onClick={() => void dispatch(refresh.action)}
      />
    </div>
  );
}

/** «Открыть чат» of an unknown outcome: the chat opens so the person sees whether the part is there. */
function VerifyButton({ attemptId }: { readonly attemptId: string }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return <Button label={i18n.t('send.openToVerify')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'OpenChatToVerify', attemptId })} />;
}

/** «Отправить →» of one part and the line of where its send stands (ui-design §4.13, the words of SendRow.tsx). */
function partSend(i18n: I18n, opId: string, part: PartVM, label: string, last: boolean): { readonly send: EditorSend; readonly state: JSX.Element | null } {
  const send = part.send;
  const base = { label, stamp: part, last, state: send?.s ?? 'none', tooltip: i18n.t('send.buttonTooltip') };
  const go = (anyway = false): UiAction => ({ type: 'SendPart', ...ref(opId, part), ...(anyway ? { anyway: true as const } : {}) });
  if (send === undefined) return { send: { ...base, action: null, reason: i18n.t('send.unavailable') }, state: null };
  switch (send.s) {
    case 'available':
      return { send: { ...base, action: go(), reason: null }, state: null };
    case 'unavailable': {
      const reason = i18n.t('send.unavailableReason', { reason: i18n.text(send.reason) });
      return { send: { ...base, action: null, reason }, state: <GreetingState code={send.code} tail={<CodeLine code={send.code} text={reason} />} /> };
    }
    case 'queued':
      return { send: { ...base, action: null, reason: null, busy: true }, state: <GreetingState mark={<Dot kind="ring" />} words={i18n.t('send.queued')} /> };
    case 'sending':
      return { send: { ...base, action: null, reason: null, busy: true }, state: <GreetingState mark={<Spinner />} words={i18n.t('send.sending')} /> };
    case 'accepted':
      return { send: { ...base, action: null, reason: null, busy: true }, state: <GreetingState mark={<Dot kind="pulse" />} words={i18n.t('send.accepted')} /> };
    case 'sent':
      return { send: { ...base, action: null, reason: i18n.t('send.sent', { time: { time: send.at } }) }, state: null };
    case 'rejected': {
      const why = rejectedText(i18n, send);
      return {
        send: send.canRetry ? { ...base, label: i18n.t('send.retry'), tooltip: i18n.t('send.retryTooltip'), action: go(), reason: null } : { ...base, action: null, reason: why },
        state: <GreetingState mark={<Dot kind="danger" />} words={i18n.t('send.rejected')} code={send.code} tail={<CodeLine code={send.code} text={why} />} />,
      };
    }
    case 'uncertain':
      // Nothing is repeated by itself: the person opens the chat, and sends again by their own click if it is not there.
      return {
        send: { ...base, label: i18n.t('send.retry'), tooltip: i18n.t('send.uncertainRetryTooltip'), action: go(), reason: null },
        state: (
          <GreetingState mark={<Dot kind="ink" />} strong={false} words={i18n.t('send.uncertain')} code="CG-SEND-UNCERTAIN" attrs={{ 'data-cg-uncertain': '1' }} tail={<CodeLine code="CG-SEND-UNCERTAIN" text={i18n.t('send.uncertainTail', { time: { time: send.since } })} />}>
            <VerifyButton attemptId={send.attemptId} />
          </GreetingState>
        ),
      };
    case 'held-stale':
      return {
        send: { ...base, label: i18n.t('send.anyway'), tooltip: i18n.t('send.anywayTooltip'), action: go(true), reason: null },
        state: <GreetingState mark={<Dot kind="accent" use="send-held-stale" />} words={i18n.t('send.heldStale')} code="CG-SEND-STALE" tail={<CodeLine code="CG-SEND-STALE" text={i18n.t('send.heldStaleTail')} />} />,
      };
    case 'unverified':
      return {
        send: { ...base, label: i18n.t('send.anyway'), tooltip: i18n.t('send.anywayTooltip'), action: go(true), reason: null },
        state: <GreetingState mark={<Dot kind="accent" use="send-held-stale" />} words={i18n.t('send.unverified')} />,
      };
    // Chat Memory week 1: another chatter is talking to the fan — a warning, «Отправить всё равно» passes it.
    case 'held-talking':
      return {
        send: { ...base, label: i18n.t('send.anyway'), tooltip: i18n.t('send.anywayTooltip'), action: go(true), reason: null },
        state: <GreetingState mark={<Dot kind="accent" use="send-held-stale" />} words={i18n.t('send.talking', { names: send.names.join(', ') })} />,
      };
  }
}

/** «Открыть и вставить» of a part, where its send state offers it (SendRow.tsx `offersOpenInsert`). */
function partInsert(i18n: I18n, opId: string, part: PartVM): EditorButton | null {
  const state = part.openInsert;
  if (state === undefined || state.s === 'hidden' || !offersOpenInsert(part)) return null;
  return {
    label: i18n.t('send.openAndInsert'),
    tooltip: i18n.t('send.openAndInsertTooltip'),
    action: state.s === 'available' ? { type: 'OpenAndInsertPart', ...ref(opId, part) } : null,
    reason: state.s === 'unavailable' ? i18n.text(state.reason.text) : null,
    busy: state.s === 'waiting',
  };
}

/** The card's greeting from the preview: Hi's part on its way to the fan, else the person's own text. */
function greetingOf(i18n: I18n, vm: PreviewVM, handle: string): GreetingModel {
  const result = vm.result;
  const hi = vm.bar.actions.hi;
  const start = generateAction(vm, 'hi');
  const generate: EditorButton = {
    label: i18n.t('newcomers.card.generate'),
    tooltip: i18n.t('newcomers.noAutoSend'),
    action: start,
    busy: hi?.busy === true,
    reason: hi === undefined || hi.enabled || hi.busy ? null : hi.reason === null ? i18n.t('common.unknown') : i18n.text(hi.reason.text),
  };
  const withMedia = sendWithMediaLabel(i18n, vm.media?.attached ?? null);
  const sendLabel = withMedia ?? i18n.t('newcomers.card.send');
  const common = {
    label: i18n.t('newcomers.card.label'),
    placeholder: i18n.t('newcomers.card.placeholder'),
    maxChars: vm.draft.maxChars,
    note: null,
    generate,
    extra: vm.media === null ? null : <MediaToggle vm={vm.media} handle={handle} />,
    below: (
      <>
        {vm.claim !== null && vm.claim.s === 'mine' ? <OwnLease claim={vm.claim} /> : null}
        {vm.media === null ? null : <MediaPicker vm={vm.media} handle={handle} />}
      </>
    ),
  };
  const lease = vm.claim === null ? null : <LeaseNote claim={vm.claim} hasResult={result !== null} stoppedNote={vm.stoppedNote} />;

  // Hi is writing: the field waits for it.
  if (result !== null && running(result.state)) {
    const words = i18n.t('newcomers.card.generating');
    return {
      ...common,
      scope: `${handle}|gen|${result.opId}`,
      text: result.streamText ?? '',
      edit: null,
      locked: words,
      ai: null,
      insert: null,
      send: { label: sendLabel, action: null, reason: words, state: 'generating', stamp: result, last: true },
      state: <GreetingState mark={<Spinner />} words={words} />,
      stage: 'generating',
    };
  }

  // The result's next part to go: the field holds it, «Отправить →» sends it.
  const parts = partsOf(result);
  const at = parts.findIndex((part) => !sentOf(part));
  const part = parts[at];
  if (result !== null && part !== undefined) {
    const last = parts.slice(at + 1).every(sentOf);
    const { send, state } = partSend(i18n, result.opId, part, part.send?.s === 'available' ? sendLabel : i18n.t('newcomers.card.send'), last);
    const editable = part.editable === true || part.editing === true;
    const progress = result.sendProgress;
    return {
      ...common,
      scope: `${handle}|part|${result.opId}|${part.variant ?? 0}|${part.index}`,
      text: part.text,
      edit: editable ? (text) => ({ type: 'EditPart', ...ref(result.opId, part), text }) : null,
      locked: send.busy === true ? i18n.t('send.sending') : null,
      ai: part.edited === true || result.own === true ? null : { label: i18n.t('newcomers.card.ai'), tooltip: i18n.t('newcomers.card.aiTooltip') },
      lead:
        parts.length < 2
          ? null
          : [i18n.t('newcomers.card.part', { n: part.index + 1, total: parts.length }), progress === null || progress.sent === 0 ? null : i18n.t('newcomers.status.sending', { sent: progress.sent, total: progress.total }).toLocaleLowerCase()]
              .filter((piece) => piece !== null)
              .join(' · '),
      insert: partInsert(i18n, result.opId, part),
      send,
      state: (
        <>
          {state}
          {lease}
        </>
      ),
      stage: part.send?.s ?? 'ready',
    };
  }

  // No part to send: the person's own text — after a greeting that went, or a Hi that made no draft.
  const own = vm.draft.send;
  const sentAt = parts.length > 0 ? parts.map((one) => (one.send?.s === 'sent' ? one.send.at : null)).reduce((a, b) => b ?? a, null) : null;
  const failed = result !== null && (result.state === 'failed' || result.state === 'interrupted') ? result.error : null;
  let state: JSX.Element | null = null;
  if (failed !== null) {
    state = (
      <GreetingState mark={<Dot kind="danger" />} words={i18n.t('newcomers.card.notDrafted', { reason: inSentence(failed.title) })} code={failed.code} attrs={{ 'data-cg-not-drafted': '1' }} tail={`ChatGoose · ${failed.code}`} />
    );
  } else if (sentAt !== null) {
    state = <GreetingState class="is-sent" mark={<Icon name="check" />} strong={false} words={i18n.t('send.sent', { time: { time: sentAt } })} />;
  }
  return {
    ...common,
    scope: `${handle}|draft`,
    text: vm.draft.text,
    edit: (text) => ({ type: 'SetPreviewDraft', targetHandle: handle, text }),
    locked: null,
    ai: null,
    insert: null,
    send: {
      label: sendLabel,
      tooltip: i18n.t('preview.draft.sendTooltip'),
      action: own?.enabled === true ? { type: 'SendDraft', targetHandle: handle } : null,
      reason: own === undefined ? i18n.t('send.unavailable') : own.enabled ? null : own.reason === null ? i18n.t('common.unknown') : i18n.text(own.reason.text),
      state: 'draft',
      stamp: vm.draft,
      last: true,
    },
    state: (
      <>
        {state}
        {lease}
      </>
    ),
    stage: failed !== null ? 'not-drafted' : sentAt !== null ? 'sent' : 'idle',
  };
}

/** ChatSpace's card in the window: the preview of the fan the list chose, in the family's card. */
export function HubCard({ vm: list }: { readonly vm: NewcomersVM }): JSX.Element {
  const i18n = useI18n();
  const preview = useView({ of: 'preview', from: 'newcomers' });
  const vm = preview.value;
  // «подписался 14 мин назад» moves with the clock.
  useMinuteClock(vm.header !== null);
  const onKeyDown = usePreviewKeys(vm);
  const label = i18n.t('newcomers.cardLabel');
  const header = vm.header;
  const handle = vm.handle;
  if (!list.cardOpen || header === null || handle === null) {
    return <NoCard label={label} loading={list.view.s === 'loading' || (list.cardOpen && vm.view.s === 'loading') ? <Spinner label={i18n.t('common.loading')} /> : null} text={list.rows.length === 0 ? null : i18n.t('newcomers.card.empty')} />;
  }
  const meta = [header.username === null ? null : `@${header.username}`, metaLine(i18n, header)].filter((piece) => piece !== null).join(' · ');
  const body = hasBody(vm);
  return (
    <NewcomerCard
      handle={handle}
      label={label}
      name={header.name}
      badges={header.badges ?? null}
      meta={
        <>
          {meta}
          {/* Our newest message is not in the archive yet: whether the fan read it stands by the ages. */}
          {vm.seen !== null && !vm.seen.inFeed ? <SeenMark seen={vm.seen} /> : null}
        </>
      }
      open={<CardOpen label={i18n.text(vm.openChat.label)} action={vm.openChat.action} reason={vm.openChat.enabled ? null : vm.openChat.reason === null ? i18n.t('common.unknown') : i18n.text(vm.openChat.reason.text)} />}
      notes={
        body ? (
          <>
            <Notes vm={vm} />
            {vm.view.s === 'offline' ? <ViewState view={vm.view} /> : null}
          </>
        ) : null
      }
      greeting={body ? <GreetingEditor model={greetingOf(i18n, vm, handle)} /> : null}
      onKeyDown={onKeyDown}
    >
      {body ? (
        <PreviewFeed vm={vm} />
      ) : (
        <div class="cg-nc__state">
          <ViewState view={vm.view} />
        </div>
      )}
    </NewcomerCard>
  );
}
