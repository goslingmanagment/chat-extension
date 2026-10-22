// Recap in the dock sheet and its window (ui-design §4.11, §10; AI-060…AI-071):
// «Коротко | Полностью», the text (one paragraph, or blocks «Кто / Траты /
// Триггеры…», «Досье…»), and the facts row — when it was made, what it covers
// («вся переписка (90 сообщений)»), whether it is saved to the hub, whether
// the chat went on after it. With nothing saved the sheet is the picker: what
// exists («Открыть последний») and the two build buttons; it takes the focus
// on its full one, so ⌘⇧S then Enter builds the full Recap (AI-060) and never
// sends the draft in the site's field. The shared Recap of the page and fan
// comes from the hub; nothing here generates by itself.

import { type JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

import { type ActionButtonVM, type Msg, type RecapLength, type RecapPickerVM, type RecapViewVM } from '@cg/contracts/vm';

import {
  ActionButton,
  Button,
  Dot,
  Markdown,
  Segmented,
  Spinner,
  ViewState,
  activeIn,
  focusQuietly,
  hotkeyText,
  isComposing,
  isHeldKey,
  useDispatch,
  useI18n,
  useKit,
  useView,
} from '../../kit';
import { useReadyAnnouncement, useStageAnnouncements } from '../announce';
import { Head, Meta } from '../Head';
import { StaleRow } from '../Result';
import { useSteadyView, useStreamText } from '../Stream';
import { Block, Close, CopyAll, Expand, Fact, Facts, MadeAgo, RefreshFailedFact, ReportHead, Running, debugFooter, running, type BlockTone, type ViewProps } from './shared';

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
      // Nothing to say (2026-10-22: no toast either): the row stays for what needs a hand.
      return null;
    case 'failed':
      // The text stays shown and copyable; only the idempotent reference write repeats, never the AI — and the
      // row says so: «не сохранено в хаб», «Сохранить ещё раз», never a «Повторить» that reads as a new generation.
      return (
        <>
          <Fact>
            <Dot kind="danger" />
            <span>
              <span class="cg-fact__code">{`${i18n.t('common.errorSource', { code: saved.error.code })}:`}</span> {i18n.t('cg.recapSave.line')}
            </span>
          </Fact>
          <Button label={i18n.t('cg.recapSave.action')} size="sm" class="cg-fact__btn" tooltip={i18n.t('cg.recapSave.actionTooltip')} onClick={() => void dispatch(saved.retry)} />
        </>
      );
  }
}

/** What the Recap read, as the old client said it: «вся переписка (90 сообщений)» or «последние 300 — история длиннее». */
function coverageLine(i18n: ReturnType<typeof useI18n>, stamp: RecapViewVM['stamp']): string | null {
  const { coverage, served } = stamp;
  if (served !== null && coverage === 'complete') return i18n.plural('recap.coverage.whole', served);
  if (served !== null && coverage === 'partial') return i18n.t('recap.coverage.window', { n: served });
  // A cut whose size is not known is still said; «охват неизвестен» was a grey word to skip (2026-10-20).
  return coverage === 'partial' ? i18n.t('common.coverage.partial') : null;
}

