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
  type OnlineRowVM,
  type OnlineWindowVM,
  type OutreachRowVM,
  type OutreachWindowVM,
  type QueuesWindowVM,
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
  'silent-8-21': 'spenders.filter.silent8to21',
  'silent-over-21': 'spenders.filter.silentOver21',
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
        spenderRow(ctx, FANS.jake, usd(540), 0, { weWroteAt: null }),
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
  // What the model keeps (1.44.0): the platform's 20 % off what the fans paid.
  return {
    view,
    expanded: false,
    open: false,
    windowDays: 30,
    timeZone: 'Europe/Moscow',
    days: known
      ? Array.from({ length: 30 }, (_, i) => ({ date: iso(ctx.now - (29 - i) * DAY).slice(0, 10), net: i % 7 === 3 ? null : usd(32 + ((i * 29) % 168)), today: i === 29 }))
      : [],
    today: money(52),
    d7: { ...money(888), changePct: known ? 4 : null, prev7: known ? usd(854) : null },
    d30: { ...money(3_736), purchases: known ? 57 : null, gross: known ? usd(4_670) : null, feePct: known ? 20 : null },
    payers: count(20),
    avgCheck: money(85),
    shelves: known
      ? [
          { id: 'shelf-600', range: { fromMills: usd(600), toMills: null }, fans: 3, net: usd(3_204) },
          { id: 'shelf-350', range: { fromMills: usd(350), toMills: usd(600) }, fans: 2, net: 0 },
          { id: 'shelf-outside', range: { fromMills: null, toMills: null }, remainder: 'untiered', fans: 35, net: usd(532) },
        ]
      : [],
    attention: {
      awaiting: count(12),
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
    seen: null,
    feed: { items: hasData && view.s !== 'empty' && source !== 'newcomers' ? feed(ctx) : [], hasOlder: hasData && source !== 'newcomers', loadingOlder: false, olderError: null },
    ping: source === 'newcomers' || !hasData ? null : { segment: 'active', fanSilenceDays: 0 },
    // The card of «Новые» holds the greeting draft, not a Fix source (NF-012).
    draft: { text: '', maxChars: 5000, placeholder: msg(source === 'newcomers' ? 'newcomers.greetingDraft.placeholder' : 'preview.draft.placeholder') },
    bar: previewBar(ctx, source, barPatch),
    result: null,
    media: null,
    idleHint: hasData ? msg(source === 'newcomers' ? 'preview.emptyNewcomers' : 'preview.empty') : null,
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

// ── «Рассылка» (1.63.0) ──

const WHALE = { fromMills: usd(600), toMills: null };
const TOP = { fromMills: usd(350), toMills: usd(600) };

export function outreachRow(ctx: ScenarioCtx, fan: FanFixture, patch: Partial<OutreachRowVM> = {}): OutreachRowVM {
  return {
    handle: handles.outreach(fan),
    name: fan.name,
    username: fan.username,
    tier: WHALE,
    lifetime: usd(1200),
    selected: false,
    ticked: true,
    waitingSince: null,
    weWroteAt: iso(ctx.now - 3 * DAY),
    history: true,
    state: 'idle',
    version: null,
    edited: false,
    stale: false,
    ownMedia: false,
    send: null,
    warning: null,
    sentAt: null,
    clickedAt: null,
    code: null,
    bought: null,
    replied: null,
    ...patch,
  };
}

export const defaultOutreachRows = (ctx: ScenarioCtx): OutreachRowVM[] => [
  outreachRow(ctx, FANS.hubert, { lifetime: usd(8930), state: 'ready', version: 'hey Hubert, had to show you this one first. tell me when you get to the end 😈', send: { can: true, kind: 'send', paused: false, reason: null } }),
  outreachRow(ctx, FANS.theodore, { lifetime: usd(6410), waitingSince: iso(ctx.now - 2 * HOUR), state: 'writing' }),
  outreachRow(ctx, FANS.marco, { tier: TOP, lifetime: usd(1940), state: 'sent', version: 'ok you weren\'t up 😴 but you\'ll want to be for this one', sentAt: iso(ctx.now - 4 * MIN) }),
];

export function outreach(ctx: ScenarioCtx, view: VmView, rows: readonly OutreachRowVM[], patch: Partial<OutreachWindowVM> = {}): OutreachWindowVM {
  const count = (state: OutreachRowVM['state']): number => rows.filter((row) => row.state === state).length;
  return {
    view,
    pageName: PERSONA.pageName,
    creator: null,
    persona: PERSONA.label,
    stamp: stamp(ctx),
    chip: null,
    text: 'ok this one is SPECIAL, first time with a DRAGON 🐉 6 minutes, tell me when you get to the end 😈',
    maxChars: 5000,
    textChangedAt: null,
    media: null,
    canPickMedia: true,
    audience: {
      source: 'tiers',
      picked: 0,
      tiers: [
        { id: 'shelf-600000', range: WHALE, fans: 2, on: true },
        { id: 'shelf-350000', range: TOP, fans: 1, on: true },
      ],
      conditions: [
        { id: 'spent', on: false, amount: '1,000', note: null },
        { id: 'active', on: false, note: null },
        { id: 'noWaiting', on: false, note: { kind: 'waiting', fans: { names: [FANS.theodore.name], more: 0 } } },
      ],
      count: rows.length,
      spent: rows.reduce((sum, row) => sum + (row.lifetime ?? 0), 0),
      locked: rows.some((row) => row.state !== 'idle'),
    },
    tab: 'all',
    tabs: { todo: rows.filter((row) => row.state !== 'sent' && row.state !== 'uncertain').length, all: rows.length },
    query: '',
    rows,
    aside: [],
    batch: { picked: 0, max: 60, queued: count('queued'), generating: count('writing'), ready: count('ready'), sent: count('sent'), failed: count('unwritten'), reason: null },
    totals: { sent: count('sent'), failed: count('failed'), uncertain: count('uncertain'), ready: count('ready'), written: rows.filter((row) => row.version !== null).length, stopped: count('stopped'), total: rows.length, boughtMills: null, replied: 0 },
    stale: 0,
    pane: 'offer',
    card: null,
    summary: null,
    sheet: null,
    picker: null,
    posts: null,
    ...patch,
  };
}

// ── «Онлайн» (1.65.0) ──

export function onlineRow(ctx: ScenarioCtx, fan: FanFixture, patch: Partial<OnlineRowVM> = {}): OnlineRowVM {
  return {
    handle: handles.online(fan),
    name: fan.name,
    username: fan.username,
    lifetime: usd(560),
    seenAt: iso(ctx.now - 3 * MIN),
    onlineSince: null,
    live: false,
    presence: 'now',
    reason: { kind: 'silent', since: iso(ctx.now - 12 * DAY), lifetime: usd(560) },
    aside: null,
    act: 'ping',
    state: 'idle',
    version: null,
    sentAct: null,
    sentAt: null,
    skipped: false,
    selected: false,
    arrived: false,
    replied: null,
    code: null,
    ...patch,
  };
}

export const defaultOnlineRows = (ctx: ScenarioCtx): OnlineRowVM[] => [
  onlineRow(ctx, FANS.hubert, { lifetime: usd(2840), reason: { kind: 'waiting', since: iso(ctx.now - MIN) }, act: 'reply', live: true, state: 'ready', version: 'haha okay you got me 😏 what did you order?' }),
  onlineRow(ctx, FANS.marco, { selected: true, state: 'ready', version: 'okay I need your vote again 😅 you picked the third one last time and you were right. still around?' }),
  onlineRow(ctx, FANS.theodore, { lifetime: null, reason: { kind: 'never', subscribedAt: iso(ctx.now - 30 * DAY) }, act: 'template', seenAt: iso(ctx.now - 18 * MIN), presence: 'fading', state: 'ready', version: 'hey Theodore 👋 I keep seeing you here but we\'ve never actually talked? that\'s giving mystery vibes lol. shy or just picky?' }),
];

// ── «Очереди» (2026-10-29) ──

export const defaultQueueRows = (ctx: ScenarioCtx): OnlineRowVM[] => [
  onlineRow(ctx, FANS.marco, {
    handle: handles.queue(FANS.marco),
    lifetime: null,
    seenAt: iso(ctx.now - 3 * HOUR),
    presence: 'fading',
    reason: { kind: 'queue', queue: 'Холодные живые', why: 'Подписан 12 мар · ни разу не писал', goal: null, mass: { count: 4, lastAt: iso(ctx.now - DAY) } },
    act: 'template',
    selected: true,
    state: 'ready',
    version: 'hey Marco - I noticed you\'ve been here for a bit but we never actually talked? that\'s kinda unusual for me lol. what brought you here originally?',
  }),
  onlineRow(ctx, FANS.theodore, {
    handle: handles.queue(FANS.theodore),
    lifetime: null,
    seenAt: iso(ctx.now - 26 * HOUR),
    presence: 'fading',
    reason: { kind: 'queue', queue: 'Холодные живые', why: 'Подписан 3 апр · ни разу не писал', goal: null, mass: null },
    act: 'template',
    state: 'ready',
    version: 'hey Theodore 👋 I keep seeing you here but we\'ve never actually talked? that\'s giving mystery vibes lol. shy or just picky?',
  }),
];

export function queuesWindow(ctx: ScenarioCtx, view: VmView, rows: readonly OnlineRowVM[], patch: Partial<QueuesWindowVM> = {}): QueuesWindowVM {
  return {
    view,
    pageName: PERSONA.pageName,
    creator: null,
    me: 'Макс',
    stamp: stamp(ctx),
    chips: [
      { queueId: 3, name: 'Холодные живые', standing: false, mine: false, paused: false, today: 12, perPerson: 50, done: false, selected: true },
      { queueId: 1, name: 'Платили, молчат', standing: true, mine: false, paused: false, today: 3, perPerson: 10, done: false, selected: false },
      { queueId: 5, name: 'Мои: спендеры на смену', standing: false, mine: true, paused: false, today: 0, perPerson: 30, done: false, selected: false },
    ],
    line: { goal: 'Познакомиться: пусть ответит хоть что-то. В первом сообщении не продаём.', rule: ['подписчики', 'ни разу не писали', 'не платили', 'заходили за 7 дней'], how: { action: 'template', group: 'b', own: false, batch: true }, people: false, requestedBy: 'Дмитрий' },
    answered: [],
    portion: rows,
    left: rows.length,
    taking: false,
    day: { mine: 12, perPerson: 50, page: 61, dailyLimit: 150, pending: 1948 },
    batch: rows.length === 0 ? null : { ready: rows.length, running: null, reason: null },
    card: null,
    end: rows.length === 0 ? { kind: 'pick' } : null,
    ...patch,
  };
}

export function onlineWindow(ctx: ScenarioCtx, view: VmView, rows: readonly OnlineRowVM[], patch: Partial<OnlineWindowVM> = {}): OnlineWindowVM {
  const groups: OnlineWindowVM['groups'] = [
    { id: 'waiting', left: rows.filter((row) => row.reason.kind === 'waiting').length, rows: rows.filter((row) => row.reason.kind === 'waiting') },
    { id: 'silent', left: rows.filter((row) => row.reason.kind === 'silent').length, rows: rows.filter((row) => row.reason.kind === 'silent') },
    { id: 'never', left: rows.filter((row) => row.reason.kind === 'never').length, rows: rows.filter((row) => row.reason.kind === 'never') },
  ].filter((group) => group.rows.length > 0) as OnlineWindowVM['groups'];
  return {
    view,
    pageName: PERSONA.pageName,
    creator: null,
    persona: PERSONA.label,
    stamp: stamp(ctx),
    seenBy: 'hub',
    minutes: 30,
    periods: [
      { minutes: 10, count: 2 },
      { minutes: 30, count: rows.length },
      { minutes: 120, count: rows.length + 4 },
    ],
    tab: 'todo',
    tabs: { todo: rows.length, all: rows.length + 2 },
    query: '',
    groups,
    elsewhere: rows.length === 0 ? null : { done: 0, other: 2 },
    totals: { online: rows.length + 2, worth: rows.length, sent: 0, skipped: 0, replied: 0 },
    card: null,
    end: null,
    ...patch,
  };
}
