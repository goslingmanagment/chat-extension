// Admission by the feature manifest (domain/features/admission.ts; R20 F4, docs/project-unite/architecture.md §1.4):
// `absent` / `off` with the reason / `on`, a feature and each thing done with it admitted on its own, everything
// inside a requirement AND. With the negative fixtures of the plan: a page without `insertion` still generates;
// a greeting from «Новые» of ChatSpace needs `newcomers` AND `previewSend`.

import { describe, expect, it } from 'vitest';

import { FEATURE_IDS, HOST_CAPABILITIES, type Bootstrap, type BootstrapPage, type ClientFeatureFlag } from '@cg/contracts';
import { CHATSPACE_FEATURES } from '@cg/contracts/features/chatspace';
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import type { AdmissionAction, FeatureSlice } from '@cg/contracts/features/types';
import { admission, admissionState, featureKeyOf, featurePresent, featureSlice, freshTextAdmitted, onPage, type AdmissionFacts, type FeatureAdmission, type HostCapabilityStates } from '@cg/core/domain/features';
import { flagRefusal, pageBlanketReason, pageSwitchedOff } from '@cg/core/domain/ops';
import { BOOTSTRAP_ALL_OFF, BOOTSTRAP_PILOT_PAGES, WORLD, hubServing, pageFeaturesOff } from '@cg/testing/hub';

import { CHATSPACE, FANSLY } from './support/features';
import { withX8 } from './support/world';

const PAGE_ID = WORLD.pages.one.pageId;
const pageOf = (bootstrap: Bootstrap, pageId: number = PAGE_ID): BootstrapPage | undefined => bootstrap.pages.find((page) => page.pageId === pageId);
const HOST_ON: HostCapabilityStates = Object.fromEntries(HOST_CAPABILITIES.map((capability) => [capability, { state: 'on' }]));
const hostWith = (over: Record<string, string>): HostCapabilityStates => ({ ...HOST_ON, ...Object.fromEntries(Object.entries(over).map(([capability, state]) => [capability, { state }])) });

const ON: FeatureAdmission = { state: 'on' };
const ABSENT: FeatureAdmission = { state: 'absent' };
const off = (reason: string): FeatureAdmission => ({ state: 'off', reason });

/** ChatSpace, every switch of the page on (X8 included), the tab's host in order. */
const ALL_ON = withX8(BOOTSTRAP_PILOT_PAGES);
const ask = (id: string, action: AdmissionAction | null, bootstrap: Bootstrap = ALL_ON, host: HostCapabilityStates | null = HOST_ON, slice: FeatureSlice = CHATSPACE): FeatureAdmission =>
  admission(slice, id, action, onPage(bootstrap, pageOf(bootstrap), host));

/** A Fansly page as a hub that knows Fansly's switches answers it: the named ones on, everything else `flag_off`. */
function fanslyPage(on: readonly string[]): Bootstrap {
  const page: BootstrapPage = { ...(BOOTSTRAP_PILOT_PAGES.pages.find((candidate) => candidate.platform === 'fansly') as BootstrapPage), features: Object.fromEntries(on.map((flag) => [flag, { available: true }])) };
  return { ...BOOTSTRAP_PILOT_PAGES, pages: [page] };
}
const askFansly = (id: string, action: AdmissionAction | null, on: readonly string[], host: HostCapabilityStates | null = null): FeatureAdmission => {
  const bootstrap = fanslyPage(on);
  return admission(FANSLY, id, action, onPage(bootstrap, bootstrap.pages[0], host));
};

