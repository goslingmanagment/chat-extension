// Recap, Review, Coach, the fan panel, the palette, quick jump, the
// cheatsheet and toasts for the scenarios.

import {
  DOCK_ACTION_IDS,
  type CheatsheetVM,
  type CoachTurnVM,
  type CoachVM,
  type FanPanelVM,
  type HubSaveVM,
  type Msg,
  type PaletteItemVM,
  type PaletteVM,
  type QuickJumpVM,
  type RecapLength,
  type RecapPickerVM,
  type RecapViewVM,
  type ReviewVM,
  type ToastVM,
  type ToastsVM,
  type VmView,
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

// ── Review ──

export function review(ctx: ScenarioCtx, view: VmView, patch: Partial<ReviewVM> = {}): ReviewVM {
  const hasText = view.s === 'ready' || view.s === 'partial' || view.s === 'offline';
  return {
    view,
    opId: hasText ? uuid(301) : null,
    state: hasText ? 'done' : null,
    phase: null,
    streamText: null,
    rating: hasText ? 7 : null,
    window: hasText ? { messages: 40 } : null,
    targetName: FANS.hubert.name,
    meta: [msg('review.meta', { n: 40, name: FANS.hubert.name })],
    lead: hasText ? 'Warm and consistent; the upsell came too early.' : null,
    sections: hasText
      ? [
          { kind: 'verdict', title: msg('review.section.verdict'), body: 'Warm and consistent; the upsell came too early.', items: [] },
          { kind: 'money', title: msg('review.section.money'), body: '$30 set bought after the tip; one offer left on the table.', items: [] },
          { kind: 'persona', title: msg('review.section.persona'), body: 'Voice matches Лора: playful, short sentences.', items: [] },
          {
            kind: 'mistakes',
            title: msg('review.section.mistakes'),
            body: 'One mistake.',
            items: [{ body: 'The set was offered right after his tip.', example: 'Missed you today — want to see what I saved for you?', exampleWhere: 'after "[Photo]"', afterExample: null }],
          },
          { kind: 'recommendations', title: msg('review.section.recommendations'), body: 'Ask about his weekend before the next offer.', items: [] },
        ]
      : [],
    raw: hasText ? 'Rating: 7/10 …' : null,
    unparsed: false,
    copyHandle: hasText ? handles.artifact('review', 1) : null,
    regenerate: button('common.again', { type: 'Generate', targetHandle: handles.dock(FANS.hubert), feature: 'review', options: {} }, { hotkey: hotkey(ctx, 'review') }),
    generatedAt: hasText ? iso(ctx.now - 5 * MIN) : null,
    facts: [msg('review.archiveAsOf', { time: { time: ctx.now - 2 * MIN } })],
    refreshFailed: null,
    stamp: stamp(ctx, view.s === 'partial' ? 'partial' : 'complete'),
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

/** The empty dialog's headings and their questions (core coach/controller.ts HINT_GROUPS), with the Russian text a click puts into the field. */
const COACH_HINTS = [
  {
    label: 'coach.group.sell',
    questions: [
      ['coach.hint.sell.how', 'Не знаю, как продать — подскажи'],
      ['coach.hint.sell.price', 'Как подать цену, чтобы не спугнуть?'],
      ['coach.hint.sell.discount', 'Просит скидку — что ответить?'],
    ],
  },
  {
    label: 'coach.group.return',
    questions: [
      ['coach.hint.return.revive', 'Как оживить остывший чат?'],
      ['coach.hint.return.seen', 'Прочитал и молчит — что написать?'],
      ['coach.hint.return.afterPrice', 'Пропал после цены — как вернуть?'],
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
    autoRecap: 'off',
    autoRecapNext: null,
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

export const aiReadyToast = (ctx: ScenarioCtx, fanName: string, chatHandle: string): ToastVM =>
  toast(ctx, 'toast-ai-ready', 'success', {
    title: ctx.lang === 'ru' ? `AI готово · ${fanName}` : `AI ready · ${fanName}`,
    actions: [button('common.openChat', { type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle } })],
  });
