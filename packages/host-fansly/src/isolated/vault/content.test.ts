// What a file's own bytes say of its content (content.ts): headers built here byte by byte, as the formats lay them out.

import { describe, expect, it } from 'vitest';

import { readVaultFileContent, sameVaultContent } from './content';

const u16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const text = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, body: readonly number[]): number[] => [...u32(8 + body.length), ...text(type), ...body];
const fileOf = (name: string, bytes: readonly number[]): File => new File([new Uint8Array(bytes)], name);

/** A JPEG: an EXIF segment whose thumbnail carries its own frame header (never read), then the picture's own. */
function jpeg(width: number, height: number): number[] {
  const thumb = [0xff, 0xd8, 0xff, 0xc0, ...u16(17), 8, ...u16(120), ...u16(160), 3, ...Array<number>(9).fill(0)];
  const exif = [...text('Exif'), 0, 0, ...thumb];
  return [0xff, 0xd8, 0xff, 0xe1, ...u16(exif.length + 2), ...exif, 0xff, 0xdb, ...u16(4), 0, 0, 0xff, 0xc2, ...u16(17), 8, ...u16(height), ...u16(width), 3, ...Array<number>(9).fill(0), 0xff, 0xda];
}

/** A track header, version 0: its size at the end as 16.16. */
const tkhd = (width: number, height: number): number[] => box('tkhd', [0, 0, 0, 7, ...Array<number>(72).fill(0), ...u32(width * 65536), ...u32(height * 65536)]);
/** A movie header, version 0: its time scale and duration. */
const mvhd = (scale: number, duration: number): number[] => box('mvhd', [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(scale), ...u32(duration), ...Array<number>(80).fill(0)]);

describe('what a file’s own bytes say', () => {
  it('a JPEG: its picture’s frame header, past an EXIF thumbnail’s own', async () => {
    expect(await readVaultFileContent(fileOf('a.jpg', jpeg(4032, 3024)))).toEqual({ type: 1, width: 4032, height: 3024, duration: null });
  });

  it('a PNG, a GIF and an extended WebP', async () => {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), ...text('IHDR'), ...u32(1500), ...u32(450), 8, 6, 0, 0, 0];
    expect(await readVaultFileContent(fileOf('a.png', png))).toMatchObject({ type: 1, width: 1500, height: 450 });
    const gif = [...text('GIF89a'), ...le16(320), ...le16(240), 0, 0, 0, ...Array<number>(20).fill(0)];
    expect(await readVaultFileContent(fileOf('a.gif', gif))).toMatchObject({ type: 1, width: 320, height: 240 });
    const webp = [...text('RIFF'), 0, 0, 0, 0, ...text('WEBP'), ...text('VP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...[0x3f, 0x07, 0x00], ...[0xef, 0x03, 0x00], 0, 0];
    expect(await readVaultFileContent(fileOf('a.webp', webp))).toMatchObject({ type: 1, width: 1856, height: 1008 });
  });

  it('an MP4: the duration of its movie and the size of its picture’s track, its audio’s none; the media data stepped over', async () => {
    const moov = box('moov', [...mvhd(600, 84_046), ...box('trak', [...tkhd(1920, 1080), ...box('mdia', [0, 0, 0, 0])]), ...box('trak', tkhd(0, 0))]);
    const mp4 = [...box('ftyp', [...text('isom'), 0, 0, 2, 0]), ...box('mdat', Array<number>(4096).fill(7)), ...moov];
    const content = await readVaultFileContent(fileOf('a.mp4', mp4));
    expect(content).toMatchObject({ type: 2, width: 1920, height: 1080 });
    expect(content?.duration).toBeCloseTo(140.0767, 3);
  });

  it('a QuickTime movie with a 64-bit media data box', async () => {
    const mdat = [...u32(1), ...text('mdat'), ...u32(0), ...u32(16 + 64), ...Array<number>(64).fill(1)];
    const mov = [...box('wide', []), ...mdat, ...box('moov', [...mvhd(1000, 2800), ...box('trak', tkhd(1080, 1920))])];
    expect(await readVaultFileContent(fileOf('a.mov', mov))).toEqual({ type: 2, width: 1080, height: 1920, duration: 2.8 });
  });

  it('bytes it cannot read say nothing', async () => {
    expect(await readVaultFileContent(fileOf('a.webm', [0x1a, 0x45, 0xdf, 0xa3, ...Array<number>(40).fill(0)]))).toBeNull();
    expect(await readVaultFileContent(fileOf('a.jpg', [0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBeNull();
  });
});

describe('the file against the album’s card', () => {
  const photo = { type: 1, width: 3024, height: 4032, duration: null } as const;

  it('a photo: the same sides either way round; another size, another kind — another content', () => {
    expect(sameVaultContent({ type: 1, width: 4032, height: 3024, duration: null }, photo)).toBe('same');
    expect(sameVaultContent({ type: 1, width: 4032, height: 3023, duration: null }, photo)).toBe('other');
    expect(sameVaultContent({ type: 2, width: 3024, height: 4032, duration: 3 }, photo)).toBe('other');
  });

  it('a video: the same sides and a length within its slack', () => {
    const card = { type: 2, width: 1080, height: 1920, duration: 140.076667 };
    expect(sameVaultContent({ type: 2, width: 1920, height: 1080, duration: 140.4 }, card)).toBe('same');
    expect(sameVaultContent({ type: 2, width: 1920, height: 1080, duration: 141.2 }, card)).toBe('other');
  });

  it('what is not said on either side is not known', () => {
    expect(sameVaultContent(null, photo)).toBe('unknown');
    expect(sameVaultContent({ type: 1, width: 1, height: 1, duration: null }, null)).toBe('unknown');
    expect(sameVaultContent({ type: 1, width: 1, height: 1, duration: null }, { type: 1, width: null, height: null, duration: null })).toBe('unknown');
    expect(sameVaultContent({ type: 2, width: 1920, height: 1080, duration: null }, { type: 2, width: 1080, height: 1920, duration: 3 })).toBe('unknown');
  });
});
