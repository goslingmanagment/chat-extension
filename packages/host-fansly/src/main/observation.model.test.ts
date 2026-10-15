// A model of the server against the real runtime (R20 P7b; docs/project-unite/architecture.md §5.12 «Правило
// полноты»; FS-TAIL-4, FS-TAIL-6). A reference history of one chat — creations, deletions, the cascade of a deleted
// mass send — on the server's clock; the page's socket, whose frames come in order and late, and which breaks (its
// frames in flight lost, then a new socket and its `t:1`); the page's requests of the fresh end, of the inbox (a
// `lastMessageId`), and frames that cannot be read; every answer made by the server at a random moment between its
// request's start and its arrival, the answers arriving in any order, late ones after a break too. The rule's one
// assumption — a frame of an event reaches the page before an answer the server made after that event — holds for
// most answers; a fifth of them arrive early, before such frames (§5.12 names what that can cost: nothing the checks
// below could see between two steps).
//
// Safety, at every snapshot: when MAIN says `complete`, its window is the newest messages alive at one moment of the
// current socket's segment — no deleted one, none missing — and a start proof, when there is one, counts exactly the
// messages alive then, the personal and the automated. Liveness, at the end of every case: once the chat is quiet,
// one fresh request of the page (and its frames) makes it `complete` with the server's state.
//
// The runtime runs synchronously: its context is a fake (timers by hand, the stream acknowledged at once), its page
// the package's fake page. Deterministic: seeded; a failure prints its seed and its trace.

import { FanslySnapshotSchema, type FanslySnapshot } from '@cg/contracts/fansly';
import type { MainContext } from '@cg/host-kit/main/bridge';
import type { Plain } from '@cg/host-kit/main/check';
import { describe, expect, it } from 'vitest';

import { API, CREATOR, FAN, GROUP, NETWORK, group, message, ok, page, request, service, session, type FakeWebSocket, type FakeXMLHttpRequest } from '../testing/fake-page';
import { createFanslyRuntime } from './index';

const BROADCAST = '700000000000000099';

/** A message on the server: when it was made and deleted (Infinity — never), and what it is. */
interface Sent {
  readonly id: string;
  readonly n: number;
  readonly fan: boolean;
  /** Automated: the model's message of type 2, or a mass send's copy (a correlation without a reply). */
  readonly type2: boolean;
  readonly corr: string | null;
  readonly made: number;
  gone: number;
}

interface Asked {
  /** Answered without waiting for the frames of what came before it was made (the model's assumption off: a repro). */
  readonly early: boolean;
  readonly xhr: FakeXMLHttpRequest;
  readonly kind: 'fresh' | 'inbox';
  readonly ls: number;
  /** When the server makes the answer: within [start, arrival]. */
  readonly at: number;
  readonly arrives: number;
}

interface Frame {
  readonly at: number;
  due: number;
  readonly text: string;
}

/** mulberry32: a small seeded generator. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const newest = (alive: readonly Sent[], k: number): string[] => alive.slice(-k).map((m) => m.id);

/** The server, the page and MAIN in one clock; every step is named in the trace. */
class World {
  clock = 1000;
  readonly trace: string[] = [];
  readonly sent: Sent[] = [];
  readonly changes: number[] = [0];
  private n = 0;
  private parents = 0;
  private readonly frames: Frame[] = [];
  private readonly asked: Asked[] = [];
  private readonly timers: Array<{ at: number; fn: () => void }> = [];
  private socket: FakeWebSocket | null = null;
  /** The server sends this socket the events from this moment on (its `t:1`); Infinity — none. */
  private from = Infinity;
  /** The moment the current segment began (its `t:1` was sent), for the check of safety. */
  segment = Infinity;
  readonly snapshots = { checked: 0, complete: 0, proofs: 0 };
  private readonly runtime: ReturnType<typeof createFanslyRuntime>;
  private readonly win = page('loading', () => this.clock);

  constructor() {
    const context: MainContext = {
      win: this.win,
      documentEpoch: 'model',
      now: () => this.clock,
      setTimer: (fn, ms) => void this.timers.push({ at: this.clock + ms, fn }),
      frame: (fn) => void this.timers.push({ at: this.clock, fn }),
      guard: (_site, fn) => fn,
      fault: (site) => {
        throw new Error(`MAIN caught a fault of its own: ${site}`);
      },
      emit: () => undefined,
      post: (t, p) => {
        // A consumer that keeps up: every batch acknowledged at once.
        if (t === 'fx.batch') this.acks.push((p as { n: number }).n);
      },
    };
    this.runtime = createFanslyRuntime(context, NETWORK);
    this.runtime.handle('fx.state', {});
    request(this.win, `${API}/account/me`).respond(200, ok({ account: { id: CREATOR } }));
    request(this.win, `${API}/group/${GROUP}/`).respond(200, ok(group(GROUP, [CREATOR, FAN])));
    this.settle();
  }

