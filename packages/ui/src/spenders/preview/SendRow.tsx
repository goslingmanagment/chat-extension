// «Отправить» under one part of a preview result (architecture.md §6.7; ui-design
// §4.13; X8, SP-054, NF-019, NF-022). Nine states, one to one with
// PreviewSendView, with their exact words. The rules this file keeps:
// - a send is one click on one part's own button; there is no «send all», no
//   send key and no next part by itself;
// - the button goes off on the first click and stays off until the model
//   says what happened: a double click never makes two sends;
// - «Отправить ещё раз» exists only when the model says the retry is safe
//   (`canRetry`); the UI never decides it by the code;
// - an unknown outcome is a quiet mark with «Открыть чат» and «Отправить ещё
//   раз» — the person's own new click; nothing is ever repeated by itself
//   (2026-10-20 audit, row 2);
// - a freshness warning («фан написал новое», «не удалось проверить») offers
//   «Отправить всё равно» — the person's second, explicit click — and, when the
//   fan wrote, «Ещё раз» for a new answer (2026-10-20 audit, rows 3–4);
// - «Открыть и вставить» exists only where `offersOpenInsert` says so — for
//   the button here and for Enter on the part alike: never on a part whose
//   outcome is unknown, that is in work, that is held, or that waits behind
//   another part (§6.7.8, §6.7.9), whatever `openInsert` the model sent.

