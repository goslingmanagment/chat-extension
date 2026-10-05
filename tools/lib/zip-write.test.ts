import { describe, expect, it } from 'vitest';

import { writeZip } from './zip-write.ts';
import { readZip } from './zip.ts';

describe('writeZip', () => {
  it('writes what readZip reads back: names (UTF-8 too), bytes, order', () => {
    const entries = [
      { name: 'manifest.json', data: Buffer.from('{"version":"1.2.3"}') },
      { name: 'lazy/док.js', data: Buffer.from('console.log("привет")') },
      { name: 'empty.txt', data: Buffer.alloc(0) },
      { name: 'big.bin', data: Buffer.alloc(70_000, 0x61) },
    ];
    expect(readZip(writeZip(entries))).toEqual(entries);
  });

  it('an empty archive is still an archive', () => {
    expect(readZip(writeZip([]))).toEqual([]);
  });
});
