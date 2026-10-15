// The table of the owner's switches as ChatSpace reads it on today's hub, BEFORE and AFTER R20 F4
// (docs/project-unite/plan.md, row F4; architecture.md §1.4).
//
// Before F4 the client carried its own copy of the hub's requirements (`CLIENT_FLAG_REQUIREMENTS`: the
// capabilities a flag needs) and a table of the switch of each AI feature (`FEATURE_FLAGS`), and checked both on
// top of the page's feature. F4 took the copy out: a switch is the page's own feature, a feature is admitted by
// the manifest, and the one thing the client still checks itself is its own transport need (`context-v1` for
// fresh text). This test keeps the OLD rule, frozen as it was on main before F4, and holds the new reading to it
// over every preset of the fake hub — the hub as it answers today — and over every way that hub can lag behind
// the SDK (each capability missing, none served, production's set before its last deploy).
//
// The fake hub computes a page's feature the way the hub does (config.ts `featureVerdict`, the hub's own table),
// which is the whole point: the capabilities are already in the page's answer.
//
// Contracts 1.15.0 (R20 P4b3) put Fansly's own six switches into the shared vocabulary. The table below is
// ChatSpace's: the sixteen switches it had, the only ones that exist on an OnlyFans page — each reads exactly as it
// did; no ChatSpace feature asks a flag outside its allowlist (master off still disables every flag, HF-15).

import { NON_CHATSPACE_FEATURE_FLAGS } from '@cg/contracts/fixtures';
import {
  BootstrapSchema,
  CLIENT_FEATURE_FLAG_NAMES,
  CLIENT_HUB_CAPABILITY_NAMES,
  FEATURE_IDS,
  hasCapability,
  type Bootstrap,
  type BootstrapPage,
  type ClientHubCapability,
  type FeatureId,
} from '@cg/contracts';
import { CHATSPACE_FEATURE_FLAGS, CHATSPACE_FEATURES, type ChatSpaceFeatureFlag } from '@cg/contracts/features/chatspace';
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { admission, admissionState, featureKeyOf, featureSlice, freshTextAdmitted, onPage } from '@cg/core/domain/features';
import { flagStateOf, pageFlagState, type FlagState } from '@cg/core/domain/ops';
import { describe, expect, it } from 'vitest';

import { BOOTSTRAP_ALL_OFF, BOOTSTRAP_PILOT_ON, BOOTSTRAP_PILOT_PAGES, HUB_FEATURE_CAPABILITIES, NOW_MS, WORLD, hubServing } from '../scenarios/hub';
import { FAKE_PAGES, PILOT_CAPABILITIES, bootstrapOf, patchConfig, pilotPageFlags, presetConfig, type FakeHubConfig } from './config';
import type { BootstrapPresetName } from './types';

// ── the rule as it was on main before F4 (f5a360f) ─────────────────────────

/** Fansly's own switches (contracts 1.15.0, P4b3): on an OnlyFans page none of them exists (hub HF-2). */
const FANSLY_FLAGS = NON_CHATSPACE_FEATURE_FLAGS;
/** The switches ChatSpace had before F4 — and still the only ones an OnlyFans page has. */
type ChatSpaceFlag = ChatSpaceFeatureFlag;

/** `CLIENT_FLAG_REQUIREMENTS[flag].capabilities` of contracts/src/hub/routes.ts before F4, word for word. */
const BEFORE_FLAG_CAPABILITIES: Readonly<Record<ChatSpaceFlag, readonly ClientHubCapability[]>> = {
  insertion: [],
  navigation: [],
  wsTap: [],
  sound: [],
  fanPanel: [],
  previewSendMarkAiGenerated: [],
  spenders: [],
  freshText: ['context-v1', 'live-text-v1'],
  splitAll: ['split-all-v1'],
  recap: ['shared-recaps-v1', 'recap-profile-v1'],
  review: [],
  coach: [],
  preview: ['archive-feed-v1'],
  stats: ['spenders-stats-v1', 'awaiting-reply-v1'],
  newcomers: ['audience-new-v1', 'preview-send-custody-v1'],
  previewSend: ['preview-send-custody-v1'],
};

/** ChatSpace's switches, in the vocabulary's order. */
const CHATSPACE_FLAGS = CHATSPACE_FEATURE_FLAGS;

