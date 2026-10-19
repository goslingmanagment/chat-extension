// A fan's preview without opening the chat (architecture.md §6.5, §6.7, D-27;
// ui-design §4.16, §4.17; SP-050…SP-056, NF-009, NF-010, NEW-10): the header,
// «Чат не открыт, останется непрочитанным», the archive line with its
// coverage and lag, the hub's archive feed, then the tools — the local draft
// for Fix and the mini strip, which stay in place — and under them the work
// zone, which scrolls: the result with «Отправить» on every part. Under the
// strip, the media picker (X53): the vault's media that go with the next part sent.
// The same pane is the card of «Новые», where the draft is the greeting
// draft (NF-012). It renders PreviewVM and nothing else: it never reads
// ChatSpace and never loads a chat's history.
//
// The pieces below are shared with the Spenders panel (PanelPreview.tsx,
// X65), which lays them out under the list across the window.

import { type ComponentChildren, type JSX, type TargetedKeyboardEvent } from 'preact';

import { type IsoTimestamp } from '@cg/contracts/primitives';
import { type ClaimVM, type I18n, type Msg, type PreviewActionId, type PreviewSource, type PreviewVM } from '@cg/contracts/vm';

import { ActionButton, Button, Dot, ErrorCard, Icon, Money, TextField, ViewState, isComposing, useCountdown, useDispatch, useI18n, useMinuteClock, useNowFn, useTooltip, useView, type StyleSource } from '../../kit';
import { useOwnEchoes } from '../ownEchoes';
import { coverageWord, isPlainKey, isTextEntry, timeOrUnknown } from '../window';
import { Feed, FEED_CSS } from './Feed';
import { MINI_STRIP_CSS, MiniStrip, generateAction } from './MiniStrip';
import { PreviewResult, RESULT_CSS } from './Result';
import { MEDIA_PICKER_CSS, MediaAttachedContext, MediaPicker } from './MediaPicker';
import { SEND_ROW_CSS } from './SendRow';

const KIND_KEYS = { new: 'newcomers.kind.new', renewed: 'newcomers.kind.renewed', returning: 'newcomers.kind.returning' } as const;

/** Whether a key event is the combination an `aria-keyshortcuts` value names («Meta+E», «Control+Alt+B»); letters by the physical key. */
export function matchesHotkey(event: KeyboardEvent, aria: string): boolean {
  return aria.split(' ').some((combination) => {
    const keys = combination.split('+');
    const letter = keys.pop();
    if (letter === undefined || !/^[A-Za-z]$/.test(letter)) return false;
    return (
      event.metaKey === keys.includes('Meta') &&
      event.ctrlKey === keys.includes('Control') &&
      event.altKey === keys.includes('Alt') &&
      event.shiftKey === keys.includes('Shift') &&
      event.code === `Key${letter.toUpperCase()}`
    );
  });
}

export function metaLine(i18n: I18n, header: NonNullable<PreviewVM['header']>): string | null {
  if (header.newcomer !== null) return i18n.t('newcomers.cardMeta', { kind: i18n.t(KIND_KEYS[header.newcomer.kind]), age: { age: header.newcomer.subscribedAt } });
  return bothAges(i18n, header);
}

/** «Мы писали 10 ч назад, фан 7 мин назад» (SP-052); also the tooltip of the list's «Ждёт» (X65). Null — neither is known. */
export function bothAges(i18n: I18n, { weWroteAt, fanWroteAt }: { readonly weWroteAt: IsoTimestamp | null; readonly fanWroteAt: IsoTimestamp | null }): string | null {
  if (weWroteAt !== null && fanWroteAt !== null) return i18n.t('preview.meta', { ourAge: { age: weWroteAt }, fanAge: { age: fanWroteAt } });
  if (weWroteAt !== null) return i18n.t('preview.metaFanUnknown', { ourAge: { age: weWroteAt } });
  if (fanWroteAt !== null) return i18n.t('preview.metaOurUnknown', { fanAge: { age: fanWroteAt } });
  return null;
}

