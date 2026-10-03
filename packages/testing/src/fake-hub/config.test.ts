// The owner's hub configuration as the fake hub models it: the presets give
// exactly the scenarios' bootstrap answers, features are judged in the hub's
// order (platform → binding → master → flag → capability), and only owner
// changes bump configRevision (= custody flagRevision).

import { BootstrapSchema, CLIENT_FEATURE_FLAG_NAMES } from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import { BOOTSTRAP_ALL_OFF, BOOTSTRAP_PILOT_ON, NOW_MS, WORLD } from '../scenarios/hub';
import { FAKE_PAGES, bootstrapOf, featureVerdict, flagOn, patchConfig, presetConfig, type FakePage } from './config';
import { createFakeHub } from './hub';
import { hubCall } from './kit';

const chatter = { userId: WORLD.user.userId, username: WORLD.user.username, role: 'chatter', tokenClient: 'chat-extension' } as const;
const one = FAKE_PAGES[0] as FakePage;
const fansly = FAKE_PAGES[2] as FakePage;

describe('fake hub config: presets', () => {
  it('pilot-on is the scenarios’ BOOTSTRAP_PILOT_ON exactly', () => {
    expect(bootstrapOf(presetConfig('pilot-on'), FAKE_PAGES, chatter, NOW_MS)).toEqual(BOOTSTRAP_PILOT_ON);
  });

  it('all-off is the scenarios’ BOOTSTRAP_ALL_OFF exactly', () => {
    expect(bootstrapOf(presetConfig('all-off'), FAKE_PAGES, chatter, NOW_MS)).toEqual(BOOTSTRAP_ALL_OFF);
  });

  it('master-off keeps the pilot flags but serves every feature as disabled and every flag false', () => {
    const boot = bootstrapOf(presetConfig('master-off'), FAKE_PAGES, chatter, NOW_MS);
    expect(Object.values(boot.flags).every((on) => !on)).toBe(true);
    expect(boot.pages.filter((page) => page.platform === 'onlyfans').flatMap((page) => Object.values(page.features))).toEqual(
      Array.from({ length: CLIENT_FEATURE_FLAG_NAMES.length * 2 }, () => ({ available: false, reason: 'disabled' })),
    );
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

  it('platform first: a Fansly page is platform_unsupported even with the master off', () => {
    expect(featureVerdict({ ...pilot, master: false }, fansly, 'spenders')).toEqual({ available: false, reason: 'platform_unsupported' });
  });

  it('then the binding: a page without platformAccountId is binding_missing', () => {
    expect(featureVerdict(pilot, { ...one, platformAccountId: null }, 'spenders')).toEqual({ available: false, reason: 'binding_missing' });
  });

  it('then the master switch, the flag, and the capabilities the flag needs', () => {
    expect(featureVerdict({ ...pilot, master: false }, one, 'spenders')).toEqual({ available: false, reason: 'disabled' });
    expect(featureVerdict(pilot, one, 'previewSend')).toEqual({ available: false, reason: 'flag_off' });
    expect(featureVerdict({ ...pilot, capabilities: [] }, one, 'stats')).toEqual({ available: false, reason: 'hub_not_ready' });
    // A client-only switch needs no capability.
    expect(featureVerdict({ ...pilot, capabilities: [] }, one, 'insertion')).toEqual({ available: true });
    expect(featureVerdict(pilot, one, 'stats')).toEqual({ available: true });
  });

  it('a page’s own flag wins over `*`; an unknown future flag is served as given', () => {
    const config = patchConfig(pilot, { flags: { stats: true, futureFlag: true }, pageFlags: { [one.pageLabel]: { stats: false } } });
    expect(flagOn(config, one.pageLabel, 'stats')).toBe(false);
    expect(flagOn(config, WORLD.pages.vip.pageLabel, 'stats')).toBe(true);
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
    expect(hub.control({ op: 'preset', name: 'all-off' })).toEqual({ ok: true, configRevision: 0 });
    expect(hub.control({ op: 'reset' })).toEqual({ ok: true });
    expect(hub.config().configRevision).toBe(WORLD.configRevision);
  });
});
