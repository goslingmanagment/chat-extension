// A fan of «Рассылка» in the list — «Новые»'s row (ui/newcomers/frame.tsx): the picture (the tick before the versions
// are written), the name with the tier, «@handle · $8,930», how the fan stands in words, the blue «Отправить» at the end
// while the version waits for the click, and under it the version itself — three lines of the draft look while it waits,
// one line once it went (solid, muted: it is in the chat now). A fan left out («Не войдут») says why instead.

import { type JSX } from 'preact';

import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { type I18n, type OutreachMediaVM, type OutreachRowVM } from '@cg/contracts/vm';

import { Button, Dot, FanBadge, Icon, pure, Spinner, TalkingMark, useDispatch, useI18n, useTooltip } from '../kit';
import { NewcomerAvatar } from '../newcomers/frame';
import { asideText, tierWords } from './words';

export type ListItem = { readonly kind: 'fan'; readonly row: OutreachRowVM } | { readonly kind: 'aside'; readonly row: OutreachRowVM } | { readonly kind: 'group'; readonly count: number };

/** Row heights by the text size (the virtual list needs them before it draws): a fan, the version under it, the group. */
export const ROW_HEIGHTS = {
  // 9 + 52 px of text + 9; a waiting version: 7 above, three 17 px lines in a box (4 + 51 + 4, the border 2); a sent one: one line.
  normal: { base: 70, draft: 68, line: 34, group: 36 },
  // 9 + 58 + 9; lines of 19 px.
  large: { base: 76, draft: 74, line: 36, group: 36 },
} as const;

type Heights = (typeof ROW_HEIGHTS)[keyof typeof ROW_HEIGHTS];

/** What stands under a fan: the waiting version in three lines, a version that went (or failed) in one; nothing. */
export function draftKind(row: OutreachRowVM): 'draft' | 'line' | null {
  if (row.aside !== undefined || row.version === null) return null;
  if (row.state === 'ready') return 'draft';
  if (row.state === 'failed' || row.state === 'sending' || row.state === 'accepted' || row.state === 'sent' || row.state === 'uncertain') return 'line';
  return null;
}

export function rowHeight(item: ListItem, heights: Heights): number {
  if (item.kind === 'group') return heights.group;
  const draft = draftKind(item.row);
  return heights.base + (draft === 'draft' ? heights.draft : draft === 'line' ? heights.line : 0);
}

/**
 * Why this window cannot send the fan's version (the open chat, a fan who takes no messages, the page's send off);
 * null — it can, or it rests half a second after a send.
 */
export function blockedReason(i18n: I18n, send: OutreachRowVM['send'], state: OutreachRowVM['state']): string | null {
  if (send === null || send.can || send.paused || (state !== 'ready' && state !== 'failed')) return null;
  return send.reason === null ? i18n.t('outreach.cannot') : i18n.text(send.reason);
}

/** «фан не принимает сообщения.» → «Фан не принимает сообщения»: the first sentence of a reason, as a row's line. */
export function reasonLine(text: string): string {
  const first = (text.split(/(?<=\.)\s/)[0] ?? text).replace(/\.$/, '');
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** The registry's title of a shared code, or the code itself (a site's own). */
function codeWords(i18n: I18n, code: string): string {
  return Object.hasOwn(CG_REGISTRY, code) ? i18n.t(CG_REGISTRY[code as keyof typeof CG_REGISTRY].title) : code;
}