function Header({ vm, closable }: { readonly vm: PreviewVM; readonly closable: boolean }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const header = vm.header;
  const meta = header === null ? null : metaLine(i18n, header);
  return (
    <header class="cg-pv__head">
      <div class="cg-pv__who">
        {header === null ? null : (
          <>
            <h3 class="cg-pv__name">
              {header.name}
              {header.username === null ? null : <span>@{header.username}</span>}
            </h3>
            {header.newcomer !== null ? null : (
              <div class="cg-pv__money cg-num">
                <Money mills={header.lifetime} zero="show" class="cg-pv__life" />
                {header.period30 !== null && header.period30 > 0 ? <span class="cg-money">{i18n.t('preview.moneyIn', { moneyIn: { money: header.period30, sign: 'plus' } })}</span> : null}
              </div>
            )}
            {meta === null ? null : <div class={`cg-pv__meta${header.newcomer === null ? '' : ' cg-pv__meta--tight'}`}>{meta}</div>}
          </>
        )}
      </div>
      {header === null ? null : <ActionButton vm={vm.openChat} variant="line" />}
      {closable ? <Button label={i18n.t('preview.closeAria')} icon="x" iconOnly variant="quiet" onClick={() => void dispatch(vm.close)} /> : null}
    </header>
  );
}

function UnreadLine({ unread }: { readonly unread: PreviewVM['unread'] }): JSX.Element {
  const i18n = useI18n();
  const kept = unread === 'kept';
  const tip = useTooltip(i18n.t(kept ? 'preview.notOpenedTooltip' : 'preview.notOpenedAfterSendTooltip'));
  return (
    <div class="cg-pv__note" data-cg-unread={unread}>
      <Icon name="eyeOff" size={14} />
      <span {...tip.props}>
        {i18n.t(kept ? 'preview.notOpened' : 'preview.notOpenedAfterSend')}
        {tip.description}
      </span>
    </div>
  );
}

/** The archive's time, lag and coverage with «Обновить архив»; `quiet` — the Spenders panel's centred line, `lead` its own words (X65). */
export function ArchiveLine({ vm, quiet = false, lead = null }: { readonly vm: PreviewVM; readonly quiet?: boolean; readonly lead?: string | null }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { archive } = vm;
  const time = timeOrUnknown(i18n, archive.stamp.asOf);
  const refresh = archive.refresh;
  // In the panel an unknown coverage is the norm of a site whose archive does not say it: not spelled out.
  const coverageSays = quiet ? archive.stamp.coverage === 'partial' : archive.stamp.coverage !== 'complete';
  return (
    <div class={`cg-pv__arch${quiet ? ' is-quiet' : ''}`}>
      {vm.fanWroteNew ? (
        // The fan's new text is not shown until the archive has it (§6.7.5): only this line.
        <span class="cg-pv__lag" role="status">
          <Dot kind="accent" use="preview-fan-wrote" />
          {i18n.t('preview.fanWroteNew')}
        </span>
      ) : (
        <span class="cg-pv__asof">
          {lead ?? (archive.lagMinutes === null ? i18n.t('common.archiveAsOf', { time }) : i18n.t('preview.archiveLag', { time, n: archive.lagMinutes }))}
          {coverageSays && lead === null ? <span class="cg-pv__cov">{coverageWord(i18n, archive.stamp.coverage)}</span> : null}
        </span>
      )}
      <Button
        label={i18n.text(refresh.label)}
        size="sm"
        busy={archive.refreshing}
        reason={refresh.enabled ? null : refresh.reason === null ? i18n.t('common.unknown') : i18n.text(refresh.reason.text)}
        onClick={() => void dispatch(refresh.action)}
      />
    </div>
  );
}

