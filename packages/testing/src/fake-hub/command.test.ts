// The fake hub's control commands are checked: an unknown op, an unknown
// field (a typo) or a field of the wrong kind is an error of the test — in
// process it throws, over the loopback control endpoint it is a 400 — never
// a silent `{ ok: true }` that leaves the hub as it was.

import { afterEach, describe, expect, it } from 'vitest';

import { PAGE, WORLD } from '../scenarios/hub';
import { checkCommand } from './command';
import { fakeHubControl } from './control-client';
import { createFakeHub } from './hub';
import { startFakeHub, type FakeHubServer } from './server';
import { type FakeHubCommand } from './types';

const bad = (value: unknown): FakeHubCommand => value as FakeHubCommand;

let server: FakeHubServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe('fake hub control commands', () => {
  it('every valid command shape passes as it is', () => {
    const valid: FakeHubCommand[] = [
      { op: 'reset' },
      { op: 'preset', name: 'master-off' },
      { op: 'config', patch: { flags: { previewSend: true }, quotaRequestsToday: null } },
      { op: 'clock', advanceMs: 1_000 },
      { op: 'resolveCustody', pageLabel: PAGE, fanRef: WORLD.newFan, attemptId: 'a', outcome: 'not_sent' },
      { op: 'grantPages', userId: WORLD.otherUser.userId, pages: [PAGE] },
      { op: 'pageAccount', pageLabel: PAGE, platformAccountId: '830000101' },
      { op: 'pageAccount', pageLabel: PAGE, platformAccountId: null },
      { op: 'config', patch: { clientBootstrap: false, narrowTokens: false } },
      { op: 'health', compatibleClientSdks: null },
      { op: 'spenderFans', fans: [{ fanRef: '74001001', displayName: null, lifetimeUsd: 12, windowUsd: null, fanWroteAgoSec: 60, awaiting: true }] },
      { op: 'spenderFans', fans: [] },
      { op: 'config', patch: { aiNameFan: true } },
      { op: 'status' },
    ];
    for (const command of valid) expect(checkCommand(command)).toBe(command);
  });

  it('an unknown op, an unknown field, a wrong kind or a missing field throws in process and leaves the hub as it was', () => {
    const hub = createFakeHub();
    const before = hub.status();
    expect(() => hub.control(bad({ op: 'relase', gate: 'g' }))).toThrow(/unknown op «relase»/);
    expect(() => hub.control(bad({ op: 'clock', advanceMS: 5_000 }))).toThrow(/clock has no field «advanceMS»/);
    expect(() => hub.control(bad({ op: 'resolveCustody', pageLabel: PAGE, fanRef: WORLD.newFan, attemptId: 'a', outcome: 'maybe' }))).toThrow(/resolveCustody\.outcome is not valid/);
    expect(() => hub.control(bad({ op: 'preset', name: 'pilot' }))).toThrow(/preset\.name is not valid/);
    expect(() => hub.control(bad({ op: 'release' }))).toThrow(/release needs «gate»/);
    expect(() => hub.control(bad({ op: 'grantPages', pages: [PAGE] }))).toThrow(/needs «username» or «userId»/);
    expect(() => hub.control(bad({ op: 'pageAccount', pageLabel: PAGE }))).toThrow(/pageAccount needs «platformAccountId»/);
    expect(() => hub.control(bad({ op: 'pageAccount', pageLabel: PAGE, platformAccountId: 830000101 }))).toThrow(/pageAccount\.platformAccountId is not valid/);
    expect(() => hub.control(bad({ op: 'config', patch: { masterr: false } }))).toThrow(/config patch has no field «masterr»/);
    expect(() => hub.control(bad({ op: 'clock', advanceMs: Number.NaN }))).toThrow(/clock\.advanceMs is not valid/);
    expect(() => hub.control(bad({ op: 'spenderFans' }))).toThrow(/spenderFans needs «fans»/);
    expect(() => hub.control(bad({ op: 'spenderFans', fans: [{ fanRef: '74001001', lifetimeUSD: 5 }] }))).toThrow(/spenderFans\.fans is not valid/);
    expect(() => hub.control(bad({ op: 'spenderFans', fans: [{ username: 'nobody' }] }))).toThrow(/spenderFans\.fans is not valid/);
    expect(() => hub.control(bad(null))).toThrow(/JSON object with an `op`/);
    expect(hub.status()).toEqual(before);
  });

  it('over the loopback control endpoint a bad command is a 400 naming it', async () => {
    server = await startFakeHub();
    const control = fakeHubControl(server.origin);
    await expect(control.command(bad({ op: 'relase', gate: 'g' }))).rejects.toThrow(/HTTP 400 .*unknown op «relase»/);
    await expect(control.command(bad({ op: 'clock', advanceMS: 1 }))).rejects.toThrow(/HTTP 400 .*no field «advanceMS»/);
    expect(await control.command({ op: 'release', gate: 'g' })).toEqual({ ok: true });
  });
});
