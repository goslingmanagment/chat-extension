// A fan's preview without opening the chat (architecture.md §6.5, §6.7, D-27;
// ui-design §4.16, §4.17; SP-050…SP-056, NF-009, NF-010, NEW-10): the header,
// «Чат не открыт, останется непрочитанным», the archive line with its
// coverage and lag, the hub's archive feed, then the work zone — the local
// draft for Fix, the mini strip, the result with «Отправить» on every part.
// The same pane is the card of «Новые». It renders PreviewVM and nothing
// else: it never reads ChatSpace and never loads a chat's history.

import { type JSX, type TargetedKeyboardEvent } from 'preact';

import { type ClaimVM, type I18n, type Msg, type PreviewActionId, type PreviewSource, type PreviewVM } from '@cg/contracts/vm';

import { ActionButton, Button, Dot, ErrorCard, Icon, Money, TextField, ViewState, isComposing, useCountdown, useDispatch, useI18n, useMinuteClock, useNowFn, useTooltip, useView, type StyleSource } from '../../kit';
import { coverageWord, isPlainKey, isTextEntry, timeOrUnknown } from '../window';
import { Feed, FEED_CSS } from './Feed';
import { MINI_STRIP_CSS, MiniStrip, generateAction } from './MiniStrip';
import { PreviewResult, RESULT_CSS } from './Result';
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