/** The own greeting lease of the card («Новые»), above the strip: it counts down and can be renewed or let go. */
function OwnLease({ claim }: { readonly claim: Extract<ClaimVM, { s: 'mine' }> }): JSX.Element {
  const i18n = useI18n();
  const remaining = useCountdown(claim.until, useNowFn());
  return (
    <div class="cg-pv__lease" data-cg-claim="mine">
      <span class="cg-num">{i18n.t('newcomers.claim.mine', { mss: { duration: remaining, style: 'm:ss' } })}</span>
      <ActionButton vm={claim.renew} variant="plain" size="sm" />
      <ActionButton vm={claim.release} variant="quiet" size="sm" />
    </div>
  );
}

/**
 * Why Hi is off for this fan, under the strip (ui-design §4.17): a colleague
 * holds the lease — no name and no countdown (§12 п. 5) —, it is held in
 * another tab, it expired, the row changed, or a part's outcome is unknown.
 */
function LeaseNote({ claim, hasResult, stoppedNote }: { readonly claim: ClaimVM; readonly hasResult: boolean; readonly stoppedNote: Msg | null }): JSX.Element | null {
  const i18n = useI18n();
  switch (claim.s) {
    case 'none':
    case 'mine':
      return null;
    case 'elsewhere':
      return (
        <div class="cg-pv__claimnote" data-cg-claim="elsewhere">
          {i18n.text(claim.note)}
        </div>
      );
    case 'other':
    case 'expired':
    case 'row-changed':
      return (
        <div data-cg-claim={claim.s}>
          <ErrorCard error={claim.error} tone="state" copyCode={false} />
        </div>
      );
    case 'held-uncertain': {
      // With the result on screen the uncertain part and the note under the parts say it already.
      if (hasResult) return null;
      // Without it the card says what the note would: we wait for a team lead or the owner. The registry's
      // body of CG-SEND-UNCERTAIN advises to insert the part by hand; a preview never gives that advice
      // (ui-design §4.13, §9.5 п. 5; architecture §6.7.8: no «в архиве нет — значит не ушло»).
      const body = i18n.text(stoppedNote ?? { key: 'newcomers.stopped', params: { n: claim.part } });
      return (
        <div data-cg-claim="held-uncertain">
          <ErrorCard error={{ ...claim.error, body }} tone="state" copyCode={false} />
        </div>
      );
    }
  }
}

export function hasBody(vm: PreviewVM): boolean {
  return vm.view.s !== 'error' && vm.view.s !== 'forbidden';
}

/**
 * The keys of a preview with focus inside it: ⌘E / ⌘I / ⌘G / ⌘P start THIS fan's generation (HK-042); ← → and
 * J / K outside our fields go to the neighbouring fan (SP-056).
 */
export function usePreviewKeys(vm: PreviewVM): (event: TargetedKeyboardEvent<HTMLElement>) => void {
  const dispatch = useDispatch();
  return (event) => {
    if (event.defaultPrevented || isComposing(event)) return;
    // The early dispatcher gets a global key first; what it took comes here already prevented.
    for (const id of Object.keys(vm.bar.actions) as PreviewActionId[]) {
      const action = vm.bar.actions[id];
      if (action === undefined || action.hotkey === null || !matchesHotkey(event, action.hotkey.aria)) continue;
      event.preventDefault();
      const start = action.enabled ? generateAction(vm, id) : null;
      if (start !== null) void dispatch(start);
      return;
    }
    if (isTextEntry(event.target) || !isPlainKey(event) || event.shiftKey) return;
    // Arrows inside an open menu are the menu's.
    if (event.target instanceof Element && event.target.closest('[role="menu"]') !== null) return;
    // Letters by the physical key.
    const step = event.code === 'ArrowLeft' || event.code === 'KeyK' ? vm.neighbors.previous : event.code === 'ArrowRight' || event.code === 'KeyJ' ? vm.neighbors.next : undefined;
    if (step === undefined) return;
    event.preventDefault();
    if (step !== null) void dispatch(step);
  };
}

/**
 * The local draft: the Fix source in a Spenders preview, the greeting draft in the card of «Новые» (NF-012,
 * ui-design §10 «черновик — поле как в превью») — there the field is always at hand, Fix or not. Nothing when the
 * preview has no Fix and the draft is empty. `children` stand inside the field's box (Fix of the panel, X65).
 */