/** `FEATURE_FLAGS` of core/src/domain/ops/environment.ts before F4 (and `FEATURE_POLICIES[feature].flag`, its double). */
const BEFORE_FEATURE_FLAGS: Readonly<Record<FeatureId, ChatSpaceFlag | null>> = { reply: null, fix: null, hi: null, ping: null, review: 'review', recap: 'recap', 'recap-short': 'recap', coach: 'coach' };

/** `pageFlagState` of core/src/domain/ops/flags.ts before F4. */
function before(bootstrap: Bootstrap, page: BootstrapPage | undefined, flag: ChatSpaceFlag): FlagState {
  if (page === undefined) return { usable: false, reason: 'not_granted' };
  const feature = Object.prototype.hasOwnProperty.call(page.features, flag) ? page.features[flag] : undefined;
  if (feature === undefined) return { usable: false, reason: 'flag_off' };
  if (feature.available !== true) return { usable: false, reason: feature.reason ?? 'flag_off' };
  return BEFORE_FLAG_CAPABILITIES[flag].every((capability) => hasCapability(bootstrap.capabilities, capability)) ? { usable: true, reason: null } : { usable: false, reason: 'hub_not_ready' };
}

// ── the hubs ───────────────────────────────────────────────────────────────

const chatter = { userId: WORLD.user.userId, username: WORLD.user.username, role: 'chatter', tokenClient: 'chat-extension' } as const;
const PRESETS: readonly BootstrapPresetName[] = ['pilot-pages', 'pilot-on', 'all-off', 'master-off'];
/** What production declared before its last deploy (hub client-capabilities.ts at 4a470029): a hub older than the SDK. */
const PROD_BEFORE_DEPLOY = ['context-v1', 'live-text-v1', 'shared-recaps-v1', 'recap-profile-v1', 'split-all-v1', 'ai-usage-v1'];

/** Every way a hub can serve less than the pilot: as the preset says, everything, production's older set, nothing, and each capability missing alone. */
const SERVED: readonly (readonly [string, readonly string[] | null])[] = [
  ['as the preset', null],
  ['every capability', [...CLIENT_HUB_CAPABILITY_NAMES]],
  ['production before its last deploy', PROD_BEFORE_DEPLOY],
  ['no capability', []],
  ...PILOT_CAPABILITIES.map((missing): readonly [string, readonly string[]] => [`without ${missing}`, PILOT_CAPABILITIES.filter((capability) => capability !== missing)]),
];

/** The owner's switches on top of a preset: as it is, X8 on for the pilot pages, a few pilot switches off there. */
const OWNER: readonly (readonly [string, (config: FakeHubConfig) => FakeHubConfig])[] = [
  ['as the preset', (config) => config],
  ['X8 on for the pilot pages', (config) => patchConfig(config, pilotPageFlags({ previewSend: true, previewSendMarkAiGenerated: true }))],
  ['insertion, review and fresh text off on the pilot pages', (config) => patchConfig(config, pilotPageFlags({ insertion: false, review: false, freshText: false }))],
  ['newcomers and recap off on the pilot pages, X8 on', (config) => patchConfig(config, pilotPageFlags({ newcomers: false, recap: false, previewSend: true }))],
];

interface Hub {
  readonly name: string;
  readonly bootstrap: Bootstrap;
}
const HUBS: readonly Hub[] = PRESETS.flatMap((preset) =>
  OWNER.flatMap(([owner, change]) =>
    SERVED.map(([served, capabilities]): Hub => {
      const config = change(presetConfig(preset));
      // P4c: the client drops the server-only greeting rate; compare exactly what ChatSpace reads.
      return { name: `${preset} · ${owner} · ${served}`, bootstrap: BootstrapSchema.parse(bootstrapOf(capabilities === null ? config : patchConfig(config, { capabilities }), FAKE_PAGES, chatter, NOW_MS)) };
    }),
  ),
);

const CHATSPACE = featureSlice(FEATURES_COMMON, CHATSPACE_FEATURES);
const state = (usable: FlagState): string => (usable.usable ? 'on' : (usable.reason ?? 'off'));

