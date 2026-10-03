import { DEBUG_LIMITS } from '@cg/contracts/limits';
import { type HubFrame } from '@cg/contracts/hub';
import { OpDebugViewSchema } from '@cg/contracts/ops';
import { DEFAULT_SETTINGS } from '@cg/contracts/settings';
import { PromptSnapshotViewSchema } from '@cg/contracts/tab-messages';
import { describe, expect, it } from 'vitest';

import { createTranslator } from '../i18n';
import { createLogger } from '../logging';
import {
  CLIENT_STAGES,
  LocalSpendJournal,
  OpDebugBuilder,
  PROFILE_SEGMENTS,
  PROMPT_VIEW_MAX_BLOCKS,
  REASONING_MAX_CHARS,
  ReasoningBuffer,
  SEGMENT_LABEL_KEYS,
  SPEND_DAYS_KEPT,
  StageMarks,
  TRUNCATED_MARK,
  advancedAccountInfo,
  contextCard,
  createRenderTrace,
  cutText,
  debugFeatures,
  formatCostLine,
  formatMicroUsd,
  hubStageSummary,
  hubStagesFromManifest,
  isTruncatedText,
  maskedTail,
  profileOf,
  promptView,
  showDebugBlock,
  snapshotFromFrame,
  usageOf,
  withDebugCapability,
  type DebugInputFrame,
  type UsageFrame,
} from './index';

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const GEN = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const ru = createTranslator('ru');
const en = createTranslator('en');

const debugOn = { debug: { enabled: true, renderTrace: false } };

function usageFrame(over: Partial<UsageFrame['usage']> = {}): UsageFrame {
  return {
    type: 'usage',
    usage: { inputTokens: 3412, outputTokens: 286, cacheWriteTokens: 0, cacheReadTokens: 3000, costMicroUsd: 14_300, costApproximate: false, ...over },
    providerResponseId: null,
    cacheHit: false,
  };
}

function frame(over: Partial<DebugInputFrame> = {}): DebugInputFrame {
  return {
    type: 'debug_input_v1',
    systemBlocks: [{ text: 'synthetic system block', cache: '1h' }],
    userBlocks: [{ text: 'synthetic user block', cache: 'none' }],
    contextManifest: { stages: [{ name: 'prompt-build', ms: 182 }] },
    ...over,
  };
}

describe('[ST-097] [DB-001] one switch turns debug mode on', () => {
  it('[ST-097] off by default: no logs, echo, profiler, journals or money', () => {
    const off = debugFeatures(DEFAULT_SETTINGS);
    expect(Object.values(off).every((on) => !on)).toBe(true);
  });

  it('[DB-001] on: logs, echo, profiler, usage, reasoning, context, journals, contract, spend, popup cost', () => {
    const on = debugFeatures(debugOn);
    expect(on).toEqual({
      enabled: true,
      consoleDebug: true,
      promptEcho: true,
      profiler: true,
      usageLine: true,
      reasoning: true,
      contextCard: true,
      journals: true,
      hostContractDetails: true,
      spendJournal: true,
      popupCost: true,
      renderTrace: false,
    });
  });
});

describe('[DB-002] the echo is asked for only in debug mode', () => {
  it('[DB-002] adds debug-input-v1 once, removes it when debug is off', () => {
    expect(withDebugCapability(['context-v1'], true)).toEqual(['context-v1', 'debug-input-v1']);
    expect(withDebugCapability(['debug-input-v1', 'context-v1'], true)).toEqual(['context-v1', 'debug-input-v1']);
    expect(withDebugCapability(['debug-input-v1', 'split-all-v1'], false)).toEqual(['split-all-v1']);
  });
});

