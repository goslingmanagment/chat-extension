// The fake hub's stream scenarios (@cg/testing/hub SSE_SCENARIOS) played
// end to end: the dock or the Coach starts the feature, the real scheduler
// runs it with R11's drivers (request building per §8.4, parsing per D-15),
// and the view the person sees must be what the scenario's reference
// reading says — the parts and variants of a finished answer, or the one
// error of a failed one. Plus the drivers on their own: what each feature
// asks the hub for, and what the scheduler refuses to send.

import { describe, expect, it } from 'vitest';

import { FEATURE_IDS, type FeatureId, type StartOp } from '@cg/contracts';
import { AI_FEATURE_DRIVERS, FEATURE_POLICIES, hubFeatureOf } from '@cg/core/domain/features';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, memory, openChat, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, SSE_SCENARIOS, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { TAB } from './support/ai-background';
import { readyHarness, type Harness, type HarnessParts } from './support/ai-harness';
import { NOW_MS, WORLD, binding, causeOf, session } from './support/world';

function parts(): HarnessParts {
  return {
    baseHost: new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] }),
    memory,
    catalog: createFakeCatalog(ctxOf({ now: NOW_MS })),
    bootstrap: BOOTSTRAP_PILOT_PAGES,
    resolve: resolveHubErrorReference,
    meta: (feature) => meta(feature as Parameters<typeof meta>[0]),
  };
}

type Scenario = (typeof SSE_SCENARIOS)[number];

/** What the person sees at the end: the texts of the parts (variants × parts) or the code of the error. */
interface Seen {
  readonly state: string | null;
  readonly code: string | null;
  readonly result: readonly (readonly string[])[] | null;
}

const SAVED = { state: 'saved' as const, response: { outcome: 'created' as const, profile: { version: 1, createdAt: '2026-10-03T10:00:01.000Z', sourceGeneratedAt: null } } };

async function play(scenario: Scenario): Promise<{ readonly h: Harness; readonly seen: Seen }> {
  const h = await readyHarness(parts());
  for (const of of ['coach', 'review', 'recap.view'] as const) h.mount({ of });
  const body = scenario.request.body;
  h.script(...scenario.responses);
  const hubFeature = scenario.request.feature;

  if (hubFeature === 'coach-chat') {
    await h.generate('coach', { question: body.chatterQuestion ?? 'How do I reply?' });
    await h.clock.advance(120_000);
    const turn = h.coach().turns.at(-1);
    const drafts = turn?.answer?.drafts.map((draft) => draft.parts.map((part) => part.text)) ?? null;
    return { h, seen: { state: turn?.state ?? null, code: turn?.error?.code ?? null, result: turn?.answer === null || turn?.answer === undefined ? null : drafts } };
  }
  if (hubFeature === 'chat-review') {
    await h.generate('review');
    await h.clock.advance(120_000);
    const vm = h.review();
    return { h, seen: { state: vm.state, code: vm.view.s === 'error' ? vm.view.error.code : null, result: vm.raw === null ? null : [[vm.raw]] } };
  }
  if (hubFeature === 'fan-summary') {
    h.bg.hub.profileScript.push(SAVED);
    await h.generate('recap');
    await h.dispatch({ type: 'RefreshRecap', length: 'full' });
    await h.clock.advance(120_000);
    const vm = h.recapView();
    return { h, seen: { state: vm.state, code: vm.view.s === 'error' ? vm.view.error.code : null, result: vm.markdown === null ? null : [[vm.markdown]] } };
  }

  const split = body.replyMode === 'preferSplit';
  if (hubFeature === 'hi-greeting') {
    // Hi is for a fan who barely wrote yet.
    h.host.setWindow({ ...(memory.chatWindows[0] as (typeof memory.chatWindows)[number]), fanMessages: 1, modelMessages: 2, loaded: 3 }, openChat);
    await h.settle();
    await h.generate('hi', { split });
  } else if (hubFeature === 'improve-draft') {
    h.host.type(body.draftText ?? 'my draft');
    await h.settle();
    await h.generate('fix', { split });
  } else if (hubFeature === 'ping') {
    await h.generate('ping', { split });
  } else {
    const tone = body.replyTone === undefined || body.replyTone === 'none' ? null : body.replyTone;
    await h.generate('reply', { tone, split });
  }
  await h.clock.advance(120_000);
  const result = h.dock().result;
  const texts = result === null ? null : result.variants !== null ? result.variants.map((variant) => variant.parts.map((part) => part.text)) : result.parts === null ? null : [result.parts.map((part) => part.text)];
  return { h, seen: { state: result?.state ?? null, code: result?.error?.code ?? null, result: texts } };
}

