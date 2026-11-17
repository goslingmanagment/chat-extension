// The release tool through `runCli`, on a throwaway checkout in a scripted world
// (cli-world.ts): what keeps the chatters' channel and the files on the server
// safe — the post goes out last and once and never undoes a release, and a
// version signed before the rename keeps its file names.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { COMMIT_A, COMMIT_B, makeHarness, target, VERSION, type Harness } from './cli-world.ts';
import { ENV, LEGACY_ARTIFACT_PREFIX } from './config.ts';
import { parseFeed } from './feed.ts';
import { bumpVersion } from './version.ts';
import { sha256Hex } from './xpi.ts';

let harness: Harness | null = null;
afterEach(() => {
  harness?.remove();
  harness = null;
});

/** The header of a PNG: all of it the post reads. */
const png = (width: number, height: number): Buffer => {
  const data = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'latin1');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
};

/** A world whose HEAD adds one note of `kind` with a screenshot; the last release is `latest`. */
function world(kind: 'new' | 'fixed', latest = VERSION): Harness {
  const h = makeHarness();
  harness = h;
  const put = (relative: string, data: string | Buffer): void => {
    mkdirSync(dirname(h.path(relative)), { recursive: true });
    writeFileSync(h.path(relative), data);
  };
  put(`changes/${kind}-note.md`, ['---', `kind: ${kind}`, 'sites: chatspace, fansly', '---', '', '# Spenders показывает всех платящих', '', 'Для чаттеров: видно всех, кто платил.', '', `![Spenders со всеми платящими](${kind}-note.png)`, '', '## Как это устроено', '', 'Две доски хаба.', ''].join('\n'));
  put(`changes/${kind}-note.png`, png(1440, 900));
  h.world.added.set(COMMIT_B, [`changes/${kind}-note.md`, `changes/${kind}-note.png`]);
  h.world.localTags = new Map([[`v${latest}`, { commit: COMMIT_A, annotated: true }]]);
  h.world.originTags = new Set([`v${latest}`]);
  return h;
}

const announced = (h: Harness, version: string): unknown => JSON.parse(readFileSync(h.path(`.release/${version}/announced.json`), 'utf8'));
/** What would be a release: a build, AMO, the server, a version tag, the GitHub release (the lock aside). */
const sentNothing = (h: Harness): string[] => h.commands.filter((line) => /^(?:pnpm build|web-ext |scp |ssh |git tag -a|git push origin v|gh release create)/.test(line));

describe('the post: the last step of a release from 3.0.0', () => {
  it('an indeterminate send is said and never retried — the release stands', async () => {
    const h = world('fixed', '3.0.0');
    h.world.telegram = [new Error('connect ECONNRESET')];
    expect(await h.run(), h.err.join('\n')).toBe(0);
    expect(h.world.originTags.has('v3.0.1')).toBe(true);
    expect(h.world.githubReleases.has('v3.0.1')).toBe(true);
    expect(h.posts).toHaveLength(1);
    // A fix alone: no notification.
    expect(h.posts[0]?.fields['disable_notification']).toBe('true');
    expect(h.out.find((line) => line.startsWith('post: '))).toMatch(
      /^post: UNKNOWN whether it reached the channel — transport failure \(connect ECONNRESET\).* The release stands\. Look at the channel first; only if the post is not there: pnpm release announce --confirm 3\.0\.1 --again$/,
    );
    expect(announced(h, '3.0.1')).toMatchObject({ state: 'indeterminate' });
    expect(h.world.originLock).toBeNull();

    // Once per version: a post that may have gone out is not sent again by hand without --again.
    h.forget();
    expect(await h.run('announce', '--confirm', '3.0.1')).toBe(2);
    expect(h.err.join('\n')).toContain('may have reached the channel');
    expect(h.posts).toEqual([]);
  });

  it('--no-announce skips it; a missing key stops the release before anything is done', async () => {
    const h = world('fixed', '3.0.0');
    (h.deps.env as Record<string, string | undefined>)[ENV.telegramChannel] = undefined;
    expect(await h.run()).toBe(2);
    expect(h.out).toContainEqual(expect.stringMatching(/^FAIL {2}post {8}the post cannot go out: TELEGRAM_CHANNEL_ID is not set .* --no-announce$/));
    expect(h.err).toEqual(['release: not released: post failed.']);
    expect(sentNothing(h)).toEqual([]);

    h.forget();
    expect(await h.run('--no-announce'), h.err.join('\n')).toBe(0);
    expect(h.out).toContain('post: none — --no-announce — later, by hand: pnpm release announce --confirm 3.0.1');
    expect(h.posts).toEqual([]);
    expect(existsSync(h.path('.release/3.0.1/announced.json'))).toBe(false);
  });
});

describe('a version signed before the rename', () => {
  it('rollback finds its record and XPI under the old names', async () => {
    const h = world('new');
    const next = bumpVersion(VERSION, 'minor');
    expect(await h.run(), h.err.join('\n')).toBe(0);
    expect(existsSync(h.remote(`firefox/chatgoose-${next}.xpi`))).toBe(true);
    // What the server has of VERSION since before the rename.
    const xpi = h.signedXpi(VERSION);
    const legacy = `${LEGACY_ARTIFACT_PREFIX}${VERSION}.xpi`;
    writeFileSync(h.remote(`firefox/${legacy}`), xpi);
    const record = {
      schema: 1,
      version: VERSION,
      geckoId: target.geckoId,
      strictMinVersion: target.strictMinVersion,
      commit: COMMIT_A,
      signedAt: '2026-10-20T10:00:00.000Z',
      xpi: { file: legacy, sha256: sha256Hex(xpi), bytes: xpi.length },
      unsignedXpiSha256: 'a'.repeat(64),
      sourcesSha256: 'b'.repeat(64),
      vendor: { sdkContractHash: 'c'.repeat(64), sdkSourceCommit: 'e'.repeat(40), hotkeysSha256: 'f'.repeat(64) },
    };
    writeFileSync(h.remote(`firefox/${LEGACY_ARTIFACT_PREFIX}${VERSION}.json`), JSON.stringify(record));

    h.forget();
    expect(await h.run('rollback', '--to', VERSION, '--confirm', VERSION), h.err.join('\n')).toBe(0);
    expect(parseFeed(readFileSync(h.remote('firefox/updates.json'), 'utf8'), target.geckoId)).toMatchObject({ version: VERSION, updateLink: `${target.feedBase}${legacy}` });
    expect(h.requests).toContain(`${target.feedBase}chatgoose-${VERSION}.json`);
    expect(h.requests).toContain(`${target.feedBase}${LEGACY_ARTIFACT_PREFIX}${VERSION}.json`);
  });
});