function RecapFacts({ recap }: { readonly recap: RecapViewVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const covers = coverageLine(i18n, recap.stamp);
  const lag = recap.archiveLag;
  const refresh = recap.refresh;
  return (
    <Facts>
      {recap.generatedAt === null ? null : (
        <Fact>
          <MadeAgo at={recap.generatedAt} />
        </Fact>
      )}
      {covers === null ? null : <Fact>{covers}</Fact>}
      {/* Who reads this Recap: the full one goes to Reply and Ping too once the hub holds it as the fan's dossier. */}
      {recap.generatedAt === null || recap.saved.s === 'failed' ? null : (
        <Fact>{i18n.t(recap.unread === true ? 'recap.usedBy.off' : recap.length === 'full' ? 'recap.usedBy.full' : 'recap.usedBy.short')}</Fact>
      )}
      <SavedFact saved={recap.saved} />
      <RefreshFailedFact failed={recap.refreshFailed} />
      {/* The chat went on after the Recap: said in its words, «Обновить» right by it. */}
      {lag === null ? null : (
        <>
          <Fact strong>
            <Dot kind="accent" use="archive-lag" />
            {lag.messages === null ? i18n.t('recap.newAfterSome') : i18n.plural('recap.newAfter', lag.messages)}
          </Fact>
          {recap.refreshFailed === null ? (
            <Button
              label={i18n.text(refresh.label)}
              size="sm"
              class="cg-fact__btn"
              reason={refresh.enabled ? null : refresh.reason === null ? i18n.t('common.unknown') : i18n.text(refresh.reason.text)}
              onClick={() => void dispatch(refresh.action)}
            />
          ) : null}
        </>
      )}
    </Facts>
  );
}

/**
 * A Recap block's colour by its heading (the old client matched its headings the same way): money green, what he
 * answers to amber, what to avoid red, what to do now terracotta — the tinted card; any other heading stays plain.
 * «трат» only at a word's start: «Стратегия» is what to do, not money.
 */
const HEADING_TONES: readonly (readonly [RegExp, BlockTone])[] = [
  [/куп|(?<!\p{L})трат|деньг|финанс|плат|bought|spend|money|financ|paid/iu, 'good'],
  [/избег|границ|риск|нельзя|avoid|boundar|risk/iu, 'bad'],
  [/люб|отвеча|триггер|интерес|заход|like|answers|trigger|hot/iu, 'amber'],
  [/сейчас|дальше|следующ|стратег|ход|now|next|strateg|move/iu, 'clay'],
];

export function headingTone(heading: string): BlockTone {
  return HEADING_TONES.find(([pattern]) => pattern.test(heading))?.[1] ?? 'plain';
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

/**
 * The saved recaps are still being read («Проверяю сохранённые Recap…») and a build can already be started:
 * the build buttons do not wait for that read. It only tells what is saved — and when the hub is slow to
 * reach it lasted 20 s on the first live check, with nothing to press meanwhile.
 */
export function checkingWithBuild(picker: RecapPickerVM): boolean {
  return picker.view.s === 'loading' && (picker.build.short.enabled || picker.build.full.enabled);
}

/**
 * Where the picker puts the focus when the sheet opens on it (⌘⇧S or the bar's button): «Собрать полностью», so Enter
 * builds the full Recap and never reaches the site's field, where it would send the draft (the old client focused its
 * «Полный» the same way). Only from the site's composer, the page or this dock — never from a field the person types
 * in or another panel of ours (the fan panel's own Recap tab). While the saved recaps are still read the group holds
 * the focus — Enter builds nothing yet — and hands it to the button once they are known, unless the person took the
 * focus elsewhere meanwhile.
 */
function usePickerFocus(take: boolean, checking: boolean): { readonly group: { current: HTMLDivElement | null }; readonly full: { current: HTMLButtonElement | null } } {
  const { deps, root } = useKit();
  const group = useRef<HTMLDivElement>(null);
  const full = useRef<HTMLButtonElement>(null);
  const wanted = useRef(take);
  const held = useRef(false);
  useLayoutEffect(() => {
    if (!wanted.current || group.current === null) return;
    // After the group took it, only a focus still on the group moves on.
    if (held.current && activeIn(root) !== group.current) {
      wanted.current = false;
      return;
    }
    if (!held.current) {
      const where = deps.focus.where?.();
      const idle = where === 'composer' || where === 'none' || where === 'page' || (where === 'ours' && activeIn(root) !== null);
      if (!idle) {
        wanted.current = false;
        return;
      }
    }
    if (checking) {
      if (!held.current) held.current = focusQuietly(group.current);
      return;
    }
    focusQuietly(full.current ?? group.current);
    wanted.current = false;
  });
  return { group, full };
}

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
  const none = i18n.t('cg.recapNotFound.title');
  const lengths = (
    <Segmented
      label={i18n.t('recap.lengthLabel')}
      value={recap.length}
      options={[
        { value: 'short', label: i18n.t('recap.short'), reason: recap.lengths.short ? null : none },
        { value: 'full', label: i18n.t('recap.full'), reason: recap.lengths.full ? null : none },
      ]}
      onChange={(length) => void dispatch({ type: 'ShowRecap', length })}
    />
  );

  const debug = debugFooter(debugPart, recap.debug, recap.state, recap.phase);
  // The live region: the stages while it is built, then «Recap готов». The sheet says it; the window stays quiet.
  const said = place === 'sheet' ? (recap.opId ?? 'recap') : null;
  useStageAnnouncements(title, running(recap.state) ? said : null, recap.phase);
  useReadyAnnouncement(place === 'sheet' ? 'recap' : null, running(recap.state), recap.markdown !== null, () => i18n.t('dock.badge.recapReady'));

  // The picker takes the focus only on the sheet's opening (⌘⇧S, the bar's button): the first time this sheet shows
  // something other than its loading state. A picker shown later (a canceled build) leaves the focus where it is.
  const opening = useRef(place === 'sheet');
  const settled = recap.expanded || running(recap.state) || recap.markdown !== null || recap.view.s !== 'loading' || checkingWithBuild(picker);
  useLayoutEffect(() => {
    if (settled) opening.current = false;
  });

  // In the «Развернуть ↗» window (X55: where a Recap opens) the sheet keeps only its head: the text is read once, up there.
  if (place === 'sheet' && recap.expanded) {
    return (
      <Head title={title} gutter={running(recap.state) ? <Spinner /> : null} acts={close}>
        <Meta texts={forFan} />
      </Head>
    );
  }

  if (running(recap.state)) return <Running title={title} opId={recap.opId} phase={recap.phase} text={text} debug={debug} place={place} which="recap" fan={name} />;

  if (recap.markdown === null) {
    // The read of the saved recaps does not hold the build buttons back: the picker shows its own «Проверяю…» line.
    const failed = recap.view.s === 'error' || recap.view.s === 'forbidden' || recap.view.s === 'offline' || (recap.view.s === 'loading' && !checkingWithBuild(picker));
    const body = failed ? (
      <ViewState view={recap.view} />
    ) : (
      <Picker picker={picker} why={recap.view.s === 'empty' ? recap.view.why : null} takeFocus={opening.current} primary={place === 'dialog' ? recap.length : 'full'} />
    );
    return (
      <>
        {place === 'dialog' ? (
          // In the window the length stays switchable: «Коротко» with nothing saved yet shows its build buttons here.
          <ReportHead kicker={title} title={title} fan={name} tools={lengths} acts={close} />
        ) : (
          <Head title={title} acts={close}>
            <Meta texts={forFan} />
          </Head>
        )}
        <div class="cg-body">{body}</div>
        {debug}
      </>
    );
  }

  const mark = recap.stale ?? null;
  const againReason = recap.refresh.enabled ? null : recap.refresh.reason === null ? i18n.t('common.unknown') : i18n.text(recap.refresh.reason.text);
  const acts = (
    <>
      <CopyAll handle={recap.copyHandle} label={i18n.t('recap.copy')} />
      <Expand which="recap" place={place} />
      <Refresh vm={recap.refresh} />
      {close}
    </>
  );
  return (
    <>
      {place === 'dialog' ? (
        <ReportHead kicker={title} title={title} fan={name} tools={lengths} acts={acts} />
      ) : (
        <Head title={title} tools acts={acts}>
          {lengths}
          <Meta texts={forFan} />
        </Head>
      )}
      <div class="cg-body">
        {/* The site's verdict over the Recap this tab built (R20 P8c): «Ещё раз» builds it anew, as «↻ Обновить». */}
        {mark === null ? null : <StaleRow mark={mark} onAgain={() => void dispatch(recap.refresh.action)} reason={againReason} />}
        <div class="cg-doc">
          {recap.blocks === null ? (
            <Markdown source={recap.markdown} decorate />
          ) : (
            recap.blocks.map((block, index) => {
              const tone = headingTone(block.heading);
              return (
                <Block key={index} title={block.heading} tone={tone} tinted={tone === 'clay'}>
                  <Markdown source={block.markdown} decorate />
                </Block>
              );
            })
          )}
        </div>
      </div>
      <RecapFacts recap={recap} />
      {debug}
    </>
  );
}
