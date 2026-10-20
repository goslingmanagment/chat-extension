// The receipt profile (architecture.md §6.2 «Исключение — X8»): which modules
// the page already loaded, read from the DOM and the resource timing, and
// whether an approved profile names exactly them.

import { describe, expect, it } from 'vitest';

import { ReceiptProfileSchema, type ReceiptProfile } from '@cg/contracts/hub';

import { ADAPTER_VERSION, RECEIPT_MODULE_ROLES } from './host-contract';
import { matchReceiptProfile, receiptModules } from './receipt-profile';

const ORIGIN = 'https://chat.example.test';
const asset = (name: string): string => `${ORIGIN}/assets/${name}.js`;
/**
 * A build laid out like 0.195.0: two modules named `composables`, two named `onlyfans` (the small one the page loads
 * at once, listed first here, and the one that comes with the main layout).
 */
const BUILD = ['index-AAAAAAAA', 'notificationEntry-BBBBBBBB', 'composables-CCCCCCCC', 'composables-DDDD_DD-', 'onlyfans-EEEEEEEE', 'onlyfans-E2E2E2E2', 'accounts-FFFFFFFF', 'inbox-GGGGGGGG', 'runtime-dom.esm-bundler-HHHHHHHH'];
const MODULES = { notificationEntry: 'BBBBBBBB', composables: 'CCCCCCCC+DDDD_DD-', onlyfans: 'E2E2E2E2+EEEEEEEE', accounts: 'FFFFFFFF', inbox: 'GGGGGGGG' };
const profile = (over: Record<string, unknown> = {}) => ({ id: 'chatspace-test', adapterVersion: ADAPTER_VERSION, modules: MODULES, ...over });

describe('[X8-06] fingerprints of the loaded send-path modules', () => {
  it('one fingerprint per essential role: the hashes of its modules, sorted; the entry module and other chunks are not part of it', () => {
    expect(receiptModules(BUILD.map(asset), ORIGIN)).toEqual(MODULES);
    // The order of loading and a module seen twice (DOM and resource timing) change nothing; a query string does not hide it.
    expect(receiptModules([...BUILD.map(asset).reverse(), asset('onlyfans-EEEEEEEE'), `${asset('inbox-GGGGGGGG')}?v=1`], ORIGIN)).toEqual(MODULES);
    // A relative address is this page's.
    expect(receiptModules(['/assets/inbox-GGGGGGGG.js'], ORIGIN)).toEqual({ inbox: 'GGGGGGGG' });
    // Another origin's file with the same name is not ChatSpace's module; neither is a path that only looks like one.
    expect(receiptModules(['https://cdn.example.test/assets/inbox-GGGGGGGG.js', `${ORIGIN}/assets/inbox-GGGGGGGG.css`, `${ORIGIN}/other/inbox-GGGGGGGG.js`, `${ORIGIN}/assets/inbox.js`, 'not a url at all ::'], ORIGIN)).toEqual({});
    expect(Object.keys(MODULES).sort()).toEqual([...RECEIPT_MODULE_ROLES].sort());
  });
});

describe('[X8-06] a profile matches only the whole current set (§6.2)', () => {
  const loaded = receiptModules(BUILD.map(asset), ORIGIN);

  it('every essential role with exactly the loaded fingerprint, for this adapter version', () => {
    expect(matchReceiptProfile(loaded, [profile()], ADAPTER_VERSION)).toEqual({ profile: 'chatspace-test', kind: 'exact' });
    expect(matchReceiptProfile(loaded, [profile({ id: 'older', modules: { ...MODULES, onlyfans: 'ZZZZZZZZ' } }), profile()], ADAPTER_VERSION)).toEqual({ profile: 'chatspace-test', kind: 'exact' });
    expect(matchReceiptProfile(loaded, [], ADAPTER_VERSION)).toBeNull();
  });

  it('another adapter version, a changed module, a missing role, a second version of a module, an unknown role: no match', () => {
    expect(matchReceiptProfile(loaded, [profile()], '0.2.0')).toBeNull();
    expect(matchReceiptProfile(loaded, [profile({ modules: { ...MODULES, notificationEntry: 'XXXXXXXX' } })], ADAPTER_VERSION)).toBeNull();
    // One familiar module is not enough: the profile must name the whole set…
    const { inbox: _inbox, ...partial } = MODULES;
    expect(matchReceiptProfile(loaded, [profile({ modules: partial })], ADAPTER_VERSION)).toBeNull();
    // …and the page must have loaded all of it: before the main layout loaded, only the small `onlyfans` module is there.
    expect(matchReceiptProfile(receiptModules(BUILD.filter((name) => name !== 'onlyfans-E2E2E2E2').map(asset), ORIGIN), [profile()], ADAPTER_VERSION)).toBeNull();
    // A module of a role loaded in two versions (a deploy under an open page) is no approved set.
    expect(matchReceiptProfile(receiptModules([...BUILD, 'onlyfans-NEWNEW00'].map(asset), ORIGIN), [profile()], ADAPTER_VERSION)).toBeNull();
    // The profile is data about our own roles only: nothing remote can widen what is compared.
    expect(matchReceiptProfile(loaded, [profile({ modules: { ...MODULES, index: 'AAAAAAAA' } })], ADAPTER_VERSION)).toBeNull();
  });
});

