// The report's pieces (ui-design §4.11): the running head with the stage
// line, the close button of the sheet («Скрыть Esc») or of the window
// («Свернуть» back to the sheet, × «Скрыть Esc»), «Развернуть ↗», the copy
// icon and the facts row of a Recap; the score's badge, the coloured blocks,
// the copy icon and the age that a Review's card in Coach's dialog takes
// (1.51.0, overlays/coach). Neither is a message to the fan: no Insert, no
// Split, never a send.
//
// They read as the old Fansly client's report (2026-10-20, the owner's
// reference): a head with the score's badge and the fan's name in the serif,
// then a dashed document whose blocks carry their colour — the verdict on
// terracotta, what works on green, a mistake with «Как надо было».

import { type ReadonlySignal } from '@preact/signals';
import { type ComponentChildren, type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { cgBodyKey, cgTitleKey } from '@cg/contracts/i18n/keys';
import { type OpState } from '@cg/contracts/ops';
import { type PhaseVM, type RefreshFailedVM, type ResultDebugVM, type UiAction } from '@cg/contracts/vm';

import { Button, Caret, Dot, MINUTE, Spinner, StageLine, useAnnounce, useDispatch, useI18n, useKit, useMinuteClock, useNowFn } from '../../kit';
import { CancelButton, Head, HideButton } from '../Head';
import { DebugSlot, type AnalysisProps, type DebugProps, type PartLoader } from '../lazy-part';
import { isRunning } from '../model';
import { StreamText } from '../Stream';

export type Place = AnalysisProps['place'];
export type Which = AnalysisProps['which'];

export const running = (state: OpState | null): boolean => state !== null && isRunning(state);

/** What a Recap needs of its place: the sheet or the window, and where the debug footer loads from. */
export interface ViewProps {
  readonly place: Place;
  readonly debugPart?: PartLoader<DebugProps>;
}

/**
 * The debug footer of a Recap (ui-design §4.12; UI-030, DB-013):
 * only when the controller sends `debug`, that is in debug mode. The live
 * timer needs the moment the generation started, which the phase carries.
 */
export function debugFooter(loader: PartLoader<DebugProps> | undefined, debug: ResultDebugVM | null, state: OpState | null, phase: PhaseVM | null): JSX.Element | null {
  if (loader === undefined || debug === null) return null;
  return <DebugSlot loader={loader} debug={debug} startedAt={phase?.startedAt ?? 0} running={running(state) && phase !== null} />;
}

/**
 * «Скрыть Esc» in the dock sheet. In the «Развернуть ↗» window «Свернуть» puts it back into the sheet and × «Скрыть Esc»
 * closes both, as one Esc or a press on the scrim does (2026-10-22: the old Fansly extension's overlay closed at once).
 */
export function Close({ which, place }: AnalysisProps): JSX.Element {
  const i18n = useI18n();
  const { deps } = useKit();
  const dispatch = useDispatch();
  const hide = (
    <HideButton
      onClick={() => {
        void dispatch({ type: 'ShowAnalysis', view: which, mode: 'hidden' });
        deps.focus.restore();
      }}
    />
  );
  if (place === 'dialog') {
    return (
      <>
        <Button
          label={i18n.t('result.collapse')}
          icon="collapse"
          variant="quiet"
          class="cg-collapse"
          onClick={() => void dispatch({ type: 'ShowAnalysis', view: which, mode: 'sheet' })}
        />
        {hide}
      </>
    );
  }
  return hide;
}

/** «Развернуть ↗» (UI-014): the same text in a window without the sheet's height limit. Only in the sheet. */
export function Expand({ which, place }: AnalysisProps): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (place === 'dialog') return null;
  return <Button label={i18n.t('result.expand')} icon="expand" iconOnly variant="quiet" class="cg-expand" onClick={() => void dispatch({ type: 'ShowAnalysis', view: which, mode: 'expanded' })} />;
}

/** How long the copy icon says «Скопировано» with its check, as a part's copy does. */
const COPIED_MS = 2000;

/**
 * «Копировать Recap» / «Копировать Review»: writes the whole text; once it is written the icon turns into a check named
 * «Скопировано» (its hint under the pointer, the live region) for 2 s, as a part's copy icon; the head does not move.
 * A write that failed says so in a toast, never in silence.
 */
