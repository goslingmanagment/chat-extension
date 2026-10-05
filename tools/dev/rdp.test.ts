// The framing as pure functions, then the client against a FAKE debugger
// server on a loopback port the OS picks. No Firefox is started or contacted.

import { createServer, type Server, type Socket } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { checkRunningProfile, PROFILE_MARKER_PREF, profileMarker } from './profile.ts';
import { createPacketDecoder, encodePacket, installTemporaryAddon, MAX_PACKET_BYTES, probePort, RdpError, readDebuggerProfile, type DebuggerProfile } from './rdp.ts';

const utf8 = (text: string): Buffer => Buffer.from(text, 'utf8');

describe('encodePacket', () => {
  it('prefixes the JSON with its length and a colon', () => {
    expect(encodePacket({ to: 'root', type: 'getRoot' }).toString('utf8')).toBe('30:{"to":"root","type":"getRoot"}');
  });

  it('counts UTF-8 bytes, not characters', () => {
    // {"a":"привет"} — 14 characters, 20 bytes (six Cyrillic letters, two bytes each).
    const packet = encodePacket({ a: 'привет' });
    expect(packet.toString('utf8')).toBe('20:{"a":"привет"}');
    expect(packet.length).toBe('20:'.length + 20);
  });

  it('refuses a value JSON cannot carry', () => {
    expect(() => encodePacket(undefined)).toThrow(/no JSON form/);
  });
});

describe('createPacketDecoder', () => {
  const stream = [{ from: 'root', applicationType: 'browser' }, { from: 'conn0.addons', message: 'Не удалось установить: файл не найден' }, { from: 'x', icon: '🪿', n: 1 }];
  const wire = Buffer.concat(stream.map((packet) => encodePacket(packet)));

  it('decodes one packet', () => {
    expect(createPacketDecoder().push(utf8('30:{"to":"root","type":"getRoot"}'))).toEqual([{ to: 'root', type: 'getRoot' }]);
  });

  it('decodes several packets from one chunk, in order', () => {
    expect(createPacketDecoder().push(wire)).toEqual(stream);
  });

  it('reads the length as bytes when the payload is not ASCII', () => {
    expect(createPacketDecoder().push(utf8('20:{"a":"привет"}7:{"b":1}'))).toEqual([{ a: 'привет' }, { b: 1 }]);
  });

  it('joins a packet split at any byte: in the length, at the colon, inside a multi-byte character', () => {
    for (let cut = 1; cut < wire.length; cut += 1) {
      const decoder = createPacketDecoder();
      const packets = [...decoder.push(wire.subarray(0, cut)), ...decoder.push(wire.subarray(cut))];
      expect(packets, `cut at byte ${cut}`).toEqual(stream);
    }
  });

  it('decodes a stream fed one byte at a time', () => {
    const decoder = createPacketDecoder();
    const packets: unknown[] = [];
    for (const byte of wire) packets.push(...decoder.push(Buffer.from([byte])));
    expect(packets).toEqual(stream);
  });

  it('waits on an incomplete packet and holds nothing back afterwards', () => {
    const decoder = createPacketDecoder();
    expect(decoder.push(utf8('1'))).toEqual([]);
    expect(decoder.push(utf8('2:{"from":'))).toEqual([]);
    expect(decoder.push(utf8('"r"}'))).toEqual([{ from: 'r' }]);
    expect(decoder.push(utf8('2:{}'))).toEqual([{}]);
  });

  it.each([
    ['a non-digit prefix', 'abc:{}'],
    ['a negative length', '-5:{"a":1}'],
    ['an empty length', ':{}'],
    ['a bulk packet header', 'bulk root stream 3:abc'],
    ['a fractional length', '2.5:{}'],
  ])('refuses %s', (_name, text) => {
    expect(() => createPacketDecoder().push(utf8(text))).toThrow(/malformed packet length/);
  });

  it('refuses garbage with no colon at once instead of waiting for one', () => {
    expect(() => createPacketDecoder().push(utf8('HTTP/1.1 400 Bad Request\r\n'))).toThrow(/malformed packet length "HTTP\/1\.1 400 Bad Request"/);
    // Digits only, but longer than any allowed length can be.
    expect(() => createPacketDecoder().push(utf8('123456789'))).toThrow(/malformed packet length/);
  });

  it('refuses a length over the cap before any of the body arrives', () => {
    expect(() => createPacketDecoder().push(utf8(`${MAX_PACKET_BYTES + 1}:`))).toThrow(/over the 67108864-byte cap/);
    expect(createPacketDecoder().push(utf8(`${MAX_PACKET_BYTES}:{`))).toEqual([]);
    expect(() => createPacketDecoder(16).push(utf8('17:'))).toThrow(/over the 16-byte cap/);
  });

  it('refuses a body that is not JSON', () => {
    expect(() => createPacketDecoder().push(utf8('3:abc'))).toThrow(/body is not JSON/);
    expect(() => createPacketDecoder().push(utf8('0:'))).toThrow(/body is not JSON/);
  });

  it('stays failed after a malformed stream', () => {
    const decoder = createPacketDecoder();
    expect(() => decoder.push(utf8('oops'))).toThrow(/malformed packet length/);
    expect(() => decoder.push(utf8('2:{}'))).toThrow(/malformed packet length/);
  });

  it('round-trips what encodePacket writes', () => {
    const value = { to: 'actor', nested: { list: [1, 'два', null, true] }, text: 'a:b:c 12:{}' };
    expect(createPacketDecoder().push(encodePacket(value))).toEqual([value]);
  });
});