describe('[DB-005] prompt snapshot limits', () => {
  it('[DB-005] cuts blocks at 500 000 and the manifest at 100 000 characters, marked', () => {
    const big = 'x'.repeat(DEBUG_LIMITS.promptBlockMaxChars + 10);
    const manifest = { blob: 'y'.repeat(DEBUG_LIMITS.promptManifestMaxChars) };
    const content = snapshotFromFrame(frame({ systemBlocks: [{ text: big, cache: '5m' }], contextManifest: manifest }), { feature: 'reply', capturedAt: T0 });
    const [system, user] = content.blocks;
    expect(system?.text.length).toBe(DEBUG_LIMITS.promptBlockMaxChars);
    expect(system?.truncated).toBe(true);
    expect(system && isTruncatedText(system.text)).toBe(true);
    expect(system?.name).toBe('system 1 · cache 5m');
    expect(user).toMatchObject({ name: 'user 1 · cache none', truncated: false, text: 'synthetic user block' });
    expect(content.manifest?.length).toBe(DEBUG_LIMITS.promptManifestMaxChars);
    expect(content.manifestTruncated).toBe(true);
    expect(content.chars).toBe(DEBUG_LIMITS.promptBlockMaxChars + 'synthetic user block'.length + DEBUG_LIMITS.promptManifestMaxChars);
    expect(PromptSnapshotViewSchema.safeParse(promptView('ok', content)).success).toBe(true);
  });

  it('[DB-005] merges more than 32 blocks per side, never drops one', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ text: `block ${i}`, cache: i === 0 ? ('1h' as const) : ('none' as const) }));
    const content = snapshotFromFrame(frame({ systemBlocks: many, contextManifest: null }), { feature: null, capturedAt: T0 });
    expect(content.blocks).toHaveLength(2);
    expect(content.blocks[0]?.name).toBe('system ×40 · cache 1h/none');
    expect(content.blocks[0]?.text).toContain('block 39');
    expect(content.manifest).toBeNull();
    expect(PROMPT_VIEW_MAX_BLOCKS).toBe(32);
    const view = promptView('ok', content);
    expect(view.blocks.length).toBeLessThanOrEqual(PROMPT_VIEW_MAX_BLOCKS);
  });

  it('[DB-005] cutting never splits a surrogate pair and keeps short texts whole', () => {
    expect(cutText('abc', 3)).toEqual({ text: 'abc', truncated: false });
    const emoji = `${'a'.repeat(20)}😀😀😀`;
    const cut = cutText(emoji, 20 + TRUNCATED_MARK.length - 19);
    expect(cut.truncated).toBe(true);
    expect(cut.text.endsWith(TRUNCATED_MARK)).toBe(true);
    const odd = cutText(`a😀${'b'.repeat(40)}`, TRUNCATED_MARK.length + 2);
    expect(odd.text).toBe(`a${TRUNCATED_MARK}`);
  });

  it('[DB-005] an unserializable manifest is named, not thrown', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(snapshotFromFrame(frame({ contextManifest: cyclic }), { feature: 'fix', capturedAt: T0 }).manifest).toBe('"[unserializable manifest]"');
  });
});

describe('[DB-008] why there is no prompt', () => {
  it('[DB-008] echo off, from cache, expired and not found are honest states, not errors', () => {
    for (const state of ['echo-off', 'expired', 'not-found', 'debug-off'] as const) {
      const view = promptView(state, null);
      expect(view).toMatchObject({ state, blocks: [], manifest: null, capturedAt: null });
      expect(PromptSnapshotViewSchema.safeParse(view).success).toBe(true);
    }
    const cached = snapshotFromFrame(frame(), { feature: 'reply', capturedAt: T0, fromCache: true });
    expect(promptView('echo-off', cached)).toMatchObject({ state: 'echo-off', fromCache: true, capturedAt: '2026-10-03T12:00:00.000Z', feature: 'reply', blocks: [] });
    expect(promptView('ok', null).state).toBe('not-found');
    expect(promptView('ok', cached)).toMatchObject({ state: 'ok', fromCache: true });
  });
});

describe('[DB-009] the context card', () => {
  it('[DB-009] reads context_v1: reader, coverage, window and fresh-text counts', () => {
    const card = contextCard({
      type: 'context_v1',
      generationRef: GEN,
      source: 'union',
      servedHead: null,
      window: { requested: 100, served: 87 },
      coverage: 'partial',
      live: { status: 'served', accepted: 3, rejected: 1 },
    });
    expect(card).toEqual({ source: 'union', coverage: 'partial', windowRequested: 100, windowServed: 87, liveAccepted: 3, liveRejected: 1 });
  });
});

