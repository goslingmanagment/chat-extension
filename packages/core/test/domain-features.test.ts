// core/domain/features: the policy table, the one-off tone, the client
// gates, the plan from a click to a StartOp and the background's drivers
// per feature (architecture.md §5.5, §7, §8.4; RU-001, AI-001…AI-039).

import { describe, expect, it } from 'vitest';

import {
  FEATURE_IDS,
  FRESH_TEXT_FEATURES,
  HUB_FEATURE_MAP,
  HubStreamRequestSchema,
  OP_TIMEOUTS,
  SPLIT_FEATURES,
  StartOpSchema,
  TONES,
  UNAVAILABLE_REASONS,
  type Bootstrap,
  type ChatWindow,
  type FeatureId,
  type LiveTextTail,
  type StartOp,
} from '@cg/contracts';
import {
  AI_FEATURE_DRIVERS,
  DEFAULT_TONE,
  FEATURE_POLICIES,
  HELP_REMOVED,
  TONE_LABEL_KEYS,
  TONE_ORDER,
  fanScriptOf,
  featureGate,
  freshTextLimits,
  hiVariantCount,
  hubFeatureOf,
  isDraftFeature,
  languageGate,
  nextTone,
  pingGate,
  pingHint,
  planStart,
  splitFor,
  toggleTone,
  toneAfterStart,
  toneForRegenerate,
  trimFreshTail,
  windowFor,
  type StartPlanInput,
} from '@cg/core/domain/features';
import { DEFAULT_SETTINGS } from '@cg/contracts/settings';
import { BOOTSTRAP_ALL_OFF, BOOTSTRAP_PILOT_ON } from '@cg/testing/hub';

import { WORLD, causeOf, chatOf, checkpointFor, persona, startOf, target, tokenN, uuid } from './support/world';

const PAGE_ID = WORLD.pages.one.pageId;
const cause = causeOf(tokenN(1));

const tail = (texts: readonly [direction: 'fan' | 'model', text: string][]): LiveTextTail => ({
  capturedAt: '2026-10-03T10:00:00.000Z',
  messages: texts.map(([direction, text], index) => ({ platformMessageId: String(4000 + index), direction, sentAt: '2026-10-03T09:59:00.000Z', text })),
});

const plan = (over: Partial<StartPlanInput> = {}): StartPlanInput => ({
  feature: 'reply',
  surface: 'dock',
  target,
  cause,
  options: {},
  settings: DEFAULT_SETTINGS,
  bootstrap: BOOTSTRAP_PILOT_ON,
  tone: null,
  ...over,
});

const planned = (over: Partial<StartPlanInput> = {}): StartOp => {
  const out = planStart(plan(over));
  if (!out.ok) throw new Error(`refused: ${out.code}`);
  return out.start;
};

const draft = (text: string) => ({ plainText: text, revision: 9, digest: 'feedbeef00000009' });

const windowOf = (over: Partial<ChatWindow> = {}): ChatWindow => ({
  chat: chatOf(WORLD.fan),
  state: 'ready',
  loaded: 40,
  fanMessages: 22,
  modelMessages: 18,
  lastFanMessageId: '4004',
  lastFanMessageAt: '2026-10-03T09:59:00.000Z',
  lastModelMessageAt: '2026-10-03T09:50:00.000Z',
  hasOlder: true,
  ...over,
});

const ctx = { opId: uuid(0x100), persona, bootstrap: BOOTSTRAP_PILOT_ON, debug: false };

