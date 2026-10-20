// What Recap and Review share (ui-design §4.11): the running head with the
// stage line, the close button of the sheet («Скрыть Esc») or of the window
// («Свернуть Esc»), «Развернуть ↗», the copy icon and the facts row. Neither
// is a message to the fan: no Insert, no Split, never a send.
//
// In the window they read as the old Fansly client's report (2026-10-20, the
// owner's reference): a head with the score's badge and the fan's name in the
// serif, then a dashed document whose blocks carry their colour — the verdict
// on terracotta, what works on green, a mistake with «Как надо было».

import { type ReadonlySignal } from '@preact/signals';
import { type ComponentChildren, type JSX } from 'preact';

import { type OpState } from '@cg/contracts/ops';
import { type PhaseVM, type ResultDebugVM, type UiAction } from '@cg/contracts/vm';

import { Button, Caret, Spinner, StageLine, useAnnounce, useDispatch, useI18n, useKit } from '../../kit';
import { CancelButton, Head, HideButton } from '../Head';
import { DebugSlot, type AnalysisProps, type DebugProps, type PartLoader } from '../lazy-part';
import { isRunning } from '../model';
import { StreamText } from '../Stream';

export type Place = AnalysisProps['place'];
export type Which = AnalysisProps['which'];

export const running = (state: OpState | null): boolean => state !== null && isRunning(state);

/** What a Recap or a Review needs of its place: the sheet or the window, and where the debug footer loads from. */
export interface ViewProps {
  readonly place: Place;
  readonly debugPart?: PartLoader<DebugProps>;
}

/**
 * The debug footer of a Recap or a Review (ui-design §4.12; UI-030, DB-013):
 * only when the controller sends `debug`, that is in debug mode. The live
 * timer needs the moment the generation started, which the phase carries.
 */
export function debugFooter(loader: PartLoader<DebugProps> | undefined, debug: ResultDebugVM | null, state: OpState | null, phase: PhaseVM | null): JSX.Element | null {
  if (loader === undefined || debug === null) return null;
  return <DebugSlot loader={loader} debug={debug} startedAt={phase?.startedAt ?? 0} running={running(state) && phase !== null} />;
}

/** «Скрыть Esc» in the dock sheet; «Свернуть Esc» in the «Развернуть ↗» window (back to the sheet). */
export function Close({ which, place }: AnalysisProps): JSX.Element {
  const i18n = useI18n();
  const { deps } = useKit();
  const dispatch = useDispatch();
  if (place === 'dialog') {
    return (
      <Button
        label={i18n.t('result.collapse')}
        icon="collapse"
        variant="quiet"
        class="cg-collapse"
        hotkey={deps.catalog.entry('close').hotkey ?? i18n.t('common.key.esc')}
        onClick={() => void dispatch({ type: 'ShowAnalysis', view: which, mode: 'sheet' })}
      />
    );
  }
  return (
    <HideButton
      onClick={() => {
        void dispatch({ type: 'ShowAnalysis', view: which, mode: 'hidden' });
        deps.focus.restore();
      }}
    />
  );
}

/** «Развернуть ↗» (UI-014): the same text in a window without the sheet's height limit. Only in the sheet. */
export function Expand({ which, place }: AnalysisProps): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (place === 'dialog') return null;
  return <Button label={i18n.t('result.expand')} icon="expand" iconOnly variant="quiet" class="cg-expand" onClick={() => void dispatch({ type: 'ShowAnalysis', view: which, mode: 'expanded' })} />;
}

/** «Копировать Recap» / «Копировать Review»: writes the whole text; says «Скопировано» once it is written. */
export function CopyAll({ handle, label }: { readonly handle: string | null; readonly label: string }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const announce = useAnnounce();
  if (handle === null) return null;
  return (
    <Button
      label={label}
      icon="copy"
      iconOnly
      variant="quiet"
      class="cg-copy-all"
      onClick={() =>
        void dispatch({ type: 'Copy', artifactHandle: handle }).then((receipt) => {
          if (receipt?.ok === true) announce(i18n.t('common.copied'));
        })
      }
    />
  );
}

export interface RunningProps {
  readonly title: string;
  readonly opId: string | null;
  readonly phase: PhaseVM | null;
  readonly text: ReadonlySignal<string>;
  /** The debug footer under the preliminary text. */
  readonly debug?: JSX.Element | null;
}

/** A Recap or a Review being built: the stage line, «Отменить ⌘.» and the preliminary text (Markdown waits for the end, AI-137). */
export function Running({ title, opId, phase, text, debug }: RunningProps): JSX.Element {
  const dispatch = useDispatch();
  const cancel: UiAction | null = phase !== null ? phase.cancel : opId === null ? null : { type: 'CancelGeneration', operationId: opId };
  return (
    <>
      <Head
        title={title}
        gutter={<Spinner />}
        acts={cancel === null ? null : <CancelButton action={cancel} />}
      >
        {phase === null ? null : <StageLine phase={phase} startedAt={phase.startedAt} />}
      </Head>
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
  /** After the title block: a segment («Коротко | Полностью»). */
  readonly tools?: ComponentChildren;
  readonly acts: ComponentChildren;
  /** Under the title: «последние 40 сообщений с Hubert». */
  readonly sub?: readonly string[];
}

/** The head of a report in the «Развернуть ↗» window: badge, «REVIEW», «Review — Hubert» in the serif, the buttons. */
export function ReportHead({ kicker, title, fan, badge, tools, acts, sub = [] }: ReportHeadProps): JSX.Element {
  return (
    <header class="cg-rhead">
      {badge}
      <div class="cg-rhead__t">
        <span class="cg-rhead__k">{kicker}</span>
        <h2 class="cg-rhead__h">
          {title}
          {fan === null ? null : <span class="cg-rhead__fan"> — {fan}</span>}
        </h2>
        {sub.length === 0 ? null : <span class="cg-rhead__sub">{sub.join(' · ')}</span>}
      </div>
      <span class="cg-head__sp" />
      {tools === undefined || tools === null ? null : <span class="cg-rhead__tools">{tools}</span>}
      <span class="cg-head__acts">{acts}</span>
    </header>
  );
}

/** A block's colour, by what it is about (the old client's dots): the verdict, money, the persona, a mistake, what works. */
export type BlockTone = 'clay' | 'good' | 'amber' | 'bad' | 'plain';

/** A block of a report: a mono heading with its dot, the text; the verdict and «что работает» on their tint. */
export function Block({ title, tone, tinted = false, kind, children }: { readonly title: string; readonly tone: BlockTone; readonly tinted?: boolean; readonly kind?: string; readonly children: ComponentChildren }): JSX.Element {
  return (
    <section class={`cg-rsec is-${tone}${tinted ? ' is-tinted' : ''}`} {...(kind === undefined ? {} : { 'data-cg-section': kind })}>
      <h3 class="cg-rsec__h">
        <span class="cg-rsec__dot" aria-hidden="true" />
        {title}
      </h3>
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
