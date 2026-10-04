// What a tab may change through `settings.patch` (composition/background/settings-guard.ts).

import type { SettingsPatch } from '@cg/contracts';
import type { RpcSenderContext } from '@cg/platform';
import { describe, expect, it } from 'vitest';

import type { PageLookup } from '../src/composition/background/hub-data.ts';
import { personaPatchRefusal } from '../src/composition/background/settings-guard.ts';

const TAB: RpcSenderContext = { kind: 'tab', tabSessionId: 'tab-a', tabId: 7, url: 'https://chat.example.test/chat/1001/2002' };
const OPTIONS: RpcSenderContext = { kind: 'page', page: 'options', tabId: 9, url: 'moz-extension://0f1e2d3c-test/options.html' };
const persona = { key: 'default', definitionId: 'pdef_0123456789abcdef' };

/** Page 11 is granted and bound to the tab's account; page 12 is granted, another account's; page 13 is not granted. */
const pageOf = (asked: Array<[number, string]>) => (pageId: number, sender: RpcSenderContext): PageLookup => {
  asked.push([pageId, sender.kind]);
  if (pageId === 11) return { ok: true, page: { pageId, pageLabel: 'page-a', platform: 'onlyfans' } };
  if (pageId === 12 && sender.kind === 'page') return { ok: true, page: { pageId, pageLabel: 'page-b', platform: 'onlyfans' } };
  return { ok: false, code: 'CG-BINDING-NOT-GRANTED' };
};

describe('settings.patch from a tab', () => {
  it('a tab sets and removes the persona of a page of its own binding', () => {
    const asked: Array<[number, string]> = [];
    expect(personaPatchRefusal({ personas: { byPageId: { '11': persona } } }, TAB, pageOf(asked))).toBeNull();
    expect(personaPatchRefusal({ personas: { byPageId: { '11': null } } }, TAB, pageOf(asked))).toBeNull();
    expect(asked).toEqual([[11, 'tab'], [11, 'tab']]);
  });

  it('a tab is refused the persona of a page it is not bound to — set or removed, alone or next to its own page', () => {
    const patches: SettingsPatch[] = [
      { personas: { byPageId: { '12': persona } } },
      { personas: { byPageId: { '12': null } } },
      { personas: { byPageId: { '11': persona, '13': persona } } },
      { ui: { locale: 'en' }, personas: { byPageId: { '13': persona } } },
    ];
    for (const patch of patches) expect(personaPatchRefusal(patch, TAB, pageOf([]))).toBe('CG-BINDING-NOT-GRANTED');
  });

  it('a patch without personas is not the guard’s business, and the options page is not limited here', () => {
    const asked: Array<[number, string]> = [];
    expect(personaPatchRefusal({ ui: { locale: 'en' }, sound: { volume: 40 } }, TAB, pageOf(asked))).toBeNull();
    expect(personaPatchRefusal({ personas: { byPageId: { '12': persona, '13': persona } } }, OPTIONS, pageOf(asked))).toBeNull();
    expect(asked).toEqual([]);
  });
});