describe('[R20-F4] the ChatSpace table of switches on today’s hub is the same before and after', () => {
  it('the hubs under test are the presets of the fake hub, as the scenarios pin them, in every state a hub can lag in', () => {
    expect(HUBS).toHaveLength(PRESETS.length * OWNER.length * SERVED.length);
    expect(HUBS.find((hub) => hub.name === 'pilot-pages · as the preset · as the preset')?.bootstrap).toEqual(BOOTSTRAP_PILOT_PAGES);
    expect(HUBS.find((hub) => hub.name === 'pilot-on · as the preset · as the preset')?.bootstrap).toEqual(BOOTSTRAP_PILOT_ON);
    expect(HUBS.find((hub) => hub.name === 'all-off · as the preset · as the preset')?.bootstrap).toEqual(BOOTSTRAP_ALL_OFF);
    // The fake hub's rule is the hub's table: the client's old copy named the same capabilities, plus its own `context-v1`.
    for (const flag of CHATSPACE_FLAGS) expect(BEFORE_FLAG_CAPABILITIES[flag].filter((capability) => !(flag === 'freshText' && capability === 'context-v1')), flag).toEqual(HUB_FEATURE_CAPABILITIES[flag]);
    // The vocabulary is ChatSpace's sixteen and Fansly's six, and the hub's OnlyFans column names exactly the sixteen.
    expect([...CHATSPACE_FLAGS, ...FANSLY_FLAGS].sort()).toEqual([...CLIENT_FEATURE_FLAG_NAMES].sort());
    expect(Object.keys(HUB_FEATURE_CAPABILITIES).sort()).toEqual([...CHATSPACE_FLAGS].sort());
    // And the table is not trivially all-off or all-on: the hubs disagree with each other on every switch but X8's mark.
    for (const flag of CHATSPACE_FLAGS) {
      const seen = new Set(HUBS.flatMap((hub) => hub.bootstrap.pages.map((page) => state(pageFlagState(page, flag)))));
      expect(seen.has('on') && seen.size > 1, `${flag}: ${[...seen].join(', ')}`).toBe(true);
    }
  });

  it('every switch of every page reads as it did — the page’s own feature already carries what the hub serves', () => {
    let rows = 0;
    for (const { name, bootstrap } of HUBS) {
      for (const page of bootstrap.pages) {
        for (const flag of CHATSPACE_FLAGS) {
          // Fresh text is the one switch the client adds a need of its own to; its row is the next test's.
          if (flag === 'freshText') continue;
          expect(pageFlagState(page, flag), `${name} · ${page.pageLabel} · ${flag}`).toEqual(before(bootstrap, page, flag));
          expect(flagStateOf(bootstrap, page.pageId, flag), `${name} · ${page.pageLabel} · ${flag}`).toEqual(before(bootstrap, page, flag));
          rows += 1;
        }
      }
    }
    expect(rows).toBe(HUBS.length * FAKE_PAGES.length * (CHATSPACE_FLAGS.length - 1));
  });

  it('[R20-P4b3] Fansly’s own switches are not on a ChatSpace page in any hub, and no ChatSpace feature asks one', () => {
    // P6c1 gives Fansly its own features; this regression covers ChatSpace's OnlyFans pages.
    for (const { name, bootstrap } of HUBS) {
      expect(bootstrap.pages.filter((page) => page.platform === 'onlyfans')).toHaveLength(2);
      for (const page of bootstrap.pages.filter((candidate) => candidate.platform === 'onlyfans')) {
        for (const flag of FANSLY_FLAGS) expect(pageFlagState(page, flag), `${name} · ${page.pageLabel} · ${flag}`).toEqual({ usable: false, reason: page.features['insertion']?.reason === 'disabled' ? 'disabled' : 'platform_unsupported' });
      }
    }
    // Even an owner who writes them into the pilot pages' rows and into `"*"` switches nothing on there.
    const eager = patchConfig(presetConfig('pilot-pages'), { flags: { drafts: true, voice: true }, ...pilotPageFlags({ drafts: true, voice: true, notesFill: true, notes: true, vault: true, registration: true }) });
    for (const page of bootstrapOf(eager, FAKE_PAGES, chatter, NOW_MS).pages.filter((candidate) => candidate.platform === 'onlyfans')) {
      for (const flag of FANSLY_FLAGS) expect(pageFlagState(page, flag).reason, `${page.pageLabel} · ${flag}`).toBe('platform_unsupported');
    }
    const asked = Object.values(CHATSPACE).flatMap((entry) => [entry.base, ...Object.values(entry.actions)].flatMap((requirement) => requirement.flags));
    for (const flag of FANSLY_FLAGS) expect(asked, flag).not.toContain(flag);
  });

  it('fresh page text is admitted exactly where the old rule let it through: the page’s `freshText` and the client’s own `context-v1`', () => {
    for (const { name, bootstrap } of HUBS) {
      for (const page of bootstrap.pages) {
        const was = before(bootstrap, page, 'freshText');
        const now = admissionState(admission(CHATSPACE, 'fresh-text', null, onPage(bootstrap, page)));
        expect(now, `${name} · ${page.pageLabel}`).toEqual(was);
        expect(freshTextAdmitted(CHATSPACE, bootstrap, page.pageId), `${name} · ${page.pageLabel}`).toBe(was.usable);
      }
    }
    // The one place the switch alone reads otherwise: a hub that offers fresh text (`live-text-v1`) without the header
    // the client needs. No hub was ever deployed so; the SWITCH is then the hub's answer, the FEATURE stays off.
    const odd = HUBS.find((hub) => hub.name === 'pilot-pages · as the preset · without context-v1')?.bootstrap as Bootstrap;
    const page = odd.pages[0] as BootstrapPage;
    expect([pageFlagState(page, 'freshText'), before(odd, page, 'freshText'), admissionState(admission(CHATSPACE, 'fresh-text', null, onPage(odd, page)))]).toEqual([
      { usable: true, reason: null },
      { usable: false, reason: 'hub_not_ready' },
      { usable: false, reason: 'hub_not_ready' },
    ]);
  });

  it('[AI-121] the generation of every AI feature is admitted exactly where its old switch let it start, with the same reason', () => {
    let rows = 0;
    for (const { name, bootstrap } of HUBS) {
      for (const page of bootstrap.pages) {
        for (const feature of FEATURE_IDS) {
          const flag = BEFORE_FEATURE_FLAGS[feature];
          const was: FlagState = flag === null ? { usable: true, reason: null } : before(bootstrap, page, flag);
          expect(admissionState(admission(CHATSPACE, featureKeyOf(feature), 'generate', onPage(bootstrap, page))), `${name} · ${page.pageLabel} · ${feature}`).toEqual(was);
          rows += 1;
        }
      }
    }
    expect(rows).toBe(HUBS.length * FAKE_PAGES.length * FEATURE_IDS.length);
  });

  it('[UI-027] [X8-01] an insert, the two windows, a send from a preview and a greeting from «Новые» are admitted exactly as their old switches read', () => {
    const both = (a: FlagState, b: FlagState): FlagState => (a.usable ? b : a);
    for (const { name, bootstrap } of HUBS) {
      for (const page of bootstrap.pages) {
        const was = (flag: ChatSpaceFlag): FlagState => before(bootstrap, page, flag);
        const now = (id: string, action: 'generate' | 'insert' | 'send' | null): FlagState => admissionState(admission(CHATSPACE, id, action, onPage(bootstrap, page)));
        const where = `${name} · ${page.pageLabel}`;
        // The dock is copy-only by `insertion` alone, whatever a draft's generation reads.
        expect(now('reply', 'insert'), where).toEqual(was('insertion'));
        expect(now('spenders', null), where).toEqual(was('spenders'));
        expect(now('newcomers', null), where).toEqual(was('newcomers'));
        expect(now('fan-panel', null), where).toEqual(was('fanPanel'));
        expect(now('sound', null), where).toEqual(was('sound'));
        expect(now('navigation', null), where).toEqual(was('navigation'));
        // X8: a preview's send by `previewSend`; a greeting by `newcomers` AND `previewSend` (send-coordinator's gate reads the same two).
        expect(now('preview-send', 'send'), where).toEqual(was('previewSend'));
        expect(now('newcomers', 'send'), where).toEqual(both(was('newcomers'), was('previewSend')));
      }
    }
  });

  it('the scenarios’ own helper for a hub that lags gives the bootstrap the fake hub computes', () => {
    for (const [, capabilities] of SERVED) {
      if (capabilities === null) continue;
      const computed = BootstrapSchema.parse(bootstrapOf(patchConfig(presetConfig('pilot-pages'), { capabilities }), FAKE_PAGES, chatter, NOW_MS));
      expect(hubServing(BOOTSTRAP_PILOT_PAGES, capabilities)).toEqual({ ...computed, configRevision: BOOTSTRAP_PILOT_PAGES.configRevision });
    }
  });
});
