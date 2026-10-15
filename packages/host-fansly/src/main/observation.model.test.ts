// A model of the server against the real runtime (R20 P7b; docs/project-unite/architecture.md §5.12 «Правило
// полноты»; FS-TAIL-4, FS-TAIL-6). A reference history of one chat — creations, deletions, mass sends with several
// copies and their cascade — on the server's clock; the page's socket, whose frames come in order and late, and which
// breaks (its frames in flight lost, then a new socket and its `t:1`); the page's requests: the fresh end, the inbox
// (`lastMessageId`), older pages, messages by id, its own sends (their answers late, across breaks too); frames that
// cannot be read. The server makes every answer at a random moment between its request's start and its arrival; the
// answers arrive in any order, and a fifth of them before the socket's frames of what came before them.
//
// The oracle is a reference observer. Safety at every snapshot — after every step and between single deliveries:
// MAIN says `complete` only where the reference has a certificate of the current segment (a request begun after the
// socket's `t:1` and after the chat's last loss, its answer read), and then its window is the newest messages alive
// at ONE moment no earlier than the server made that certificate and no earlier than the last frame MAIN read — never
// staler than the evidence it consumed; a start proof counts exactly what was alive then. One case the rule cannot
// tell (§5.12) is named and counted, not hidden: a message made after the certificate's newest and deleted before the
// server made it, whose creation frame MAIN read late and whose deletion frame it has not read yet.
// Liveness at the end of every case: quiet, one fresh request of the page — `complete`, the server's state now.
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

type Kind = 'fresh' | 'inbox' | 'older' | 'ids' | 'send';

interface Asked {
  readonly kind: Kind;
  /** Answered without waiting for the frames of what came before it was made. */
  readonly early: boolean;
  readonly xhr: FakeXMLHttpRequest;
  readonly ls: number;
  /** Its place in the order of what happened (a clock tick holds several). */
  readonly order: number;
  /** When the server makes the answer: within [start, arrival]. */
  readonly at: number;
  readonly arrives: number;
  /** The socket and whether its `t:1` had been read when the request began. */
  readonly socket: number;
  readonly confirmed: boolean;
  /** `older`: below this message; `ids`: these; `send`: the message it made. */
  readonly before?: number;
  readonly ids?: readonly number[];
  readonly made?: Sent;
}

interface Frame {
  readonly at: number;
  due: number;
  readonly text: string;
  /** What it tells: a creation, a deletion (the ids of the copies too), a broken frame, `t:1`. */
  readonly tells: { readonly made?: string; readonly gone?: readonly string[]; readonly broken?: true; readonly session?: true };
}

/** A certificate the reference observer holds: a fresh end of the current segment. */
interface Certificate {
  readonly ls: number;
  readonly order: number;
  readonly at: number;
  /** Its newest message (`n`); 0 — empty. */
  readonly top: number;
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

export interface Stats {
  checked: number;
  complete: number;
  proofs: number;
  residual: number;
  breaks: number;
  sends: number;
}

/** The server, the page, MAIN and the reference observer in one clock; every step is named in the trace. */
class World {
  clock = 1000;
  readonly trace: string[] = [];
  readonly sent: Sent[] = [];
  readonly changes: number[] = [0];
  readonly stats: Stats = { checked: 0, complete: 0, proofs: 0, residual: 0, breaks: 0, sends: 0 };
  /** Called after every single delivery (a frame, an answer): a check between deliveries. */
  probe: () => void = () => undefined;
  private n = 0;
  private parents: Array<{ readonly corr: string; deleted: boolean }> = [];
  private readonly frames: Frame[] = [];
  private readonly asked: Asked[] = [];
  private readonly timers: Array<{ at: number; fn: () => void }> = [];
  private readonly acks: number[] = [];
  private socket: FakeWebSocket | null = null;
  private socketN = 0;
  /** The server sends this socket the events from this moment on (its `t:1`); Infinity — none. */
  private from = Infinity;
  // The reference observer's view of the current socket.
  private confirmed = false;
  /** The order of what happened: asks and losses at one clock tick still come one after another. */
  private order = 0;
  private lastLoss = 0;
  private lastFrame = -Infinity;
  private readonly made51 = new Map<string, number>();
  private readonly gone510 = new Set<string>();
  private certs: Certificate[] = [];
  private readonly runtime: ReturnType<typeof createFanslyRuntime>;
  private readonly win = page('loading', () => this.clock);
  /** A mutant MAIN (the oracle's own test): its snapshot is cached until the next fresh answer. */
  private cached: FanslySnapshot | null = null;