export function DraftField({ vm, class: extra, children }: { readonly vm: PreviewVM; readonly class?: string; readonly children?: ComponentChildren }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const handle = vm.handle;
  const greetingDraft = vm.from === 'newcomers';
  // The model echoes every change of the draft; an echo of an earlier one never undoes what was typed since.
  const draft = useOwnEchoes(vm.draft.text, handle);
  if (!greetingDraft && vm.bar.actions.fix === undefined && draft.shown === '') return null;
  return (
    <div class={`cg-pv__draft${extra === undefined ? '' : ` ${extra}`}`}>
      <TextField
        value={draft.shown}
        label={i18n.t(greetingDraft ? 'newcomers.greetingDraft.aria' : 'preview.draft.aria')}
        placeholder={i18n.text(vm.draft.placeholder)}
        multiline
        minHeight={36}
        maxHeight={120}
        maxLength={vm.draft.maxChars}
        onValue={(typed) => {
          if (handle === null) return;
          const text = typed.slice(0, vm.draft.maxChars);
          draft.sent(text);
          void dispatch({ type: 'SetPreviewDraft', targetHandle: handle, text });
        }}
      />
      {children}
    </div>
  );
}

/** The work zone, which scrolls: `children` (the lease note of «Новые»), the result with «Отправить» on every part, or the hint. */
export function WorkZone({ vm, children }: { readonly vm: PreviewVM; readonly children?: ComponentChildren }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-pv__work">
      {children}
      {vm.result !== null ? (
        <MediaAttachedContext.Provider value={vm.media?.attached ?? null}>
          <PreviewResult result={vm.result} stoppedNote={vm.stoppedNote} />
        </MediaAttachedContext.Provider>
      ) : vm.idleHint === null ? null : (
        <div class="cg-pv__idle">{i18n.text(vm.idleHint)}</div>
      )}
    </div>
  );
}

/** The archive feed of the preview; `feed` — what the Spenders panel shows while the archive has nothing (X65). */
export function PreviewFeed({ vm, feed = vm.feed }: { readonly vm: PreviewVM; readonly feed?: PreviewVM['feed'] }): JSX.Element {
  return (
    <Feed
      handle={vm.handle}
      feed={feed}
      empty={vm.view.s === 'empty' ? vm.view.why : vm.view.s === 'loading' ? null : { key: 'preview.feed.empty' }}
      loading={vm.view.s === 'loading'}
    />
  );
}

export interface PreviewProps {
  /** Which list the preview belongs to: «Новые», the palette's online fans (the Spenders board has its panel, X65). */
  readonly from: PreviewSource;
  /** The × of a preview; the «Новые» card has none (ui-design §4.17). */
  readonly closable?: boolean;
  /** A hint at the Hi button: «AI ничего не отправляет сам…» in «Новые» (NF-028). */
  readonly hiHint?: string | null;
}

export function Preview({ from, closable = true, hiHint }: PreviewProps): JSX.Element {
  const i18n = useI18n();
  const vm = useView({ of: 'preview', from }).value;
  // «Мы писали 10 ч назад» moves with the clock.
  useMinuteClock(vm.header !== null);
  const onKeyDown = usePreviewKeys(vm);

  return (
    <section class="cg-pv" aria-label={i18n.t(from === 'newcomers' ? 'newcomers.cardLabel' : 'preview.label')} data-cg-preview={vm.view.s} onKeyDown={onKeyDown}>
      <Header vm={vm} closable={closable} />
      {hasBody(vm) ? (
        <>
          <UnreadLine unread={vm.unread} />
          <ArchiveLine vm={vm} />
          {vm.view.s === 'offline' ? <ViewState view={vm.view} /> : null}
          <PreviewFeed vm={vm} />
          {/* The draft, the lease and the strip never scroll: the strip's «Тон» menu opens upward over the feed,
              and a scrolling box would clip it to its own height (only «Без тона» stayed reachable). */}
          <div class="cg-pv__tools">
            <DraftField vm={vm} />
            {vm.claim !== null && vm.claim.s === 'mine' ? <OwnLease claim={vm.claim} /> : null}
            <MiniStrip vm={vm} hiHint={hiHint ?? null} />
            {vm.media !== null && vm.handle !== null ? <MediaPicker vm={vm.media} handle={vm.handle} /> : null}
          </div>
          <WorkZone vm={vm}>{vm.claim === null ? null : <LeaseNote claim={vm.claim} hasResult={vm.result !== null} stoppedNote={vm.stoppedNote} />}</WorkZone>
        </>
      ) : (
        <div class="cg-pv__state">
          <ViewState view={vm.view} />
        </div>
      )}
    </section>
  );
}

