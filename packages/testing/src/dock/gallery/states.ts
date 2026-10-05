// States of the dock and the overlays for the stand gallery (architecture.md
// §10.2 п. 8; ui-design §0.2, §10, §11 п. 1): one entry per state of the
// binding mockup — 1…10, 12, 16…19 — plus the states §10 lists without a
// picture. Each is a set of view models built with the contract's scenario
// builders; texts repeat the mockup's fixtures so the picture can be compared
// with `final-<state>-*.png` by eye. Synthetic names and ids only.

import {
  type CoachTurnVM,
  type CoachVM,
  type DockVM,
  type Locale,
  type PartVM,
  type RecapViewVM,
  type ResultVM,
  type ReviewVM,
  type ToastVM,
} from '@cg/contracts';

import {
  FANS,
  HOUR,
  MIN,
  NOW,
  aiReadyToast,
  button,
  cgError,
  cheatsheet,
  coach,
  coachTurn,
  ctxOf,
  PAGE_OFF_REASON,
  dock,
  dockActions,
  dockPageOff,
  entry,
  failedResult,
  handles,
  hotkey,
  iso,
  meta,
  msg,
  part,
  parts,
  phase,
  reason,
  recapPicker,
  recapView,
  result,
  review,
  running,
  toast,
  toasts,
  uuid,
  variants,
  views,
  type AppClientScenario,
  type DockOptions,
  type ScenarioCtx,
  type ScenarioViewEntry,
} from '../../scenarios/app-client';

export type StateGroup = 'strip' | 'results' | 'errors' | 'status' | 'analysis' | 'extras' | 'overlays';

export interface GalleryState {
  /** The mockup's state id («3a», «9h») or `x-…` for a state of ui-design §10. */
  readonly id: string;
  readonly group: StateGroup;
  readonly title: string;
  /** Which surface the state shows. */
  readonly surface: 'dock' | 'toasts' | 'cheatsheet' | 'coach' | 'result-expanded';
  /** The mockup's reference picture, when it has one. */
  readonly mockup: string | null;
  /** No ChatSpace composer under the dock (a blocked fan). */
  readonly noComposer?: boolean;
  /** Opened after the mount, as a person would. */
  readonly open?: 'tone' | 'more';
  readonly debug?: boolean;
  /** The surface cannot draw this view model: the state shows the «Сбой интерфейса» card of its error boundary (ER-020). */
  readonly broken?: boolean;
  views(ctx: ScenarioCtx): readonly ScenarioViewEntry[];
}

const OP = { reply: uuid(101), hi: uuid(102), fix: uuid(103), recap: uuid(104), review: uuid(105), a: uuid(111), b: uuid(112), c: uuid(113) };
const DOCK = { of: 'dock' } as const;

const REPLY = [
  'good morning, my traveler ☀️ доброе утро! how was the flight?',
  'I just woke up and saw your messages… you made me smile before my coffee 🙈',
  "the set is still waiting for you 😏 want me to send it now, or do you want to guess what's inside first?",
];
const SINGLE =
  "good morning, my traveler ☀️ доброе утро! I just woke up and saw your messages, you made me smile before my coffee 🙈 the set is still waiting for you… want me to send it now? 😏";
const HI = [
  ['hiii Tomasz 🥰 welcome to my VIP!', "I'm Lora, so happy you're here… tell me, what made you subscribe? 😏"],
  ['hey you 👀 new face in my DMs, I like that', 'привет from me ☺️ where are you writing from?'],
  ['welcome, Tomasz 🌸 I always say hi to everyone personally', "I've got something special for new VIPs today… want to hear about it? 😇"],
];
const FIX = {
  draft: 'morning babe, i wake up just now. how was fly? i miss u, и сет тоже ждёт тебя',
  result: 'morning babe ☀️ just woke up and saw you… how was the flight? I missed you 🙈 and the set is still waiting for you 😏',
};

const RECAP: Record<Locale, { short: string; blocks: { heading: string; markdown: string }[] }> = {
  ru: {
    short:
      'Хуберт, 18 мес подписки, один из главных покупателей ($12,480). Много путешествует, сейчас в Варшаве. Любит, когда Лора первой рассказывает про свой день, отвечает быстро утром. Покупает сеты после «тизера» в тексте, торг не любит. Вчера купил сет за $25, ждёт продолжения.',
    blocks: [
      { heading: 'Кто он', markdown: 'Хуберт, Польша, работает в логистике, постоянно в разъездах. Подписан с марта 2024, автопродление включено.' },
      { heading: 'Что любит', markdown: 'Лёгкий флирт, фото «за кадром», когда его называют «my traveler». Пару раз просил голосовые.' },
      { heading: 'Покупки', markdown: 'Сеты $20–40 почти всегда после тизера; чаевые на праздники. Платный контент дороже $60 открывал редко.' },
      { heading: 'Чего избегать', markdown: 'Не торопить с покупкой и не повторять одну и ту же фразу продажи — один раз отписался на неделю.' },
      { heading: 'Сейчас', markdown: 'Утром прилетел в Варшаву, пишет первым. Хороший момент предложить новый сет.' },
    ],
  },
  en: {
    short:
      'Hubert, 18 months subscribed, one of the top buyers ($12,480). Travels a lot, in Warsaw now. Likes it when Lora tells about her day first, answers fast in the morning. Buys sets after a teaser in the text, dislikes haggling. Bought a $25 set yesterday and waits for more.',
    blocks: [
      { heading: 'Who he is', markdown: 'Hubert, Poland, works in logistics, always on the road. Subscribed since March 2024, auto-renew is on.' },
      { heading: 'What he likes', markdown: 'Light flirting, behind-the-scenes photos, being called “my traveler”. Asked for voice notes a couple of times.' },
      { heading: 'Purchases', markdown: 'Sets of $20–40 nearly always after a teaser; tips on holidays. Rarely opened paid content above $60.' },
      { heading: 'Avoid', markdown: 'Do not rush the purchase or repeat the same sales line — he once left for a week.' },
      { heading: 'Now', markdown: 'Landed in Warsaw this morning and wrote first. A good moment to offer a new set.' },
    ],
  },
};