describe('the hub\'s stream scenarios, as the person sees them', () => {
  for (const scenario of SSE_SCENARIOS) {
    it(`[AI-136] ${scenario.name}: ${scenario.expect.outcome}${scenario.expect.cg === null ? '' : ` ${scenario.expect.cg}`}`, async () => {
      const { h, seen } = await play(scenario);
      expect({ state: seen.state, code: seen.code }).toEqual({ state: scenario.expect.outcome, code: scenario.expect.cg });
      expect(h.bg.hub.streams).toHaveLength(scenario.expect.requests);
      if (scenario.request.feature !== 'coach-chat') expect(seen.result).toEqual(scenario.expect.result);
      // A failed generation leaves nothing to insert; a finished one is «черновик, не отправлено».
      const result = h.dock().result;
      if (result !== null) expect(result.draftNotSent).toBe(scenario.expect.outcome === 'done');
      // The request the hub got is the feature the scenario is about.
      expect(h.bg.hub.streams[0]?.feature).toBe(scenario.request.feature);
    });
  }

  it('[AI-136] [AI-011] the split marker cut between two chunks still splits; one part back says so without a new request', async () => {
    const across = await play(SSE_SCENARIOS.find((s) => s.name === 'reply-split-across-chunks') as Scenario);
    expect(across.seen.result).toEqual([['First part', 'second part']]);
    expect(across.h.dock().result?.meta).toEqual([
      { key: 'result.meta.tone', params: { tone: 'Flirt' } },
      { key: 'result.meta.parts', params: { n: 2 } },
    ]);
    expect(across.h.bg.hub.streams[0]?.body).toMatchObject({ replyTone: 'flirty', replyMode: 'preferSplit' });

    const one = await play(SSE_SCENARIOS.find((s) => s.name === 'reply-split-one-part') as Scenario);
    expect(one.h.dock().result).toMatchObject({ splitRequested: true, unparsed: false });
    expect(one.h.dock().result?.meta).toContainEqual({ key: 'result.meta.onePart' });
    expect(one.h.bg.hub.streams).toHaveLength(1);
  });

  it('[NEW-04] a Recap is not a message to the fan: a marker in it stays text, and the debug frames do not disturb it', async () => {
    const { h, seen } = await play(SSE_SCENARIOS.find((s) => s.name === 'debug-input-and-reasoning') as Scenario);
    expect(seen.result).toEqual([['## Recap\nLikes [NEXT] markers stay in recaps.']]);
    expect(h.bg.hub.streams[0]?.body.replyMode).toBeUndefined();
    // Debug mode is off: the hub was not asked for its debug frames and nothing of them is shown.
    expect(h.bg.hub.streams[0]?.capabilities).not.toContain('debug-input-v1');
    expect(h.recapView().debug).toBeNull();
  });

  it('[AI-030] the three Hi variants of the hub come as three variants, parts inside', async () => {
    const { h, seen } = await play(SSE_SCENARIOS.find((s) => s.name === 'hi-three-variants') as Scenario);
    expect(seen.result).toEqual([['Hi there', 'glad you joined'], ['Hey you!'], ['Welcome', 'want a peek?']]);
    expect(h.bg.hub.streams[0]?.body).toMatchObject({ variantCount: 3, replyMode: 'preferSplit' });
    expect(h.bg.hub.streams[0]?.capabilities).toEqual(expect.arrayContaining(['context-v1', 'split-all-v1']));
  });
});

