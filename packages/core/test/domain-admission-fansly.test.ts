// The feature policies on fansly.com (RU-001 on Fansly; R20 F4, docs/project-unite/architecture.md §1.4, §11.1):
// Fansly's slice of the feature manifest — the common part with Fansly's own file — and what it admits. The policy
// of each AI feature (`FEATURE_POLICIES`: where its result lives, its window, tone, Split, timeouts) is shared code
// and the same on both sites; what a feature NEEDS on Fansly is the slice's. A test of shared code, marked for its
// site: every test of this file is on Fansly.

import { describe, expect, it } from 'vitest';

import { CLIENT_FEATURE_UNAVAILABLE_REASONS, FEATURE_IDS, type Bootstrap, type BootstrapPage } from '@cg/contracts';
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import type { AdmissionAction } from '@cg/contracts/features/types';
import { FEATURE_POLICIES, admission, dockChips, featureKeyOf, featurePresent, featureSlice, onPage, type FeatureAdmission } from '@cg/core/domain/features';
import { flagRefusal, pageFlagState, somePageFlagState } from '@cg/core/domain/ops';
import { BOOTSTRAP_PILOT_PAGES } from '@cg/testing/hub';

import { FANSLY } from './support/features';

/** A Fansly page as a hub that knows Fansly's switches answers it: the named ones on, everything else not listed. */
function fanslyPage(on: readonly string[]): { readonly bootstrap: Bootstrap; readonly page: BootstrapPage } {
  const base = BOOTSTRAP_PILOT_PAGES.pages.find((candidate) => candidate.platform === 'fansly') as BootstrapPage;
  const page: BootstrapPage = { ...base, features: Object.fromEntries(on.map((flag) => [flag, { available: true }])) };
  return { bootstrap: { ...BOOTSTRAP_PILOT_PAGES, pages: [page] }, page };
}
const ask = (id: string, action: AdmissionAction | null, on: readonly string[], host: Readonly<Record<string, { state: string }>> | null = null): FeatureAdmission => {
  const { bootstrap, page } = fanslyPage(on);
  return admission(FANSLY, id, action, onPage(bootstrap, page, host));
};
const ON: FeatureAdmission = { state: 'on' };
const ABSENT: FeatureAdmission = { state: 'absent' };
const OFF: FeatureAdmission = { state: 'off', reason: 'flag_off' };

describe('[RU-001] [host:fansly] the feature policies on Fansly: the common part and Fansly’s slice', () => {
  it('[RU-001] every AI feature of the vocabulary is in Fansly’s slice, with its policy as on ChatSpace; ChatSpace’s own features are not', () => {
    expect(FANSLY).toEqual(featureSlice(FEATURES_COMMON, FANSLY_FEATURES));
    for (const feature of FEATURE_IDS) {
      const key = featureKeyOf(feature);
      expect(featurePresent(FANSLY, key), feature).toBe(true);
      expect(FANSLY[key]?.kind, feature).toBe('ai');
      // The policy's key in the manifest is the feature's strip action.
      expect(FEATURE_POLICIES[feature].dockAction, feature).toBe(key);
    }
    for (const id of ['preview-send', 'navigation', 'palette']) expect(featurePresent(FANSLY, id), id).toBe(false);
    for (const id of ['voice', 'notes', 'notes-fill', 'registration', 'vault', 'via-tab']) expect(featurePresent(FANSLY, id), id).toBe(true);
  });

  it('[RU-001] a draft is generated under the page’s `drafts`, inserted under `insertion` on top; the analysis features ask their own switches', () => {
    for (const id of ['reply', 'fix', 'hi', 'ping']) {
      expect([ask(id, 'generate', ['drafts']), ask(id, 'generate', ['insertion']), ask(id, 'insert', ['drafts']), ask(id, 'insert', ['drafts', 'insertion'])], id).toEqual([ON, OFF, OFF, ON]);
      expect(ask(id, 'send', ['drafts', 'insertion']), id).toEqual(ABSENT);
    }
    for (const [id, flag] of [['review', 'review'], ['recap', 'recap'], ['coach', 'coach']] as const) expect([ask(id, 'generate', [flag]), ask(id, 'generate', ['drafts'])], id).toEqual([ON, OFF]);
    expect([ask('fresh-text', null, ['freshText']), ask('fresh-text', null, [])]).toEqual([ON, OFF]);
  });

  it('[RU-001] «Новые» and a greeting under `newcomers` alone; a voice note under `voice`, its file only where the field takes one; the notes and their filling under their own switches', () => {
    expect([ask('newcomers', null, ['newcomers']), ask('newcomers', 'send', ['newcomers']), ask('newcomers', 'send', ['previewSend'])]).toEqual([ON, ON, OFF]);
    expect([ask('voice', 'generate', ['voice']), ask('voice', 'insert', ['voice'], { fileAttach: { state: 'on' } }), ask('voice', 'insert', ['voice'], { fileAttach: { state: 'degraded' } })]).toEqual([ON, ON, { state: 'off', reason: 'host_degraded' }]);
    expect([ask('notes', null, ['notes'], { headerSlot: { state: 'on' } }), ask('notes-fill', 'generate', ['notesFill']), ask('notes-fill', 'generate', ['notes'])]).toEqual([ON, ON, OFF]);
    expect([ask('registration', null, ['registration'], { headerSlot: { state: 'on' } }), ask('vault', null, ['vault'], { vault: { state: 'on' } }), ask('via-tab', null, [], { relay: { state: 'on' } })]).toEqual([ON, ON, ON]);
  });

  it('[RU-001] the bar of Fansly from its slice: the seven actions and the two windows of the common part; the chip of 🎙 comes with its own PR’s words and action', () => {
    const action = { enabled: true, busy: false, active: false, reason: null, hotkey: null, badge: null } as const;
    const actions = { reply: action, fix: action, hi: action, ping: action, review: action, recap: action, coach: action };
    const chips = dockChips(FANSLY, actions, 'dock:fansly-web:1:2', () => null);
    expect(chips.map((chip) => `${chip.group}:${chip.id}`)).toEqual(['reply:reply', 'draft:fix', 'openers:hi', 'openers:ping', 'analysis:review', 'analysis:recap', 'analysis:coach', 'windows:spenders', 'windows:newcomers']);
    // The manifest places 🎙 after Fix; it is drawn once its feature brings its words and its action.
    expect(FANSLY['voice']?.chip).toEqual({ group: 'draft', priority: 20, icon: null });
  });
});

