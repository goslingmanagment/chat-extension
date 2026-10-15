import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { readXpi, withoutSignature, writeXpi, xpiFacts } from './xpi';

const manifest = (id: string, version: string): { name: string; data: Buffer } => ({ name: 'manifest.json', data: Buffer.from(JSON.stringify({ version, browser_specific_settings: { gecko: { id } } })) });

describe('the P3b harness’s look at an XPI', () => {
  it('reads what it wrote, and a signed archive’s id, version and signature', () => {
    const entries = [manifest('chatgoose-p3b-test@gosling.agency', '0.2.4.41472001'), { name: 'META-INF/mozilla.rsa', data: Buffer.from('signature') }, { name: 'background.js', data: Buffer.from('1') }];
    const zip = writeXpi(entries);
    expect(readXpi(zip)).toEqual(entries);
    expect(xpiFacts(zip)).toEqual({ id: 'chatgoose-p3b-test@gosling.agency', version: '0.2.4.41472001', signed: true });
    const stripped = withoutSignature(zip);
    expect(readXpi(stripped).map((entry) => entry.name)).toEqual(['manifest.json', 'background.js']);
    expect(xpiFacts(stripped).signed).toBe(false);
  });

  it('inflates a deflated entry, as AMO’s signed files are packed', () => {
    const plain = writeXpi([manifest('a@b', '1.0')]);
    // Turn the one stored entry into a deflated one: method 8, the compressed size, the body replaced.
    const body = Buffer.from(JSON.stringify({ version: '1.0', browser_specific_settings: { gecko: { id: 'a@b' } } }));
    const deflated = deflateRawSync(body);
    const name = Buffer.from('manifest.json');
    const local = Buffer.from(plain.subarray(0, 30));
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(deflated.length, 18);
    const central = Buffer.from(plain.subarray(30 + name.length + body.length, 30 + name.length + body.length + 46));
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(deflated.length, 20);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12);
    end.writeUInt32LE(30 + name.length + deflated.length, 16);
    const zip = Buffer.concat([local, name, deflated, central, name, end]);
    expect(xpiFacts(zip)).toEqual({ id: 'a@b', version: '1.0', signed: false });
  });
});
