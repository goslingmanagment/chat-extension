// Recap, Coach (and a Review as its turn), the fan panel, the palette, quick
// jump, the cheatsheet and toasts for the scenarios.

import {
  DOCK_ACTION_IDS,
  VOICE_LIMITS,
  VOICE_TONES,
  type CheatsheetVM,
  type CoachTurnVM,
  type CoachVM,
  type FanPanelVM,
  type GreetArrivedState,
  type HubSaveVM,
  type Msg,
  type PaletteItemVM,
  type PaletteVM,
  type QuickJumpVM,
  type RecapLength,
  type RecapPickerVM,
  type RecapViewVM,
  type ToastVM,
  type ToastsVM,
  type VmView,
  type VoiceTakeVM,
  type VoiceVM,
} from '@cg/contracts';

import { button, DAY, FANS, handles, hotkey, iso, MIN, msg, openChat, PERSONA, reason, usd, uuid, type ScenarioCtx } from './base';
import { parts } from './results';
import { stamp } from './lists';

// ── Recap ──

const saved = (ctx: ScenarioCtx): HubSaveVM => ({ s: 'saved', at: iso(ctx.now - DAY) });

export function recapPicker(ctx: ScenarioCtx, view: VmView, patch: Partial<RecapPickerVM> = {}): RecapPickerVM {
  const slot = (length: RecapLength) => ({
    length,
    generatedAt: iso(ctx.now - DAY),
    stamp: stamp(ctx),
    saved: length === 'full' ? saved(ctx) : ({ s: 'not-applicable' } as const),
    open: button('recap.openLast', { type: 'ShowRecap', length }),
  });
  const hasSlots = view.s === 'ready' || view.s === 'partial' || view.s === 'offline';
  return {
    view,
    targetName: FANS.hubert.name,
    slots: { short: hasSlots ? slot('short') : null, full: hasSlots && view.s !== 'partial' ? slot('full') : null },
    build: {
      short: button('recap.short', { type: 'Generate', targetHandle: handles.dock(FANS.hubert), feature: 'recap-short', options: {} }),
      full: button('recap.full', { type: 'Generate', targetHandle: handles.dock(FANS.hubert), feature: 'recap', options: {} }),
    },
    splitReason: reason('not-a-message'),
    ...patch,
  };
}

const RECAP_SHORT = 'Hubert, 34, Warsaw. Buys sets after a warm build-up, tips when teased about his weekend. Today he wrote first and is waiting.';
const RECAP_BLOCKS = [
  { heading: 'Кто он', markdown: 'Hubert, 34, Warsaw. Works shifts, writes in the evening.' },
  { heading: 'Что любит', markdown: 'Warm build-up, photos from the weekend, being asked about his day.' },
  { heading: 'Покупки', markdown: '**$12,480** lifetime; sets of 4 photos at $30 sell best.' },
  { heading: 'Чего избегать', markdown: 'Pushy upsells right after a tip.' },
  { heading: 'Сейчас', markdown: 'Wrote 7 minutes ago: «are you there?»' },
];

export function recapView(ctx: ScenarioCtx, view: VmView, length: RecapLength, patch: Partial<RecapViewVM> = {}): RecapViewVM {
  const hasText = view.s === 'ready' || view.s === 'partial' || view.s === 'offline';
  return {
    view,
    length,
    lengths: { short: true, full: true },
    targetName: FANS.hubert.name,
    opId: null,
    state: null,
    phase: null,
    streamText: null,
    markdown: hasText ? (length === 'short' ? RECAP_SHORT : RECAP_BLOCKS.map((b) => `## ${b.heading}\n${b.markdown}`).join('\n\n')) : null,
    blocks: hasText && length === 'full' ? RECAP_BLOCKS : null,
    generatedAt: hasText ? iso(ctx.now - DAY) : null,
    saved: hasText && length === 'full' ? saved(ctx) : { s: 'not-applicable' },
    stamp: { ...stamp(ctx, view.s === 'partial' ? 'partial' : 'complete'), served: hasText ? (length === 'short' ? 300 : 90) : null },
    archiveLag: view.s === 'partial' ? { messages: 2 } : null,
    refreshFailed: null,
    copyHandle: hasText ? handles.artifact('recap', 1) : null,
    refresh: button('recap.refresh', { type: 'RefreshRecap', length }, { hotkey: hotkey(ctx, 'recap') }),
    splitReason: reason('not-a-message'),
    expanded: false,
    debug: null,
    ...patch,
  };
}