  constructor(private readonly mutant: 'none' | 'cache' = 'none') {
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

  /** The latest moment an answer was made at (its content is the history up to it). */
  private built = 0;

  /** Every event of the server at a moment of its own, after every answer already made. */
  private event(): void {
    const last = Math.max(this.changes.at(-1) ?? 0, this.built);
    if (this.clock <= last) this.at(last + 1);
  }

  /** An event on the server now: its frame goes on the socket if the socket is subscribed. */
  private push(text: string, delay: number, tells: Frame['tells']): void {
    if (this.socket === null || this.clock < this.from) return;
    const last = this.frames.at(-1);
    this.frames.push({ at: this.clock, due: Math.max(this.clock + delay, last?.due ?? 0), text, tells });
  }

  make(options: { fan: boolean; type2?: boolean; copy?: boolean; reuse?: boolean; delay?: number; damaged?: boolean }): Sent {
    this.event();
    this.n += 1;
    let corr: string | null = null;
    if (options.copy === true) {
      const open = this.parents.filter((p) => !p.deleted);
      const reused = options.reuse === true ? open.at(-1) : undefined;
      corr = reused?.corr ?? `7000000000002${String(this.parents.length + 1).padStart(5, '0')}`;
      if (reused === undefined) this.parents.push({ corr, deleted: false });
    }
    const m: Sent = { id: `7000000000001${String(this.n).padStart(5, '0')}`, n: this.n, fan: options.fan, type2: options.type2 === true, corr, made: this.clock, gone: Infinity };
    this.sent.push(m);
    this.changes.push(this.clock);
    this.trace.push(`${this.clock} make ${m.n}${m.fan ? ' fan' : ''}${m.type2 ? ' type2' : ''}${corr === null ? '' : ` copy of ${corr.slice(-2)}`}${options.damaged === true ? ' (frame damaged)' : ''}`);
    if (options.damaged === true) this.push(service(5, { type: 1, message: { groupId: GROUP } }), options.delay ?? 0, { broken: true });
    else this.push(service(5, { type: 1, message: this.wire(m) }), options.delay ?? 0, { made: m.id });
    return m;
  }

  /** Deletes a message; a mass send's copies go with their parent: the parent's deletion (`type 3`) is the frame. */
  remove(m: Sent, delay = 0): void {
    if (m.gone !== Infinity) return;
    this.event();
    this.changes.push(this.clock);
    if (m.corr !== null) {
      const parent = this.parents.find((p) => p.corr === m.corr);
      if (parent !== undefined) parent.deleted = true;
      const copies = this.sent.filter((copy) => copy.corr === m.corr && copy.gone === Infinity);
      for (const copy of copies) copy.gone = this.clock;
      this.trace.push(`${this.clock} delete the parent of ${copies.map((c) => c.n).join(',')} (cascade)`);
      this.push(service(5, { type: 10, message: message(m.corr, CREATOR, { type: 3, groupId: BROADCAST }) }), delay, { gone: copies.map((c) => c.id) });
    } else {
      m.gone = this.clock;
      this.trace.push(`${this.clock} delete ${m.n}`);
      this.push(service(5, { type: 10, message: this.wire(m) }), delay, { gone: [m.id] });
    }
  }

  /** The page makes a socket; the server confirms it (`t:1`) after `confirmIn`. */
  connect(confirmIn = 0): void {
    this.socket = new this.win.WebSocket('wss://wsv3.fansly.com?v=3') as unknown as FakeWebSocket;
    this.socketN += 1;
    this.forget();
    this.trace.push(`${this.clock} socket made`);
    this.settle();
    this.at(this.clock + confirmIn);
    this.from = this.clock;
    this.trace.push(`${this.clock} t:1 sent`);
    this.push(session, 0, { session: true });
    // It is read before anything the page does next (the page asks its fresh end after it).
    this.at(this.clock);
  }

  /** A new socket or a closed one: a loss of every chat; the reference forgets what the old socket told. */
  private forget(): void {
    this.confirmed = false;
    this.lastLoss = this.order += 1;
    this.lastFrame = -Infinity;
    this.made51.clear();
    this.gone510.clear();
    this.certs = [];
  }

  /** The socket breaks: what was in flight is lost, the page sees it closed. */
  break(): void {
    if (this.socket === null) return;
    this.frames.length = 0;
    this.socket.drop();
    this.socket = null;
    this.from = Infinity;
    this.forget();
    this.stats.breaks += 1;
    this.trace.push(`${this.clock} socket broke`);
    this.settle();
  }

  connected(): boolean {
    return this.socket !== null;
  }

  /** The page asks; the server makes the answer at `at` (≥ now), it arrives at `arrives` (≥ at). */
  ask(kind: Kind, at: number, arrives: number, early = false, extra: Partial<Pick<Asked, 'before' | 'ids'>> = {}): void {
    const url =
      kind === 'fresh'
        ? `${API}/message?groupId=${GROUP}&limit=25&ngsw-bypass=true`
        : kind === 'older'
          ? `${API}/message?groupId=${GROUP}&before=7000000000001${String(extra.before ?? 1).padStart(5, '0')}&limit=25`
          : kind === 'ids'
            ? `${API}/messages?ids=${(extra.ids ?? [1]).map((n) => `7000000000001${String(n).padStart(5, '0')}`).join(',')}`
            : kind === 'send'
              ? `${API}/message`
              : `${API}/messaging/groups?limit=20`;
    const xhr = request(this.win, url, kind === 'send' ? 'POST' : 'GET');
    // Our send: the server makes the message as the request comes (its frame is the echo).
    const made = kind === 'send' ? this.make({ fan: false }) : undefined;
    if (made !== undefined) this.stats.sends += 1;
    this.asked.push({ kind, early, xhr, ls: this.clock, order: (this.order += 1), at: made?.made ?? at, arrives: Math.max(arrives, made?.made ?? 0), socket: this.socketN, confirmed: this.confirmed, ...extra, ...(made === undefined ? {} : { made }) });
    this.trace.push(`${this.clock} ask ${kind}${extra.before === undefined ? '' : ` before ${extra.before}`}${extra.ids === undefined ? '' : ` ids ${extra.ids.join(',')}`} (made at ${made?.made ?? at}, arrives at ${arrives}${early ? ', early' : ''})`);
    this.settle();
  }

  /** The answer was asked within the current segment of the chat: after the socket's `t:1`, after its last loss. */
  private current(a: Asked): boolean {
    return a.confirmed && a.socket === this.socketN && this.confirmed && a.order > this.lastLoss;
  }

  private answer(a: Asked): void {
    while (!a.early && this.frames.length > 0 && (this.frames[0] as Frame).at <= a.at) this.deliver();
    const alive = this.alive(a.at);
    this.built = Math.max(this.built, a.at);
    let body: string;
    if (a.kind === 'fresh') {
      const page = alive.slice(-25);
      body = ok({ messages: [...page].reverse().map((m) => this.wire(m)) });
      if (this.current(a)) this.certs.push({ ls: a.ls, order: a.order, at: a.at, top: page.at(-1)?.n ?? 0 });
      // The mutant's cache lives until a fresh answer.
      this.cached = null;
      this.trace.push(`${this.clock} answer fresh (made at ${a.at}: ${page.map((m) => m.n).join(',')})`);
    } else if (a.kind === 'older') {
      const page = alive.filter((m) => m.n < (a.before ?? 0)).slice(-25);
      body = ok({ messages: [...page].reverse().map((m) => this.wire(m)) });
      this.trace.push(`${this.clock} answer older (made at ${a.at}: ${page.map((m) => m.n).join(',')})`);
    } else if (a.kind === 'ids') {
      const found = alive.filter((m) => (a.ids ?? []).includes(m.n));
      body = ok({ messages: found.map((m) => this.wire(m)) });
      this.trace.push(`${this.clock} answer ids (made at ${a.at}: ${found.map((m) => m.n).join(',')})`);
    } else if (a.kind === 'send') {
      const m = a.made as Sent;
      body = ok(this.wire(m));
      this.trace.push(`${this.clock} answer send (${m.n})`);
    } else {
      body = ok({ data: [{ groupId: GROUP, lastMessageId: alive.at(-1)?.id ?? null }], aggregationData: { groups: [], accounts: [] } });
      this.trace.push(`${this.clock} answer inbox (made at ${a.at}: ${alive.at(-1)?.n ?? '-'})`);
    }
    a.xhr.respond(200, body);
    this.settle();
    this.probe();
  }

  private deliver(): void {
    const frame = this.frames.shift();
    if (frame === undefined || this.socket === null) return;
    this.socket.receive(frame.text);
    const tells = frame.tells;
    if (tells.session === true) this.confirmed = true;
    else {
      this.lastFrame = frame.at;
      if (tells.broken === true) this.lastLoss = this.order += 1;
      if (tells.made !== undefined) this.made51.set(tells.made, this.clock);
      for (const id of tells.gone ?? []) this.gone510.add(id);
    }
    this.settle();
    this.probe();
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
    if (this.mutant === 'cache' && this.cached !== null) return this.cached;
    const answer = this.runtime.handle('fx.generationSnapshot', { groupId: GROUP, feature: 'hi', window: 60, withText: false });
    this.settle();
    const parsed = FanslySnapshotSchema.safeParse(answer);
    if (!parsed.success) throw new Error(`the snapshot fails its schema: ${JSON.stringify(parsed.error.issues)}`);
    if (this.mutant === 'cache' && parsed.data.completeness === 'complete') this.cached = parsed.data;
    return parsed.data;
  }

  /** The reference's governing certificate: the latest request's of the current segment, since the chat's last loss. */
  private governing(): Certificate | null {
    let best: Certificate | null = null;
    for (const c of this.certs) if (c.order > this.lastLoss && (best === null || c.order > best.order)) best = c;
    return best;
  }

  /** Safety: a `complete` snapshot is the state of one moment no staler than what governs and what was read. */
  check(): FanslySnapshot {
    const s = this.snapshot();
    this.stats.checked += 1;
    if (s.completeness !== 'complete') return s;
    this.stats.complete += 1;
    const g = this.governing();
    if (g === null) throw new Error('complete where the reference observer has no certificate of the current segment');
    const floor = Math.max(g.at, this.lastFrame);
    // The one case the rule cannot tell (§5.12): made after the certificate's newest, deleted before it was made,
    // its creation read after the request began (a late frame, a send's answer), its deletion not yet.
    const residual = this.sent.filter((m) => (this.made51.get(m.id) ?? -Infinity) >= g.ls && m.n > g.top && m.gone <= g.at && !this.gone510.has(m.id));
    const window = s.window.map((w) => w.id);
    const moments = [...new Set([floor, ...this.changes.filter((t) => t >= floor && t <= this.clock)])];
    const fits = (extra: readonly Sent[]): boolean =>
      moments.some((moment) => {
        const view = [...this.alive(moment), ...extra].sort((a, b) => a.n - b.n);
        if (newest(view, window.length).join() !== window.join()) return false;
        if (s.deletedIds.some((id) => view.some((m) => m.id === id))) return false;
        const proof = s.startProof;
        if (proof === undefined) return true;
        const automated = view.filter((m) => !m.fan && (m.type2 || m.corr !== null)).map((m) => m.id);
        return (
          proof.coveredCount === view.length &&
          proof.personalCount === view.length - automated.length &&
          proof.startWitnessId === (view[0]?.id ?? null) &&
          proof.automatedIds.join() === automated.slice(-120).join()
        );
      });
    if (!fits([])) {
      if (residual.length === 0 || !fits(residual)) {
        throw new Error(
          `complete, but no moment from ${floor} (the certificate made at ${g.at}, the last frame read of ${this.lastFrame}) is this: ${JSON.stringify({ window: window.map((id) => Number(id.slice(-5))), proof: s.startProof && { covered: s.startProof.coveredCount, personal: s.startProof.personalCount } })}`,
        );
      }
      this.stats.residual += 1;
    }
    if (s.startProof !== undefined) this.stats.proofs += 1;
    return s;
  }

  /** Liveness: quiet, a socket, one fresh request of the page and its frames — `complete`, the server's state now. */
  settleDown(): FanslySnapshot {
    this.probe = () => undefined;
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
function runCase(seed: number, mutant: 'none' | 'cache' = 'none'): World {
  const world = new World(mutant);
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
  // Between single deliveries too.
  world.probe = () => {
    if (random() < 0.15) world.check();
  };
  const history = Math.floor(random() * 30);
  for (let i = 0; i < history; i += 1) {
    world.make({ fan: random() < 0.5, type2: random() < 0.2, copy: random() < 0.1, reuse: random() < 0.5 });
    world.at(world.clock + 1);
  }
  world.connect(Math.floor(random() * 20));
  const steps = 15 + Math.floor(random() * 40);
  for (let step = 0; step < steps; step += 1) {
    const roll = random();
    // Most frames come soon; some lag far behind the answers.
    const delay = Math.floor(random() * (random() < 0.25 ? 200 : 40));
    const early = random() < 0.2;
    const at = world.clock + Math.floor(random() * 60);
    const arrives = at + Math.floor(random() * (random() < 0.25 ? 400 : 120));
    if (roll < 0.22 && world.sent.length < 100) world.make({ fan: random() < 0.5, type2: random() < 0.15, copy: random() < 0.12, reuse: random() < 0.5, delay, damaged: random() < 0.02 });
    else if (roll < 0.36) {
      // Often one of the newest: a message made and deleted while answers and frames are on the way.
      const alive = world.alive(world.clock);
      if (alive.length > 0) world.remove(pick(random() < 0.5 ? alive.slice(-3) : alive), delay);
    } else if (roll < 0.52) world.ask('fresh', at, arrives, early);
    else if (roll < 0.57) world.ask('inbox', at, arrives, early);
    else if (roll < 0.61 && world.sent.length > 0) world.ask('older', at, arrives, early, { before: pick(world.sent).n });
    else if (roll < 0.65 && world.sent.length > 0) world.ask('ids', at, arrives, early, { ids: [pick(world.sent).n, pick(world.sent).n] });
    else if (roll < 0.7 && world.sent.length < 100) world.ask('send', at, arrives, early);
    else if (roll < 0.75) {
      if (world.connected()) world.break();
      else world.connect(Math.floor(random() * 30));
    } else if (roll < 0.82 && !world.connected()) world.connect(Math.floor(random() * 30));
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
  it(`[FS-TAIL-4] [FS-TAIL-6] ${CASES} seeded cases: «complete» is one moment no staler than the evidence read, a proof exact; a quiet chat and one fresh request are always «complete»`, () => {
    const totals: Stats = { checked: 0, complete: 0, proofs: 0, residual: 0, breaks: 0, sends: 0 };
    for (let i = 0; i < CASES; i += 1) {
      const world = runCase(SEED + i);
      for (const key of Object.keys(totals) as Array<keyof Stats>) totals[key] += world.stats[key];
    }
    console.log(
      `model: ${CASES} cases, ${totals.checked} snapshots checked, ${totals.complete} complete, ${totals.proofs} with a start proof, ${totals.residual} in the named residual, ${totals.breaks} socket breaks, ${totals.sends} sends`,
    );
    if (CASES > 1) {
      expect(totals.complete).toBeGreaterThan(CASES);
      expect(totals.proofs).toBeGreaterThan(CASES / 10);
    }
  });

  it('[FS-TAIL-4] the oracle has teeth: a MAIN that keeps its last «complete» snapshot until the next fresh answer fails it', () => {
    let failed: string | null = null;
    for (let i = 0; i < 300 && failed === null; i += 1) {
      try {
        runCase(SEED + i, 'cache');
      } catch (error) {
        failed = (error as Error).message.split('\n')[0] ?? '';
      }
    }
    console.log(`model: the caching mutant fails — ${failed ?? 'never'}`);
    expect(failed).not.toBeNull();
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
    // 49 messages: the governing page is full, so it proves no start — and no stale count either.
    expect(s.startProof).toBeUndefined();
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

  it('[FS-TAIL-4] round 4, 2 and the named residual: a socket behind the answer — a message made before the answer’s newest is a conflict; one made after it is the one case the rule cannot tell', () => {
    // Detectable: 2 made and deleted, 3 made; the answer [1, 3] comes before any of their frames.
    const w = new World();
    w.make({ fan: true });
    w.connect(1);
    let start = w.clock;
    w.ask('fresh', start + 30, start + 31, true);
    w.at(start + 5);
    const two = w.make({ fan: false, delay: 100 });
    w.remove(two, 100);
    w.make({ fan: true, delay: 100 });
    w.at(start + 35);
    expect(ids(w.check())).toEqual([1, 3]);
    w.at(start + 200);
    // The late frame of 2 is behind the answer: unknown, never [1, 2, 3].
    expect(w.check().completeness).toBe('unknown');
    expect(w.settleDown().completeness).toBe('complete');
    // The residual: 2 made and deleted after the answer's newest, before the answer was made; both frames late.
    const r = new World();
    r.make({ fan: true });
    r.connect(1);
    start = r.clock;
    r.ask('fresh', start + 30, start + 31, true);
    r.at(start + 5);
    const late = r.make({ fan: false, delay: 100 });
    r.remove(late, 300);
    r.at(start + 200);
    // 2 shows between its two frames — named, counted, not hidden.
    expect(ids(r.check())).toEqual([1, 2]);
    expect(r.stats.residual).toBe(1);
    r.at(start + 400);
    expect(ids(r.check())).toEqual([1]);
    expect(r.settleDown().completeness).toBe('complete');
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
