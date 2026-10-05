// Firefox remote debugging protocol (RDP) — the part `pnpm dev` needs on macOS:
// install a temporary add-on into an ALREADY RUNNING Firefox through its
// debugger server (`-start-debugger-server <port>`), the request web-ext sends
// too. Installing the same add-on again reloads it, which is how a rebuild is
// delivered. Firefox itself is started by LaunchServices (launch-macos.ts),
// never as a child of this process: nothing here spawns anything.
//
// A port that answers is not yet OUR Firefox. Before anything is installed
// the Firefox behind the port is asked which profile it runs — the marker
// pref of the profile (the preference actor) and the profile's name (the
// device actor's description) — in the SAME connection the install then uses.
// What went wrong is told apart (RdpError.kind): nothing listens; something
// listens that is not a Firefox debugger; a Firefox of another profile.
//
// Wire format: `<byte length>:<JSON>` per packet, back to back; the length
// counts the UTF-8 BYTES of the JSON, not its characters. Bulk packets
// (`bulk <actor> <type> <length>:`) are no part of this conversation and are
// refused as malformed.

import { connect } from 'node:net';
import { isAbsolute } from 'node:path';

export const DEFAULT_RDP_HOST = '127.0.0.1';
/** For the whole exchange: connect, greeting, getRoot, install. */
export const DEFAULT_INSTALL_TIMEOUT_MS = 30_000;
/** Nothing the debugger answers us is near this size: refuse instead of buffering it. */
export const MAX_PACKET_BYTES = 64 * 1024 * 1024;

const COLON = 0x3a;

// ── Framing ──

export function encodePacket(value: unknown): Buffer {
  const json: string | undefined = JSON.stringify(value);
  if (json === undefined) throw new TypeError('RDP: this value has no JSON form.');
  const body = Buffer.from(json, 'utf8');
  return Buffer.concat([Buffer.from(`${body.length}:`, 'ascii'), body]);
}

export interface PacketDecoder {
  /**
   * Feeds the next chunk off the wire and returns the packets it completes, in
   * order. Throws on a malformed stream — and keeps throwing: after that the
   * packet boundaries are lost.
   */
  push(chunk: Buffer): unknown[];
}

function isDigits(bytes: Buffer): boolean {
  for (const byte of bytes) if (byte < 0x30 || byte > 0x39) return false;
  return true;
}

function parseBody(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new Error('RDP: malformed packet — the body is not JSON.');
  }
}

export function createPacketDecoder(maxPacketBytes: number = MAX_PACKET_BYTES): PacketDecoder {
  const maxDigits = String(maxPacketBytes).length;
  let pending: Buffer = Buffer.alloc(0);
  let broken: Error | null = null;

  /** Takes every complete packet off the front of `pending`. */
  function drain(): unknown[] {
    const packets: unknown[] = [];
    for (;;) {
      const colon = pending.indexOf(COLON);
      // Without a separator yet, what has arrived must still look like a
      // length: garbage is refused now, not waited on for a colon forever.
      const prefix = colon < 0 ? pending : pending.subarray(0, colon);
      if (colon === 0 || prefix.length > maxDigits || !isDigits(prefix)) {
        throw new Error(`RDP: malformed packet length ${JSON.stringify(prefix.subarray(0, 24).toString('latin1'))}.`);
      }
      if (colon < 0) return packets;
      const length = Number(prefix.toString('ascii'));
      if (length > maxPacketBytes) throw new Error(`RDP: a packet of ${length} bytes is over the ${maxPacketBytes}-byte cap.`);
      const end = colon + 1 + length;
      if (pending.length < end) return packets;
      packets.push(parseBody(pending.subarray(colon + 1, end)));
      pending = pending.subarray(end);
    }
  }

  return {
    push(chunk) {
      if (broken !== null) throw broken;
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      try {
        return drain();
      } catch (error) {
        broken = error instanceof Error ? error : new Error(String(error));
        throw broken;
      }
    },
  };
}

// ── Port probe ──

