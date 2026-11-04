// What a file's own bytes say of its content, against what Fansly says of a medium in the album (2026-11-04, the
// vault audit: a file of the same name was taken for the card already in the album, whatever its content).
//
// - Fansly's album answer gives no byte size and no hash (fansly-api vault.ts `VaultMediaContent`, seen on the hub's
//   captures): a medium's type, a photo's own width×height, a video's original width×height and duration. So the
//   file is read for the same: the headers only, never the whole file — a JPEG's frame header, a PNG's IHDR, a GIF's
//   screen, a WebP's VP8 header; an MP4/MOV's `moov` (`mvhd` for the duration, `tkhd` for the picture's size).
// - Width and height are compared as a pair either way round: a photo's orientation tag, a video's rotation matrix.
//   A duration within VAULT_DURATION_SLACK_S (and its share): containers and Fansly's probe round it differently.
// - Anything not read (a WebM, a damaged header, a type Fansly did not name) is `unknown`: the file goes up, and the
//   upload's own answer tells whether Fansly had the same bytes (the same medium comes back).

import type { VaultMediaContentWire } from '@cg/contracts/tab-messages-fansly';

/** What a file's own bytes say: a photo (1) or a video (2), its width and height, a video's duration in seconds. */
export interface VaultFileContent {
  readonly type: 1 | 2;
  readonly width: number;
  readonly height: number;
  readonly duration: number | null;
}

export type VaultContentMatch = 'same' | 'other' | 'unknown';

/** A video's duration may differ this much (and VAULT_DURATION_SLACK_SHARE of it) between the file and Fansly's word. */
export const VAULT_DURATION_SLACK_S = 0.5;
const VAULT_DURATION_SLACK_SHARE = 0.002;
/** The most of a file read to find its picture's header (a JPEG's metadata before its frame, an MP4's `moov` boxes). */
const WINDOW = 256 * 1024;
const MOOV_BOXES_MAX = 4096;

/** The file of the same name against the album's card: the same content, another one, or not known. */
export function sameVaultContent(file: VaultFileContent | null, card: VaultMediaContentWire | null | undefined): VaultContentMatch {
  if (file === null || card === null || card === undefined || card.type === null) return 'unknown';
  if (card.type !== 1 && card.type !== 2) return 'unknown';
  if (card.type !== file.type) return 'other';
  if (card.width === null || card.height === null) return 'unknown';
  const sameSides = (card.width === file.width && card.height === file.height) || (card.width === file.height && card.height === file.width);
  if (!sameSides) return 'other';
  if (file.type === 1) return 'same';
  if (file.duration === null || card.duration === null) return 'unknown';
  const slack = Math.max(VAULT_DURATION_SLACK_S, file.duration * VAULT_DURATION_SLACK_SHARE);
  return Math.abs(file.duration - card.duration) <= slack ? 'same' : 'other';
}

type Reader = (from: number, length: number) => Promise<DataView>;

const readerOf = (file: Blob): Reader => async (from, length) => {
  const end = Math.min(file.size, from + length);
  if (from < 0 || from >= end) return new DataView(new ArrayBuffer(0));
  return new DataView(await file.slice(from, end).arrayBuffer());
};

const ascii = (view: DataView, at: number, length: number): string => {
  let text = '';
  for (let i = 0; i < length && at + i < view.byteLength; i += 1) text += String.fromCharCode(view.getUint8(at + i));
  return text;
};

const sides = (width: number, height: number): { readonly width: number; readonly height: number } | null =>
  Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= 100_000 && height <= 100_000 ? { width, height } : null;

/** A JPEG's frame header (SOF0–SOF15 but DHT, JPG, DAC): its height, then its width. */
async function jpegSides(read: Reader, size: number): Promise<{ readonly width: number; readonly height: number } | null> {
  let at = 2;
  let window = await read(0, WINDOW);
  let base = 0;
  for (let guard = 0; guard < 10_000 && at + 4 <= size; guard += 1) {
    if (at + 9 > base + window.byteLength) {
      base = at;
      window = await read(base, WINDOW);
      if (window.byteLength < 4) return null;
    }
    const local = at - base;
    if (window.getUint8(local) !== 0xff) return null;
    const marker = window.getUint8(local + 1);
    // Fill bytes, and the markers that stand alone.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = window.getUint16(local + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (local + 9 > window.byteLength) return null;
      return sides(window.getUint16(local + 7), window.getUint16(local + 5));
    }
    at += 2 + length;
  }
  return null;
}

