// The one surface that opens above the strip (ui-design §3.2, §4.2, §4.8…
// §4.11, §8.1): a result, Recap or Review, the refusal of a fourth
// generation, the «расширение обновилось» card — and, as its last row, the
// status banner. No sheet means the collapsed dock: the strip alone. Esc
// inside it hides what «Скрыть» hides and gives focus back to the composer;
// ⌘. / Ctrl+. cancels the running generation (local keys only, §6.4).

import { type ReadonlySignal } from '@preact/signals';
import { type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { type CgErrorView } from '@cg/contracts/errors';
import { type ActionButtonVM, type DockVM, type RefusalVM, type RunningOpVM, type UiAction } from '@cg/contracts/vm';

import {
  Boundary,
  Button,
  CopyCodeButton,
  ErrorCard,
  Spinner,
  StatusBanner,
  useDispatch,
  useElapsed,
  useI18n,
  useKit,
  useNowFn,
  windowOf,
} from '../kit';
import { ExpandButton, Head, HideButton, Meta } from './Head';
import { type AnalysisProps, type DebugProps, type DockParts, type PartLoader, type VoiceProps, useLazyPart } from './lazy-part';
import { featureKey, isRunning, msgOf, toneOf, withBody } from './model';
import { ResultContent } from './Result';
import { useStreamText } from './Stream';

/** A local button of a card or a banner: the controller's action under a catalog label. */
function button(label: ActionButtonVM['label']['key'], action: UiAction): ActionButtonVM {
  return { label: msgOf(label), action, enabled: true, reason: null, hotkey: null };
}

/** «Аккаунт не определён», «Чат не определён»: the strip stands, all off, over this banner. */
const UNIDENTIFIED_CODES: ReadonlySet<string> = new Set(['CG-HOST-ACCOUNT-UNKNOWN', 'CG-HOST-CHAT-UNKNOWN']);

interface BannerModel {
  readonly error: CgErrorView;
  readonly dot: 'danger' | 'ring';
  readonly action: ActionButtonVM | null;
  readonly copyCode: boolean;
  /** «Нет персоны»: the personas to pick right here (2026-10-22, the old Fansly extension's banner); the settings stay one click away. */
  readonly personas?: { readonly choices: NonNullable<DockVM['personaChoices']>; readonly settings: UiAction | null };
}

/** The status banner of a dock (ui-design §4.10): which text, which dot, which one button. */
function bannerOf(vm: DockVM, t: (key: 'cg.hubUnavailable.banner' | 'cg.hostContract.banner') => string): BannerModel | null {
  const error = vm.statusError;
  if (error === null) {
    // 1.3.0: a dock that is otherwise `ready` on a page the owner switched off — one line, a state (the ring),
    // nothing to press: «ChatGoose выключен владельцем». The buttons under it are dimmed with the same reason.
    const notice = vm.status === 'ready' ? (vm.notice ?? null) : null;
    return notice === null ? null : { error: notice, dot: 'ring', action: null, copyCode: false };
  }
  const remedy = vm.view.s === 'forbidden' ? vm.view.remedy : vm.view.s === 'offline' || vm.view.s === 'error' ? vm.view.retry : null;
  switch (vm.status) {
    case 'not-signed-in':
      return { error, dot: 'ring', action: remedy === null ? null : button('cg.authRequired.action', remedy), copyCode: false };
    case 'no-binding':
      return { error, dot: 'ring', action: null, copyCode: true };
    case 'no-persona': {
      const choices = vm.personaChoices ?? [];
      if (choices.length > 0) return { error, dot: 'ring', action: null, copyCode: false, personas: { choices, settings: remedy } };
      return { error, dot: 'ring', action: remedy === null ? null : button('cg.personaUnassigned.action', remedy), copyCode: false };
    }
    case 'host-degraded':
      // The page never named the account or the fan of the open chat (audit 2026-10-20 №15): a reload is the remedy.
      if (UNIDENTIFIED_CODES.has(error.code)) return { error, dot: 'ring', action: button('common.reloadTab', { type: 'ReloadTab' }), copyCode: false };
      return {
        error: error.code === 'CG-HOST-CONTRACT' ? withBody(error, t('cg.hostContract.banner')) : error,
        dot: 'ring',
        action: button('common.details', { type: 'OpenSettings', route: { section: 'status', code: error.code } }),
        copyCode: false,
      };
    case 'hub-down':
      // The hub is away: «ChatSpace работает как обычно. AI вернётся, когда хаб ответит». A lost port to the extension's
      // own background (1.5.0) is another service with its own words — the registry's: nothing there is the hub's.
      return {
        error: error.code === 'CG-RUNTIME-UNREACHABLE' ? error : withBody(error, t('cg.hubUnavailable.banner')),
        dot: 'danger',
        action: remedy === null ? null : button('common.retry', remedy),
        copyCode: false,
      };
    case 'blocked-fan':
      return { error, dot: 'ring', action: null, copyCode: false };
    case 'ready':
    case 'loading-chat':
    case 'reload-needed':
      return null;
  }
}

/**
 * The persona for the open chat's page, chosen in the banner itself (the old extension's «Choose a personality» and
 * its save): a native list — its drop-down is the browser's, never cut by the sheet — and «Сохранить», which writes
 * the settings page's own choice. «Настройки» opens the page's row there.
 */
function PersonaPicker({ choices, settings }: NonNullable<BannerModel['personas']>): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const [key, setKey] = useState('');
  const chosen = choices.find((choice) => choice.key === key) ?? null;
  const label = i18n.t('dock.persona.menu');
  return (
    <span class="cg-pick">
      <select class="cg-pick__list" aria-label={label} value={key} onChange={(event) => setKey(event.currentTarget.value)}>
        <option value="" disabled>
          {label}
        </option>
        {choices.map((choice) => (
          <option key={choice.key} value={choice.key}>
            {choice.label}
          </option>
        ))}
      </select>
      <Button label={i18n.t('common.save')} variant="line" reason={chosen === null ? label : null} onClick={() => (chosen === null ? undefined : void dispatch(chosen.choose))} />
      {settings === null ? null : <Button label={i18n.t('common.settings')} variant="quiet" onClick={() => void dispatch(settings)} />}
    </span>
  );
}