  private readonly acks: number[] = [];

  private settle(): void {
    for (let guard = 0; guard < 100; guard += 1) {
      const due = this.timers.filter((timer) => timer.at <= this.clock);
      if (due.length === 0 && this.acks.length === 0) return;
      for (const timer of due) this.timers.splice(this.timers.indexOf(timer), 1);
      for (const timer of due) timer.fn();
      for (const n of this.acks.splice(0)) this.runtime.handle('fx.ack', { n });
    }
  }

  alive(at: number): Sent[] {
    return this.sent.filter((m) => m.made <= at && at < m.gone);
  }

  private wire(m: Sent): Plain {
    return message(m.id, m.fan ? FAN : CREATOR, { type: m.type2 ? 2 : 1, correlationId: m.corr, content: m.fan ? 'hi there' : m.type2 || m.corr !== null ? 'auto' : 'hello', createdAt: 1_790_000_000 + m.n });
  }

  /** An event on the server now: its frame goes on the socket if the socket is subscribed; `damaged` — unreadable. */
  private push(text: string, delay: number): void {
    if (this.socket === null || this.clock < this.from) return;
    const last = this.frames.at(-1);
    this.frames.push({ at: this.clock, due: Math.max(this.clock + delay, last?.due ?? 0), text });
  }

  /** Every event of the server at a moment of its own: a state between two of them is a state too. */
  private event(): void {
    const last = this.changes.at(-1) ?? 0;
    if (this.clock <= last) this.at(last + 1);
  }

  make(options: { fan: boolean; type2?: boolean; copy?: boolean; delay?: number; damaged?: boolean }): Sent {
    this.event();
    this.n += 1;
    const corr = options.copy === true ? `7000000000002${String((this.parents += 1)).padStart(5, '0')}` : null;
    const m: Sent = { id: `7000000000001${String(this.n).padStart(5, '0')}`, n: this.n, fan: options.fan, type2: options.type2 === true, corr, made: this.clock, gone: Infinity };
    this.sent.push(m);
    this.changes.push(this.clock);
    this.trace.push(`${this.clock} make ${m.n}${m.fan ? ' fan' : ''}${m.type2 ? ' type2' : ''}${corr === null ? '' : ' copy'}${options.damaged === true ? ' (frame damaged)' : ''}`);
    const frame = options.damaged === true ? service(5, { type: 1, message: { groupId: GROUP } }) : service(5, { type: 1, message: this.wire(m) });
    this.push(frame, options.delay ?? 0);
    return m;
  }

  /** Deletes a message; a mass send's copy goes with its parent: the parent's deletion (`type 3`) is the frame. */
  remove(m: Sent, delay = 0): void {
    if (m.gone !== Infinity) return;
    this.event();
    this.changes.push(this.clock);
    if (m.corr !== null) {
      for (const copy of this.sent) if (copy.corr === m.corr && copy.gone === Infinity) copy.gone = this.clock;
      this.trace.push(`${this.clock} delete the parent of ${m.n} (cascade)`);
      this.push(service(5, { type: 10, message: message(m.corr, CREATOR, { type: 3, groupId: BROADCAST }) }), delay);
    } else {
      m.gone = this.clock;
      this.trace.push(`${this.clock} delete ${m.n}`);
      this.push(service(5, { type: 10, message: this.wire(m) }), delay);
    }
  }

  /** The page makes a socket; the server confirms it (`t:1`) after `confirmIn`. */
  connect(confirmIn = 0): void {
    this.socket = new this.win.WebSocket('wss://wsv3.fansly.com?v=3') as unknown as FakeWebSocket;
    this.trace.push(`${this.clock} socket made`);
    this.settle();
    this.at(this.clock + confirmIn);
    this.from = this.clock;
    this.segment = this.clock;
    this.trace.push(`${this.clock} t:1 sent`);
    this.push(session, 0);
    // It is read before anything the page does next (the page asks its fresh end after it).
    this.at(this.clock);
  }

  /** The socket breaks: what was in flight is lost, the page sees it closed. */
  break(): void {
    if (this.socket === null) return;
    this.frames.length = 0;
    this.socket.drop();
    this.socket = null;
    this.from = Infinity;
    this.segment = Infinity;
    this.trace.push(`${this.clock} socket broke`);
    this.settle();
  }

