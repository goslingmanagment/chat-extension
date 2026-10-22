// The scenario set of the fake AppClient (architecture.md §10.2 п. 7, ui-design
// §0.2): a state gallery that puts every view into each state it produces,
// and the named scenarios — no sign-in, rights, persona or binding, a partly
// broken host contract, a blocked fan, empty and partial archives, a stats
// error, three running and a refused fourth, a late result, a human-draft
// conflict, streaming, timeouts, the greeting lease (busy, expired,
// uncertain), short and full Recap, variants and parts, every X8 state, debug
// on and off, RU/EN, light and dark.

import { type PartVM, type PreviewSendView, type ResultVM, type Locale, type HotkeyPlatform, type ColorScheme } from '@cg/contracts';

import { button, cgError, ctxOf, FANS, handles, iso, MIN, msg, NOW, PERSONA, reason, uuid, views, type ScenarioCtx } from './base';
import { dock, dockActions, running } from './dock';
import { entry, type AppClientScenario, type ScenarioReaction, type ScenarioStep, type ScenarioTopic, type ScenarioViewEntry } from './fake-app-client';
import { gallery, galleryEntry } from './gallery';
import { board, newcomerRow, newcomers, preview, stats, withResult, defaultNewcomerRows } from './lists';
import { options, popup } from './pages';
import { aiReadyToast, coach, coachReviewTurn, coachTurn, fanPanel, palette, recapPicker, recapView, toast, toasts } from './panels';
import { failedResult, meta, part, parts, phase, result, sendParts, variants } from './results';

interface Meta {
  readonly id: string;
  readonly title: string;
  readonly covers: readonly ScenarioTopic[];
  readonly lang?: Locale;
  readonly platform?: HotkeyPlatform;
  readonly scheme?: ColorScheme;
  readonly theme?: AppClientScenario['theme'];
  readonly debug?: boolean;
}

interface Built {
  readonly views: readonly ScenarioViewEntry[];
  readonly steps?: readonly ScenarioStep[];
  readonly reactions?: readonly ScenarioReaction[];
}

function make(m: Meta, build: (ctx: ScenarioCtx) => Built): AppClientScenario {
  const lang = m.lang ?? 'ru';
  const scheme = m.scheme ?? 'light';
  const debug = m.debug ?? false;
  const ctx = ctxOf({ lang, platform: m.platform ?? (lang === 'en' ? 'win' : 'mac'), debug });
  const covers = new Set<ScenarioTopic>([...m.covers, lang, scheme === 'dark' ? 'theme-dark' : 'theme-light', debug ? 'debug-on' : 'debug-off']);
  return {
    id: m.id,
    title: m.title,
    covers: [...covers],
    language: lang,
    platform: ctx.platform,
    scheme,
    theme: m.theme ?? 'host',
    debug,
    now: NOW,
    ...build(ctx),
  };
}

const DOCK = { of: 'dock' } as const;
const SPENDERS_PREVIEW = { of: 'preview', from: 'spenders' } as const;
const NEWCOMERS_PREVIEW = { of: 'preview', from: 'newcomers' } as const;

const OP = {
  reply: uuid(101),
  hi: uuid(102),
  fix: uuid(103),
  preview: uuid(104),
  greet: uuid(105),
  late: uuid(106),
  other1: uuid(111),
  other2: uuid(112),
  other3: uuid(113),
};

const REPLY_TEXTS = ['Hey you, I was just thinking about you', 'Got something new today — want a peek?', 'Only if you tell me about your weekend first'];
const HI_TEXTS = [
  ['Hi Tomasz, welcome!', 'So happy you are here'],
  ['Hey there, new face!', 'Tell me what brought you'],
  ['Welcome in, handsome', 'I have a little gift for new fans'],
];

const doneReply = (ctx: ScenarioCtx, patch: Partial<ResultVM> = {}): ResultVM =>
  result(ctx, {
    opId: OP.reply,
    feature: 'reply',
    state: 'done',
    parts: parts(OP.reply, REPLY_TEXTS),
    meta: [meta.parts(3)],
    splitRequested: true,
    toneUsed: null,
    ...patch,
  });

const again = (opId: string) => button('common.again', { type: 'Regenerate', operationId: opId });

// ── the state gallery ──

const GALLERY: AppClientScenario[] = [
  make({ id: 'gallery-loading', title: 'Every view loading (cold start)', covers: ['state-gallery', 'chat-loading'] }, (ctx) => ({ views: gallery(ctx, 'loading') })),
  make({ id: 'gallery-ready', title: 'Every view ready (a working shift)', covers: ['state-gallery', 'options', 'review'], debug: true }, (ctx) => ({
    views: [...gallery(ctx, 'ready'), entry(DOCK, dock(ctx, 'ready', { result: doneReply(ctx), actionsOptions: { active: 'reply' } }))],
  })),
  make({ id: 'gallery-empty', title: 'Every view empty', covers: ['state-gallery', 'archive-empty'] }, (ctx) => ({ views: gallery(ctx, 'empty') })),
  make({ id: 'gallery-partial', title: 'Every view partial', covers: ['state-gallery', 'archive-partial', 'host-contract-partial'] }, (ctx) => ({ views: gallery(ctx, 'partial') })),
  make({ id: 'gallery-error', title: 'Every view failed', covers: ['state-gallery', 'reload-needed', 'stats-error'] }, (ctx) => ({ views: gallery(ctx, 'error') })),
  make({ id: 'no-sign-in', title: 'Not signed in: everything forbidden, the sign-in screen', covers: ['state-gallery', 'no-sign-in'] }, (ctx) => ({ views: gallery(ctx, 'forbidden') })),
  make({ id: 'hub-down', title: 'Hub down: cached data offline', covers: ['state-gallery', 'hub-down', 'popup-problems'], scheme: 'dark', theme: 'system' }, (ctx) => ({
    views: [...gallery(ctx, 'offline'), entry({ of: 'toasts' }, toasts(views.ready(), [toast(ctx, 'toast-hub', 'error', { code: 'CG-HUB-UNAVAILABLE', title: cgError(ctx, 'CG-HUB-UNAVAILABLE').title, copyCode: true, actions: [button('common.settings', { type: 'OpenSettings', route: { section: 'status', code: 'CG-HUB-UNAVAILABLE' } })] })]))],
  })),
];

