// The owner's hub configuration as the fake hub models it: the presets give
// exactly the scenarios' bootstrap answers, features are judged in the hub's
// order (platform → master → flag → binding → capability; hub
// client-features.ts `evaluateClientFeature`), the top-level `flags` are the
// owner's `"*"` row alone (`clientBootstrapFlags`), and only owner changes
// bump configRevision (= custody flagRevision).

import { BootstrapSchema, CLIENT_FEATURE_FLAG_NAMES } from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import { BOOTSTRAP_ALL_OFF, BOOTSTRAP_PILOT_ON, BOOTSTRAP_PILOT_PAGES, HUB_FEATURE_REQUIREMENTS, NOW_MS, WORLD, hubFeatureNeedsOn } from '../scenarios/hub';
import { FAKE_PAGES, bootstrapOf, featureVerdict, flagOn, patchConfig, presetConfig, type FakePage } from './config';
import { createFakeHub } from './hub';
import { hubCall } from './kit';

const chatter = { userId: WORLD.user.userId, username: WORLD.user.username, role: 'chatter', tokenClient: 'chat-extension' } as const;
const one = FAKE_PAGES[0] as FakePage;
const vip = FAKE_PAGES[1] as FakePage;
const fansly = FAKE_PAGES[2] as FakePage;

describe('fake hub config: presets', () => {
  it('pilot-on is the scenarios’ BOOTSTRAP_PILOT_ON exactly', () => {
    expect(bootstrapOf(presetConfig('pilot-on'), FAKE_PAGES, chatter, NOW_MS)).toEqual(BOOTSTRAP_PILOT_ON);
  });

  it('pilot-pages — the default — is the scenarios’ BOOTSTRAP_PILOT_PAGES exactly: a row per page, `"*"` empty, every top-level flag false', () => {
    const boot = bootstrapOf(presetConfig('pilot-pages'), FAKE_PAGES, chatter, NOW_MS);
    expect(boot).toEqual(BOOTSTRAP_PILOT_PAGES);
    expect(Object.values(boot.flags).some(Boolean)).toBe(false);
    // The pages answer exactly what the `"*"` pilot answers: only the top-level flags tell the two apart.
    expect(boot.pages).toEqual(BOOTSTRAP_PILOT_ON.pages);
    expect(createFakeHub().config()).toEqual(presetConfig('pilot-pages'));
    // A flag the page rows do not name still follows `"*"` (X8 for everyone in one patch); one they name is switched per page.
    const x8 = patchConfig(presetConfig('pilot-pages'), { flags: { previewSend: true } });
    expect(flagOn(x8, one, 'previewSend')).toBe(true);
    const noStats = patchConfig(presetConfig('pilot-pages'), { flags: { stats: false }, pageFlags: { [one.pageLabel]: { review: false } } });
    expect([flagOn(noStats, one, 'stats'), flagOn(noStats, one, 'review'), flagOn(noStats, vip, 'review')]).toEqual([true, false, true]);
  });

  it('all-off is the scenarios’ BOOTSTRAP_ALL_OFF exactly', () => {
    expect(bootstrapOf(presetConfig('all-off'), FAKE_PAGES, chatter, NOW_MS)).toEqual(BOOTSTRAP_ALL_OFF);
  });

  it('master-off lists every flag on every page: platform features disabled, foreign ones platform_unsupported, top-level flags false', () => {
    const boot = bootstrapOf(presetConfig('master-off'), FAKE_PAGES, chatter, NOW_MS);
    expect(Object.values(boot.flags).every((on) => !on)).toBe(true);
    // A switch the platform does not have reads `platform_unsupported` there, before the master switch (R20 HF-2).
    for (const page of boot.pages) {
      expect(page.features).toEqual(
        Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, { available: false, reason: hubFeatureNeedsOn(flag, page.platform) === undefined ? 'platform_unsupported' : 'disabled' }])),
      );
    }
    expect(boot.pages.filter((page) => page.platform === 'onlyfans')).toHaveLength(2);
    expect(CLIENT_FEATURE_FLAG_NAMES.filter((flag) => HUB_FEATURE_REQUIREMENTS[flag].onlyfans === undefined)).toEqual(['drafts', 'voice', 'notesFill', 'notes', 'vault', 'registration']);
  });

  it('the bootstrap route serves the preset for the caller, through the contract schema', async () => {
    const hub = createFakeHub({ preset: 'all-off' });
    const token = hub.issueToken({ client: null });
    const response = await hubCall(hub.fetch, hub.origin, 'clientBootstrap', null, { token });
    const body = (await response.json()) as unknown;
    expect(BootstrapSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({ ...BOOTSTRAP_ALL_OFF, identity: { ...BOOTSTRAP_ALL_OFF.identity, tokenClient: null } });
  });
});

