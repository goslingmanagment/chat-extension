import { describe, expect, it } from 'vitest';

import { releaseTarget } from './config.ts';
import { feedEntryFor, renderFeed } from './feed.ts';
import {
  evaluateBranch,
  evaluateCleanTree,
  evaluateCommand,
  evaluateFeedAhead,
  evaluateHead,
  evaluateHubAncestry,
  evaluateHubCompatibility,
  evaluateTagFree,
  evaluateVendor,
  evaluateVersions,
  type VendorObservation,
} from './gate.ts';

const target = releaseTarget();
const HASH = 'c'.repeat(64);
const COMMIT = 'd'.repeat(40);
const feed = (version: string): { status: number; body: string } => ({ status: 200, body: renderFeed(target.geckoId, feedEntryFor(target, version, 'a'.repeat(64))) });
const health = (body: Record<string, unknown>, status = 200): { status: number; body: string } => ({ status, body: JSON.stringify({ status: 'ok', contractHash: HASH, ...body }) });

describe('the pre-release gate: what each check concludes', () => {
  it('[UP-003] a release is cut from main, from a clean tree, from the commit that is origin/main, under a tag nobody used', () => {
    expect(evaluateBranch('main').ok).toBe(true);
    expect(evaluateBranch('r19-release')).toMatchObject({ ok: false, detail: expect.stringContaining('«r19-release»') as string });
    expect(evaluateBranch('HEAD').ok).toBe(false);

    expect(evaluateCleanTree('').ok).toBe(true);
    expect(evaluateCleanTree('\n').ok).toBe(true);
    expect(evaluateCleanTree(' M site/index.html\n?? notes.txt\n')).toMatchObject({ ok: false, detail: expect.stringContaining('2 path(s), first: M site/index.html') as string });

    expect(evaluateHead(COMMIT, COMMIT).ok).toBe(true);
    expect(evaluateHead(COMMIT, 'e'.repeat(40))).toMatchObject({ ok: false, detail: expect.stringContaining('push the release commit') as string });

    expect(evaluateTagFree('0.1.0', false, false).ok).toBe(true);
    expect(evaluateTagFree('0.1.0', false, null)).toMatchObject({ ok: true, detail: 'v0.1.0 is free locally' });
    expect(evaluateTagFree('0.1.0', true, false).ok).toBe(false);
    expect(evaluateTagFree('0.1.0', false, true)).toMatchObject({ ok: false, detail: expect.stringContaining('on origin') as string });
  });

  it('[UP-003] the version must be higher than the one the feed serves; no feed yet is the first release; an unreadable feed is not a pass', () => {
    expect(evaluateFeedAhead('0.1.0', { status: 404, body: '' }, target.geckoId)).toMatchObject({ ok: true, detail: expect.stringContaining('first release') as string });
    expect(evaluateFeedAhead('0.1.1', feed('0.1.0'), target.geckoId).ok).toBe(true);
    expect(evaluateFeedAhead('0.1.0', feed('0.1.0'), target.geckoId)).toMatchObject({ ok: false, detail: expect.stringContaining('not higher') as string });
    expect(evaluateFeedAhead('0.1.0', feed('0.2.0'), target.geckoId).ok).toBe(false);
    expect(evaluateFeedAhead('0.1.0', { status: 0, body: '' }, target.geckoId)).toMatchObject({ ok: false, detail: expect.stringContaining('answered nothing') as string });
    expect(evaluateFeedAhead('0.1.0', { status: 502, body: '' }, target.geckoId).ok).toBe(false);
    expect(evaluateFeedAhead('0.1.0', { status: 200, body: '<html>' }, target.geckoId)).toMatchObject({ ok: false, detail: expect.stringContaining('cannot be read') as string });
    expect(evaluateFeedAhead('0.1.0', { status: 200, body: '{"addons":{}}' }, target.geckoId).ok).toBe(false);
  });

  it('[UP-004] the vendored SDK must be in the production hub’s compatibleClientSdks — and before the hub publishes the list there is no release', () => {
    expect(evaluateHubCompatibility(health({ compatibleClientSdks: [HASH, 'e'.repeat(64)] }), HASH)).toMatchObject({ ok: true, detail: expect.stringContaining('runs the same contract') as string });
    expect(evaluateHubCompatibility(health({ contractHash: 'e'.repeat(64), compatibleClientSdks: ['e'.repeat(64), HASH] }), HASH)).toMatchObject({ ok: true, detail: expect.stringContaining('newer contract') as string });
    expect(evaluateHubCompatibility(health({ compatibleClientSdks: ['e'.repeat(64)] }), HASH)).toMatchObject({ ok: false, detail: expect.stringContaining('is not in the hub') as string });
    expect(evaluateHubCompatibility(health({}), HASH)).toMatchObject({ ok: false, detail: expect.stringContaining('H-1') as string });
    // The hub's own hash equal to ours is not enough without the list: the rule is the list.
    expect(evaluateHubCompatibility(health({ contractHash: HASH }), HASH).ok).toBe(false);
    expect(evaluateHubCompatibility(health({ status: 'degraded', compatibleClientSdks: [HASH] }), HASH).ok).toBe(false);
    expect(evaluateHubCompatibility(health({ compatibleClientSdks: [HASH] }, 503), HASH).ok).toBe(false);
    expect(evaluateHubCompatibility(health({ compatibleClientSdks: 'all' }), HASH).ok).toBe(false);
    expect(evaluateHubCompatibility({ status: 200, body: 'oops' }, HASH).ok).toBe(false);
    expect(evaluateHubCompatibility({ status: 0, body: '' }, HASH)).toMatchObject({ ok: false, detail: expect.stringContaining('answered nothing') as string });
  });

  it('[UP-004] the SDK is vendored from a commit that is on the hub’s main — a branch head or a commit GitHub does not know stops the release', () => {
    expect(evaluateHubAncestry('ahead', COMMIT, 'org/hub').ok).toBe(true);
    expect(evaluateHubAncestry('identical', COMMIT, 'org/hub').ok).toBe(true);
    expect(evaluateHubAncestry('diverged', COMMIT, 'org/hub')).toMatchObject({ ok: false, detail: expect.stringContaining('re-vendor') as string });
    expect(evaluateHubAncestry('behind', COMMIT, 'org/hub').ok).toBe(false);
    expect(evaluateHubAncestry(null, COMMIT, 'org/hub', 'gh: Not Found (HTTP 404)')).toMatchObject({ ok: false, detail: expect.stringContaining('HTTP 404') as string });
  });

  it('[UP-004] the vendored packages are exact, clean and the pinned ones', () => {
    const observed: VendorObservation = {
      sdk: { contractHash: HASH, sourceCommit: COMMIT },
      hotkeys: { sha256: 'f'.repeat(64) },
      pins: { kernelSdk: { contractHash: HASH, sourceCommit: COMMIT }, chatgooseHotkeys: { sha256: 'f'.repeat(64) } },
    };
    expect(evaluateVendor(observed)).toMatchObject({ ok: true, vendor: { sdkContractHash: HASH, sdkSourceCommit: COMMIT, hotkeysSha256: 'f'.repeat(64) } });
    // An SDK generated from an uncommitted hub tree cannot be tied to a commit.
    expect(evaluateVendor({ ...observed, sdk: { contractHash: HASH, sourceCommit: `${COMMIT}-dirty` } })).toMatchObject({ ok: false, vendor: null, detail: expect.stringContaining('not an exact clean hub commit') as string });
    expect(evaluateVendor({ ...observed, pins: { ...observed.pins, kernelSdk: { contractHash: 'e'.repeat(64), sourceCommit: COMMIT } } })).toMatchObject({ ok: false, detail: 'the SDK differs from tests/vendor-pins.json' });
    expect(evaluateVendor({ ...observed, hotkeys: { sha256: 'e'.repeat(64) } })).toMatchObject({ ok: false, detail: 'the hotkeys differ from tests/vendor-pins.json' });
    expect(evaluateVendor({ sdk: {}, hotkeys: {}, pins: {} }).ok).toBe(false);
  });

  it('[UP-006] package.json and the built manifest say the same version', () => {
    expect(evaluateVersions('0.1.0', '0.1.0').ok).toBe(true);
    expect(evaluateVersions('0.1.1', '0.1.0')).toMatchObject({ ok: false, detail: expect.stringContaining('rebuild') as string });
    expect(evaluateVersions('0.1.0', null).ok).toBe(false);
    expect(evaluateVersions('0.1', '0.1').ok).toBe(false);
  });

  it('a command check is its exit code', () => {
    expect(evaluateCommand('pnpm check', 0)).toEqual({ ok: true, detail: 'pnpm check is green' });
    expect(evaluateCommand('pnpm check', 1, 'gates: 1 violation(s).')).toEqual({ ok: false, detail: 'pnpm check failed (exit 1): gates: 1 violation(s).' });
  });
});
