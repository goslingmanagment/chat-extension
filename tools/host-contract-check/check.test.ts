// The local host-contract check on a synthetic «bundle copy» (no ChatSpace
// code here: the real copy lives outside the repository and is read only by
// hand, `node tools/host-contract-check/index.ts`).

import { describe, expect, it } from 'vitest';

import * as contract from '../../packages/host-chatspace/src/isolated/host-contract.ts';
import { receiptModules } from '../../packages/host-chatspace/src/isolated/receipt-profile.ts';
import { QUEUE_SEND } from '../../packages/host-chatspace/src/main/send-port.ts';
import {
  BUYING_POWERS_PLATFORM,
  buildOf,
  checkAnchors,
  contractAnchors,
  diffCopies,
  importsOf,
  missingRoles,
  platformKeyAnchor,
  QUEUE_ACTION,
  receiptFingerprint,
  receiptProfile,
  sendPathOutsideRoles,
  shapeOf,
  type BundleFile,
} from './check.ts';

/** A copy that has every anchor: one line per string, written the way a minified build writes them. */
function fullCopy(): BundleFile[] {
  const members = Object.values(contract.HOST_MEMBERS).flat();
  const stores = [contract.STORE_CACHE, contract.STORE_CHATS, contract.STORE_QUEUE, contract.STORE_TRANSLATOR, contract.STORE_TABS, contract.STORE_ACCOUNTS];
  const keys = [contract.KEY_ACCOUNTS, contract.KEY_MESSAGES, contract.KEY_FANS, contract.KEY_CHAT_LIST, contract.KEY_MIMIC_SETTINGS, contract.KEY_MIMIC_CHATS, contract.KEY_PERMISSIONS, contract.KEY_BUYING_POWERS, contract.KEY_INSIGHTS];
  const app = [
    'import { a as b } from "./composables-CCCCCCCC.js";',
    'x.mount(`#app`);',
    'var routes = { OVERVIEW: `accounts-overview`, CHAT: `chat` }, paths = { CHAT: `/accounts/:accountId/chats/:chatId?` };',
    ...stores.map((id) => `var s = defineStore(\`${id}\`, () => {});`),
    ...keys.map((key) => `var k = [\`${key}\`];`),
    ...members.map((member) => `a.${member} = 1;`),
    `store.${QUEUE_ACTION}({});`,
    'var slot = { "data-id": `browser-composer-translator`, class: `composer-frame overflow-hidden`, "data-dismissible-open": `` };',
    'e.classList.add(`ProseMirror`);',
    'var draft = `chat-space:draft:`;',
    'var ws = `wss://host.example.test/api/chat-space/ws`, events = [`account_new_message`, `authenticated`];',
    'post(`api/v0/accounts/${e.accountId}/chats/${e.chatId}/messages`);',
    'has(`of_block_message_sending`); if (code === `MESSAGE_GUARD_VIOLATION`) {}',
    'root.classList.toggle(`dark`); root.style.setProperty(`--app-content-max-width`, w);',
  ];
  return [
    { name: 'index.html', text: '<script type="module" crossorigin src="/assets/index-AAAAAAAA.js"></script>' },
    { name: 'index-AAAAAAAA.js', text: app.join('\n') },
    { name: 'index-ZZZZZZZZ.css', text: ':root { --color-om-neutral-0: 255 255 255; }' },
    { name: 'notificationEntry-BBBBBBBB.js', text: 'import { a } from "./composables-CCCCCCCC.js";\nimport { b } from "./inbox-GGGGGGGG.js";' },
    { name: 'composables-CCCCCCCC.js', text: 'import { v } from "./vue.runtime.esm-bundler-HHHHHHHH.js";' },
    { name: 'composables-DDDDDDDD.js', text: '' },
    { name: 'onlyfans-EEEEEEEE.js', text: '' },
    { name: 'onlyfans-E2E2E2E2.js', text: '' },
    { name: 'accounts-FFFFFFFF.js', text: '' },
    { name: 'inbox-GGGGGGGG.js', text: '' },
  ];
}

