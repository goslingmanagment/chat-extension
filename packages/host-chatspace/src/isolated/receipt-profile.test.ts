// The receipt profile (architecture.md §6.2 «Исключение — X8»): which modules
// the page already loaded, read from the DOM and the resource timing, and
// whether an approved profile names exactly them.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReceiptProfileSchema, type ReceiptProfile } from '@cg/contracts/hub';

import { ADAPTER_VERSION, RECEIPT_MODULE_ROLES } from './host-contract';
import { loadedScriptUrls, matchReceiptProfile, receiptModules } from './receipt-profile';

const ORIGIN = 'https://chat.example.test';
const asset = (name: string): string => `${ORIGIN}/assets/${name}.js`;
/**
 * A build laid out like 0.195.0: two modules named `composables`, two named `onlyfans` (the small one the page loads
 * at once, listed first here, and the one that comes with the main layout).
 */
const BUILD = ['index-AAAAAAAA', 'notificationEntry-BBBBBBBB', 'composables-CCCCCCCC', 'composables-DDDD_DD-', 'onlyfans-EEEEEEEE', 'onlyfans-E2E2E2E2', 'accounts-FFFFFFFF', 'inbox-GGGGGGGG', 'runtime-dom.esm-bundler-HHHHHHHH'];
const MODULES = { notificationEntry: 'BBBBBBBB', composables: 'CCCCCCCC+DDDD_DD-', onlyfans: 'E2E2E2E2+EEEEEEEE', accounts: 'FFFFFFFF', inbox: 'GGGGGGGG' };
const profile = (over: Record<string, unknown> = {}) => ({ id: 'chatspace-test', adapterVersion: ADAPTER_VERSION, modules: MODULES, ...over });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('[X8-06] fingerprints of the loaded send-path modules', () => {
  it('reads what the document already loaded — scripts, modulepreload links, resource timing — and requests nothing', () => {
    // Plain objects in place of elements: a test environment would start loading real ones.
    const selectors: string[] = [];
    const page = {
      querySelectorAll: (selector: string) => {
        selectors.push(selector);
        return [{ src: asset('index-AAAAAAAA') }, { href: asset('composables-CCCCCCCC') }, { src: '' }];
      },
    };
    const fetched = vi.spyOn(globalThis, "fetch");
    const timing = vi.fn(() => [{ name: asset('onlyfans-EEEEEEEE') }, { name: `${ORIGIN}/api/v0/accounts` }]);
    const urls = loadedScriptUrls({ document: page, performance: { getEntriesByType: timing } } as unknown as Window);
    expect(urls).toEqual([asset('index-AAAAAAAA'), asset('composables-CCCCCCCC'), asset('onlyfans-EEEEEEEE'), `${ORIGIN}/api/v0/accounts`]);
    // Scripts and module preloads only: a stylesheet link is not a module.
    expect(selectors).toEqual(['script[src], link[rel="modulepreload"][href]']);
    expect(timing).toHaveBeenCalledWith('resource');
    expect(fetched).not.toHaveBeenCalled();
    // A page that cannot be read gives what it could: a missing role then matches no profile.
    expect(loadedScriptUrls({ document: page, performance: {} } as unknown as Window)).toEqual([asset('index-AAAAAAAA'), asset('composables-CCCCCCCC')]);
  });

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
    expect(matchReceiptProfile(loaded, [profile()], ADAPTER_VERSION)).toBe('chatspace-test');
    expect(matchReceiptProfile(loaded, [profile({ id: 'older', modules: { ...MODULES, onlyfans: 'ZZZZZZZZ' } }), profile()], ADAPTER_VERSION)).toBe('chatspace-test');
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
/** 0.172.0 the same way: its composer, translator and echo handler were a `messages` module; `onlyfans` was one small module. */
const PAGE_0172 = ['index-DEVowLko', 'composables-BUNn3xEu', 'accounts-BWN_jVY3', 'inbox-SRJHz93Z', 'onlyfans-CaxZc4_R', 'composables-BSl13FHf', 'MainLayout-DBvnSRX2', 'messages-DlBZ5e81', 'notificationEntry-DgqI6Vgc', 'ChatView-DOQWEL72'];
/** The value the reviewer proposed for the hub's `limits.previewSendReceiptProfiles`, exactly, with this adapter's version. */
const HUB_VALUE_0195 =
  '[{"id":"chatspace-0.195.0","adapterVersion":"0.3.0","modules":{"notificationEntry":"BaWeHDsj","composables":"C25sVtl7+DKWzNPeA","onlyfans":"DqEV2pNo+SstGvKHV","accounts":"CN9N-pj3","inbox":"DUukOf_u"}}]';
/** The 0.172.0 profile of adapter 0.2.0 (what `host-contract-check` printed for that copy). */
const PROFILE_0172 = { id: 'chatspace-0.172.0', adapterVersion: '0.2.0', modules: { notificationEntry: 'DgqI6Vgc', composables: 'BSl13FHf+BUNn3xEu', messages: 'DlBZ5e81', accounts: 'BWN_jVY3', inbox: 'SRJHz93Z' } };
/** The value as the bootstrap's own schema reads it. */
const reviewed = (): ReceiptProfile[] => (JSON.parse(HUB_VALUE_0195) as unknown[]).map((item) => ReceiptProfileSchema.parse(item));

describe('[X8-06] ChatSpace 0.195.0: the `messages` module is gone, the send path is in `onlyfans` (adapter 0.3.0)', () => {
  it('the role list names `onlyfans`, not `messages`, and the adapter version moved on with it', () => {
    expect([...RECEIPT_MODULE_ROLES].sort()).toEqual(['accounts', 'composables', 'inbox', 'notificationEntry', 'onlyfans']);
    expect(ADAPTER_VERSION).toBe('0.3.0');
  });

  it('0.195.0’s two `onlyfans` modules — one loaded with the page, one with the main layout — are one fingerprint, sorted', () => {
    expect(receiptModules(PAGE_0195.map(asset), ORIGIN)).toEqual({ notificationEntry: 'BaWeHDsj', composables: 'C25sVtl7+DKWzNPeA', onlyfans: 'DqEV2pNo+SstGvKHV', accounts: 'CN9N-pj3', inbox: 'DUukOf_u' });
    // The order the page loaded them in does not matter.
    expect(receiptModules([...PAGE_0195].reverse().map(asset), ORIGIN)).toEqual(receiptModules(PAGE_0195.map(asset), ORIGIN));
  });

  it('the reviewer’s hub value matches a 0.195.0 page under this adapter — never before the main layout loaded, never under 0.2.0', () => {
    const profiles = reviewed();
    expect(profiles.map((item) => item.adapterVersion)).toEqual([ADAPTER_VERSION]);
    expect(matchReceiptProfile(receiptModules(PAGE_0195.map(asset), ORIGIN), profiles, ADAPTER_VERSION)).toBe('chatspace-0.195.0');
    // Only the modules of the page's first load: the composer's `onlyfans` and the queue are not there yet.
    expect(matchReceiptProfile(receiptModules(PAGE_0195_EARLY.map(asset), ORIGIN), profiles, ADAPTER_VERSION)).toBeNull();
    expect(matchReceiptProfile(receiptModules(PAGE_0195.map(asset), ORIGIN), profiles, '0.2.0')).toBeNull();
  });

  it('a 0.172.0 page matches no profile of this adapter: its old profile, relabelled or not, and 0.195.0’s value give none — X8 stays off (CG-SEND-RECEIPT)', () => {
    const page = receiptModules(PAGE_0172.map(asset), ORIGIN);
    // `messages` is not read any more; 0.172.0's small `onlyfans` module is.
    expect(page).toEqual({ notificationEntry: 'DgqI6Vgc', composables: 'BSl13FHf+BUNn3xEu', onlyfans: 'CaxZc4_R', accounts: 'BWN_jVY3', inbox: 'SRJHz93Z' });
    expect(matchReceiptProfile(page, [PROFILE_0172], ADAPTER_VERSION)).toBeNull();
    expect(matchReceiptProfile(page, [{ ...PROFILE_0172, adapterVersion: ADAPTER_VERSION }], ADAPTER_VERSION)).toBeNull();
    expect(matchReceiptProfile(page, reviewed(), ADAPTER_VERSION)).toBeNull();
    // A page with a `messages` module and no `onlyfans` one has no fingerprint for the role at all.
    const withoutOnlyfans = receiptModules(PAGE_0172.filter((name) => !name.startsWith('onlyfans-')).map(asset), ORIGIN);
    expect(Object.keys(withoutOnlyfans).sort()).toEqual(['accounts', 'composables', 'inbox', 'notificationEntry']);
    expect(matchReceiptProfile(withoutOnlyfans, [{ ...PROFILE_0172, adapterVersion: ADAPTER_VERSION }, ...reviewed()], ADAPTER_VERSION)).toBeNull();
  });
});