describe('[DB-011] [DB-012] [DB-013] the stage profiler', () => {
  it('[DB-011] client marks in stage order: the first mark wins, time never goes back', () => {
    const marks = new StageMarks();
    expect(marks.mark('click', T0)).toBe(true);
    expect(marks.mark('click', T0 + 50)).toBe(false);
    marks.mark('meta', T0 + 400);
    marks.mark('request', T0 + 30);
    expect(marks.mark('done', Number.NaN)).toBe(false);
    expect(marks.toStages()).toEqual([
      { name: 'click', at: T0 },
      { name: 'request', at: T0 + 400 },
      { name: 'meta', at: T0 + 400 },
    ]);
    expect(marks.at('parse')).toBeNull();
    expect(CLIENT_STAGES).toEqual(['click', 'request', 'meta', 'firstChunk', 'done', 'parse', 'render', 'insert']);
  });

  it('[DB-011] segments between marks, each with its catalog word', () => {
    const stages = [
      { name: 'click', at: T0 },
      { name: 'request', at: T0 + 38 },
      { name: 'meta', at: T0 + 350 },
      { name: 'firstChunk', at: T0 + 1200 },
      { name: 'done', at: T0 + 3500 },
      { name: 'parse', at: T0 + 3504 },
      { name: 'render', at: T0 + 3520 },
    ];
    const profile = profileOf(stages, 'done', T0 + 9999);
    expect(profile.segments.map((s) => [s.name, s.ms, s.status])).toEqual([
      ['request', 38, 'done'],
      ['meta', 312, 'done'],
      ['firstChunk', 850, 'done'],
      ['stream', 2300, 'done'],
      ['parse', 4, 'done'],
      ['render', 16, 'done'],
      ['insert', null, 'pending'],
    ]);
    expect(profile.totalMs).toBe(3520);
    for (const segment of PROFILE_SEGMENTS) expect(ru.text(SEGMENT_LABEL_KEYS[segment.name]).length).toBeGreaterThan(0);
  });

  it('[DB-012] while running, the open segment and the total grow with the live timer', () => {
    const stages = [
      { name: 'click', at: T0 },
      { name: 'request', at: T0 + 20 },
    ];
    const at100 = profileOf(stages, 'running', T0 + 100);
    const at200 = profileOf(stages, 'running', T0 + 200);
    expect(at100.segments[1]).toEqual({ name: 'meta', ms: 80, status: 'running' });
    expect(at200.segments[1]).toEqual({ name: 'meta', ms: 180, status: 'running' });
    expect(at200.totalMs).toBe(200);
    expect(at200.segments.slice(2).every((s) => s.status === 'pending')).toBe(true);
  });

  it('[DB-013] a failed operation names the failed stage; later ones stay pending', () => {
    const stages = [
      { name: 'click', at: T0 },
      { name: 'request', at: T0 + 20 },
      { name: 'meta', at: T0 + 300 },
    ];
    const profile = profileOf(stages, 'failed', T0 + 5000);
    expect(profile.segments.map((s) => s.status)).toEqual(['done', 'done', 'failed', 'pending', 'pending', 'pending', 'pending']);
    expect(profile.totalMs).toBe(300);
  });

  it('[DB-028] no click mark — no total; an unobserved stage is null, never zero', () => {
    const profile = profileOf([{ name: 'meta', at: T0 }], 'done', T0);
    expect(profile.totalMs).toBeNull();
    expect(profile.segments.every((s) => s.ms === null)).toBe(true);
  });
});

describe('[DB-014] the model’s reasoning', () => {
  it('[DB-014] reasoning deltas collect into the debug view, cut with a mark at 64 000', () => {
    const buffer = new ReasoningBuffer();
    expect(buffer.text()).toBeNull();
    buffer.append('');
    buffer.append('a'.repeat(REASONING_MAX_CHARS - 100));
    buffer.append('b'.repeat(500));
    buffer.append('c');
    const text = buffer.text() ?? '';
    expect(text.length).toBe(REASONING_MAX_CHARS);
    expect(text.endsWith(TRUNCATED_MARK)).toBe(true);
    expect(text.slice(0, -TRUNCATED_MARK.length).includes('c')).toBe(false);
    expect(buffer.truncated).toBe(true);
  });
});