/** How the fan stands, in words (ui-design §4.17's family): terracotta never — the blue button is where to act. */
function Status({ row, media }: { readonly row: OutreachRowVM; readonly media: OutreachMediaVM | null }): JSX.Element {
  const i18n = useI18n();
  const reasons = row.aside;
  if (reasons !== undefined && reasons.length > 0) {
    const all = reasons.map((reason) => asideText(i18n, reason, media));
    return <AsideStatus all={all} />;
  }
  const after = row.bought !== null ? (
    <span class="cg-ow__after">
      {' · '}
      {i18n.t('outreach.row.boughtLead')} <span class="cg-ow__money">{i18n.formatMoneyMills(row.bought.mills, { sign: 'plus' })}</span>
    </span>
  ) : row.replied !== null ? (
    <span class="cg-ow__after">{` · ${i18n.t('outreach.row.replied', { time: { time: row.replied.at } })}`}</span>
  ) : null;
  switch (row.state) {
    case 'queued':
      return <span class="cg-nw__st">{i18n.t('outreach.row.queued')}</span>;
    case 'writing':
      return (
        <span class="cg-nw__st is-busy">
          <Spinner />
          {i18n.t('outreach.row.writing')}
        </span>
      );
    case 'stopped':
      return <span class="cg-nw__st is-2">{i18n.t('outreach.row.stopped')}</span>;
    case 'unwritten':
      return (
        <span class="cg-nw__st is-2" {...(row.code === null ? {} : { 'data-cg-code': row.code })}>
          <Dot kind="ink" size={6} />
          {row.code === null ? i18n.t('outreach.row.unwritten') : i18n.t('outreach.row.unwrittenWhy', { reason: codeWords(i18n, row.code) })}
        </span>
      );
    case 'sending':
      return (
        <span class="cg-nw__st is-2">
          <Spinner />
          {i18n.t('outreach.state.sending')}
        </span>
      );
    case 'accepted':
      return (
        <span class="cg-nw__st is-2">
          <Dot kind="pulse" size={6} />
          {i18n.t('send.accepted')}
        </span>
      );
    case 'sent':
      return (
        <span class="cg-nw__st is-done">
          <Icon name="check" size={12} />
          {row.sentAt === null ? i18n.t('outreach.row.sentNow') : i18n.t('outreach.row.sent', { time: { time: row.sentAt } })}
          {after}
        </span>
      );
    case 'failed':
      return (
        <span class="cg-nw__st is-2" {...(row.code === null ? {} : { 'data-cg-code': row.code })}>
          <Dot kind="danger" size={6} />
          {row.code === null ? i18n.t('outreach.state.failed') : `${i18n.t('outreach.state.failed')} · ${row.code}`}
        </span>
      );
    case 'uncertain':
      return (
        <span class="cg-nw__st is-2" data-cg-uncertain="1">
          <Dot kind="ink" size={6} />
          {row.replied !== null ? i18n.t('outreach.row.uncertainShort') : i18n.t('outreach.row.uncertain')}
          {row.replied !== null ? after : null}
        </span>
      );
    case 'idle':
    case 'ready':
      break;
  }
  // A version this window cannot send says why where the facts stand; the row has no button then.
  const blocked = blockedReason(i18n, row.send, row.state);
  if (blocked !== null) return <BlockedStatus text={blocked} />;
  // The archive's facts: who wrote last and when; a version by the archive says so after them.
  const byArchive = row.state === 'ready' && row.warning?.kind === 'archive' ? <span class="cg-ow__q2">{` · ${i18n.t('outreach.row.byArchive')}`}</span> : null;
  if (row.waitingSince !== null) {
    return (
      <span class="cg-nw__st is-strong">
        {i18n.t('outreach.row.waiting', { age: i18n.formatAge(row.waitingSince) })}
        {byArchive}
      </span>
    );
  }
  if (row.weWroteAt !== null) return <span class="cg-nw__st">{i18n.t('outreach.row.weWrote', { age: i18n.formatAge(row.weWroteAt) })}</span>;
  return <span class="cg-nw__st">{i18n.t(row.history ? 'outreach.row.talked' : 'outreach.row.noChat')}</span>;
}

/** «Этот чат открыт — вставьте ответ в поле ввода»: the reason's first sentence, all of it in the tooltip. */
function BlockedStatus({ text }: { readonly text: string }): JSX.Element {
  const line = reasonLine(text);
  const tip = useTooltip(line === text ? null : text);
  return (
    <span class="cg-nw__st is-2" data-cg-blocked="1" {...tip.props}>
      <Dot kind="ink" size={6} />
      {line}
      {tip.description}
    </span>
  );
}

/** Why a fan is left out: the first reason, «· ещё N», all of them in the tooltip. */
function AsideStatus({ all }: { readonly all: readonly string[] }): JSX.Element {
  const i18n = useI18n();
  const tip = useTooltip(all.length > 1 ? all.join(' · ') : null);
  return (
    <span class="cg-nw__st is-2" {...tip.props}>
      {all[0]}
      {all.length > 1 ? <span class="cg-ow__q2">{` · ${i18n.t('outreach.row.more', { n: all.length - 1 })}`}</span> : null}
      {tip.description}
    </span>
  );
}

