// The Spenders preview as a panel under the list, across the whole window
// (X65; ui-design §3.5, §4.16): one header line — the fan, an eye for «чат не
// открыт», the money and the ages, the neighbouring fans, «Открыть чат», × —,
// then the feed and the result in the middle, and the composer in one row at
// the bottom: the draft with Fix inside it, then the strip. The archive line
// speaks only when the archive lags, is partial or is still empty; while it is
// empty the row's last message stands in the feed, and the line says whose it
// is. The same PreviewVM and the same pieces as the card of «Новые» and the
// palette's window (Preview.tsx).

import { type JSX } from 'preact';

import { type IsoTimestamp } from '@cg/contracts/primitives';
import { type PreviewVM, type TargetHandle } from '@cg/contracts/vm';

import { ActionButton, Button, Icon, Money, StripButton, ViewState, useDispatch, useI18n, useMinuteClock, useTooltip, useView, type StyleSource } from '../../kit';
import { MediaPicker } from './MediaPicker';
import { MiniStrip, generateAction, reasonText } from './MiniStrip';
import { SeenMark } from './Feed';
import { ArchiveLine, DraftField, PREVIEW_BASE_CSS, PreviewFeed, WorkZone, bothAges, hasBody, usePreviewKeys } from './Preview';

/** The picked row's last message, with whose it is: the panel shows it while that fan's archive is empty. */
export interface PreviewFallback {
  readonly handle: TargetHandle;
  readonly fromUs: boolean;
  readonly text: string;
  readonly at: IsoTimestamp | null;
}

/**
 * «Чат не открыт» as an eye at the name, the words in its tooltip: the norm of a preview is not spelled out on
 * every fan (ui-design §1 п. 7). After a send, when the chat reads as read, the words are shown.
 */
function UnreadMark({ unread }: { readonly unread: PreviewVM['unread'] }): JSX.Element {
  const i18n = useI18n();
  const kept = unread === 'kept';
  const words = i18n.t(kept ? 'preview.notOpened' : 'preview.notOpenedAfterSend');
  const tip = useTooltip(`${words}\n${i18n.t(kept ? 'preview.notOpenedTooltip' : 'preview.notOpenedAfterSendTooltip')}`);
  return (
    <span class="cg-pv__unread" data-cg-unread={unread} {...tip.props}>
      <Icon name="eyeOff" size={14} />
      <span class={kept ? 'cg-sr' : undefined}>{words}</span>
      {tip.description}
    </span>
  );
}

/** The neighbouring fans' buttons: up is the previous row (K), down the next one (J), as in the list. */
const STEPS = [
  ['previous', 'chevronUp', 'K'],
  ['next', 'chevronDown', 'J'],
] as const;