/** A WebP's picture: its lossy, lossless or extended header. */
function webpSides(head: DataView): { readonly width: number; readonly height: number } | null {
  if (head.byteLength < 30) return null;
  const chunk = ascii(head, 12, 4);
  if (chunk === 'VP8 ') return sides(head.getUint16(26, true) & 0x3fff, head.getUint16(28, true) & 0x3fff);
  if (chunk === 'VP8L') {
    const b0 = head.getUint8(21);
    const b1 = head.getUint8(22);
    const b2 = head.getUint8(23);
    const b3 = head.getUint8(24);
    return sides(1 + (b0 | ((b1 & 0x3f) << 8)), 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)));
  }
  if (chunk === 'VP8X') {
    const u24 = (at: number): number => head.getUint8(at) | (head.getUint8(at + 1) << 8) | (head.getUint8(at + 2) << 16);
    return sides(1 + u24(24), 1 + u24(27));
  }
  return null;
}

interface Box {
  readonly type: string;
  /** Where its content starts and ends in the file. */
  readonly start: number;
  readonly end: number;
}

/** The boxes between `from` and `to`, their headers read one by one (an `mdat` is stepped over, never read). */
async function boxes(read: Reader, from: number, to: number): Promise<Box[]> {
  const found: Box[] = [];
  let at = from;
  while (at + 8 <= to && found.length < MOOV_BOXES_MAX) {
    const head = await read(at, 16);
    if (head.byteLength < 8) break;
    let size = head.getUint32(0);
    const type = ascii(head, 4, 4);
    let header = 8;
    if (size === 1) {
      if (head.byteLength < 16) break;
      size = head.getUint32(8) * 2 ** 32 + head.getUint32(12);
      header = 16;
    } else if (size === 0) size = to - at;
    if (size < header || at + size > to) break;
    found.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return found;
}

/** An MP4/MOV's duration (`mvhd`) and its picture's size (the largest `tkhd` of its tracks). */
async function movieContent(read: Reader, size: number): Promise<VaultFileContent | null> {
  const moov = (await boxes(read, 0, size)).find((box) => box.type === 'moov');
  if (moov === undefined) return null;
  let duration: number | null = null;
  let best: { readonly width: number; readonly height: number } | null = null;
  for (const box of await boxes(read, moov.start, moov.end)) {
    if (box.type === 'mvhd') {
      const head = await read(box.start, 36);
      if (head.byteLength < 36) continue;
      const v1 = head.getUint8(0) === 1;
      const scale = head.getUint32(v1 ? 20 : 12);
      const length = v1 ? head.getUint32(24) * 2 ** 32 + head.getUint32(28) : head.getUint32(16);
      if (scale > 0) duration = length / scale;
    } else if (box.type === 'trak') {
      const tkhd = (await boxes(read, box.start, box.end)).find((inner) => inner.type === 'tkhd');
      if (tkhd === undefined) continue;
      const head = await read(tkhd.start, 96);
      const v1 = head.byteLength > 0 && head.getUint8(0) === 1;
      const at = v1 ? 88 : 76;
      if (head.byteLength < at + 8) continue;
      const found = sides(Math.round(head.getUint32(at) / 65536), Math.round(head.getUint32(at + 4) / 65536));
      if (found !== null && (best === null || found.width * found.height > best.width * best.height)) best = found;
    }
  }
  return best === null ? null : { type: 2, ...best, duration: duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null };
}

/** What `file`'s own bytes say of its content; null — not read (a WebM, a damaged header, another type). */
export async function readVaultFileContent(file: Blob & { readonly name: string }): Promise<VaultFileContent | null> {
  try {
    const read = readerOf(file);
    const head = await read(0, 32);
    if (head.byteLength < 12) return null;
    if (head.getUint16(0) === 0xffd8) {
      const found = await jpegSides(read, file.size);
      return found === null ? null : { type: 1, ...found, duration: null };
    }
    if (head.getUint32(0) === 0x89504e47 && head.byteLength >= 24 && ascii(head, 12, 4) === 'IHDR') {
      const found = sides(head.getUint32(16), head.getUint32(20));
      return found === null ? null : { type: 1, ...found, duration: null };
    }
    if (ascii(head, 0, 4) === 'GIF8') {
      const found = sides(head.getUint16(6, true), head.getUint16(8, true));
      return found === null ? null : { type: 1, ...found, duration: null };
    }
    if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') {
      const found = webpSides(head);
      return found === null ? null : { type: 1, ...found, duration: null };
    }
    // An ISO media file: `ftyp` first (MP4, M4V), or a QuickTime movie that may begin with any of its boxes.
    if (/^(?:ftyp|moov|mdat|wide|free|skip|pnot)$/.test(ascii(head, 4, 4))) return await movieContent(read, file.size);
    return null;
  } catch {
    return null;
  }
}
