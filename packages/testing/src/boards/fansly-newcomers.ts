// «Новые» on Fansly in the boards gallery and its tests (R20 P10a; ui-design §3.12): the shared `NewcomersVM` with its
// `pass`, as the pass controller builds it over Fansly's background module — a queue running with the card of the
// first fan to write to, a fan written to already with the proof and a long conversation, the list that was not read
// (FX-017), and the fast part still reading profiles with a pause Fansly asked for and a fan nobody can write to — «Исключить
// из очереди» —, and one the person took out of the queue — «Вернуть в очередь» (R20 P10b2).
// Synthetic people and ids only.

import {
  NEWCOMER_CHECK_FILTERS,
  type NewcomerCardVM,
  type NewcomerCheck,
  type NewcomerCheckFilter,
  type NewcomerDmClosed,
  type NewcomerMessageVM,
  type NewcomerRowVM,
  type NewcomersFailureVM,
  type NewcomersPassVM,
  type NewcomersTab,
  type NewcomersVM,
} from '@cg/contracts';
import { withFanslyNewcomersTexts } from '@cg/core/domain/hosts/fansly/i18n/newcomers';
import { inPassTab, passesCheckFilter } from '@cg/core/domain/newcomers/pass';
import { type SurfaceDefinition } from '@cg/ui/kit';
import { fanslyNewcomersSurface } from '@cg/ui/hosts/fansly/newcomers';

import { cgError, entry, iso, MIN, msg, PERSONA, views, type ScenarioCtx, type ScenarioViewEntry } from '../scenarios/app-client';

/** Fansly's own surface for `newcomers`, as its chunk mounts it (lazy/fansly/newcomers.ts): its words laid over the tab's. */
export const FANSLY_NEWCOMERS_SURFACE: SurfaceDefinition = fanslyNewcomersSurface(withFanslyNewcomersTexts);

const PASS_ID = '00000000-0000-4000-8000-000000000301';
const ORIGIN = 'https://fansly.com';
const HOUR = 60 * MIN;

interface Follower {
  readonly n: number;
  readonly name: string;
  readonly username: string;
  readonly check: NewcomerCheck;
  readonly minutesAgo: number;
  readonly customName?: string;
  readonly dmClosed?: NewcomerDmClosed;
  readonly bio?: string;
  readonly failure?: NewcomersFailureVM;
  readonly group?: boolean;
}

const FOLLOWERS: readonly Follower[] = [
  { n: 1, name: 'Tomasz W.', username: 'tomasz_w', check: 'ready', minutesAgo: 14, bio: 'Warsaw · photographer · here for the art 📷' },
  { n: 2, name: 'Leo', username: 'leo.k', check: 'reply', minutesAgo: 41 },
  { n: 3, name: 'Jake', username: 'jake88', check: 'pending', minutesAgo: 2 * 60, group: false },
  { n: 4, name: 'Marco R.', username: 'marco_r', check: 'checking', minutesAgo: 3 * 60, group: false },
  { n: 5, name: 'Daniel', username: 'dan_p', check: 'dm-closed', dmClosed: 'paid', minutesAgo: 5 * 60, bio: 'Only paid DMs, sorry' },
  { n: 6, name: 'Ryan T.', username: 'ryan_t', check: 'failed', minutesAgo: 7 * 60, failure: { code: 'CG-FAN-REQUEST', retryAt: null }, group: false },
  { n: 7, name: 'Chris', username: 'chris_77', check: 'unverified', minutesAgo: 9 * 60 },
  { n: 8, name: 'Alex M.', username: 'alex_m', check: 'ready', minutesAgo: 11 * 60, customName: 'Алекс из Бостона' },
  { n: 9, name: 'Sam', username: 'sammy', check: 'greeted', minutesAgo: 20 * 60 },
  { n: 10, name: 'Ben', username: 'ben_w', check: 'excluded', dmClosed: 'permissions', minutesAgo: 30 * 60 },
];