describe('fake hub config: evaluateClientFeature order', () => {
  const pilot = presetConfig('pilot-on');

  it('platform first: a feature the page’s platform does not have is platform_unsupported even with the master off; one it has is `disabled` (R20 HF-2)', () => {
    expect(featureVerdict({ ...pilot, master: false }, fansly, 'navigation')).toEqual({ available: false, reason: 'platform_unsupported' });
    expect(featureVerdict({ ...pilot, master: false }, fansly, 'spenders')).toEqual({ available: false, reason: 'disabled' });
    expect(featureVerdict({ ...pilot, master: false }, one, 'drafts')).toEqual({ available: false, reason: 'platform_unsupported' });
  });

  it('then the master switch and the flag — before the binding is even looked at', () => {
    const unbound = { ...one, platformAccountId: null };
    const noBindings = { ...pilot, bindingsByHost: {} };
    expect(featureVerdict({ ...noBindings, master: false }, unbound, 'spenders')).toEqual({ available: false, reason: 'disabled' });
    expect(featureVerdict(noBindings, unbound, 'previewSend')).toEqual({ available: false, reason: 'flag_off' });
  });

  it('then the binding: a page the extension cannot bind a host account to — no platform account id and no owner binding — is binding_missing', () => {
    const unbound = { ...one, platformAccountId: null };
    expect(featureVerdict({ ...pilot, bindingsByHost: {} }, unbound, 'spenders')).toEqual({ available: false, reason: 'binding_missing' });
    // The owner's explicit host binding is a way to bind it too.
    expect(featureVerdict(pilot, unbound, 'spenders')).toEqual({ available: true });
    // A binding beats a missing capability in the order: no binding is said first.
    expect(featureVerdict({ ...pilot, bindingsByHost: {}, capabilities: [] }, unbound, 'stats')).toEqual({ available: false, reason: 'binding_missing' });
  });

  it('then the capabilities the flag needs', () => {
    expect(featureVerdict({ ...pilot, master: false }, one, 'spenders')).toEqual({ available: false, reason: 'disabled' });
    expect(featureVerdict(pilot, one, 'previewSend')).toEqual({ available: false, reason: 'flag_off' });
    expect(featureVerdict({ ...pilot, capabilities: [] }, one, 'stats')).toEqual({ available: false, reason: 'hub_not_ready' });
    // A client-only switch needs no capability.
    expect(featureVerdict({ ...pilot, capabilities: [] }, one, 'insertion')).toEqual({ available: true });
    expect(featureVerdict(pilot, one, 'stats')).toEqual({ available: true });
  });

  it('a page’s own flag wins over `*`; an unknown future flag is served as given', () => {
    const config = patchConfig(pilot, { flags: { stats: true, futureFlag: true }, pageFlags: { [one.pageLabel]: { stats: false } } });
    expect(flagOn(config, one, 'stats')).toBe(false);
    expect(flagOn(config, vip, 'stats')).toBe(true);
    const boot = bootstrapOf(config, FAKE_PAGES, chatter, NOW_MS);
    expect(boot.flags['futureFlag']).toBe(true);
    expect(boot.pages[0]?.features['stats']).toEqual({ available: false, reason: 'flag_off' });
    expect(boot.pages[0]?.features['futureFlag']).toEqual({ available: true });
  });

  it('bindingsByHost keeps only pages the caller is granted', () => {
    const config = patchConfig(pilot, { bindingsByHost: { 'onlymonster:1001': one.pageId, 'onlymonster:9999': 999 } });
    expect(bootstrapOf(config, FAKE_PAGES, chatter, NOW_MS).bindingsByHost).toEqual({ 'onlymonster:1001': one.pageId });
  });
});

describe('fake hub config: owner changes and configRevision', () => {
  it('owner changes bump the revision, the fake hub’s own knobs do not', () => {
    const base = presetConfig('pilot-on');
    expect(patchConfig(base, { flags: { stats: false } }).configRevision).toBe(base.configRevision + 1);
    expect(patchConfig(base, { limits: { claimLeaseSec: 60 } })).toMatchObject({ configRevision: base.configRevision + 1, limits: { claimLeaseSec: 60, claimRenewSec: 40 } });
    expect(patchConfig(base, { capabilities: ['context-v1'] }).capabilities).toEqual(['context-v1']);
    expect(patchConfig(base, { minVersion: '9.0.0', master: false })).toMatchObject({ minVersion: '9.0.0', master: false, configRevision: base.configRevision + 1 });
    for (const knob of [{ narrowTokens: false }, { quotaRequestsToday: 0 }, { generationVisibleAfterMs: 5 }, { spendersTotal: 3 }, { aiChunkDelayMs: 7 }] as const) {
      const next = patchConfig(base, knob);
      expect(next.configRevision, JSON.stringify(knob)).toBe(base.configRevision);
      expect(next).toMatchObject(knob);
    }
  });

  it('the control API applies presets and patches and answers the new revision', () => {
    const hub = createFakeHub();
    expect(hub.control({ op: 'config', patch: { flags: { previewSend: true } } })).toEqual({ ok: true, configRevision: WORLD.configRevision + 1 });
    expect(hub.config().flags['previewSend']).toBe(true);
    expect(hub.control({ op: 'preset', name: 'pilot-pages' })).toEqual({ ok: true, configRevision: WORLD.configRevision + 2 });
    expect(hub.config()).toEqual({ ...presetConfig('pilot-pages'), configRevision: WORLD.configRevision + 2 });
    hub.control({ op: 'reset' });
    hub.control({ op: 'config', patch: { flags: { previewSend: true } } });
    // A preset is an owner change too: the revision only grows, even when the preset's own is lower.
    expect(hub.control({ op: 'preset', name: 'all-off' })).toEqual({ ok: true, configRevision: WORLD.configRevision + 2 });
    expect(hub.config()).toEqual({ ...presetConfig('all-off'), configRevision: WORLD.configRevision + 2 });
    expect(hub.control({ op: 'preset', name: 'pilot-on' })).toEqual({ ok: true, configRevision: WORLD.configRevision + 3 });
    expect(hub.config()).toEqual({ ...presetConfig('pilot-on'), configRevision: WORLD.configRevision + 3 });
    expect(hub.control({ op: 'reset' })).toEqual({ ok: true });
    expect(hub.config().configRevision).toBe(WORLD.configRevision);
  });
});
