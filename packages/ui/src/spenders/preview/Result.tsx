// The result of a generation inside a preview (ui-design §4.16, §4.13, §4.2,
// §4.4; SP-054, SP-055, UI-029): a sticky head without key labels, the stage
// line while it streams, then the parts — each with its «Отправить» row — or
// the error card. Nothing here inserts or sends by itself: Enter on a focused
// part is «Открыть и вставить» for THAT part — and only where its row shows
// that button —, a send is only a click on a part's own button.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type I18n, type Msg, type PartVM, type PreviewSendView, type ResultVM } from '@cg/contracts/vm';

import { Button, Caret, ErrorCard, Spinner, StageLine, focusQuietly, isComposing, useAnnounce, useDispatch, useHints, useI18n, useKit, useTooltip } from '../../kit';
import { SendRow, SentLine, offersOpenInsert, openAndInsert, sendStateWords } from './SendRow';

/** Function names are Latin and the same in every language (ui-design §1 п. 13). */
const FEATURE_KEYS: Readonly<Partial<Record<ResultVM['feature'], I18nKey>>> = {
  reply: 'dock.action.reply',
  fix: 'dock.action.fix',
  hi: 'dock.action.hi',
  ping: 'dock.action.ping',
};

const RUNNING: readonly ResultVM['state'][] = ['admitted', 'requesting', 'streaming'];

function allParts(result: ResultVM): readonly PartVM[] {
  return result.variants !== null ? result.variants.flatMap((variant) => variant.parts) : (result.parts ?? []);
}

function partKey(part: PartVM): string {
  return `${part.variant ?? 0}:${part.index}`;
}

/** «отправлено 1 из 3» with the count set strong. */
function Progress({ text }: { readonly text: string }): JSX.Element {
  const match = /^(\D*)(\d.*\d|\d)(\D*)$/u.exec(text);
  if (match === null) return <span class="cg-pvr__progress">{text}</span>;
  return (
    <span class="cg-pvr__progress cg-num">
      {match[1]}
      <b>{match[2]}</b>
      {match[3]}
    </span>
  );
}

function metaTexts(i18n: I18n, result: ResultVM): string[] {
  // The progress has its own place in the head: a meta item saying the same is not printed twice.
  const metas: readonly Msg[] = result.sendProgress === null ? result.meta : result.meta.filter((item) => item.key !== 'result.meta.sentProgress');
  return metas.map((item) => i18n.text(item));
}

function Head({ result }: { readonly result: ResultVM }): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  const dispatch = useDispatch();
  const running = RUNNING.includes(result.state);
  const draft = useTooltip(hints ? i18n.t('result.draftTooltip') : null);
  const titleKey = FEATURE_KEYS[result.feature];
  const metas = metaTexts(i18n, result);
  const cancel = result.phase?.cancel ?? null;
  return (
    <div class="cg-pvr__head">
      <span class="cg-gut cg-pvr__gut">{running ? <Spinner /> : null}</span>
      <span class="cg-pvr__title">{titleKey === undefined ? result.feature : i18n.t(titleKey)}</span>
      {running && result.phase !== null ? (
        <StageLine phase={result.phase} startedAt={result.startedAt} />
      ) : metas.length === 0 ? null : (
        <span class="cg-pvr__meta">{metas.join(', ')}</span>
      )}
      {result.sendProgress === null ? null : <Progress text={i18n.t('result.meta.sentProgress', { sent: result.sendProgress.sent, total: result.sendProgress.total })} />}
      {result.draftNotSent ? (
        <span class="cg-pvr__draft" {...draft.props}>
          {i18n.t('result.draft')}
          {draft.description}
        </span>
      ) : null}
      <span class="cg-pvr__sp" />
      {running ? (
        cancel === null ? null : <Button label={i18n.t('common.cancelOp')} variant="plain" onClick={() => void dispatch(cancel)} />
      ) : (
        <Button
          label={i18n.t('common.again')}
          variant="plain"
          tooltip={hints ? i18n.t('result.againTooltip') : null}
          reason={result.canRegenerate ? null : result.regenerateReason === null ? i18n.t('common.unknown') : i18n.text(result.regenerateReason.text)}
          onClick={() => void dispatch({ type: 'Regenerate', operationId: result.opId })}
        />
      )}
    </div>
  );
}

interface PreviewPartProps {
  readonly result: ResultVM;
  readonly part: PartVM;
  readonly tabStop: boolean;
  readonly onStep: (part: PartVM, direction: 1 | -1) => void;
}