describe('[RU-001] feature policies', () => {
  it('has one row per feature, consistent with the contracts vocabulary', () => {
    expect(Object.keys(FEATURE_POLICIES).sort()).toEqual([...FEATURE_IDS].sort());
    for (const feature of FEATURE_IDS) {
      const rule = FEATURE_POLICIES[feature];
      expect(rule.split, feature).toBe((SPLIT_FEATURES as readonly string[]).includes(feature));
      expect(rule.freshText, feature).toBe((FRESH_TEXT_FEATURES as readonly string[]).includes(feature));
      expect(rule.timeouts, feature).toBe(OP_TIMEOUTS[feature]);
      expect(rule.tone, feature).toBe(feature === 'reply');
      expect(rule.requiresDraft, feature).toBe(feature === 'fix');
      // A feature the hub may split is exactly one whose replyMode the map names.
      expect(rule.split, feature).toBe(HUB_FEATURE_MAP[feature].replyMode !== null);
    }
  });

  it('says where a result lives, what it is and how it is run again', () => {
    expect(FEATURE_IDS.filter(isDraftFeature)).toEqual(['reply', 'fix', 'hi', 'ping']);
    expect(FEATURE_IDS.map((f) => FEATURE_POLICIES[f].result)).toEqual(['parts', 'parts', 'variants', 'parts', 'review', 'recap', 'recap', 'coach']);
    expect(FEATURE_IDS.map((f) => FEATURE_POLICIES[f].dockAction)).toEqual(['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'recap', 'coach']);
    expect(FEATURE_IDS.filter((f) => FEATURE_POLICIES[f].rerun === 'refresh')).toEqual(['review', 'recap', 'recap-short']);
    // [AI-025] Fix shows no stream; [AI-053] nothing of Review or Recap is insertable.
    expect(FEATURE_IDS.filter((f) => !FEATURE_POLICIES[f].streamShown)).toEqual(['fix']);
    expect(FEATURE_IDS.filter((f) => !FEATURE_POLICIES[f].insertable)).toEqual(['review', 'recap', 'recap-short']);
    expect(FEATURE_IDS.filter((f) => FEATURE_POLICIES[f].minMessages > 0)).toEqual(['review', 'recap']);
    expect(FEATURE_IDS.map((f) => FEATURE_POLICIES[f].flag)).toEqual([null, null, null, null, 'review', 'recap', 'recap', 'coach']);
  });

  it('Help is removed: its key is still named, with the reason', () => {
    expect(HELP_REMOVED).toEqual({ catalogAction: 'help', reason: 'help-removed' });
    expect(UNAVAILABLE_REASONS[HELP_REMOVED.reason].key).toBe('dock.helpRemoved');
  });
});

describe('tones', () => {
  it('[AI-002] the parity set Casual, Flirt, Sell, Spice in that order', () => {
    expect(TONE_ORDER).toEqual(['casual', 'flirty', 'upsell', 'spicy']);
    expect(TONE_ORDER).toEqual(TONES);
    expect(Object.keys(TONE_LABEL_KEYS).sort()).toEqual([...TONES].sort());
  });

  it('[AI-004] no tone by default', () => {
    expect(DEFAULT_TONE).toBeNull();
    expect(planned().tone).toBeNull();
  });

  it('[AI-003] a tone is one-off: gone once the reply was admitted', () => {
    expect(planned({ tone: 'flirty' }).tone).toBe('flirty');
    expect(toneAfterStart()).toBeNull();
  });

  it('[AI-005] a tone picked in the menu goes with that click, over the chat tone', () => {
    expect(planned({ tone: 'casual', options: { tone: 'spicy' } }).tone).toBe('spicy');
    expect(planned({ tone: 'casual', options: { tone: null } }).tone).toBeNull();
  });

  it('[AI-006] picking the active tone again takes it off', () => {
    expect(toggleTone('flirty', 'flirty')).toBeNull();
    expect(toggleTone('flirty', 'upsell')).toBe('upsell');
    expect(toggleTone(null, 'casual')).toBe('casual');
    expect(toggleTone('casual', null)).toBeNull();
  });

  it('[AI-007] «Ещё раз» repeats the original tone', () => {
    expect(toneForRegenerate({ feature: 'reply', toneUsed: 'upsell' })).toBe('upsell');
    expect(toneForRegenerate({ feature: 'reply', toneUsed: null })).toBeNull();
    expect(toneForRegenerate({ feature: 'ping', toneUsed: null })).toBeNull();
  });

  it('[AI-008] the hotkey walks no tone → Casual → Flirt → Sell → Spice → no tone', () => {
    const walk: (string | null)[] = [];
    let tone: ReturnType<typeof nextTone> = null;
    for (let i = 0; i < 6; i += 1) {
      tone = nextTone(tone);
      walk.push(tone);
    }
    expect(walk).toEqual(['casual', 'flirty', 'upsell', 'spicy', null, 'casual']);
  });

  it('a tone never reaches a feature other than Reply', () => {
    for (const feature of ['hi', 'ping', 'review', 'recap', 'recap-short'] as const) expect(planned({ feature, tone: 'flirty' }).tone, feature).toBeNull();
  });
});

describe('client gates', () => {
  const facts = (over: Partial<Parameters<typeof featureGate>[1]> = {}) => ({ platform: 'onlyfans' as const, window: windowOf(), draftEmpty: false, ...over });

  it('[AI-122] nothing starts while the chat is loading', () => {
    for (const feature of FEATURE_IDS) {
      expect(featureGate(feature, facts({ window: null })), feature).toEqual({ reason: 'chat-loading', code: 'CG-GATE-CHAT-LOADING' });
      expect(featureGate(feature, facts({ window: windowOf({ state: 'loading' }) }))?.code, feature).toBe('CG-GATE-CHAT-LOADING');
    }
  });

  it('[AI-021] Fix without a draft is CG-GATE-DRAFT; an unread draft does not gate', () => {
    expect(featureGate('fix', facts({ draftEmpty: true }))).toEqual({ reason: 'needs-draft', code: 'CG-GATE-DRAFT' });
    expect(featureGate('fix', facts({ draftEmpty: false }))).toBeNull();
    expect(featureGate('fix', facts({ draftEmpty: null }))).toBeNull();
    expect(featureGate('reply', facts({ draftEmpty: true }))).toBeNull();
    expect(planStart(plan({ feature: 'fix', draft: draft('   ') }))).toEqual({ ok: false, code: 'CG-GATE-DRAFT' });
    expect(planStart(plan({ feature: 'fix' }))).toEqual({ ok: false, code: 'CG-GATE-DRAFT' });
  });

  it('[AI-031] Hi stops being offered once the fan wrote more than ten messages', () => {
    expect(featureGate('hi', facts({ window: windowOf({ fanMessages: 10 }) }))).toBeNull();
    expect(featureGate('hi', facts({ window: windowOf({ fanMessages: 11 }) }))).toEqual({ reason: 'hi-gate', code: 'CG-GATE-HI' });
    // Model messages may be welcome or mass messages: they never gate here (the hub counts personal ones).
    expect(featureGate('hi', facts({ window: windowOf({ fanMessages: 0, modelMessages: 40 }) }))).toBeNull();
  });

  it('[AI-051] Review and the full Recap need 30 messages — only when the whole conversation is loaded', () => {
    const short = windowOf({ loaded: 12, fanMessages: 6, modelMessages: 6, hasOlder: false });
    expect(featureGate('review', facts({ window: short }))).toEqual({ reason: 'no-history', code: 'CG-GATE-HISTORY' });
    expect(featureGate('recap', facts({ window: short }))?.code).toBe('CG-GATE-HISTORY');
    expect(featureGate('recap-short', facts({ window: short }))).toBeNull();
    expect(featureGate('review', facts({ window: { ...short, hasOlder: true } }))).toBeNull();
    expect(featureGate('review', facts({ window: { ...short, hasOlder: null } }))).toBeNull();
    expect(featureGate('review', facts({ window: { ...short, loaded: 30 } }))).toBeNull();
  });

  it('[AI-001] Reply has no client gate beyond the loading chat: a chat without a fan message is the hub\'s to judge', () => {
    expect(featureGate('reply', facts({ window: windowOf({ loaded: 3, fanMessages: 0, modelMessages: 3, hasOlder: false }) }))).toBeNull();
    expect(featureGate('reply', facts({ window: windowOf({ loaded: 0, fanMessages: 0, modelMessages: 0, hasOlder: false }) }))).toBeNull();
    expect(featureGate('reply', facts({ window: null }))?.code).toBe('CG-GATE-CHAT-LOADING');
  });

  it('[AI-036] Ping is never blocked on OnlyFans; the segment is only a hint', () => {
    for (const segment of ['active', 'segment-a', 'segment-b', 'unknown', null] as const) {
      expect(pingGate('onlyfans', segment), String(segment)).toBeNull();
      expect(featureGate('ping', facts({ pingSegment: segment })), String(segment)).toBeNull();
    }
    expect(pingGate('onlyfans', undefined)).toBeNull();
    expect(featureGate('ping', facts())).toBeNull();
    expect(pingGate('fansly', 'active')).toEqual({ reason: 'ping-gate', code: 'CG-GATE-PING' });
    expect(pingGate('fansly', 'segment-a')).toBeNull();
    expect(pingHint('active')).toBe('active');
    expect(pingHint('unknown')).toBeNull();
    expect(pingHint(undefined)).toBeNull();
  });

  it('[AI-087] a Cyrillic draft is not inserted unless the fan writes Cyrillic', () => {
    const latin = tail([['fan', 'hey there'], ['model', 'привет от модели']]);
    const cyrillic = tail([['fan', 'hey'], ['fan', 'привет']]);
    expect(fanScriptOf(latin)).toBe('other');
    expect(fanScriptOf(cyrillic)).toBe('cyrillic');
    expect(fanScriptOf(null)).toBe('unknown');
    expect(fanScriptOf(tail([['model', 'только модель']]))).toBe('unknown');
    expect(languageGate('Привет, как дела?', 'other')).toEqual({ reason: 'language', code: 'CG-GATE-LANGUAGE' });
    expect(languageGate('Привет, как дела?', 'unknown')?.code).toBe('CG-GATE-LANGUAGE');
    expect(languageGate('Привет, как дела?', 'cyrillic')).toBeNull();
    expect(languageGate('hey you', 'other')).toBeNull();
    expect(languageGate('hey you', 'unknown')).toBeNull();
  });

  it('every gate names a registry reason with its code', () => {
    for (const id of ['chat-loading', 'needs-draft', 'no-history', 'hi-gate', 'ping-gate', 'language'] as const) expect(UNAVAILABLE_REASONS[id].code).toMatch(/^CG-GATE-/);
  });
});

describe('the plan from a click to a StartOp', () => {
  it('[AI-001] Reply: the target, the quick window, no tone, no Split by default', () => {
    const start = planned();
    expect(StartOpSchema.safeParse(start).success).toBe(true);
    expect(start).toEqual({ feature: 'reply', surface: 'dock', target, cause, tone: null, split: false, window: 100 });
  });

  it('[AI-134] windows come from the settings; the deep one never above limits.deepMax', () => {
    const settings = { ...DEFAULT_SETTINGS, generation: { ...DEFAULT_SETTINGS.generation, windows: { quick: 60, ping: 80, improve: 15, deep: 3000 } } };
    const capped: Bootstrap = { ...BOOTSTRAP_PILOT_ON, limits: { ...BOOTSTRAP_PILOT_ON.limits, deepMax: 1500 } };
    const win = (feature: FeatureId, bootstrap = BOOTSTRAP_PILOT_ON) => windowFor(feature, undefined, settings, bootstrap);
    expect(FEATURE_IDS.map((f) => win(f))).toEqual([60, 15, 25, 80, 3000, 3000, 300, 60]);
    expect(win('review', capped)).toBe(1500);
    expect(win('recap', capped)).toBe(1500);
    expect(win('recap-short', capped)).toBe(300);
    // A window the person asked for stays inside the hub body's bounds and the cap.
    expect(windowFor('reply', 2, settings, BOOTSTRAP_PILOT_ON)).toBe(5);
    expect(windowFor('review', 3000, settings, capped)).toBe(1500);
    expect(windowFor('reply', 40, settings, BOOTSTRAP_PILOT_ON)).toBe(40);
  });

  it('[AI-010] Split is a snapshot of the setting at the start, shared by Reply and Fix', () => {
    const on = { ...DEFAULT_SETTINGS, generation: { ...DEFAULT_SETTINGS.generation, split: true } };
    expect(planned({ settings: on }).split).toBe(true);
    expect(planned({ settings: on, feature: 'fix', draft: draft('my text') }).split).toBe(true);
    expect(planned({ settings: on, options: { split: false } }).split).toBe(false);
    expect(planned({ options: { split: true } }).split).toBe(true);
    // «Ещё раз» keeps the original snapshot whatever the setting is now.
    expect(planned({ settings: on, splitWanted: false, regenerateOf: uuid(1) }).split).toBe(false);
  });

  it('[NEW-04] Split for Hi, Ping and Coach only with split-all on the page; never for Recap and Review', () => {
    const on = { ...DEFAULT_SETTINGS, generation: { ...DEFAULT_SETTINGS.generation, split: true } };
    for (const feature of ['hi', 'ping', 'coach'] as const) expect(splitFor(feature, true, BOOTSTRAP_PILOT_ON, PAGE_ID), feature).toBe(true);
    const noSplitAll: Bootstrap = { ...BOOTSTRAP_PILOT_ON, flags: { ...BOOTSTRAP_PILOT_ON.flags, splitAll: false } };
    for (const feature of ['hi', 'ping', 'coach'] as const) expect(splitFor(feature, true, noSplitAll, PAGE_ID), feature).toBe(false);
    for (const feature of ['reply', 'fix'] as const) expect(splitFor(feature, true, noSplitAll, PAGE_ID), feature).toBe(true);
    for (const feature of ['review', 'recap', 'recap-short'] as const) {
      expect(splitFor(feature, true, BOOTSTRAP_PILOT_ON, PAGE_ID), feature).toBe(false);
      expect(planned({ feature, settings: on }).split, feature).toBe(false);
    }
  });

  it('[AI-020] [AI-023] Fix carries the draft it was made from: text, revision and fingerprint', () => {
    const start = planned({ feature: 'fix', draft: draft('  my own words ') });
    expect(start.draft).toEqual({ text: '  my own words ', revision: 9, digest: 'feedbeef00000009' });
    expect(start.window).toBe(25);
    expect(start.tone).toBeNull();
  });

  it('[AI-030] Hi asks for three variants in the dock and one in «Новые»', () => {
    expect(hiVariantCount('dock')).toBe(3);
    expect(hiVariantCount('preview')).toBe(3);
    expect(hiVariantCount('newcomers')).toBe(1);
    expect(planned({ feature: 'hi' }).variantCount).toBe(3);
    expect(planned({ feature: 'hi', surface: 'newcomers', checkpoint: checkpointFor(WORLD.fan) }).variantCount).toBe(1);
    expect(planned({ feature: 'hi', options: { variants: 1 } }).variantCount).toBe(1);
    expect(planned({ feature: 'hi' }).window).toBe(25);
    expect(planned({ feature: 'ping' }).variantCount).toBeUndefined();
  });

  it('[AI-035] Ping reads its own window', () => {
    expect(planned({ feature: 'ping' })).toMatchObject({ feature: 'ping', window: 100, tone: null });
  });

  it('fresh page text only for Reply, Fix, Hi and Ping in the dock, with the switch and context-v1', () => {
    const fresh = tail([['fan', 'hey'], ['model', 'hi you']]);
    for (const feature of ['reply', 'hi', 'ping'] as const) expect(planned({ feature, fresh }).fresh, feature).toEqual(fresh);
    expect(planned({ feature: 'fix', draft: draft('x'), fresh }).fresh).toEqual(fresh);
    for (const feature of ['review', 'recap', 'recap-short'] as const) expect(planned({ feature, fresh }).fresh, feature).toBeUndefined();
    expect(planned({ feature: 'coach', options: { question: 'what now?' }, fresh }).fresh).toBeUndefined();
    // Never from a preview or «Новые».
    expect(planned({ surface: 'preview', fresh, checkpoint: checkpointFor(WORLD.fan) }).fresh).toBeUndefined();
    // The owner's switch and the hub capability both gate it.
    const flagOff: Bootstrap = { ...BOOTSTRAP_PILOT_ON, flags: { ...BOOTSTRAP_PILOT_ON.flags, freshText: false } };
    const noContext: Bootstrap = { ...BOOTSTRAP_PILOT_ON, capabilities: BOOTSTRAP_PILOT_ON.capabilities.filter((c) => c !== 'context-v1') };
    expect(planned({ fresh, bootstrap: flagOff }).fresh).toBeUndefined();
    expect(planned({ fresh, bootstrap: noContext }).fresh).toBeUndefined();
    expect(freshTextLimits('reply', 'dock', BOOTSTRAP_ALL_OFF, PAGE_ID)).toBeNull();
  });

  it('the tail is cut to N of the bootstrap and to its characters', () => {
    expect(freshTextLimits('reply', 'dock', BOOTSTRAP_PILOT_ON, PAGE_ID)).toEqual({ maxItems: BOOTSTRAP_PILOT_ON.limits.freshTextMaxItems, maxChars: BOOTSTRAP_PILOT_ON.limits.freshTextMaxChars });
    const small: Bootstrap = { ...BOOTSTRAP_PILOT_ON, limits: { ...BOOTSTRAP_PILOT_ON.limits, freshTextMaxItems: 2, freshTextMaxChars: 4 } };
    const fresh = tail([['fan', 'first'], ['model', 'second'], ['fan', 'third']]);
    const cut = planned({ fresh, bootstrap: small }).fresh;
    expect(cut?.messages.map((m) => m.text)).toEqual(['seco', 'thir']);
    const huge: Bootstrap = { ...BOOTSTRAP_PILOT_ON, limits: { ...BOOTSTRAP_PILOT_ON.limits, freshTextMaxItems: 500, freshTextMaxChars: 90_000 } };
    expect(freshTextLimits('reply', 'dock', huge, PAGE_ID)).toEqual({ maxItems: 60, maxChars: 5000 });
    expect(trimFreshTail(null, { maxItems: 60, maxChars: 5000 })).toBeNull();
    expect(trimFreshTail(fresh, null)).toBeNull();
  });

  it('Coach carries the question, the history and, once, the attached draft', () => {
    const history = [{ question: 'q1', answer: 'a1' }];
    const start = planned({ feature: 'coach', surface: 'coach', options: { question: '  what now? ', attachMyDraft: true }, draft: draft('my reply'), coachHistory: history });
    expect(start.coach).toEqual({ question: 'what now?', history, attachDraft: 'my reply' });
    expect(planned({ feature: 'coach', surface: 'coach', options: { preset: 'situation' } }).coach).toEqual({ preset: 'situation', history: [] });
    expect(planned({ feature: 'coach', surface: 'coach', options: { question: 'q', attachMyDraft: true }, draft: draft('  ') }).coach).toEqual({ question: 'q', history: [] });
    expect(planStart(plan({ feature: 'coach', surface: 'coach', options: {} }))).toEqual({ ok: false, code: 'CG-UI-FAILED' });
    const long = Array.from({ length: 25 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
    expect(planned({ feature: 'coach', surface: 'coach', options: { question: 'q' }, coachHistory: long }).coach?.history.length).toBe(20);
  });

  it('[AI-129] «Ещё раз» names the original and bypasses the cache; a checkpoint only in a preview', () => {
    const again = planned({ regenerateOf: uuid(0x55) });
    expect(again.regenerateOf).toBe(uuid(0x55));
    expect(again.force).toBe(true);
    expect(planned({ force: true }).force).toBe(true);
    expect(planned().force).toBeUndefined();
    const checkpoint = checkpointFor(WORLD.fan);
    expect(planned({ surface: 'preview', checkpoint }).checkpoint).toEqual(checkpoint);
    expect(planned({ surface: 'dock', checkpoint }).checkpoint).toBeUndefined();
  });
});

describe('the background drivers (§8.4)', () => {
  const build = (start: StartOp) => {
    const out = AI_FEATURE_DRIVERS[start.feature].build(start, ctx);
    if (!out.ok) throw new Error(out.issues);
    expect(HubStreamRequestSchema.safeParse(out.request).success).toBe(true);
    return out.request;
  };

  it('each feature streams its hub feature with the common fields', () => {
    const expected: Record<FeatureId, string> = { reply: 'fast-reply', fix: 'improve-draft', hi: 'hi-greeting', ping: 'ping', review: 'chat-review', recap: 'fan-summary', 'recap-short': 'fan-summary', coach: 'coach-chat' };
    for (const feature of FEATURE_IDS) {
      expect(hubFeatureOf(feature), feature).toBe(expected[feature]);
      const start = planned({
        feature,
        surface: feature === 'coach' ? 'coach' : 'dock',
        ...(feature === 'fix' ? { draft: draft('text') } : {}),
        ...(feature === 'coach' ? { options: { question: 'q' } } : {}),
      });
      const request = build(start);
      expect(request.feature, feature).toBe(expected[feature]);
      expect(request.body).toMatchObject({
        clientRequestId: ctx.opId,
        pageLabel: WORLD.pages.one.pageLabel,
        platform: 'onlyfans',
        conversationRef: WORLD.fan,
        fanRef: WORLD.fan,
        personaKey: persona.key,
        expectedPersonaDefinitionId: persona.definitionId,
        messageCount: start.window,
        isRegeneration: false,
      });
    }
  });

  it('[AI-001] [AI-002] Reply: replyTone (none without a tone) and replyMode', () => {
    expect(build(planned()).body).toMatchObject({ replyTone: 'none', replyMode: 'default' });
    expect(build(planned({ tone: 'upsell', options: { split: true } })).body).toMatchObject({ replyTone: 'upsell', replyMode: 'preferSplit' });
  });

  it('[AI-020] Fix: draftText and replyMode, no tone', () => {
    const body = build(planned({ feature: 'fix', draft: draft('my text'), options: { split: true } })).body;
    expect(body).toMatchObject({ draftText: 'my text', replyMode: 'preferSplit' });
    expect(body.replyTone).toBeUndefined();
  });

  it('[AI-030] Hi: variantCount 3, or 1 from «Новые»; a start without one gets the surface default', () => {
    expect(build(planned({ feature: 'hi' })).body).toMatchObject({ variantCount: 3, replyMode: 'default' });
    expect(build(planned({ feature: 'hi', surface: 'newcomers' })).body.variantCount).toBe(1);
    expect(build(startOf({ feature: 'hi', window: 25 })).body.variantCount).toBe(3);
    expect(build(startOf({ feature: 'hi', surface: 'newcomers', window: 25 })).body.variantCount).toBe(1);
  });

  it('[AI-035] [AI-039] Ping: no client templates, only the reference fields and replyMode', () => {
    const body = build(planned({ feature: 'ping', options: { split: true } })).body;
    expect(body.replyMode).toBe('preferSplit');
    expect(Object.keys(body).sort()).toEqual(['clientRequestId', 'conversationRef', 'expectedPersonaDefinitionId', 'fanRef', 'isRegeneration', 'messageCount', 'pageLabel', 'personaKey', 'platform', 'replyMode'].sort());
  });

  it('[AI-050] [AI-062] [AI-063] Review and Recap: no reply fields; the short recap is summaryMode short', () => {
    for (const feature of ['review', 'recap'] as const) {
      const body = build(planned({ feature })).body;
      expect(body.replyMode, feature).toBeUndefined();
      expect(body.summaryMode, feature).toBeUndefined();
      expect(body.messageCount, feature).toBe(3000);
    }
    expect(build(planned({ feature: 'recap-short' })).body).toMatchObject({ summaryMode: 'short', messageCount: 300 });
  });

  it('Coach: chatterQuestion, coachHistory, preset, the attached draft as draftText', () => {
    const start = planned({ feature: 'coach', surface: 'coach', options: { question: 'what now?', attachMyDraft: true }, draft: draft('my reply'), coachHistory: [{ question: 'q1', answer: 'a1' }] });
    expect(build(start).body).toMatchObject({ chatterQuestion: 'what now?', coachHistory: [{ question: 'q1', answer: 'a1' }], draftText: 'my reply', replyMode: 'default' });
    expect(build(planned({ feature: 'coach', surface: 'coach', options: { preset: 'situation' } })).body).toMatchObject({ preset: 'situation' });
  });

  it('fresh text goes as liveTextContext with the context-v1 header; the capability header lists what the hub may use', () => {
    const fresh = tail([['fan', 'hey']]);
    const request = build(planned({ fresh }));
    expect(request.body.liveTextContext?.items).toEqual([{ platformMessageId: '4000', direction: 'fan', occurredAt: '2026-10-03T09:59:00.000Z', text: 'hey' }]);
    expect(request.capabilities).toContain('context-v1');
    expect(build(planned({ feature: 'hi' })).capabilities).toContain('split-all-v1');
    expect(build(planned({ feature: 'review' })).capabilities).not.toContain('split-all-v1');
  });

  it('a start that breaks the feature policy never becomes a request', () => {
    const refused = (feature: FeatureId, start: StartOp): string => {
      const out = AI_FEATURE_DRIVERS[feature].build(start, ctx);
      if (out.ok) throw new Error('built');
      return out.issues;
    };
    expect(refused('reply', startOf({ feature: 'ping' }))).toMatch(/given to the reply driver/);
    expect(refused('review', startOf({ feature: 'review', split: true }))).toMatch(/no Split/);
    expect(refused('ping', { ...startOf({ feature: 'ping' }), tone: 'casual' })).toMatch(/Reply only/);
    expect(refused('coach', startOf({ feature: 'coach', surface: 'coach' }))).toMatch(/question or a preset/);
    expect(refused('coach', startOf({ feature: 'coach', surface: 'coach', coach: { history: [] } }))).toMatch(/question or a preset/);
    expect(refused('fix', startOf({ feature: 'fix', draft: { text: '  ', revision: 1, digest: 'feedbeef00000001' } }))).toMatch(/draft/);
  });

  it('parse is the output parser of the feature', () => {
    const generationRef = uuid(0x200);
    expect(AI_FEATURE_DRIVERS.reply.parse('a [NEXT] b', { feature: 'reply', splitRequested: true, generationRef })).toEqual({ ok: true, result: { kind: 'parts', parts: ['a', 'b'], splitRequested: true } });
    expect(AI_FEATURE_DRIVERS.hi.parse('a [VARIANT] b', { feature: 'hi', splitRequested: false, generationRef })).toEqual({ ok: true, result: { kind: 'variants', variants: [['a'], ['b']] } });
    expect(AI_FEATURE_DRIVERS.review.parse('no frame', { feature: 'review', splitRequested: false, generationRef })).toEqual({ ok: true, result: { kind: 'review', doc: null, raw: 'no frame' } });
  });
});
