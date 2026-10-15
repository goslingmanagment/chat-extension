// What the P3b harness needs to know of an XPI before Firefox sees it: its add-on
// id and version, whether Mozilla's signature is in it, and the same archive
// without that signature (the negative check: a release Firefox must refuse it).
// A minimal zip reader and a stored-only writer; nothing here ships.

import { inflateRawSync, crc32 } from 'node:zlib';

export interface XpiEntry {
  readonly name: string;
  readonly data: Buffer;
}

/** The PKCS#7 signature AMO puts into every signed XPI (tools/release/xpi.ts SIGNATURE_FILES). */
const SIGNATURE = 'META-INF/mozilla.rsa';

export function readXpi(zip: Buffer): XpiEntry[] {
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 65_557); at -= 1) {
    if (zip.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip archive (no end of central directory)');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out: XpiEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('a broken central directory');
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + compressed);
    if (!name.endsWith('/')) out.push({ name, data: method === 0 ? Buffer.from(body) : inflateRawSync(body) });
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

export function writeXpi(entries: readonly XpiEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, entry.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + entry.data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export interface XpiFacts {
  readonly id: string | null;
  readonly version: string | null;
  readonly signed: boolean;
}

export function xpiFacts(zip: Buffer): XpiFacts {
  const entries = readXpi(zip);
  const manifest = entries.find((entry) => entry.name === 'manifest.json');
  const parsed = manifest === undefined ? {} : (JSON.parse(manifest.data.toString('utf8')) as { version?: unknown; browser_specific_settings?: { gecko?: { id?: unknown } } });
  const id = parsed.browser_specific_settings?.gecko?.id;
  return { id: typeof id === 'string' ? id : null, version: typeof parsed.version === 'string' ? parsed.version : null, signed: entries.some((entry) => entry.name === SIGNATURE) };
}

/** The same archive without Mozilla's signature: what a release Firefox must refuse to install. */
export function withoutSignature(zip: Buffer): Buffer {
  return writeXpi(readXpi(zip).filter((entry) => !entry.name.startsWith('META-INF/')));
}
