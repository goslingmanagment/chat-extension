import { describe, expect, it } from 'vitest';

import { GECKO_ID, STRICT_MIN_VERSION, UPDATE_URL } from '../../apps/extension/build/manifest.ts';
import { releaseTarget, signedXpiNames } from './config.ts';
import { feedDifferences, feedEntryFor, parseFeed, renderFeed } from './feed.ts';
import { parseReleaseRecord } from './records.ts';

const SHA = 'a'.repeat(64);
const target = releaseTarget();

describe('the update feed', () => {
  it('[UP-001] lies where the built manifest looks for it, next to the XPI it names', () => {
    expect(target.feedUrl).toBe(UPDATE_URL);
    expect(target.geckoId).toBe(GECKO_ID);
    const entry = feedEntryFor(target, '0.1.0', SHA);
    expect(entry.updateLink).toBe(`${UPDATE_URL.slice(0, UPDATE_URL.lastIndexOf('/') + 1)}chatgoose-0.1.0.xpi`);
    expect(entry.updateLink.startsWith('https://')).toBe(true);
  });

  it('[UP-001] [UP-010] is the document Firefox reads: one update with the link, the hash and the oldest Firefox', () => {
    const text = renderFeed(GECKO_ID, feedEntryFor(target, '0.1.0', SHA));
    expect(JSON.parse(text)).toEqual({
      addons: {
        [GECKO_ID]: {
          updates: [
            {
              version: '0.1.0',
              update_link: `${target.feedBase}chatgoose-0.1.0.xpi`,
              update_hash: `sha256:${SHA}`,
              applications: { gecko: { strict_min_version: STRICT_MIN_VERSION } },
            },
          ],
        },
      },
    });
    expect(text.endsWith('}\n')).toBe(true);
    expect(parseFeed(text, GECKO_ID)).toEqual(feedEntryFor(target, '0.1.0', SHA));
  });

  it('a version signed before the rename keeps its old file name — from its record, never from the new prefix', () => {
    expect(signedXpiNames('0.10.5')).toEqual(['chatgoose-0.10.5.xpi', 'chatgoose-chatspace-0.10.5.xpi']);
    expect(feedEntryFor(target, '0.10.5', SHA, 'chatgoose-chatspace-0.10.5.xpi').updateLink).toBe(`${target.feedBase}chatgoose-chatspace-0.10.5.xpi`);
    expect(() => feedEntryFor(target, '0.10.5', SHA, 'chatgoose-chatspace-0.10.4.xpi')).toThrow(/no name of the signed XPI of 0\.10\.5/);
    const record = (file: string): string =>
      JSON.stringify({
        schema: 1,
        version: '0.10.5',
        geckoId: GECKO_ID,
        strictMinVersion: STRICT_MIN_VERSION,
        commit: 'a'.repeat(40),
        signedAt: '2026-10-24T10:00:00.000Z',
        xpi: { file, sha256: SHA, bytes: 10 },
        unsignedXpiSha256: SHA,
        sourcesSha256: SHA,
        vendor: { sdkContractHash: SHA, sdkSourceCommit: 'e'.repeat(40), hotkeysSha256: SHA },
      });
    expect(parseReleaseRecord(record('chatgoose-chatspace-0.10.5.xpi')).xpi.file).toBe('chatgoose-chatspace-0.10.5.xpi');
    expect(parseReleaseRecord(record('chatgoose-0.10.5.xpi')).xpi.file).toBe('chatgoose-0.10.5.xpi');
    expect(() => parseReleaseRecord(record('chatgoose-0.10.4.xpi'))).toThrow(/chatgoose-0\.10\.5\.xpi or chatgoose-chatspace-0\.10\.5\.xpi is expected/);
  });

  it('says what differs between the served feed and the meant one', () => {
    const meant = feedEntryFor(target, '0.1.1', SHA);
    expect(feedDifferences(meant, meant)).toEqual([]);
    expect(feedDifferences(feedEntryFor(target, '0.1.0', 'b'.repeat(64)), meant)).toEqual([
      'version 0.1.0, expected 0.1.1',
      `update_link ${target.feedBase}chatgoose-0.1.0.xpi, expected ${target.feedBase}chatgoose-0.1.1.xpi`,
      `update_hash sha256:${'b'.repeat(64)}, expected sha256:${SHA}`,
    ]);
  });

  it('refuses a feed it cannot vouch for', () => {
    const good = JSON.parse(renderFeed(GECKO_ID, feedEntryFor(target, '0.1.0', SHA))) as { addons: Record<string, { updates: Array<Record<string, unknown>> }> };
    const withUpdate = (change: Record<string, unknown>): string => JSON.stringify({ addons: { [GECKO_ID]: { updates: [{ ...good.addons[GECKO_ID]?.updates[0], ...change }] } } });
    expect(() => parseFeed('<html>', GECKO_ID)).toThrow(/not JSON/);
    expect(() => parseFeed('{"addons":{}}', GECKO_ID)).toThrow(/no entry for/);
    expect(() => parseFeed(JSON.stringify({ addons: { [GECKO_ID]: { updates: [] } } }), GECKO_ID)).toThrow(/exactly one update/);
    expect(() => parseFeed(withUpdate({ version: '1.0' }), GECKO_ID)).toThrow(/not X\.Y\.Z/);
    expect(() => parseFeed(withUpdate({ update_link: 'http://example.test/a.xpi' }), GECKO_ID)).toThrow(/not an https address/);
    expect(() => parseFeed(withUpdate({ update_hash: SHA }), GECKO_ID)).toThrow(/not sha256:<hex>/);
    expect(() => parseFeed(withUpdate({ applications: {} }), GECKO_ID)).toThrow(/strict_min_version/);
    expect(() => feedEntryFor(target, '1.0', SHA)).toThrow(/not a version/);
    expect(() => feedEntryFor(target, '1.0.0', 'abc')).toThrow(/not a sha256/);
  });
});