const REVIEW: Record<Locale, { verdict: string; money: string; persona: string; mistake: string; example: string; where: string; next: string }> = {
  ru: {
    verdict: 'Тёплый тон, поддержали тему путешествия, сет предложен мягко.',
    money: 'Сет за $25 куплен после тизера; второе предложение за вечер осталось без ответа.',
    persona: 'Голос совпадает с Лорой: игриво, короткими фразами.',
    mistake: 'Вечером два ответа подряд закончились продажей — добавьте вопрос о нём, прежде чем предлагать.',
    example: 'how was the flight, my traveler? ☀️ tell me everything',
    where: 'после «just landed in Warsaw»',
    next: 'Спросите про полёт и только потом напомните про сет.',
  },
  en: {
    verdict: 'Warm tone, the travel topic was kept up, the set was offered gently.',
    money: 'The $25 set was bought after a teaser; the second offer of the evening got no answer.',
    persona: 'The voice matches Lora: playful, short sentences.',
    mistake: 'Two answers in a row ended with a sale in the evening — ask about him before offering.',
    example: 'how was the flight, my traveler? ☀️ tell me everything',
    where: 'after “just landed in Warsaw”',
    next: 'Ask about the flight and only then remind him of the set.',
  },
};

const COACH: Record<Locale, { question: string; answer: string }> = {
  ru: {
    question: 'он уже купил вчера сет, предлагать ли сегодня ещё один или лучше подождать?',
    answer: 'Сегодня можно, но не первым сообщением. Он сам вспомнил про сет — используйте это: сначала про полёт, потом тизер.',
  },
  en: {
    question: 'he bought a set yesterday — offer another one today or wait?',
    answer: 'Today is fine, but not as the first message. He brought up the set himself — use it: the flight first, then a teaser.',
  },
};
const COACH_DRAFTS = ['how was the flight, my traveler? ☀️', 'you remembered the set 🙈 there is a second part… even cuter. want a little peek first?'];

const again = (opId: string) => button('common.again', { type: 'Regenerate', operationId: opId });

const reply = (ctx: ScenarioCtx, patch: Partial<ResultVM> = {}, partPatch: (index: number) => Partial<PartVM> = () => ({})): ResultVM =>
  result(ctx, {
    opId: OP.reply,
    feature: 'reply',
    state: 'done',
    parts: parts(OP.reply, REPLY, partPatch),
    meta: [meta.tone('flirty'), meta.parts(3)],
    toneUsed: 'flirty',
    splitRequested: true,
    ...patch,
  });

const withSplit = (ctx: ScenarioCtx, split = true): DockVM['options'] => ({ ...dock(ctx).options, split });

/** A dock in `status` with Split on (as in the mockup); Tone and Split keep the status's own reasons. */
const statusDock = (ctx: ScenarioCtx, status: DockVM['status'], options: DockOptions = {}): DockVM => {
  const base = dock(ctx, status, options);
  return { ...base, options: { ...base.options, split: true } };
};

const replyDock = (ctx: ScenarioCtx, r: ResultVM, options: DockOptions = {}): DockVM =>
  dock(ctx, 'ready', { result: r, options: withSplit(ctx), actionsOptions: { active: 'reply' }, ...options });

const one = (ctx: ScenarioCtx, vm: DockVM, more: readonly ScenarioViewEntry[] = []): readonly ScenarioViewEntry[] => [entry(DOCK, vm), ...more];

const state = (
  id: string,
  group: StateGroup,
  title: string,
  build: (ctx: ScenarioCtx) => readonly ScenarioViewEntry[],
  extra: Partial<Omit<GalleryState, 'id' | 'group' | 'title' | 'views'>> = {},
): GalleryState => ({
  id,
  group,
  title,
  surface: 'dock',
  mockup: id.startsWith('x-') ? null : `final-${/^(2|6|12)a$/.test(id) ? id.slice(0, -1) : id}`,
  ...extra,
  views: build,
});

const quotaLow = (ctx: ScenarioCtx) => ({ remaining: 12, low: true, resetsAt: iso(ctx.now + 17 * HOUR + 40 * MIN) });

