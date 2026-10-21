// The lifecycle of the wiring (architecture.md §7 «Фон и выгрузка», §14): the
// background composition root and the tab's runtime together, on the fake
// browser and the in-process fake hub (test/support/world.ts) — the redactor
// knows the live hub token from the sign-in on and after a restart (LG-003).

import { STORAGE_KEYS, type LogRecord } from '@cg/contracts';
import { WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PASSWORD, createWorld, until, type World } from './support/world.ts';

let world: World;
beforeEach(() => {
  // The event page's console port: the records are read from the export, not from the test output.
  for (const level of ['debug', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(() => {
  world.dispose();
  vi.restoreAllMocks();
});

/** The records of the diagnostics export (what a person sends to the owner), oldest first. */
async function exportedLogs(w: World): Promise<LogRecord[]> {
  const file = await w.page().request('diagnostics.export', { format: 'json' });
  if (!file.ok) throw new Error(`diagnostics.export: ${file.error.code}`);
  const bundle = JSON.parse(file.payload.body) as { logs?: { records?: LogRecord[] } };
  return bundle.logs?.records ?? [];
}

async function signIn(w: World): Promise<void> {
  const answer = await w.page().request('session.signIn', { login: WORLD.user.username, password: PASSWORD });
  expect(answer).toMatchObject({ ok: true, payload: { session: { login: WORLD.user.username } } });
}

describe('[LG-003] the redactor knows the live token', () => {
  /** A record a tab writes whose machine field names `value`. */
  const recordWith = (seq: number, value: string): LogRecord => ({ ts: new Date().toISOString(), seq, level: 'warn', scope: 'tab.test', msg: 'probe', fields: { reason: value } });
  const probes = (records: readonly LogRecord[]): unknown[] => records.filter((record) => record.msg === 'probe').map((record) => record.fields?.['reason']);

  it('[LG-003] from the sign-in on, and again after the event page restarted: the stored record is read through the tap, so a token tail in a record of a tab is masked', async () => {
    world = createWorld();
    world.start();
    await signIn(world);
    const stored = world.fake.areas.local.get(STORAGE_KEYS.authToken) as { token: string };
    // The tail is what a support screen would show (DB-027): no token SHAPE matches it — only the exact value does.
    const tail = stored.token.slice(-8);
    expect(tail).toHaveLength(8);
    const tab = world.tabClient();
    await until(() => tab.client.state() === 'ready', 'the tab registered');
    expect(await tab.client.request('log.write', { records: [recordWith(1, `tail-${tail}`)] })).toMatchObject({ ok: true, payload: { accepted: 1 } });
    expect(probes(await exportedLogs(world))).toEqual(['tail-[redacted]']);

    // The next event page learns the token at its start, from the stored sign-in — before anybody signs in again.
    world.fake.suspendBackground();
    await until(() => world.starts() === 2 && tab.client.state() === 'ready', 'the tab registered with the new instance');
    expect(await tab.client.request('log.write', { records: [recordWith(2, `again-${tail}`), recordWith(3, `whole-${stored.token}`)] })).toMatchObject({ ok: true, payload: { accepted: 2 } });
    const after = probes(await exportedLogs(world));
    expect(after).toContain('again-[redacted]');
    expect(after).toContain('whole-[redacted]');
    expect(JSON.stringify(await exportedLogs(world))).not.toContain(tail);
  });
});