function PreviewPart({ result, part, tabStop, onStep }: PreviewPartProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const announce = useAnnounce();
  const { root } = useKit();
  const n = part.index + 1;
  const sentAt = part.send?.s === 'sent' ? part.send.at : null;
  const collapsed = sentAt !== null || part.collapsed;
  const fullText = useTooltip(collapsed ? part.text : null);

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    // Only the part itself: a key inside one of its buttons belongs to that button («Отправить» in focus + Enter is its click).
    if (event.defaultPrevented || event.target !== event.currentTarget || isComposing(event)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      onStep(part, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      // Enter and ⌘↵ / Ctrl+↵: «Открыть и вставить» this part — never a send (ui-design §6.4, HK-042) —, and
      // only what the row's own button offers: nothing on a part that is uncertain, held or waiting (§6.7.8).
      event.preventDefault();
      const open = part.openInsert;
      if (collapsed || open === undefined || !offersOpenInsert(part)) return;
      if (open.s === 'available') void dispatch(openAndInsert(result.opId, part));
      else if (open.s === 'unavailable') announce(i18n.text(open.reason.text));
      return;
    }
    // The physical C key, so the Russian layout copies too; a selection inside wins.
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.code === 'KeyC') {
      const selection = 'getSelection' in root && typeof root.getSelection === 'function' ? root.getSelection() : event.currentTarget.ownerDocument.getSelection();
      if (selection !== null && !selection.isCollapsed && selection.anchorNode !== null && event.currentTarget.contains(selection.anchorNode)) return;
      event.preventDefault();
      void dispatch({ type: 'Copy', artifactHandle: part.copyHandle });
    }
  };

  return (
    <div
      class={`cg-pvp${collapsed ? ' is-done' : ''}`}
      role="group"
      aria-label={sentAt === null ? i18n.text(part.label) : i18n.t('part.ariaSent', { n })}
      tabIndex={tabStop ? 0 : -1}
      data-cg-part={part.index}
      {...(part.variant === null ? {} : { 'data-cg-variant': part.variant })}
      {...(part.send === undefined ? {} : { 'data-cg-send-state': part.send.s })}
      onKeyDown={onKeyDown}
    >
      <span class="cg-pvp__n" aria-hidden="true">
        {part.numbered ? n : ''}
      </span>
      <div class="cg-pvp__main">
        <div class="cg-pvp__t" {...fullText.props}>
          {part.text}
          {fullText.description}
        </div>
        {collapsed ? null : <SendRow result={result} part={part} />}
        {!collapsed && part.copy === 'failed' && part.copyError !== null ? (
          <div class="cg-pvp__card">
            <ErrorCard error={part.copyError} tone="failure" inline copyCode={false} />
          </div>
        ) : null}
        {!collapsed && part.insert === 'failed' && part.insertError !== null ? (
          <div class="cg-pvp__card">
            <ErrorCard error={part.insertError} tone="failure" inline />
          </div>
        ) : null}
      </div>
      {sentAt === null ? null : <SentLine part={part} at={sentAt} />}
    </div>
  );
}

/** Says a part's new send state once («Часть 2. Отправлено 09:21»); the first render is silent. */
function useSendAnnouncements(result: ResultVM): void {
  const i18n = useI18n();
  const announce = useAnnounce();
  const seen = useRef<{ opId: string; states: Map<string, PreviewSendView['s']> } | null>(null);
  useEffect(() => {
    const states = new Map<string, PreviewSendView['s']>();
    for (const part of allParts(result)) if (part.send !== undefined) states.set(partKey(part), part.send.s);
    const before = seen.current;
    if (before !== null && before.opId === result.opId) {
      for (const part of allParts(result)) {
        const send = part.send;
        if (send === undefined || before.states.get(partKey(part)) === send.s) continue;
        const words = sendStateWords(i18n, send);
        if (words !== null) announce(`${i18n.text(part.label)}. ${words}`);
      }
    }
    seen.current = { opId: result.opId, states };
  }, [result, i18n, announce]);
}

export interface PreviewResultProps {
  readonly result: ResultVM;
  /** «Дальше не отправляем, пока неясно, ушла ли часть 2…» under the parts (ui-design §4.17). */
  readonly stoppedNote: Msg | null;
}

