// One facade over the in-memory hub, a memory storage.local/.session, a test
// environment and a log that keeps every line (for the «no secrets in logs»
// checks). Scenario data comes from the test (from @cg/testing/hub).

import { type HubRouteKey, type SessionIdentity } from '@cg/contracts';

import { ChatExtensionHub, type AiStreamTransport, type SessionChange, type StreamNotice } from '../../src/index';
import { FakeHub, MemoryStore, counterUuid, json, memoryLog, testEnv, type TestEnv } from './fake-hub';

export interface Harness {
  readonly hub: FakeHub;
  readonly local: MemoryStore;
  readonly session: MemoryStore;
  readonly env: TestEnv;
  readonly logs: ReturnType<typeof memoryLog>;
  readonly facade: ChatExtensionHub;
  readonly changes: SessionChange[];
  readonly notices: StreamNotice[];
}

export interface HarnessOptions {
  readonly paths: Readonly<Record<HubRouteKey, string>>;
  readonly env?: TestEnv;
  readonly local?: MemoryStore;
  readonly session?: MemoryStore;
  readonly hub?: FakeHub;
  readonly streamTransport?: AiStreamTransport;
  readonly compatPageAccounts?: Readonly<Record<string, string>>;
  readonly compatPlatforms?: readonly string[];
}

export function makeHarness(options: HarnessOptions): Harness {
  const hub = options.hub ?? new FakeHub(options.paths);
  const local = options.local ?? new MemoryStore();
  const session = options.session ?? new MemoryStore();
  const env = options.env ?? testEnv();
  const logs = memoryLog();
  const facade = new ChatExtensionHub({
    env,
    local,
    session,
    fetch: hub.fetch,
    log: logs.log,
    uuid: counterUuid(),
    ...(options.streamTransport === undefined ? {} : { streamTransport: options.streamTransport }),
    ...(options.compatPageAccounts === undefined ? {} : { compatPageAccounts: options.compatPageAccounts }),
    ...(options.compatPlatforms === undefined ? {} : { compatPlatforms: options.compatPlatforms }),
  });
  const changes: SessionChange[] = [];
  const notices: StreamNotice[] = [];
  facade.onSessionChange((change) => changes.push(change));
  facade.onStreamNotice((notice) => notices.push(notice));
  return { hub, local, session, env, logs, facade, changes, notices };
}

/** The answers a sign-in needs: the issued token, `me`, the bootstrap and the catalog. */
export interface SignInWorld {
  readonly login: string;
  readonly password: string;
  /** The `active` (or `pending`) answer of the sign-in route. */
  readonly issued: Readonly<Record<string, unknown>>;
  readonly me: unknown;
  readonly bootstrap: unknown;
  readonly catalog: unknown;
}

/**
 * Serves `world` (sign-in, me, bootstrap, catalog, revoke) on the routes
 * without matching bodies — tests of other parts only need a signed-in
 * facade — then signs in.
 */
export async function signIn(h: Harness, world: SignInWorld): Promise<SessionIdentity> {
  h.hub
    .on('authIssueDeviceTokenWithPassword', () => json(200, world.issued))
    .on('me', () => json(200, world.me))
    .on('clientBootstrap', () => json(200, world.bootstrap))
    .on('aiPersonaCatalog', () => json(200, world.catalog))
    .on('authRevokeCurrentDeviceToken', () => json(200, { revoked: true }));
  return h.facade.signIn(world.login, world.password);
}

/** Lets queued promise callbacks run (no timers). */
export async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/** Lets promise callbacks run until `condition` holds (at most `rounds` macrotask turns). */
export async function until(condition: () => boolean, rounds = 50): Promise<void> {
  for (let i = 0; i < rounds && !condition(); i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  if (!condition()) throw new Error('condition never held');
}