// ── Coach ──

export function coachTurn(ctx: ScenarioCtx, n: number, patch: Partial<CoachTurnVM> = {}): CoachTurnVM {
  const opId = uuid(400 + n);
  return {
    id: `turn-${n}`,
    opId,
    question: n === 1 ? 'Как вернуть его к покупкам?' : 'А если он спросит про скидку?',
    askedAt: ctx.now - (10 - n) * MIN,
    state: 'done',
    phase: null,
    sentToCoach: false,
    streamText: null,
    attachedDraft: false,
    outsideMemory: false,
    answer: {
      prose: 'He responds to warmth first. Ask about his weekend, then offer the new set.',
      blocks: null,
      drafts: [{ index: 0, label: msg('coach.draft', { n: 1 }), parts: parts(opId, ['Hey you, how was the weekend?', 'I saved something new for you']), note: null }],
    },
    error: null,
    errorActions: [],
    ...patch,
  };
}

/**
 * 1.51.0: a Review as a turn of Coach's dialog — the question line «Review», its card the answer; «Ещё раз» rates anew
 * as the next turn.
 */
export function coachReviewTurn(ctx: ScenarioCtx, n: number, patch: Partial<CoachTurnVM> = {}): CoachTurnVM {
  const opId = uuid(400 + n);
  return {
    feature: 'review',
    id: `turn-${n}`,
    opId,
    question: 'Review',
    askedAt: ctx.now - (10 - n) * MIN,
    state: 'done',
    phase: null,
    sentToCoach: false,
    streamText: null,
    attachedDraft: false,
    outsideMemory: false,
    answer: null,
    review: {
      rating: 7,
      lead: null,
      sections: [
        { kind: 'verdict', title: msg('review.section.verdict'), body: 'Warm and consistent; the upsell came too early.', items: [] },
        { kind: 'money', title: msg('review.section.money'), body: '$30 set bought after the tip; one offer left on the table.', items: [] },
        { kind: 'persona', title: msg('review.section.persona'), body: 'Voice matches Лора: playful, short sentences.', items: [] },
        {
          kind: 'mistakes',
          title: msg('review.section.mistakes'),
          body: '',
          items: [
            { body: 'The set was offered right after his tip.', example: 'Missed you today — want to see what I saved for you?', exampleWhere: 'after "[Photo]"', afterExample: null },
            { body: 'His question about the weekend went unanswered.', example: null, exampleWhere: null, afterExample: null },
          ],
        },
        { kind: 'works', title: msg('review.section.works'), body: 'Short warm questions about his day.', items: [] },
        { kind: 'recommendations', title: msg('review.section.recommendations'), body: 'Ask about his weekend before the next offer.', items: [] },
      ],
      raw: 'Rating: 7/10 …',
      unparsed: false,
      copyHandle: handles.artifact('review', n),
      generatedAt: iso(ctx.now - 5 * MIN),
      partial: false,
    },
    error: null,
    errorActions: [],
    again: button('common.again', { type: 'Regenerate', operationId: opId }),
    ...patch,
  };
}

/** The empty dialog's headings and their questions (core coach/controller.ts HINT_GROUPS), with the Russian text a click puts into the field. */
const COACH_HINTS = [
  {
    label: 'coach.group.sell',
    questions: [
      ['coach.hint.sell.how', 'Не знаю, как продать, подскажи'],
      ['coach.hint.sell.price', 'Как подать цену, чтобы не спугнуть?'],
      ['coach.hint.sell.discount', 'Просит скидку: что ответить?'],
    ],
  },
  {
    label: 'coach.group.return',
    questions: [
      ['coach.hint.return.revive', 'Как оживить остывший чат?'],
      ['coach.hint.return.seen', 'Прочитал и молчит: что написать?'],
      ['coach.hint.return.afterPrice', 'Пропал после цены: как вернуть?'],
    ],
  },
  {
    label: 'coach.group.understand',
    questions: [
      ['coach.hint.understand.likes', 'Что этому фану реально заходит?'],
      ['coach.hint.understand.person', 'Разбери его: что за человек?'],
      ['coach.hint.understand.topics', 'О чём говорить, кроме продаж?'],
    ],
  },
] as const;