  connected(): boolean {
    return this.socket !== null;
  }

  /** The page asks; the server makes the answer at `at` (≥ now), it arrives at `arrives` (≥ at). */
  ask(kind: 'fresh' | 'inbox', at: number, arrives: number, early = false): void {
    const url = kind === 'fresh' ? `${API}/message?groupId=${GROUP}&limit=25&ngsw-bypass=true` : `${API}/messaging/groups?limit=20`;
    const xhr = request(this.win, url);
    this.asked.push({ early, xhr, kind, ls: this.clock, at, arrives });
    this.trace.push(`${this.clock} ask ${kind} #${this.asked.length} (made at ${at}, arrives at ${arrives})`);
    this.settle();
  }

  private answer(a: Asked): void {
    // The one assumption: every frame of an event before the answer was made is read before the answer.
    while (!a.early && this.frames.length > 0 && (this.frames[0] as Frame).at <= a.at) this.deliver();
    const alive = this.alive(a.at);
    const body =
      a.kind === 'fresh'
        ? ok({ messages: alive.slice(-25).reverse().map((m) => this.wire(m)) })
        : ok({ data: [{ groupId: GROUP, lastMessageId: alive.at(-1)?.id ?? null }], aggregationData: { groups: [], accounts: [] } });
    this.trace.push(`${this.clock} answer ${a.kind} (made at ${a.at}: ${a.kind === 'fresh' ? alive.slice(-25).map((m) => m.n).join(',') : (alive.at(-1)?.n ?? '-')})`);
    a.xhr.respond(200, body);
    this.settle();
  }

  private deliver(): void {
    const frame = this.frames.shift();
    if (frame === undefined || this.socket === null) return;
    this.socket.receive(frame.text);
    this.settle();
  }

  /** Time passes to `until`: frames and answers come as they are due, in order. */
  at(until: number): void {
    for (;;) {
      const frame = this.frames[0];
      const next = this.asked.reduce<Asked | null>((best, a) => (best === null || a.arrives < best.arrives ? a : best), null);
      const frameDue = frame?.due ?? Infinity;
      const askDue = next?.arrives ?? Infinity;
      const timerDue = this.timers.reduce((min, timer) => Math.min(min, timer.at), Infinity);
      const due = Math.min(frameDue, askDue, timerDue);
      if (due > until) break;
      this.clock = Math.max(this.clock, due);
      if (timerDue === due) this.settle();
      else if (frameDue === due) this.deliver();
      else if (next !== null) {
        this.asked.splice(this.asked.indexOf(next), 1);
        this.answer(next);
      }
    }
    this.clock = Math.max(this.clock, until);
    this.settle();
  }

  /** Everything in flight arrives. */
  drain(): void {
    this.at(Math.max(this.clock, ...this.asked.map((a) => a.arrives), ...this.frames.map((f) => f.due)));
  }

  snapshot(): FanslySnapshot {
    const answer = this.runtime.handle('fx.generationSnapshot', { groupId: GROUP, feature: 'hi', window: 60, withText: false });
    this.settle();
    const parsed = FanslySnapshotSchema.safeParse(answer);
    if (!parsed.success) throw new Error(`the snapshot fails its schema: ${JSON.stringify(parsed.error.issues)}`);
    return parsed.data;
  }

  /** Safety: a `complete` snapshot is the state of one moment of the current segment. */
  check(): FanslySnapshot {
    const s = this.snapshot();
    this.snapshots.checked += 1;
    if (s.completeness !== 'complete') return s;
    this.snapshots.complete += 1;
    if (this.segment === Infinity) throw new Error('complete without a socket');
    const window = s.window.map((w) => w.id);
    const moments = [...new Set([this.segment, ...this.changes.filter((t) => t >= this.segment && t <= this.clock)])];
    const fits = moments.some((moment) => {
      const alive = this.alive(moment);
      if (newest(alive, window.length).join() !== window.join()) return false;
      // The window is never shorter than what is alive above where it starts, nor reaches a message not alive.
      if (s.deletedIds.some((id) => alive.some((m) => m.id === id))) return false;
      const proof = s.startProof;
      if (proof === undefined) return true;
      const automated = alive.filter((m) => !m.fan && (m.type2 || m.corr !== null)).map((m) => m.id);
      return (
        proof.coveredCount === alive.length &&
        proof.personalCount === alive.length - automated.length &&
        proof.startWitnessId === (alive[0]?.id ?? null) &&
        proof.automatedIds.join() === automated.slice(-120).join()
      );
    });
    if (!fits) throw new Error(`complete, but no moment of the segment (from ${this.segment}) is this: ${JSON.stringify({ window: window.map((id) => Number(id.slice(-5))), proof: s.startProof && { covered: s.startProof.coveredCount, personal: s.startProof.personalCount } })}`);
    if (s.startProof !== undefined) this.snapshots.proofs += 1;
    return s;
  }

