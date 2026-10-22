// Spenders board and statistics, the fan preview and «Новые» for the
// scenarios. Money in mills (usd() for readability); null = unknown.

import {
  GREETING_FILTERS,
  GREETING_STATUSES,
  type GreetingFilter,
  NEWCOMERS_WINDOW_HOURS,
  SPENDERS_FILTERS,
  type I18nKey,
  type SpendersFilter,
  TONES,
  type DataStamp,
  type DockActionVM,
  type FeedItemVM,
  type GreetingStatusVM,
  type NewcomerRowVM,
  type NewcomersVM,
  type PreviewActionId,
  type PreviewSource,
  type PreviewVM,
  type ResultVM,
  type ShelfVM,
  type SpenderRowVM,
  type SpendersBoardVM,
  type SpendersStatsVM,
  type VmView,
} from '@cg/contracts';

import { button, DAY, FANS, handles, hotkey, HOUR, iso, MIN, msg, PERSONA, usd, views, type FanFixture, type ScenarioCtx } from './base';

const SPENDERS_FILTER_KEYS: Record<SpendersFilter, I18nKey> = {
  all: 'spenders.filter.all',
  waiting: 'spenders.filter.waiting',
  new: 'spenders.filter.new',
  'we-wrote': 'spenders.filter.weWrote',
  'fan-wrote': 'spenders.filter.fanWrote',
  history: 'spenders.filter.history',
  'no-history': 'spenders.filter.noHistory',
};

export const stamp = (ctx: ScenarioCtx, coverage: DataStamp['coverage'] = 'complete', ageMs = 2 * MIN): DataStamp => ({ asOf: iso(ctx.now - ageMs), coverage });

// ── Spenders board ──

export function spenderRow(ctx: ScenarioCtx, fan: FanFixture, lifetime: number | null, period: number | null, patch: Partial<SpenderRowVM> = {}): SpenderRowVM {
  return {
    handle: handles.spenders(fan),
    name: fan.name,
    username: fan.username,
    lifetime,
    period,
    isNew: false,
    deleted: false,
    weWroteAt: iso(ctx.now - 10 * HOUR),
    fanWroteAt: iso(ctx.now - 7 * MIN),
    waiting: false,
    lastMessage: null,
    selected: false,
    ...patch,
  };
}

function shelves(ctx: ScenarioCtx, selected: FanFixture | null): ShelfVM[] {
  const sel = (fan: FanFixture) => selected !== null && fan.key === selected.key;
  return [
    {
      id: 'shelf-600',
      range: { fromMills: usd(600), toMills: null },
      fans: 3,
      lifetime: usd(31_480),
      period: usd(4_005),
      rows: [
        spenderRow(ctx, FANS.hubert, usd(12_480), usd(320), { waiting: true, selected: sel(FANS.hubert), lastMessage: { fromUs: false, text: 'are you there?' } }),
        spenderRow(ctx, FANS.theodore, usd(11_200), usd(3_100), { selected: sel(FANS.theodore), lastMessage: { fromUs: true, text: 'Look what I made for you' } }),
        spenderRow(ctx, FANS.marco, usd(7_800), usd(585), { fanWroteAt: iso(ctx.now - 19 * DAY), selected: sel(FANS.marco) }),
      ],
      collapsed: null,
    },
    {
      id: 'shelf-350',
      range: { fromMills: usd(350), toMills: usd(600) },
      fans: 2,
      lifetime: usd(940),
      period: 0,
      rows: [
        spenderRow(ctx, FANS.jake, usd(540), 0, { isNew: true, weWroteAt: null }),
        spenderRow(ctx, FANS.leo, usd(400), null, { deleted: true, fanWroteAt: null }),
      ],
      collapsed: { hidden: 4, reveal: button('spenders.shelfMore', { type: 'RevealShelf', shelfId: 'shelf-350' }) },
    },
  ];
}

export function board(ctx: ScenarioCtx, view: VmView, patch: Partial<SpendersBoardVM> = {}): SpendersBoardVM {
  const rows = view.s === 'loading' || view.s === 'error' || view.s === 'forbidden' || view.s === 'empty' ? [] : shelves(ctx, patch.previewOpen === true ? FANS.hubert : null);
  return {
    view,
    pageName: PERSONA.pageName,
    period: '30d',
    periods: ['lifetime', '30d', 'mtd', '7d', 'today'],
    query: '',
    filters: SPENDERS_FILTERS.map((id) => ({ id, label: msg(SPENDERS_FILTER_KEYS[id]), count: id === 'all' ? 40 : id === 'waiting' ? 12 : 3, pressed: id === 'all' })),
    sort: 'sum',
    shelves: rows,
    footer: { loaded: rows.length === 0 ? 0 : 40, total: rows.length === 0 ? null : 40, shown: null, stamp: stamp(ctx) },
    canLoadMore: false,
    reset: null,
    previewOpen: false,
    // The controller's own keys (X67: the old window's foot shows them).
    keys: [
      { label: msg('spenders.keys.row'), hotkey: { display: 'J / K', aria: 'J K', delivery: 'delivered', fallback: null } },
      { label: msg('preview.label'), hotkey: { display: 'Space', aria: 'Space', delivery: 'delivered', fallback: null } },
      { label: msg('common.openChat'), hotkey: { display: 'O', aria: 'O', delivery: 'delivered', fallback: null } },
      { label: msg('cheatsheet.row.search'), hotkey: { display: '/', aria: '/', delivery: 'delivered', fallback: null } },
      { label: msg('common.close'), hotkey: hotkey(ctx, 'close') },
    ],
    ...patch,
  };
}