// ── Fake debugger server ──

const ADDON_DIR = '/builds/firefox-mv3-test';
const ADDONS_ACTOR = 'server1.conn0.addonsActor4';
const ADDON_ID = 'addon-under-test@example.test';
const GREETING = { from: 'root', applicationType: 'browser', traits: {} };

interface FakeFirefox {
  readonly port: number;
  /** Every packet the client sent, in order. */
  readonly requests: unknown[];
  /** Resolves when the client's connection is closed on the server side. */
  readonly connectionClosed: Promise<void>;
}

type Reply = (socket: Socket, request: Record<string, unknown>) => void;

const servers: Server[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function listen(server: Server): Promise<number> {
  servers.push(server);
  server.on('connection', (socket) => sockets.push(socket));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
}

/** A debugger server: sends `greeting` (unless null) on connect and hands every request to `reply`. */
async function fakeFirefox(reply: Reply, greeting: unknown = GREETING): Promise<FakeFirefox> {
  const requests: unknown[] = [];
  let closed: () => void = () => undefined;
  const connectionClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const server = createServer((socket) => {
    const decoder = createPacketDecoder();
    socket.on('error', () => undefined);
    socket.on('close', () => closed());
    socket.on('data', (chunk) => {
      for (const request of decoder.push(Buffer.from(chunk))) {
        requests.push(request);
        reply(socket, request as Record<string, unknown>);
      }
    });
    if (greeting !== null) socket.write(encodePacket(greeting));
  });
  return { port: await listen(server), requests, connectionClosed };
}

/** The happy path of a real Firefox: getRoot names the add-ons actor, the install answers with the add-on. */
const firefoxReply: Reply = (socket, request) => {
  if (request['type'] === 'getRoot') socket.write(encodePacket({ from: 'root', addonsActor: ADDONS_ACTOR, preferenceActor: 'server1.conn0.preferenceActor1' }));
  if (request['type'] === 'installTemporaryAddon') socket.write(encodePacket({ from: ADDONS_ACTOR, addon: { id: ADDON_ID, actor: false } }));
};

async function closedPort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe('installTemporaryAddon', () => {
  it('greets, asks the root for the add-ons actor, installs and closes the socket', async () => {
    const firefox = await fakeFirefox(firefoxReply);
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR })).resolves.toEqual({ addonId: ADDON_ID });
    expect(firefox.requests).toEqual([
      { to: 'root', type: 'getRoot' },
      { to: ADDONS_ACTOR, type: 'installTemporaryAddon', addonPath: ADDON_DIR },
    ]);
    await firefox.connectionClosed;
  });

  it('reports no id when Firefox names none', async () => {
    const firefox = await fakeFirefox((socket, request) => {
      if (request['type'] === 'getRoot') socket.write(encodePacket({ from: 'root', addonsActor: ADDONS_ACTOR }));
      else socket.write(encodePacket({ from: ADDONS_ACTOR }));
    });
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR })).resolves.toEqual({ addonId: null });
  });

  it('skips packets of other actors between a request and its answer', async () => {
    const firefox = await fakeFirefox((socket, request) => {
      if (request['type'] === 'getRoot') {
        socket.write(encodePacket({ from: 'server1.conn0.tabDescriptor7', type: 'tabNavigated', url: 'https://example.test/' }));
        socket.write(encodePacket({ from: 'root', addonsActor: ADDONS_ACTOR }));
      } else {
        // Neither another actor's error nor its `addon` is our answer.
        socket.write(encodePacket({ from: 'server1.conn0.watcher9', error: 'noSuchActor', message: 'not ours' }));
        socket.write(encodePacket({ from: 'root', addon: { id: 'someone-else@example.test' } }));
        socket.write(encodePacket({ from: ADDONS_ACTOR, addon: { id: ADDON_ID, actor: false } }));
      }
    });
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR })).resolves.toEqual({ addonId: ADDON_ID });
  });

  it('reads answers that arrive in pieces, cut inside a non-ASCII character', async () => {
    const answer = encodePacket({ from: ADDONS_ACTOR, addon: { id: ADDON_ID }, note: 'дополнение установлено' });
    const cut = answer.indexOf(utf8('д')) + 1;
    const firefox = await fakeFirefox((socket, request) => {
      if (request['type'] === 'getRoot') {
        socket.write(encodePacket({ from: 'root', addonsActor: ADDONS_ACTOR }));
        return;
      }
      socket.write(answer.subarray(0, cut));
      void sleep(20).then(() => socket.write(answer.subarray(cut)));
    });
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR })).resolves.toEqual({ addonId: ADDON_ID });
  });

  it('rejects with the error and the message of a failed install, and closes the socket', async () => {
    const firefox = await fakeFirefox((socket, request) => {
      if (request['type'] === 'getRoot') socket.write(encodePacket({ from: 'root', addonsActor: ADDONS_ACTOR }));
      else socket.write(encodePacket({ from: ADDONS_ACTOR, error: 'unknownError', message: `Could not install add-on at '${ADDON_DIR}': manifest.json not found` }));
    });
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR })).rejects.toThrow(/install failed — unknownError: Could not install add-on at '\/builds\/firefox-mv3-test': manifest\.json not found/);
    await firefox.connectionClosed;
  });

  it('rejects on a timeout when the server never greets, and closes the socket', async () => {
    const firefox = await fakeFirefox(() => undefined, null);
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR, timeoutMs: 150 })).rejects.toThrow(/no answer within 150 ms while waiting for the greeting/);
    await firefox.connectionClosed;
  });

  it('rejects on a timeout when the install is never answered', async () => {
    const firefox = await fakeFirefox((socket, request) => {
      if (request['type'] === 'getRoot') socket.write(encodePacket({ from: 'root', addonsActor: ADDONS_ACTOR }));
    });
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR, timeoutMs: 150 })).rejects.toThrow(/no answer within 150 ms while waiting for the add-on to install/);
    await firefox.connectionClosed;
  });

  it('rejects an unexpected greeting', async () => {
    const firefox = await fakeFirefox(() => undefined, { from: 'somebody-else', hello: true });
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR })).rejects.toThrow(/unexpected greeting \{"from":"somebody-else"/);
    expect(firefox.requests).toEqual([]);
    await firefox.connectionClosed;
  });

  it('rejects when the root names no add-ons actor', async () => {
    const firefox = await fakeFirefox((socket) => socket.write(encodePacket({ from: 'root', preferenceActor: 'server1.conn0.preferenceActor1' })));
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR })).rejects.toThrow(/no add-ons actor/);
    expect(firefox.requests).toEqual([{ to: 'root', type: 'getRoot' }]);
  });

  it('rejects when getRoot itself fails', async () => {
    const firefox = await fakeFirefox((socket) => socket.write(encodePacket({ from: 'root', error: 'unrecognizedPacketType', message: 'no getRoot here' })));
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR })).rejects.toThrow(/getRoot failed — unrecognizedPacketType: no getRoot here/);
  });

  it('rejects when the port speaks something else', async () => {
    const server = createServer((socket) => {
      socket.on('error', () => undefined);
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
    const port = await listen(server);
    await expect(installTemporaryAddon({ port, addonPath: ADDON_DIR })).rejects.toThrow(/malformed packet length.*Is this port a Firefox debugger server\?/);
  });

  it('rejects when Firefox closes the connection half-way', async () => {
    const firefox = await fakeFirefox((socket) => socket.destroy());
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR })).rejects.toThrow(/closed the connection while waiting for the root actor|connection lost while waiting for the root actor/);
  });

  it('rejects when nothing listens on the port', async () => {
    const port = await closedPort();
    await expect(installTemporaryAddon({ port, addonPath: ADDON_DIR })).rejects.toThrow(/cannot connect to the Firefox debugger at 127\.0\.0\.1:\d+ \(.*ECONNREFUSED/);
  });

  it('refuses a relative add-on path without connecting', async () => {
    const firefox = await fakeFirefox(firefoxReply);
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: '.output/firefox-mv3-test' })).rejects.toThrow(/must be absolute/);
    expect(firefox.requests).toEqual([]);
  });
});