describe('[R20-F4] a site’s slice of the manifest', () => {
  it('is the site’s own file with the common part of each feature; a feature only that site has carries its own', () => {
    expect(Object.keys(CHATSPACE)).toEqual(Object.keys(CHATSPACE_FEATURES));
    expect(Object.keys(FANSLY)).toEqual(Object.keys(FANSLY_FEATURES));
    expect(CHATSPACE['reply']).toEqual({ ...FEATURES_COMMON.reply, ...CHATSPACE_FEATURES.reply });
    expect(FANSLY['reply']).toEqual({ ...FEATURES_COMMON.reply, ...FANSLY_FEATURES.reply });
    expect(CHATSPACE['preview-send']).toEqual(CHATSPACE_FEATURES['preview-send']);
    for (const slice of [CHATSPACE, FANSLY]) for (const [id, entry] of Object.entries(slice)) expect(typeof entry.kind, id).toBe('string');
    // The common part alone puts nothing into a slice: a site that does not list a feature does not have it.
    expect(featureSlice(FEATURES_COMMON, {})).toEqual({});
  });

  it('the manifest’s key of an AI feature is the feature’s own id; the two lengths of Recap are one feature', () => {
    expect(FEATURE_IDS.map(featureKeyOf)).toEqual(['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'recap', 'coach']);
    for (const feature of FEATURE_IDS) for (const slice of [CHATSPACE, FANSLY]) expect(featurePresent(slice, featureKeyOf(feature)), feature).toBe(true);
  });
});

describe('[R20-F4] admission: absent, off, on', () => {
  it('a feature the site does not have is `absent`, whatever the page says; so is an action the feature does not have there', () => {
    for (const id of ['voice', 'notes', 'notes-fill', 'registration', 'vault', 'via-tab', 'no-such-feature']) expect(ask(id, null), id).toEqual(ABSENT);
    for (const id of ['preview-send', 'navigation', 'palette']) expect(askFansly(id, null, ['previewSend', 'navigation']), id).toEqual(ABSENT);
    // Recap and Review are not messages: nothing of them is inserted or sent. A draft is not sent from the dock.
    expect([ask('recap', 'insert'), ask('review', 'send'), ask('spenders', 'generate'), ask('reply', 'send')]).toEqual([ABSENT, ABSENT, ABSENT, ABSENT]);
    // No slice at all — the asker serves no such site.
    expect(admission(null, 'reply', 'generate', onPage(ALL_ON, pageOf(ALL_ON)))).toEqual(ABSENT);
    // A name of Object.prototype is not a feature.
    expect(ask('constructor', null)).toEqual(ABSENT);
    expect(featurePresent(CHATSPACE, 'toString')).toBe(false);
  });

  it('`on` when everything of `base` and of the action holds; the page’s switch speaks in the hub’s own words when it does not', () => {
    expect([ask('review', 'generate'), ask('recap', 'generate'), ask('coach', 'generate'), ask('spenders', null), ask('newcomers', null), ask('fan-panel', null), ask('sound', null)]).toEqual([ON, ON, ON, ON, ON, ON, ON]);
    for (const [flag, id] of [['review', 'review'], ['recap', 'recap'], ['coach', 'coach'], ['spenders', 'spenders'], ['fanPanel', 'fan-panel'], ['sound', 'sound'], ['navigation', 'navigation']] as const) {
      expect(ask(id, null, pageFeaturesOff(ALL_ON, [flag])), id).toEqual(off('flag_off'));
      expect(ask(id, null, pageFeaturesOff(ALL_ON, [flag], { reason: 'hub_not_ready' })), id).toEqual(off('hub_not_ready'));
    }
    // The master switch, a page of another platform, a page that is not granted, no bootstrap at all.
    expect(ask('coach', 'generate', BOOTSTRAP_ALL_OFF)).toEqual(off('disabled'));
    // A Fansly page: a switch Fansly does not have is `platform_unsupported`; one it has waits for the page's own row (R20 HF-2).
    expect(admission(CHATSPACE, 'navigation', null, onPage(ALL_ON, pageOf(ALL_ON, WORLD.pages.fansly.pageId)))).toEqual(off('platform_unsupported'));
    expect(admission(CHATSPACE, 'coach', 'generate', onPage(ALL_ON, pageOf(ALL_ON, WORLD.pages.fansly.pageId)))).toEqual(off('flag_off'));
    expect(admission(CHATSPACE, 'coach', 'generate', onPage(ALL_ON, undefined))).toEqual(off('not_granted'));
    expect(admission(CHATSPACE, 'coach', 'generate', onPage(null, undefined))).toEqual(off('hub_not_ready'));
    // A switch the page does not list at all (an older hub, a switch the hub has not shipped): off, as a flag set nowhere.
    expect(askFansly('reply', 'generate', [])).toEqual(off('flag_off'));
  });

  it('a draft on ChatSpace has no switch of its own: only the master switch and the build’s version stand before it, and they are not the manifest’s', () => {
    for (const id of ['reply', 'fix', 'hi', 'ping']) {
      expect(ask(id, 'generate', pageFeaturesOff(ALL_ON, ['review', 'recap', 'coach', 'insertion', 'freshText', 'previewSend', 'newcomers'])), id).toEqual(ON);
      // Even a page whose every feature reads `disabled`: that is the page's blanket answer, read before any admission (`pageSwitchedOff`).
      expect(ask(id, 'generate', BOOTSTRAP_ALL_OFF), id).toEqual(ON);
    }
  });

  it('the master switch is the page’s blanket answer on HF-15 and older HF-2 hubs', () => {
    const one = pageOf(BOOTSTRAP_ALL_OFF, PAGE_ID) as BootstrapPage;
    // HF-15: master off answers disabled for every feature, including the other platform's.
    expect([one.features['drafts'], one.features['coach']]).toEqual([{ available: false, reason: 'disabled' }, { available: false, reason: 'disabled' }]);
    expect([pageBlanketReason(one), pageSwitchedOff(one)]).toEqual(['disabled', true]);
    // A page whose features disagree has no blanket answer; nor one whose platform has none of the switches (a hub before HF-2 on Fansly).
    const mixed: BootstrapPage = { ...one, features: { ...one.features, coach: { available: false, reason: 'flag_off' } } };
    expect([pageBlanketReason(mixed), pageSwitchedOff(mixed)]).toEqual([null, false]);
    const fansly = pageOf(BOOTSTRAP_ALL_OFF, WORLD.pages.fansly.pageId) as BootstrapPage;
    expect([fansly.features['drafts'], fansly.features['navigation']]).toEqual([{ available: false, reason: 'disabled' }, { available: false, reason: 'disabled' }]);
    expect([pageBlanketReason(fansly), pageSwitchedOff(fansly)]).toEqual(['disabled', true]);
    const older: BootstrapPage = { ...one, features: { ...one.features, drafts: { available: false, reason: 'platform_unsupported' } } };
    expect([pageBlanketReason(older), pageSwitchedOff(older)]).toEqual(['disabled', true]);
    const beforeHf2: BootstrapPage = { ...fansly, features: Object.fromEntries(Object.keys(fansly.features).map((flag) => [flag, { available: false, reason: 'platform_unsupported' }])) };
    expect([pageBlanketReason(beforeHf2), pageSwitchedOff(beforeHf2)]).toEqual([null, false]);
  });

  it('in the shape of a switch: usable, or the reason; a feature the site does not have reads as one its platform lacks', () => {
    expect(admissionState(ON)).toEqual({ usable: true, reason: null });
    expect(admissionState(off('flag_off'))).toEqual({ usable: false, reason: 'flag_off' });
    expect(admissionState(ABSENT)).toEqual({ usable: false, reason: 'platform_unsupported' });
    // The codes a refused admission reads as: the hub's reasons as before, and the site's own page.
    expect(flagRefusal(admissionState(off('hub_not_ready')))).toEqual({ code: 'CG-HUB-CAPABILITY', detail: 'hub_not_ready' });
    expect(flagRefusal(admissionState(off('host_degraded')))).toEqual({ code: 'CG-HOST-CONTRACT', detail: 'host_degraded' });
    expect(flagRefusal(admissionState(ABSENT))).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'platform_unsupported' });
  });
});

