// «Новые» where the hub keeps the list (ChatSpace; architecture.md §8.5, H-7, §6.7.9; ui-design §3.6, §4.17, §10;
// NF-001…NF-012, NF-024, NF-025, NF-028): who subscribed, renewed or came back in the window — the family's window
// (./window.tsx; X59, X60: the same window as on Fansly) with ChatSpace's adapter: its words, the greeting's status in
// each row, what is in the list and whose name Hi greets in, and the card from the preview of the hub's archive
// (./hub-card.tsx). A colleague's send shows no name (ui-design §12 п. 5).
//
// The window opens on the first fan who can be greeted now, with that fan's card (X55, as the old Fansly window).

import { type JSX } from 'preact';

import { type I18nKey } from '@cg/contracts/errors';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { type GreetingStatusVM, type I18n, type NewcomerRowVM, type NewcomersVM } from '@cg/contracts/vm';

import { Dot, Icon, Spinner, ViewState, useDispatch, useI18n } from '../kit';
import { RowSendButton, StatusMenu, type BatchWords, type RowParts } from './frame';
import { HubCard } from './hub-card';
import { NewcomersWindowOf, RefreshButton, type NewcomersSite } from './window';

/** A fan who can be greeted now: nobody has greeted them and nothing of theirs is on its way. */
const ACTIONABLE: readonly GreetingStatusVM['s'][] = ['none'];

/** The row the window opens on (X55): the first fan who can be greeted now, else the first row. */
export function firstActionable(rows: readonly NewcomerRowVM[]): NewcomerRowVM | null {
  return rows.find((row) => ACTIONABLE.includes(row.greeting.s)) ?? rows[0] ?? null;
}

const KIND_KEYS: Readonly<Record<NewcomerRowVM['kind'], I18nKey>> = {
  new: 'newcomers.kind.new',
  renewed: 'newcomers.kind.renewed',
  returning: 'newcomers.kind.returning',
};

const BATCH_KEYS = { queued: 'batch.state.queued', generating: 'batch.state.generating', failed: 'batch.state.failed' } as const;

/**
 * The row's status line (ui-design §4.17): how the greeting goes when it goes, the batch's step while it runs, else
 * the greeting's state — terracotta where the person can greet now, as on Fansly.
 */
function GreetingStatus({ row }: { readonly row: NewcomerRowVM }): JSX.Element {
  const i18n = useI18n();
  const status = row.greeting;
  const batch = row.batch?.state ?? null;
  switch (status.s) {
    case 'sending':
      return (
        <span class="cg-nw__st is-busy cg-num">
          <Spinner />
          {i18n.t('newcomers.status.sending', { sent: status.sent, total: status.total })}
        </span>
      );
    case 'stopped':
      // An unknown outcome holds nothing (2026-10-20 audit, row 2): the person checks the chat and may send again.
      return (
        <span class="cg-nw__st is-2">
          <Dot kind="ink" />
          {i18n.t('newcomers.status.stopped')}
        </span>
      );
    case 'greeted':
      return (
        <span class="cg-nw__st is-done">
          <Icon name="check" size={13} />
          {i18n.t('newcomers.status.greeted')}
        </span>
      );
    case 'replied':
      // A row to work with, as «Ждёт ответа» on Fansly (X59): terracotta, and the batch's step while it runs.
      if (batch !== 'generating' && batch !== 'queued' && batch !== 'failed') return <span class="cg-nw__st is-act">{i18n.t('newcomers.status.replied')}</span>;
      break;
    case 'sending-other':
      // A colleague's part is on its way (a few seconds): a quiet note — Hi stays on, the hub decides at the send.
      if (batch !== 'generating' && batch !== 'queued' && batch !== 'failed') return <span class="cg-nw__st">{i18n.t('newcomers.status.sendingOther')}</span>;
      break;
    case 'none':
      break;
  }
  // The row's last «Отправить» was refused for good: why, in the registry's words (the card says the rest).
  const refused = row.send?.refused ?? null;
  if (refused !== null) {
    const known = Object.hasOwn(CG_REGISTRY, refused.code) ? i18n.t(CG_REGISTRY[refused.code as keyof typeof CG_REGISTRY].title) : refused.code;
    return (
      <span class="cg-nw__st is-2" data-cg-code={refused.code}>
        <Dot kind="danger" />
        {i18n.t('newcomers.row.failed', { reason: known })}
      </span>
    );
  }
  if (batch === 'generating' || batch === 'queued') {
    return (
      <span class="cg-nw__st is-busy">
        {batch === 'generating' ? <Spinner /> : null}
        {i18n.t(BATCH_KEYS[batch])}
      </span>
    );
  }
  if (batch === 'failed') {
    const failure = row.batch?.failure ?? null;
    const why = failure === null ? null : failure.title === null ? failure.code : i18n.text(failure.title);
    return (
      <span class="cg-nw__st is-2" {...(failure === null ? {} : { 'data-cg-code': failure.code })}>
        <Dot kind="ink" />
        {why === null ? i18n.t(BATCH_KEYS.failed) : `${i18n.t(BATCH_KEYS.failed)}: ${why}`}
      </span>
    );
  }
  return <span class="cg-nw__st is-act">{i18n.t('newcomers.status.none')}</span>;
}