// ── Whose Firefox answers on the port ──

const PREFS_ACTOR = 'server1.conn0.preferenceActor1';
const DEVICE_ACTOR = 'server1.conn0.deviceActor2';
const OUR_PROFILE = '/profiles/Профили dev/cg (1)';

/** A Firefox that runs a profile: `marker` — the marker pref's value (null — the pref is not set), `name` — what its device description calls the profile. */
function firefoxOf(profile: { readonly marker: string | null; readonly name: string | null }, actors: { readonly prefs?: boolean; readonly device?: boolean } = {}): Reply {
  return (socket, request) => {
    switch (request['type']) {
      case 'getRoot':
        socket.write(encodePacket({ from: 'root', addonsActor: ADDONS_ACTOR, ...(actors.prefs === false ? {} : { preferenceActor: PREFS_ACTOR }), ...(actors.device === false ? {} : { deviceActor: DEVICE_ACTOR }) }));
        return;
      case 'getCharPref':
        // As Firefox does: a pref that is not set is an error answer of the actor.
        if (request['value'] !== PROFILE_MARKER_PREF || profile.marker === null) socket.write(encodePacket({ from: PREFS_ACTOR, error: 'unknownError', message: 'NS_ERROR_UNEXPECTED: Component returned failure code' }));
        else socket.write(encodePacket({ from: PREFS_ACTOR, value: profile.marker }));
        return;
      case 'getDescription':
        socket.write(encodePacket({ from: DEVICE_ACTOR, value: { apptype: 'firefox', version: '157.0', ...(profile.name === null ? {} : { profile: profile.name }) } }));
        return;
      case 'installTemporaryAddon':
        socket.write(encodePacket({ from: ADDONS_ACTOR, addon: { id: ADDON_ID, actor: false } }));
    }
  };
}