// ── access and host ──

const ACCESS: AppClientScenario[] = [
  make({ id: 'no-rights', title: 'Page not granted, no rights to Spenders and «Новые»', covers: ['no-rights'] }, (ctx) => {
    const forbidden = views.forbidden(cgError(ctx, 'CG-HUB-FORBIDDEN'));
    return {
      views: [
        entry(DOCK, dock(ctx, 'no-binding', { code: 'CG-BINDING-NOT-GRANTED' })),
        entry({ of: 'spenders.board' }, board(ctx, forbidden)),
        entry({ of: 'spenders.stats' }, stats(ctx, forbidden)),
        entry({ of: 'newcomers' }, newcomers(ctx, forbidden, [])),
      ],
    };
  }),
  make({ id: 'no-persona', title: 'No persona for the page', covers: ['no-persona', 'options'] }, (ctx) => ({
    views: [
      entry(DOCK, dock(ctx, 'no-persona')),
      entry({ of: 'popup' }, popup(ctx, views.ready(), { persona: { s: 'no-persona', pageName: PERSONA.pageName } })),
      entry({ of: 'options', section: 'personas' }, options(ctx, 'personas', views.ready(), { patch: { highlight: cgError(ctx, 'CG-PERSONA-UNASSIGNED') } })),
    ],
  })),
  make({ id: 'no-binding', title: 'OnlyMonster account not linked to a hub page', covers: ['no-binding'] }, (ctx) => ({
    views: [entry(DOCK, dock(ctx, 'no-binding')), entry({ of: 'popup' }, popup(ctx, views.ready(), { persona: { s: 'not-connected' } }))],
  })),
  make({ id: 'host-contract-partial', title: 'ChatSpace updated: insert off, copy only', covers: ['host-contract-partial', 'toasts'] }, (ctx) => {
    const copyOnly = doneReply(ctx);
    return {
      views: [
        entry(DOCK, dock(ctx, 'host-degraded', { result: copyOnly })),
        entry({ of: 'toasts' }, toasts(views.ready(), [toast(ctx, 'toast-contract', 'warning', { code: 'CG-HOST-CONTRACT', title: cgError(ctx, 'CG-HOST-CONTRACT').title, actions: [button('common.settings', { type: 'OpenSettings', route: { section: 'status', code: 'CG-HOST-CONTRACT' } })] })])),
        entry({ of: 'popup' }, popup(ctx, views.partial({ kind: 'host-degraded', capabilities: ['insert'] }), { pills: { host: 'partial', hub: 'ok' }, problems: [cgError(ctx, 'CG-HOST-CONTRACT')] })),
      ],
      steps: [{ label: 'composer missing', at: 2_000, views: [entry(DOCK, dock(ctx, 'host-degraded', { code: 'CG-HOST-COMPOSER-MISSING', result: copyOnly }))] }],
    };
  }),
  make({ id: 'blocked-fan', title: 'Blocked fan: a narrow copy-only row', covers: ['blocked-fan'] }, (ctx) => ({
    views: [entry(DOCK, dock(ctx, 'blocked-fan', { result: doneReply(ctx) }))],
  })),
  make({ id: 'quota-low', title: 'Little AI quota left', covers: ['quota-low'] }, (ctx) => ({
    views: [entry(DOCK, dock(ctx, 'ready', { quota: { remaining: 12, low: true, resetsAt: iso(ctx.now + 17 * 60 * MIN) } }))],
  })),
  make({ id: 'quota-zero', title: 'AI quota 0: every AI button dimmed', covers: ['quota-zero'] }, (ctx) => ({
    views: [
      entry(
        DOCK,
        dock(ctx, 'ready', {
          quota: { remaining: 0, low: true, resetsAt: iso(ctx.now + 17 * 60 * MIN) },
          mark: 'faint',
          actions: dockActions(ctx, { off: reason('quota-zero', { time: { time: ctx.now + 17 * 60 * MIN } }) }),
          result: failedResult(ctx, OP.reply, 'reply', cgError(ctx, 'CG-QUOTA-DAILY', { retryAt: ctx.now + 17 * 60 * MIN, detail: 'HTTP 429 • quota_denied' }), []),
        }),
      ),
    ],
  })),
];

// ── generation in the dock ──

const streamingDock = (ctx: ScenarioCtx, r: ResultVM) => dock(ctx, 'ready', { result: r, actionsOptions: { busy: 'reply' } });

