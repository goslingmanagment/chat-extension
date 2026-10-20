import { describe, expect, it } from 'vitest';

import { importProblems, parseAnnouncedRecord, parseGateRecord, parseReleaseRecord, releasePaths, type GateRecord, type ReleaseRecord } from './records.ts';

const SHA = (letter: string): string => letter.repeat(64);
const COMMIT = 'd'.repeat(40);
const vendor = { sdkContractHash: SHA('c'), sdkSourceCommit: 'e'.repeat(40), hotkeysSha256: SHA('f') };

const gate: GateRecord = {
  schema: 1,
  version: '0.1.0',
  commit: COMMIT,
  createdAt: '2026-10-05T11:00:00.000Z',
  online: true,
  checks: [
    { id: 'branch', ok: true, detail: 'on main' },
    { id: 'check', ok: true, detail: 'pnpm check is green' },
  ],
  build: { xpi: { file: 'chatgoose-chatspace-0.1.0-firefox.zip', sha256: SHA('a'), bytes: 100 }, sources: { file: 'chatgoose-chatspace-0.1.0-sources.zip', sha256: SHA('b'), bytes: 200 } },
  vendor,
};
const context = { version: '0.1.0', xpiSha256: SHA('a'), sourcesSha256: SHA('b') };

const record: ReleaseRecord = {
  schema: 1,
  version: '0.1.0',
  geckoId: 'chat-extension@example.test',
  strictMinVersion: '142.0',
  commit: COMMIT,
  signedAt: '2026-10-05T11:30:00.000Z',
  xpi: { file: 'chatgoose-chatspace-0.1.0.xpi', sha256: SHA('9'), bytes: 300 },
  unsignedXpiSha256: SHA('a'),
  sourcesSha256: SHA('b'),
  vendor,
};

describe('the records of a release', () => {
  it('a gate record reads back as written', () => {
    expect(parseGateRecord(JSON.stringify(gate))).toEqual(gate);
  });

  it('a signed XPI downloaded by hand is taken under the gate of its submission, however old: what counts is that it passed, for this build', () => {
    const building = context;
    // No clock and no HEAD in the question at all: the file is signed already.
    expect(importProblems(gate, building)).toEqual([]);
    expect(importProblems({ ...gate, createdAt: '2026-01-01T00:00:00.000Z' }, building)).toEqual([]);
    expect(importProblems({ ...gate, online: false }, building)).toEqual(['the checks of that run were not made online']);
    expect(importProblems({ ...gate, checks: [{ id: 'pushed', ok: false, detail: 'x' }] }, building)).toEqual(['the gate did not pass: pushed']);
    expect(importProblems(gate, { ...building, version: '0.1.1' })[0]).toMatch(/gate is for 0\.1\.0, the tree holds 0\.1\.1/);
    expect(importProblems(gate, { ...building, xpiSha256: SHA('0') })).toEqual(['the release XPI in .output/ is not the one the gate checked — the build in .output/ must be the one sent to AMO (from dddddddddddd)']);
    expect(importProblems(gate, { ...building, sourcesSha256: SHA('0') })[0]).toMatch(/sources archive .* sent to AMO/);
  });

  it('the record of an announcement says what is known of the send', () => {
    const posted = { schema: 1, version: '0.1.0', state: 'posted', at: '2026-10-05T12:00:00.000Z', messageId: 7 };
    expect(parseAnnouncedRecord(JSON.stringify(posted))).toEqual(posted);
    expect(parseAnnouncedRecord(JSON.stringify({ ...posted, state: 'sending', messageId: undefined }))).toMatchObject({ state: 'sending', messageId: null });
    expect(() => parseAnnouncedRecord(JSON.stringify({ ...posted, state: 'maybe' }))).toThrow(/announcement record/);
    expect(() => parseAnnouncedRecord('')).toThrow(/not JSON/);
  });

  it('a release record read back from a file or from the server must be whole', () => {
    expect(parseReleaseRecord(JSON.stringify(record))).toEqual(record);
    const broken = (change: Record<string, unknown>): (() => unknown) => () => parseReleaseRecord(JSON.stringify({ ...record, ...change }));
    expect(() => parseReleaseRecord('<html>404</html>')).toThrow(/not JSON/);
    expect(() => parseReleaseRecord('null')).toThrow(/not an object/);
    expect(broken({ schema: 2 })).toThrow(/reads schema 1/);
    expect(broken({ version: '1.0' })).toThrow(/version: not X\.Y\.Z/);
    expect(broken({ commit: 'abc' })).toThrow(/commit: not a full commit/);
    expect(broken({ xpi: { ...record.xpi, sha256: 'abc' } })).toThrow(/xpi\.sha256/);
    expect(broken({ xpi: { ...record.xpi, file: '../../etc/passwd' } })).toThrow(/plain file name/);
    expect(broken({ xpi: { ...record.xpi, file: 'other-0.1.0.xpi' } })).toThrow(/chatgoose-chatspace-0\.1\.0\.xpi is expected/);
    expect(broken({ vendor: { ...vendor, sdkSourceCommit: `${'e'.repeat(40)}-dirty` } })).toThrow(/sdkSourceCommit/);
    expect(() => parseGateRecord(JSON.stringify({ ...gate, checks: [{ id: 'x' }] }))).toThrow(/checks:/);
  });

  it('everything of a version lies under .release/<version>/, the XPI and the record under their public names', () => {
    expect(releasePaths('/repo/', '0.1.0')).toEqual({
      dir: '/repo/.release/0.1.0',
      gate: '/repo/.release/0.1.0/gate.json',
      submitted: '/repo/.release/0.1.0/submitted.json',
      record: '/repo/.release/0.1.0/chatgoose-chatspace-0.1.0.json',
      signedXpi: '/repo/.release/0.1.0/chatgoose-chatspace-0.1.0.xpi',
      amoMetadata: '/repo/.release/0.1.0/amo-metadata.json',
      announced: '/repo/.release/0.1.0/announced.json',
    });
  });
});