describe('[host:fansly] the voice lane’s `lane_off` (contracts 1.15.0, P4b3; hub HF-4б)', () => {
  /** A Fansly page whose `voice` reads as the hub answers it: available (null), or unavailable for this reason. */
  const voicePage = (pageId: number, reason: string | null): BootstrapPage => ({
    ...fanslyPage([]).page,
    pageId,
    features: { voice: reason === null ? { available: true } : { available: false, reason } },
  });
  const over = (pages: readonly BootstrapPage[]): Bootstrap => ({ ...BOOTSTRAP_PILOT_PAGES, pages: [...pages] });

  it('is a reason the client knows, and the page’s own: 🎙 is off on a page whose voice lane does not serve it', () => {
    expect(CLIENT_FEATURE_UNAVAILABLE_REASONS).toContain('lane_off');
    const page = voicePage(41, 'lane_off');
    expect(pageFlagState(page, 'voice')).toEqual({ usable: false, reason: 'lane_off' });
    for (const action of [null, 'generate', 'insert'] as const) {
      expect(admission(FANSLY, 'voice', action, onPage(over([page]), page, { fileAttach: { state: 'on' } })), String(action)).toEqual({ state: 'off', reason: 'lane_off' });
    }
    // Until the voice's own PRs give it words of their own, a refusal reads «выключено», with the hub's word kept.
    expect(flagRefusal({ reason: 'lane_off' })).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'lane_off' });
  });

  it('ranks after `hub_not_ready`: the lane is the hub’s last check, so a page whose lane is off got the furthest', () => {
    const reasons = ['platform_unsupported', 'disabled', 'flag_off', 'binding_missing', 'hub_not_ready', 'lane_off'];
    for (let i = 0; i < reasons.length; i += 1) {
      const pages = reasons.slice(0, i + 1).map((reason, index) => voicePage(100 + index, reason));
      for (const order of [pages, [...pages].reverse()]) expect(somePageFlagState(over(order), 'voice'), reasons[i]).toEqual({ usable: false, reason: reasons[i] });
    }
    // A page where it is usable wins over any reason; no page at all is `not_granted`.
    expect(somePageFlagState(over([voicePage(1, 'lane_off'), voicePage(2, null)]), 'voice')).toEqual({ usable: true, reason: null });
    expect(somePageFlagState(over([]), 'voice')).toEqual({ usable: false, reason: 'not_granted' });
  });
});