/** The row's own «Отправить» of its batch draft (X59): the card's «Отправить →» of the greeting's next part, by one click. */
function RowSend({ row }: { readonly row: NewcomerRowVM }): JSX.Element | null {
  const i18n = useI18n();
  return <RowSendButton row={row} label={i18n.t('newcomers.row.send')} tooltip={i18n.t('newcomers.row.sendTooltip')} blocked={i18n.t('newcomers.row.sendBlocked')} />;
}

/** «14 мин назад» of a new fan, as on Fansly; «продлил подписку 2 ч назад», «вернулся 2 ч назад» of the others. */
function subscribedText(i18n: I18n, row: NewcomerRowVM): string {
  const age = i18n.formatAge(row.subscribedAt);
  return row.kind === 'new' ? i18n.t('common.agoSuffix', { age }) : i18n.t('newcomers.cardMeta', { kind: i18n.t(KIND_KEYS[row.kind]), age });
}

/** What the rows of ChatSpace's list say: «@handle · 14 мин назад», the greeting, a saved draft, «Отправить». */
const ROW_PARTS: RowParts = {
  Status: GreetingStatus,
  End: RowSend,
  meta: (i18n: I18n, row: NewcomerRowVM) => `${row.username === null ? '' : `@${row.username} · `}${subscribedText(i18n, row)}`,
  tag: (i18n: I18n, row: NewcomerRowVM) => (row.hasDraft ? i18n.t(row.draftStale ? 'newcomers.draftStale' : 'newcomers.draft') : null),
};

/** The batch's foot: «Выбрано N · Сгенерировать N», «Готово N · отправлено M», then how to go on with the drafts. */
function batchWords(i18n: I18n): BatchWords {
  return {
    picked: (n) => i18n.t('newcomers.batch.picked', { n }),
    generate: (n) => i18n.t('newcomers.batch.generate', { n }),
    generating: (done, total) => i18n.t('newcomers.batch.generating', { done, total }),
    done: (ready, sent, failed) =>
      [i18n.t('newcomers.batch.ready', { n: ready }), sent === 0 ? null : i18n.t('newcomers.batch.sent', { n: sent }), failed === 0 ? null : i18n.t('newcomers.batch.failed', { n: failed })]
        .filter((part) => part !== null)
        .join(' · '),
    review: i18n.t('newcomers.batch.review'),
  };
}

/** While the hub's list is read: its stage and how far it got. */
function Stage({ vm }: { readonly vm: NewcomersVM }): JSX.Element | null {
  const i18n = useI18n();
  if (vm.scan === null) return null;
  return (
    <span class="cg-nw__stage cg-num" role="status">
      <Spinner />
      {i18n.text(vm.scan.stage)}
      {vm.scan.done === null || vm.scan.total === null ? null : <span>{i18n.t('newcomers.scanProgress', { done: vm.scan.done, total: vm.scan.total })}</span>}
    </span>
  );
}