const GENERATION: AppClientScenario[] = [
  make({ id: 'streaming', title: 'Reply streams: stage line, preliminary text, then parts', covers: ['streaming', 'keys-footer'] }, (ctx) => {
    const start = ctx.now;
    const stage = (state: ResultVM['state'], done: Parameters<typeof phase>[2], current: Parameters<typeof phase>[3], text: string | null) =>
      result(ctx, { opId: OP.reply, feature: 'reply', state, startedAt: start, phase: phase(OP.reply, start, done, current), streamText: text, draftNotSent: false });
    return {
      views: [entry(DOCK, streamingDock(ctx, stage('admitted', [], 'context', null)))],
      steps: [
        { label: 'requesting', at: 300, views: [entry(DOCK, streamingDock(ctx, stage('requesting', ['context'], 'thinking', null)))] },
        { label: 'first chunk', at: 1_400, views: [entry(DOCK, streamingDock(ctx, stage('streaming', ['context', 'thinking'], 'writing', 'Hey you, I was')))] },
        { label: 'more text', at: 2_200, views: [entry(DOCK, streamingDock(ctx, stage('streaming', ['context', 'thinking'], 'writing', 'Hey you, I was just thinking about you [NEXT] Got something')))] },
        { label: 'done', at: 3_800, views: [entry(DOCK, dock(ctx, 'ready', { result: doneReply(ctx), keysFooter: true, actionsOptions: { active: 'reply' } }))] },
      ],
      reactions: [{ on: 'Generate', receipt: { ok: true, type: 'Generate', outcome: 'started', opId: OP.reply }, thenStep: 0 }],
    };
  }),
  make({ id: 'retry-503', title: 'One transparent retry after 503 before any output', covers: ['streaming'] }, (ctx) => ({
    views: [
      entry(
        DOCK,
        streamingDock(ctx, result(ctx, { opId: OP.reply, feature: 'reply', state: 'requesting', phase: phase(OP.reply, ctx.now - 2_000, ['context'], 'retry-wait', ctx.now + 5_000), draftNotSent: false })),
      ),
    ],
  })),
  make({ id: 'three-running-fourth-refused', title: 'Three generations run, the fourth is refused with the list', covers: ['three-running-fourth-refused', 'palette-search'] }, (ctx) => {
    const list = [running(ctx, FANS.theodore, 'reply', 14, OP.other1), running(ctx, FANS.marco, 'recap', 40, OP.other2), running(ctx, FANS.jake, 'hi', 6, OP.other3)];
    const refusal = cgError(ctx, 'CG-OP-TAB-LIMIT');
    return {
      views: [
        entry(DOCK, dock(ctx, 'ready', { refusal: { feature: 'reply', error: refusal, running: list }, runningElsewhere: list })),
        entry({ of: 'palette' }, palette(ctx, views.ready())),
      ],
      reactions: [{ on: 'Generate', receipt: { ok: false, type: 'Generate', code: 'CG-OP-TAB-LIMIT', error: refusal, running: list } }],
    };
  }),
  make({ id: 'late-result', title: 'A result arrives for another chat: «AI готово · fan»', covers: ['late-result', 'toasts'] }, (ctx) => ({
    views: [
      entry(DOCK, dock(ctx, 'ready', { runningElsewhere: [running(ctx, FANS.theodore, 'reply', 14, OP.late)] })),
      entry({ of: 'toasts' }, toasts(views.empty(msg('common.empty')), [])),
    ],
    steps: [
      {
        label: 'done elsewhere',
        at: 6_000,
        views: [entry(DOCK, dock(ctx, 'ready')), entry({ of: 'toasts' }, toasts(views.ready(), [aiReadyToast(ctx, FANS.theodore.name, handles.dock(FANS.theodore))]))],
      },
    ],
  })),
  make({ id: 'human-draft-conflict', title: 'The composer has the person\'s text (Б2), then it changes', covers: ['human-draft-conflict', 'inserted-collapsed'] }, (ctx) => {
    const confirm = (kind: 'human-draft' | 'draft-changed', formatLoss: boolean) =>
      doneReply(ctx, { confirm: { confirmationId: uuid(201), kind, part: { index: 0 }, formatLoss } });
    return {
      views: [entry(DOCK, dock(ctx, 'ready', { result: confirm('human-draft', false) }))],
      steps: [
        { label: 'draft changed, no editor', at: 3_000, views: [entry(DOCK, dock(ctx, 'ready', { result: confirm('draft-changed', true) }))] },
        {
          label: 'appended',
          at: 5_000,
          views: [
            entry(
              DOCK,
              dock(ctx, 'ready', {
                result: doneReply(ctx, { parts: parts(OP.reply, REPLY_TEXTS, (i) => (i === 0 ? { insert: 'done', collapsed: true, next: false } : { next: i === 1 })), meta: [meta.parts(3), meta.inserted(1, 3)] }),
              }),
            ),
          ],
        },
      ],
      reactions: [
        { on: 'InsertPart', receipt: { ok: true, type: 'InsertPart', outcome: 'needs-confirm' } },
        { on: 'AnswerConfirm', receipt: { ok: true, type: 'AnswerConfirm', outcome: 'done' }, thenStep: 1 },
      ],
    };
  }),
  make({ id: 'timeout', title: 'The hub did not answer in time; the board did not build', covers: ['timeout'] }, (ctx) => ({
    views: [
      entry(DOCK, dock(ctx, 'ready', { result: failedResult(ctx, OP.reply, 'reply', cgError(ctx, 'CG-HUB-TIMEOUT', { detail: 'no first chunk in 30 s' }), [again(OP.reply)]) })),
      entry({ of: 'spenders.board' }, board(ctx, views.error(cgError(ctx, 'CG-DATA-TIMEOUT'), { type: 'ReloadView', selector: { of: 'spenders.board' } }))),
    ],
  })),
  make({ id: 'provider-rate-limit', title: 'AI overloaded: retry after a fixed deadline, by hand', covers: ['provider-rate-limit'] }, (ctx) => {
    const failed = (enabled: boolean) =>
      failedResult(ctx, OP.reply, 'reply', cgError(ctx, 'CG-PROVIDER-RATE-LIMIT', { retryAt: ctx.now + 24_000, detail: 'HTTP 429 • provider_rate_limited • retry in 24 s' }), [
        button('common.retry', { type: 'Regenerate', operationId: OP.reply }, enabled ? {} : { enabled: false, reason: reason('wait-until', { n: 24 }) }),
      ]);
    return {
      views: [entry(DOCK, dock(ctx, 'ready', { result: failed(false) }))],
      steps: [{ label: 'deadline passed', at: 24_000, views: [entry(DOCK, dock(ctx, 'ready', { result: failed(true) }))] }],
    };
  }),
  make({ id: 'interrupted', title: 'The browser cut the stream: interrupted, never re-posted', covers: ['interrupted'] }, (ctx) => ({
    views: [
      entry(
        DOCK,
        dock(ctx, 'ready', {
          result: result(ctx, { opId: OP.reply, feature: 'reply', state: 'interrupted', error: cgError(ctx, 'CG-OP-INTERRUPTED'), errorActions: [again(OP.reply)], draftNotSent: false, meta: [msg('result.meta.failed')] }),
        }),
      ),
    ],
  })),
  make({ id: 'hi-variants', title: 'Hi: three variants of two parts, one part inserted', covers: ['variants-and-parts', 'inserted-collapsed', 'keys-footer'] }, (ctx) => ({
    views: [
      entry(
        DOCK,
        dock(ctx, 'ready', {
          keysFooter: true,
          actionsOptions: { active: 'hi' },
          result: result(ctx, {
            opId: OP.hi,
            feature: 'hi',
            state: 'done',
            variants: variants(OP.hi, HI_TEXTS, (v, i) => (v === 0 && i === 0 ? { insert: 'done', collapsed: true, next: false } : v === 0 && i === 1 ? { next: true } : { next: false })),
            meta: [meta.variants(3), meta.partsEach(2), meta.inserted(1, 2)],
          }),
        }),
      ),
    ],
  })),
  make({ id: 'split-parts', title: 'Reply in three parts, the first inserted; result on a sheet', covers: ['variants-and-parts', 'inserted-collapsed', 'result-style-sheet'] }, (ctx) => ({
    views: [
      entry(
        DOCK,
        dock(ctx, 'ready', {
          resultStyle: 'sheet',
          result: doneReply(ctx, {
            parts: parts(OP.reply, REPLY_TEXTS, (i) => (i === 0 ? { insert: 'done', collapsed: true, next: false } : { next: i === 1 })),
            meta: [meta.tone('flirty'), meta.parts(3), meta.inserted(1, 3)],
            toneUsed: 'flirty',
          }),
        }),
      ),
    ],
  })),
  make({ id: 'one-part-and-unparsed', title: 'One message with Split off; Split asked but one part came; unparsed; Cyrillic gate', covers: ['one-part', 'unparsed'] }, (ctx) => {
    const one = (splitRequested: boolean) =>
      doneReply(ctx, { parts: parts(OP.reply, [REPLY_TEXTS[0] ?? '']), splitRequested, meta: splitRequested ? [meta.onePart()] : [] });
    return {
      views: [entry(DOCK, dock(ctx, 'ready', { result: one(false) }))],
      steps: [
        { label: 'split asked, one part', at: 1_000, views: [entry(DOCK, dock(ctx, 'ready', { options: { ...dock(ctx).options, split: true }, result: one(true) }))] },
        {
          label: 'unparsed',
          at: 2_000,
          views: [
            entry(
              DOCK,
              dock(ctx, 'ready', {
                result: doneReply(ctx, {
                  parts: [part(0, 'Hey [VARIANT] broken markers', { opId: OP.reply, numbered: false, next: true, insertBlocked: reason('unparsed') })],
                  meta: [meta.unparsed()],
                  unparsed: true,
                }),
              }),
            ),
          ],
        },
        {
          label: 'cyrillic draft for a latin fan',
          at: 3_000,
          views: [entry(DOCK, dock(ctx, 'ready', { result: doneReply(ctx, { parts: parts(OP.reply, ['Привет, как прошли выходные?'], () => ({ insertBlocked: reason('language') })), splitRequested: false, meta: [] }) }))],
        },
      ],
    };
  }),
  make({ id: 'insert-and-copy-outcomes', title: 'Insert pending and copied; insert failed; chat changed; copy failed', covers: ['inserted-collapsed'] }, (ctx) => {
    const withParts = (patch: (index: number) => Partial<PartVM>) => dock(ctx, 'ready', { result: doneReply(ctx, { parts: parts(OP.reply, REPLY_TEXTS, patch) }) });
    return {
      views: [entry(DOCK, withParts((i) => (i === 0 ? { insert: 'pending' } : i === 1 ? { copy: 'done' } : {})))],
      steps: [
        { label: 'insert failed', at: 500, views: [entry(DOCK, withParts((i) => (i === 0 ? { insert: 'failed', insertError: cgError(ctx, 'CG-INSERT-FAILED') } : {})))] },
        { label: 'chat changed', at: 1_000, views: [entry(DOCK, withParts((i) => (i === 0 ? { insert: 'failed', insertError: cgError(ctx, 'CG-INSERT-CHAT-CHANGED') } : {})))] },
        { label: 'copy failed', at: 1_500, views: [entry(DOCK, withParts((i) => (i === 1 ? { copy: 'failed', copyError: cgError(ctx, 'CG-CLIPBOARD') } : {})))] },
      ],
      reactions: [{ on: 'Copy', receipt: { ok: false, type: 'Copy', code: 'CG-CLIPBOARD', error: cgError(ctx, 'CG-CLIPBOARD') }, thenStep: 2 }],
    };
  }),
  make({ id: 'fix', title: 'Fix: replace my draft, restore for 30 s, then expired', covers: ['fix'] }, (ctx) => {
    const fix = (patch: Partial<NonNullable<ResultVM['fix']>>, draftNotSent: boolean) =>
      result(ctx, {
        opId: OP.fix,
        feature: 'fix',
        state: 'done',
        parts: parts(OP.fix, ['hey, sorry I was late — missed you']),
        meta: [],
        draftNotSent,
        fix: { sourceDraft: 'hey sorry late missed u', canReplace: true, replaceReason: null, replaced: false, restoreUntil: null, restoreExpired: false, ...patch },
      });
    return {
      views: [entry(DOCK, dock(ctx, 'ready', { result: fix({}, true), actionsOptions: { active: 'fix' } }))],
      steps: [
        { label: 'replaced', at: 1_000, views: [entry(DOCK, dock(ctx, 'ready', { result: fix({ replaced: true, restoreUntil: ctx.now + 31_000 }, false) }))] },
        { label: 'restore expired', at: 31_000, views: [entry(DOCK, dock(ctx, 'ready', { result: fix({ replaced: true, restoreExpired: true }, false) }))] },
        { label: 'editor not verified', at: 32_000, views: [entry(DOCK, dock(ctx, 'ready', { result: fix({ canReplace: false, replaceReason: reason('draft-unverifiable') }, true) }))] },
      ],
      reactions: [{ on: 'ReplaceMyDraft', receipt: { ok: true, type: 'ReplaceMyDraft', outcome: 'done' }, thenStep: 0 }],
    };
  }),
];