export function PreviewResult({ result, stoppedNote }: PreviewResultProps): JSX.Element {
  const i18n = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  useSendAnnouncements(result);
  const running = RUNNING.includes(result.state);
  const parts = allParts(result);
  // One tab stop for the parts: the «next» one, else the first.
  const stop = parts.find((part) => part.next) ?? parts[0];

  const onStep = (from: PartVM, direction: 1 | -1): void => {
    const index = parts.findIndex((part) => part === from);
    const target = parts[index + direction];
    if (target === undefined) return;
    const selector = `[data-cg-part="${target.index}"]${target.variant === null ? '' : `[data-cg-variant="${target.variant}"]`}`;
    focusQuietly(bodyRef.current?.querySelector<HTMLElement>(selector));
  };

  const row = (part: PartVM): JSX.Element => <PreviewPart key={partKey(part)} result={result} part={part} tabStop={part === stop} onStep={onStep} />;

  return (
    <section class="cg-pvr" aria-label={i18n.t('result.label')} data-cg-result={result.state}>
      <Head result={result} />
      <div ref={bodyRef} class="cg-pvr__body" {...(running ? { 'aria-busy': 'true' } : {})}>
        {running ? (
          <div class="cg-pvr__stream">
            {result.streamText}
            <Caret />
          </div>
        ) : null}
        {!running && result.error !== null ? <ErrorCard error={result.error} tone={result.state === 'failed' || result.state === 'interrupted' ? 'failure' : 'state'} actions={result.errorActions} /> : null}
        {running || result.error !== null
          ? null
          : result.variants !== null
            ? result.variants.map((variant) => (
                <div key={variant.index} class="cg-pvr__variant" role="group" aria-label={i18n.text(variant.label)}>
                  <div class="cg-pvr__vhead">{i18n.text(variant.label)}</div>
                  {variant.parts.map(row)}
                </div>
              ))
            : parts.map(row)}
        {stoppedNote === null ? null : <div class="cg-pvr__note">{i18n.text(stoppedNote)}</div>}
      </div>
    </section>
  );
}

export const RESULT_CSS = `
.cg-pvr { border-top: 1px solid var(--cg-rule); }
.cg-pvr__head {
  position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 4px 0 16px;
  background: var(--cg-surface); border-bottom: 1px solid var(--cg-rule); min-width: 0;
}
.cg-pvr__gut { width: auto; }
.cg-pvr__gut:empty { display: none; }
.cg-pvr__title { font-weight: 700; color: var(--cg-ink-strong); white-space: nowrap; }
.cg-pvr__meta { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
.cg-pvr__progress { font-size: var(--cg-text-sm); color: var(--cg-ink-2); white-space: nowrap; }
.cg-pvr__progress b { font-weight: 600; color: var(--cg-ink-strong); }
.cg-pvr__draft { color: var(--cg-ink-muted); font-size: var(--cg-text-sm); white-space: nowrap; }
.cg-pvr__sp { flex: 1; min-width: 0; }
.cg-pvr__head .cg-btn kbd { display: none; }
.cg-pvr__head .cg-stages { flex: 0 1 auto; }
.cg-pvr__body { display: grid; gap: 6px; padding: 8px 10px 10px; }
.cg-pvr__body:empty { display: none; }
.cg-pvr__variant { display: grid; gap: 6px; }
.cg-pvr__stream {
  padding: 7px 10px 8px 12px; border: 1px dashed var(--cg-clay-line); border-radius: 9px; background: var(--cg-draft);
  font-family: var(--cg-serif); font-size: 14.5px; line-height: 21px; color: var(--cg-ink); white-space: pre-wrap; overflow-wrap: anywhere;
}
.cg-pvr__vhead { display: flex; align-items: center; height: 22px; padding: 0 4px; font-size: var(--cg-text-sm); font-weight: 600; color: var(--cg-ink-2); }
.cg-pvr__note { padding: 4px 6px; color: var(--cg-ink-2); }
.cg-pvp {
  display: grid; grid-template-columns: 26px minmax(0, 1fr); align-items: start; padding: 7px 8px 7px 0;
  border: 1px dashed var(--cg-clay-line); border-radius: 9px; background: var(--cg-draft);
  transition: background-color 120ms var(--cg-ease), border-color 120ms var(--cg-ease);
}
.cg-pvp:hover, .cg-pvp:focus-within { background: var(--cg-draft-hover); border-color: var(--cg-clay-ink); }
.cg-pvp:focus-visible { border-radius: 9px; }
.cg-pvp__n { text-align: center; font-family: var(--cg-mono); font-size: var(--cg-text-xs); font-weight: 600; line-height: 21px; color: var(--cg-ink-muted); font-variant-numeric: tabular-nums; }
.cg-pvp__main { min-width: 0; }
.cg-pvp__t { font-family: var(--cg-serif); font-size: 14.5px; line-height: 21px; color: var(--cg-ink); white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.cg-pvp__card { margin-top: 8px; min-width: 0; }
.cg-pvp.is-done { grid-template-columns: 26px minmax(0, 1fr) auto; align-items: center; padding-top: 3px; padding-bottom: 3px; border-style: solid; border-color: var(--cg-rule); background: none; }
.cg-pvp.is-done .cg-pvp__t { color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: var(--cg-text-md); }
.cg-pvp__a { display: flex; align-items: center; gap: 2px; margin: 0 0 0 8px; }
.cg-pvp__a .cg-pvs__st { padding: 0 4px; }
@media (prefers-reduced-motion: reduce) { .cg-pvp { transition: none; } }
`;