describe('[R20-F4] generation, insert and send are admitted each on its own (negative fixtures)', () => {
  it('[UI-027] `insertion` off does not close the generation: the page generates, and its parts can only be copied', () => {
    const noInsert = pageFeaturesOff(ALL_ON, ['insertion']);
    for (const id of ['reply', 'fix', 'hi', 'ping', 'coach']) {
      expect(ask(id, 'generate', noInsert), id).toEqual(ON);
      expect(ask(id, 'insert', noInsert), id).toEqual(off('flag_off'));
      expect(ask(id, 'insert'), id).toEqual(ON);
    }
    // The other way round too: a Coach that is off inserts nothing, but that is Coach's own switch, not `insertion`.
    const noCoach = pageFeaturesOff(ALL_ON, ['coach']);
    expect([ask('coach', 'insert', noCoach), ask('reply', 'insert', noCoach)]).toEqual([off('flag_off'), ON]);
    // On Fansly a draft needs `drafts`, an insert needs `insertion` on top — and neither stands in for the other.
    expect(askFansly('reply', 'generate', ['drafts'])).toEqual(ON);
    expect(askFansly('reply', 'insert', ['drafts'])).toEqual(off('flag_off'));
    expect(askFansly('reply', 'insert', ['insertion'])).toEqual(off('flag_off'));
    expect(askFansly('reply', 'insert', ['drafts', 'insertion'])).toEqual(ON);
    expect(askFansly('reply', 'generate', ['insertion'])).toEqual(off('flag_off'));
  });

  it('[X8-01] [NF-011] a greeting sent from «Новые» of ChatSpace needs `newcomers` AND `previewSend`: either one off refuses it', () => {
    expect(ask('newcomers', 'send')).toEqual(ON);
    expect(ask('newcomers', 'send', pageFeaturesOff(ALL_ON, ['previewSend']))).toEqual(off('flag_off'));
    expect(ask('newcomers', 'send', pageFeaturesOff(ALL_ON, ['newcomers']))).toEqual(off('flag_off'));
    expect(ask('newcomers', 'send', pageFeaturesOff(ALL_ON, ['previewSend', 'newcomers']))).toEqual(off('flag_off'));
    // The window itself needs `newcomers` alone: a page without X8 still lists its new subscribers.
    expect(ask('newcomers', null, pageFeaturesOff(ALL_ON, ['previewSend']))).toEqual(ON);
    // The pilot as the owner runs it: X8 off on every page — the list is there, a send is not.
    expect([ask('newcomers', null, BOOTSTRAP_PILOT_PAGES), ask('newcomers', 'send', BOOTSTRAP_PILOT_PAGES), ask('preview-send', 'send', BOOTSTRAP_PILOT_PAGES)]).toEqual([ON, off('flag_off'), off('flag_off')]);
    // A hub that does not serve the custody says so in the page's features, and both read it.
    const noCustody = hubServing(ALL_ON, ALL_ON.capabilities.filter((capability) => capability !== 'preview-send-custody-v1'));
    expect([ask('newcomers', null, noCustody), ask('preview-send', 'send', noCustody)]).toEqual([off('hub_not_ready'), off('hub_not_ready')]);
  });

  it('[X8-01] a send from a ChatSpace preview needs `previewSend`, ChatSpace’s queue and a receipt profile of the build; `newcomers` is not asked for it', () => {
    expect(ask('preview-send', 'send')).toEqual(ON);
    expect(ask('preview-send', 'send', pageFeaturesOff(ALL_ON, ['newcomers']))).toEqual(ON);
    expect(ask('preview-send', 'send', pageFeaturesOff(ALL_ON, ['previewSend']))).toEqual(off('flag_off'));
    for (const capability of ['previewSend', 'receipt']) {
      for (const state of ['off', 'degraded', 'contractBroken']) expect(ask('preview-send', 'send', ALL_ON, hostWith({ [capability]: state })), `${capability} ${state}`).toEqual(off('host_degraded'));
      expect(ask('newcomers', 'send', ALL_ON, hostWith({ [capability]: 'off' })), capability).toEqual(off('host_degraded'));
    }
    // The owner's switch is said before the page's own trouble.
    expect(ask('preview-send', 'send', pageFeaturesOff(ALL_ON, ['previewSend']), hostWith({ receipt: 'off' }))).toEqual(off('flag_off'));
  });

  it('on Fansly a greeting needs `newcomers` alone — there is no `previewSend` there — and the list is a pass, not the hub’s', () => {
    expect(askFansly('newcomers', 'send', ['newcomers'])).toEqual(ON);
    expect(askFansly('newcomers', 'send', ['previewSend'])).toEqual(off('flag_off'));
    expect([CHATSPACE['newcomers']?.source, FANSLY['newcomers']?.source]).toEqual(['hub', 'host-pass']);
  });

  it('voice and «Заполнить из чата» are Fansly’s: their own switches, and the file goes into the field only where the page can take one', () => {
    expect(askFansly('voice', 'generate', ['voice'])).toEqual(ON);
    expect(askFansly('voice', 'generate', ['drafts', 'insertion'])).toEqual(off('flag_off'));
    expect(askFansly('voice', 'insert', ['voice'], { fileAttach: { state: 'on' } })).toEqual(ON);
    expect(askFansly('voice', 'insert', ['voice'], { fileAttach: { state: 'off' } })).toEqual(off('host_degraded'));
    expect(askFansly('notes-fill', 'generate', ['notesFill'])).toEqual(ON);
    expect(askFansly('notes-fill', 'generate', ['notes'])).toEqual(off('flag_off'));
    expect(askFansly('notes', null, ['notes'], { headerSlot: { state: 'on' } })).toEqual(ON);
  });
});

