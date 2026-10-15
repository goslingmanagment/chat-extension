import { describe, expect, it } from 'vitest';
import { fanslyIdTimestampMs } from './snowflake';

const EPOCH = 1561494360000;
const date = Date.parse('2026-04-28T12:34:56.789Z');
const id = ((BigInt(date - EPOCH) << 22n) + 4194303n).toString();

describe('Fansly account snowflakes', () => {
  it('[FS-REG-2] retains milliseconds above 2^53 and ignores all 22 low bits', () => {
    expect(fanslyIdTimestampMs(id, date)).toBe(date);
    expect(fanslyIdTimestampMs((BigInt(id) - 4194303n).toString(), date)).toBe(date);
    expect(fanslyIdTimestampMs('4194304', date)).toBe(EPOCH + 1);
  });
  it('[FS-REG-2] refuses invalid, epoch, unsafe and future IDs; allows one minute of clock skew', () => {
    for (const bad of ['', '0', '-1', '1.2', '01', ' 4194304', '1e18', '9'.repeat(25), '4194303', '9'.repeat(24)]) expect(fanslyIdTimestampMs(bad, date)).toBeNull();
    expect(fanslyIdTimestampMs(id, date - 60_000)).toBe(date);
    expect(fanslyIdTimestampMs(id, date - 60_001)).toBeNull();
  });
});
