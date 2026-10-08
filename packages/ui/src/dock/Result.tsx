// What a result sheet shows for a ResultVM (ui-design §4.2…§4.8, §8.2;
// architecture.md §7): while the operation runs — the stage line with its
// timer, «Отменить ⌘.» and the preliminary text with no buttons; after
// `done` — parts, Hi variants or Fix, the stale row, the keys footer and (in
// debug mode) the debug footer; after `failed` or `interrupted` — the error
// card with its recovery buttons. Used by the dock sheet and by the
// «Развернуть ↗» window alike.

import { type ReadonlySignal } from '@preact/signals';
import { type JSX } from 'preact';

import { type DockVM, type ResultVM } from '@cg/contracts/vm';

import { Button, Caret, Dot, ErrorCard, KeysFooter, Spinner, StageLine, hotkeyText, useDispatch, useI18n, useKit, type KeyHint } from '../kit';
import { RetryAnnouncer, spokenReady, useReadyAnnouncement, useStageAnnouncements } from './announce';
import { FixBody } from './Fix';
import { AgainButton, DraftLabel, Head, Meta } from './Head';
import { DebugSlot, type DebugProps, type PartLoader } from './lazy-part';
import { actionOf, featureKey, isRunning, metaTexts, toneOf } from './model';
import { Parts, Variants } from './Parts';
import { StreamText } from './Stream';

export interface ResultContentProps {
  readonly result: ResultVM;
  /** `copy-only`: «Копировать» instead of «Вставить» in every part (UI-027). */
  readonly mode: DockVM['mode'];
  /** The keys footer under the result: the first five results until dismissed (ui-design §4.3). */
  readonly keysFooter: boolean;
  /** The streamed text of the raw view (never the steady one). */
  readonly streamText: ReadonlySignal<string>;
  readonly debugPart: PartLoader<DebugProps>;
  /** «Скрыть Esc» (the sheet) or «Свернуть Esc» (the window); null while the generation runs. */
  readonly close: JSX.Element | null;
  readonly onFirstPaint?: () => void;
  /** The «Развернуть ↗» window: the dock sheet already says the stages and the readiness of this operation. */
  readonly quiet?: boolean;
}

/** «Фан написал новое» above the parts (ui-design §4.7): the answer does not know the new message; inserting stays allowed. `onAgain` null — the result has no «Ещё раз» here. */
function StaleRow({ onAgain, reason }: { readonly onAgain: (() => void) | null; readonly reason: string | null }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-stale" role="status">
      <span class="cg-gut">
        <Dot kind="accent" use="result-stale" />
      </span>
      <span class="cg-stale__t">
        <b>{i18n.t('result.stale.title')}</b> {i18n.t('result.stale.body')}
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
          gutter={<Spinner />}
          acts={cancel === null ? null : <Button label={i18n.t('common.cancelOp')} class="cg-cancel" hotkey={deps.catalog.entry('cancel').hotkey} onClick={() => void dispatch(cancel)} />}
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
        <Head title={title} acts={props.close}>
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
  const hint = (keys: string, label: string, optional = false): KeyHint => ({ keys, label, ...(optional ? { optional } : {}) });
  const copyKey = hotkeyText(deps.catalog.entry('copy-part').hotkey)?.display ?? null;
  const hints: KeyHint[] = [
    hint('↑↓', i18n.t('result.keys.part')),
    ...(result.variants === null ? [] : [hint('←→', i18n.t('result.keys.variant'))]),
    hint('↵', i18n.t(mode === 'insert' ? 'result.keys.insert' : 'result.keys.copy')),
    ...(result.variants !== null || mode !== 'insert' || copyKey === null ? [] : [hint(copyKey, i18n.t('result.keys.copy'), true)]),
    hint(i18n.t('common.key.esc'), i18n.t('result.keys.collapse')),
  ];
  return (
    <>
      <Head
        title={title}
        acts={
          <>
            {replaced || board ? null : <AgainButton hotkey={deps.catalog.entry(actionOf(result.feature)).hotkey} reason={againReason} onClick={again} />}
            {props.close}
          </>
        }
      >
        <Meta texts={metaTexts(i18n, result)} />
        {result.draftNotSent ? <DraftLabel /> : null}
      </Head>
      <div class="cg-body">
        {result.stale === null ? null : <StaleRow onAgain={board ? null : again} reason={againReason} />}
        {fix !== null ? (
          <FixBody opId={result.opId} fix={fix.vm} part={fix.part} mode={mode} confirm={result.confirm} />
        ) : result.variants !== null ? (
          <Variants variants={result.variants} {...scope} />
        ) : (
          <Parts parts={result.parts ?? []} {...scope} />
        )}
      </div>
      {props.keysFooter && fix === null ? (
        <KeysFooter
          label={i18n.t('cheatsheet.title')}
          hints={hints}
          hide={{
            label: i18n.t('common.hide'),
            tooltip: i18n.t('result.keys.hideTooltip'),
            onHide: () => void dispatch({ type: 'SetPreference', key: 'onboarding.keysFooter.dismissed', value: true }),
          }}
        />
      ) : null}
      {debug}
    </>
  );
}