/** The launcher's own acceptance (index.ts): the profile of this run, or why not. */
const onlyProfile = (dir: string) => ({
  markerPref: PROFILE_MARKER_PREF,
  accept: (running: DebuggerProfile): string | null => {
    const check = checkRunningProfile(running, dir);
    return check.same ? null : `this Firefox runs ANOTHER profile: ${check.running} — not the dev profile ${dir}.`;
  },
});

const failureOf = (promise: Promise<unknown>): Promise<{ kind: string; message: string } | null> =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof RdpError ? { kind: error.kind, message: error.message } : { kind: 'not-an-RdpError', message: String(error) }),
  );

describe('readDebuggerProfile', () => {
  it('asks the preference actor for the marker and the device actor for the profile’s name, changes nothing, and closes the socket', async () => {
    const firefox = await fakeFirefox(firefoxOf({ marker: profileMarker(OUR_PROFILE), name: 'cg (1)' }));
    await expect(readDebuggerProfile({ port: firefox.port, markerPref: PROFILE_MARKER_PREF })).resolves.toEqual({ marker: profileMarker(OUR_PROFILE), name: 'cg (1)' });
    expect(firefox.requests).toEqual([
      { to: 'root', type: 'getRoot' },
      { to: PREFS_ACTOR, type: 'getCharPref', value: 'chatgoose.dev.profile' },
      { to: DEVICE_ACTOR, type: 'getDescription' },
    ]);
    await firefox.connectionClosed;
  });

  it('a Firefox without the marker (started before it existed, or not ours): no marker, its profile’s name', async () => {
    const firefox = await fakeFirefox(firefoxOf({ marker: null, name: 'firefox-dev-profile' }));
    await expect(readDebuggerProfile({ port: firefox.port, markerPref: PROFILE_MARKER_PREF })).resolves.toEqual({ marker: null, name: 'firefox-dev-profile' });
  });

  it('a Firefox that offers neither actor, or names no profile, tells nothing — which is not «ours»', async () => {
    const bare = await fakeFirefox(firefoxOf({ marker: 'x', name: 'y' }, { prefs: false, device: false }));
    await expect(readDebuggerProfile({ port: bare.port, markerPref: PROFILE_MARKER_PREF })).resolves.toEqual({ marker: null, name: null });
    expect(bare.requests).toEqual([{ to: 'root', type: 'getRoot' }]);
    const unnamed = await fakeFirefox(firefoxOf({ marker: null, name: null }));
    await expect(readDebuggerProfile({ port: unnamed.port, markerPref: PROFILE_MARKER_PREF })).resolves.toEqual({ marker: null, name: null });
  });

  it('tells what answers on the port: nothing; something that is not a Firefox debugger (another protocol, silence, a wrong greeting, a slammed door); a debugger that failed', async () => {
    const ask = (port: number) => failureOf(readDebuggerProfile({ port, markerPref: PROFILE_MARKER_PREF, greetingTimeoutMs: 120 }));
    expect(await ask(await closedPort())).toMatchObject({ kind: 'no-listener', message: expect.stringMatching(/cannot connect to the Firefox debugger at 127\.0\.0\.1:\d+/) as string });

    const http = createServer((socket) => {
      socket.on('error', () => undefined);
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
    expect(await ask(await listen(http))).toMatchObject({ kind: 'not-a-debugger', message: expect.stringMatching(/malformed packet length "HTTP\/1\.1 400 Bad Request/) as string });

    // A listener that waits for the client to speak first (most servers): no greeting.
    const silent = await fakeFirefox(() => undefined, null);
    expect(await ask(silent.port)).toMatchObject({ kind: 'not-a-debugger', message: expect.stringMatching(/no answer within 120 ms while waiting for the greeting/) as string });
    expect(silent.requests).toEqual([]);

    const stranger = await fakeFirefox(() => undefined, { from: 'somebody-else', hello: true });
    expect(await ask(stranger.port)).toMatchObject({ kind: 'not-a-debugger', message: expect.stringMatching(/unexpected greeting/) as string });

    const slammed = createServer((socket) => socket.destroy());
    expect((await ask(await listen(slammed)))?.kind).toBe('not-a-debugger');

    const broken = await fakeFirefox((socket) => socket.write(encodePacket({ from: 'root', error: 'unrecognizedPacketType', message: 'no getRoot here' })));
    expect(await ask(broken.port)).toMatchObject({ kind: 'failed', message: expect.stringMatching(/getRoot failed/) as string });
  });
});

describe('installTemporaryAddon into the Firefox of ONE profile', () => {
  it('asks which profile the Firefox runs in the same connection, then installs', async () => {
    const firefox = await fakeFirefox(firefoxOf({ marker: profileMarker(OUR_PROFILE), name: 'cg (1)' }));
    await expect(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR, profile: onlyProfile(OUR_PROFILE) })).resolves.toEqual({ addonId: ADDON_ID });
    expect(firefox.requests.map((request) => (request as { type: string }).type)).toEqual(['getRoot', 'getCharPref', 'getDescription', 'installTemporaryAddon']);
    await firefox.connectionClosed;
  });

  it('a Firefox of another profile gets NO install request: refused with both profiles named, the socket closed', async () => {
    // A person's signed-in Firefox that listens on the port this run was pointed at.
    const live = '/Users/owner/Documents/ChatGoose/firefox-dev-profile';
    const firefox = await fakeFirefox(firefoxOf({ marker: profileMarker(live), name: 'firefox-dev-profile' }));
    const failure = await failureOf(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR, profile: onlyProfile('/repo/worktree/.dev-profile') }));
    expect(failure?.kind).toBe('other-profile');
    expect(failure?.message).toContain(`this Firefox runs ANOTHER profile: ${live} — not the dev profile /repo/worktree/.dev-profile.`);
    expect(firefox.requests.map((request) => (request as { type: string }).type)).toEqual(['getRoot', 'getCharPref', 'getDescription']);
    await firefox.connectionClosed;
  });

  it('two worktrees whose profile directories have the same name are still two profiles: the marker decides, not the name', async () => {
    const firefox = await fakeFirefox(firefoxOf({ marker: profileMarker('/repo/b/.dev-profile'), name: '.dev-profile' }));
    expect((await failureOf(installTemporaryAddon({ port: firefox.port, addonPath: ADDON_DIR, profile: onlyProfile('/repo/a/.dev-profile') })))?.kind).toBe('other-profile');
    expect(firefox.requests.some((request) => (request as { type: string }).type === 'installTemporaryAddon')).toBe(false);
  });

  it('a Firefox without a marker is taken by the name of its profile directory, and refused when that differs or is not told', async () => {
    const legacy = await fakeFirefox(firefoxOf({ marker: null, name: 'firefox-dev-profile' }));
    await expect(installTemporaryAddon({ port: legacy.port, addonPath: ADDON_DIR, profile: onlyProfile('/home/u/Documents/ChatGoose/firefox-dev-profile') })).resolves.toEqual({ addonId: ADDON_ID });
    const everyday = await fakeFirefox(firefoxOf({ marker: null, name: 'default-release' }));
    expect(await failureOf(installTemporaryAddon({ port: everyday.port, addonPath: ADDON_DIR, profile: onlyProfile('/repo/a/.dev-profile') }))).toMatchObject({ kind: 'other-profile', message: expect.stringContaining('a profile named "default-release"') as string });
    const mute = await fakeFirefox(firefoxOf({ marker: 'x', name: 'y' }, { prefs: false, device: false }));
    expect((await failureOf(installTemporaryAddon({ port: mute.port, addonPath: ADDON_DIR, profile: onlyProfile('/repo/a/.dev-profile') })))?.kind).toBe('other-profile');
    for (const firefox of [everyday, mute]) expect(firefox.requests.some((request) => (request as { type: string }).type === 'installTemporaryAddon')).toBe(false);
  });

  it('every failure carries its kind: a refused install and a lost connection are a debugger that failed, a port nobody listens on is that', async () => {
    const refusing = await fakeFirefox((socket, request) => {
      if (request['type'] === 'getRoot') socket.write(encodePacket({ from: 'root', addonsActor: ADDONS_ACTOR }));
      else socket.write(encodePacket({ from: ADDONS_ACTOR, error: 'unknownError', message: 'manifest.json not found' }));
    });
    expect((await failureOf(installTemporaryAddon({ port: refusing.port, addonPath: ADDON_DIR })))?.kind).toBe('failed');
    const dropping = await fakeFirefox((socket) => socket.destroy());
    expect((await failureOf(installTemporaryAddon({ port: dropping.port, addonPath: ADDON_DIR })))?.kind).toBe('failed');
    expect((await failureOf(installTemporaryAddon({ port: await closedPort(), addonPath: ADDON_DIR })))?.kind).toBe('no-listener');
    const http = createServer((socket) => {
      socket.on('error', () => undefined);
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
    expect((await failureOf(installTemporaryAddon({ port: await listen(http), addonPath: ADDON_DIR })))?.kind).toBe('not-a-debugger');
  });
});

describe('probePort', () => {
  it('is true for a listening port and false for a closed one', async () => {
    const firefox = await fakeFirefox(firefoxReply);
    await expect(probePort(firefox.port)).resolves.toBe(true);
    await expect(probePort(await closedPort())).resolves.toBe(false);
  });
});