// ── previews and X8 ──

const NINE: readonly PreviewSendView[] = [
  { s: 'available' },
  { s: 'unavailable', code: 'CG-SEND-HOST', reason: msg('send.reason.host') },
  { s: 'held-stale', at: iso(NOW - MIN) },
  { s: 'queued' },
  { s: 'sending' },
  { s: 'accepted' },
  { s: 'sent', at: iso(NOW - 2 * MIN) },
  { s: 'rejected', code: 'CG-SEND-GUARD', detail: 'Message Guard: links', canRetry: false },
  { s: 'uncertain', since: iso(NOW - 3 * MIN), attemptId: uuid(501) },
];

const previewResult = (ctx: ScenarioCtx, opId: string, feature: 'reply' | 'hi', texts: readonly string[], states: readonly PreviewSendView[], patch: Partial<ResultVM> = {}): ResultVM => {
  const sent = states.filter((s) => s.s === 'sent').length;
  const started = states.some((s) => s.s !== 'available' && s.s !== 'unavailable' && s.s !== 'held-stale');
  const inWork = states.some((s) => s.s === 'queued' || s.s === 'sending' || s.s === 'accepted');
  // An unknown outcome holds nothing (2026-10-20 audit, row 2): only a part on its way keeps «Ещё раз» off.
  const blocked = inWork ? reason('parts-sending') : null;
  return result(ctx, {
    opId,
    feature,
    state: 'done',
    surface: feature === 'hi' ? 'newcomers' : 'preview',
    parts: sendParts(opId, texts, states),
    meta: [meta.parts(texts.length)],
    splitRequested: texts.length > 1,
    draftNotSent: !started,
    sendProgress: started ? { sent, total: texts.length } : null,
    canRegenerate: blocked === null,
    regenerateReason: blocked,
    ...patch,
  });
};

