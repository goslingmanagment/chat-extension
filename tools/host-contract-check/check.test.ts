// The local host-contract check on a synthetic «bundle copy» (no ChatSpace
// code here: the real copy lives outside the repository and is read only by
// hand, `node tools/host-contract-check/index.ts`).

import { describe, expect, it } from 'vitest';

import * as contract from '../../packages/host-chatspace/src/isolated/host-contract.ts';
import { receiptModules } from '../../packages/host-chatspace/src/isolated/receipt-profile.ts';
import { QUEUE_SEND } from '../../packages/host-chatspace/src/main/send-port.ts';
import { buildOf, checkAnchors, contractAnchors, diffCopies, importsOf, missingRoles, QUEUE_ACTION, receiptFingerprint, receiptProfile, shapeOf, type BundleFile } from './check.ts';

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
