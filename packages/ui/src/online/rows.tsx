// A fan of «Онлайн» in the list — «Новые»'s row: the picture with the presence dot (green: active within ten
// minutes or the site's own «в сети», amber: within half an hour, grey: longer), the name with the fan's badges on
// Fansly (FBuddy's gem, Fansly's blue card; the kit's FanBadge), «@handle · $560», why to
// write now in words, how fresh the presence is at the end, and under it the text that would go: two lines of the
// draft look while it waits, one muted line once it went.

import { type JSX } from 'preact';

import { type OnlineRowVM } from '@cg/contracts/vm';

import { FanBadge, Icon, Spinner, pure, useI18n, useTooltip } from '../kit';
import { NewcomerAvatar } from '../newcomers/frame';
import { actWord, asideText, reasonShort, seenShort } from './words';

/** The picture with the presence dot. */
export function OnlineAvatar({ name, presence, size }: { readonly name: string; readonly presence: OnlineRowVM['presence']; readonly size: 'row' | 'card' }): JSX.Element {
  return (
    <span class={`ol-av${size === 'card' ? ' is-card' : ''}`}>
      <NewcomerAvatar name={name} url={null} size={size} />
      <i class={`ol-pres${presence === 'now' ? '' : presence === 'fading' ? ' is-fading' : ' is-gone'}`} aria-hidden="true" />
    </span>
  );
}

/** How the fan stands, in words: what went and what came back, else why to write now (or why they are set aside). */
function Status({ row }: { readonly row: OnlineRowVM }): JSX.Element {
  const i18n = useI18n();
  if (row.replied !== null && row.state !== 'sent' && row.state !== 'sending' && row.state !== 'accepted') {
    return (
      <span class="cg-nw__st is-good" data-cg-online-replied="1">
        {i18n.t('online.row.replied', { act: actWord(i18n, row.sentAct), time: { time: row.replied.at } })}
      </span>
    );
  }
  switch (row.state) {
    case 'writing':
      return (
        <span class="cg-nw__st is-busy">
          <Spinner />
          {i18n.t('online.row.writing', { act: actWord(i18n, row.act) })}
        </span>
      );
    case 'sending':
      return (
        <span class="cg-nw__st is-busy">
          <Spinner />
          {i18n.t('online.row.sending')}
        </span>
      );
    case 'accepted':
      return <span class="cg-nw__st is-done">{i18n.t('send.accepted')}</span>;
    case 'sent':
      return (
        <span class="cg-nw__st is-done">
          <Icon name="check" size={12} />
          {row.sentAt === null ? i18n.t('online.row.sentNow', { act: actWord(i18n, row.sentAct) }) : i18n.t('online.row.sent', { act: actWord(i18n, row.sentAct), time: { time: row.sentAt } })}
        </span>
      );
    case 'uncertain':
      return <span class="cg-nw__st is-quiet" data-cg-uncertain="1">{i18n.t('online.row.uncertain')}</span>;
    case 'failed':
      return <span class="cg-nw__st is-quiet" {...(row.code === null ? {} : { 'data-cg-code': row.code })}>{row.code === null ? i18n.t('online.row.failed') : `${i18n.t('online.row.failed')} · ${row.code}`}</span>;
    case 'unwritten':
      return <span class="cg-nw__st is-quiet" {...(row.code === null ? {} : { 'data-cg-code': row.code })}>{i18n.t('online.row.unwritten')}</span>;
    case 'idle':
    case 'ready':
      break;
  }
  if (row.skipped) return <span class="cg-nw__st is-quiet">{i18n.t('online.row.skipped')}</span>;
  if (row.aside !== null) return <span class="cg-nw__st is-quiet">{asideText(i18n, row.aside)}</span>;
  const strong = row.reason.kind === 'waiting' || row.reason.kind === 'answered';
  return <span class={`cg-nw__st ${strong ? 'is-act' : row.reason.kind === 'none' ? 'is-quiet' : 'is-why'}`}>{reasonShort(i18n, row.reason, row.sentAct)}</span>;
}

/** «● 3 мин» at the row's end: the dot's colour is the presence's, the words the time since. */
function Seen({ row }: { readonly row: OnlineRowVM }): JSX.Element {
  const i18n = useI18n();
  const tip = useTooltip(row.live ? i18n.t('online.seen.liveTooltip') : null);
  return (
    <span class={`ol-seen${row.presence === 'now' ? ' is-fresh' : ''}`} {...tip.props}>
      <i class={`ol-sdot${row.presence === 'now' ? '' : row.presence === 'fading' ? ' is-fading' : ' is-gone'}`} aria-hidden="true" />
      {seenShort(i18n, row)}
      {tip.description}
    </span>
  );
}

/** What stands under a fan: the text waiting for the click in two lines, a text that went in one; nothing. */
export function draftKind(row: OnlineRowVM): 'draft' | 'line' | 'writing' | null {
  if (row.state === 'writing') return 'writing';
  if (row.version === null) return null;
  if (row.state === 'ready' || row.state === 'failed') return row.skipped ? null : 'draft';
  if (row.state === 'sending' || row.state === 'accepted' || row.state === 'sent' || row.state === 'uncertain') return 'line';
  return null;
}

interface RowProps {
  readonly row: OnlineRowVM;
  readonly onSelect: (handle: string) => void;
}

function RowView({ row, onSelect }: RowProps): JSX.Element {
  const i18n = useI18n();
  const draft = draftKind(row);
  const done = row.skipped || row.state === 'sent' || row.state === 'uncertain';
  const meta = [row.username === null ? null : `@${row.username}`, row.lifetime !== null ? i18n.formatMoneyMills(row.lifetime) : row.moneyUnknown === true ? null : i18n.t('online.row.notPaid')].filter((part): part is string => part !== null && part !== '');
  return (
    <div
      class={`cg-nw__row${row.selected ? ' is-sel' : ''}${done ? ' is-handled' : ''}${row.arrived ? ' is-new' : ''}${draft === null || draft === 'writing' ? '' : ' has-draft'}`}
      role="option"
      aria-selected={row.selected ? 'true' : 'false'}
      tabIndex={row.selected ? 0 : -1}
      data-cg-item=""
      data-cg-key={row.handle}
      data-cg-fan={row.handle}
      data-cg-online-row={row.state}
      onClick={() => onSelect(row.handle)}
    >
      <OnlineAvatar name={row.name} presence={row.presence} size="row" />
      <span class="cg-nw__copy">
        <span class="cg-fbname">
          <span class="cg-nw__name">{row.name}</span>
          <FanBadge badges={row.badges} />
        </span>
        <span class="cg-nw__meta cg-num">{meta.join(' · ')}</span>
        <Status row={row} />
      </span>
      <span class="cg-nw__end">
        <Seen row={row} />
      </span>
      {draft === 'draft' || draft === 'line' ? (
        <span class={`cg-nw__draft${draft === 'line' ? ' is-one is-went' : ''}`}>
          <span class="cg-nw__dtext">{row.version}</span>
        </span>
      ) : null}
    </div>
  );
}

/** A row is drawn again only when what it shows changed. */
function sameRow(a: RowProps, b: RowProps): boolean {
  if (a.onSelect !== b.onSelect) return false;
  return a.row === b.row || JSON.stringify(a.row) === JSON.stringify(b.row);
}

export const OnlineRow = pure(RowView, sameRow);