function Banner({ model }: { readonly model: BannerModel }): JSX.Element {
  return (
    <StatusBanner error={model.error} dot={model.dot} action={model.action}>
      {model.copyCode ? <CopyCodeButton code={model.error.code} /> : null}
      {model.personas === undefined ? null : <PersonaPicker {...model.personas} />}
    </StatusBanner>
  );
}

/** «Расширение обновилось» (ui-design §4.10): a card, not a banner; everything else is off until the tab reloads. */
function ReloadCard({ vm }: { readonly vm: DockVM }): JSX.Element | null {
  const error = vm.view.s === 'error' ? vm.view.error : vm.statusError;
  if (error === null) return null;
  const reload: UiAction = vm.view.s === 'error' && vm.view.retry !== null ? vm.view.retry : { type: 'ReloadTab' };
  return (
    <div class="cg-body">
      <ErrorCard error={error} tone="state" actions={[button('cg.runtimeReloaded.action', reload)]} />
    </div>
  );
}

function RunningRow({ op }: { readonly op: RunningOpVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const elapsed = useElapsed(op.startedAt, useNowFn());
  return (
    <div class="cg-op" data-cg-op={op.opId}>
      <span class="cg-gut">
        <Spinner />
      </span>
      <span class="cg-op__fan">{op.fanLabel ?? i18n.t('common.unknown')}</span>
      <span class="cg-op__feat">{i18n.t(featureKey(op.feature))}</span>
      <span class="cg-op__t cg-num">{i18n.formatDuration(Math.floor(elapsed / 1000) * 1000, 'seconds')}</span>
      <span class="cg-op__a">
        <Button label={i18n.t('common.go')} onClick={() => void dispatch(op.go)} />
        <Button label={i18n.t('common.cancelOp')} variant="quiet" onClick={() => void dispatch(op.cancel)} />
      </span>
    </div>
  );
}

/**
 * A start that was not admitted (ui-design §4.9). The fourth generation: no queue, the three that run, «Перейти»
 * and «Отменить». A start that failed before any admission (a gate, storage, a background that did not answer)
 * names nothing that runs: its card carries the code to copy, as any failure's does (§4.8), and «Повторить» of
 * the same start when the controller offers it (`RefusalVM.actions`, X45).
 */
function RefusalContent({ refusal, onHide }: { readonly refusal: RefusalVM; readonly onHide: () => void }): JSX.Element {
  const i18n = useI18n();
  return (
    <>
      <Head title={i18n.t(featureKey(refusal.feature))} fan={refusal.targetName ?? null} acts={<HideButton onClick={onHide} />}>
        <Meta texts={[i18n.t('result.meta.notStarted')]} />
      </Head>
      <div class="cg-body">
        <ErrorCard error={refusal.error} tone={toneOf(refusal.error)} copyCode={refusal.running.length === 0} {...(refusal.actions === undefined ? {} : { actions: refusal.actions })} />
        {refusal.running.length === 0 ? null : (
          <div class="cg-ops" role="group" aria-label={i18n.t('cg.opTabLimit.listLabel')}>
            {refusal.running.map((op) => (
              <RunningRow key={op.opId} op={op} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** Recap or Review in the sheet; the chunk with them (and Markdown) loads on first use. */
function Analysis({ loader, which, debugPart }: { readonly loader: PartLoader<AnalysisProps>; readonly which: 'recap' | 'review'; readonly debugPart: PartLoader<DebugProps> }): JSX.Element {
  const i18n = useI18n();
  const part = useLazyPart(loader);
  if (part === null) return <Head title={i18n.t(featureKey(which))} gutter={<Spinner label={i18n.t('common.loading')} />} />;
  const View = part.view;
  return <View which={which} place="sheet" debugPart={debugPart} />;
}

/** The voice studio in the sheet (1.47.0); its chunk loads on the first open. */
function Voice({ loader, onHide }: { readonly loader: PartLoader<VoiceProps>; readonly onHide: () => void }): JSX.Element {
  const i18n = useI18n();
  const part = useLazyPart(loader);
  if (part === null) return <Head title={i18n.t('dock.action.voice')} gutter={<Spinner label={i18n.t('common.loading')} />} />;
  const View = part.view;
  return <View onHide={onHide} />;
}

export interface SheetProps {
  /** The steady view model: everything but the streamed text. */
  readonly vm: DockVM;
  /** The raw view, for the streamed text. */
  readonly view: ReadonlySignal<DockVM>;
  readonly parts: DockParts;
  /** The refusal the person hid with «Скрыть» (no operation exists to hide). */
  readonly refusalHidden: boolean;
  readonly onHideRefusal: () => void;
}

export function Sheet({ vm, view, parts, refusalHidden, onHideRefusal }: SheetProps): JSX.Element | null {
  const i18n = useI18n();
  const { deps, root } = useKit();
  const dispatch = useDispatch();
  const section = useRef<HTMLElement>(null);
  const streamText = useStreamText(view, (dock) => dock.result?.streamText ?? null);
  const result = vm.result !== null && vm.result.state !== 'canceled' ? vm.result : null;
  const refusal = vm.refusal !== null && !refusalHidden ? vm.refusal : null;
  const reload = vm.status === 'reload-needed';
  const showsResult = !reload && refusal === null && vm.analysis === null && result !== null;
  const doneOp = showsResult && result.state === 'done' ? result.opId : null;
  const shownOp = showsResult ? result.opId : null;

  // «Видно» of acceptance telemetry: the finished result is really on screen, not merely arrived (§9.6).
  useEffect(() => {
    const element = section.current;
    if (doneOp === null || element === null) return undefined;
    const Observer = (windowOf(root) as (Window & typeof globalThis) | null)?.IntersectionObserver;
    if (Observer === undefined) {
      deps.marks.resultShown(doneOp);
      return undefined;
    }
    const observer = new Observer((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      deps.marks.resultShown(doneOp);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [doneOp, deps, root]);
  // The sheet answered the click or the key (panelOpenMs: the controller holds the start mark).
  useEffect(() => {
    if (shownOp === null) return undefined;
    const view = windowOf(root);
    const frame = view?.requestAnimationFrame(() => deps.marks.painted('panelOpenMs', shownOp));
    return () => {
      if (frame !== undefined) view?.cancelAnimationFrame(frame);
    };
  }, [shownOp, deps, root]);

  const hideResult = result === null || isRunning(result.state) ? null : (): void => void dispatch({ type: 'HideResult', operationId: result.opId });
  let hide: (() => void) | null = null;
  let content: JSX.Element | null = null;
  if (reload) content = <ReloadCard vm={vm} />;
  else if (refusal !== null) {
    hide = onHideRefusal;
    content = <RefusalContent refusal={refusal} onHide={() => close(onHideRefusal)} />;
  } else if (vm.analysis !== null) {
    const which = vm.analysis;
    hide = () => void dispatch({ type: 'ShowAnalysis', view: which, mode: 'hidden' });
    content = <Analysis loader={parts.analysis} which={which} debugPart={parts.debug} />;
  } else if (vm.voice === true && vm.targetHandle !== null) {
    const targetHandle = vm.targetHandle;
    const hideVoice = (): void => void dispatch({ type: 'ShowVoice', targetHandle, open: false });
    hide = hideVoice;
    content = <Voice loader={parts.voice} onHide={() => close(hideVoice)} />;
  } else if (result !== null) {
    hide = hideResult;
    content = (
      <ResultContent
        result={result}
        mode={vm.mode}
        streamText={streamText}
        debugPart={parts.debug}
        close={hideResult === null ? null : <HideButton onClick={() => close(hideResult)} />}
        expand={result.state === 'done' ? <ExpandButton opId={result.opId} /> : null}
        onFirstPaint={() => deps.marks.painted('firstChunkPaintMs', result.opId)}
        focusPart={vm.focusPart?.opId === result.opId ? vm.focusPart.part : null}
      />
    );
  }
  // The page's `insertion` switch is off: the reason for the missing «Вставить», over a result whose parts it concerns.
  const insertOff = vm.insertOff ?? null;
  const banner = bannerOf(vm, (key) => i18n.t(key)) ?? (insertOff !== null && showsResult && result.state === 'done' ? { error: insertOff, dot: 'ring', action: null, copyCode: false } : null);
  if (content === null && banner === null) return null;

  /** «Скрыть» and Esc: collapse, then focus goes back to the composer (ui-design §6.3). */
  function close(action: () => void): void {
    action();
    deps.focus.restore();
  }
  const cancel = result !== null && isRunning(result.state) ? (result.phase === null ? ({ type: 'CancelGeneration', operationId: result.opId } as const) : result.phase.cancel) : null;

  return (
    <section
      ref={section}
      class="cg-sheet"
      aria-label={i18n.t('result.label')}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape' && hide !== null) {
          event.preventDefault();
          event.stopPropagation();
          close(hide);
        } else if (event.code === 'Period' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && cancel !== null) {
          event.preventDefault();
          event.stopPropagation();
          void dispatch(cancel);
        }
      }}
    >
      <Boundary surface={null}>{content}</Boundary>
      {banner === null ? null : <Banner model={banner} />}
    </section>
  );
}