const fanRef = (n: number): string => String(800000000000000000n + BigInt(n));
const groupOf = (n: number): string => String(900000000000000000n + BigInt(n));
const handleOf = (n: number): string => `pass:${PASS_ID}:${fanRef(n)}`;

function rowOf(ctx: ScenarioCtx, follower: Follower, selected: boolean): NewcomerRowVM {
  return {
    handle: handleOf(follower.n),
    name: follower.name,
    username: follower.username,
    kind: 'new',
    subscribedAt: iso(ctx.now - follower.minutesAgo * MIN),
    greeting: follower.check === 'greeted' ? { s: 'greeted', at: null } : { s: 'none' },
    hasDraft: false,
    draftStale: false,
    selected,
    check: { status: follower.check, customName: follower.customName ?? null, dmClosed: follower.dmClosed ?? null },
  };
}

const message = (ctx: ScenarioCtx, id: number, minutesAgo: number, fromFan: boolean, text: string, automated = false, attachments = 0): NewcomerMessageVM => ({
  // Our own ids: the gallery carries no number that could be a real one (gallery.test.ts).
  id: `msg-${id}`,
  fromFan,
  at: iso(ctx.now - minutesAgo * MIN),
  text,
  automated,
  attachments,
});

/** The conversation of a fan written to already: a welcome, the fan, the model — more of it before, 750 at most. */
function longChat(ctx: ScenarioCtx, start: number): NewcomerMessageVM[] {
  const lines: readonly [boolean, string][] = [
    [true, 'hey gorgeous, just found your page 😍'],
    [false, 'hiii Sam! welcome 💕 what made you subscribe?'],
    [true, 'your beach set honestly. any more like that?'],
    [false, 'maybe 😏 I have a whole album from Bali, want a peek?'],
    [true, 'yes please'],
    [false, 'sending you something special tonight then 🌴'],
  ];
  return lines.map(([fromFan, text], index) => message(ctx, start + index, 20 * 60 - 30 - index * 7, fromFan, text));
}

interface CardOptions {
  readonly history: NewcomerCardVM['history'];
  readonly proof?: NewcomerMessageVM;
}

function cardOf(ctx: ScenarioCtx, follower: Follower, options: CardOptions): NewcomerCardVM {
  return {
    handle: handleOf(follower.n),
    name: follower.name,
    username: follower.username,
    customName: follower.customName ?? null,
    followedAt: iso(ctx.now - follower.minutesAgo * MIN),
    checkedAt: follower.check === 'pending' || follower.check === 'checking' ? null : iso(ctx.now - 3 * MIN),
    bio: follower.bio ?? null,
    check: follower.check,
    dmClosed: follower.dmClosed ?? null,
    failure: follower.failure ?? null,
    proof: options.proof ?? null,
    history: options.history,
    openHref: follower.group === false ? null : `${ORIGIN}/messages/${groupOf(follower.n)}`,
  };
}

const history = (s: NewcomerCardVM['history']['s'], messages: NewcomerMessageVM[] = [], patch: Partial<NewcomerCardVM['history']> = {}): NewcomerCardVM['history'] => ({
  s,
  messages,
  more: false,
  loadingMore: false,
  capped: false,
  cap: 750,
  failure: null,
  ...patch,
});

interface PassOptions {
  readonly stage: NewcomersPassVM['stage'];
  readonly phase?: NewcomersPassVM['phase'];
  readonly tab?: NewcomersTab;
  readonly filter?: NewcomerCheckFilter;
  readonly selected: number | null;
  readonly card: NewcomerCardVM | null;
  readonly partial?: boolean;
  readonly cooldownUntil?: number | null;
  readonly failure?: NewcomersFailureVM | null;
  readonly followers?: readonly Follower[];
  readonly windowHours?: number;
}