function PanelHeader({ vm }: { readonly vm: PreviewVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const header = vm.header;
  const meta = header === null ? null : bothAges(i18n, header);
  return (
    <header class="cg-pv__head">
      <div class="cg-pv__who">
        {header === null ? null : (
          <>
            <h3 class="cg-pv__name">
              {header.name}
              {header.username === null ? null : <span>@{header.username}</span>}
            </h3>
            <UnreadMark unread={vm.unread} />
            <div class="cg-pv__money cg-num">
              <Money mills={header.lifetime} zero="show" class="cg-pv__life" />
              {header.period30 !== null && header.period30 > 0 ? <span class="cg-money">{i18n.t('preview.moneyIn', { moneyIn: { money: header.period30, sign: 'plus' } })}</span> : null}
            </div>
            {meta === null ? null : (
              <div class="cg-pv__meta">
                <span class="cg-pv__ages">{meta}</span>
                {/* Our newest message is not in the archive yet: whether the fan read it stands by the ages. */}
                {vm.seen !== null && !vm.seen.inFeed ? <SeenMark seen={vm.seen} /> : null}
              </div>
            )}
          </>
        )}
      </div>
      {/* ← → and J / K walk the list from inside the preview too (SP-056); these are the same steps by pointer. */}
      {STEPS.map(([key, icon, letter]) => {
        const label = i18n.t(key === 'previous' ? 'preview.previousFan' : 'preview.nextFan');
        const step = vm.neighbors[key];
        return (
          <Button
            key={key}
            label={label}
            icon={icon}
            iconOnly
            variant="quiet"
            tooltip={`${label}  ${letter}`}
            reason={step === null ? label : null}
            onClick={() => {
              if (step !== null) void dispatch(step);
            }}
          />
        );
      })}
      {header === null ? null : <ActionButton vm={vm.openChat} variant="line" />}
      <Button label={i18n.t('preview.closeAria')} icon="x" iconOnly variant="quiet" onClick={() => void dispatch(vm.close)} />
    </header>
  );
}

/** Fix inside the draft field: it works on that text, so it stands on it. */
function FixInField({ vm }: { readonly vm: PreviewVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const action = vm.bar.actions.fix;
  if (action === undefined) return null;
  const label = i18n.t('dock.action.fix');
  const start = generateAction(vm, 'fix');
  return (
    <span class="cg-pv__fix" data-cg-strip="fix">
      <StripButton
        label={label}
        active={action.active}
        busy={action.busy}
        reason={reasonText(i18n, label, action)}
        onClick={() => {
          if (start !== null) void dispatch(start);
        }}
      />
    </span>
  );
}

/** The archive line has something to say: the archive lags, is partial, is read again or has nothing yet. */
function archiveSpeaks(vm: PreviewVM): boolean {
  const { archive } = vm;
  return vm.fanWroteNew || archive.lagMinutes !== null || archive.refreshing || archive.stamp.coverage === 'partial' || (vm.feed.items.length === 0 && vm.view.s !== 'loading');
}

export function PanelPreview({ fallback }: { readonly fallback: PreviewFallback | null }): JSX.Element {
  const i18n = useI18n();
  const vm = useView({ of: 'preview', from: 'spenders' }).value;
  // «Мы писали 10 ч назад» moves with the clock.
  useMinuteClock(vm.header !== null);
  const onKeyDown = usePreviewKeys(vm);
  // The row's last message stands in the feed while this fan's archive has nothing (Fansly's often has not).
  const stand = fallback !== null && fallback.handle === vm.handle && vm.feed.items.length === 0 && vm.view.s !== 'loading' && !vm.fanWroteNew ? fallback : null;
  return (
    <section class="cg-pv is-panel" aria-label={i18n.t('preview.label')} data-cg-preview={vm.view.s} onKeyDown={onKeyDown}>
      <PanelHeader vm={vm} />
      {hasBody(vm) ? (
        <>
          {vm.view.s === 'offline' ? <ViewState view={vm.view} /> : null}
          <div class="cg-pv__mid">
            {archiveSpeaks(vm) ? <ArchiveLine vm={vm} quiet lead={stand === null ? null : i18n.t('preview.feed.lastOnly')} /> : null}
            <PreviewFeed
              vm={vm}
              feed={stand === null ? vm.feed : { ...vm.feed, items: [{ id: 'last', at: stand.at, sender: stand.fromUs ? 'model' : 'fan', text: stand.text, deleted: false, automatic: null, tip: null, price: null, attachments: [], dayBreak: false }] }}
            />
            <WorkZone vm={vm} />
          </div>
          {/* The composer stays below the feed; a short panel scrolls as a whole instead of crushing the result. */}
          <div class="cg-pv__tools">
            <div class="cg-pv__compose">
              <DraftField vm={vm} class="has-fix">
                <FixInField vm={vm} />
              </DraftField>
              <MiniStrip vm={vm} omit={['fix']} />
            </div>
            {vm.media !== null && vm.handle !== null ? <MediaPicker vm={vm.media} handle={vm.handle} /> : null}
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

// The feed and the work zone keep a readable measure in a wide panel: their padding grows past 920–960 px.
export const PANEL_CSS = `
.cg-pv.is-panel { height: 100%; overflow-y: auto; scrollbar-width: thin; overscroll-behavior: contain; }
.cg-pv.is-panel .cg-pv__head { align-items: center; min-height: 46px; padding: 6px 8px 6px 20px; gap: 4px; }
.cg-pv.is-panel .cg-pv__who { display: flex; align-items: baseline; flex-wrap: wrap; column-gap: 12px; row-gap: 2px; margin-right: 8px; }
.cg-pv.is-panel .cg-pv__name { flex: 0 1 auto; min-width: 0; }
.cg-pv.is-panel :is(.cg-pv__money, .cg-pv__meta) { margin-top: 0; gap: 8px; font-size: var(--cg-text-sm); white-space: nowrap; }
.cg-pv__unread { display: inline-flex; align-items: center; gap: 6px; align-self: center; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); }
.cg-pv__unread > span { color: var(--cg-ink-2); }
.cg-pv__mid { flex: 1 0 180px; min-height: 180px; display: flex; flex-direction: column; }
.cg-pv.is-panel .cg-feed { padding-inline: max(20px, calc(50% - 460px)); }
.cg-pv.is-panel .cg-pv__work { max-height: 60%; }
.cg-pv.is-panel .cg-pv__work > * { margin-inline: max(0px, calc(50% - 480px)); }
.cg-pv__arch.is-quiet { justify-content: center; gap: 4px; min-height: 26px; padding: 4px 12px 0; border-bottom: 0; }
.cg-pv__compose { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 6px 14px; padding: 8px 12px 10px 20px; min-width: 0; }
.cg-pv__compose > .cg-pv__draft { flex: 1 1 320px; margin: 0; min-width: 0; position: relative; }
.cg-pv__compose > .cg-pvb { flex: none; padding: 0; }
.cg-pv__draft.has-fix .cg-field--area { padding-right: 64px; }
.cg-pv__fix { position: absolute; right: 4px; bottom: 4px; display: inline-flex; }
`;

/** The Spenders panel's sheet: every preview's base, then the panel's own rules. */
export const PANEL_STYLES: StyleSource = { id: 'cg-preview-panel', css: `${PREVIEW_BASE_CSS}${PANEL_CSS}` };
