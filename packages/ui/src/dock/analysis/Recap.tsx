// Recap in the dock sheet (ui-design §4.11, §10; AI-060…AI-071): «Коротко |
// Полностью», the text (one paragraph, or blocks «Кто он / Что любит /
// Покупки…»), and the facts row — when it was made, whether it is saved to
// the hub, how complete the archive is and whether it lags the chat. With
// nothing saved the sheet is the picker: what exists («Открыть последний»)
// and the two build buttons (Enter builds the full one). The shared Recap of
// the page and fan comes from the hub; nothing here generates by itself.

import { type JSX } from 'preact';

import { type ActionButtonVM, type Msg, type RecapPickerVM, type RecapViewVM } from '@cg/contracts/vm';

import {
  ActionButton,
  Button,
  Dot,
  Icon,
  MINUTE,
  Markdown,
  Segmented,
  Spinner,
  ViewState,
  hotkeyText,
  isComposing,
  isHeldKey,
  useDispatch,
  useI18n,
  useMinuteClock,
  useNowFn,
  useView,
} from '../../kit';
import { useReadyAnnouncement, useStageAnnouncements } from '../announce';
import { Head, Meta } from '../Head';
import { useSteadyView, useStreamText } from '../Stream';
import { Close, CopyAll, Expand, Fact, Facts, Running, debugFooter, running, type ViewProps } from './shared';

function SavedFact({ saved }: { readonly saved: RecapViewVM['saved'] }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  switch (saved.s) {
    case 'not-applicable':
      return null;
    case 'saving':
      return (
        <Fact>
          <Spinner />
          {i18n.t('result.stage.saving')}
        </Fact>
      );
    case 'saved':
      return (
        <Fact>
          <Icon name="check" size={13} />
          {i18n.t('recap.savedToHub')}
        </Fact>
      );
    case 'failed':
      // The text stays shown and copyable; only the idempotent reference write repeats, never the AI.
      return (
        <>
          <Fact>
            <Dot kind="danger" />
            <span>
              <span class="cg-fact__code">{`${i18n.t('common.errorSource', { code: saved.error.code })}:`}</span> {saved.error.title}
            </span>
          </Fact>
          <Button label={i18n.t('common.retry')} size="sm" class="cg-fact__btn" tooltip={saved.error.body} onClick={() => void dispatch(saved.retry)} />
        </>
      );
  }
}

function RecapFacts({ recap }: { readonly recap: RecapViewVM }): JSX.Element {
  const i18n = useI18n();
  const coverage = recap.stamp.coverage;
  return (
    <Facts>
      {recap.generatedAt === null ? null : (
        <Fact>
          <MadeAgo at={recap.generatedAt} />
        </Fact>
      )}
      <SavedFact saved={recap.saved} />
      <Fact>{i18n.t(coverage === 'complete' ? 'recap.archiveComplete' : coverage === 'partial' ? 'common.coverage.partial' : 'common.coverage.unknown')}</Fact>
      {recap.archiveLag === null ? null : (
        <Fact strong>
          <Dot kind="accent" use="archive-lag" />
          {recap.archiveLag.messages === null ? i18n.t('common.coverage.partial') : i18n.t('recap.archiveLag', { n: recap.archiveLag.messages })}
        </Fact>
      )}
    </Facts>
  );
}

/** «Сделан 1 д назад», refreshed on the shared minute ticker; under a minute — «Сделан только что». */
export function MadeAgo({ at }: { readonly at: string }): JSX.Element {
  const i18n = useI18n();
  const now = useNowFn();
  useMinuteClock();
  const fresh = now() - Date.parse(at) < MINUTE;
  return <>{fresh ? i18n.t('review.madeNow') : i18n.t('recap.madeAgo', { age: i18n.formatAge(at, now()) })}</>;
}