// The real file names of two ChatSpace builds as their pages load them (names only, no code: send-path review
// 0.172.0 → 0.195.0, 2026-10-09). 0.195.0's bundler regrouped the send path: it has no `messages` module, and that
// content now lives in a second `onlyfans` module (architecture.md §6.2).
/** 0.195.0: the entry, what `index.html` preloads, what comes with the main layout, and modules of no role. */
const PAGE_0195 = ['index-p8xPkCj8', 'composables-DKWzNPeA', 'accounts-CN9N-pj3', 'inbox-DUukOf_u', 'onlyfans-DqEV2pNo', 'composables-C25sVtl7', 'runtime-dom.esm-bundler-Ydpp0psT', 'MainLayout-Dyqw2t1H', 'onlyfans-SstGvKHV', 'notificationEntry-BaWeHDsj', 'ChatView-CnMzMAt4'];
/** 0.195.0 before the main layout loaded (a signed-out page never loads it). */
const PAGE_0195_EARLY = ['index-p8xPkCj8', 'composables-DKWzNPeA', 'accounts-CN9N-pj3', 'inbox-DUukOf_u', 'onlyfans-DqEV2pNo', 'composables-C25sVtl7'];

// Decision X25 (2026-10-09): the owner relaxed X21 — X8 runs on any ChatSpace build «until something breaks». The hub
// lists the sentinel instead of per-build profiles.
/** The hub value of the sentinel, exactly as it goes into `limits.previewSendReceiptProfiles`. */
const HUB_VALUE_ANY_BUILD = '[{"id":"any-build","adapterVersion":"0.3.0","modules":{"*":"*"}}]';
const anyBuild = (): ReceiptProfile[] => (JSON.parse(HUB_VALUE_ANY_BUILD) as unknown[]).map((item) => ReceiptProfileSchema.parse(item));

describe('[X8-06] the «any build» sentinel (decision X25)', () => {
  it('is plain data the bootstrap takes, and it matches any build — whatever its fingerprints', () => {
    const profiles = anyBuild();
    expect(profiles).toEqual([{ id: 'any-build', adapterVersion: ADAPTER_VERSION, modules: { '*': '*' } }]);
    const kind = { profile: 'any-build', kind: 'anyBuild' };
    expect(matchReceiptProfile(receiptModules(BUILD.map(asset), ORIGIN), profiles, ADAPTER_VERSION)).toEqual(kind);
    expect(matchReceiptProfile(receiptModules(PAGE_0195.map(asset), ORIGIN), profiles, ADAPTER_VERSION)).toEqual(kind);
    // Another build: every hash changed (0.200–0.202 did that to all five roles, the send path unchanged).
    const next = BUILD.map((name) => name.replace(/-[\w-]{8}$/, '-ZZZZZZZZ')).map(asset);
    expect(receiptModules(next, ORIGIN)).not.toEqual(MODULES);
    expect(matchReceiptProfile(receiptModules(next, ORIGIN), profiles, ADAPTER_VERSION)).toEqual(kind);
    // Even a role loaded in two versions passes: the sentinel does not compare fingerprints at all.
    expect(matchReceiptProfile(receiptModules([...BUILD, 'onlyfans-NEWNEW00'].map(asset), ORIGIN), profiles, ADAPTER_VERSION)).toEqual(kind);
    // Its id is free text: the hub's own word for it.
    expect(matchReceiptProfile(receiptModules(BUILD.map(asset), ORIGIN), [{ id: 'всё что угодно', adapterVersion: ADAPTER_VERSION, modules: { '*': '*' } }], ADAPTER_VERSION)).toEqual({ profile: 'всё что угодно', kind: 'anyBuild' });
  });

  it('matches whatever the page loaded and whatever adapter version it names (2026-10-20 restrictions, item 5)', () => {
    const kind = { profile: 'any-build', kind: 'anyBuild' };
    expect(matchReceiptProfile(receiptModules(PAGE_0195_EARLY.map(asset), ORIGIN), anyBuild(), ADAPTER_VERSION)).toEqual(kind);
    expect(matchReceiptProfile(receiptModules(BUILD.filter((name) => !name.startsWith('notificationEntry-')).map(asset), ORIGIN), anyBuild(), ADAPTER_VERSION)).toEqual(kind);
    expect(matchReceiptProfile({}, anyBuild(), ADAPTER_VERSION)).toEqual(kind);
    expect(matchReceiptProfile({ ...MODULES, inbox: '' }, anyBuild(), ADAPTER_VERSION)).toEqual(kind);
    // A release of ours with another adapter version is not switched off by the hub's older sentinel.
    expect(matchReceiptProfile(receiptModules(BUILD.map(asset), ORIGIN), anyBuild(), '9.9.9')).toEqual(kind);
  });

  it('only `{"*":"*"}` is the sentinel: a star beside a real role, a star with a fingerprint, a star role elsewhere — none of them', () => {
    const loaded = receiptModules(BUILD.map(asset), ORIGIN);
    for (const modules of [{ '*': '*', inbox: 'GGGGGGGG' }, { '*': 'GGGGGGGG' }, { inbox: '*' }, { ...MODULES, '*': '*' }, {}]) {
      expect([modules, matchReceiptProfile(loaded, [{ id: 'not-it', adapterVersion: ADAPTER_VERSION, modules }], ADAPTER_VERSION)]).toEqual([modules, null]);
    }
  });
});
