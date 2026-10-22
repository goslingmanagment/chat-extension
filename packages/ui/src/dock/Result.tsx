// What a result sheet shows for a ResultVM (ui-design §4.2…§4.8, §8.2;
// architecture.md §7): while the operation runs — the stage line with its
// timer, «Отменить ⌘.» and the preliminary text with no buttons; after
// `done` — parts, Hi variants or Fix, the stale row, the Split note when one
// message came for a Split (the old Fansly extension's), and (in debug mode) the
// debug footer; after `failed` or `interrupted` — the error
// card with its recovery buttons. Used by the dock sheet and by the
// «Развернуть ↗» window alike.

import { type ReadonlySignal } from '@preact/signals';
import { type JSX } from 'preact';

import { type I18nKey } from '@cg/contracts/errors';
import { type ResultMarkVM, type StaleReason } from '@cg/contracts/ops';
import { type DockVM, type ResultMarkKey, type ResultVM } from '@cg/contracts/vm';

import { Button, Caret, Dot, ErrorCard, Spinner, StageLine, useDispatch, useI18n, useKit } from '../kit';
import { RetryAnnouncer, spokenReady, useReadyAnnouncement, useStageAnnouncements } from './announce';
import { FixBody } from './Fix';
import { AgainButton, CancelButton, Head, Meta } from './Head';
import { DebugSlot, type DebugProps, type PartLoader } from './lazy-part';
import { actionOf, featureKey, isRunning, metaTexts, toneOf } from './model';
import { Parts, Variants } from './Parts';
import { StreamText } from './Stream';

export interface ResultContentProps {
  readonly result: ResultVM;
  /** `copy-only`: «Копировать» instead of «Вставить» in every part (UI-027). */
  readonly mode: DockVM['mode'];
  /** The streamed text of the raw view (never the steady one). */
  readonly streamText: ReadonlySignal<string>;
  readonly debugPart: PartLoader<DebugProps>;
  /** «Скрыть Esc» (the sheet) or «Свернуть Esc» (the window); null while the generation runs. */
  readonly close: JSX.Element | null;
  readonly onFirstPaint?: () => void;
  /** The «Развернуть ↗» window: the dock sheet already says the stages and the readiness of this operation. */
  readonly quiet?: boolean;
  /** The part the dock offers the focus to (`DockVM.focusPart`, decision X44); the dock sheet only. */
  readonly focusPart?: number | null;
  /** ↗ «Развернуть» of a finished result: the dock sheet's; the window has «Свернуть» instead. */
  readonly expand?: JSX.Element | null;
}

/**
 * The words of each mark, by its reason (ui-design §4.7): «Фан написал новое» of the shared catalog (`archive-moved` has
 * none of its own); the window check's (R20 P8b2, spec §3.5) — `ResultMarkKey`, in the catalog of the site whose verdict
 * gives them.
 */
const MARK_WORDS = { 'fan-wrote': '', 'archive-moved': '', unverified: '.unverified', 'window-miss': '.windowMiss', 'deleted-served': '.deletedServed' } as const satisfies Record<StaleReason, string>;

/**
 * The mark above the parts (ui-design §4.7): the answer may not know what the chat holds now; inserting stays allowed.
 * `onAgain` null — the result has no «Ещё раз» here. Recap, Review and a Coach answer draw it too (R20 P8c).
 */
export function StaleRow({ mark, onAgain, reason }: { readonly mark: ResultMarkVM; readonly onAgain: (() => void) | null; readonly reason: string | null }): JSX.Element {
  const i18n = useI18n();
  const words = (part: 'title' | 'body'): string => i18n.t(`result.stale${MARK_WORDS[mark.reason]}.${part}` as const satisfies I18nKey | ResultMarkKey as I18nKey);
  return (
    <div class="cg-stale" role="status">
      <span class="cg-gut">
        <Dot kind="accent" use="result-stale" />
      </span>
      <span class="cg-stale__t">
        <b>{words('title')}</b> {words('body')}
      </span>
      {onAgain === null ? null : <Button label={i18n.t('common.again')} variant="line" reason={reason} onClick={onAgain} />}
    </div>
  );
}

/**
 * Split was asked and one message came (the old Fansly extension's note, AI-011): a row over the part with «Ещё раз» —
 * the answer is whole, only the ask to split it missed. Never a regeneration by itself.
 */
function SplitNote({ onAgain, reason }: { readonly onAgain: (() => void) | null; readonly reason: string | null }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-stale cg-stale--split" role="status">
      <span class="cg-gut">
        <Dot kind="ring" />
      </span>
      <span class="cg-stale__t">
        <b>{i18n.t('result.splitOne.title')}</b> {i18n.t('result.splitOne.body')}
      </span>
      {onAgain === null ? null : <Button label={i18n.t('common.again')} variant="line" reason={reason} onClick={onAgain} />}
    </div>
  );
}