/** How a send-path anchor is written in a minified build: names and strings only. */
const written = (anchor: contract.SendPathAnchor): string => (anchor.kind === 'member' ? `a.${anchor.value} = 1;` : anchor.kind === 'string' ? `k = \`${anchor.value}\`;` : `u = "${anchor.value}";`);
/** Where 0.195.0 keeps each part of the send path: the queue, the client and the socket, the composer's `onlyfans` module. */
const PLACES_0195: Readonly<Record<string, string>> = {
  'queue store': 'notificationEntry-BBBBBBBB.js',
  'HTTP client': 'composables-CCCCCCCC.js',
  'socket bus': 'composables-CCCCCCCC.js',
  'composer bridge': 'onlyfans-EEEEEEEE.js',
  'translator store': 'onlyfans-EEEEEEEE.js',
  'open-chat echo handler': 'onlyfans-EEEEEEEE.js',
};
/** A copy with the send path's anchors written into the files `places` names (by part); the queue's action beside the queue store unless moved. */
function sendPathCopy(places: Readonly<Record<string, string>> = PLACES_0195, options: { readonly skip?: string; readonly queueActionIn?: string } = {}): BundleFile[] {
  const texts = new Map<string, string[]>(
    ['index-AAAAAAAA.js', 'notificationEntry-BBBBBBBB.js', 'composables-CCCCCCCC.js', 'composables-DDDDDDDD.js', 'onlyfans-EEEEEEEE.js', 'onlyfans-E2E2E2E2.js', 'accounts-FFFFFFFF.js', 'inbox-GGGGGGGG.js', 'ChatView-ZZZZZZZZ.js'].map((name) => [name, ['var x = 1;']]),
  );
  const write = (name: string, line: string): void => {
    texts.set(name, [...(texts.get(name) ?? []), line]);
  };
  for (const anchor of contract.SEND_PATH_ANCHORS) if (anchor.value !== options.skip) write(places[anchor.part] ?? 'ChatView-ZZZZZZZZ.js', written(anchor));
  write(options.queueActionIn ?? places['queue store'] ?? '', `store.${QUEUE_ACTION}(e);`);
  return [...texts].map(([name, lines]) => ({ name, text: lines.join('\n') }));
}

