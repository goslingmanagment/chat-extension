// FS-NET-1 as data (spec §4; architecture.md §8.3, §8.4): the routes, the
// purposes, the mode of each admitted pair, the addresses.

import { FANSLY_RELAY_TARGET } from '@cg/contracts/tab-messages-fansly';
import { describe, expect, it } from 'vitest';

import { addressOf, admit, FANSLY_API_BASE, FANSLY_PURPOSES, FANSLY_ROUTE_NAMES, FANSLY_ROUTES, FS_NET_1 } from './allowlist';

describe('FS-NET-1', () => {
  it('[FS-NET-1] every address is under https://apiv3.fansly.com/api/v1/ — the prefix the relay checks too', () => {
    expect(FANSLY_API_BASE).toBe('https://apiv3.fansly.com/api/v1/');
    expect(FANSLY_API_BASE).toBe(FANSLY_RELAY_TARGET);
    for (const route of FANSLY_ROUTE_NAMES) {
      const path = Object.fromEntries([...FANSLY_ROUTES[route].path.matchAll(/:([a-z]+)/g)].map((match) => [match[1] ?? '', '300000000000000001']));
      expect(addressOf(FANSLY_API_BASE, route, { path })?.startsWith(FANSLY_API_BASE)).toBe(true);
    }
  });

  it('[RB-022] [FS-NET-1] no route of ours marks a message read: /message/ack, /typing and every other path are absent', () => {
    expect(FANSLY_ROUTE_NAMES.map((route) => `${FANSLY_ROUTES[route].method} /${FANSLY_ROUTES[route].path}`).sort()).toEqual(
      [
        'GET /account',
        'GET /account/:account/followersnew',
        'GET /account/me',
        'GET /group/:group/',
        'GET /media/orderhistory',
        'GET /message',
        'GET /message/automated',
        'GET /messaging/groups',
        'POST /group',
        'POST /message',
        'POST /notes',
        'POST /notes/delete',
        'POST /notes/edit',
      ].sort(),
    );
    expect(FANSLY_ROUTE_NAMES.some((route) => /ack|typing|unread/.test(FANSLY_ROUTES[route].path))).toBe(false);
  });

  it('[FS-NET-1] [NF-037] the admitted pairs and their mode: a pass waits its turn, a click only checks the cooldown, POST /group refuses during one, a write never waits', () => {
    const table = Object.fromEntries(FANSLY_PURPOSES.map((purpose) => [purpose, Object.fromEntries(Object.entries(FS_NET_1[purpose]).map(([route, admission]) => [route, `${admission.mode}×${admission.attempts}`]))]));
    expect(table).toEqual({
      newcomers: {
        'followers.new': 'queue×4',
        'messaging.groups': 'queue×4',
        'account.byIds': 'queue×4',
        'group.detail': 'queue×4',
        'group.create': 'queue-or-refuse×1',
        'message.history': 'queue×4',
        'message.automated': 'queue×4',
      },
      greeting: { 'message.send': 'dispatch×1', 'group.detail': 'queue-or-refuse×1', 'message.history': 'queue-or-refuse×1' },
      spenders: { 'messaging.groups': 'check×1', 'group.create': 'queue-or-refuse×1', 'account.byIds': 'check×1' },
      registration: { 'group.detail': 'check×1' },
      notes: { 'group.detail': 'check×1', 'account.byIds': 'check×1', 'notes.create': 'dispatch×1', 'notes.edit': 'dispatch×1', 'notes.delete': 'dispatch×1' },
      identity: { 'account.me': 'queue×4' },
      hi: { 'message.history': 'check×1', 'message.automated': 'check×1' },
      ppv: { 'message.history': 'check×1', 'media.orderhistory': 'check×1' },
    });
    // A write is never asked twice.
    for (const purpose of FANSLY_PURPOSES) for (const [route, admission] of Object.entries(FS_NET_1[purpose])) if (FANSLY_ROUTES[route as keyof typeof FANSLY_ROUTES].write) expect(admission.attempts).toBe(1);
  });

  it('[FS-NET-1] a pair the list does not name is not admitted: another purpose, an unknown route, an inherited name', () => {
    expect(admit('registration', 'group.detail')).toEqual({ mode: 'check', attempts: 1 });
    expect(admit('greeting', 'group.create')).toBeNull();
    expect(admit('registration', 'message.send')).toBeNull();
    expect(admit('newcomers', 'message.ack')).toBeNull();
    expect(admit('ai', 'message.history')).toBeNull();
    expect(admit('newcomers', 'toString')).toBeNull();
    expect(admit('constructor', 'group.detail')).toBeNull();
  });

  it('[FS-NET-1] an address: ids as decimal strings, only the route\'s query keys, ngsw-bypass=true on every one', () => {
    expect(addressOf(FANSLY_API_BASE, 'group.detail', { path: { group: '300000000000000123' } })).toBe('https://apiv3.fansly.com/api/v1/group/300000000000000123/?ngsw-bypass=true');
    expect(addressOf(FANSLY_API_BASE, 'message.history', { query: { groupId: '300000000000000123', limit: '25' } })).toBe(
      'https://apiv3.fansly.com/api/v1/message?groupId=300000000000000123&limit=25&ngsw-bypass=true',
    );
    expect(addressOf('http://localhost:4321/api/v1/', 'account.me')).toBe('http://localhost:4321/api/v1/account/me?ngsw-bypass=true');
    expect(addressOf(FANSLY_API_BASE, 'group.detail', { path: { group: '../ack' } })).toBeNull();
    expect(addressOf(FANSLY_API_BASE, 'group.detail', { path: { group: '1e21' } })).toBeNull();
    expect(addressOf(FANSLY_API_BASE, 'group.detail')).toBeNull();
    expect(addressOf(FANSLY_API_BASE, 'account.me', { path: { group: '1' } })).toBeNull();
    expect(addressOf(FANSLY_API_BASE, 'message.history', { query: { groupId: '1', after: '2' } })).toBeNull();
    expect(addressOf(FANSLY_API_BASE, 'messaging.groups', { query: { search: 'x'.repeat(4096) } })).toBeNull();
    // A value cannot smuggle another parameter: it is encoded.
    expect(addressOf(FANSLY_API_BASE, 'messaging.groups', { query: { search: 'a&ngsw-bypass=false' } })).toBe('https://apiv3.fansly.com/api/v1/messaging/groups?search=a%26ngsw-bypass%3Dfalse&ngsw-bypass=true');
  });
});
