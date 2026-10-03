// The receipt profile (architecture.md §6.2 «Исключение — X8»): which modules
// the page already loaded, read from the DOM and the resource timing, and
// whether an approved profile names exactly them.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RECEIPT_MODULE_ROLES } from './host-contract';
import { loadedScriptUrls, matchReceiptProfile, receiptModules } from './receipt-profile';

const ORIGIN = 'https://chat.example.test';
const asset = (name: string): string => `${ORIGIN}/assets/${name}.js`;
/** A build like 0.172.0: one module per role, two named `composables`. */
const BUILD = ['index-AAAAAAAA', 'notificationEntry-BBBBBBBB', 'composables-CCCCCCCC', 'composables-DDDD_DD-', 'messages-EEEEEEEE', 'accounts-FFFFFFFF', 'inbox-GGGGGGGG', 'runtime-dom.esm-bundler-HHHHHHHH'];
const MODULES = { notificationEntry: 'BBBBBBBB', composables: 'CCCCCCCC+DDDD_DD-', messages: 'EEEEEEEE', accounts: 'FFFFFFFF', inbox: 'GGGGGGGG' };
const profile = (over: Record<string, unknown> = {}) => ({ id: 'chatspace-test', adapterVersion: '0.2.0', modules: MODULES, ...over });

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
    const timing = vi.fn(() => [{ name: asset('messages-EEEEEEEE') }, { name: `${ORIGIN}/api/v0/accounts` }]);
    const urls = loadedScriptUrls({ document: page, performance: { getEntriesByType: timing } } as unknown as Window);
    expect(urls).toEqual([asset('index-AAAAAAAA'), asset('composables-CCCCCCCC'), asset('messages-EEEEEEEE'), `${ORIGIN}/api/v0/accounts`]);
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
    expect(receiptModules([...BUILD.map(asset).reverse(), asset('messages-EEEEEEEE'), `${asset('inbox-GGGGGGGG')}?v=1`], ORIGIN)).toEqual(MODULES);
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
    expect(matchReceiptProfile(loaded, [profile()], '0.2.0')).toBe('chatspace-test');
    expect(matchReceiptProfile(loaded, [profile({ id: 'older', modules: { ...MODULES, messages: 'ZZZZZZZZ' } }), profile()], '0.2.0')).toBe('chatspace-test');
    expect(matchReceiptProfile(loaded, [], '0.2.0')).toBeNull();
  });

  it('another adapter version, a changed module, a missing role, a second version of a module, an unknown role: no match', () => {
    expect(matchReceiptProfile(loaded, [profile()], '0.3.0')).toBeNull();
    expect(matchReceiptProfile(loaded, [profile({ modules: { ...MODULES, notificationEntry: 'XXXXXXXX' } })], '0.2.0')).toBeNull();
    // One familiar module is not enough: the profile must name the whole set…
    const { inbox: _inbox, ...partial } = MODULES;
    expect(matchReceiptProfile(loaded, [profile({ modules: partial })], '0.2.0')).toBeNull();
    // …and the page must have loaded all of it (the chat's modules load with the first chat).
    expect(matchReceiptProfile(receiptModules(BUILD.filter((name) => !name.startsWith('messages')).map(asset), ORIGIN), [profile()], '0.2.0')).toBeNull();
    // A module of a role loaded in two versions (a deploy under an open page) is no approved set.
    expect(matchReceiptProfile(receiptModules([...BUILD, 'messages-NEWNEW00'].map(asset), ORIGIN), [profile()], '0.2.0')).toBeNull();
    // The profile is data about our own roles only: nothing remote can widen what is compared.
    expect(matchReceiptProfile(loaded, [profile({ modules: { ...MODULES, index: 'AAAAAAAA' } })], '0.2.0')).toBeNull();
  });
});