/** True when something accepts a TCP connection on the port right now. */
export function probePort(port: number, host: string = DEFAULT_RDP_HOST, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (open: boolean): void => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// ── Client ──

/**
 * - `no-listener` — nothing accepts a connection on the port;
 * - `not-a-debugger` — something does, and it is not a Firefox debugger server (no greeting, another protocol);
 * - `other-profile` — a Firefox debugger of another profile than the expected one;
 * - `failed` — a Firefox debugger that refused or lost the request.
 */
export type RdpFailure = 'no-listener' | 'not-a-debugger' | 'other-profile' | 'failed';

export class RdpError extends Error {
  override readonly name = 'RdpError' as const;
  readonly kind: RdpFailure;

  constructor(kind: RdpFailure, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** A Firefox greets the moment a client connects: silence this long is not a debugger server. */
export const DEFAULT_GREETING_TIMEOUT_MS = 5_000;

export interface RdpTarget {
  readonly host?: string;
  readonly port: number;
  /** For the whole exchange: connect, greeting, every request. */
  readonly timeoutMs?: number;
  readonly greetingTimeoutMs?: number;
}

type Packet = Readonly<Record<string, unknown>>;

const isPacket = (value: unknown): value is Packet => typeof value === 'object' && value !== null && !Array.isArray(value);

const preview = (value: unknown): string => JSON.stringify(value).slice(0, 200);

/** `error` and `message` of an RDP error answer, as one phrase. */
function describeError(packet: Packet): string {
  const error = packet['error'];
  const message = packet['message'];
  const name = typeof error === 'string' ? error : preview(error);
  return typeof message === 'string' && message !== '' ? `${name}: ${message}` : name;
}

interface Session {
  readonly where: string;
  /** Sends a request to an actor and resolves with that actor's answer (packets of other actors in between are skipped). */
  ask(request: Packet & { readonly to: string }, step: string): Promise<Packet>;
}

/**
 * One conversation with the debugger server: connects, takes the greeting (it must come from `root`), runs
 * `talk`, and closes the socket on every outcome. An answer is matched by its `from` actor, not by arrival
 * order: Firefox may send packets of other actors in between, and those are skipped.
 */
function converse<T>(target: RdpTarget, talk: (session: Session) => Promise<T>): Promise<T> {
  const { host = DEFAULT_RDP_HOST, port, timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS, greetingTimeoutMs = DEFAULT_GREETING_TIMEOUT_MS } = target;
  const where = `Firefox debugger at ${host}:${port}`;

  return new Promise<T>((resolve, reject) => {
    const socket = connect({ host, port });
    const decoder = createPacketDecoder();
    let connected = false;
    let greeted = false;
    let settled = false;
    let step = 'connecting';
    /** The request in flight: the actor whose answer is awaited and who takes it. */
    let pending: { readonly from: string; readonly take: (packet: Packet) => void } | null = null;

    function finish(outcome: { readonly value: T } | Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(greetingTimer);
      socket.destroy();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome.value);
    }
    /** Before the greeting whatever goes wrong means «this is not a Firefox debugger»; after it, a debugger that failed. */
    const failure = (message: string): RdpError => new RdpError(greeted ? 'failed' : 'not-a-debugger', message);

    const session: Session = {
      where,
      ask(request, nextStep) {
        return new Promise<Packet>((answer) => {
          step = nextStep;
          pending = { from: request.to, take: answer };
          socket.write(encodePacket(request));
        });
      },
    };

    const timer = setTimeout(() => finish(failure(`${where}: no answer within ${timeoutMs} ms while ${step}.`)), timeoutMs);
    const greetingLimit = Math.min(timeoutMs, greetingTimeoutMs);
    const greetingTimer = setTimeout(() => {
      if (!greeted) finish(new RdpError('not-a-debugger', `${where}: no answer within ${greetingLimit} ms while ${connected ? 'waiting for the greeting' : step}.`));
    }, greetingLimit);

    socket.on('connect', () => {
      connected = true;
      step = 'waiting for the greeting';
    });
    socket.on('data', (chunk) => {
      let packets: unknown[];
      try {
        // No encoding is set on the socket, so a chunk is always a Buffer; the string branch is for the types.
        packets = decoder.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
      } catch (error) {
        finish(failure(`${where}: ${error instanceof Error ? error.message : String(error)} Is this port a Firefox debugger server?`));
        return;
      }
      for (const packet of packets) {
        if (settled) return;
        if (!isPacket(packet)) {
          finish(failure(`${where}: malformed packet ${preview(packet)}.`));
          return;
        }
        if (!greeted) {
          if (packet['from'] !== 'root') {
            finish(new RdpError('not-a-debugger', `${where}: unexpected greeting ${preview(packet)} — is this port a Firefox debugger server?`));
            return;
          }
          greeted = true;
          clearTimeout(greetingTimer);
          talk(session).then(
            (value) => finish({ value }),
            (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))),
          );
          continue;
        }
        // Unsolicited: a packet of an actor we did not ask.
        const awaited = pending;
        if (awaited === null || packet['from'] !== awaited.from) continue;
        pending = null;
        awaited.take(packet);
      }
    });
    socket.on('error', (error) => {
      if (!connected) finish(new RdpError('no-listener', `cannot connect to the ${where} (${error.message}).`));
      else finish(failure(`${where}: connection lost while ${step} (${error.message}).`));
    });
    socket.on('close', () => finish(failure(`${where} closed the connection while ${step}.`)));
  });
}

