// The release tool as a whole, through `runCli` — on a throwaway checkout in a
// scripted world (cli-world.ts). What each part concludes is in its own test
// file; here — what the commands do together: one command releases, a dry run
// touches nothing, two releases never run at once, a run that stopped goes on,
// and rollback and announce leave the machine only with `--confirm`.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BOT_TOKEN, COMMIT_A, COMMIT_B, COMMIT_ELSEWHERE, makeHarness, NEXT, target, VERSION, type Harness } from './cli-world.ts';
import { parseFeed } from './feed.ts';
import { lockMessage } from './lock.ts';

let harness: Harness | null = null;
afterEach(() => {
  harness?.remove();
  harness = null;
});
function world(): Harness {
  harness = makeHarness();
  return harness;
}

/** Every file under a folder with the sha256 of its bytes: what a command may not have changed. */
function snapshot(dir: string, skip: (name: string) => boolean = () => false): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => !skip(name) && statSync(join(dir, name)).isFile())
    .sort()
    .map((name) => `${name} ${createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')}`);
}
/** The tracked files of the checkout a release writes for its build. */
const tree = (h: Harness): string[] => snapshot(h.root, (name) => name.startsWith('.release') || name.startsWith('apps/extension/.output'));

const servedVersion = (h: Harness): string | null => (existsSync(h.remote('firefox/updates.json')) ? parseFeed(readFileSync(h.remote('firefox/updates.json'), 'utf8'), target.geckoId).version : null);
const reachedOut = (h: Harness): string[] => h.commands.filter((line) => /^(?:web-ext |scp |ssh |git push|git tag -a|git tag -f|gh release create)/.test(line));

describe('pnpm release: the whole release in one command', () => {
  it('[UP-001] [UP-002] locks, checks, builds the next version, signs it, publishes it, tags it, makes the GitHub release — and puts the tree back', async () => {
    const h = world();
    const before = tree(h);
    expect(await h.run(), h.err.join('\n')).toBe(0);
    const out = h.out.join('\n');

    expect(out).toContain(`release ${NEXT} from ${COMMIT_B.slice(0, 12)}, 3 commit(s) since v${VERSION}`);
    expect(out).toContain('lock: taken (agent@test/pid1)');
    expect(h.commands.filter((line) => line.startsWith('web-ext sign '))).toHaveLength(1);
    expect(h.commands).toContain('pnpm build');

    // Signed and served: the XPI of NEXT, the feed, the pages of NEXT with its notes.
    const record = JSON.parse(readFileSync(h.path(`.release/${NEXT}/chatgoose-chatspace-${NEXT}.json`), 'utf8')) as { commit: string; version: string; xpi: { sha256: string } };
    expect(record).toMatchObject({ commit: COMMIT_B, version: NEXT });
    expect(parseFeed(readFileSync(h.remote('firefox/updates.json'), 'utf8'), target.geckoId)).toMatchObject({ version: NEXT, sha256: record.xpi.sha256 });
    expect(readFileSync(h.remote('index.html'), 'utf8')).toContain(`<b data-cg="version">${NEXT}</b>`);
    const whatsNew = readFileSync(h.remote('whats-new.html'), 'utf8');
    expect(whatsNew).toContain('Reply drafts keep the last messages.');
    expect(whatsNew).toContain('Spenders opens on the first click.');
    expect(whatsNew).not.toContain('release notes');

    // The tag on the released commit, on origin; the GitHub release with every commit.
    expect(h.world.localTags.get(`v${NEXT}`)).toEqual({ commit: COMMIT_B, annotated: true });
    expect(h.world.originTags.has(`v${NEXT}`)).toBe(true);
    expect(h.world.githubReleases.has(`v${NEXT}`)).toBe(true);
    expect(readFileSync(h.path(`.release/${NEXT}/github-notes.md`), 'utf8')).toContain('- docs: release notes (#241)');
    expect(out).toContain(`released ${NEXT}:`);

    // No PR, no commit: package.json, CHANGELOG.md and the site are as git has them; the lock is gone.
    expect(tree(h)).toEqual(before);
    expect(h.world.originLock).toBeNull();
    expect(out).toContain('lock: released');
    expect(h.posts).toEqual([]);
  });

  it('--dry-run: the checks, the version, the notes and the plan — nothing written, built, signed or published, no lock', async () => {
    const h = world();
    const before = [tree(h), snapshot(h.path('.release')), snapshot(h.remoteDir)];
    expect(await h.run('--dry-run'), h.err.join('\n')).toBe(0);
    const out = h.out.join('\n');
    expect(out).toContain(`release ${NEXT}`);
    expect(out).toContain('lock: free');
    for (const id of ['main-ci', 'tag-free', 'vendor', 'hub-commit', 'hub-compat', 'feed']) expect(out).toMatch(new RegExp(`ok +${id}`));
    expect(out).toContain('  - Reply drafts keep the last messages.');
    expect(out).toContain('[dry-run] 1/');
    expect(h.out.at(-1)).toMatch(/^dry run: nothing was written/);
    expect(reachedOut(h)).toEqual([]);
    expect(h.commands).not.toContain('pnpm build');
    expect([tree(h), snapshot(h.path('.release')), snapshot(h.remoteDir)]).toEqual(before);
  });

  it('minor, major or an exact version; never at or below the last release, never what is not merged, never nothing', async () => {
    const h = world();
    expect(await h.run('minor', '--dry-run')).toBe(0);
    expect(h.out.join('\n')).toMatch(/^release \d+\.\d+\.0 /m);
    h.forget();
    expect(await h.run(VERSION, '--dry-run')).toBe(2);
    expect(h.err.join('\n')).toContain(`is not above the last release v${VERSION}`);
    h.forget();
    expect(await h.run('later')).toBe(2);
    h.world.head = COMMIT_ELSEWHERE;
    h.forget();
    expect(await h.run()).toBe(2);
    expect(h.err.join('\n')).toContain('is not on origin/main');
    h.world.head = COMMIT_B;
    h.world.subjects = [];
    h.forget();
    expect(await h.run()).toBe(2);
    expect(h.err.join('\n')).toContain('nothing to release');
    h.world.porcelain = ' M packages/core/src/a.ts\n';
    h.forget();
    expect(await h.run()).toBe(2);
    expect(h.err.join('\n')).toContain('uncommitted changes');
    expect(reachedOut(h)).toEqual([]);
  });

  it('[UP-003] [UP-004] a red check stops it before the build: main’s CI, an SDK the hub does not take — and the lock is given back', async () => {
    const h = world();
    h.world.mainCi = JSON.stringify({ check_runs: [{ id: 1, name: 'pnpm check', status: 'completed', conclusion: 'success' }, { id: 2, name: 'pnpm e2e', status: 'in_progress', conclusion: null }] });
    expect(await h.run()).toBe(2);
    expect(h.out.join('\n')).toMatch(/FAIL +main-ci .*«pnpm e2e» is in_progress/);
    expect(h.err.join('\n')).toContain('not released: main-ci failed');
    expect(h.commands).not.toContain('pnpm build');
    expect(h.world.originLock).toBeNull();

    const other = world();
    other.world.health = { status: 200, body: JSON.stringify({ status: 'ok', contractHash: 'd'.repeat(64), compatibleClientSdks: ['d'.repeat(64)] }) };
    expect(await other.run()).toBe(2);
    expect(other.err.join('\n')).toContain('hub-compat');
    expect(reachedOut(other).filter((line) => !line.startsWith('git push --quiet origin') && !line.startsWith('git tag -f'))).toEqual([]);
  });
});