function Refresh({ vm }: { readonly vm: ActionButtonVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const keys = hotkeyText(vm.hotkey);
  return (
    <Button
      label={i18n.text(vm.label)}
      icon="refresh"
      class="cg-refresh"
      hotkey={vm.hotkey}
      tooltip={i18n.t('recap.refreshTooltip', { hotkey: keys?.display ?? '' }).trim()}
      reason={vm.enabled ? null : vm.reason === null ? i18n.t('common.unknown') : i18n.text(vm.reason.text)}
      onClick={() => void dispatch(vm.action)}
    />
  );
}

function Picker({ picker, why }: { readonly picker: RecapPickerVM; readonly why: Msg | null }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (picker.view.s === 'loading' || picker.view.s === 'error' || picker.view.s === 'forbidden' || picker.view.s === 'offline') {
    return <ViewState view={picker.view} />;
  }
  const slots = [picker.slots.short, picker.slots.full].filter((slot) => slot !== null);
  // «Recap ещё не сделан» only when nothing is saved: with a saved one the rows speak for themselves.
  const note = slots.length > 0 ? null : (why ?? (picker.view.s === 'empty' ? picker.view.why : null));
  const build = picker.build.full;
  return (
    <div
      class="cg-pick"
      role="group"
      aria-label={i18n.t('dock.action.recap')}
      tabIndex={0}
      onKeyDown={(event) => {
        // Enter builds the full Recap (AI-060); a focused button answers for itself.
        if (event.target !== event.currentTarget || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || isComposing(event)) return;
        event.preventDefault();
        // A held Enter builds one Recap.
        if (build.enabled && !isHeldKey(event)) void dispatch(build.action);
      }}
    >
      <span class="cg-gut" />
      <div class="cg-pick__main">
        {note === null ? null : <div class="cg-pick__note">{i18n.text(note)}</div>}
        {slots.map((slot) => (
          <div key={slot.length} class="cg-pick__slot" data-cg-slot={slot.length}>
            <span class="cg-pick__name">{i18n.t(slot.length === 'short' ? 'recap.short' : 'recap.full')}</span>
            <span class="cg-pick__age">
              <MadeAgo at={slot.generatedAt} />
            </span>
            <ActionButton vm={slot.open} variant="line" size="sm" />
          </div>
        ))}
        <div class="cg-pick__acts">
          <ActionButton vm={picker.build.short} variant="line" />
          <ActionButton vm={{ ...build, hotkey: build.hotkey ?? { display: '↵', aria: 'Enter', delivery: 'delivered', fallback: null } }} variant="line" />
        </div>
      </div>
    </div>
  );
}

export function RecapView({ place, debugPart }: ViewProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const raw = useView({ of: 'recap.view' });
  const recap = useSteadyView(raw).value;
  const picker = useView({ of: 'recap.picker' }).value;
  const text = useStreamText(raw, (view) => view.streamText);
  const title = i18n.t('dock.action.recap');
  const close = <Close which="recap" place={place} />;
  const name = recap.targetName ?? picker.targetName;
  const forFan = name === null ? [] : [i18n.t('result.meta.forFan', { name })];

  const debug = debugFooter(debugPart, recap.debug, recap.state, recap.phase);
  // The live region: the stages while it is built, then «Recap готов». The sheet says it; the window stays quiet.
  const said = place === 'sheet' ? (recap.opId ?? 'recap') : null;
  useStageAnnouncements(title, running(recap.state) ? said : null, recap.phase);
  useReadyAnnouncement(place === 'sheet' ? 'recap' : null, running(recap.state), recap.markdown !== null, () => i18n.t('dock.badge.recapReady'));

  if (running(recap.state)) return <Running title={title} opId={recap.opId} phase={recap.phase} text={text} debug={debug} />;

  if (recap.markdown === null) {
    const failed = recap.view.s === 'error' || recap.view.s === 'forbidden' || recap.view.s === 'offline' || recap.view.s === 'loading';
    return (
      <>
        <Head title={title} acts={close}>
          <Meta texts={forFan} />
        </Head>
        <div class="cg-body">{failed ? <ViewState view={recap.view} /> : <Picker picker={picker} why={recap.view.s === 'empty' ? recap.view.why : null} />}</div>
        {debug}
      </>
    );
  }

  const none = i18n.t('cg.recapNotFound.title');
  return (
    <>
      <Head
        title={title}
        acts={
          <>
            <CopyAll handle={recap.copyHandle} label={i18n.t('recap.copy')} />
            {recap.blocks === null ? null : <Expand which="recap" place={place} />}
            <Refresh vm={recap.refresh} />
            {close}
          </>
        }
      >
        <Segmented
          label={i18n.t('recap.lengthLabel')}
          value={recap.length}
          options={[
            { value: 'short', label: i18n.t('recap.short'), reason: recap.lengths.short ? null : none },
            { value: 'full', label: i18n.t('recap.full'), reason: recap.lengths.full ? null : none },
          ]}
          onChange={(length) => void dispatch({ type: 'ShowRecap', length })}
        />
        <Meta texts={forFan} />
      </Head>
      <div class="cg-body">
        {recap.blocks === null ? (
          <div class="cg-prose">
            <span />
            <Markdown source={recap.markdown} />
          </div>
        ) : (
          <div class="cg-blocks">
            {recap.blocks.map((block, index) => (
              <div key={index} class="cg-block">
                <b>{block.heading}</b>
                <Markdown source={block.markdown} />
              </div>
            ))}
          </div>
        )}
      </div>
      <RecapFacts recap={recap} />
      {debug}
    </>
  );
}