/** The actors of the root: `getRoot`. */
async function rootOf(session: Session): Promise<Packet> {
  const root = await session.ask({ to: 'root', type: 'getRoot' }, 'waiting for the root actor (getRoot)');
  if (root['error'] !== undefined) throw new RdpError('failed', `${session.where}: getRoot failed — ${describeError(root)}`);
  return root;
}

const actorOf = (root: Packet, name: string): string | null => {
  const actor = root[name];
  return typeof actor === 'string' && actor !== '' ? actor : null;
};

/** What the Firefox behind the port says about its profile (profile.ts `RunningProfile`). */
export interface DebuggerProfile {
  /** The value of the marker pref; null — not set there, or no preference actor. */
  readonly marker: string | null;
  /** `profile` of the device description; null — not told. */
  readonly name: string | null;
}

async function profileOf(session: Session, root: Packet, markerPref: string): Promise<DebuggerProfile> {
  let marker: string | null = null;
  let name: string | null = null;
  const preferences = actorOf(root, 'preferenceActor');
  if (preferences !== null) {
    // A pref that is not set answers with an error: that is «no marker», not a failure.
    const answer = await session.ask({ to: preferences, type: 'getCharPref', value: markerPref }, 'reading the profile marker');
    if (answer['error'] === undefined && typeof answer['value'] === 'string' && answer['value'] !== '') marker = answer['value'];
  }
  const device = actorOf(root, 'deviceActor');
  if (device !== null) {
    const answer = await session.ask({ to: device, type: 'getDescription' }, 'reading the device description');
    const description = answer['value'];
    if (answer['error'] === undefined && isPacket(description) && typeof description['profile'] === 'string' && description['profile'] !== '') name = description['profile'];
  }
  return { marker, name };
}

/** Asks the debugger server which profile its Firefox runs. Nothing is changed there. */
export function readDebuggerProfile(target: RdpTarget & { readonly markerPref: string }): Promise<DebuggerProfile> {
  return converse(target, async (session) => profileOf(session, await rootOf(session), target.markerPref));
}

export interface InstallTemporaryAddonOptions extends RdpTarget {
  /** Absolute directory of the unpacked add-on: Firefox reads it from disk itself. */
  readonly addonPath: string;
  /**
   * The profile this install is meant for: the Firefox is asked which profile it runs first, in this very
   * connection, and `accept` says whether that is the one — a string is why not, and nothing is installed
   * (RdpError `other-profile`). Without it the add-on goes into whatever Firefox answers.
   */
  readonly profile?: { readonly markerPref: string; readonly accept: (running: DebuggerProfile) => string | null };
}

export interface InstalledAddon {
  /** The id Firefox reports for the installed add-on, when it reports one. */
  readonly addonId: string | null;
}

/**
 * Connects to the debugger server, asks the root actor for the add-ons actor
 * and has it install (or, when already installed, reload) the add-on — after
 * the Firefox there was found to run the expected profile, when one is named.
 */
export function installTemporaryAddon(options: InstallTemporaryAddonOptions): Promise<InstalledAddon> {
  const { addonPath, profile } = options;
  if (!isAbsolute(addonPath)) return Promise.reject(new Error(`installTemporaryAddon: the add-on path must be absolute, got "${addonPath}".`));

  return converse(options, async (session) => {
    const root = await rootOf(session);
    const addonsActor = actorOf(root, 'addonsActor');
    if (addonsActor === null) throw new RdpError('failed', `${session.where}: no add-ons actor (addonsActor) in getRoot: ${preview(root)}`);
    if (profile !== undefined) {
      const refusal = profile.accept(await profileOf(session, root, profile.markerPref));
      if (refusal !== null) throw new RdpError('other-profile', `${session.where}: ${refusal}`);
    }
    const installed = await session.ask({ to: addonsActor, type: 'installTemporaryAddon', addonPath }, 'waiting for the add-on to install');
    if (installed['error'] !== undefined) throw new RdpError('failed', `${session.where}: install failed — ${describeError(installed)}`);
    const addon = installed['addon'];
    return { addonId: isPacket(addon) && typeof addon['id'] === 'string' ? addon['id'] : null };
  });
}
