// Recap of the dock (ui-design §4.11, §10; AI-060…AI-071). Since 2026-10-28 a Recap opens in its window
// (RecapWindow: the owner's «Досье во весь экран»), with nothing saved too, on the choice of the two; «Свернуть» folds it
// into the cheat sheet over the bar (RecapCrib). The dock's own sheet keeps what has no window: a build followed from
// elsewhere, the picker of a sheet opened without the window, a view that cannot show recaps at all. The picker takes
// the focus on its full build, so ⌘⇧S then Enter builds the full Recap (AI-060) and never sends the draft in the site's
// field. The shared Recap of the page and fan comes from the hub; nothing here generates by itself.

import { type JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

import { type Msg, type RecapLength, type RecapPickerVM } from '@cg/contracts/vm';

import { ActionButton, Button, Spinner, ViewState, isComposing, isHeldKey, useDispatch, useI18n, useView } from '../../kit';
import { useReadyAnnouncement, useStageAnnouncements } from '../announce';
import { Head, Meta } from '../Head';
import { useSteadyView, useStreamText } from '../Stream';
import { checkingWithBuild, usePickerFocus } from './recap-facts';
import { RecapCrib } from './RecapCrib';
import { RecapWindow } from './RecapWindow';
import { Close, MadeAgo, Running, debugFooter, running, type ViewProps } from './shared';

/**
 * `primary` — the build that comes first, highlighted and on Enter: the full one in the sheet (AI-060); in the window the
 * length the person switched to («Коротко» with nothing saved yet: «Собрать коротко»).
 */
function Picker({ picker, why, takeFocus, primary }: { readonly picker: RecapPickerVM; readonly why: Msg | null; readonly takeFocus: boolean; readonly primary: RecapLength }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const checking = checkingWithBuild(picker);
  const listed = checking || !(picker.view.s === 'loading' || picker.view.s === 'error' || picker.view.s === 'forbidden' || picker.view.s === 'offline');
  const focus = usePickerFocus(takeFocus, checking);
  if (!listed) return <ViewState view={picker.view} />;
  const slots = [picker.slots.short, picker.slots.full].filter((slot) => slot !== null);
  // «Recap ещё не сделан» only when nothing is saved: with a saved one the rows speak for themselves.
  const note = checking || slots.length > 0 ? null : (why ?? (picker.view.s === 'empty' ? picker.view.why : null));
  const build = picker.build[primary];
  const other = picker.build[primary === 'full' ? 'short' : 'full'];
  // The Recap key builds the length shown (it is the sheet's «Обновить»): its label goes on that button, else ↵.
  const keyed = picker.build.full.hotkey ?? { display: '↵', aria: 'Enter', delivery: 'delivered' as const, fallback: null };
  const first = checking ? { ...build, hotkey: null } : { ...build, hotkey: build.enabled ? keyed : null };
  return (
    <div
      ref={focus.group}
      class="cg-pick"
      role="group"
      aria-label={i18n.t('dock.action.recap')}
      tabIndex={0}
      onKeyDown={(event) => {
        // Enter builds the first one — the full Recap in the sheet (AI-060); a focused button answers for itself.
        if (event.target !== event.currentTarget || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || isComposing(event)) return;
        event.preventDefault();
        // A held Enter builds one Recap. While the saved ones are still being read a build takes an explicit
        // click: Enter must not spend a full Recap on a fan who may already have one.
        if (build.enabled && !checking && !isHeldKey(event)) void dispatch(build.action);
      }}
    >
      <span class="cg-gut">{checking ? <Spinner /> : null}</span>
      <div class="cg-pick__main">
        {checking && picker.view.s === 'loading' ? (
          <div class="cg-pick__note" role="status" aria-busy="true">
            {picker.view.stage === null ? i18n.t('common.loading') : i18n.text(picker.view.stage)}
          </div>
        ) : null}
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
        {/* The primary one first: what Enter builds (AI-060), as the old client's «Полный». */}
        <div class="cg-pick__acts">
          <Button
            label={i18n.text(first.label)}
            variant="line"
            class="cg-pick__first"
            hotkey={first.hotkey}
            buttonRef={focus.full}
            reason={first.enabled ? null : first.reason === null ? i18n.t('common.unknown') : i18n.text(first.reason.text)}
            onClick={() => void dispatch(first.action)}
          />
          <ActionButton vm={{ ...other, hotkey: null }} variant="line" />
        </div>
        {/* Which one to build, said once by the buttons: who uses each and what it costs in time. */}
        <div class="cg-pick__explain">{i18n.t('recap.picker.explain')}</div>
      </div>
    </div>
  );
}

export function RecapView({ place, debugPart }: ViewProps): JSX.Element {
  const part = debugPart === undefined ? {} : { debugPart };
  return place === 'dialog' ? <RecapWindow {...part} /> : <RecapSheet {...part} />;
}

/**
 * What the dock keeps over the bar (2026-10-28): nothing while the window shows the Recap (it opens there by default);
 * folded, the cheat sheet; else what has no window of its own — a build followed from elsewhere, the choice of the two,
 * a view that cannot show recaps at all.
 */
function RecapSheet({ debugPart }: Pick<ViewProps, 'debugPart'>): JSX.Element {
  const i18n = useI18n();
  const raw = useView({ of: 'recap.view' });
  const recap = useSteadyView(raw).value;
  const picker = useView({ of: 'recap.picker' }).value;
  const text = useStreamText(raw, (view) => view.streamText);
  const title = i18n.t('dock.action.recap');
  const name = recap.targetName ?? picker.targetName;
  const forFan = name === null ? [] : [i18n.t('result.meta.forFan', { name })];
  const building = running(recap.state);

  const debug = debugFooter(debugPart, recap.debug, recap.state, recap.phase);
  // The live region: the stages while it is built, then «Recap готов». The sheet says it, window or not.
  useStageAnnouncements(title, building ? (recap.opId ?? 'recap') : null, recap.phase);
  useReadyAnnouncement('recap', building, recap.markdown !== null, () => i18n.t('dock.badge.recapReady'));

  // The choice takes the focus only as the sheet opens on it: a choice shown later (a canceled build) leaves it be.
  const opening = useRef(true);
  const settled = recap.expanded || building || recap.markdown !== null || recap.view.s !== 'loading' || checkingWithBuild(picker);
  useLayoutEffect(() => {
    if (settled) opening.current = false;
  });

  if (recap.expanded) return <i class="cg-rx-away" hidden />;
  if (recap.markdown !== null || (building && recap.kept !== undefined && recap.kept !== null)) return <RecapCrib recap={recap} />;
  if (building) return <Running title={title} opId={recap.opId} phase={recap.phase} text={text} debug={debug} place="sheet" which="recap" fan={name} />;
  // The read of the saved recaps does not hold the build buttons back: the picker shows its own «Проверяю…» line.
  const failed = recap.view.s === 'error' || recap.view.s === 'forbidden' || recap.view.s === 'offline' || (recap.view.s === 'loading' && !checkingWithBuild(picker));
  return (
    <>
      <Head title={title} acts={<Close which="recap" place="sheet" />}>
        <Meta texts={forFan} />
      </Head>
      <div class="cg-body">
        {failed ? <ViewState view={recap.view} /> : <Picker picker={picker} why={recap.view.s === 'empty' ? recap.view.why : null} takeFocus={opening.current} primary="full" />}
      </div>
      {debug}
    </>
  );
}