import { type ComponentChildren, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { cgBodyKey } from '@cg/contracts/i18n/keys';
import { SEND_REASON_KEYS, isSendReasonCode, type I18n, type PartVM, type PreviewSendView, type ResultVM, type UiAction } from '@cg/contracts/vm';

import { Button, Dot, Icon, Spinner, useCountdown, useDispatch, useHints, useI18n, useNowFn } from '../../kit';
import { sendWithMediaLabel, useMediaAttached } from './MediaPicker';

/** The text after «ChatGoose · CG-…:» split off its prefix, so the prefix can be set in its own ink. */
export function codeLineParts(i18n: I18n, code: string, text: string): { readonly prefix: string; readonly text: string } {
  const marker = '\u0000';
  const whole = i18n.t('send.codeLine', { code, text: marker });
  const cut = whole.indexOf(marker);
  if (cut < 0) return { prefix: whole, text };
  return { prefix: whole.slice(0, cut).trimEnd(), text: `${text}${whole.slice(cut + marker.length)}` };
}

/** Why a refused send did not go out: the upstream's own words, else the reason of the code. */
export function rejectedText(i18n: I18n, send: Extract<PreviewSendView, { s: 'rejected' }>): string {
  const detail = send.detail ?? (isSendReasonCode(send.code) ? i18n.t(SEND_REASON_KEYS[send.code]) : null);
  // A code with no reason text of its own: the registry's explanation, which already says the text did not go out.
  if (detail === null) return i18n.t(cgBodyKey(send.code));
  return i18n.t('send.rejectedTail', { detail: detail.trim().replace(/[.!?…]+$/, '') });
}

export function CodeLine({ code, text }: { readonly code: string; readonly text: string }): JSX.Element {
  const i18n = useI18n();
  const parts = codeLineParts(i18n, code, text);
  return (
    <span class="cg-pvs__code" data-cg-code={code}>
      <b>{parts.prefix}</b> {parts.text}
    </span>
  );
}

function State({ strong = true, children }: { readonly strong?: boolean; readonly children: ComponentChildren }): JSX.Element {
  return <span class={`cg-pvs__st${strong ? ' is-strong' : ''}`}>{children}</span>;
}

export function CopyIcon({ part }: { readonly part: PartVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const copied = part.copy === 'done';
  return (
    <Button
      label={copied ? i18n.t('common.copied') : i18n.t('part.copyN', { n: part.index + 1 })}
      icon={copied ? 'check' : 'copy'}
      iconOnly
      variant="quiet"
      class="cg-pvs__copy"
      onClick={() => void dispatch({ type: 'Copy', artifactHandle: part.copyHandle })}
    />
  );
}

/**
 * «Править» opens the part's editor, «Вернуть текст AI» closes it with the AI's text back (audit 2026-10-20, row 1).
 * Nothing goes by either: «Отправить» sends what the editor holds.
 */
function EditToggle({ part, opId }: { readonly part: PartVM; readonly opId: string }): JSX.Element | null {
  const i18n = useI18n();
  const hints = useHints();
  const dispatch = useDispatch();
  if (part.editing === true) return <Button label={i18n.t('part.revert')} variant="quiet" class="cg-pvs__revert" onClick={() => void dispatch(editPartAction(opId, part, null))} />;
  if (part.editable !== true) return null;
  return <Button label={i18n.t('part.edit')} variant="quiet" class="cg-pvs__edit" tooltip={hints ? i18n.t('part.editTooltip') : null} onClick={() => void dispatch(editPartAction(opId, part, part.text))} />;
}

function editPartAction(opId: string, part: PartVM, text: string | null): UiAction {
  return part.variant === null ? { type: 'EditPart', operationId: opId, part: part.index, text } : { type: 'EditPart', operationId: opId, variant: part.variant, part: part.index, text };
}

/** The queue has not reached this part: it waits behind an earlier one, or is held by an uncertain one (§6.7.9). */
function waitsForEarlierPart(part: PartVM): boolean {
  const send = part.send;
  return send !== undefined && (part.sendOrder ?? null) !== null && (send.s === 'available' || send.s === 'unavailable' || send.s === 'held-stale' || send.s === 'unverified');
}

/**
 * Whether this part's row carries «Открыть и вставить» (ui-design §4.13): a
 * part that can be sent now, cannot be sent, was refused with no safe retry,
 * or is held because the fan wrote since (the chat opens on the fan's new
 * message, the person decides). A part in work, sent, uncertain or waiting
 * behind another part has none — one uncertain part holds its whole group
 * (§6.7.8, §6.7.9). The button and Enter on the part both ask here, so the
 * keyboard never offers what the row does not show.
 */
export function offersOpenInsert(part: PartVM): boolean {
  const send = part.send;
  if (send === undefined) return part.openInsert !== undefined && part.openInsert.s !== 'hidden';
  if (waitsForEarlierPart(part)) return false;
  return send.s === 'available' || send.s === 'unavailable' || send.s === 'held-stale' || send.s === 'unverified' || (send.s === 'rejected' && !send.canRetry);
}

/** «Открыть и вставить»: the chat opens in ChatSpace by this click, then the part goes into its composer (§6.5). */
function OpenAndInsert({ part, opId }: { readonly part: PartVM; readonly opId: string }): JSX.Element | null {
  const i18n = useI18n();
  const hints = useHints();
  const dispatch = useDispatch();
  const now = useNowFn();
  const state = part.openInsert;
  const waiting = state?.s === 'waiting' ? state.until : null;
  const remaining = useCountdown(waiting, now);
  if (state === undefined || state.s === 'hidden' || !offersOpenInsert(part)) return null;
  if (state.s === 'waiting') {
    return (
      <State strong={false}>
        <Spinner />
        {i18n.t('send.openAndInsertWaiting', { n: Math.ceil(remaining / 1000) })}
      </State>
    );
  }
  return (
    <Button
      label={i18n.t('send.openAndInsert')}
      variant="quiet"
      class="cg-pvs__open"
      tooltip={hints ? i18n.t('send.openAndInsertTooltip') : null}
      reason={state.s === 'unavailable' ? i18n.text(state.reason.text) : null}
      onClick={() => void dispatch(openAndInsert(opId, part))}
    />
  );
}

export function openAndInsert(opId: string, part: PartVM): UiAction {
  return part.variant === null ? { type: 'OpenAndInsertPart', operationId: opId, part: part.index } : { type: 'OpenAndInsertPart', operationId: opId, variant: part.variant, part: part.index };
}

function sendPart(opId: string, part: PartVM, anyway: boolean): UiAction {
  const flag = anyway ? { anyway: true as const } : {};
  return part.variant === null ? { type: 'SendPart', operationId: opId, part: part.index, ...flag } : { type: 'SendPart', operationId: opId, variant: part.variant, part: part.index, ...flag };
}

/**
 * The «Отправить» button with its own lock: off from the first click until
 * the model says what happened (§6.7.7, блокировка 1). That is a new send
 * state of the part, or — when the state reads the same (a send held before
 * ChatSpace's queue, a retry refused the same way) — the model's next
 * snapshot of the part once the click was accepted. A refused dispatch
 * unlocks it — nothing was started.
 */
function SendButton({ part, opId, label, tooltip, anyway = false }: { readonly part: PartVM; readonly opId: string; readonly label: string; readonly tooltip: string; readonly anyway?: boolean }): JSX.Element {
  const hints = useHints();
  const dispatch = useDispatch();
  const [locked, setLocked] = useState(false);
  /** The click in work: the part as it was pressed, and whether the controller has accepted it. */
  const lock = useRef<{ readonly pressed: PartVM; accepted: boolean } | null>(null);
  const latest = useRef(part);
  latest.current = part;
  const unlock = (): void => {
    lock.current = null;
    setLocked(false);
  };
  const state = part.send?.s;
  useEffect(() => {
    // The model moved on (queued, sending, refused…): the lock has done its work.
    unlock();
  }, [state, opId, part.index, part.variant]);
  useEffect(() => {
    // The same state word in a snapshot that came after the accepted click: the model has answered.
    const held = lock.current;
    if (held !== null && held.accepted && held.pressed !== part) unlock();
  }, [part]);
  return (
    <Button
      label={label}
      variant="send"
      class="cg-pvs__send"
      tooltip={hints ? tooltip : null}
      busy={locked}
      onClick={() => {
        if (lock.current !== null) return;
        const held = { pressed: part, accepted: false };
        lock.current = held;
        setLocked(true);
        void dispatch(sendPart(opId, part, anyway)).then((receipt) => {
          // A new state has already taken the lock off.
          if (lock.current !== held) return;
          if (receipt === null || !receipt.ok) {
            unlock();
            return;
          }
          held.accepted = true;
          // The model's snapshot may have come before the receipt.
          if (latest.current !== held.pressed) unlock();
        });
      }}
    />
  );
}

export interface SendRowProps {
  readonly result: ResultVM;
  readonly part: PartVM;
}

/** The row under a part that is not sent yet; a sent part is the collapsed line of PreviewPart. */
export function SendRow({ result, part }: SendRowProps): JSX.Element | null {
  const i18n = useI18n();
  const hints = useHints();
  const dispatch = useDispatch();
  const send = part.send;
  // Decision X53: the picked media go with this part — the button says what goes, the price included.
  const withMedia = sendWithMediaLabel(i18n, useMediaAttached());
  if (send === undefined) {
    // A host with no send from the preview (Fansly: no X8 there, R20 P9e): «Открыть и вставить» and «Копировать»
    // only — quiet, as next to a refused part (ui-design §4.13); nothing blue, nothing reaches the fan from here.
    if (part.openInsert === undefined) return null;
    return (
      <div class="cg-pvs" data-cg-send="none">
        <OpenAndInsert part={part} opId={result.opId} />
        <CopyIcon part={part} />
      </div>
    );
  }
  const opId = result.opId;
  const order = part.sendOrder ?? null;
  // The first part of its answer that stands in this state: a warning of the whole answer is said there only.
  const siblings = part.variant === null ? (result.parts ?? []) : (result.variants?.[part.variant]?.parts ?? []);
  const lead = siblings.find((other) => other.send?.s === send.s)?.index === part.index;

  // The queue has not reached this part: it waits for an earlier one (§6.7.9).
  if (order !== null && waitsForEarlierPart(part)) {
    return (
      <div class="cg-pvs" data-cg-send="after">
        <State strong={false}>{i18n.t('send.after', { n: order.part })}</State>
        <CopyIcon part={part} />
      </div>
    );
  }

  switch (send.s) {
    case 'available':
      return (
        <div class="cg-pvs" data-cg-send="available">
          <SendButton part={part} opId={opId} label={withMedia ?? i18n.t('send.button')} tooltip={i18n.t(withMedia === null ? 'send.buttonTooltip' : 'send.buttonMediaTooltip')} />
          <OpenAndInsert part={part} opId={opId} />
          <EditToggle part={part} opId={opId} />
          <CopyIcon part={part} />
        </div>
      );
    case 'unavailable': {
      const reason = i18n.text(send.reason);
      return (
        <div class="cg-pvs" data-cg-send="unavailable">
          {/* Unavailable is a line button, not the blue one (ui-design §4.13). */}
          <Button label={i18n.t('send.button')} variant="line" class="cg-pvs__send" reason={i18n.t('send.unavailableReason', { reason })} />
          <OpenAndInsert part={part} opId={opId} />
          <EditToggle part={part} opId={opId} />
          <CopyIcon part={part} />
          <CodeLine code={send.code} text={i18n.t('send.unavailableReason', { reason })} />
        </div>
      );
    }
    case 'queued':
      return (
        <div class="cg-pvs" data-cg-send="queued">
          <State>
            <Dot kind="ring" />
            {i18n.t('send.queued')}
          </State>
        </div>
      );
    case 'sending':
      return (
        <div class="cg-pvs" data-cg-send="sending">
          <State>
            <Spinner />
            {i18n.t('send.sending')}
          </State>
        </div>
      );
    case 'accepted':
      return (
        <div class="cg-pvs" data-cg-send="accepted">
          <State>
            <Dot kind="pulse" />
            {i18n.t('send.accepted')}
          </State>
        </div>
      );
    case 'sent':
      return null;
    case 'rejected':
      return (
        <div class="cg-pvs" data-cg-send={send.canRetry ? 'rejected-retry' : 'rejected'}>
          <State>
            <Dot kind="danger" />
            {i18n.t('send.rejected')}
          </State>
          {send.canRetry ? <SendButton part={part} opId={opId} label={withMedia ?? i18n.t('send.retry')} tooltip={i18n.t('send.retryTooltip')} /> : <OpenAndInsert part={part} opId={opId} />}
          <EditToggle part={part} opId={opId} />
          <CopyIcon part={part} />
          <CodeLine code={send.code} text={rejectedText(i18n, send)} />
        </div>
      );
    case 'uncertain':
      return (
        <div class="cg-pvs" data-cg-send="uncertain">
          <State strong={false}>
            <Dot kind="ink" />
            {i18n.t('send.uncertain')}
          </State>
          <Button label={i18n.t('send.openToVerify')} variant="quiet" class="cg-pvs__verify" onClick={() => void dispatch({ type: 'OpenChatToVerify', attemptId: send.attemptId })} />
          <SendButton part={part} opId={opId} label={i18n.t('send.retry')} tooltip={i18n.t('send.uncertainRetryTooltip')} />
          <CopyIcon part={part} />
          <CodeLine code="CG-SEND-UNCERTAIN" text={i18n.t('send.uncertainTail', { time: { time: send.since } })} />
        </div>
      );
    case 'held-stale':
      return (
        <div class="cg-pvs" data-cg-send="held-stale">
          {/* The warning is the result's, not the part's: said once, on the first part it stands on. */}
          {lead ? (
            <State>
              <Dot kind="accent" use="send-held-stale" />
              {i18n.t('send.heldStale')}
            </State>
          ) : null}
          <SendButton part={part} opId={opId} anyway label={i18n.t('send.anyway')} tooltip={i18n.t('send.anywayTooltip')} />
          <Button
            label={i18n.t('common.again')}
            variant="line"
            class="cg-pvs__again"
            tooltip={hints ? i18n.t('result.againTooltip') : null}
            reason={result.canRegenerate ? null : result.regenerateReason === null ? i18n.t('common.unknown') : i18n.text(result.regenerateReason.text)}
            onClick={() => void dispatch({ type: 'Regenerate', operationId: opId })}
          />
          <OpenAndInsert part={part} opId={opId} />
          <EditToggle part={part} opId={opId} />
          <CopyIcon part={part} />
          {lead ? <CodeLine code="CG-SEND-STALE" text={i18n.t('send.heldStaleTail')} /> : null}
        </div>
      );
    case 'unverified':
      return (
        <div class="cg-pvs" data-cg-send="unverified">
          {/* Not an error: one quiet line on the first part it stands on, no code line — the button says what to do. */}
          {lead ? (
            <State>
              <Dot kind="accent" use="send-held-stale" />
              {i18n.t('send.unverified')}
            </State>
          ) : null}
          <SendButton part={part} opId={opId} anyway label={i18n.t('send.anyway')} tooltip={i18n.t('send.anywayTooltip')} />
          <OpenAndInsert part={part} opId={opId} />
          <EditToggle part={part} opId={opId} />
          <CopyIcon part={part} />
        </div>
      );
  }
}

/** What a part's send state reads as, for the live region («Часть 2: отправлено»). */
export function sendStateWords(i18n: I18n, send: PreviewSendView): string | null {
  switch (send.s) {
    case 'queued':
      return i18n.t('send.queued');
    case 'sending':
      return i18n.t('send.sending');
    case 'accepted':
      return i18n.t('send.accepted');
    case 'sent':
      return i18n.t('send.sent', { time: { time: send.at } });
    case 'rejected':
      return i18n.t('send.rejected');
    case 'uncertain':
      return i18n.t('send.uncertain');
    case 'held-stale':
      return i18n.t('send.heldStale');
    case 'unverified':
      return i18n.t('send.unverified');
    case 'available':
    case 'unavailable':
      return null;
  }
}

/** The collapsed line of a sent part: «✓ Отправлено 09:21» and Copy. */
export function SentLine({ part, at }: { readonly part: PartVM; readonly at: string }): JSX.Element {
  const i18n = useI18n();
  return (
    <span class="cg-pvp__a">
      <span class="cg-pvs__st">
        <Icon name="check" size={14} />
        {i18n.t('send.sent', { time: { time: at } })}
      </span>
      <CopyIcon part={part} />
    </span>
  );
}

export const SEND_ROW_CSS = `
.cg-pvs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 6px 0 0; min-height: 26px; }
.cg-pvs > .cg-pvs__st:first-child { padding-left: 0; }
.cg-pvs__st {
  display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; min-height: 26px; min-width: 0;
  font-size: var(--cg-text-sm2); line-height: 17px; color: var(--cg-ink-muted);
}
.cg-pvs__st > .cg-dot, .cg-pvs__st > .cg-spin, .cg-pvs__st > .cg-ico { flex: none; }
.cg-pvs__st.is-strong { color: var(--cg-ink-strong); font-weight: 500; }
.cg-pvs__code { flex-basis: 100%; font-size: var(--cg-text-sm); line-height: 17px; color: var(--cg-ink-muted); padding: 2px 8px 0; overflow-wrap: anywhere; }
.cg-pvs__code b { font-weight: 500; white-space: nowrap; color: var(--cg-ink-2); }
`;