function metaLine(i18n: I18n, header: NonNullable<PreviewVM['header']>): string | null {
  if (header.newcomer !== null) return i18n.t('newcomers.cardMeta', { kind: i18n.t(KIND_KEYS[header.newcomer.kind]), age: { age: header.newcomer.subscribedAt } });
  const { weWroteAt, fanWroteAt } = header;
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

function ArchiveLine({ vm }: { readonly vm: PreviewVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { archive } = vm;
  const time = timeOrUnknown(i18n, archive.stamp.asOf);
  const refresh = archive.refresh;
  return (
    <div class="cg-pv__arch">
      {vm.fanWroteNew ? (
        // The fan's new text is not shown until the archive has it (§6.7.5): only this line.
        <span class="cg-pv__lag" role="status">
          <Dot kind="accent" use="preview-fan-wrote" />
          {i18n.t('preview.fanWroteNew')}
        </span>
      ) : (
        <span class="cg-pv__asof">
          {archive.lagMinutes === null ? i18n.t('common.archiveAsOf', { time }) : i18n.t('preview.archiveLag', { time, n: archive.lagMinutes })}
          {archive.stamp.coverage === 'complete' ? null : <span class="cg-pv__cov">{coverageWord(i18n, archive.stamp.coverage)}</span>}
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

function hasBody(vm: PreviewVM): boolean {
  return vm.view.s !== 'error' && vm.view.s !== 'forbidden';
}

export interface PreviewProps {
  /** Which list the preview belongs to: the Spenders board, «Новые», the palette's online fans. */
  readonly from: PreviewSource;
  /** The × of the Spenders preview; the «Новые» card has none (ui-design §4.17). */
  readonly closable?: boolean;
  /** A hint at the Hi button: «AI ничего не отправляет сам…» in «Новые» (NF-028). */
  readonly hiHint?: string | null;
}

export function Preview({ from, closable = true, hiHint }: PreviewProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const vm = useView({ of: 'preview', from }).value;
  // «Мы писали 10 ч назад» moves with the clock.
  useMinuteClock(vm.header !== null);
  const showDraft = vm.bar.actions.fix !== undefined || vm.draft.text !== '';
  const handle = vm.handle;

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLElement>): void => {
    if (event.defaultPrevented || isComposing(event)) return;
    // ⌘E / ⌘I / ⌘G / ⌘P with focus inside the preview: the generation of THIS fan (HK-042). The early
    // dispatcher gets a global key first; what it took comes here already prevented.
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
    // ← → and J / K outside our fields: the neighbouring fan (SP-056). Letters by the physical key.
    const step = event.code === 'ArrowLeft' || event.code === 'KeyK' ? vm.neighbors.previous : event.code === 'ArrowRight' || event.code === 'KeyJ' ? vm.neighbors.next : undefined;
    if (step === undefined) return;
    event.preventDefault();
    if (step !== null) void dispatch(step);
  };

  return (
    <section class="cg-pv" aria-label={i18n.t(from === 'newcomers' ? 'newcomers.cardLabel' : 'preview.label')} data-cg-preview={vm.view.s} onKeyDown={onKeyDown}>
      <Header vm={vm} closable={closable} />
      {hasBody(vm) ? (
        <>
          <UnreadLine unread={vm.unread} />
          <ArchiveLine vm={vm} />
          {vm.view.s === 'offline' ? <ViewState view={vm.view} /> : null}
          <Feed handle={handle} feed={vm.feed} empty={vm.view.s === 'empty' ? vm.view.why : vm.view.s === 'loading' ? null : { key: 'preview.feed.empty' }} loading={vm.view.s === 'loading'} />
          <div class="cg-pv__work">
            {showDraft ? (
              <div class="cg-pv__draft">
                <TextField
                  value={vm.draft.text}
                  label={i18n.t('preview.draft.aria')}
                  placeholder={i18n.text(vm.draft.placeholder)}
                  multiline
                  minHeight={36}
                  maxHeight={120}
                  maxLength={vm.draft.maxChars}
                  onValue={(text) => {
                    if (handle !== null) void dispatch({ type: 'SetPreviewDraft', targetHandle: handle, text: text.slice(0, vm.draft.maxChars) });
                  }}
                />
              </div>
            ) : null}
            {vm.claim !== null && vm.claim.s === 'mine' ? <OwnLease claim={vm.claim} /> : null}
            <MiniStrip vm={vm} hiHint={hiHint ?? null} />
            {vm.claim === null ? null : <LeaseNote claim={vm.claim} hasResult={vm.result !== null} stoppedNote={vm.stoppedNote} />}
            {vm.result !== null ? (
              <PreviewResult result={vm.result} stoppedNote={vm.stoppedNote} />
            ) : vm.idleHint === null ? null : (
              <div class="cg-pv__idle">{i18n.text(vm.idleHint)}</div>
            )}
          </div>
        </>
      ) : (
        <div class="cg-pv__state">
          <ViewState view={vm.view} />
        </div>
      )}
    </section>
  );
}

export const PREVIEW_CSS = `
.cg-pv { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--cg-surface); }
.cg-pv__head { flex: none; display: flex; align-items: flex-start; gap: 8px; padding: 12px 8px 10px 16px; border-bottom: 1px solid var(--cg-rule); min-height: 51px; }
.cg-pv__who { flex: 1; min-width: 0; }
.cg-pv__name { font-size: var(--cg-text-xl); line-height: 22px; font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-pv__name span { font-weight: 400; color: var(--cg-ink-muted); margin-left: 6px; font-size: var(--cg-text-base); }
.cg-pv__money { display: flex; gap: 12px; margin-top: 1px; }
.cg-pv__life { font-weight: 600; color: var(--cg-ink); }
.cg-pv__money .cg-money { font-weight: 500; }
.cg-pv__meta { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); margin-top: 4px; }
.cg-pv__meta--tight { margin-top: 2px; }
.cg-pv__note {
  flex: none; display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 12px 0 16px;
  font-size: var(--cg-text-sm); line-height: 18px; color: var(--cg-ink-2); border-bottom: 1px solid var(--cg-rule);
}
.cg-pv__note .cg-ico { color: var(--cg-ink-muted); }
.cg-pv__arch {
  flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; padding: 0 8px 0 16px;
  font-size: var(--cg-text-sm); color: var(--cg-ink-muted); border-bottom: 1px solid var(--cg-rule);
}
.cg-pv__asof { min-width: 0; }
.cg-pv__cov::before { content: " · "; white-space: pre; }
.cg-pv__lag { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-strong); font-weight: 500; }
.cg-pv__work { flex: 0 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: thin; overscroll-behavior: contain; display: flex; flex-direction: column; border-top: 1px solid var(--cg-rule); }
.cg-pv__work > * { flex: none; }
.cg-pv__draft { margin: 10px 12px 0 16px; }
.cg-pv__draft .cg-field--area { min-height: 36px; }
.cg-pv__lease { display: flex; align-items: center; gap: 4px; min-height: 30px; padding: 4px 8px 0 16px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-pv__lease > span { margin-right: auto; }
.cg-pv__claimnote { padding: 10px 12px 2px calc(var(--cg-gutter) - 1px); color: var(--cg-ink-2); }
.cg-pv__idle { padding: 10px 12px 12px calc(var(--cg-gutter) - 1px); border-top: 1px solid var(--cg-rule); color: var(--cg-ink-muted); }
.cg-pv__state { flex: 1; min-height: 0; overflow-y: auto; }
.cg-pv .cg-card { border-top: 1px solid var(--cg-rule); }
${FEED_CSS}
${MINI_STRIP_CSS}
${RESULT_CSS}
${SEND_ROW_CSS}
`;

/** The preview pane: the Spenders preview and the «Новые» card. */
export const PREVIEW_STYLES: StyleSource = { id: 'cg-preview', css: PREVIEW_CSS };