describe('one release at a time', () => {
  it('a second session finds the lock on origin and stops at once, saying who has it and since when; unlock frees a dead one', async () => {
    const h = world();
    h.world.originLock = lockMessage({ version: NEXT, by: 'dmitriy@mac/pid42', at: '2026-10-20T10:00:00.000Z' });
    expect(await h.run()).toBe(2);
    expect(h.err.join('\n')).toContain(`another release is under way: dmitriy@mac/pid42, releasing ${NEXT} since 2026-10-20T10:00:00.000Z`);
    expect(h.commands.filter((line) => line.startsWith('gh ') || line.startsWith('web-ext') || line === 'pnpm build')).toEqual([]);
    expect(h.world.originLock).not.toBeNull();

    h.forget();
    expect(await h.run('--dry-run')).toBe(0);
    expect(h.out.join('\n')).toContain('lock: TAKEN — dmitriy@mac/pid42');

    h.forget();
    expect(await h.run('unlock')).toBe(0);
    expect(h.world.originLock).toBeNull();
    expect(await h.run()).toBe(0);
  });
});

describe('a run that stopped goes on from where it stopped', () => {
  it('the tag push failed after the feed moved: the next run signs nothing again, publishes nothing twice, pushes the tag', async () => {
    const h = world();
    // The lock goes to origin first: let it through, fail the tag.
    const real = h.deps.exec;
    let failTag = true;
    (h.deps as { exec: typeof real }).exec = (spec) => {
      if (spec.program === 'git' && spec.args.join(' ') === `push origin v${NEXT}` && failTag) return Promise.resolve({ code: 128, stdout: '', stderr: 'fatal: unable to access the remote' });
      return real(spec);
    };
    expect(await h.run()).toBe(1);
    expect(h.err.join('\n')).toContain(`git push origin v${NEXT} failed`);
    expect(servedVersion(h)).toBe(NEXT);
    expect(h.world.localTags.has(`v${NEXT}`)).toBe(false);
    expect(h.world.originLock).toBeNull();

    failTag = false;
    h.forget();
    expect(await h.run(), h.err.join('\n')).toBe(0);
    expect(h.out.join('\n')).toContain('signed earlier');
    expect(h.out.join('\n')).toMatch(/ok +feed +the feed already serves .* an earlier run published it/);
    expect(h.commands.filter((line) => line.startsWith('web-ext '))).toEqual([]);
    expect(h.world.originTags.has(`v${NEXT}`)).toBe(true);
    expect(h.world.githubReleases.has(`v${NEXT}`)).toBe(true);
  });

  it('AMO signed late: sign --import takes the downloaded file, the next run publishes it; a different version waits for the unfinished one', async () => {
    const h = world();
    h.world.signExit = 1;
    expect(await h.run()).toBe(1);
    expect(existsSync(h.path(`.release/${NEXT}/submitted.json`))).toBe(true);
    expect(servedVersion(h)).toBeNull();

    h.forget();
    expect(await h.run('minor')).toBe(2);
    expect(h.err.join('\n')).toContain(`${NEXT} was signed or sent to AMO from this checkout and never tagged`);

    const downloaded = h.path('downloaded.xpi');
    writeFileSync(downloaded, h.signedXpi(NEXT));
    h.forget();
    expect(await h.run('sign', '--import', downloaded), h.err.join('\n')).toBe(0);
    expect(h.out.at(-1)).toBe(`Next: pnpm release ${NEXT}`);

    h.forget();
    expect(await h.run(NEXT), h.err.join('\n')).toBe(0);
    expect(h.commands.filter((line) => line.startsWith('web-ext '))).toEqual([]);
    expect(servedVersion(h)).toBe(NEXT);
  });
});