describe('[RU-001] the drivers the scheduler runs', () => {
  const target = { binding, chat: openChat, fanRef: WORLD.fan, conversationRef: WORLD.fan };
  const base = (feature: FeatureId, over: Partial<StartOp> = {}): StartOp => ({
    feature,
    surface: feature === 'coach' ? 'coach' : 'dock',
    target,
    cause: causeOf('tok_0000000000000001'),
    tone: null,
    split: false,
    window: 100,
    ...(feature === 'fix' ? { draft: { text: 'my draft', revision: 1, digest: 'feedbeef00000001' } } : {}),
    ...(feature === 'coach' ? { coach: { question: 'q', history: [] } } : {}),
    ...over,
  });
  const ctx = { opId: '00000000-0000-4000-8000-000000000100', session, persona: { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId }, bootstrap: BOOTSTRAP_PILOT_PAGES, debug: false, freshText: true };
  const build = (start: StartOp): ReturnType<(typeof AI_FEATURE_DRIVERS)[FeatureId]['build']> => AI_FEATURE_DRIVERS[start.feature].build(start, ctx);

  it('there is one driver per feature, and each streams the hub feature of §8.4', () => {
    expect(Object.keys(AI_FEATURE_DRIVERS).sort()).toEqual([...FEATURE_IDS].sort());
    const streamed = Object.fromEntries(
      FEATURE_IDS.map((feature) => {
        const built = build(base(feature));
        if (!built.ok) throw new Error(`${feature}: ${built.issues}`);
        expect(built.request.feature).toBe(hubFeatureOf(feature));
        return [feature, built.request.feature];
      }),
    );
    expect(streamed).toEqual({
      reply: 'fast-reply',
      fix: 'improve-draft',
      hi: 'hi-greeting',
      ping: 'ping',
      review: 'chat-review',
      recap: 'fan-summary',
      'recap-short': 'fan-summary',
      coach: 'coach-chat',
    });
  });

  it('[NEW-04] Split is asked for every feature whose output is a message to the fan — never for Recap or Review', () => {
    for (const feature of FEATURE_IDS) {
      const built = build(base(feature, { split: FEATURE_POLICIES[feature].split }));
      if (!built.ok) throw new Error(`${feature}: ${built.issues}`);
      expect(built.request.body.replyMode === 'preferSplit', feature).toBe(FEATURE_POLICIES[feature].split);
    }
    for (const feature of ['review', 'recap', 'recap-short'] as const) {
      const refused = build(base(feature, { split: true }));
      expect(refused.ok, feature).toBe(false);
    }
  });

  it('a start its feature\'s policy forbids never leaves the background', () => {
    // A tone belongs to Reply only (AI-002).
    expect(build(base('reply', { tone: 'flirty' })).ok).toBe(true);
    for (const feature of ['fix', 'hi', 'ping', 'review', 'recap', 'coach'] as const) expect(build(base(feature, { tone: 'flirty' })).ok, feature).toBe(false);
    // Fix needs its draft (AI-021); Coach its question or preset.
    expect(build({ ...base('fix'), draft: { text: '   ', revision: 1, digest: 'feedbeef00000001' } }).ok).toBe(false);
    expect(build({ ...base('coach'), coach: { history: [] } }).ok).toBe(false);
    // A driver only runs its own feature.
    expect(AI_FEATURE_DRIVERS.reply.build(base('ping'), ctx).ok).toBe(false);
  });

  it('Hi asks for three variants unless told otherwise; the short Recap is the hub\'s short mode', () => {
    const hi = build(base('hi'));
    expect(hi.ok && hi.request.body.variantCount).toBe(3);
    const one = build(base('hi', { surface: 'newcomers' }));
    expect(one.ok && one.request.body.variantCount).toBe(1);
    const short = build(base('recap-short'));
    expect(short.ok && short.request.body.summaryMode).toBe('short');
    const full = build(base('recap'));
    expect(full.ok && full.request.body.summaryMode).toBeUndefined();
  });

  it('each driver parses its own answer: parts, variants, a review document, a shared recap, a Coach answer', () => {
    const parse = (feature: FeatureId, text: string, splitRequested = false): unknown => {
      const out = AI_FEATURE_DRIVERS[feature].parse(text, { feature, splitRequested, generationRef: '00000000-0000-4000-8000-000000000200' });
      return out.ok ? out.result : out.code;
    };
    expect(parse('reply', 'a [NEXT] b', true)).toEqual({ kind: 'parts', parts: ['a', 'b'], splitRequested: true });
    expect(parse('hi', 'a [VARIANT] b [NEXT] c')).toEqual({ kind: 'variants', variants: [['a'], ['b', 'c']] });
    expect(parse('review', 'plain')).toEqual({ kind: 'review', doc: null, raw: 'plain' });
    expect(parse('recap', '## A\nb')).toEqual({ kind: 'recap', markdown: '## A\nb', coverage: null, shared: { generationRef: '00000000-0000-4000-8000-000000000200' } });
    expect(parse('coach', 'advice')).toEqual({ kind: 'coach', answer: { prose: 'advice', blocks: null, drafts: [] } });
    expect(parse('ping', '<think>x</think>')).toBe('CG-OUTPUT-UNUSABLE');
  });

  it('the tab that runs them is the one the harness registered', () => {
    expect(TAB).toMatch(/^[0-9a-f-]{36}$/);
  });
});
