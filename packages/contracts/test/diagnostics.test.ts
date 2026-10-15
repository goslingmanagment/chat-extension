import { describe, expect, it } from 'vitest';
import { PageDiagnosticsSchema, NetworkSessionSnapshotSchema, FreshnessDaySchema } from '../src/diagnostics';
import { GenerationDebugSchema } from '../src/ops';
import { pageDiagnostics, networkSession, freshness, generation } from './fixtures/diagnostics';

describe('P14b2 additive local projections [host:fansly]', () => {
  it('[ST-031] only bounded counters and booleans cross from MAIN', () => {
    expect(PageDiagnosticsSchema.safeParse(pageDiagnostics).success).toBe(true);
    expect(PageDiagnosticsSchema.safeParse({ ...pageDiagnostics, companion: { ...pageDiagnostics.companion, words: ['secret'] } }).success).toBe(false);
  });
  it('[LG-026] session values, tokens and cookies are not page fields', () => {
    expect(NetworkSessionSnapshotSchema.safeParse(networkSession).success).toBe(true);
    for (const key of ['headers', 'token', 'cookie', 'authorization']) expect(NetworkSessionSnapshotSchema.safeParse({ ...networkSession, [key]: 'secret' }).success).toBe(false);
    expect(NetworkSessionSnapshotSchema.safeParse({ ...networkSession, headerNames: ['Authorization: secret'] }).success).toBe(false);
  });
  it('[FS-TAIL-9] bounds the local day', () => {
    expect(FreshnessDaySchema.safeParse(freshness).success).toBe(true);
    expect(FreshnessDaySchema.safeParse({ ...freshness, rows: Array(129).fill(freshness.rows[0]) }).success).toBe(false);
  });
  it('[DB-009] generation coverage is typed, including per-id answers', () => {
    expect(GenerationDebugSchema.safeParse(generation).success).toBe(true);
    expect(GenerationDebugSchema.safeParse({ ...generation, served: { ...generation.served, coverageCheck: { window: [{ id: '10001', state: 'invented' }], deleted: [] } } }).success).toBe(false);
  });
});