/** What every preview wears: the pane, its header and archive line, the feed, the strip, the result, the media picker. */
export const PREVIEW_BASE_CSS = `
.cg-pv { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--cg-surface); }
.cg-pv__head { flex: none; display: flex; align-items: flex-start; gap: 8px; padding: 12px 8px 10px 16px; border-bottom: 1px solid var(--cg-rule); min-height: 51px; }
.cg-pv__who { flex: 1; min-width: 0; }
.cg-pv__name { font-size: var(--cg-text-xl); line-height: 22px; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-pv__name span { font-weight: 400; color: var(--cg-ink-muted); margin-left: 6px; font-size: var(--cg-text-base); }
.cg-pv__money { display: flex; gap: 12px; margin-top: 1px; }
.cg-pv__life { font-weight: 600; color: var(--cg-ink); }
.cg-pv__money .cg-money { font-weight: 500; }
.cg-pv__meta { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); margin-top: 4px; }
.cg-pv__arch {
  flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; padding: 0 8px 0 16px;
  font-size: var(--cg-text-sm); color: var(--cg-ink-muted); border-bottom: 1px solid var(--cg-rule);
}
.cg-pv__asof { min-width: 0; }
.cg-pv__cov::before { content: " · "; white-space: pre; }
.cg-pv__lag { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-strong); font-weight: 500; }
.cg-pv__tools { flex: none; display: flex; flex-direction: column; min-width: 0; border-top: 1px solid var(--cg-rule); }
.cg-pv__work { flex: 0 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: thin; overscroll-behavior: contain; display: flex; flex-direction: column; }
.cg-pv__work > * { flex: none; }
.cg-pv__draft { margin: 10px 12px 0 16px; }
.cg-pv__draft .cg-field--area { min-height: 36px; }
.cg-pv__idle { padding: 10px 12px 12px calc(var(--cg-gutter) - 1px); border-top: 1px solid var(--cg-rule); color: var(--cg-ink-muted); }
.cg-pv__state { flex: 1; min-height: 0; overflow-y: auto; }
.cg-pv .cg-card { border-top: 1px solid var(--cg-rule); }
${FEED_CSS}
${MINI_STRIP_CSS}
${RESULT_CSS}
${SEND_ROW_CSS}
${MEDIA_PICKER_CSS}
`;

/** The card of «Новые» and the palette's window: the base, the unread line and the greeting lease. */
export const PREVIEW_CSS = `${PREVIEW_BASE_CSS}
.cg-pv__meta--tight { margin-top: 2px; }
.cg-pv__note {
  flex: none; display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 12px 0 16px;
  font-size: var(--cg-text-sm); line-height: 18px; color: var(--cg-ink-2); border-bottom: 1px solid var(--cg-rule);
}
.cg-pv__note .cg-ico { color: var(--cg-ink-muted); }
.cg-pv__lease { display: flex; align-items: center; gap: 4px; min-height: 30px; padding: 4px 8px 0 16px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-pv__lease > span { margin-right: auto; }
.cg-pv__claimnote { padding: 10px 12px 2px calc(var(--cg-gutter) - 1px); color: var(--cg-ink-2); }
`;

/** The preview pane of «Новые» and of the palette's window (the Spenders panel has its own sheet, X65). */
export const PREVIEW_STYLES: StyleSource = { id: 'cg-preview', css: PREVIEW_CSS };
