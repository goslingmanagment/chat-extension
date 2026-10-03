// The loopback fake hub's control API from another process (the wdio worker,
// a test against `startFakeHub`): commands, the journal, and the readings
// tests assert with. node:http, not the global fetch: in the wdio worker the
// global fetch stalled for up to seconds on its first call after a pause
// (e2e/support/stand.ts has the same note).

import { request as httpRequest } from 'node:http';

import { FAKE_HUB_CONTROL_HEADER, FAKE_HUB_CONTROL_PREFIX } from './hub';
import { describeCalls, journalViolations } from './journal';
import { type FakeHubCommand, type FakeHubJournalEntry, type FakeHubJournalPage, type FakeHubStatus } from './types';

async function call(origin: string, path: string, body?: unknown): Promise<unknown> {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const { status, payload } = await new Promise<{ status: number; payload: string }>((resolve, reject) => {
    const req = httpRequest(
      `${origin}${FAKE_HUB_CONTROL_PREFIX}${path}`,
      {
        method: text === undefined ? 'GET' : 'POST',
        headers: { [FAKE_HUB_CONTROL_HEADER]: '1', 'content-type': 'application/json', ...(text === undefined ? {} : { 'content-length': Buffer.byteLength(text) }) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, payload: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(text);
  });
  const parsed = JSON.parse(payload) as unknown;
  if (status !== 200) throw new Error(`fake hub control ${path}: HTTP ${status} ${payload.slice(0, 300)}`);
  return parsed;
}

export interface FakeHubControlClient {
  readonly origin: string;
  command(command: FakeHubCommand): Promise<unknown>;
  status(): Promise<FakeHubStatus>;
  journal(since?: number): Promise<FakeHubJournalPage>;
  /** The journal position now («everything after this point»). */
  mark(): Promise<number>;
  /** Forbidden, unknown, invalid and unscripted calls since `since`. */
  violations(since?: number): Promise<FakeHubJournalEntry[]>;
  /** Throws, listing them, if any violation happened since `since`. */
  assertClean(since?: number, where?: string): Promise<void>;
}

export function fakeHubControl(origin: string): FakeHubControlClient {
  const client: FakeHubControlClient = {
    origin,
    command: (command) => call(origin, 'control', command),
    status: async () => (await call(origin, 'control', { op: 'status' })) as FakeHubStatus,
    journal: async (since = 0) => (await call(origin, `journal?since=${since}`)) as FakeHubJournalPage,
    mark: async () => (await client.journal(Number.MAX_SAFE_INTEGER)).next,
    violations: async (since = 0) => journalViolations((await client.journal(since)).entries),
    assertClean: async (since = 0, where = '') => {
      const found = await client.violations(since);
      if (found.length > 0) throw new Error(`fake hub: ${found.length} call(s) the client must never make${where === '' ? '' : ` (${where})`}:\n${describeCalls(found)}`);
    },
  };
  return client;
}
