// The states of the boards' stand gallery, named after the binding mockup
// (ui-design §0.2): 11 a–j Spenders, 13 a–d «Новые», 14 a–c the fan panel,
// 15 a–b the palette, plus the quick-jump popup and the states the mockup
// does not draw (ui-design §10). Each is an AppClient scenario: the surfaces
// render it through `useView` exactly as they render a controller's models.

import {
  type DockActionVM,
  type Locale,
  type MountSurfaceKind,
  type PaletteItemVM,
  type PreviewSendView,
  type PreviewVM,
  type ResultVM,
  type SpendersBoardVM,
  type SpendersFilter,
} from '@cg/contracts';

import {
  board,
  button,
  cgError,
  ctxOf,
  entry,
  fanPanel,
  hotkey,
  iso,
  meta,
  MIN,
  msg,
  newcomers,
  NOW,
  palette,
  PERSONA,
  preview,
  quickJump,
  reason,
  recapView,
  result,
  sendParts,
  stats,
  uuid,
  views,
  withResult,
  type AppClientScenario,
  type ScenarioCtx,
  type ScenarioViewEntry,
} from '../scenarios/app-client';
import { BOARD_FANS, GREETING_PARTS, HUBERT, NEWCOMER_FANS, REPLY_PARTS, boardHandle, boardShelves, boardStats, hubertFeed, manyFans, newcomerHandle, newcomerRows, paletteChat, type BoardFan } from './data';
import { fanslyConnecting, fanslyExcluded, fanslyGreeted, fanslyGreeting, fanslyGreetingRefused, fanslyListFailed, fanslyPaused, fanslyQueue, fanslyScanning } from './fansly-newcomers';

const OP = { reply: uuid(701), hi: uuid(702) };
const SENT_AT = iso(NOW + MIN);
const UNCERTAIN: PreviewSendView = { s: 'uncertain', since: SENT_AT, attemptId: uuid(711) };

const PRIMARY: readonly SpendersFilter[] = ['all', 'waiting', 'new'];

/** The board over `fans`: three filters with their counts, the 30-day period, the coverage footer. */
export function boardOf(ctx: ScenarioCtx, fans: readonly BoardFan[], patch: Partial<SpendersBoardVM> & { readonly selected?: string | null } = {}): SpendersBoardVM {
  const { selected = null, ...rest } = patch;
  const counts: Record<string, number> = { all: fans.length, waiting: fans.filter((item) => item.lastFrom === 'fan').length, new: fans.filter((item) => item.isNew === true).length };
  const base = board(ctx, views.ready());
  return {
    ...base,
    filters: base.filters.filter((filter) => PRIMARY.includes(filter.id)).map((filter) => ({ ...filter, count: counts[filter.id] ?? null })),
    shelves: boardShelves(ctx, fans, selected, rest.sort ?? 'sum'),
    footer: { loaded: fans.length, total: fans.length, shown: null, stamp: { asOf: iso(ctx.now - 2 * MIN), coverage: 'complete' } },
    previewOpen: selected !== null,
    keys: [],
    ...rest,
  };
}

function statsOf(ctx: ScenarioCtx, expanded = false) {
  return { ...stats(ctx, views.ready()), ...boardStats(ctx, BOARD_FANS), expanded };
}

function replyBar(ctx: ScenarioCtx, active: 'reply' | 'hi' | null): Partial<Record<'reply' | 'fix' | 'hi' | 'ping', DockActionVM>> {
  const on = (id: 'reply' | 'fix' | 'hi' | 'ping'): DockActionVM => ({ enabled: true, busy: false, active: active === id, reason: null, hotkey: hotkey(ctx, id), badge: null });
  return { reply: on('reply'), fix: on('fix'), hi: on('hi'), ping: on('ping') };
}