export function coach(ctx: ScenarioCtx, view: VmView, turns: readonly CoachTurnVM[], patch: Partial<CoachVM> = {}): CoachVM {
  return {
    view,
    targetName: FANS.hubert.name,
    freshness: {
      asOf: iso(ctx.now),
      lag: view.s === 'partial' ? { messages: 2 } : null,
      refresh: button('coach.refresh', { type: 'RefreshArchive', targetHandle: handles.dock(FANS.hubert) }),
    },
    recaps: turns.length > 0 ? [{ length: 'short', generatedAt: iso(ctx.now - DAY), summary: RECAP_SHORT }] : [],
    autoRecapNext: null,
    window: 100,
    turns,
    historyLimit: 10,
    chips: [
      { label: msg('coach.chip.situation'), question: 'Что сейчас происходит в чате?', preset: 'situation' },
      { label: msg('coach.chip.offer'), question: 'Что ему предложить?', preset: null },
    ],
    ask: { enabled: true, reason: null, attachDraft: { available: true, reason: null } },
    newDialog: button('coach.newDialog', { type: 'NewCoachDialog' }),
    // AI-081: the empty dialog's three headings of questions that fill the field, as the controller gives them.
    hints: turns.length > 0 ? [] : COACH_HINTS.map((group) => ({ label: msg(group.label), questions: group.questions.map(([key, question]) => ({ label: msg(key), question })) })),
    // 1.51.0: «Review» by the ready questions.
    review: button('coach.chip.review', { type: 'Generate', targetHandle: handles.dock(FANS.hubert), feature: 'review', options: {} }, { hotkey: hotkey(ctx, 'review') }),
    ...patch,
  };
}

// ── fan panel ──

export function fanPanel(ctx: ScenarioCtx, view: VmView, patch: Partial<FanPanelVM> = {}): FanPanelVM {
  const hasData = view.s === 'ready' || view.s === 'partial' || view.s === 'offline';
  const fan = FANS.hubert;
  return {
    view,
    tab: 'fan',
    personaLabel: PERSONA.label,
    fan: hasData ? { name: fan.name, username: fan.username, initials: 'H', lastSeenAt: iso(ctx.now - 6 * MIN), online: true } : null,
    spent: hasData
      ? {
          total: usd(12_480),
          period30: usd(320),
          byKind: [
            { kind: 'messages', mills: usd(9_860) },
            { kind: 'tips', mills: usd(2_140) },
            { kind: 'subscription', mills: usd(480) },
          ],
        }
      : null,
    subscription: hasData ? { months: 18, since: '2024-03-14T00:00:00Z', autoRenew: true, churnRisk: view.s === 'partial' ? null : 'low' } : null,
    host: hasData && view.s !== 'partial' ? { buyingPower: 'High', scores: [{ label: 'Engagement', value: '8/10' }] } : null,
    bio: hasData ? 'Weekend hiker, likes long messages.' : null,
    lists: hasData ? ['VIP', 'Tippers'] : [],
    footer: { stamp: stamp(ctx, view.s === 'partial' ? 'partial' : 'complete'), archiveMessages: hasData ? 412 : null },
    close: { type: 'Navigate', to: { kind: 'surface', surface: 'fan-panel', open: false } },
    ...patch,
  };
}

// ── Voice (1.47.0) ──

/** The fake hub's synthetic voice script (fake-hub/ai.ts): what its takes speak (fake-hub/voice-audio.ts). */
const VOICE_SCRIPT = '[warmly] Hey you, it is lovely to hear from you.';