describe('[DB-016] the hub’s own stages', () => {
  it('[DB-016] read from the manifest as a list, a record or under timings', () => {
    expect(hubStagesFromManifest({ stages: [{ name: 'summary-cache-check', ms: 12 }, { stage: 'prompt-build', durationMs: 170.04 }, { name: '', ms: 3 }, 'junk', { name: 'llm-ttfb', ms: -1 }] })).toEqual([
      { name: 'summary-cache-check', ms: 12 },
      { name: 'prompt-build', ms: 170 },
    ]);
    expect(hubStagesFromManifest({ timings: { 'llm-ttfb': 3106, 'llm-stream': 2041, 'prompt-build': 'slow' } })).toEqual([
      { name: 'llm-ttfb', ms: 3106 },
      { name: 'llm-stream', ms: 2041 },
    ]);
    expect(hubStagesFromManifest({ timingsMs: { 'llm-ttfb': 1, 'llm-ttfb ': 2 } })).toEqual([{ name: 'llm-ttfb', ms: 1 }]);
    expect(hubStagesFromManifest(null)).toEqual([]);
    expect(hubStagesFromManifest({ unrelated: true })).toEqual([]);
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`s${i}`, i]));
    expect(hubStagesFromManifest({ stages: many })).toHaveLength(16);
  });

  it('[DB-016] «хаб: context · provider · stream», unknown parts stay unknown', () => {
    expect(hubStageSummary([
      { name: 'summary-cache-check', ms: 12 },
      { name: 'prompt-build', ms: 170 },
      { name: 'llm-ttfb', ms: 3106 },
      { name: 'llm-stream', ms: 2041 },
    ])).toEqual({ context: 182, provider: 3106, stream: 2041 });
    expect(hubStageSummary([{ name: 'prompt-build', ms: 5 }])).toEqual({ context: 5, provider: null, stream: null });
    expect(hubStageSummary([])).toEqual({ context: null, provider: null, stream: null });
  });
});

describe('[DB-017] [DB-018] usage line', () => {
  it('[DB-017] «in · out · cache · $ · seconds · model», localized numbers', () => {
    const usage = usageOf(usageFrame());
    expect(formatCostLine({ usage, totalMs: 3760, model: 'model-synthetic' }, en)).toBe('in 3,412 tok • out 286 tok • cache r 3,000 / w 0 • $0.0143 • 3.8 s • model-synthetic');
    const line = formatCostLine({ usage, totalMs: 3760, model: null }, ru) ?? '';
    expect(line).toContain('3,8 с');
    expect(line).toMatch(/^in 3\s412 tok/);
    expect(formatCostLine({ usage: usageOf(usageFrame({ cacheReadTokens: 0 })), totalMs: null, model: '' }, en)).toBe('in 3,412 tok • out 286 tok • $0.0143');
    expect(formatMicroUsd(0)).toBe('$0.0000');
  });

  it('[DB-028] unknown usage is unknown, not zeros', () => {
    expect(usageOf(null)).toBeNull();
    expect(formatCostLine({ usage: null, totalMs: null, model: null }, ru)).toBeNull();
    expect(formatCostLine({ usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, costMicroUsd: null }, totalMs: Number.NaN, model: null }, ru)).toBeNull();
  });

  it('[DB-018] tokens and cost reach the op view from the usage frame', () => {
    expect(usageOf(usageFrame())).toEqual({ inputTokens: 3412, outputTokens: 286, cacheReadTokens: 3000, cacheWriteTokens: 0, costMicroUsd: 14_300 });
  });
});