/** A preview result whose parts are in `states`; the head follows them (progress, «черновик · не отправлено», «Ещё раз»). */
export function sendResult(ctx: ScenarioCtx, opId: string, feature: 'reply' | 'hi', texts: readonly string[], states: readonly PreviewSendView[], metas: ResultVM['meta']): ResultVM {
  const sent = states.filter((state) => state.s === 'sent').length;
  const started = states.some((state) => state.s !== 'available' && state.s !== 'unavailable' && state.s !== 'held-stale');
  const inWork = states.some((state) => state.s === 'queued' || state.s === 'sending' || state.s === 'accepted');
  const uncertain = states.findIndex((state) => state.s === 'uncertain');
  const blocked = uncertain >= 0 ? reason('part-uncertain', { n: uncertain + 1 }) : inWork ? reason('parts-sending') : null;
  // «Отправка после части N»: N is the part right before (ui-design §4.13).
  const parts = sendParts(opId, texts, states).map((part) => (part.sendOrder?.kind === 'after' ? { ...part, sendOrder: { kind: 'after' as const, part: part.index } } : part));
  return result(ctx, {
    opId,
    feature,
    state: 'done',
    surface: feature === 'hi' ? 'newcomers' : 'preview',
    parts,
    meta: metas,
    splitRequested: true,
    draftNotSent: !started,
    sendProgress: sent > 0 ? { sent, total: texts.length } : null,
    canRegenerate: blocked === null,
    regenerateReason: blocked,
  });
}

function hubertPreview(ctx: ScenarioCtx, states: readonly PreviewSendView[] | null, patch: Partial<PreviewVM> = {}): PreviewVM {
  const base = preview(ctx, 'spenders', views.partial({ kind: 'archive-lag', messages: null, minutes: 2 }), { barPatch: replyBar(ctx, states === null ? null : 'reply') });
  const started = states !== null && states.some((state) => state.s !== 'available' && state.s !== 'unavailable' && state.s !== 'held-stale');
  const vm: PreviewVM = {
    ...base,
    handle: boardHandle(HUBERT.key),
    header: {
      name: HUBERT.name,
      username: HUBERT.username,
      lifetime: HUBERT.lifetime * 1000,
      period30: HUBERT.d30 * 1000,
      weWroteAt: iso(ctx.now - (HUBERT.weAgo ?? 0) * MIN),
      fanWroteAt: iso(ctx.now - (HUBERT.fanAgo ?? 0) * MIN),
      newcomer: null,
    },
    archive: { ...base.archive, stamp: { asOf: iso(ctx.now - 2 * MIN), coverage: 'complete' }, lagMinutes: 2, refresh: button('common.refreshArchive', { type: 'RefreshArchive', targetHandle: boardHandle(HUBERT.key) }) },
    feed: { items: hubertFeed(ctx), hasOlder: true, loadingOlder: false, olderError: null },
    ping: { segment: 'active', fanSilenceDays: 0 },
    unread: started ? 'read-after-send' : 'kept',
    neighbors: { previous: { type: 'OpenPreview', targetHandle: boardHandle('b001') }, next: { type: 'OpenPreview', targetHandle: boardHandle('b003') } },
    ...patch,
  };
  return states === null ? vm : withResult(vm, sendResult(ctx, OP.reply, 'reply', REPLY_PARTS, states, [meta.parts(REPLY_PARTS.length)]), patch);
}

/**
 * The palette's «Онлайн» preview in its own window (CS-030, X24): the Spenders pane over the same fan, named by
 * the palette's handle; its neighbours are the group the palette showed (here: Hubert first, then one more).
 */
function onlineState(ctx: ScenarioCtx, states: readonly PreviewSendView[] | null): ScenarioViewEntry[] {
  const handle = `palette:${HUBERT.key}`;
  const vm = hubertPreview(ctx, states);
  return [
    entry(
      { of: 'preview', from: 'palette' },
      {
        ...vm,
        from: 'palette',
        handle,
        archive: { ...vm.archive, refresh: button('common.refreshArchive', { type: 'RefreshArchive', targetHandle: handle }) },
        openChat: button('common.openChat', { type: 'Navigate', to: { kind: 'chat', targetHandle: handle } }),
        neighbors: { previous: null, next: { type: 'OpenPreview', targetHandle: 'palette:b003' } },
      },
    ),
  ];
}

function spendersState(ctx: ScenarioCtx, states: readonly PreviewSendView[] | null, previewPatch: Partial<PreviewVM> = {}): ScenarioViewEntry[] {
  return [
    entry({ of: 'spenders.board' }, boardOf(ctx, BOARD_FANS, { selected: HUBERT.key })),
    entry({ of: 'spenders.stats' }, statsOf(ctx)),
    entry({ of: 'preview', from: 'spenders' }, hubertPreview(ctx, states, previewPatch)),
  ];
}

const AVAILABLE: PreviewSendView = { s: 'available' };
const SENT: PreviewSendView = { s: 'sent', at: SENT_AT };

