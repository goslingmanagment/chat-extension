// The tap script as a whole — tap, live port, send port, receipt observer —
// over the fake live pieces (fake-live.ts), wired the way the bridge's
// runtime wires it: the handle's `attach`, the queue's send action forwarded
// to the port. Test-only.

import { type Checkpoint, type LivePort, type WsTapHandle } from '../main/live';
import { type SendRequest } from '../main/requests';
import { QUEUE_SEND } from '../main/send-port';
import { installWsTap } from '../main/ws-tap';
import { FakeSocket, fakeLive, fakeQueue, frames, scriptedFetch, seedLive, type FakeLive, type FakeQueue, type FakeQueueOptions, type FetchCall } from './fake-live';

export const ACC = '1001';
/** The open chat's fan (the route). */
export const OPEN_FAN = '2002';
/** The preview target: a chat that is not open. */
export const FAN = '2003';
export const SOCKET_URL = 'wss://chat.example.test/api/chat-space/ws';
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export type LiveWindow = Window & typeof globalThis;

export interface LiveHarness {
  readonly win: LiveWindow;
  /** The page's own fetch: what reaches it is what really went out. */
  readonly calls: FetchCall[];
  readonly nativeFetch: typeof fetch;
  readonly live: FakeLive;
  readonly queue: FakeQueue;
  readonly handle: WsTapHandle;
  readonly port: LivePort;
  /** ChatSpace's socket: authenticated, with a frame of ACC. */
  readonly socket: FakeSocket;
  checkpoint(fan?: string): Checkpoint;
  /** A preview send request for FAN with a checkpoint taken now. */
  request(n: number, over?: Partial<SendRequest>): SendRequest;
  preflight(req: SendRequest): { ok: boolean; code?: string; warn?: string };
  commit(req: SendRequest): { state: string; code?: string; pendingId?: string };
  /** The same command where the click may wait for the account's queue (send-port.ts `whenFree`): its answer when it settles. */
  commitLater(req: SendRequest): Promise<{ state: string; code?: string; pendingId?: string }>;
  /** `previewSendState` views posted so far, optionally of one attempt. */
  states(attemptId?: string): Array<Record<string, unknown>>;
  posted(t: string): Array<Record<string, unknown>>;
  /** Lets promises and the native chain run. */
  settle(): Promise<void>;
  dispose(): void;
}

export function startLive(options: { readonly queue?: FakeQueueOptions; readonly flags?: boolean } = {}): LiveHarness {
  FakeSocket.made = [];
  const net = scriptedFetch();
  const win = { WebSocket: FakeSocket, fetch: net.fetch, setInterval: (cb: () => void, ms: number) => setInterval(cb, ms), clearInterval: (id: number) => clearInterval(id) } as unknown as LiveWindow;
  const handle = installWsTap(win);
  if (!handle) throw new Error('tap already installed');
  const live = fakeLive();
  seedLive(live);
  live.route = { name: 'chat', acc: ACC, fan: OPEN_FAN };
  const queue = fakeQueue(win, options.queue);
  live.stores.set('pendingMessages', queue.store);
  const port = handle.attach(live.host);
  if (!port) throw new Error('no live port');
  // The runtime's part: Pinia calls `$onAction` subscribers before the action's body.
  queue.store.$onAction(({ name, args, after, onError }) => {
    if (name === QUEUE_SEND) port.sent(args[0], after, onError);
  });
  if (options.flags !== false) port.handle('flags', { wsTap: true, previewSend: true });
  const socket = new win.WebSocket(SOCKET_URL) as unknown as FakeSocket;
  socket.receive(frames.authenticated);
  socket.receive(frames.summary(ACC));
  const checkpoint = (fan = FAN): Checkpoint => port.handle('checkpoint', { acc: ACC, fan }) as Checkpoint;
  const views = (): Array<Record<string, unknown>> => live.posted.filter((event) => event.t === 'previewSendState').map((event) => event.payload['view'] as Record<string, unknown>);
  return {
    win,
    calls: net.calls,
    nativeFetch: net.fetch,
    live,
    queue,
    handle,
    port,
    socket,
    checkpoint,
    request: (n, over = {}) => ({ attemptId: uuid(n), acc: ACC, fan: FAN, platformAccountId: '3003', plainText: 'hey you', isAiGenerated: true, checkpoint: checkpoint(over.fan ?? FAN), expiresAt: Date.now() + 10_000, ...over }),
    preflight: (req) => port.handle('previewSendPreflight', { req }) as { ok: boolean; code?: string; warn?: string },
    commit: (req) => port.handle('previewSendCommit', { req }) as { state: string; code?: string; pendingId?: string },
    commitLater: (req) => Promise.resolve(port.handle('previewSendCommit', { req }) as { state: string; code?: string; pendingId?: string }),
    states: (attemptId) => views().filter((view) => attemptId === undefined || view['attemptId'] === attemptId),
    posted: (t) => live.posted.filter((event) => event.t === t).map((event) => event.payload),
    settle: () => new Promise((resolve) => setTimeout(resolve, 5)),
    dispose: () => handle.dispose(),
  };
}