describe('[DB-011] [DB-016] [DB-017] one operation’s debug view', () => {
  it('[DB-011] builds a valid OpDebugView frame by frame, the prompt only as a token', () => {
    const builder = new OpDebugBuilder(T0);
    builder.mark('request', T0 + 30);
    const frames: HubFrame[] = [
      {
        type: 'meta',
        requestId: GEN,
        clientRequestId: GEN,
        feature: 'reply',
        pageLabel: 'lora-of',
        model: 'model-synthetic',
        provider: 'synthetic',
        providerResponseId: null,
        quota: { accepted: true, remainingRequestsToday: 10, remainingMicroUsdToday: null },
      },
      { type: 'content_delta', text: '' },
      { type: 'reasoning_delta', text: 'thinking' },
      { type: 'content_delta', text: 'hello' },
      { type: 'context_v1', generationRef: GEN, source: 'archive', servedHead: null, window: { requested: 100, served: 100 }, coverage: 'complete', live: { status: 'none', accepted: 0, rejected: 0 } },
      frame(),
      usageFrame(),
      { type: 'done', stopReason: null },
    ];
    frames.forEach((f, i) => builder.onFrame(f, T0 + 300 + i * 100));
    builder.onFrame({ type: 'error', code: 'provider_stream_failed', message: 'synthetic', retryAfterMs: null }, T0 + 9999);
    builder.mark('parse', T0 + 1200);
    builder.setPromptToken('t'.repeat(200));
    const view = builder.view();
    expect(OpDebugViewSchema.safeParse(view).success).toBe(true);
    expect(view.stages.map((s) => s.name)).toEqual(['click', 'request', 'meta', 'firstChunk', 'done', 'parse']);
    expect(builder.markOf('firstChunk')).toBe(T0 + 600);
    expect(view.model).toBe('model-synthetic');
    expect(view.hubStages).toEqual([{ name: 'prompt-build', ms: 182 }]);
    expect(view.reasoning).toBe('thinking');
    expect(view.context?.source).toBe('archive');
    expect(view.usage?.costMicroUsd).toBe(14_300);
    expect(view.promptToken).toHaveLength(128);
    expect(JSON.stringify(view)).not.toContain('synthetic system block');
    expect(builder.usageFrame?.usage.inputTokens).toBe(3412);
    builder.setPromptToken(null);
    expect(builder.view().promptToken).toBeNull();
  });

  it('[DB-028] a view with nothing observed says so with nulls', () => {
    const view = new OpDebugBuilder(T0).view();
    expect(view).toEqual({ stages: [{ name: 'click', at: T0 }], usage: null, reasoning: null, promptToken: null, context: null, model: null, hubStages: [] });
  });
});

describe('[DB-003] [DB-019] echo silence and Coach turns', () => {
  it('[DB-003] no echo from the hub is not an error: the view simply has no prompt token', () => {
    const builder = new OpDebugBuilder(T0);
    builder.onFrame(usageFrame(), T0 + 10);
    builder.onFrame({ type: 'done', stopReason: null }, T0 + 20);
    const view = builder.view();
    expect(view.promptToken).toBeNull();
    expect(view.hubStages).toEqual([]);
    expect(OpDebugViewSchema.safeParse(view).success).toBe(true);
  });

  it('[DB-019] a Coach exchange has its own timing, first chunk, tokens and cost', () => {
    const exchange = new OpDebugBuilder(T0);
    exchange.mark('request', T0 + 15);
    exchange.onFrame({ type: 'content_delta', text: 'answer' }, T0 + 900);
    exchange.onFrame(usageFrame({ costMicroUsd: 2100 }), T0 + 1500);
    exchange.onFrame({ type: 'done', stopReason: 'end_turn' }, T0 + 1600);
    const view = exchange.view();
    const profile = profileOf(view.stages, 'done', T0 + 2000);
    expect(profile.totalMs).toBe(1600);
    expect(exchange.markOf('firstChunk')! - T0).toBe(900);
    expect(formatCostLine({ usage: view.usage, totalMs: profile.totalMs, model: view.model ?? null }, en)).toBe('in 3,412 tok • out 286 tok • cache r 3,000 / w 0 • $0.0021 • 1.6 s');
  });
});

describe('[DB-020] debug blocks only after expanding', () => {
  it('[DB-020] hidden in the collapsed dock and outside debug mode', () => {
    expect(showDebugBlock(true, true)).toBe(true);
    expect(showDebugBlock(true, false)).toBe(false);
    expect(showDebugBlock(false, true)).toBe(false);
  });
});