describe('host-contract-check (§6.2 «Сверка с новой сборкой»)', () => {
  it('the queue action it looks for is the send port’s own name', () => {
    expect(QUEUE_ACTION).toBe(QUEUE_SEND);
  });

  it('finds every anchor of the host contract in a copy that has them, with file and line', () => {
    const results = checkAnchors(fullCopy());
    expect(results.filter((result) => !result.present).map((result) => result.id)).toEqual([]);
    expect(results.length).toBe(contractAnchors().length);
    expect(results.find((result) => result.id === 'store pendingMessages')?.at[0]).toMatch(/^index-AAAAAAAA\.js:\d+$/);
    // Theme tokens live in the stylesheet.
    expect(results.find((result) => result.id.startsWith('theme tokens'))?.at).toEqual(['index-ZZZZZZZZ.css:1']);
  });

  it('reports what a new build lost — a renamed store, a renamed member, another socket path — and nothing else', () => {
    const copy = fullCopy().map((file) =>
      file.name === 'index-AAAAAAAA.js'
        ? { ...file, text: file.text.replace('`pendingMessages`', '`pendingMessagesV2`').replace('a.subscribedAccountIds = 1;', 'a.subscribedAccounts = 1;').replace('/api/chat-space/ws', '/api/chat-space/socket') }
        : file,
    );
    expect(checkAnchors(copy).filter((result) => !result.present).map((result) => result.id)).toEqual(['store pendingMessages', 'socket path /api/chat-space/ws', 'member subscribedAccountIds']);
  });

  it('a member counts only as a whole name; a string only in quotes', () => {
    const anchors = contractAnchors().filter((anchor) => ['member isActive', 'store chats'].includes(anchor.id));
    expect(checkAnchors([{ name: 'a.js', text: 'x.isActiveNow = 1; y = "chats are fun"; z = chats;' }], anchors).map((result) => result.present)).toEqual([false, false]);
    expect(checkAnchors([{ name: 'a.js', text: 'x.isActive ? 1 : 2; defineStore(`chats`)' }], anchors).map((result) => result.present)).toEqual([true, true]);
  });

  describe('a key ChatSpace builds per platform (since 0.200.0: `${platform}BuyingPowers`)', () => {
    const ID = `cache key ${contract.KEY_BUYING_POWERS}`;
    /** The literal key gone from the copy: `body` is what the accounts module has instead. */
    const copyWith = (body: readonly string[]): BundleFile[] =>
      fullCopy().map((file) =>
        file.name === 'index-AAAAAAAA.js' ? { ...file, text: file.text.replace(`var k = [\`${contract.KEY_BUYING_POWERS}\`];`, 'var k = 0;') } : file.name === 'accounts-FFFFFFFF.js' ? { ...file, text: body.join('\n') } : file,
      );
    const result = (body: readonly string[]): { present: boolean; at: readonly string[] } => {
      const found = checkAnchors(copyWith(body)).find((item) => item.id === ID);
      return { present: found?.present ?? false, at: found?.at ?? [] };
    };
    /** Written the way the prettified 0.200.0 copy writes it: the factory, its key, its calls per platform. */
    const factory = (options: { readonly suffix?: string; readonly from?: string; readonly platforms?: readonly string[]; readonly between?: string } = {}): string[] => [
      'var x = 1,',
      '  Mf = (e) => {',
      ...(options.between === undefined ? [] : [options.between]),
      `    let t = [\`\${${options.from ?? 'e'}}${options.suffix ?? 'BuyingPowers'}\`];`,
      '    return use(() => ({ key: t }));',
      '  },',
      ...(options.platforms ?? ['fansly', 'onlyfans']).map((platform, index) => `  p${index} = Mf(\`${platform}\`),`),
      '  y = 2;',
    ];

    it('the platform is the start of the key the adapter reads', () => {
      expect(contract.KEY_BUYING_POWERS.startsWith(BUYING_POWERS_PLATFORM)).toBe(true);
      expect(() => platformKeyAnchor('fansMap', BUYING_POWERS_PLATFORM, 'cache')).toThrow();
    });

    it('the literal key (through 0.195.0) counts, as before', () => {
      expect(checkAnchors(fullCopy()).find((item) => item.id === ID)).toMatchObject({ present: true, at: [expect.stringMatching(/^index-AAAAAAAA\.js:\d+$/)] });
    });

    it('the templated key (0.200.0, 0.201.0) counts: the factory’s parameter and the suffix, the factory called with `onlyfans` in the same module', () => {
      expect(result(factory())).toEqual({ present: true, at: ['accounts-FFFFFFFF.js:3'] });
      // A minified copy on one line, `function` factories, a lone parameter without parentheses.
      expect(result([factory().join(' ')]).present).toBe(true);
      expect(result(['function Mf(e) { let t = [`${e}BuyingPowers`]; return t; } var p = Mf("onlyfans");']).present).toBe(true);
      expect(result(['var Mf = e => [`${e}BuyingPowers`], p = Mf(\'onlyfans\');']).present).toBe(true);
    });

    it('neither form — the key truly missing — fails, and the check says so', () => {
      expect(result(['var x = 1;']).present).toBe(false);
      expect(checkAnchors(copyWith(['var x = 1;'])).filter((item) => !item.present).map((item) => item.id)).toEqual([ID]);
      // A prefix or a suffix of the key alone is not the key.
      expect(result(['var k = [`BuyingPowers`], j = [`onlyfansBuyingPower`];']).present).toBe(false);
    });

    it('a template of another key, of another platform, or not built from the factory’s parameter does not count', () => {
      expect(result(factory({ suffix: 'BuyingPower' })).present).toBe(false);
      expect(result(factory({ suffix: 'BuyingPowersV2' })).present).toBe(false);
      expect(result(factory({ platforms: ['fansly'] })).present).toBe(false);
      expect(result(factory({ platforms: ['onlyfansV2'] })).present).toBe(false);
      expect(result(factory({ platforms: [] })).present).toBe(false);
      expect(result(factory({ from: 'n' })).present).toBe(false);
      // The template inside another function nested in the factory, or with no factory head near it.
      expect(result(factory({ between: '    let g = (n) => n,' })).present).toBe(false);
      expect(result(factory({ between: '    let g = () => [' })).present).toBe(false);
      expect(result(factory({ between: '    let g = function () { return [' })).present).toBe(false);
      expect(result(['  p = Mf(`onlyfans`),', '  q = 1,', '  r = 2,', '  s = 3,', '    let t = [`${e}BuyingPowers`];']).present).toBe(false);
      // The call with the platform in another module does not count: the factory's name is that module's own.
      const elsewhere = copyWith(factory({ platforms: ['fansly'] })).map((file) => (file.name === 'inbox-GGGGGGGG.js' ? { ...file, text: 'var p = Mf(`onlyfans`);' } : file));
      expect(checkAnchors(elsewhere).find((item) => item.id === ID)?.present).toBe(false);
    });

    it('the other cache keys stay literal-only: a template does not stand in for them', () => {
      const anchors = contractAnchors().filter((anchor) => anchor.id === `cache key ${contract.KEY_INSIGHTS}`);
      expect(checkAnchors([{ name: 'accounts-FFFFFFFF.js', text: 'var Mf = (e) => [`${e}Insights`], p = Mf(`fan`);' }], anchors)[0]?.present).toBe(false);
      expect(contractAnchors().filter((anchor) => anchor.confirm !== undefined).map((anchor) => anchor.id)).toEqual([ID]);
    });

    it('against 0.195.0, a copy with the templated key loses no anchor', () => {
      expect(diffCopies(fullCopy(), copyWith(factory())).anchors).toEqual([]);
      expect(diffCopies(fullCopy(), copyWith(['var x = 1;'])).anchors).toEqual([{ id: ID, from: true, to: false }]);
    });
  });

  it('prints the build and the receipt profile the adapter itself would read from such a page', () => {
    const copy = fullCopy();
    const names = copy.map((file) => file.name);
    expect(buildOf(copy[0]?.text ?? '')).toBe('index-AAAAAAAA');
    const modules = receiptFingerprint(names);
    expect(modules).toEqual({ notificationEntry: 'BBBBBBBB', composables: 'CCCCCCCC+DDDDDDDD', onlyfans: 'E2E2E2E2+EEEEEEEE', accounts: 'FFFFFFFF', inbox: 'GGGGGGGG' });
    // The same rule as the adapter's: what it reads in the page is what the tool prints for the copy.
    expect(modules).toEqual(receiptModules(names.map((name) => `https://chat.example.test/assets/${name}`), 'https://chat.example.test'));
    expect(receiptProfile(names, '0.999.0')).toEqual({ id: 'chatspace-0.999.0', adapterVersion: contract.ADAPTER_VERSION, modules });
    expect(missingRoles(modules)).toEqual([]);
    expect(missingRoles(receiptFingerprint(names.filter((name) => !name.startsWith('inbox'))))).toEqual(['inbox']);
  });

  it('a copy with 0.195.0’s file names (names only) prints the reviewed hub value: every role found, `onlyfans` from two modules', () => {
    // The script files of the 0.195.0 copy that matter here, as `ls` gives them: the role modules and a few of no role.
    const names = ['ChatView-CnMzMAt4.js', 'MainLayout-Dyqw2t1H.js', 'accounts-CN9N-pj3.js', 'composables-C25sVtl7.js', 'composables-DKWzNPeA.js', 'inbox-DUukOf_u.js', 'index-p8xPkCj8.js', 'notificationEntry-BaWeHDsj.js', 'onlyfans-DqEV2pNo.js', 'onlyfans-SstGvKHV.js', 'runtime-dom.esm-bundler-Ydpp0psT.js'];
    const reviewed = JSON.parse(
      '[{"id":"chatspace-0.195.0","adapterVersion":"0.3.0","modules":{"notificationEntry":"BaWeHDsj","composables":"C25sVtl7+DKWzNPeA","onlyfans":"DqEV2pNo+SstGvKHV","accounts":"CN9N-pj3","inbox":"DUukOf_u"}}]',
    ) as unknown[];
    expect([receiptProfile(names, '0.195.0')]).toEqual(reviewed);
    expect(missingRoles(receiptFingerprint(names))).toEqual([]);
  });

  it('a copy laid out like 0.172.0 — a `messages` module and no `onlyfans` one — misses the `onlyfans` role: no profile can match', () => {
    const names = fullCopy()
      .map((file) => file.name)
      .filter((name) => !name.startsWith('onlyfans-'))
      .concat('messages-EEEEEEEE.js');
    const modules = receiptFingerprint(names);
    expect(modules).not.toHaveProperty('messages');
    expect(missingRoles(modules)).toEqual(['onlyfans']);
  });

  it('[X8-06] the send path’s anchors name the composer bridge, the translator store, the queue store, the HTTP client and the open-chat echo handler — never the queue action itself', () => {
    expect(new Set(contract.SEND_PATH_ANCHORS.map((anchor) => anchor.part))).toEqual(new Set(['composer bridge', 'translator store', 'queue store', 'HTTP client', 'open-chat echo handler', 'socket bus']));
    expect(contract.SEND_PATH_ANCHORS.map((anchor) => anchor.value)).not.toContain(QUEUE_ACTION);
  });

  it('[X8-06] the regroup tripwire: 0.195.0’s layout passes — every send-path anchor is in a role module, the queue action beside its store', () => {
    expect(sendPathOutsideRoles(sendPathCopy())).toEqual([]);
  });

  it('[X8-06] the regroup tripwire: an anchor in a file of no role — the entry module included — fails with its place', () => {
    const moved = sendPathOutsideRoles(sendPathCopy({ ...PLACES_0195, 'composer bridge': 'ChatView-ZZZZZZZZ.js' }));
    expect(moved).toEqual([{ part: 'composer bridge', anchor: 'member __omComposerBridge', at: [expect.stringMatching(/^ChatView-ZZZZZZZZ\.js:\d+$/)], count: 1 }]);
    const entry = sendPathOutsideRoles(sendPathCopy({ ...PLACES_0195, 'HTTP client': 'index-AAAAAAAA.js' }));
    expect(entry.map((problem) => [problem.part, problem.at[0]?.split(':')[0]])).toEqual(contract.SEND_PATH_ANCHORS.filter((anchor) => anchor.part === 'HTTP client').map(() => ['HTTP client', 'index-AAAAAAAA.js']));
    // A second copy outside the roles counts even when the role module has one too.
    const copy = sendPathCopy().map((file) => (file.name === 'ChatView-ZZZZZZZZ.js' ? { ...file, text: `${file.text}\nq = [\`${contract.KEY_MESSAGES}\`, a, f];` } : file));
    expect(sendPathOutsideRoles(copy).map((problem) => problem.anchor)).toEqual([`string ${contract.KEY_MESSAGES}`]);
  });

  it('[X8-06] the regroup tripwire: 0.172.0’s layout under this adapter fails — `messages-*` holds the composer bridge, the translator and the echo handler, though no role is missing', () => {
    const copy = sendPathCopy({ ...PLACES_0195, 'composer bridge': 'messages-HHHHHHHH.js', 'translator store': 'messages-HHHHHHHH.js', 'open-chat echo handler': 'messages-HHHHHHHH.js' });
    // The blind spot it closes: a small `onlyfans` module is there, so every role has a module.
    expect(missingRoles(receiptFingerprint(copy.map((file) => file.name)))).toEqual([]);
    const problems = sendPathOutsideRoles(copy);
    expect(problems.map((problem) => problem.part)).toEqual(['composer bridge', 'translator store', 'translator store', 'open-chat echo handler', 'open-chat echo handler']);
    expect(problems.every((problem) => problem.at.every((place) => place.startsWith('messages-HHHHHHHH.js:')))).toBe(true);
  });

  it('[X8-06] the regroup tripwire: an anchor found nowhere, or a queue store without its action beside it, fails too', () => {
    expect(sendPathOutsideRoles(sendPathCopy(PLACES_0195, { skip: 'afterResponse' }))).toEqual([{ part: 'HTTP client', anchor: 'member afterResponse', at: [], count: 0 }]);
    expect(sendPathOutsideRoles(sendPathCopy(PLACES_0195, { queueActionIn: 'ChatView-ZZZZZZZZ.js' }))).toEqual([
      { part: 'queue action', anchor: `queue action ${QUEUE_ACTION} beside store ${contract.STORE_QUEUE}`, at: ['notificationEntry-BBBBBBBB.js'], count: 1 },
    ]);
  });

  it('against another copy: which role modules and which of their imports changed — hashes only', () => {
    const before = fullCopy();
    const after = before.map((file) =>
      file.name === 'notificationEntry-BBBBBBBB.js'
        ? { name: 'notificationEntry-NEWNEW00.js', text: 'import { a } from "./composables-CCCCCCCC.js";\nimport { b } from "./inbox-NEWINBOX.js";\nimport { c } from "./dist-QQQQQQQQ.js";' }
        : file.name === 'inbox-GGGGGGGG.js'
          ? { name: 'inbox-NEWINBOX.js', text: '' }
          : file,
    );
    expect(importsOf(before[3] as BundleFile)).toEqual({ composables: 'CCCCCCCC', inbox: 'GGGGGGGG' });
    expect(diffCopies(before, after)).toEqual({
      roles: [
        { role: 'notificationEntry', from: 'BBBBBBBB', to: 'NEWNEW00' },
        { role: 'inbox', from: 'GGGGGGGG', to: 'NEWINBOX' },
      ],
      imports: [
        { role: 'notificationEntry', module: 'dist', from: null, to: 'QQQQQQQQ' },
        { role: 'notificationEntry', module: 'inbox', from: 'GGGGGGGG', to: 'NEWINBOX' },
      ],
      anchors: [],
      code: [],
    });
    expect(diffCopies(before, before)).toEqual({ roles: [], imports: [], anchors: [], code: [] });
  });

  it('compares the code around the anchors by shape: a renamed variable is not a change (the false alarm of a new hash), another call is', () => {
    const module = (hash: string, call: string, [a, b, c, d]: string): BundleFile[] => [
      { name: `notificationEntry-${hash}.js`, text: [`var ${a} = defineStore(\`pendingMessages\`, () => {`, `  function ${b}(${c}) {`, `    return ${d}.${call};`, '  }', '});'].join('\n') },
    ];
    const before = module('AAAAAAAA', 'post(c.text)', 'abcd');
    const renamed = module('BBBBBBBB', 'post(z.text)', 'xyzq');
    const rewritten = module('CCCCCCCC', 'put(z.text, z.extra)', 'xyzq');
    expect(shapeOf('var a = b.post(c.text, `x`, { key: d });')).toBe('var $ = $ . post ( $ . text , `x` , { key : $ } ) ;');
    expect(shapeOf('var a = b.post(c.text);')).toBe(shapeOf('var x = y.post(z.text);'));
    const same = diffCopies(before, renamed);
    expect(same.roles).toEqual([{ role: 'notificationEntry', from: 'AAAAAAAA', to: 'BBBBBBBB' }]);
    expect(same.code).toEqual([{ role: 'notificationEntry', anchor: 'store pendingMessages', same: 1, changed: [] }]);
    expect(diffCopies(before, rewritten).code).toEqual([{ role: 'notificationEntry', anchor: 'store pendingMessages', same: 0, changed: ['notificationEntry-CCCCCCCC.js:1'] }]);
  });
});