export function CopyAll({ handle, label }: { readonly handle: string | null; readonly label: string }): JSX.Element | null {
  const i18n = useI18n();
  const { deps } = useKit();
  const dispatch = useDispatch();
  const announce = useAnnounce();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);
  if (handle === null) return null;
  return (
    <Button
      label={copied ? i18n.t('common.copied') : label}
      icon={copied ? 'check' : 'copy'}
      iconOnly
      variant="quiet"
      class={copied ? 'cg-copy-all is-done' : 'cg-copy-all'}
      onClick={() =>
        void dispatch({ type: 'Copy', artifactHandle: handle }).then((receipt) => {
          if (receipt?.ok === true) {
            setCopied(true);
            announce(i18n.t('common.copied'));
            return;
          }
          const code = receipt?.ok === false ? receipt.code : 'CG-CLIPBOARD';
          deps.toasts.show({ kind: 'error', code, scope: 'analysis.copy', title: { key: cgTitleKey(code) }, body: { key: cgBodyKey(code) } });
        })
      }
    />
  );
}

/** «Сделан 1 д назад», refreshed on the shared minute ticker; under a minute — «Сделан только что». A Recap's and a Review's. */
export function MadeAgo({ at }: { readonly at: string }): JSX.Element {
  const i18n = useI18n();
  const now = useNowFn();
  useMinuteClock();
  const fresh = now() - Date.parse(at) < MINUTE;
  return <>{fresh ? i18n.t('review.madeNow') : i18n.t('recap.madeAgo', { age: i18n.formatAge(at, now()) })}</>;
}

/** «Не обновилось · CG-… · Повторить»: a build that failed over a Recap that stays shown. */
export function RefreshFailedFact({ failed }: { readonly failed: RefreshFailedVM | null }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (failed === null) return null;
  return (
    <>
      <Fact>
        <Dot kind="danger" />
        <span>
          {i18n.t('result.notRefreshed')} · <span class="cg-fact__code">{failed.error.code}</span>
        </span>
      </Fact>
      <Button label={i18n.t('common.retry')} size="sm" class="cg-fact__btn" tooltip={failed.error.title} onClick={() => void dispatch(failed.retry)} />
    </>
  );
}

export interface RunningProps {
  readonly title: string;
  readonly opId: string | null;
  readonly phase: PhaseVM | null;
  readonly text: ReadonlySignal<string>;
  /** The debug footer under the preliminary text. */
  readonly debug?: JSX.Element | null;
  /** In the window: its head names the fan and keeps «Свернуть» and × «Скрыть». */
  readonly place: Place;
  readonly which: Which;
  /** The fan it is about; null — not known. */
  readonly fan: string | null;
}

/**
 * A Recap being built: the stage line, «Отменить ⌘.» and the preliminary text (Markdown waits for the end,
 * AI-137). In the window the head also names the fan and keeps «Свернуть», where the window's focus opens: a stray
 * Enter must never cancel a paid run.
 */
export function Running({ title, opId, phase, text, debug, place, which, fan }: RunningProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const cancel: UiAction | null = phase !== null ? phase.cancel : opId === null ? null : { type: 'CancelGeneration', operationId: opId };
  const stages = phase === null ? null : <StageLine phase={phase} startedAt={phase.startedAt} />;
  const cancelButton = cancel === null ? null : <CancelButton action={cancel} />;
  return (
    <>
      {place === 'dialog' ? (
        // The report's own head, as it stays once it is written: «Recap — Hubert», the stages under it.
        <ReportHead
          kicker={title}
          title={title}
          fan={fan}
          badge={<Spinner label={i18n.t('result.timerTooltip')} />}
          line={stages}
          acts={
            <>
              {cancelButton}
              <Close which={which} place={place} />
            </>
          }
        />
      ) : (
        <Head title={title} gutter={<Spinner />} acts={cancelButton}>
          {stages}
        </Head>
      )}
      <div
        class="cg-body"
        aria-busy="true"
        onKeyDown={(event) => {
          if (event.code !== 'Period' || !(event.metaKey || event.ctrlKey) || cancel === null) return;
          event.preventDefault();
          void dispatch(cancel);
        }}
      >
        <div class="cg-stream">
          <span />
          <div class="cg-part__t">
            <StreamText text={text} />
            <Caret />
          </div>
        </div>
      </div>
      {debug}
    </>
  );
}