/** Every «Отправить» state side by side (final-11h): one part per state, named after it. */
function everySendState(ctx: ScenarioCtx): ResultVM {
  const rows: readonly (readonly [string, PreviewSendView])[] = [
    ['available', AVAILABLE],
    ['unavailable', { s: 'unavailable', code: 'CG-SEND-HOST', reason: msg('send.reason.host') }],
    ['queued', { s: 'queued' }],
    ['sending', { s: 'sending' }],
    ['accepted', { s: 'accepted' }],
    ['sent', SENT],
    ['rejected', { s: 'rejected', code: 'CG-SEND-REJECTED', detail: 'OnlyFans didn’t accept this action', canRetry: false }],
    ['rejected-retry', { s: 'rejected', code: 'CG-SEND-QUEUE', canRetry: true }],
    ['uncertain', UNCERTAIN],
    ['held-stale', { s: 'held-stale', at: SENT_AT }],
  ];
  const vm = sendResult(
    ctx,
    OP.reply,
    'reply',
    rows.map(([name]) => name),
    rows.map(([, state]) => state),
    [],
  );
  // A specimen: each row stands on its own, none waits behind another.
  return { ...vm, parts: (vm.parts ?? []).map((part) => ({ ...part, sendOrder: null, openInsert: part.send?.s === 'uncertain' || part.send?.s === 'sent' ? { s: 'hidden' } : { s: 'available' } })) };
}

// ── «Новые» ──

function newcomersState(ctx: ScenarioCtx, variant: 'a' | 'b' | 'c' | 'd'): ScenarioViewEntry[] {
  const greeting = variant === 'a' ? ({ s: 'claim-mine' } as const) : variant === 'b' ? ({ s: 'sending', sent: 1, total: 3 } as const) : variant === 'd' ? ({ s: 'stopped', sent: 1, total: 3, part: 2 } as const) : ({ s: 'none' } as const);
  const selected = variant === 'c' ? 'leo' : 'tomasz';
  const rows = newcomerRows(ctx, selected, greeting);
  const list = newcomers(ctx, views.ready(), rows, { hint: msg('newcomers.hint', { window: ctx.lang === 'ru' ? '48 часов' : '48 hours' }), footer: { count: rows.length, stamp: { asOf: iso(ctx.now - 2 * MIN), coverage: 'complete' } } });
  const who = NEWCOMER_FANS[selected];
  const handle = newcomerHandle(who.key);
  const hi = (enabled: boolean, active: boolean): DockActionVM => ({ enabled, busy: false, active, reason: enabled ? null : reason('claim-busy'), hotkey: enabled ? hotkey(ctx, 'hi') : null, badge: null });
  const base = preview(ctx, 'newcomers', views.ready(), { barPatch: { hi: hi(variant !== 'c', variant !== 'c') } });
  const card: PreviewVM = {
    ...base,
    handle,
    header: { name: who.name, username: who.username, lifetime: 0, period30: null, weWroteAt: null, fanWroteAt: null, newcomer: { kind: variant === 'c' ? 'returning' : 'new', subscribedAt: iso(ctx.now - (variant === 'c' ? 300 : 14) * MIN) } },
    openChat: button('common.openChat', { type: 'Navigate', to: { kind: 'chat', targetHandle: handle } }),
    archive: { ...base.archive, stamp: { asOf: iso(ctx.now - 2 * MIN), coverage: 'complete' }, refresh: button('common.refreshArchive', { type: 'RefreshArchive', targetHandle: handle }) },
    idleHint: null,
  };
  if (variant === 'c') {
    const leo: PreviewVM = {
      ...card,
      feed: {
        items: [{ id: 'l1', at: iso(ctx.now - 300 * MIN), sender: 'model', text: 'welcome back, Léo 🌸', deleted: false, automatic: false, tip: null, price: null, attachments: [], dayBreak: true }],
        hasOlder: false,
        loadingOlder: false,
        olderError: null,
      },
      claim: { s: 'other', error: cgError(ctx, 'CG-CLAIM-BUSY') },
      greeting: { s: 'claim-other' },
    };
    return [entry({ of: 'newcomers' }, list), entry({ of: 'preview', from: 'newcomers' }, leo)];
  }
  const states: readonly PreviewSendView[] = variant === 'a' ? [AVAILABLE, AVAILABLE, AVAILABLE] : variant === 'b' ? [SENT, { s: 'queued' }, AVAILABLE] : [SENT, UNCERTAIN, AVAILABLE];
  const started = variant !== 'a';
  const empty = { ...card, view: views.empty(msg('preview.feed.emptySubscribed', { name: 'Tomasz', age: { age: ctx.now - 14 * MIN } })) };
  const withHi = withResult(empty, sendResult(ctx, OP.hi, 'hi', GREETING_PARTS, states, [meta.variants(1), meta.parts(GREETING_PARTS.length)]), {
    unread: started ? 'read-after-send' : 'kept',
    greeting,
    claim: variant === 'd' ? { s: 'held-uncertain', part: 2, error: cgError(ctx, 'CG-SEND-UNCERTAIN') } : { s: 'none' },
    stoppedNote: variant === 'd' ? msg('newcomers.stopped', { n: 2 }) : null,
  });
  return [entry({ of: 'newcomers' }, list), entry({ of: 'preview', from: 'newcomers' }, withHi)];
}