export function ResultContent(props: ResultContentProps): JSX.Element | null {
  const { result } = props;
  const i18n = useI18n();
  const { deps } = useKit();
  const dispatch = useDispatch();
  const title = i18n.t(featureKey(result.feature));
  const running = isRunning(result.state);
  // The live region (ui-design §6.2): the stage entered, then «Ответ готов: 3 части»; never the streamed text.
  const said = props.quiet === true ? null : result.opId;
  useStageAnnouncements(title, running ? said : null, result.phase);
  useReadyAnnouncement(said, running, result.state === 'done', () => spokenReady(i18n, result));
  const again = (): void => void dispatch({ type: 'Regenerate', operationId: result.opId });
  const againReason = result.canRegenerate ? null : result.regenerateReason === null ? i18n.t('common.unknown') : i18n.text(result.regenerateReason.text);
  const debug = result.debug === null ? null : <DebugSlot loader={props.debugPart} debug={result.debug} startedAt={result.startedAt} running={running} />;

  if (running) {
    const cancel = result.phase === null ? ({ type: 'CancelGeneration', operationId: result.opId } as const) : result.phase.cancel;
    return (
      <>
        <Head
          title={title}
          fan={result.targetName}
          gutter={<Spinner />}
          acts={cancel === null ? null : <CancelButton action={cancel} />}
        >
          {result.phase === null ? null : <StageLine phase={result.phase} startedAt={result.startedAt} />}
        </Head>
        <div class="cg-body" aria-busy="true">
          <div class="cg-stream">
            <span />
            <div class="cg-part__t">
              {/* One StreamText per operation: its first painted chunk is marked once for each (firstChunkPaintMs). */}
              <StreamText key={result.opId} text={props.streamText} {...(props.onFirstPaint === undefined ? {} : { onFirstPaint: props.onFirstPaint })} />
              <Caret />
            </div>
          </div>
        </div>
        {debug}
      </>
    );
  }

  if (result.state === 'failed' || result.state === 'interrupted') {
    return (
      <>
        <Head title={title} fan={result.targetName} acts={props.close}>
          <Meta texts={metaTexts(i18n, result)} />
        </Head>
        <div class="cg-body">{result.error === null ? null : <ErrorCard error={result.error} tone={toneOf(result.error)} actions={result.errorActions} />}</div>
        {said === null ? null : <RetryAnnouncer error={result.error} actions={result.errorActions} />}
        {debug}
      </>
    );
  }

  if (result.state !== 'done') return null;

  const mode = props.mode === 'copy-only' || result.unparsed ? 'copy-only' : 'insert';
  const scope = { opId: result.opId, mode, confirm: result.confirm } as const;
  const only = result.parts?.length === 1 ? result.parts[0] : undefined;
  const fix = result.fix !== null && only !== undefined ? { vm: result.fix, part: only } : null;
  const replaced = fix?.vm.replaced === true;
  // A result a board made, shown in the dock of its chat (architecture.md §6.5): the rest of an answer to insert.
  // «Ещё раз» is the board's (its tone, its Fix source, the lease of «Новые»); here a new answer is the strip's buttons.
  const board = result.surface === 'preview' || result.surface === 'newcomers';
  // Split was asked, one message came: the note says it over the part, so the head does not say it again.
  const splitMissed = result.splitRequested && fix === null && result.variants === null && result.parts?.length === 1 && !result.unparsed;
  const meta = metaTexts(i18n, result).filter((text) => !splitMissed || text !== i18n.t('result.meta.onePart'));
  return (
    <>
      <Head
        title={title}
        fan={result.targetName}
        acts={
          <>
            {replaced || board ? null : <AgainButton hotkey={deps.catalog.entry(actionOf(result.feature)).hotkey} reason={againReason} onClick={again} />}
            {props.expand ?? null}
            {props.close}
          </>
        }
      >
        {/* No «черновик · не отправлено» and no keys footer (2026-10-20): the answer is the sheet's; its keys are in
            the hints and the cheatsheet, as the old client had them. The cost line is the head's last word, as the
            old head's was. */}
        <Meta texts={meta} usage={result.usage ?? null} />
      </Head>
      <div class="cg-body">
        {result.stale === null ? null : <StaleRow mark={result.stale} onAgain={board ? null : again} reason={againReason} />}
        {splitMissed ? <SplitNote onAgain={board || replaced ? null : again} reason={againReason} /> : null}
        {fix !== null ? (
          <FixBody opId={result.opId} fix={fix.vm} part={fix.part} mode={mode} confirm={result.confirm} />
        ) : result.variants !== null ? (
          <Variants variants={result.variants} {...scope} />
        ) : (
          <Parts parts={result.parts ?? []} focus={props.focusPart ?? null} {...scope} />
        )}
      </div>
      {debug}
    </>
  );
}