/** The score's step, as the old client coloured it: 9–10 green fill, 7–8 green, 5–6 amber, 3–4 orange, below — red. */
export function scoreTier(rating: number): 'top' | 'good' | 'mid' | 'low' | 'poor' {
  if (rating >= 9) return 'top';
  if (rating >= 7) return 'good';
  if (rating >= 5) return 'mid';
  if (rating >= 3) return 'low';
  return 'poor';
}

/** N/10: a badge of the score's colour — 48 px in a report's head, a chip in the dock's head. */
export function Score({ rating, size }: { readonly rating: number; readonly size: 'lg' | 'sm' }): JSX.Element {
  return (
    <span class={`cg-score cg-score--${size}`} data-cg-score={rating} data-cg-tier={scoreTier(rating)}>
      {rating}
      <span class="cg-score__of">/10</span>
    </span>
  );
}

export interface ReportHeadProps {
  /** The feature's name: the mono line above the title. */
  readonly kicker: string;
  readonly title: string;
  /** The fan the report is about; null — not known. */
  readonly fan: string | null;
  /** The score badge, before the title. */
  readonly badge?: ComponentChildren;
  /** Under the title: a segment («Коротко | Полностью»). */
  readonly tools?: ComponentChildren;
  readonly acts: ComponentChildren;
  /** Under the title: «последние 40 сообщений с Hubert». */
  readonly sub?: readonly string[];
  /** Under the title instead of `sub`: the stage line of a report being written. */
  readonly line?: ComponentChildren;
}

/** The head of a report in the «Развернуть ↗» window: the kicker «RECAP», «Recap — Hubert» in the serif, the buttons. */
export function ReportHead({ kicker, title, fan, badge, tools, acts, sub = [], line }: ReportHeadProps): JSX.Element {
  return (
    <header class="cg-rhead">
      {badge}
      <div class="cg-rhead__t">
        <span class="cg-rhead__k">{kicker}</span>
        <h2 class="cg-rhead__h">
          {title}
          {fan === null ? null : <span class="cg-rhead__fan"> · {fan}</span>}
        </h2>
        {line === undefined || line === null ? (sub.length === 0 ? null : <span class="cg-rhead__sub">{sub.join(' · ')}</span>) : <span class="cg-rhead__sub cg-rhead__line">{line}</span>}
        {tools === undefined || tools === null ? null : <span class="cg-rhead__tools">{tools}</span>}
      </div>
      <span class="cg-head__sp" />
      <span class="cg-head__acts">{acts}</span>
    </header>
  );
}

/** A block's colour, by what it is about (the old client's dots): the verdict, money, the persona, a mistake, what works. */
export type BlockTone = 'clay' | 'good' | 'amber' | 'bad' | 'plain';

/**
 * A block of a report: a mono heading with its dot, the text; the verdict, «что работает» and the Recap's next move on
 * their tint. A block without a title (the text before a Recap's first heading) has no heading line, no lone dot.
 */
export function Block({ title, tone, tinted = false, kind, children }: { readonly title: string; readonly tone: BlockTone; readonly tinted?: boolean; readonly kind?: string; readonly children: ComponentChildren }): JSX.Element {
  return (
    <section class={`cg-rsec is-${tone}${tinted ? ' is-tinted' : ''}`} {...(kind === undefined ? {} : { 'data-cg-section': kind })}>
      {title === '' ? null : (
        <h3 class="cg-rsec__h">
          <span class="cg-rsec__dot" aria-hidden="true" />
          {title}
        </h3>
      )}
      <div class="cg-rsec__b">{children}</div>
    </section>
  );
}

/** The footer of facts: «Сделан 1 д назад», «✓ сохранено в хаб», «архив полный»… */
export function Facts({ children }: { readonly children: ComponentChildren }): JSX.Element {
  return <div class="cg-facts">{children}</div>;
}

export function Fact({ strong = false, children }: { readonly strong?: boolean; readonly children: ComponentChildren }): JSX.Element {
  return <span class={`cg-fact${strong ? ' is-strong' : ''}`}>{children}</span>;
}