describe('[R20-F4] what an admission reads', () => {
  it('a capability of the site is the tab’s to check: with a report it must be `on`; without one (the background) it is not asked', () => {
    expect(ask('reply', 'insert', ALL_ON, hostWith({ insert: 'degraded' }))).toEqual(off('host_degraded'));
    expect(ask('reply', 'insert', ALL_ON, null)).toEqual(ON);
    // A capability the report does not carry is not on.
    expect(ask('reply', 'insert', ALL_ON, {})).toEqual(off('host_degraded'));
    // A generation asks nothing of the page: it runs on the hub's archive.
    expect(ask('reply', 'generate', ALL_ON, {})).toEqual(ON);
  });

  it('[AI-121] fresh page text: the owner’s `freshText` of the page AND the `context-v1` this client’s request needs', () => {
    expect(ask('fresh-text', null, BOOTSTRAP_PILOT_PAGES)).toEqual(ON);
    expect(ask('fresh-text', null, pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['freshText']))).toEqual(off('flag_off'));
    // The hub offers fresh text with `live-text-v1`; the header is the client's own need, on top of the hub's answer.
    const noHeader = hubServing(BOOTSTRAP_PILOT_PAGES, BOOTSTRAP_PILOT_PAGES.capabilities.filter((capability) => capability !== 'context-v1'));
    expect(pageOf(noHeader)?.features['freshText']).toEqual({ available: true });
    expect(ask('fresh-text', null, noHeader)).toEqual(off('hub_not_ready'));
    const noLiveText = hubServing(BOOTSTRAP_PILOT_PAGES, BOOTSTRAP_PILOT_PAGES.capabilities.filter((capability) => capability !== 'live-text-v1'));
    expect(ask('fresh-text', null, noLiveText)).toEqual(off('hub_not_ready'));
    expect([BOOTSTRAP_PILOT_PAGES, noHeader, noLiveText, BOOTSTRAP_ALL_OFF].map((bootstrap) => freshTextAdmitted(CHATSPACE, bootstrap, PAGE_ID))).toEqual([true, false, false, false]);
    expect([freshTextAdmitted(CHATSPACE, null, PAGE_ID), freshTextAdmitted(CHATSPACE, BOOTSTRAP_PILOT_PAGES, 999), freshTextAdmitted(null, BOOTSTRAP_PILOT_PAGES, PAGE_ID)]).toEqual([false, false, false]);
  });

  it('who asks decides how a switch is read: the hub layer’s gate hands its own reading in, and its reason comes back as it is', () => {
    const asked: string[] = [];
    const gate = (states: Partial<Record<ClientFeatureFlag, string | null>>): AdmissionFacts => ({
      flag: (flag) => {
        asked.push(flag);
        const reason = (states as Record<string, string | null | undefined>)[flag];
        return reason === undefined || reason === null ? { usable: true, reason: null } : { usable: false, reason };
      },
      serves: () => true,
    });
    expect(admission(CHATSPACE, 'coach', 'insert', gate({}))).toEqual(ON);
    expect(asked).toEqual(['coach', 'insertion']);
    expect(admission(CHATSPACE, 'coach', 'insert', gate({ insertion: 'bootstrap_expired' }))).toEqual(off('bootstrap_expired'));
    // AND: the first thing that does not hold is the answer, `base` before the action's own.
    expect(admission(CHATSPACE, 'coach', 'insert', gate({ coach: 'flag_off', insertion: 'bootstrap_expired' }))).toEqual(off('flag_off'));
  });
});