describe('rollback and announce leave the machine only with --confirm <version>', () => {
  it('without it they print the plan and reach nothing; a secret is named, never printed', async () => {
    const h = world();
    expect(await h.run()).toBe(0);
    for (const argv of [['rollback', '--to', VERSION], ['announce']]) {
      for (const flags of [[], ['--dry-run'], ['--confirm', '9.9.9']]) {
        h.forget();
        const code = await h.run(...argv, ...flags);
        expect(code, `${argv.join(' ')} ${flags.join(' ')}`).toBe(flags[0] === '--dry-run' ? 0 : 2);
        expect(h.out.join('\n')).toContain('[dry-run] 1/');
        expect(h.requests).toEqual([]);
        expect(h.posts).toEqual([]);
        expect(reachedOut(h)).toEqual([]);
      }
    }
    const printed = [...h.out, ...h.err].join('\n');
    expect(printed).not.toContain(BOT_TOKEN);
    expect(printed).not.toContain('synthetic-amo-secret');
    expect(printed).toContain('bot<TELEGRAM_BOT_TOKEN>');
  });

  it('[UP-005] announce posts the notes of the last release once; --again posts once more', async () => {
    const h = world();
    expect(await h.run()).toBe(0);
    h.forget();
    h.world.telegram.push({ status: 200, body: { ok: true, result: { message_id: 7 } } });
    expect(await h.run('announce', '--confirm', NEXT), h.err.join('\n')).toBe(0);
    expect(h.posts).toHaveLength(1);
    expect(JSON.stringify(h.posts[0]?.body)).toContain('Reply drafts keep the last messages.');
    h.forget();
    expect(await h.run('announce', '--confirm', NEXT)).toBe(2);
    expect(h.err.join('\n')).toContain('already announced');
    h.forget();
    h.world.telegram.push({ status: 200, body: { ok: true, result: { message_id: 8 } } });
    expect(await h.run('announce', '--confirm', NEXT, '--again')).toBe(0);
    expect(h.posts).toHaveLength(1);
  });

  it('rollback points the feed back at the earlier version from its record on the server', async () => {
    const h = world();
    h.world.head = COMMIT_A;
    h.world.main = [COMMIT_A];
    h.world.localTags.clear();
    h.world.originTags.clear();
    expect(await h.run(VERSION), h.err.join('\n')).toBe(0);
    h.world.head = COMMIT_B;
    h.world.main = [COMMIT_A, COMMIT_B];
    h.forget();
    expect(await h.run(), h.err.join('\n')).toBe(0);
    expect(servedVersion(h)).toBe(NEXT);
    h.forget();
    expect(await h.run('rollback', '--to', VERSION, '--confirm', VERSION), h.err.join('\n')).toBe(0);
    expect(servedVersion(h)).toBe(VERSION);
  });
});