function Refresh({ vm }: { readonly vm: NewcomersVM }): JSX.Element {
  const i18n = useI18n();
  return <RefreshButton label={i18n.t('newcomers.refresh')} busy={vm.scan !== null || vm.view.s === 'loading'} />;
}

/** «21 окт, 09:19 — 22 окт, 09:19 · местное время»: the dates the list covers, as on Fansly, up to the hub's data. */
function rangeText(i18n: I18n, vm: NewcomersVM): string | null {
  const to = vm.footer.stamp.asOf;
  if (to === null) return null;
  const from = Date.parse(to) - vm.windowHours * 3_600_000;
  return i18n.t('newcomers.range', { from: i18n.formatTime(from, 'datetime'), to: i18n.formatTime(to, 'datetime') });
}

/** The dates the list covers and whose name Hi greets in; «Результат неполный» with why. */
function Lines({ vm }: { readonly vm: NewcomersVM }): JSX.Element {
  const i18n = useI18n();
  const summary = [rangeText(i18n, vm), vm.personaLabel === null ? null : i18n.t('newcomers.personaNote', { persona: vm.personaLabel })]
    .filter((part) => part !== null)
    .join(' · ');
  return (
    <>
      {summary === '' ? null : <div class="cg-nw__line cg-nw__summary">{summary}</div>}
      {vm.incomplete === null ? null : (
        <div class="cg-nw__line cg-nw__incomplete" role="status">
          <b>{i18n.t('newcomers.incomplete')}</b> <span>{i18n.text(vm.incomplete)}</span>
        </div>
      )}
    </>
  );
}

/** The greeting's status filter (NF-004): one menu with counts. */
function Filter({ vm }: { readonly vm: NewcomersVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const filter = vm.filters.find((item) => item.pressed) ?? vm.filters[0];
  if (filter === undefined) return null;
  return (
    <StatusMenu
      label={filter.count === null ? i18n.text(filter.label) : `${i18n.text(filter.label)} ${filter.count}`}
      menuLabel={i18n.t('newcomers.col.greeting')}
      pressed={filter.id !== 'any'}
      items={vm.filters.map((item) => ({ id: item.id, label: i18n.text(item.label), count: item.count, checked: item.pressed }))}
      onSelect={(id) => {
        const chosen = vm.filters.find((item) => item.id === id);
        if (chosen !== undefined && !chosen.pressed) void dispatch({ type: 'SetNewcomersFilter', filter: chosen.id });
      }}
    />
  );
}

function Empty({ vm }: { readonly vm: NewcomersVM }): JSX.Element {
  return <ViewState view={vm.view} />;
}

const nothing = (): null => null;

/** ChatSpace's adapter of the family's window. */
export const HUB_SITE: NewcomersSite = {
  // «Новые подписчики», as the old OnlyFans client named it; Fansly's is «Новые фоловеры» (a follow is not a subscription there).
  title: (i18n) => i18n.t('newcomers.listLabel'),
  listLabel: (i18n) => i18n.t('newcomers.listLabel'),
  tabLabel: (i18n, tab) => i18n.text(tab.label),
  period: (i18n) => ({ lead: i18n.t('newcomers.period'), menuLabel: i18n.t('newcomers.window.label'), tooltip: i18n.t('newcomers.window.label') }),
  Stage,
  Refresh,
  Lines,
  blocked: () => null,
  Failed: nothing,
  Filter,
  pickAll: { label: (i18n, n) => i18n.t('newcomers.pickAll', { n }), tooltip: (i18n, max) => i18n.t('newcomers.pickTooltip', { max }) },
  rows: ROW_PARTS,
  batchWords,
  Empty,
  Card: HubCard,
  // The first fan who can be greeted now, with that fan's card, while no card is open (X55).
  opening: (vm) => (vm.cardOpen ? null : firstActionable(vm.rows)),
};

export function NewcomersWindow(): JSX.Element {
  return <NewcomersWindowOf site={HUB_SITE} />;
}