// ── the fan panel ──

const RECAP_SHORT = {
  ru: 'Хуберт, 18 мес подписки, один из главных покупателей ($12,480). Много путешествует, сейчас в Варшаве. Любит, когда Лора первой рассказывает про свой день, отвечает быстро утром. Покупает сеты после «тизера» в тексте, торг не любит. Вчера купил сет за $25, ждёт продолжения.',
  en: 'Hubert, 18 months subscribed, one of the top buyers ($12,480). Travels a lot, now in Warsaw. Likes it when Lora tells about her day first and answers fast in the morning. Buys sets after a teaser in the text, dislikes haggling. Bought a $25 set yesterday and waits for more.',
} as const;

function fanPanelState(ctx: ScenarioCtx, variant: 'a' | 'b' | 'c'): ScenarioViewEntry[] {
  if (variant === 'c') return [entry({ of: 'fan-panel' }, fanPanel(ctx, views.empty(msg('fanPanel.empty.title'))))];
  const panel = fanPanel(ctx, views.ready(), {
    tab: variant === 'b' ? 'recap' : 'fan',
    fan: { name: 'Hubert', username: 'hubert_pl', initials: 'H', lastSeenAt: iso(ctx.now - 6 * MIN), online: false },
    host: null,
    bio: 'logistics guy from Poland ✈️ always somewhere between two airports. coffee first, then everything else',
    lists: ['VIP', 'Travels a lot'],
  });
  const recap = recapView(ctx, views.ready(), 'short', { markdown: RECAP_SHORT[ctx.lang], saved: { s: 'saved', at: iso(ctx.now - 26 * 60 * MIN) }, generatedAt: iso(ctx.now - 26 * 60 * MIN) });
  return [entry({ of: 'fan-panel' }, panel), entry({ of: 'recap.view' }, recap)];
}

// ── the palette ──

