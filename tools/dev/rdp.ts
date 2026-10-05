// Firefox remote debugging protocol (RDP) — the part `pnpm dev` needs on macOS:
// install a temporary add-on into an ALREADY RUNNING Firefox through its
// debugger server (`-start-debugger-server <port>`), the request web-ext sends
// too. Installing the same add-on again reloads it, which is how a rebuild is
// delivered. Firefox itself is started by LaunchServices (launch-macos.ts),
// never as a child of this process: nothing here spawns anything.
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

export interface InstallTemporaryAddonOptions {
  readonly host?: string;
  readonly port: number;
  /** Absolute directory of the unpacked add-on: Firefox reads it from disk itself. */
  readonly addonPath: string;
  readonly timeoutMs?: number;
}

export interface InstalledAddon {
  /** The id Firefox reports for the installed add-on, when it reports one. */
  readonly addonId: string | null;
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

/**
 * Connects to the debugger server, asks the root actor for the add-ons actor
 * and has it install (or, when already installed, reload) the add-on. An
 * answer is matched by its `from` actor, not by arrival order: Firefox may
 * send packets of other actors in between, and those are skipped. The socket
 * is closed on every outcome.
 */
export function installTemporaryAddon(options: InstallTemporaryAddonOptions): Promise<InstalledAddon> {
  const { host = DEFAULT_RDP_HOST, port, addonPath, timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS } = options;
  const where = `Firefox debugger at ${host}:${port}`;
  if (!isAbsolute(addonPath)) return Promise.reject(new Error(`installTemporaryAddon: the add-on path must be absolute, got "${addonPath}".`));

  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const decoder = createPacketDecoder();
    let connected = false;
    let settled = false;
    let step = 'connecting';
    /** The actor whose answer is awaited; null — the very first packet (the greeting). */
    let awaited: string | null = null;
    let onAnswer: (packet: Packet) => void = onGreeting;

    function finish(outcome: InstalledAddon | Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    }

    function ask(request: Packet & { readonly to: string }, nextStep: string, handler: (packet: Packet) => void): void {
      step = nextStep;
      awaited = request.to;
      onAnswer = handler;
      socket.write(encodePacket(request));
    }

    function onGreeting(packet: Packet): void {
      if (packet['from'] !== 'root') {
        finish(new Error(`${where}: unexpected greeting ${preview(packet)} — is this port a Firefox debugger server?`));
        return;
      }
      ask({ to: 'root', type: 'getRoot' }, 'waiting for the root actor (getRoot)', onRoot);
    }

    function onRoot(packet: Packet): void {
      const addonsActor = packet['addonsActor'];
      if (packet['error'] !== undefined) finish(new Error(`${where}: getRoot failed — ${describeError(packet)}`));
      else if (typeof addonsActor !== 'string' || addonsActor === '') finish(new Error(`${where}: no add-ons actor (addonsActor) in getRoot: ${preview(packet)}`));
      else ask({ to: addonsActor, type: 'installTemporaryAddon', addonPath }, 'waiting for the add-on to install', onInstalled);
    }

    function onInstalled(packet: Packet): void {
      if (packet['error'] !== undefined) {
        finish(new Error(`${where}: install failed — ${describeError(packet)}`));
        return;
      }
      const addon = packet['addon'];
      finish({ addonId: isPacket(addon) && typeof addon['id'] === 'string' ? addon['id'] : null });
    }

    const timer = setTimeout(() => finish(new Error(`${where}: no answer within ${timeoutMs} ms while ${step}.`)), timeoutMs);

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
        finish(new Error(`${where}: ${error instanceof Error ? error.message : String(error)} Is this port a Firefox debugger server?`));
        return;
      }
      for (const packet of packets) {
        if (settled) return;
        if (!isPacket(packet)) {
          finish(new Error(`${where}: malformed packet ${preview(packet)}.`));
          return;
        }
        // Unsolicited: a packet of an actor we did not ask.
        if (awaited !== null && packet['from'] !== awaited) continue;
        onAnswer(packet);
      }
    });
    socket.on('error', (error) => {
      finish(new Error(connected ? `${where}: connection lost while ${step} (${error.message}).` : `cannot connect to the ${where} (${error.message}).`));
    });
    socket.on('close', () => finish(new Error(`${where} closed the connection while ${step}.`)));
  });
}