describe('[DB-022] local AI spend journal, «только этот браузер»', () => {
  const day = 86_400_000;
  it('[DB-022] by feature for today and 7 days, with cache share and the approximate flag', () => {
    const journal = new LocalSpendJournal();
    journal.recordUsage('reply', usageFrame().usage, T0);
    journal.recordUsage('reply', usageFrame({ costApproximate: true }).usage, T0 + 1000);
    journal.recordInsert('reply', T0 + 2000);
    journal.recordUsage('review', usageFrame({ inputTokens: 1000, cacheReadTokens: 0, costMicroUsd: 1000 }).usage, T0 - 3 * day);
    journal.recordUsage('coach', usageFrame().usage, T0 - 10 * day);
    const today = journal.report(T0, 1);
    expect(today.source).toBe('local-browser');
    expect(today.total).toMatchObject({ runs: 2, inserts: 1, costMicroUsd: 28_600, approximate: true });
    expect(today.byFeature.map((f) => f.feature)).toEqual(['reply']);
    expect(today.total.cacheShare).toBeCloseTo(6000 / (6824 + 6000));
    const week = journal.report(T0, 7);
    expect(week.byFeature.map((f) => [f.feature, f.runs])).toEqual([
      ['reply', 2],
      ['review', 1],
    ]);
    expect(week.total.costMicroUsd).toBe(29_600);
    expect(week.fromDay < week.toDay).toBe(true);
    expect(journal.todayCostMicroUsd(T0)).toBe(28_600);
    expect(journal.report(T0, 99).byFeature.some((f) => f.feature === 'coach')).toBe(false);
    expect(new LocalSpendJournal().report(T0).total.cacheShare).toBeNull();
  });

  it('[DB-022] keeps 8 days, survives a restart through a snapshot, ignores junk', () => {
    const journal = new LocalSpendJournal();
    for (let i = 0; i < 12; i += 1) journal.recordUsage('fix', usageFrame().usage, T0 - i * day);
    expect(Object.keys(journal.snapshot())).toHaveLength(SPEND_DAYS_KEPT);
    const restored = new LocalSpendJournal();
    restored.restore(journal.snapshot());
    expect(restored.report(T0, 7)).toEqual(journal.report(T0, 7));
    restored.restore({ 'not-a-day': {}, '2026-10-01': { fix: 'junk', nope: {}, reply: { runs: -1, inputTokens: 5, approximate: true } } });
    expect(restored.report(Date.UTC(2026, 9, 1, 12), 1).byFeature.find((f) => f.feature === 'reply')).toMatchObject({ runs: 0, inputTokens: 5, approximate: true });
    restored.restore(null);
    restored.clear();
    expect(restored.report(T0, 7).total.runs).toBe(0);
  });
});

describe('[DB-027] «Аккаунт → Дополнительно»', () => {
  it('[DB-027] the sign-in tail, the ChatSpace build and the contract, the app line', () => {
    const info = advancedAccountInfo({
      token: 'agency_hub_device_Zx81kQpLm4Rt7Vw2Yb9N',
      issuedAt: '2026-10-01T10:00:00.000Z',
      expiresAt: null,
      hostBuild: 'index-DEVowLko',
      contractOk: true,
      version: '0.1.0',
      browserMajor: 157,
      os: 'macos',
    });
    expect(info).toEqual({
      signIn: { tail: '…Yb9N', issuedAt: '2026-10-01T10:00:00.000Z', expiresAt: null },
      host: { build: 'index-DEVowLko', contractOk: true },
      app: '0.1.0 · Firefox 157 · macos',
    });
    expect(advancedAccountInfo({ token: null, issuedAt: null, expiresAt: null, hostBuild: null, contractOk: null, version: '0.1.0', browserMajor: null, os: 'other' })).toEqual({
      signIn: null,
      host: { build: null, contractOk: null },
      app: '0.1.0 · Firefox · other',
    });
    expect(maskedTail('short')).toBeNull();
  });
});

describe('[LG-027] render trace', () => {
  it('[LG-027] writes debug records only while both switches are on, never throws', () => {
    let debug = false;
    let trace = true;
    const logger = createLogger({ now: () => T0, debugEnabled: () => debug });
    const write = createRenderTrace(logger, () => trace && debugFeatures({ debug: { enabled: debug, renderTrace: trace } }).renderTrace);
    write('dock', 3.2, 120);
    expect(logger.recent()).toHaveLength(0);
    debug = true;
    write('dock', 3.2, 120);
    write('board', 1);
    trace = false;
    write('dock', 9);
    expect(logger.recent().map((r) => r.fields)).toEqual([{ surface: 'dock', ms: 3.2, nodes: 120 }, { surface: 'board', ms: 1 }]);
    expect(logger.recent()[0]).toMatchObject({ level: 'debug', scope: 'ui.render' });
    const broken = createRenderTrace(logger, () => {
      throw new Error('boom');
    });
    expect(() => broken('dock', 1)).not.toThrow();
  });
});