// ── statistics ──

export function stats(ctx: ScenarioCtx, view: VmView, patch: Partial<SpendersStatsVM> = {}): SpendersStatsVM {
  const known = view.s === 'ready' || view.s === 'partial' || view.s === 'offline';
  const coverage = view.s === 'partial' ? 'partial' : 'complete';
  const s = stamp(ctx, coverage);
  const money = (dollars: number) => ({ mills: known ? usd(dollars) : null, stamp: s });
  const count = (n: number) => ({ count: known ? n : null, stamp: s });
  return {
    view,
    expanded: false,
    windowDays: 30,
    timeZone: 'Europe/Moscow',
    days: known
      ? Array.from({ length: 30 }, (_, i) => ({ date: iso(ctx.now - (29 - i) * DAY).slice(0, 10), gross: i % 7 === 3 ? null : usd(40 + ((i * 37) % 210)), today: i === 29 }))
      : [],
    today: money(65),
    d7: { ...money(1_110), changePct: known ? 4 : null, prev7: known ? usd(1_068) : null },
    d30: { ...money(4_670), purchases: known ? 57 : null },
    payers: count(20),
    avgCheck: money(106),
    shelves: known
      ? [
          { id: 'shelf-600', range: { fromMills: usd(600), toMills: null }, fans: 3, lifetime: usd(31_480), period: usd(4_005), share: 0.86 },
          { id: 'shelf-350', range: { fromMills: usd(350), toMills: usd(600) }, fans: 2, lifetime: usd(940), period: 0, share: 0 },
          { id: 'shelf-none', range: { fromMills: null, toMills: null }, fans: 35, lifetime: usd(2_100), period: usd(665), share: 0.14 },
        ]
      : [],
    attention: {
      awaiting: count(12),
      newPayers: { ...count(3), firstObserved: coverage !== 'complete' },
      silent8to21: count(10),
      silentOver21: count(6),
      noData: count(4),
    },
    stamp: s,
    ...patch,
  };
}

// ── preview ──

function feed(ctx: ScenarioCtx): FeedItemVM[] {
  const at = (minutesAgo: number) => iso(ctx.now - minutesAgo * MIN);
  return [
    { id: 'm1', at: at(4 * 24 * 60), sender: 'model', text: 'Good morning, sunshine', deleted: false, automatic: false, tip: null, price: null, attachments: [], dayBreak: true },
    { id: 'm2', at: at(4 * 24 * 60 - 30), sender: 'fan', text: 'morning! sending you something', deleted: false, automatic: false, tip: usd(50), price: null, attachments: [], dayBreak: false },
    { id: 'm3', at: at(10 * 60), sender: 'model', text: 'A little set just for you', deleted: false, automatic: false, tip: null, price: { mills: usd(30), purchased: true }, attachments: ['photo × 4'], dayBreak: true },
    { id: 'm4', at: at(7), sender: 'fan', text: 'are you there?', deleted: false, automatic: false, tip: null, price: null, attachments: [], dayBreak: false },
  ];
}

function previewBar(ctx: ScenarioCtx, source: PreviewSource, patch: Partial<Record<PreviewActionId, DockActionVM>> = {}): PreviewVM['bar'] {
  const action = (id: PreviewActionId): DockActionVM => ({ enabled: true, busy: false, active: false, reason: null, hotkey: hotkey(ctx, id), badge: null });
  const ids: readonly PreviewActionId[] = source === 'newcomers' ? ['hi'] : ['reply', 'fix', 'hi', 'ping'];
  return {
    actions: { ...Object.fromEntries(ids.map((id) => [id, action(id)])), ...patch },
    tone: null,
    tones: TONES,
    split: true,
    locked: false,
    toneReason: null,
    splitReason: null,
  };
}

export interface PreviewOptions extends Partial<PreviewVM> {
  readonly fan?: FanFixture;
  readonly barPatch?: Partial<Record<PreviewActionId, DockActionVM>>;
}

