// The fake Fansly's control from another process (a wdio worker, a test
// against `startFakeFansly`): commands, the journal and the readings tests
// assert with. node:http, not the global fetch (the same note as
// fake-hub/control-client.ts), to 127.0.0.1 under the API's own name.

import { request as httpRequest } from 'node:http';

import { FANSLY_CONTROL_HEADER, FANSLY_CONTROL_PATH, type FakeFanslyCommand, type FakeFanslyResult, type FakeFanslyStatus, type FanslyCaller } from '../../fixture-fansly/src/server-protocol';
import { describeViolations, type FanslyJournalEntry, type FanslyJournalPage, type FanslyViolation } from './journal';

async function call(apiOrigin: string, path: string, body?: unknown): Promise<unknown> {
  const origin = new URL(apiOrigin);
  const text = body === undefined ? undefined : JSON.stringify(body);
  const { status, payload } = await new Promise<{ status: number; payload: string }>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: origin.port,
        path: `${FANSLY_CONTROL_PATH}${path}`,
        method: text === undefined ? 'GET' : 'POST',
        headers: { host: origin.host, [FANSLY_CONTROL_HEADER]: '1', 'content-type': 'application/json', ...(text === undefined ? {} : { 'content-length': Buffer.byteLength(text) }) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, payload: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end(text);
  });
  if (status !== 200) throw new Error(`fake Fansly control ${path}: HTTP ${status} ${payload.slice(0, 300)}`);
  return JSON.parse(payload) as unknown;
}

export interface FakeFanslyControlClient {
  readonly apiOrigin: string;
  command(command: FakeFanslyCommand): Promise<FakeFanslyResult>;
  status(): Promise<FakeFanslyStatus>;
  journal(since?: number): Promise<FanslyJournalPage>;
  /** The journal position now («everything after this point»). */
  mark(): Promise<number>;
  /** The API calls of one caller since `since`. */
  calls(caller: FanslyCaller, since?: number): Promise<FanslyJournalEntry[]>;
  /** Our own calls that broke a rule since `since`: outside FS-NET-1, a `/message/ack`, no `ngsw-bypass`, a cookie, a socket. */
  violations(since?: number): Promise<readonly FanslyViolation[]>;
  /** Throws, listing them, if any call of ours broke a rule since `since`. */
  assertOursClean(since?: number, where?: string): Promise<void>;
}

export function fakeFanslyControl(apiOrigin: string): FakeFanslyControlClient {
  const client: FakeFanslyControlClient = {
    apiOrigin,
    command: async (command) => (await call(apiOrigin, '', command)) as FakeFanslyResult,
    status: async () => {
      const result = await client.command({ op: 'status' });
      if (result.status === undefined) throw new Error('fake Fansly control: no status');
      return result.status;
    },
    journal: async (since = 0) => (await call(apiOrigin, `/journal?since=${since}`)) as FanslyJournalPage,
    mark: async () => (await client.journal(Number.MAX_SAFE_INTEGER)).next,
    calls: async (caller, since = 0) => (await client.journal(since)).entries.filter((entry) => entry.kind === 'http' && entry.caller === caller),
    violations: async (since = 0) => (await client.journal(since)).violations,
    assertOursClean: async (since = 0, where = '') => {
      const found = await client.violations(since);
      if (found.length > 0) throw new Error(`fake Fansly: ${found.length} call(s) of ours that break FS-NET-1${where === '' ? '' : ` (${where})`}:\n${describeViolations(found)}`);
    },
  };
  return client;
}