const X8: AppClientScenario[] = [
  make({ id: 'x8-gallery', title: 'All nine «Отправить» states side by side (stand gallery)', covers: ['x8-states'] }, (ctx) => {
    const gallery9 = result(ctx, {
      opId: OP.preview,
      feature: 'reply',
      state: 'done',
      surface: 'preview',
      parts: NINE.map((send, index) =>
        part(index, `Part ${index + 1}: ${send.s}`, {
          opId: OP.preview,
          send,
          sendOrder: null,
          collapsed: send.s === 'sent',
          openInsert: send.s === 'uncertain' ? { s: 'hidden' } : { s: 'available' },
        }),
      ),
      meta: [meta.sent(1, 9)],
      draftNotSent: false,
      sendProgress: { sent: 1, total: 9 },
      canRegenerate: false,
      regenerateReason: reason('parts-sending'),
    });
    return { views: [entry(SPENDERS_PREVIEW, withResult(preview(ctx, 'spenders', views.ready()), gallery9, { unread: 'read-after-send', fanWroteNew: true }))] };
  }),
  make({ id: 'x8-lifecycle', title: 'Send part 1 through the queue to «Отправлено»; part 2 rejected by the queue', covers: ['x8-states'] }, (ctx) => {
    const texts = REPLY_TEXTS.slice(0, 2);
    const at = (states: readonly PreviewSendView[]) =>
      entry(SPENDERS_PREVIEW, withResult(preview(ctx, 'spenders', views.ready()), previewResult(ctx, OP.preview, 'reply', texts, states), { unread: states[0]?.s === 'available' ? 'kept' : 'read-after-send' }));
    return {
      views: [at([{ s: 'available' }, { s: 'available' }])],
      steps: [
        { label: 'sending', at: 100, views: [at([{ s: 'sending' }, { s: 'available' }])] },
        { label: 'queued', at: 300, views: [at([{ s: 'queued' }, { s: 'available' }])] },
        { label: 'accepted', at: 900, views: [at([{ s: 'accepted' }, { s: 'available' }])] },
        { label: 'sent', at: 1_600, views: [at([{ s: 'sent', at: iso(NOW + 1_600) }, { s: 'available' }])] },
        { label: 'part 2 refused by the queue, retry allowed', at: 9_000, views: [at([{ s: 'sent', at: iso(NOW + 1_600) }, { s: 'rejected', code: 'CG-SEND-QUEUE', canRetry: true }])] },
      ],
      reactions: [{ on: 'SendPart', receipt: { ok: true, type: 'SendPart', outcome: 'started', attemptId: uuid(502) }, thenStep: 0 }],
    };
  }),
  make({ id: 'x8-held-stale', title: 'The fan wrote after the answer: the send is held', covers: ['x8-states', 'archive-partial'] }, (ctx) => ({
    views: [
      entry(
        SPENDERS_PREVIEW,
        withResult(
          preview(ctx, 'spenders', views.partial({ kind: 'archive-lag', messages: 1, minutes: 2 }), { archive: { ...preview(ctx, 'spenders', views.ready()).archive, lagMinutes: 2 } }),
          previewResult(ctx, OP.preview, 'reply', REPLY_TEXTS.slice(0, 2), [{ s: 'held-stale', at: iso(NOW - MIN) }, { s: 'available' }], { stale: { reason: 'fan-wrote', at: iso(NOW - MIN) } }),
          { fanWroteNew: true },
        ),
      ),
    ],
  })),
  make({ id: 'archive-empty', title: 'A new fan with an empty archive', covers: ['archive-empty'] }, (ctx) => ({
    views: [
      entry(
        NEWCOMERS_PREVIEW,
        preview(ctx, 'newcomers', views.empty(msg('preview.feed.emptySubscribed', { name: FANS.tomasz.name, age: { age: ctx.now - 14 * MIN } })), { claim: { s: 'none' } }),
      ),
      entry({ of: 'recap.view' }, recapView(ctx, views.empty(msg('cg.recapNotFound.title')), 'short')),
    ],
  })),
];