/** The model as the pass controller builds it (core application/newcomers/pass.ts). */
export function fanslyNewcomersVM(ctx: ScenarioCtx, options: PassOptions): NewcomersVM {
  const followers = options.stage === 'failed' ? [] : (options.followers ?? FOLLOWERS);
  const tab = options.tab ?? 'todo';
  const filter = options.filter ?? 'any';
  const inTab = followers.filter((follower) => inPassTab(follower.check, tab));
  const visible = inTab.filter((follower) => passesCheckFilter(follower.check, filter));
  const windowHours = options.windowHours ?? 48;
  const startedAt = ctx.now - 4 * MIN;
  const checked = followers.filter((follower) => follower.check !== 'pending' && follower.check !== 'checking').length;
  const live = options.stage !== 'failed' && options.stage !== 'connecting';
  // R20 P10b1 (NF-038): the queue's buttons as the controller gives them.
  const running = options.stage === 'queue' || options.stage === 'cooldown' || (options.stage === 'scanning' && (options.phase === 'profiles' || options.phase === 'checking'));
  const remaining = followers.length - checked;
  const checkable = (check: NewcomerCheck): boolean => check === 'pending' || check === 'failed' || check === 'unverified';
  const checkNext = options.card === null || !checkable(options.card.check) ? null : running || options.stage === 'scanning' ? ('next' as const) : options.stage === 'paused' || options.stage === 'done' ? ('now' as const) : null;
  const pass: NewcomersPassVM = {
    creator: 'lora_vie',
    stage: options.stage,
    phase: options.phase ?? null,
    checked: live ? checked : null,
    total: live ? followers.length : null,
    range: options.stage === 'failed' ? null : { from: iso(startedAt - windowHours * HOUR), to: iso(startedAt) },
    cooldownUntil: options.cooldownUntil ?? null,
    filters: NEWCOMER_CHECK_FILTERS.map((id) => ({ id, count: live ? inTab.filter((follower) => passesCheckFilter(follower.check, id)).length : null, pressed: id === filter })),
    failure: options.failure ?? null,
    // R20 P10b2 (FS-NEW-2): a fan nobody can write to leaves «К обработке» by hand, and comes back.
    card: options.card === null ? null : { ...options.card, checkNext, exclude: options.card.check === 'dm-closed' ? 'exclude' : options.card.check === 'excluded' ? 'restore' : null },
    ...(live ? { run: { pause: running, resume: !running && options.stage !== 'scanning' && remaining > 0, remaining, busy: false } } : {}),
  };
  const view =
    options.stage === 'failed'
      ? views.error(cgError(ctx, 'CG-DATA-UNAVAILABLE'), { type: 'ReloadView', selector: { of: 'newcomers' } })
      : options.partial === true
        ? views.partial({ kind: 'coverage', level: 'partial' })
        : views.ready();
  return {
    view,
    pageName: PERSONA.pageName,
    personaLabel: null,
    tab,
    tabs: (['todo', 'all'] as const).map((id) => ({ id, label: msg(id === 'todo' ? 'newcomers.tab.todo' : 'newcomers.tab.all'), count: live ? followers.filter((follower) => inPassTab(follower.check, id)).length : null })),
    windowHours,
    windowOptions: [1, 3, 6, 12, 24, 48, 72, 168, 336, 720],
    filters: [],
    query: '',
    rows: visible.map((follower) => rowOf(ctx, follower, follower.n === options.selected)),
    cardOpen: options.card !== null,
    scan: options.stage === 'scanning' || options.stage === 'queue' ? { stage: msg('common.loading'), done: checked, total: followers.length } : null,
    incomplete: options.partial === true ? msg('newcomers.incomplete.body') : null,
    footer: { count: followers.length, stamp: { asOf: iso(startedAt), coverage: options.partial === true ? 'partial' : 'complete' } },
    canLoadMore: false,
    hint: msg('newcomers.hint', { window: '48 часов' }),
    noAutoSend: msg('newcomers.noAutoSend'),
    pass,
  };
}

const follower = (n: number): Follower => {
  const found = FOLLOWERS.find((item) => item.n === n);
  if (found === undefined) throw new Error(`no follower ${n}`);
  return found;
};