/** Hubert's voice studio: the script and a ready take of it where the view has content, written while it loads. */
export function voiceStudio(ctx: ScenarioCtx, view: VmView, patch: Partial<VoiceVM> = {}): VoiceVM {
  const target = handles.dock(FANS.hubert);
  const hasScript = view.s === 'ready' || view.s === 'partial' || view.s === 'offline';
  const chars = VOICE_SCRIPT.length;
  const take: VoiceTakeVM = {
    takeId: uuid(501),
    n: 1,
    state: 'ready',
    startedAt: ctx.now - 2 * MIN,
    slow: false,
    stale: false,
    audio: null,
    loading: false,
    attached: null,
    error: null,
    charged: true,
    check: null,
  };
  return {
    view,
    open: true,
    targetHandle: target,
    fanName: FANS.hubert.name,
    stage: hasScript ? 'ready' : view.s === 'loading' ? 'writing' : view.s === 'empty' ? 'empty' : 'failed',
    source: 'hey, i missed you — what were you up to today?',
    tone: 'warm',
    tones: VOICE_TONES,
    toneReason: view.s === 'loading' ? reason('voice-writing') : null,
    script: hasScript ? { text: VOICE_SCRIPT, streaming: false, edited: false, chars, max: VOICE_LIMITS.scriptChars, seconds: Math.ceil(chars / VOICE_LIMITS.charsPerSecond), issue: null } : null,
    takes: hasScript ? [take] : [],
    selected: hasScript ? take.takeId : null,
    error: null,
    primary: hasScript ? button(msg('voice.attach', { name: FANS.hubert.name }), { type: 'AttachVoiceTake', targetHandle: target, takeId: take.takeId }) : null,
    secondary: hasScript ? button(msg('voice.makeAgain', { chars }), { type: 'MakeVoiceTake', targetHandle: target }) : null,
    restart: hasScript ? button('voice.restart', { type: 'NewVoice', targetHandle: target }) : null,
    again: null,
    confirm: null,
    attach: null,
    // 1.49.0: what the page may still voice today, above the buttons (the next UTC midnight renews it).
    allowance: hasScript ? { state: 'left', remaining: 4_640, resetsAt: iso((Math.floor(ctx.now / DAY) + 1) * DAY) } : null,
    ...patch,
  };
}

// ── palette, quick jump, cheatsheet ──