const stream = (ctx: ScenarioCtx, retry: boolean): DockVM =>
  dock(ctx, 'ready', {
    options: { ...withSplit(ctx), tone: 'flirty', locked: true, toneReason: reason('locked-during-generation'), splitReason: reason('locked-during-generation') },
    actionsOptions: { busy: 'reply' },
    result: result(ctx, {
      opId: OP.reply,
      feature: 'reply',
      state: retry ? 'requesting' : 'streaming',
      startedAt: ctx.now - 3_000,
      phase: retry ? phase(OP.reply, ctx.now - 3_000, ['context'], 'retry-wait', ctx.now + 5_000) : phase(OP.reply, ctx.now - 3_000, ['context', 'thinking'], 'writing'),
      streamText: retry ? null : 'good morning, my traveler ☀️ доброе утро! how was the fl',
      draftNotSent: false,
      toneUsed: 'flirty',
    }),
  });

const fixResult = (ctx: ScenarioCtx, patch: Partial<NonNullable<ResultVM['fix']>>, draftNotSent: boolean): ResultVM =>
  result(ctx, {
    opId: OP.fix,
    feature: 'fix',
    state: 'done',
    parts: parts(OP.fix, [FIX.result]),
    meta: [meta.byDraft()],
    draftNotSent,
    fix: { sourceDraft: FIX.draft, canReplace: true, replaceReason: null, replaced: false, restoreUntil: null, restoreExpired: false, ...patch },
  });

const recap = (ctx: ScenarioCtx, length: 'short' | 'full', view = views.ready(), patch: Partial<RecapViewVM> = {}): RecapViewVM => {
  const text = RECAP[ctx.lang];
  return recapView(ctx, view, length, {
    markdown: length === 'short' ? text.short : text.blocks.map((block) => `## ${block.heading}\n${block.markdown}`).join('\n\n'),
    blocks: length === 'full' ? text.blocks : null,
    generatedAt: iso(ctx.now - 26 * HOUR),
    saved: { s: 'saved', at: iso(ctx.now - 26 * HOUR) },
    ...patch,
  });
};

const recapDock = (ctx: ScenarioCtx, patch: DockOptions = {}): DockVM =>
  dock(ctx, 'ready', { analysis: 'recap', options: { ...withSplit(ctx), splitReason: reason('not-a-message') }, actionsOptions: { active: 'recap' }, ...patch });

const reviewVm = (ctx: ScenarioCtx, patch: Partial<ReviewVM> = {}): ReviewVM => {
  const text = REVIEW[ctx.lang];
  return review(ctx, views.ready(), {
    lead: text.verdict,
    sections: [
      { kind: 'verdict', title: msg('review.section.verdict'), body: text.verdict, items: [] },
      { kind: 'money', title: msg('review.section.money'), body: text.money, items: [] },
      { kind: 'persona', title: msg('review.section.persona'), body: text.persona, items: [] },
      { kind: 'mistakes', title: msg('review.section.mistakes'), body: '', items: [{ body: text.mistake, example: text.example, exampleWhere: text.where, afterExample: null }] },
      { kind: 'recommendations', title: msg('review.section.recommendations'), body: text.next, items: [] },
    ],
    ...patch,
  });
};

const coachTurns = (ctx: ScenarioCtx, patch: Partial<CoachTurnVM> = {}): CoachTurnVM[] => {
  const text = COACH[ctx.lang];
  const opId = uuid(401);
  return [
    coachTurn(ctx, 1, {
      question: text.question,
      answer: { prose: text.answer, blocks: null, drafts: [{ index: 0, label: msg('coach.draft', { n: 1 }), parts: parts(opId, COACH_DRAFTS) }] },
      ...patch,
    }),
  ];
};

const runningList = (ctx: ScenarioCtx) => [running(ctx, FANS.theodore, 'reply', 14, OP.a), running(ctx, FANS.marco, 'recap', 42, OP.b), running(ctx, FANS.jake, 'hi', 7, OP.c)];

const errorToast = (ctx: ScenarioCtx): ToastVM =>
  toast(ctx, 'toast-hub', 'error', {
    code: 'CG-HUB-UNAVAILABLE',
    title: cgError(ctx, 'CG-HUB-UNAVAILABLE').title,
    body: cgError(ctx, 'CG-HUB-UNAVAILABLE').body,
    copyCode: true,
    actions: [button('common.settings', { type: 'OpenSettings', route: { section: 'status', code: 'CG-HUB-UNAVAILABLE' } })],
  });

