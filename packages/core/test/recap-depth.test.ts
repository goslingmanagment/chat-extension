// R20 P4b2 / §12: storage wish, wire ceiling and the current bootstrap are
// separate bounds. Exercise the real planner and scheduler on both sites.
import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, SettingsV1Schema } from '@cg/contracts/settings';
import { SettingsExtPatchSchema } from '@cg/contracts/settings-ext';
import { StartOpSchema, type StartOp } from '@cg/contracts/ops';
import { type Bootstrap } from '@cg/contracts/hub';
import { planStart, windowFor } from '@cg/core/domain/features';
import { coachTurnSteps } from '@cg/core/domain/coach';
import { applySettingsExtPatch } from '../src/domain/settings/ext';
import { BOOTSTRAP_PILOT_PAGES, resolveHubErrorReference } from '@cg/testing/hub';

import { FakeBackground, TAB, settingsWithPersona } from './support/ai-background';
import { featuresOfBoth } from './support/features';
import { causeOf, fanslyTarget, persona, target, tokenN, withFanslyPage } from './support/world';

const bootstrapAt = (deepMax: number): Bootstrap => ({ ...withFanslyPage(BOOTSTRAP_PILOT_PAGES), limits: { ...BOOTSTRAP_PILOT_PAGES.limits, deepMax } });
const cause = causeOf(tokenN(1));
const input = { feature: 'recap', surface: 'dock', target: fanslyTarget, cause, options: {}, settings: DEFAULT_SETTINGS, bootstrap: bootstrapAt(5000), tone: null } as const;

function planned(over: Partial<Parameters<typeof planStart>[0]> = {}): StartOp {
  const result = planStart({ ...input, ...over });
  if (!result.ok) throw new Error(result.code);
  return result.start;
}

function savedWindows(deep: number | null) {
  const patch = SettingsExtPatchSchema.parse({ windows: { deep } });
  const result = applySettingsExtPatch({ v: 1, windows: { deep: 4000 } }, patch);
  if (!result.ok) throw new Error(result.reason);
  return result.ext.windows;
}

// Both marks: these are common rules, and the scheduler below uses each real host slice.
describe('[ST-093] [host:fansly] [host:chatspace] the stored deep wish and the wire window', () => {
  it('v1 stays at 3000; settings.ext holds 3001…5000 and clearing it restores the v1 wish', () => {
    expect(SettingsV1Schema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(SettingsV1Schema.safeParse({ ...DEFAULT_SETTINGS, generation: { ...DEFAULT_SETTINGS.generation, windows: { ...DEFAULT_SETTINGS.generation.windows, deep: 3001 } } }).success).toBe(false);
    for (const deep of [3001, 5000]) {
      const extendedWindows = savedWindows(deep);
      expect(planned({ extendedWindows }).window).toBe(deep);
      expect(extendedWindows.deep).toBe(deep);
    }
    for (const deep of [3000, 5001]) expect(SettingsExtPatchSchema.safeParse({ windows: { deep } }).success).toBe(false);
    const settings = { ...DEFAULT_SETTINGS, generation: { ...DEFAULT_SETTINGS.generation, windows: { ...DEFAULT_SETTINGS.generation.windows, deep: 1200 } } };
    expect(planned({ settings, extendedWindows: savedWindows(null) }).window).toBe(1200);
    expect(planned({ settings }).window).toBe(1200);
  });

  it.each([1500, 3000, 5000])('at deepMax %i the planner caps the wish without changing what is stored', (deepMax) => {
    for (const wish of [3001, 5000]) {
      const extendedWindows = savedWindows(wish);
      const bootstrap = bootstrapAt(deepMax);
      expect(planned({ bootstrap, extendedWindows }).window).toBe(Math.min(wish, deepMax));
      expect(planned({ bootstrap, options: { window: wish } }).window).toBe(Math.min(wish, deepMax));
      expect(planned({ bootstrap, extendedWindows, options: { window: 1000 } }).window).toBe(1000);
      expect(extendedWindows.deep).toBe(wish);
      expect(planned({ bootstrap: bootstrapAt(5000), extendedWindows }).window).toBe(wish);
    }
  });

  it('the deep bucket uses the extended wish; quick windows and the short recap keep their depths', () => {
    const extendedWindows = savedWindows(5000);
    const win = (feature: Parameters<typeof windowFor>[0]) => windowFor(feature, undefined, DEFAULT_SETTINGS, bootstrapAt(5000), extendedWindows);
    expect((['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'recap-short', 'coach'] as const).map(win)).toEqual([100, 25, 25, 100, 5000, 5000, 300, 100]);
    expect(windowFor('recap', 9000, DEFAULT_SETTINGS, bootstrapAt(9000))).toBe(5000);
    expect(planned().window).toBe(3000);
  });

  it.each([1500, 3000, 5000])('the Coach full auto-recap uses the extended wish within deepMax %i', (deepMax) => {
    const extendedWindows = savedWindows(5000);
    const turn = planned({ feature: 'coach', surface: 'coach', options: { question: 'What next?' }, autoRecap: 'full', bootstrap: bootstrapAt(deepMax), extendedWindows });
    expect(StartOpSchema.safeParse(turn).success).toBe(true);
    expect(turn.window).toBe(100);
    expect(coachTurnSteps(turn)?.recap.window).toBe(deepMax);
    const short = planned({ feature: 'coach', surface: 'coach', options: { question: 'What next?' }, autoRecap: 'short', bootstrap: bootstrapAt(deepMax), extendedWindows });
    expect(coachTurnSteps(short)?.recap.window).toBe(300);
  });
});

describe('[ST-093] [host:fansly] [host:chatspace] the scheduler never sends above the background bootstrap', () => {
  for (const destination of [target, fanslyTarget]) {
    for (const wish of [3001, 5000]) {
      it.each([1500, 3000, 5000])(`${destination.binding.host}, wish ${wish}, background deepMax %i: the outgoing body is capped`, async (deepMax) => {
        const settings = settingsWithPersona();
        const background = new FakeBackground({
          bootstrap: bootstrapAt(deepMax), resolve: resolveHubErrorReference, features: featuresOfBoth,
          settings: { ...settings, personas: { ...settings.personas, byPageId: { ...settings.personas.byPageId, [String(destination.binding.pageId)]: persona } } },
        });
        // The tab still has the earlier 5000 bootstrap; the background has the current one.
        const start = planned({ target: destination, extendedWindows: savedWindows(wish) });
        expect(start.window).toBe(wish);
        const { actionToken } = background.tokens.issue(TAB, 'generate', start.surface);
        background.hub.streamScript.push({ kind: 'hang' });
        const result = await background.scheduler.start(TAB, { ...start, cause: { kind: 'click', actionToken } });
        expect(result).toMatchObject({ kind: 'admission', admission: { ok: true } });
        await background.clock.advance(0);
        expect(background.hub.streams).toHaveLength(1);
        expect(background.hub.streams[0]).toMatchObject({ feature: 'fan-summary', body: { platform: destination.binding.platform, messageCount: Math.min(wish, deepMax) } });
        expect(background.hub.streams[0]?.capabilities).toContain('context-v1');
        if (deepMax < 5000) expect(background.hub.streams[0]?.body.messageCount).toBeLessThan(3001);
        if (result.kind === 'admission' && result.admission.ok) background.scheduler.cancel(result.admission.opId);
        await background.clock.advance(0);
      });
    }
  }
});
