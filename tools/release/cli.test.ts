// The release tool through `runCli`, on a throwaway checkout in a scripted world
// (cli-world.ts): what keeps the launch, the chatters' channel and the files on
// the server safe — the 3.0 site goes out only as 3.0.0 and only on the owner's
// word, the post goes out last and once and never undoes a release, and a version
// signed before the rename keeps its file names.

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

/** site/index.html declares the first version its pages belong to (site.ts). */
function declareLaunch(h: Harness, version: string): void {
  const path = h.path('site/index.html');
  writeFileSync(path, readFileSync(path, 'utf8').replace('<meta charset="utf-8">\n', `<meta charset="utf-8">\n  <meta name="cg-first-version" content="${version}">\n`));
}

const LAUNCH = "release: site/ is the 3.0.0 launch (cg-first-version in index.html): the next release is 3.0.0 — pnpm release 3.0.0 --confirm 3.0.0, on the owner's word";
const announced = (h: Harness, version: string): unknown => JSON.parse(readFileSync(h.path(`.release/${version}/announced.json`), 'utf8'));
/** What would be a release: a build, AMO, the server, a version tag, the GitHub release (the lock aside). */
const sentNothing = (h: Harness): string[] => h.commands.filter((line) => /^(?:pnpm build|web-ext |scp |ssh |git tag -a|git push origin v|gh release create)/.test(line));

describe('the 3.0 launch: a site that declares a later first version', () => {
  it('stops pnpm release, its dry run and a lower version with one line; pnpm release notes says the same', async () => {
    const h = world('new');
    declareLaunch(h, '3.0.0');
    expect(await h.run()).toBe(2);
    expect(h.err).toEqual([LAUNCH]);
    h.forget();
    expect(await h.run('--dry-run')).toBe(2);
    expect(h.err).toEqual([LAUNCH]);
    h.forget();
    // The notes give a minor; a patch, even with a confirmation, would publish the launch pages under it.
    expect(await h.run('patch', '--confirm', bumpVersion(VERSION, 'patch'))).toBe(2);
    expect(h.err).toEqual([`release: ${bumpVersion(VERSION, 'patch')} would publish the pages of 3.0.0 early — ${LAUNCH.slice('release: '.length)}`]);
    expect(sentNothing(h)).toEqual([]);
    expect(h.world.originLock).toBeNull();

    h.forget();
    expect(await h.run('notes')).toBe(0);
    expect(h.out).toContain(`next release: 3.0.0 (the launch; by the notes alone ${bumpVersion(VERSION, 'minor')})`);
    expect(h.out).toContain(LAUNCH.slice('release: '.length));
  });

  it('a declaration not written exactly stops the release instead of letting it through', async () => {
    const h = world('new');
    declareLaunch(h, '3.0');
    expect(await h.run('--dry-run')).toBe(2);
    expect(h.err).toEqual(['release: site/ declares its first version wrongly:\n  index.html: «<meta name="cg-first-version" content="3.0">» — a page declares its first version as <meta name="cg-first-version" content="X.Y.Z">']);
  });

  it('the launch version itself needs the owner’s word; with it the release goes through and posts once, last', async () => {
    const h = world('new');
    declareLaunch(h, '3.0.0');
    expect(await h.run('3.0.0')).toBe(2);
    expect(h.err.join('\n')).toContain("3.0.0 is the launch site/ declares: a major or a chosen version is the owner's call. With the owner's word: pnpm release 3.0.0 --confirm 3.0.0");

    h.forget();
    expect(await h.run('3.0.0', '--dry-run'), h.err.join('\n')).toBe(0);
    expect(h.out).toContain("note: 3.0.0 is the launch site/ declares: a major or a chosen version is the owner's call — a real run needs --confirm 3.0.0.");
    expect(h.out.find((line) => line.includes(' post '))).toMatch(/^ok {4}post {8}to TELEGRAM_CHANNEL_ID as the last step — 1 note\(s\), 1 screenshot\(s\) uploaded with it \(0\.0 MB\), \d+ characters, \d+ blocks; with a notification — something new$/);
    expect(h.out).toContainEqual(expect.stringMatching(/^plan: post 3\.0\.0 to the chatters' channel TELEGRAM_CHANNEL_ID last/));
    expect(h.posts).toEqual([]);

    h.forget();
    h.world.telegram = [{ status: 200, body: { ok: true, result: { message_id: 42 } } }];
    expect(await h.run('3.0.0', '--confirm', '3.0.0'), h.err.join('\n')).toBe(0);
    // Released under the new names, the install link too.
    expect(parseFeed(readFileSync(h.remote('firefox/updates.json'), 'utf8'), target.geckoId).updateLink).toBe(`${target.feedBase}chatgoose-3.0.0.xpi`);
    expect(existsSync(h.remote('firefox/chatgoose-3.0.0.json'))).toBe(true);
    expect(readFileSync(h.remote('index.html'), 'utf8')).toContain('href="firefox/chatgoose-3.0.0.xpi"');
    expect(existsSync(h.remote('404.html'))).toBe(true);
    // The post: after the tag and the GitHub release, once, with its screenshot in the request, ringing (something new).
    expect(h.world.githubReleases.has('v3.0.0')).toBe(true);
    expect(h.out.findIndex((line) => line.startsWith('post: '))).toBeGreaterThan(h.out.findIndex((line) => line.startsWith('released 3.0.0: ')));
    expect(h.out).toContain('post: in the channel (message 42), with a notification');
    expect(h.posts).toHaveLength(1);
    const [post] = h.posts;
    expect(post?.fields['chat_id']).toBe('-100200300');
    expect(post?.fields['disable_notification']).toBe('false');
    const rich = JSON.parse(post?.fields['rich_message'] ?? '{}') as { html: string; media: unknown };
    expect(rich.html).toContain('<h1>ChatGoose 3.0.0</h1>');
    expect(rich.html).toContain('<figure><img src="tg://photo?id=shot-1"/><figcaption>Spenders со всеми платящими</figcaption></figure>');
    expect(rich.media).toEqual([{ id: 'shot-1', media: { type: 'photo', media: 'attach://shot-1' } }]);
    expect(post?.files['shot-1']).toEqual({ name: 'new-note.png', type: 'image/png', bytes: 33 });
    expect(announced(h, '3.0.0')).toMatchObject({ state: 'posted', messageId: 42 });

    // Once per version: by hand it asks for --again.
    h.forget();
    h.world.feed = { status: 200, body: readFileSync(h.remote('firefox/updates.json'), 'utf8') };
    expect(await h.run('announce', '--confirm', '3.0.0')).toBe(2);
    expect(h.err.join('\n')).toContain('3.0.0 was already announced');
    expect(h.posts).toEqual([]);
  });
});

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

  it('below 3.0.0 nothing is posted', async () => {
    const h = world('new');
    const next = bumpVersion(VERSION, 'minor');
    expect(await h.run(), h.err.join('\n')).toBe(0);
    expect(h.out).toContain(`post: none — ${next} is below 3.0.0: the channel hears of the one extension from its launch on`);
    expect(h.posts).toEqual([]);
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