  /** Liveness: quiet, a socket, one fresh request of the page and its frames — `complete`, the server's state now. */
  settleDown(): FanslySnapshot {
    this.drain();
    if (!this.connected()) this.connect(10);
    this.drain();
    this.at(this.clock + 5000);
    this.ask('fresh', this.clock + 1, this.clock + 2);
    this.drain();
    const s = this.check();
    const alive = this.alive(this.clock);
    if (s.completeness !== 'complete') throw new Error(`not complete after a quiet fresh request: ${s.gap ?? ''}`);
    const window = s.window.map((w) => w.id);
    if (window.join() !== newest(alive, window.length).join() || window.length < Math.min(25, alive.length)) throw new Error('the window is not the server’s state now');
    if (alive.length < 25 && s.startProof === undefined) throw new Error('a short fresh end proves the start, and no proof came');
    return s;
  }
}

/** One random case: a history, then steps of the server, the socket and the page. A failure carries its trace. */
function runCase(seed: number): World {
  const world = new World();
  try {
    play(world, seed);
  } catch (error) {
    throw new Error(`seed ${seed}: ${(error as Error).message}\ntrace:\n${world.trace.join('\n')}`, { cause: error });
  }
  return world;
}

function play(world: World, seed: number): void {
  const random = generator(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const history = Math.floor(random() * 30);
  for (let i = 0; i < history; i += 1) {
    world.make({ fan: random() < 0.5, type2: random() < 0.2 });
    world.at(world.clock + 1);
  }
  world.connect(Math.floor(random() * 20));
  const steps = 15 + Math.floor(random() * 40);
  for (let step = 0; step < steps; step += 1) {
    const roll = random();
    const delay = Math.floor(random() * 40);
    if (roll < 0.25 && world.sent.length < 100) world.make({ fan: random() < 0.5, type2: random() < 0.15, copy: random() < 0.1, delay, damaged: random() < 0.02 });
    else if (roll < 0.4) {
      const alive = world.alive(world.clock);
      if (alive.length > 0) world.remove(pick(alive), delay);
    } else if (roll < 0.65) {
      const at = world.clock + Math.floor(random() * 60);
      world.ask(random() < 0.8 ? 'fresh' : 'inbox', at, at + Math.floor(random() * 120), random() < 0.2);
    } else if (roll < 0.7) {
      if (world.connected()) world.break();
      else world.connect(Math.floor(random() * 30));
    } else if (roll < 0.8 && !world.connected()) world.connect(Math.floor(random() * 30));
    else world.check();
    world.at(world.clock + Math.floor(random() * 50));
    if (random() < 0.3) world.check();
  }
  world.settleDown();
}

/** `CG_MODEL_SEED=<n>` runs that one case (its trace on failure). */
const ONE = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env['CG_MODEL_SEED'] ?? NaN);
const CASES = Number.isInteger(ONE) ? 1 : 3000;
const SEED = Number.isInteger(ONE) ? ONE : 0x7b0b;

describe('[host:fansly] the observation against a model of the server (FS-TAIL-4, FS-TAIL-6, §5.12)', () => {
  it(`[FS-TAIL-4] [FS-TAIL-6] ${CASES} seeded cases: «complete» is always a moment of the segment, a proof exact; a quiet chat and one fresh request are always «complete»`, () => {
    const totals = { checked: 0, complete: 0, proofs: 0, breaks: 0 };
    for (let i = 0; i < CASES; i += 1) {
      const seed = SEED + i;
      const world = runCase(seed);
      totals.checked += world.snapshots.checked;
      totals.complete += world.snapshots.complete;
      totals.proofs += world.snapshots.proofs;
      totals.breaks += world.trace.filter((line) => line.endsWith('socket broke')).length;
    }
    console.log(`model: ${CASES} cases, ${totals.checked} snapshots checked, ${totals.complete} complete, ${totals.proofs} with a start proof, ${totals.breaks} socket breaks`);
    if (CASES > 1) {
      expect(totals.complete).toBeGreaterThan(CASES);
      expect(totals.proofs).toBeGreaterThan(CASES / 4);
    }
  });
});

