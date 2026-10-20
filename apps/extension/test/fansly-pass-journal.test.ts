import type { PassJournalRun } from '@cg/core/services/hosts/fansly/newcomers';
import { openBoundedStore, type BoundedStoreOptions } from '@cg/platform';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';

import { createPassJournal, PASS_JOURNAL_BOUNDS } from '../src/composition/background/pass-journal';
import { HOST_MODULE_SPECS } from '../src/composition/background';

const T0 = Date.UTC(2026, 9, 16, 12);
const PASS_JOURNAL_DB = HOST_MODULE_SPECS['fansly-web'].passJournalDb;
const run = (n: number): PassJournalRun => ({ passId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, hostAccountId: '700000000000000017', startedAt: T0, windowHours: 48 });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

async function setup(idb = new IDBFactory(), limits: Partial<BoundedStoreOptions> = {}) {
  const clock = { now: T0, mono: 10 };
  const options = { dbName: PASS_JOURNAL_DB, ...PASS_JOURNAL_BOUNDS, ...limits, idb, now: () => clock.now };
  const disk = await openBoundedStore(options);
  const journal = createPassJournal({ open: () => Promise.resolve(disk), now: () => clock.now, monotonicNow: () => clock.mono });
  await journal.setEnabled(true);
  cleanups.push(() => journal.dispose());
  return { journal, disk, clock };
}

describe('[host:fansly] the pass journal in IndexedDB (R20 P10b3)', () => {
  it('[NF-029] metadata only: no message/profile bodies, credentials, signed URLs, error messages or caller-owned object references', async () => {
    const t = await setup();
    const fields = { fanRef: '710000000000000001', count: 25, content: 'private text', headers: { authorization: 'private token' }, reason: 'https://image.invalid/signed?token=private', error: new Error('private error') };
    const extraRun = { ...run(1), welcome: 'private welcome' };
    const sink = t.journal.start(extraRun);
    sink?.('history.page', fields);
    fields.count = 100;
    extraRun.hostAccountId = 'another-account';
    t.clock.now -= 10_000;
    t.clock.mono += 20;
    sink?.('pass.end');
    await t.journal.idle();
    const records = (await t.disk.latest(10)).map((row) => row.value);
    expect(records[0]).toMatchObject({ hostAccountId: run(1).hostAccountId, fields: { fanRef: fields.fanRef, count: 25 }, offsetMs: 0 });
    expect(records[1]).toMatchObject({ offsetMs: 20 });
    expect(JSON.stringify(records)).not.toMatch(/private|image.invalid|another-account|authorization/);
  });
});