/** The row's own «Отправить» of the fan's version: one click, never a key; off for the half second after a send. */
function SendButton({ row }: { readonly row: OutreachRowVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const send = row.send;
  if (send === null || (row.state !== 'ready' && row.state !== 'failed')) return null;
  // Held where this window cannot send it: the status says why, the card offers «Открыть и вставить».
  if (blockedReason(i18n, send, row.state) !== null) return null;
  const label = i18n.t(send.kind === 'retry' ? 'outreach.retry' : send.kind === 'anyway' ? 'outreach.sendAnyway' : 'outreach.send');
  const tooltip = i18n.t(send.kind === 'retry' ? 'outreach.retryTooltip' : send.kind === 'anyway' ? warningTooltip(row) : 'outreach.sendTooltip');
  const reason = send.can ? null : i18n.t('outreach.paused');
  return (
    <Button
      label={label}
      variant="send"
      size="sm"
      class="cg-nw__end cg-ow__rsend"
      tabIndex={-1}
      tooltip={tooltip}
      reason={reason}
      onClick={(event) => {
        event.stopPropagation();
        if (send.can) void dispatch(send.kind === 'anyway' ? { type: 'SendOutreach', targetHandle: row.handle, anyway: true } : { type: 'SendOutreach', targetHandle: row.handle });
      }}
    />
  );
}

/** «Отправить всё равно»: the warning it passes, in its tooltip. */
function warningTooltip(row: Pick<OutreachRowVM, 'warning'>): 'outreach.anywayArchive' | 'outreach.anywayStale' | 'outreach.anywayTalking' {
  return row.warning?.kind === 'stale' ? 'outreach.anywayStale' : row.warning?.kind === 'talking' ? 'outreach.anywayTalking' : 'outreach.anywayArchive';
}

/** The picture is the row's box before the versions are written: a click ticks or unticks the fan, never opens the card. */
function Pick({ row, locked }: { readonly row: OutreachRowVM; readonly locked: boolean }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const avatar = <NewcomerAvatar name={row.name} url={row.avatarUrl} size="row" />;
  if (locked || row.aside !== undefined) return <span class="cg-nw__pick">{avatar}</span>;
  const on = row.ticked;
  return (
    <button
      type="button"
      class={`cg-nw__pick is-box${on ? ' is-on' : ''}`}
      role="checkbox"
      aria-checked={on ? 'true' : 'false'}
      aria-label={`${i18n.t(on ? 'outreach.untick' : 'outreach.tick')}: ${row.name}`}
      title={i18n.t(on ? 'outreach.untick' : 'outreach.tick')}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        void dispatch({ type: 'SetOutreach', tick: { targetHandle: row.handle, on: !on } });
      }}
    >
      {avatar}
      <span class="cg-nw__tick">{on ? <Icon name="check" size={12} /> : null}</span>
    </button>
  );
}

interface RowProps {
  readonly item: Extract<ListItem, { kind: 'fan' | 'aside' }>;
  readonly index: number;
  readonly active: boolean;
  readonly locked: boolean;
  readonly media: OutreachMediaVM | null;
  readonly onPick: (handle: string) => void;
}

function RowView({ item, index, active, locked, media, onPick }: RowProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { row } = item;
  const aside = item.kind === 'aside';
  const draft = draftKind(row);
  const went = row.state === 'sending' || row.state === 'accepted' || row.state === 'sent' || row.state === 'uncertain';
  return (
    <div
      class={`cg-nw__row${row.selected ? ' is-sel' : ''}${draft === null ? '' : ' has-draft'}${aside ? ' is-aside' : ''}${!locked && !aside && !row.ticked ? ' is-off' : ''}`}
      role="option"
      aria-selected={row.selected ? 'true' : 'false'}
      tabIndex={active ? 0 : -1}
      data-cg-item={index}
      data-cg-key={row.handle}
      data-cg-fan={row.handle}
      data-cg-outreach-row={row.state}
      onFocus={() => onPick(row.handle)}
      onClick={() => {
        onPick(row.handle);
        void dispatch({ type: 'OpenPreview', targetHandle: row.handle });
      }}
    >
      <Pick row={row} locked={locked} />
      <span class="cg-nw__copy">
        <span class="cg-nw__name">
          {row.name}
          <FanBadge badges={row.badges} inline />
          {row.tier === null ? null : <span class="cg-nw__tag">{tierWords(i18n, row.tier)}</span>}
        </span>
        <span class="cg-nw__mline">
          <span class="cg-nw__meta cg-num">{[row.username === null ? null : `@${row.username}`, i18n.formatMoneyMills(row.lifetime)].filter((part) => part !== null && part !== '').join(' · ')}</span>
          <TalkingMark handle={row.handle} />
        </span>
        <Status row={row} media={media} />
      </span>
      <SendButton row={row} />
      {draft === null ? null : (
        <span class={`cg-nw__draft${draft === 'line' ? ' is-one' : ''}${went ? ' is-went' : ''}`}>
          <span class="cg-nw__dtext">{row.version}</span>
        </span>
      )}
    </div>
  );
}

/** A row is drawn again only when what it shows changed: typing the common text re-renders the window, not the rows. */
function sameRow(a: RowProps, b: RowProps): boolean {
  if (a.index !== b.index || a.active !== b.active || a.locked !== b.locked || a.onPick !== b.onPick || a.item.kind !== b.item.kind) return false;
  if (a.item.row === b.item.row && a.media === b.media) return true;
  return JSON.stringify(a.item.row) === JSON.stringify(b.item.row) && JSON.stringify(a.media) === JSON.stringify(b.media);
}

export const OutreachRow = pure(RowView, sameRow);
