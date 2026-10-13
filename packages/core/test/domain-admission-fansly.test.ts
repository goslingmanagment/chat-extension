// The feature policies on fansly.com (RU-001 on Fansly; R20 F4, docs/project-unite/architecture.md §1.4, §11.1):
// Fansly's slice of the feature manifest — the common part with Fansly's own file — and what it admits. The policy
// of each AI feature (`FEATURE_POLICIES`: where its result lives, its window, tone, Split, timeouts) is shared code
// and the same on both sites; what a feature NEEDS on Fansly is the slice's. A test of shared code, marked for its
// site: every test of this file is on Fansly.

import { describe, expect, it } from 'vitest';

import { FEATURE_IDS, type Bootstrap, type BootstrapPage } from '@cg/contracts';
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import type { AdmissionAction } from '@cg/contracts/features/types';
import { FEATURE_POLICIES, admission, dockChips, featureKeyOf, featurePresent, featureSlice, onPage, type FeatureAdmission } from '@cg/core/domain/features';
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