// ── «Новые»: a colleague's send, an unknown outcome ──

const NEWCOMERS_LIST = { of: 'newcomers' } as const;

const LEASE: AppClientScenario[] = [
  make({ id: 'newcomers-replied', title: 'The fan has already written: the row stays to work with', covers: [] }, (ctx) => ({
    views: [
      entry(NEWCOMERS_LIST, newcomers(ctx, views.ready(), [
        newcomerRow(ctx, FANS.tomasz, 'new', 14, { s: 'replied' }),
      ])),
    ],
  })),
  make({ id: 'colleague-sending', title: 'A colleague\'s part is on its way: a quiet note, Hi stays on', covers: ['colleague-sending'] }, (ctx) => {
    const rows = defaultNewcomerRows(ctx).map((r) => ({ ...r, selected: r.name === FANS.leo.name }));
    return {
      views: [
        entry(NEWCOMERS_LIST, newcomers(ctx, views.ready(), rows)),
        entry(NEWCOMERS_PREVIEW, preview(ctx, 'newcomers', views.ready(), { fan: FANS.leo, claim: { s: 'none' }, greeting: { s: 'sending-other' } })),
      ],
      steps: [
        {
          label: 'the fan row changed',
          at: 2_000,
          views: [entry(NEWCOMERS_PREVIEW, preview(ctx, 'newcomers', views.ready(), { claim: { s: 'row-changed', error: cgError(ctx, 'CG-CLAIM-ROW-CHANGED') } }))],
        },
      ],
    };
  }),
  make({ id: 'claim-uncertain', title: 'Part 2 of a greeting is not confirmed: said, holding nothing — open the chat, send again', covers: ['claim-uncertain', 'x8-states'] }, (ctx) => {
    const texts = ['Hi Tomasz, welcome!', 'So happy you are here', 'I have a little gift for you'];
    const rows = [newcomerRow(ctx, FANS.tomasz, 'new', 14, { s: 'stopped', sent: 1, total: 3, part: 2 }, { selected: true }), ...defaultNewcomerRows(ctx).slice(1)];
    return {
      views: [
        entry(NEWCOMERS_LIST, newcomers(ctx, views.ready(), rows)),
        entry(
          NEWCOMERS_PREVIEW,
          withResult(
            preview(ctx, 'newcomers', views.ready(), {
              claim: { s: 'held-uncertain', part: 2, error: cgError(ctx, 'CG-SEND-UNCERTAIN') },
              greeting: { s: 'stopped', sent: 1, total: 3, part: 2 },
            }),
            previewResult(ctx, OP.greet, 'hi', texts, [{ s: 'sent', at: iso(NOW - 4 * MIN) }, { s: 'uncertain', since: iso(NOW - 3 * MIN), attemptId: uuid(503) }, { s: 'available' }]),
            { unread: 'read-after-send' },
          ),
        ),
      ],
      reactions: [{ on: 'OpenChatToVerify', receipt: { ok: true, type: 'OpenChatToVerify', outcome: 'opened' } }],
    };
  }),
  make({ id: 'newcomers-greeting', title: '«Новые»: Hi sent 1 of 3, part 2 in ChatSpace\'s queue, part 3 after it', covers: ['x8-states'] }, (ctx) => ({
    views: [
      entry(NEWCOMERS_LIST, newcomers(ctx, views.ready(), defaultNewcomerRows(ctx))),
      entry(
        NEWCOMERS_PREVIEW,
        withResult(
          preview(ctx, 'newcomers', views.ready(), { claim: { s: 'none' }, greeting: { s: 'sending', sent: 1, total: 3 } }),
          previewResult(ctx, OP.greet, 'hi', ['Hi Tomasz, welcome!', 'So happy you are here', 'I have a little gift for you'], [{ s: 'sent', at: iso(NOW - MIN) }, { s: 'queued' }, { s: 'available' }], {
            meta: [meta.variants(1), meta.parts(3), meta.sent(1, 3)],
          }),
          { unread: 'read-after-send' },
        ),
      ),
    ],
  })),
];