export function preview(ctx: ScenarioCtx, source: PreviewSource, view: VmView, options: PreviewOptions = {}): PreviewVM {
  const { fan = source === 'newcomers' ? FANS.tomasz : FANS.hubert, barPatch, ...patch } = options;
  const handle = source === 'newcomers' ? handles.newcomers(fan) : source === 'palette' ? handles.palette(fan) : handles.spenders(fan);
  const hasData = view.s !== 'loading' && view.s !== 'error' && view.s !== 'forbidden';
  return {
    view,
    from: source,
    handle,
    header: hasData
      ? {
          name: fan.name,
          username: fan.username,
          lifetime: source === 'newcomers' ? 0 : usd(12_480),
          period30: source === 'newcomers' ? null : usd(320),
          weWroteAt: source === 'newcomers' ? null : iso(ctx.now - 10 * HOUR),
          fanWroteAt: source === 'newcomers' ? null : iso(ctx.now - 7 * MIN),
          newcomer: source === 'newcomers' ? { kind: 'new', subscribedAt: iso(ctx.now - 14 * MIN) } : null,
        }
      : null,
    openChat: button('common.openChat', { type: 'Navigate', to: { kind: 'chat', targetHandle: handles.dock(fan) } }),
    close: { type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } },
    unread: 'kept',
    archive: {
      stamp: stamp(ctx, view.s === 'partial' ? 'partial' : 'complete'),
      lagMinutes: null,
      refreshing: false,
      refresh: button('common.refreshArchive', { type: 'RefreshArchive', targetHandle: handle }),
    },
    fanWroteNew: false,
    feed: { items: hasData && view.s !== 'empty' && source !== 'newcomers' ? feed(ctx) : [], hasOlder: hasData && source !== 'newcomers', loadingOlder: false, olderError: null },
    ping: source === 'newcomers' || !hasData ? null : { segment: 'active', fanSilenceDays: 0 },
    // The card of «Новые» holds the greeting draft, not a Fix source (NF-012).
    draft: { text: '', maxChars: 5000, placeholder: msg(source === 'newcomers' ? 'newcomers.greetingDraft.placeholder' : 'preview.draft.placeholder') },
    bar: previewBar(ctx, source, barPatch),
    result: null,
    media: null,
    idleHint: hasData ? msg('preview.empty') : null,
    neighbors: {
      previous: { type: 'OpenPreview', targetHandle: handles.spenders(FANS.theodore) },
      next: { type: 'OpenPreview', targetHandle: handles.spenders(FANS.marco) },
    },
    claim: source === 'newcomers' ? { s: 'none' } : null,
    greeting: source === 'newcomers' ? { s: 'none' } : null,
    stoppedNote: null,
    ...patch,
  };
}

export function withResult(vm: PreviewVM, result: ResultVM, patch: Partial<PreviewVM> = {}): PreviewVM {
  return { ...vm, result, idleHint: null, ...patch };
}

// ── «Новые» ──

export function newcomerRow(ctx: ScenarioCtx, fan: FanFixture, kind: NewcomerRowVM['kind'], minutesAgo: number, greeting: GreetingStatusVM, patch: Partial<NewcomerRowVM> = {}): NewcomerRowVM {
  return {
    handle: handles.newcomers(fan),
    name: fan.name,
    username: fan.username,
    kind,
    subscribedAt: iso(ctx.now - minutesAgo * MIN),
    greeting,
    hasDraft: false,
    draftStale: false,
    selected: false,
    ...patch,
  };
}

const FILTER_STATES: Record<GreetingFilter, readonly GreetingStatusVM['s'][]> = {
  any: GREETING_STATUSES,
  none: ['none'],
  sending: ['sending', 'sending-other'],
  stopped: ['stopped'],
  greeted: ['greeted'],
  replied: ['replied'],
};

export function newcomers(ctx: ScenarioCtx, view: VmView, rows: readonly NewcomerRowVM[], patch: Partial<NewcomersVM> = {}): NewcomersVM {
  return {
    view,
    pageName: PERSONA.pageName,
    personaLabel: PERSONA.label,
    tab: 'todo',
    tabs: [
      { id: 'todo', label: msg('newcomers.tab.todo'), count: rows.filter((r) => r.greeting.s !== 'greeted').length },
      { id: 'all', label: msg('newcomers.tab.all'), count: rows.length },
    ],
    windowHours: NEWCOMERS_WINDOW_HOURS.default,
    windowOptions: NEWCOMERS_WINDOW_HOURS.quick,
    filters: GREETING_FILTERS.map((id) => ({ id, label: msg(`newcomers.filter.${id}`), count: rows.filter((r) => FILTER_STATES[id].includes(r.greeting.s)).length, pressed: id === 'any' })),
    query: '',
    rows,
    cardOpen: rows.some((r) => r.selected),
    scan: null,
    incomplete: null,
    footer: { count: rows.length, stamp: stamp(ctx) },
    canLoadMore: false,
    hint: msg('newcomers.hint', { window: NEWCOMERS_WINDOW_HOURS.default }),
    noAutoSend: msg('newcomers.noAutoSend'),
    ...patch,
  };
}

export const defaultNewcomerRows = (ctx: ScenarioCtx): NewcomerRowVM[] => [
  newcomerRow(ctx, FANS.tomasz, 'new', 14, { s: 'none' }, { selected: true }),
  newcomerRow(ctx, FANS.leo, 'renewed', 41, { s: 'sending-other' }),
  newcomerRow(ctx, FANS.jake, 'returning', 180, { s: 'none' }),
  newcomerRow(ctx, FANS.marco, 'new', 600, { s: 'greeted', at: iso(ctx.now - 9 * HOUR) }),
];

export const loadingView = (ctx: ScenarioCtx) => views.loading(ctx.now - 300);