export const GALLERY_STATES: readonly GalleryState[] = [
  // ── 1. the collapsed dock ──
  state('1a', 'strip', 'Свёрнутый док: готов', (ctx) => one(ctx, dock(ctx, 'ready', { options: withSplit(ctx) }))),
  state('1b', 'strip', 'Мало квоты, Recap готов', (ctx) => one(ctx, dock(ctx, 'ready', { options: withSplit(ctx), quota: quotaLow(ctx), actionsOptions: { recapReady: true } }))),
  state('1c', 'strip', 'Меню «Тон»', (ctx) => one(ctx, dock(ctx, 'ready', { options: withSplit(ctx) })), { open: 'tone' }),
  state('1d', 'strip', 'Меню «Ещё» (поле ≤ 600 px)', (ctx) => one(ctx, dock(ctx, 'ready', { options: withSplit(ctx) })), { open: 'more' }),
  // ── 2. streaming ──
  state('2a', 'results', 'Поток: этапы и таймер', (ctx) => one(ctx, stream(ctx, false))),
  state('2b', 'results', 'Прозрачный повтор при 503', (ctx) => one(ctx, stream(ctx, true))),
  // ── 3. Split ──
  state('3a', 'results', 'Split: готово, подвал клавиш', (ctx) => one(ctx, replyDock(ctx, reply(ctx), { keysFooter: true }))),
  state('3b', 'results', '1 из 3 вставлена', (ctx) =>
    one(
      ctx,
      replyDock(
        ctx,
        reply(ctx, { meta: [meta.tone('flirty'), meta.parts(3), meta.inserted(1, 3)] }, (i) => (i === 0 ? { insert: 'done', collapsed: true, next: false } : { next: i === 1 })),
      ),
    ),
  ),
  state('3c', 'results', 'Фан написал новое', (ctx) => one(ctx, replyDock(ctx, reply(ctx, { stale: { reason: 'fan-wrote', at: iso(ctx.now - MIN) } })))),
  state('3d', 'results', 'Одним сообщением (Split выключен)', (ctx) =>
    one(
      ctx,
      replyDock(ctx, reply(ctx, { parts: parts(OP.reply, [SINGLE]), meta: [meta.tone('flirty'), meta.single()], splitRequested: false }), { options: withSplit(ctx, false) }),
    ),
  ),
  state('3e', 'results', 'Вставка идёт; скопировано', (ctx) => one(ctx, replyDock(ctx, reply(ctx, {}, (i) => (i === 0 ? { insert: 'pending' } : i === 1 ? { copy: 'done' } : {}))))),
  state('3f', 'results', 'Вставка не удалась', (ctx) =>
    one(ctx, replyDock(ctx, reply(ctx, {}, (i) => (i === 0 ? { insert: 'failed', insertError: cgError(ctx, 'CG-INSERT-FAILED') } : {})))),
  ),
  state('3g', 'results', 'Копирование не удалось', (ctx) => one(ctx, replyDock(ctx, reply(ctx, {}, (i) => (i === 1 ? { copy: 'failed', copyError: cgError(ctx, 'CG-CLIPBOARD') } : {}))))),
  // ── 4. Hi ──
  state('4', 'results', 'Hi: три варианта', (ctx) =>
    one(
      ctx,
      dock(ctx, 'ready', {
        fan: FANS.tomasz,
        options: withSplit(ctx),
        keysFooter: true,
        actionsOptions: { active: 'hi' },
        result: result(ctx, { opId: OP.hi, feature: 'hi', state: 'done', variants: variants(OP.hi, HI), meta: [meta.variants(3), meta.partsEach(2)], targetName: FANS.tomasz.name, splitRequested: true }),
      }),
    ),
  ),
  // ── 5. Fix ──
  state('5a', 'results', 'Fix: до замены', (ctx) => one(ctx, dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { active: 'fix' }, result: fixResult(ctx, {}, true) }))),
  state('5b', 'results', 'Fix: после замены, «Вернуть мой текст»', (ctx) =>
    one(ctx, dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { active: 'fix' }, result: fixResult(ctx, { replaced: true, restoreUntil: ctx.now + 30_000 }, false) })),
  ),
  state('5c', 'results', 'Fix: поле ввода нельзя проверить', (ctx) =>
    one(
      ctx,
      dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { active: 'fix' }, result: fixResult(ctx, { canReplace: false, replaceReason: reason('draft-unverifiable') }, true) }),
    ),
  ),
  // ── 6. Б2 ──
  state('6a', 'results', 'Б2: в поле уже есть ваш текст', (ctx) =>
    one(ctx, replyDock(ctx, reply(ctx, { confirm: { confirmationId: uuid(201), kind: 'human-draft', part: { index: 0 }, formatLoss: false } }))),
  ),
  state('6b', 'results', 'Б2: текст изменился, форматирование пропадёт', (ctx) =>
    one(ctx, replyDock(ctx, reply(ctx, { confirm: { confirmationId: uuid(202), kind: 'draft-changed', part: { index: 0 }, formatLoss: true } }))),
  ),
  // ── 7. errors ──
  state('7a', 'errors', 'Квота 0', (ctx) =>
    one(
      ctx,
      dock(ctx, 'ready', {
        options: withSplit(ctx),
        quota: { remaining: 0, low: true, resetsAt: iso(ctx.now + 17 * HOUR + 39 * MIN + 20_000) },
        mark: 'faint',
        actions: { ...dockActions(ctx, { off: reason('quota-zero', { time: { time: ctx.now + 17 * HOUR + 40 * MIN } }) }), reply: { ...dockActions(ctx, { off: reason('quota-zero', { time: { time: ctx.now + 17 * HOUR + 40 * MIN } }) }).reply, active: true } },
        result: failedResult(ctx, OP.reply, 'reply', cgError(ctx, 'CG-QUOTA-DAILY', { retryAt: ctx.now + 17 * HOUR + 39 * MIN + 20_000, detail: 'HTTP 429 • quota_denied • resetsAt=2026-10-04T00:00:00Z' }), []),
      }),
    ),
  ),
  state('7b', 'errors', 'Только копия: поле ввода недоступно', (ctx) =>
    one(ctx, statusDock(ctx, 'host-degraded', { code: 'CG-HOST-COMPOSER-MISSING', actionsOptions: { active: 'reply' }, result: reply(ctx) })),
  ),
  state('7c', 'errors', 'AI перегружен', (ctx) =>
    one(
      ctx,
      replyDock(
        ctx,
        failedResult(ctx, OP.reply, 'reply', cgError(ctx, 'CG-PROVIDER-RATE-LIMIT', { retryAt: ctx.now + 24_000, detail: 'HTTP 429 • provider_rate_limited • retryAfterMs=24000 • req 7f3a9c21' }), [
          button('common.retry', { type: 'Regenerate', operationId: OP.reply }, { enabled: false, reason: reason('wait-until', { n: 24 }), hotkey: hotkey(ctx, 'reply') }),
        ]),
      ),
    ),
  ),
  state('7d', 'errors', 'Генерация прервалась', (ctx) =>
    one(
      ctx,
      replyDock(
        ctx,
        result(ctx, {
          opId: OP.reply,
          feature: 'reply',
          state: 'interrupted',
          error: cgError(ctx, 'CG-OP-INTERRUPTED', { detail: 'op 4c1d9e • interrupted at streaming • 2,1 с' }),
          errorActions: [{ ...again(OP.reply), hotkey: hotkey(ctx, 'reply') }],
          draftNotSent: false,
          meta: [msg('result.meta.failed')],
        }),
      ),
    ),
  ),
  // ── 8. the limit ──
  state('8', 'errors', 'Четвёртая генерация: очереди нет', (ctx) =>
    one(ctx, dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { active: 'reply' }, refusal: { feature: 'reply', error: cgError(ctx, 'CG-OP-TAB-LIMIT'), running: runningList(ctx) }, runningElsewhere: runningList(ctx) })),
  ),
  // ── 9. status ──
  state('9a', 'status', 'Расширение обновилось', (ctx) => one(ctx, statusDock(ctx, 'reload-needed'))),
  state('9b', 'status', 'Нет входа', (ctx) => one(ctx, statusDock(ctx, 'not-signed-in'))),
  state('9c', 'status', 'Хаб недоступен', (ctx) => one(ctx, statusDock(ctx, 'hub-down'))),
  state('9d', 'status', 'Чат загружается', (ctx) => one(ctx, statusDock(ctx, 'loading-chat'))),
  state('9e', 'status', 'Нет привязки', (ctx) => one(ctx, statusDock(ctx, 'no-binding'))),
  state('9f', 'status', 'Нет персоны', (ctx) => one(ctx, statusDock(ctx, 'no-persona'))),
  state('9g', 'status', 'ChatSpace обновился: только копия', (ctx) => one(ctx, statusDock(ctx, 'host-degraded'))),
  state('9h', 'status', 'Фан заблокирован', (ctx) => one(ctx, statusDock(ctx, 'blocked-fan')), { noComposer: true }),
  // ── 10. debug ──
  state(
    '10',
    'results',
    'Отладка: стоимость и профайлер',
    (ctx) =>
      one(
        ctx,
        replyDock(
          ctx,
          reply(ctx, {
            expanded: true,
            debug: {
              costLine: 'in 3 412 tok • out 286 tok • $0.0143 • 3.8 s • model-test',
              stages: [
                { name: 'request', ms: 38 },
                { name: 'meta', ms: 312 },
                { name: 'first-chunk', ms: 1_214 },
                { name: 'stream', ms: 2_168 },
                { name: 'parse', ms: 14 },
                { name: 'render', ms: 9 },
              ],
              totalMs: 3_755,
              hubStages: [
                { name: 'context', ms: 182 },
                { name: 'provider', ms: 3_106 },
                { name: 'stream', ms: 2_041 },
              ],
              prompt: { type: 'Navigate', to: { kind: 'debug-prompt', promptHandle: 'snap-1' } },
              reasoning: null,
              context: null,
              liveTimer: false,
            },
          }),
        ),
      ),
    { debug: true },
  ),
  // ── 18, 19. Recap and Review in the sheet ──
  state('18a', 'analysis', 'Recap: коротко', (ctx) => one(ctx, recapDock(ctx), [entry({ of: 'recap.view' }, recap(ctx, 'short')), entry({ of: 'recap.picker' }, recapPicker(ctx, views.ready()))])),
  state('18b', 'analysis', 'Recap: полностью, архив отстаёт', (ctx) =>
    one(ctx, recapDock(ctx), [entry({ of: 'recap.view' }, recap(ctx, 'full', views.partial({ kind: 'archive-lag', messages: 2, minutes: null }), { stamp: { asOf: iso(ctx.now - 2 * MIN), coverage: 'complete' } }))]),
  ),
  state('18c', 'analysis', 'Recap: не сохранено в хаб', (ctx) =>
    one(ctx, recapDock(ctx), [entry({ of: 'recap.view' }, recap(ctx, 'short', views.ready(), { saved: { s: 'failed', error: cgError(ctx, 'CG-RECAP-SAVE'), retry: { type: 'RetryRecapSave', length: 'short' } } }))]),
  ),
  state('19', 'analysis', 'Review 7/10', (ctx) =>
    one(ctx, dock(ctx, 'ready', { analysis: 'review', options: { ...withSplit(ctx), splitReason: reason('not-a-message') }, actionsOptions: { active: 'review' } }), [entry({ of: 'review' }, reviewVm(ctx))]),
  ),
  // ── ui-design §10: required, not drawn in the mockup ──
  state('x-one-part', 'extras', 'Split включён, пришла одна часть (AI-011)', (ctx) =>
    one(ctx, replyDock(ctx, reply(ctx, { parts: parts(OP.reply, [SINGLE]), meta: [meta.tone('flirty'), meta.onePart()], splitRequested: true }))),
  ),
  state('x-chat-changed', 'extras', 'Вставка в сменившийся чат (CG-INSERT-CHAT-CHANGED)', (ctx) =>
    one(ctx, replyDock(ctx, reply(ctx, {}, (i) => (i === 0 ? { insert: 'failed', insertError: cgError(ctx, 'CG-INSERT-CHAT-CHANGED') } : {})))),
  ),
  state('x-unparsed', 'extras', 'Сырой ответ не разобран (UI-032)', (ctx) =>
    one(
      ctx,
      replyDock(
        ctx,
        reply(ctx, { parts: [part(0, 'good morning [VARIANT] my traveler [NEXT', { opId: OP.reply, numbered: false, next: true, insertBlocked: reason('unparsed') })], meta: [meta.unparsed()], unparsed: true }),
      ),
    ),
  ),
  state('x-language', 'extras', 'Блок кириллицы: «Вставить» недоступна (CG-GATE-LANGUAGE)', (ctx) =>
    one(ctx, replyDock(ctx, reply(ctx, { parts: parts(OP.reply, ['Привет, как прошли выходные?'], () => ({ insertBlocked: reason('language') })), meta: [meta.single()], splitRequested: false }))),
  ),
  state('x-fix-no-draft', 'extras', 'Fix без черновика (CG-GATE-DRAFT)', (ctx) => one(ctx, dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { gates: { fix: reason('needs-draft') } } }))),
  state('x-fix-expired', 'extras', 'Fix: вернуть текст уже нельзя', (ctx) =>
    one(ctx, dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { active: 'fix' }, result: fixResult(ctx, { replaced: true, restoreExpired: true }, false) })),
  ),
  state('x-fix-changed', 'extras', 'Fix: черновик изменился за время генерации — Б2 (AI-022)', (ctx) =>
    one(
      ctx,
      dock(ctx, 'ready', {
        options: withSplit(ctx),
        actionsOptions: { active: 'fix' },
        result: { ...fixResult(ctx, {}, true), confirm: { confirmationId: uuid(203), kind: 'draft-changed', part: { index: 0 }, formatLoss: false } },
      }),
    ),
  ),
  state('x-fix-restore-changed', 'extras', 'Fix: «Вернуть мой текст» после новой правки — Б2', (ctx) =>
    one(
      ctx,
      dock(ctx, 'ready', {
        options: withSplit(ctx),
        actionsOptions: { active: 'fix' },
        result: { ...fixResult(ctx, { replaced: true, restoreUntil: ctx.now + 22_000 }, false), confirm: { confirmationId: uuid(204), kind: 'draft-changed', part: { index: 0 }, formatLoss: true } },
      }),
    ),
  ),
  state('x-hub-timeout', 'extras', 'Хаб не ответил вовремя (карточка с «Ещё раз»)', (ctx) =>
    one(ctx, replyDock(ctx, failedResult(ctx, OP.reply, 'reply', cgError(ctx, 'CG-HUB-TIMEOUT', { detail: 'no first chunk in 30 s' }), [{ ...again(OP.reply), hotkey: hotkey(ctx, 'reply') }]))),
  ),
  state('x-not-granted', 'extras', 'Страница не выдана аккаунту', (ctx) => one(ctx, statusDock(ctx, 'no-binding', { code: 'CG-BINDING-NOT-GRANTED' }))),
  // 1.3.0: the owner's master switch is off for the page — one status line, every AI button dimmed with the same reason.
  state('x-page-off', 'extras', 'ChatGoose выключен для этой страницы (главный выключатель владельца)', (ctx) => one(ctx, dockPageOff(ctx))),
  state('x-page-off-result', 'extras', 'Страница выключена: готовый ответ можно только копировать', (ctx) =>
    one(ctx, dockPageOff(ctx, { result: reply(ctx, {}, () => ({ insertBlocked: PAGE_OFF_REASON })) })),
  ),
  state('x-recap-picker', 'extras', 'Recap: сохранённого нет — собрать (AI-060)', (ctx) =>
    one(ctx, recapDock(ctx), [
      entry({ of: 'recap.view' }, recapView(ctx, views.empty(msg('cg.recapNotFound.title')), 'short')),
      entry({ of: 'recap.picker' }, recapPicker(ctx, views.empty(msg('cg.recapNotFound.body')))),
    ]),
  ),
  state('x-recap-slots', 'extras', 'Recap: «Открыть последний» (AI-065)', (ctx) =>
    one(ctx, recapDock(ctx, { actionsOptions: { active: 'recap', recapReady: true } }), [
      entry({ of: 'recap.view' }, recapView(ctx, views.empty(msg('common.empty')), 'short', { markdown: null })),
      entry({ of: 'recap.picker' }, recapPicker(ctx, views.ready())),
    ]),
  ),
  state('x-recap-checking', 'extras', 'Recap: проверяю сохранённые (AI-061)', (ctx) =>
    one(ctx, recapDock(ctx), [
      entry({ of: 'recap.view' }, recapView(ctx, views.empty(msg('common.empty')), 'short')),
      entry({ of: 'recap.picker' }, recapPicker(ctx, views.loading(ctx.now - 400, msg('common.loading')))),
    ]),
  ),
  state('x-recap-running', 'extras', 'Recap собирается', (ctx) =>
    one(ctx, recapDock(ctx, { actionsOptions: { busy: 'recap' } }), [
      entry(
        { of: 'recap.view' },
        recapView(ctx, views.loading(ctx.now - 12_000, msg('result.stage.context')), 'full', {
          opId: OP.recap,
          state: 'streaming',
          phase: phase(OP.recap, ctx.now - 12_000, ['context', 'thinking'], 'writing'),
          streamText: RECAP[ctx.lang].blocks[0]?.markdown ?? '',
        }),
      ),
    ]),
  ),
  state(
    'x-recap-debug',
    'extras',
    'Recap в режиме отладки: стоимость и профайлер (UI-030)',
    (ctx) =>
      one(ctx, recapDock(ctx), [
        entry(
          { of: 'recap.view' },
          recap(ctx, 'short', views.ready(), {
            debug: {
              costLine: 'in 9 120 tok • out 640 tok • $0.0312 • 6.2 s • model-test',
              stages: [
                { name: 'request', ms: 41 },
                { name: 'meta', ms: 298 },
                { name: 'first-chunk', ms: 1_380 },
                { name: 'stream', ms: 4_420 },
                { name: 'parse', ms: 11 },
                { name: 'render', ms: 7 },
              ],
              totalMs: 6_157,
              hubStages: [
                { name: 'context', ms: 210 },
                { name: 'provider', ms: 5_480 },
                { name: 'stream', ms: 4_402 },
              ],
              prompt: { type: 'Navigate', to: { kind: 'debug-prompt', promptHandle: 'snap-2' } },
              reasoning: null,
              context: null,
              liveTimer: false,
            },
          }),
        ),
      ]),
    { debug: true },
  ),
  state('x-review-failed', 'extras', 'Review: мало переписки (AI-051)', (ctx) =>
    one(ctx, dock(ctx, 'ready', { analysis: 'review', options: withSplit(ctx), actionsOptions: { active: 'review' } }), [
      entry({ of: 'review' }, review(ctx, views.error(cgError(ctx, 'CG-GATE-HISTORY'), null))),
    ]),
  ),
  state('x-hints-off', 'extras', 'Подсказки выключены (ui.hints)', (ctx) => one(ctx, replyDock(ctx, reply(ctx), { hints: false }))),
  // ── overlays ──
  state('12a', 'overlays', 'Тосты: ошибка, «готово», «инфо»', (ctx) =>
    [
      entry(DOCK, dock(ctx, 'ready', { options: withSplit(ctx) })),
      entry(
        { of: 'toasts' },
        toasts(views.ready(), [errorToast(ctx), aiReadyToast(ctx, FANS.theodore.name, handles.dock(FANS.theodore)), toast(ctx, 'toast-info', 'info', { title: ctx.lang === 'ru' ? 'Recap сохранён в хаб' : 'Recap saved to the hub' })]),
      ),
    ],
    { surface: 'toasts' },
  ),
  state('12b', 'overlays', 'Тосты: сбой в другом чате и два предупреждения', (ctx) =>
    [
      entry(DOCK, dock(ctx, 'ready', { options: withSplit(ctx) })),
      entry(
        { of: 'toasts' },
        toasts(views.ready(), [
          toast(ctx, 'toast-ai', 'error', {
            code: 'CG-PROVIDER-RATE-LIMIT',
            title: ctx.lang === 'ru' ? `AI: не получилось · ${FANS.theodore.name}` : `AI: failed · ${FANS.theodore.name}`,
            body: cgError(ctx, 'CG-PROVIDER-RATE-LIMIT').title,
            copyCode: true,
            actions: [button('common.openChat', { type: 'Navigate', to: { kind: 'chat', targetHandle: handles.dock(FANS.theodore) } })],
          }),
          toast(ctx, 'toast-contract', 'warning', {
            code: 'CG-HOST-CONTRACT',
            title: ctx.lang === 'ru' ? 'ChatSpace обновился — часть функций выключена' : 'ChatSpace was updated — some functions are off',
            actions: [button('common.settings', { type: 'OpenSettings', route: { section: 'status', code: 'CG-HOST-CONTRACT' } })],
          }),
          toast(ctx, 'toast-insert', 'warning', { code: 'CG-INSERT-UNCERTAIN', title: cgError(ctx, 'CG-INSERT-UNCERTAIN').title, body: cgError(ctx, 'CG-INSERT-UNCERTAIN').body }),
        ]),
      ),
    ],
    { surface: 'toasts' },
  ),
  state('16', 'overlays', 'Шпаргалка', (ctx) => [entry(DOCK, dock(ctx, 'ready', { options: withSplit(ctx) })), entry({ of: 'cheatsheet' }, cheatsheet(ctx, views.ready()))], { surface: 'cheatsheet' }),
  state('17a', 'overlays', 'Coach: сессия', (ctx) => [entry(DOCK, dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { active: 'coach' } })), entry({ of: 'coach' }, coach(ctx, views.ready(), coachTurns(ctx)))], {
    surface: 'coach',
  }),
  state(
    '17b',
    'overlays',
    'Coach: новый диалог, архив отстаёт',
    (ctx) => [
      entry(DOCK, dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { active: 'coach' } })),
      entry({ of: 'coach' }, coach(ctx, views.partial({ kind: 'archive-lag', messages: 2, minutes: null }), [])),
    ],
    { surface: 'coach' },
  ),
  state(
    'x-coach-answering',
    'overlays',
    'Coach отвечает: этапы, вопрос ждёт',
    (ctx) => [
      entry(DOCK, dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { busy: 'coach' } })),
      entry(
        { of: 'coach' },
        coach(
          ctx,
          views.ready(),
          [
            ...coachTurns(ctx, { outsideMemory: true }),
            coachTurn(ctx, 2, { state: 'streaming', answer: null, attachedDraft: true, streamText: COACH[ctx.lang].answer.slice(0, 48), phase: phase(uuid(402), ctx.now - 2_000, ['context'], 'writing') }),
          ],
          { ask: { enabled: false, reason: reason('coach-busy'), attachDraft: { available: true, reason: null } } },
        ),
      ),
    ],
    { surface: 'coach' },
  ),
  state(
    'x-coach-failed',
    'overlays',
    'Coach: сбой хода',
    (ctx) => [
      entry(DOCK, dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { active: 'coach' } })),
      entry(
        { of: 'coach' },
        coach(ctx, views.ready(), [coachTurn(ctx, 1, { question: COACH[ctx.lang].question, state: 'failed', answer: null, error: cgError(ctx, 'CG-PROVIDER-STREAM'), errorActions: [again(uuid(401))] })]),
      ),
    ],
    { surface: 'coach' },
  ),
  state(
    'x-coach-confirm',
    'overlays',
    'Coach: в поле уже есть ваш текст — Б2 в части черновика (AI-086)',
    (ctx) => [
      entry(DOCK, dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { active: 'coach' } })),
      entry({ of: 'coach' }, coach(ctx, views.ready(), coachTurns(ctx, { confirm: { confirmationId: uuid(205), kind: 'human-draft', part: { index: 0 }, formatLoss: false } }))),
    ],
    { surface: 'coach' },
  ),
  state(
    'x-coach-debug',
    'overlays',
    'Coach в режиме отладки: подвал хода (DB-019)',
    (ctx) => [
      entry(DOCK, dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { active: 'coach' } })),
      entry(
        { of: 'coach' },
        coach(
          ctx,
          views.ready(),
          coachTurns(ctx, {
            debug: {
              costLine: 'in 5 210 tok • out 402 tok • $0.0188 • 4.1 s • model-test',
              stages: [
                { name: 'request', ms: 36 },
                { name: 'meta', ms: 280 },
                { name: 'first-chunk', ms: 1_240 },
                { name: 'stream', ms: 2_510 },
                { name: 'parse', ms: 12 },
                { name: 'render', ms: 8 },
              ],
              totalMs: 4_086,
              hubStages: [
                { name: 'context', ms: 190 },
                { name: 'provider', ms: 3_600 },
                { name: 'stream', ms: 2_490 },
              ],
              prompt: { type: 'Navigate', to: { kind: 'debug-prompt', promptHandle: 'snap-3' } },
              reasoning: null,
              context: null,
              liveTimer: false,
            },
          }),
        ),
      ),
    ],
    { surface: 'coach', debug: true },
  ),
  state(
    'x-overlay-failed',
    'overlays',
    'Оверлей не отрисовался: «Сбой интерфейса» (ER-020)',
    (ctx) => [
      entry(DOCK, dock(ctx, 'ready', { options: withSplit(ctx), actionsOptions: { active: 'coach' } })),
      // A view model the panel cannot draw: its turns are missing.
      entry({ of: 'coach' }, { ...coach(ctx, views.ready(), []), turns: null } as unknown as CoachVM),
    ],
    { surface: 'coach', broken: true },
  ),
  state(
    'x-expanded-recap',
    'overlays',
    'Развернуть ↗: Recap полностью (UI-014)',
    (ctx) => [entry(DOCK, recapDock(ctx)), entry({ of: 'recap.view' }, recap(ctx, 'full', views.ready(), { expanded: true }))],
    { surface: 'result-expanded' },
  ),
  state(
    'x-expanded-review',
    'overlays',
    'Развернуть ↗: Review',
    (ctx) => [entry(DOCK, dock(ctx, 'ready', { analysis: 'review', options: withSplit(ctx), actionsOptions: { active: 'review' } })), entry({ of: 'review' }, reviewVm(ctx, { expanded: true }))],
    { surface: 'result-expanded' },
  ),
];

export const STATE_GROUPS: readonly StateGroup[] = ['strip', 'results', 'errors', 'status', 'analysis', 'extras', 'overlays'];

export function galleryState(id: string): GalleryState | null {
  return GALLERY_STATES.find((item) => item.id === id) ?? null;
}

/** The scenario of one gallery state in a language. */
export function scenarioOfState(item: GalleryState, lang: Locale, scheme: AppClientScenario['scheme']): AppClientScenario {
  const ctx = ctxOf({ lang, platform: 'mac', debug: item.debug === true });
  return {
    id: `gallery-${item.id}`,
    title: item.title,
    covers: [],
    language: lang,
    platform: ctx.platform,
    scheme,
    theme: 'host',
    debug: ctx.debug,
    now: NOW,
    views: item.views(ctx),
  };
}