// ── Recap, Coach (and its Review), lists ──

const ANALYSIS: AppClientScenario[] = [
  make({ id: 'recap-short', title: 'Short Recap from the hub, saved', covers: ['recap-short'] }, (ctx) => ({
    views: [
      entry(DOCK, dock(ctx, 'ready', { analysis: 'recap', actionsOptions: { active: 'recap', recapReady: true } })),
      entry({ of: 'recap.picker' }, recapPicker(ctx, views.ready())),
      entry({ of: 'recap.view' }, recapView(ctx, views.ready(), 'short')),
    ],
  })),
  make({ id: 'recap-full', title: 'Full Recap, the archive lags the chat by 2 messages; fan panel Recap tab', covers: ['recap-full', 'archive-partial'] }, (ctx) => ({
    views: [
      entry(DOCK, dock(ctx, 'ready', { analysis: 'recap', actionsOptions: { active: 'recap' } })),
      entry({ of: 'recap.view' }, recapView(ctx, views.partial({ kind: 'archive-lag', messages: 2, minutes: null }), 'full')),
      entry({ of: 'fan-panel' }, fanPanel(ctx, views.ready(), { tab: 'recap' })),
    ],
    steps: [
      {
        label: 'saving failed',
        at: 4_000,
        views: [
          entry(
            { of: 'recap.view' },
            recapView(ctx, views.partial({ kind: 'archive-lag', messages: 2, minutes: null }), 'full', {
              saved: { s: 'failed', error: cgError(ctx, 'CG-RECAP-SAVE'), retry: { type: 'RetryRecapSave', length: 'full' } },
            }),
          ),
        ],
      },
    ],
  })),
  make({ id: 'recap-generating', title: 'Recap being built', covers: ['recap-full', 'streaming'] }, (ctx) => ({
    views: [
      entry(DOCK, dock(ctx, 'ready', { analysis: 'recap', actionsOptions: { busy: 'recap' } })),
      entry(
        { of: 'recap.view' },
        recapView(ctx, views.loading(ctx.now - 3_000, msg('result.stage.context')), 'full', { opId: uuid(601), state: 'streaming', phase: phase(uuid(601), ctx.now - 3_000, ['context'], 'writing'), streamText: '## Кто он\nHubert, 34' }),
      ),
    ],
  })),
  make({ id: 'review', title: 'Review 7/10 as a turn of Coach, a question about it after', covers: ['review', 'coach'] }, (ctx) => ({
    views: [entry({ of: 'coach' }, coach(ctx, views.ready(), [coachReviewTurn(ctx, 1), coachTurn(ctx, 2)]))],
  })),
  make({ id: 'coach-session', title: 'Coach: two turns, the second answering', covers: ['coach'] }, (ctx) => ({
    views: [
      entry(
        { of: 'coach' },
        coach(ctx, views.ready(), [
          coachTurn(ctx, 1),
          coachTurn(ctx, 2, { state: 'streaming', answer: null, sentToCoach: false, streamText: 'If he asks about a discount', phase: phase(uuid(402), ctx.now - 2_000, ['context'], 'writing') }),
        ], { ask: { enabled: false, reason: reason('coach-busy'), attachDraft: { available: true, reason: null } } }),
      ),
    ],
  })),
  make({ id: 'stats-error', title: 'The board works, the statistics failed', covers: ['stats-error'] }, (ctx) => ({
    views: [
      entry({ of: 'spenders.board' }, board(ctx, views.ready(), { previewOpen: true })),
      entry({ of: 'spenders.stats' }, stats(ctx, views.error(cgError(ctx, 'CG-DATA-UNAVAILABLE', { detail: 'HTTP 503 • stats' }), { type: 'ReloadView', selector: { of: 'spenders.stats' } }))),
      entry(SPENDERS_PREVIEW, preview(ctx, 'spenders', views.ready())),
    ],
  })),
  make({ id: 'palette-search', title: 'Palette search over loaded chats', covers: ['palette-search'] }, (ctx) => ({
    views: [
      entry(
        { of: 'palette' },
        palette(ctx, views.ready(), {
          query: 'hub',
          groups: [
            {
              id: 'chats',
              title: msg('palette.group.chats'),
              items: [{ id: 'c-1', label: FANS.hubert.name, sublabel: `@${FANS.hubert.username}`, match: [[0, 3]], hotkey: null, money: 12_480_000, waitingSince: iso(NOW - 7 * MIN), runningSince: null, enabled: true, reason: null, action: { type: 'Navigate', to: { kind: 'chat', targetHandle: handles.dock(FANS.hubert) } } }],
            },
          ],
        }),
      ),
    ],
  })),
];