function paletteState(ctx: ScenarioCtx, variant: 'a' | 'b'): ScenarioViewEntry[] {
  const dock = `dock:${HUBERT.key}`;
  const item = (id: string, label: PaletteItemVM['label'], action: PaletteItemVM['action'], patch: Partial<PaletteItemVM> = {}): PaletteItemVM => ({
    id,
    label,
    sublabel: null,
    match: [],
    hotkey: null,
    money: null,
    waitingSince: null,
    runningSince: null,
    enabled: true,
    reason: null,
    action,
    ...patch,
  });
  const feature = (id: 'reply' | 'fix' | 'hi' | 'ping' | 'review' | 'recap' | 'coach', label: string): PaletteItemVM =>
    item(id, label, { type: 'Generate', targetHandle: dock, feature: id, options: {} }, { hotkey: hotkey(ctx, id) });
  const surface = (name: 'spenders' | 'newcomers' | 'cheatsheet'): PaletteItemVM['action'] => ({ type: 'Navigate', to: { kind: 'surface', surface: name, open: true } });
  const actions: PaletteItemVM[] = [
    feature('reply', 'Reply'),
    feature('fix', 'Fix'),
    feature('hi', 'Hi'),
    feature('ping', 'Ping'),
    feature('review', 'Review'),
    feature('recap', 'Recap'),
    feature('coach', 'Coach'),
    item('spenders', msg('palette.item.spenders'), surface('spenders'), { hotkey: hotkey(ctx, 'spenders') }),
    item('newcomers', msg('palette.item.newcomers'), surface('newcomers')),
    item('tone', msg('palette.item.tone'), { type: 'SetTone', targetHandle: dock, tone: 'flirty' }, { hotkey: hotkey(ctx, 'tone') }),
    item('split', msg('palette.item.split'), { type: 'SetPreference', key: 'generation.split', value: true }, { hotkey: hotkey(ctx, 'split') }),
    item('cheatsheet', msg('palette.item.cheatsheet'), surface('cheatsheet'), { hotkey: hotkey(ctx, 'cheatsheet') }),
    item('settings', msg('palette.item.settings'), { type: 'OpenSettings', route: { section: 'status' } }),
  ];
  const run = (id: string, label: string, name: string, seconds: number): PaletteItemVM =>
    item(id, label, { type: 'Navigate', to: { kind: 'chat', targetHandle: `dock:${id}` } }, { sublabel: name, runningSince: ctx.now - seconds * 1000 });
  const running = [run('r1', 'Reply', 'Theodore Whitfield', 14), run('r2', 'Recap', 'Marco Rinaldi', 42), run('r3', 'Hi', 'Jake Morrison', 7)];
  const base = palette(ctx, views.ready());
  if (variant === 'a') {
    const waiting = BOARD_FANS.filter((who) => who.lastFrom === 'fan').slice(0, 4).map((who) => paletteChat(ctx, who));
    return [
      entry(
        { of: 'palette' },
        {
          ...base,
          query: '',
          groups: [
            { id: 'actions', title: msg('palette.group.actions', { name: 'Hubert' }), items: actions },
            { id: 'running', title: msg('palette.group.running'), items: running },
            { id: 'waiting', title: msg('palette.group.waiting'), items: waiting },
          ],
          footer: msg('palette.foot.chats', { n: 43 }),
        },
      ),
    ];
  }
  const query = 're';
  const hit = (text: string): PaletteItemVM['match'] => {
    const at = text.toLowerCase().indexOf(query);
    return at < 0 ? [] : [[at, at + query.length]];
  };
  const matches = (text: string): boolean => text.toLowerCase().includes(query);
  const found = actions.filter((entryItem) => typeof entryItem.label === 'string' && matches(entryItem.label)).map((entryItem) => ({ ...entryItem, match: hit(entryItem.label as string) }));
  const chats = BOARD_FANS.filter((who) => matches(who.name)).slice(0, 6).map((who) => paletteChat(ctx, who, hit(who.name)));
  return [
    entry(
      { of: 'palette' },
      {
        ...base,
        query,
        groups: [
          { id: 'actions', title: msg('palette.group.actions', { name: 'Hubert' }), items: found },
          { id: 'running', title: msg('palette.group.running'), items: running.filter((entryItem) => matches(`${typeof entryItem.label === 'string' ? entryItem.label : ''} ${entryItem.sublabel ?? ''}`)) },
          { id: 'chats', title: msg('palette.group.chats'), items: chats },
        ],
        footer: msg('palette.foot.chats', { n: 43 }),
      },
    ),
  ];
}

// ── the catalogue ──

export interface BoardState {
  /** The mockup's state id («11a») or our own name for a state it does not draw. */
  readonly id: string;
  readonly title: string;
  readonly surface: MountSurfaceKind;
  readonly views: (ctx: ScenarioCtx) => ScenarioViewEntry[];
  /** A site's own surface for the view (R20 P10a: «Новые» of the pass on Fansly); absent — the shared one. */
  readonly site?: 'fansly';
}

const state = (id: string, title: string, surface: MountSurfaceKind, build: (ctx: ScenarioCtx) => ScenarioViewEntry[]): BoardState => ({ id, title, surface, views: build });
/** «Новые» of the background's pass, drawn by Fansly's own surface (ui/hosts/fansly/newcomers). */
const fansly = (id: string, title: string, build: (ctx: ScenarioCtx) => ScenarioViewEntry[]): BoardState => ({ id, title, surface: 'newcomers', views: build, site: 'fansly' });