describe('[host:fansly] the reviews’ repros as fixed cases of the model (§5.12)', () => {
  /** A chat of `n` messages on the server, a confirmed socket, and the page’s first fresh end read. */
  const certified = (n: number, fan = (i: number) => i % 2 === 1): World => {
    const w = new World();
    for (let i = 1; i <= n; i += 1) w.make({ fan: fan(i) });
    w.connect(1);
    w.ask('fresh', w.clock + 1, w.clock + 2);
    w.drain();
    expect(w.check().completeness).toBe('complete');
    return w;
  };
  const ids = (s: FanslySnapshot): number[] => s.window.map((entry) => Number(entry.id.slice(-5)));

  it('[FS-TAIL-4] round 3, 1: a deletion during a gap stays deleted — a late answer of the old segment brings nothing back, the proof counts what is there', () => {
    const w = certified(24);
    // Made before the deletion, it arrives long after.
    w.ask('fresh', w.clock, w.clock + 600);
    w.at(w.clock + 1);
    w.break();
    w.remove(w.sent[1] as Sent);
    w.connect(2);
    w.ask('fresh', w.clock + 1, w.clock + 2);
    w.at(w.clock + 3);
    for (let i = 0; i < 26; i += 1) w.make({ fan: i % 3 === 0 });
    w.drain();
    expect(ids(w.check())).not.toContain(2);
    w.at(w.clock + 3000);
    const s = w.settleDown();
    expect(ids(s)).not.toContain(2);
    expect(s.startProof).toMatchObject({ coveredCount: 49 });
  });

  it('[FS-TAIL-4] round 3, 2: a late answer naming an already deleted message leaves nothing that blocks the next certificate', () => {
    const w = certified(25);
    const late = w.make({ fan: true });
    w.ask('fresh', w.clock + 1, w.clock + 900);
    w.at(w.clock + 5);
    w.remove(late);
    w.break();
    w.connect(2);
    w.ask('fresh', w.clock + 1, w.clock + 2);
    w.drain();
    w.check();
    for (let i = 0; i < 20; i += 1) w.make({ fan: false });
    expect(w.settleDown().completeness).toBe('complete');
  });

  it('[FS-TAIL-4] round 3, 3 and round 1, 2: two overlapping fresh ends with a deletion between them give one history in either order', () => {
    const windows: number[][] = [];
    for (const order of ['A first', 'B first'] as const) {
      for (const lost of [1, 2]) {
        const w = new World();
        for (let i = 1; i <= 3; i += 1) w.make({ fan: i !== 2 });
        w.connect(1);
        const start = w.clock;
        // Both answers come before the deletion's frame (the model's assumption off, as in the repro).
        w.ask('fresh', start + 10, order === 'A first' ? start + 40 : start + 60, true);
        w.ask('fresh', start + 30, order === 'A first' ? start + 50 : start + 35, true);
        w.at(start + 20);
        w.remove(w.sent[lost - 1] as Sent, 200);
        w.at(start + 70);
        const s = w.check();
        expect(s.completeness).toBe('complete');
        windows.push(ids(s));
        w.settleDown();
      }
    }
    expect(windows).toEqual([[2, 3], [1, 3], [2, 3], [1, 3]]);
  });

  it('[FS-TAIL-4] round 2, 1: B, asked later and made earlier, governs; the message A had comes back with its late frame — no tombstone in the way', () => {
    const w = new World();
    w.make({ fan: true });
    w.connect(1);
    const start = w.clock;
    w.ask('fresh', start + 20, start + 30, true);
    w.ask('fresh', start + 5, start + 40, true);
    w.at(start + 10);
    w.make({ fan: false, delay: 200 });
    w.at(start + 50);
    expect(ids(w.check())).toEqual([1]);
    w.at(start + 400);
    expect(ids(w.check())).toEqual([1, 2]);
    expect(w.settleDown().startProof).toMatchObject({ coveredCount: 2, personalCount: 2 });
  });

  it('[FS-TAIL-6] round 1, 1: 121 messages while a short answer is in flight — no proof of the start from a part the ring could not hold', () => {
    const w = new World();
    for (let i = 1; i <= 11; i += 1) w.make({ fan: i % 2 === 1 });
    w.connect(1);
    w.ask('fresh', w.clock, w.clock + 600);
    for (let i = 0; i < 121; i += 1) w.make({ fan: false, type2: true });
    w.drain();
    expect(w.check().startProof).toBeUndefined();
  });
});