// ── debug, languages, themes ──

const debugResult = (ctx: ScenarioCtx): ResultVM =>
  doneReply(ctx, {
    expanded: true,
    debug: {
      costLine: 'in 3 412 tok • out 286 tok • $0.0143 • 3.8 s • model-test',
      stages: [
        { name: 'request', ms: 38 },
        { name: 'meta', ms: 312 },
        { name: 'first-chunk', ms: 1_120 },
        { name: 'stream', ms: 2_041 },
        { name: 'parse', ms: 6 },
        { name: 'render', ms: 9 },
      ],
      totalMs: 3_526,
      hubStages: [
        { name: 'context', ms: 182 },
        { name: 'provider', ms: 3_106 },
      ],
      prompt: { type: 'Navigate', to: { kind: 'debug-prompt', promptHandle: 'snap-1' } },
      reasoning: null,
      context: { source: 'union', coverage: 'complete', windowRequested: 100, windowServed: 100, liveAccepted: 3, liveRejected: 0 },
      liveTimer: false,
    },
  });

const LOOKS: AppClientScenario[] = [
  make({ id: 'debug-on', title: 'Debug mode: cost line, profiler, prompt link, journals', covers: ['debug-on'], debug: true }, (ctx) => ({
    views: [entry(DOCK, dock(ctx, 'ready', { result: debugResult(ctx) })), entry({ of: 'popup' }, popup(ctx, views.ready())), entry({ of: 'options', section: 'diagnostics' }, options(ctx, 'diagnostics', views.ready()))],
  })),
  make({ id: 'debug-off', title: 'The same result without debug', covers: ['debug-off'] }, (ctx) => ({
    views: [entry(DOCK, dock(ctx, 'ready', { result: { ...debugResult(ctx), debug: null } })), entry({ of: 'popup' }, popup(ctx, views.ready()))],
  })),
  make({ id: 'en-dark', title: 'English, dark, Windows labels', covers: ['en', 'theme-dark', 'toasts'], lang: 'en', scheme: 'dark', theme: 'dark' }, (ctx) => ({
    views: [
      ...gallery(ctx, 'ready'),
      entry(DOCK, dock(ctx, 'ready', { options: { ...dock(ctx).options, tone: 'flirty' }, result: doneReply(ctx, { toneUsed: 'flirty', meta: [meta.tone('flirty'), meta.parts(3)] }) })),
      entry({ of: 'toasts' }, toasts(views.ready(), [toast(ctx, 'toast-err', 'error', { code: 'CG-NAV-FAILED', title: cgError(ctx, 'CG-NAV-FAILED').title, copyCode: true }), aiReadyToast(ctx, FANS.marco.name, handles.dock(FANS.marco))])),
    ],
  })),
  make({ id: 'ru-dark-system', title: 'Russian, dark from the system setting', covers: ['ru', 'theme-dark', 'options'], scheme: 'dark', theme: 'system' }, (ctx) => ({
    views: [
      entry(DOCK, dock(ctx, 'ready', { quota: { remaining: 3, low: true, resetsAt: iso(ctx.now + 60 * MIN) } })),
      entry(
        { of: 'options', section: 'appearance' },
        options(ctx, 'appearance', views.ready(), {
          patch: {
            save: { s: 'saved', revision: 7 },
            checklist: {
              steps: [
                { id: 'sign-in', label: msg('settings.onboarding.signIn'), done: true, action: null },
                { id: 'consent', label: msg('settings.onboarding.consent'), done: false, action: button('settings.status.consentAsk', { type: 'RequestPermission', kind: 'data-collection' }) },
              ],
              dismiss: { type: 'SetPreference', key: 'onboarding.checklistDismissed', value: true },
            },
          },
        }),
      ),
    ],
  })),
  make({ id: 'en-light', title: 'English, forced light theme, macOS labels', covers: ['en', 'theme-light'], lang: 'en', platform: 'mac', theme: 'light' }, (ctx) => ({
    views: [entry(DOCK, dock(ctx, 'ready')), galleryEntry(ctx, { of: 'cheatsheet' }, 'ready')],
  })),
];

export const APP_CLIENT_SCENARIOS: readonly AppClientScenario[] = [...GALLERY, ...ACCESS, ...GENERATION, ...X8, ...LEASE, ...ANALYSIS, ...LOOKS];

export function scenarioById(id: string): AppClientScenario {
  const found = APP_CLIENT_SCENARIOS.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no AppClient scenario "${id}"`);
  return found;
}