export const BOARD_STATES: readonly BoardState[] = [
  // 11 — Spenders
  state('11a', '«Отправить» available: Reply of three parts, a draft', 'spenders', (ctx) => spendersState(ctx, [AVAILABLE, AVAILABLE, AVAILABLE])),
  state('11b', 'Part 1 sent, part 2 is being sent, part 3 waits', 'spenders', (ctx) => spendersState(ctx, [SENT, { s: 'sending' }, AVAILABLE])),
  state('11c', 'Part 2 accepted by ChatSpace, waiting for the echo', 'spenders', (ctx) => spendersState(ctx, [SENT, { s: 'accepted' }, AVAILABLE])),
  state('11d', 'Part 2 uncertain: the rest is held', 'spenders', (ctx) => spendersState(ctx, [SENT, UNCERTAIN, AVAILABLE])),
  state('11e', 'Part 1 rejected, no retry', 'spenders', (ctx) => spendersState(ctx, [{ s: 'rejected', code: 'CG-SEND-REJECTED', detail: 'OnlyFans didn’t accept this action', canRetry: false }, AVAILABLE, AVAILABLE])),
  state('11f', '«Отправить» unavailable (CG-SEND-HOST)', 'spenders', (ctx) => spendersState(ctx, [{ s: 'unavailable', code: 'CG-SEND-HOST', reason: msg('send.reason.host') }, AVAILABLE, AVAILABLE])),
  state('11g', 'The fan wrote after the answer: the send is held', 'spenders', (ctx) => spendersState(ctx, [SENT, { s: 'held-stale', at: SENT_AT }, AVAILABLE], { fanWroteNew: true })),
  state('11h', 'Every «Отправить» state side by side', 'spenders', (ctx) => [
    entry({ of: 'spenders.board' }, boardOf(ctx, BOARD_FANS, { selected: HUBERT.key })),
    entry({ of: 'spenders.stats' }, statsOf(ctx)),
    entry({ of: 'preview', from: 'spenders' }, { ...hubertPreview(ctx, null), result: everySendState(ctx), idleHint: null, feed: { items: [], hasOlder: false, loadingOlder: false, olderError: null } }),
  ]),
  state('11i', 'Statistics expanded', 'spenders', (ctx) => [entry({ of: 'spenders.board' }, boardOf(ctx, BOARD_FANS)), entry({ of: 'spenders.stats' }, statsOf(ctx, true))]),
  state('11j', 'Part 1 rejected by the queue: «Отправить ещё раз»', 'spenders', (ctx) => spendersState(ctx, [{ s: 'rejected', code: 'CG-SEND-QUEUE', canRetry: true }, AVAILABLE, AVAILABLE])),
  // 13 — «Новые»
  state('13a', 'Hi ready: one variant, three parts', 'newcomers', (ctx) => newcomersState(ctx, 'a')),
  state('13b', 'Sent 1 of 3, part 2 in ChatSpace’s queue', 'newcomers', (ctx) => newcomersState(ctx, 'b')),
  state('13c', 'A colleague holds the fan: Hi is off', 'newcomers', (ctx) => newcomersState(ctx, 'c')),
  state('13d', 'Stopped on an unknown outcome', 'newcomers', (ctx) => newcomersState(ctx, 'd')),
  // 13 f–j — «Новые» on Fansly (R20 P10a): the background's pass, Fansly's own window
  fansly('13f', 'Fansly: the queue runs, the card of the first fan to write to', fanslyQueue),
  fansly('13g', 'Fansly: «Уже писали» — the proof folded, earlier messages to load', fanslyGreeted),
  fansly('13h', 'Fansly: the list was not read (FX-017)', fanslyListFailed),
  fansly('13i', 'Fansly: a pause Fansly asked for, a partial result, a fan nobody can write to', fanslyScanning),
  fansly('13j', 'Fansly: the fast part reads the followers', fanslyConnecting),
  fansly('13k', 'Fansly: the queue stands — «Проверить оставшихся», «Проверить чат» on a fan in the queue (R20 P10b1)', fanslyPaused),
  fansly('13l', 'Fansly: «Все», «Нельзя написать» — a fan taken out of the queue, «Вернуть в очередь» (R20 P10b2)', fanslyExcluded),
  fansly('13m', 'Fansly: the greeting generated and unchanged — «AI», «Отправить», «Открыть и вставить» (R20 P10c)', fanslyGreeting),
  fansly('13n', 'Fansly: the person’s greeting refused — the history changed after the review (R20 P10c)', fanslyGreetingRefused),
  // 14 — the fan panel
  state('14a', 'Fan panel: the fan', 'fan-panel', (ctx) => fanPanelState(ctx, 'a')),
  state('14b', 'Fan panel: Recap', 'fan-panel', (ctx) => fanPanelState(ctx, 'b')),
  state('14c', 'Fan panel: «Выберите чат»', 'fan-panel', (ctx) => fanPanelState(ctx, 'c')),
  // 15 — the palette
  state('15a', 'Palette: empty query', 'palette', (ctx) => paletteState(ctx, 'a')),
  state('15b', 'Palette: search', 'palette', (ctx) => paletteState(ctx, 'b')),
  // not drawn in the mockup (ui-design §10)
  state('quick-jump', 'Quick jump ⌘1–9', 'quick-jump', (ctx) => [entry({ of: 'quick-jump' }, quickJump(ctx, views.ready()))]),
  state('online-a', '«Онлайн» of the palette: the preview in its own window (X24)', 'preview', (ctx) => onlineState(ctx, null)),
  state('online-b', '«Онлайн» of the palette: Reply of three parts, «Отправить» on each (X24)', 'preview', (ctx) => onlineState(ctx, [AVAILABLE, AVAILABLE, AVAILABLE])),
  state('online-c', '«Онлайн» of the palette before the page’s first chat: «Отправить» says to open any chat (CG-SEND-HOST, contracts 1.10.0)', 'preview', (ctx) =>
    onlineState(ctx, [{ s: 'unavailable', code: 'CG-SEND-HOST', reason: msg('send.reason.hostNotYet') }, AVAILABLE, AVAILABLE]),
  ),
  state('board-list', 'The board without a preview', 'spenders', (ctx) => [entry({ of: 'spenders.board' }, boardOf(ctx, BOARD_FANS)), entry({ of: 'spenders.stats' }, statsOf(ctx))]),
  state('board-1000', 'A thousand fans: the virtual list', 'spenders', (ctx) => {
    const fans = manyFans(1000);
    return [
      entry({ of: 'spenders.board' }, boardOf(ctx, fans, { view: views.partial({ kind: 'truncated', shown: 1000, total: 1340 }), footer: { loaded: 1000, total: 1340, shown: null, stamp: { asOf: iso(ctx.now - 2 * MIN), coverage: 'partial' } } })),
      entry({ of: 'spenders.stats' }, statsOf(ctx)),
    ];
  }),
  state('board-error', 'The board failed, the statistics too', 'spenders', (ctx) => [
    entry({ of: 'spenders.board' }, board(ctx, views.error(cgError(ctx, 'CG-DATA-TIMEOUT', { detail: 'HTTP 504 • spenders v2' }), { type: 'ReloadView', selector: { of: 'spenders.board' } }))),
    entry({ of: 'spenders.stats' }, stats(ctx, views.error(cgError(ctx, 'CG-DATA-UNAVAILABLE', { detail: 'HTTP 503 • stats' }), { type: 'ReloadView', selector: { of: 'spenders.stats' } }))),
  ]),
  state('board-empty', 'Nothing after the filter', 'spenders', (ctx) => [
    entry(
      { of: 'spenders.board' },
      {
        ...boardOf(ctx, BOARD_FANS),
        view: views.empty(msg('spenders.empty')),
        shelves: [],
        query: 'zzz',
        footer: { loaded: 40, total: 40, shown: 0, stamp: { asOf: iso(ctx.now - 2 * MIN), coverage: 'complete' } },
        reset: button('spenders.filter.all', { type: 'ResetFilters', list: 'spenders' }),
      },
    ),
    entry({ of: 'spenders.stats' }, statsOf(ctx)),
  ]),
];

export function boardState(id: string): BoardState {
  const found = BOARD_STATES.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no board state "${id}"`);
  return found;
}

/** A gallery state as an AppClient scenario in `language` (ru on macOS labels, en on Windows ones). */
export function boardScenario(id: string, language: Locale = 'ru'): AppClientScenario {
  const item = boardState(id);
  const ctx = ctxOf({ lang: language, platform: language === 'en' ? 'win' : 'mac' });
  return {
    id: `boards-${item.id}`,
    title: item.title,
    covers: ['state-gallery', language, 'theme-light', 'debug-off'],
    language,
    platform: ctx.platform,
    scheme: 'light',
    theme: 'host',
    debug: false,
    now: NOW,
    views: item.views(ctx),
  };
}

export const PERSONA_LABEL = PERSONA.label;