/** `a` — the queue runs; the card of the first fan to write to: a welcome of the creator's automation, nothing personal. */
export function fanslyQueue(ctx: ScenarioCtx): ScenarioViewEntry[] {
  const tomasz = follower(1);
  const welcome = message(ctx, 1, 13, false, 'Thanks for following, babe 💋 Check my free posts and say hi anytime!', true);
  const card = cardOf(ctx, tomasz, { history: history('ready', [welcome]) });
  return [entry({ of: 'newcomers' }, fanslyNewcomersVM(ctx, { stage: 'queue', selected: 1, card }))];
}

/** `b` — «Все», «Уже писали»: the proof folded, a conversation with earlier messages to load. */
export function fanslyGreeted(ctx: ScenarioCtx): ScenarioViewEntry[] {
  const sam = follower(9);
  const chat = longChat(ctx, 10);
  const proof = chat[1] as NewcomerMessageVM;
  const card = cardOf(ctx, sam, { proof, history: history('ready', chat, { more: true }) });
  return [entry({ of: 'newcomers' }, fanslyNewcomersVM(ctx, { stage: 'done', tab: 'all', filter: 'contacted', selected: 9, card }))];
}

/** `c` — FX-017: the list was not read; never «nobody new». */
export function fanslyListFailed(ctx: ScenarioCtx): ScenarioViewEntry[] {
  return [entry({ of: 'newcomers' }, fanslyNewcomersVM(ctx, { stage: 'failed', selected: null, card: null, failure: { code: 'CG-FAN-SESSION', retryAt: null } }))];
}

/** `d` — the fast part reads profiles, Fansly asked for a pause, the result is partial; the card of a fan nobody can write to. */
export function fanslyScanning(ctx: ScenarioCtx): ScenarioViewEntry[] {
  const daniel = follower(5);
  const card = cardOf(ctx, daniel, { history: history('ready', [message(ctx, 30, 290, false, 'Thanks for following, babe 💋 Check my free posts and say hi anytime!', true)]) });
  return [
    entry(
      { of: 'newcomers' },
      fanslyNewcomersVM(ctx, { stage: 'cooldown', phase: null, selected: 5, card, partial: true, cooldownUntil: ctx.now + 45_000 }),
    ),
  ];
}

/** `k` — R20 P10b1: the queue stands (the person's «Пауза»): «Проверить оставшихся: N»; the card of a fan in the queue — «Проверить чат». */
export function fanslyPaused(ctx: ScenarioCtx): ScenarioViewEntry[] {
  const jake = follower(3);
  const card = cardOf(ctx, jake, { history: history('unchecked', []) });
  return [entry({ of: 'newcomers' }, fanslyNewcomersVM(ctx, { stage: 'paused', selected: 3, card }))];
}

/** `l` — R20 P10b2 (FS-NEW-2): «Все», «Нельзя написать»: a fan the person took out of the queue — «Вернуть в очередь». */
export function fanslyExcluded(ctx: ScenarioCtx): ScenarioViewEntry[] {
  const ben = follower(10);
  const card = cardOf(ctx, ben, { history: history('ready', [message(ctx, 31, 30 * 60 - 1, false, 'Thanks for following, babe 💋 Check my free posts and say hi anytime!', true)]) });
  return [entry({ of: 'newcomers' }, fanslyNewcomersVM(ctx, { stage: 'paused', tab: 'all', filter: 'dm-closed', selected: 10, card }))];
}

/** `e` — the first page is on its way: the stage of the fast part, nothing to show yet. */
export function fanslyConnecting(ctx: ScenarioCtx): ScenarioViewEntry[] {
  const vm = fanslyNewcomersVM(ctx, { stage: 'scanning', phase: 'followers', selected: null, card: null, followers: [] });
  const pass = vm.pass as NewcomersPassVM;
  // Before the first page: the counts are unknown, not 0.
  const unknown = { ...vm, tabs: vm.tabs.map((tab) => ({ ...tab, count: null })), view: views.loading(null, msg('common.loading')) };
  return [entry({ of: 'newcomers' }, { ...unknown, pass: { ...pass, checked: null, total: null, filters: pass.filters.map((filter) => ({ ...filter, count: null })) } })];
}