const item = (id: string, label: string | Msg, action: PaletteItemVM['action'], patch: Partial<PaletteItemVM> = {}): PaletteItemVM => ({
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

export function palette(ctx: ScenarioCtx, view: VmView, patch: Partial<PaletteVM> = {}): PaletteVM {
  const has = view.s === 'ready' || view.s === 'partial' || view.s === 'offline';
  return {
    view,
    query: '',
    groups: has
      ? [
          {
            id: 'actions',
            title: msg('palette.group.actions', { name: FANS.hubert.name }),
            items: [
              item('reply', 'Reply', { type: 'Generate', targetHandle: handles.dock(FANS.hubert), feature: 'reply', options: {} }, { hotkey: hotkey(ctx, 'reply') }),
              item('spenders', 'Spenders', { type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } }, { hotkey: hotkey(ctx, 'spenders') }),
              item('settings', msg('palette.item.settings'), { type: 'OpenSettings', route: { section: 'status' } }),
            ],
          },
          {
            id: 'running',
            title: msg('palette.group.running'),
            items: [item('run-1', 'Reply', openChat(FANS.theodore), { sublabel: FANS.theodore.name, runningSince: ctx.now - 14_000 })],
          },
          ...(view.s === 'partial'
            ? []
            : [
                {
                  id: 'waiting' as const,
                  title: msg('palette.group.waiting'),
                  items: [item('w-1', FANS.hubert.name, openChat(FANS.hubert), { sublabel: `@${FANS.hubert.username}`, money: usd(12_480), waitingSince: iso(ctx.now - 7 * MIN) })],
                },
              ]),
        ]
      : [],
    footer: has ? msg('palette.foot.chats', { n: 43 }) : null,
    ...patch,
  };
}

export function quickJump(ctx: ScenarioCtx, view: VmView): QuickJumpVM {
  const fans = view.s === 'ready' ? [FANS.hubert, FANS.theodore, FANS.marco] : view.s === 'partial' ? [FANS.hubert] : [];
  return {
    view,
    items: fans.map((fan, i) => ({ slot: i + 1, name: fan.name, username: fan.username, unread: i === 0 ? 2 : null, action: { type: 'Navigate', to: { kind: 'chat-slot', slot: i + 1 } } })),
  };
}

export function cheatsheet(ctx: ScenarioCtx, view: VmView): CheatsheetVM {
  const has = view.s === 'ready' || view.s === 'partial';
  return {
    view,
    platform: ctx.platform,
    groups: has
      ? [
          { id: 'ai', title: msg('cheatsheet.group.ai'), rows: DOCK_ACTION_IDS.map((id) => ({ label: msg(`dock.action.${id}`), hotkey: hotkey(ctx, id), note: null })) },
          {
            id: 'windows',
            title: msg('cheatsheet.group.windows'),
            rows: [
              { label: msg('cheatsheet.row.palette'), hotkey: hotkey(ctx, 'palette'), note: null },
              { label: msg('cheatsheet.row.spenders'), hotkey: hotkey(ctx, 'spenders'), note: null },
              { label: msg('cheatsheet.row.nextUnread'), hotkey: hotkey(ctx, 'nextUnread'), note: view.s === 'partial' ? msg('dock.reason.hotkeyReserved') : null },
              { label: msg('cheatsheet.row.help'), hotkey: hotkey(ctx, 'help'), note: msg('dock.helpRemoved') },
              { label: msg('send.button'), hotkey: null, note: msg('cheatsheet.row.sendNote') },
            ],
          },
        ]
      : [],
    note: msg('cheatsheet.note'),
  };
}

// ── toasts ──

export function toast(ctx: ScenarioCtx, id: string, kind: ToastVM['kind'], patch: Partial<ToastVM> = {}): ToastVM {
  return { id, kind, code: null, title: '', body: null, actions: [], copyCode: false, expiresAt: ctx.now + (kind === 'error' ? 6_500 : 4_500), ...patch };
}

export function toasts(view: VmView, list: readonly ToastVM[]): ToastsVM {
  return { view, toasts: list };
}

/**
 * A greeting reminder (1.61.0): the fan as a card — picture, name, «@handle · N мин назад» — with «Hi» and «Позже».
 * 1.69.0: `away` — the toast stands in a tab of another page: its label on the ear, «Hi в {page}» and the line under it.
 */
export const greetToast = (
  ctx: ScenarioCtx,
  id: string,
  fan: { readonly name: string; readonly handle: string | null; readonly avatarUrl: string | null; readonly minutesAgo: number; readonly away?: string; readonly urgent?: true },
): ToastVM =>
  toast(ctx, id, 'info', {
    title: ctx.lang === 'ru' ? `Ждёт приветствия · ${fan.name}` : `Waiting for a greeting · ${fan.name}`,
    actions: [
      button(fan.away === undefined ? 'dock.action.hi' : { key: 'toast.greetHiAt', params: { page: fan.away } }, { type: 'GreetNewcomer', targetHandle: 'newcomers:11:910000000000000001' }),
      button('toast.later', { type: 'DismissToast', toastId: id }),
    ],
    expiresAt: null,
    greet: {
      name: fan.name,
      handle: fan.handle,
      avatarUrl: fan.avatarUrl,
      since: new Date(ctx.now - fan.minutesAgo * 60_000).toISOString(),
      ...(fan.away === undefined ? {} : { away: fan.away }),
      ...(fan.urgent === undefined ? {} : { urgent: true }),
    },
  });

/** 1.69.0: the card a reminder's «Hi» pressed in another page's tab brought into this one: where, how its Hi goes, «Назад». */
export const arrivedToast = (
  ctx: ScenarioCtx,
  id: string,
  fan: { readonly name: string; readonly avatarUrl: string | null; readonly page: string; readonly from: string; readonly s: GreetArrivedState | null },
): ToastVM =>
  toast(ctx, id, 'info', {
    title: ctx.lang === 'ru' ? `Вы во вкладке ${fan.page}` : `You are in the ${fan.page} tab`,
    actions: [button({ key: 'toast.greetBack', params: { page: fan.from } }, { type: 'GreetBack', toastId: id })],
    expiresAt: null,
    greet: { name: fan.name, handle: null, avatarUrl: fan.avatarUrl, since: null, arrived: { page: fan.page, from: fan.from, s: fan.s } },
  });

export const aiReadyToast = (ctx: ScenarioCtx, fanName: string, chatHandle: string): ToastVM =>
  toast(ctx, 'toast-ai-ready', 'success', {
    title: ctx.lang === 'ru' ? `AI готово · ${fanName}` : `AI ready · ${fanName}`,
    actions: [button('common.openChat', { type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle } })],
  });
