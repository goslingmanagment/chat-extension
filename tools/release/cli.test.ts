// The release tool as a whole, command by command, through `runCli` — on a
// throwaway checkout in a scripted world (cli-world.ts). What each part
// concludes is in its own test file; here — what the commands do together:
// that nothing leaves the machine without the owner's `--confirm`, and that a
// release goes through from the gate to the announcement.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BOT_TOKEN, COMMIT_A, makeHarness, target, VERSION, type Harness } from './cli-world.ts';
import { parseFeed } from './feed.ts';

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
function snapshot(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort()
    .map((name) => `${name} ${createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')}`);
}

/** A checkout whose release is signed, published, tagged — every outward command could run again for real. */
async function released(): Promise<Harness> {
  const h = world();
  expect(await h.run('preflight', '--online')).toBe(0);
  expect(await h.run('sign', '--confirm', VERSION)).toBe(0);
  expect(await h.run('publish', '--confirm', VERSION)).toBe(0);
  h.forget();
  return h;
}

/** What a plan may run: questions to the local git and to pnpm about itself. */
const LOCAL_READ = /^(?:git (?:rev-parse|status --porcelain|cat-file)\b|pnpm --version$)/;

const OUTWARD_COMMANDS: ReadonlyArray<{ readonly name: string; readonly argv: readonly string[]; readonly confirm: string }> = [
  { name: 'sign', argv: ['sign'], confirm: VERSION },
  { name: 'publish', argv: ['publish'], confirm: VERSION },
  { name: 'pages', argv: ['pages'], confirm: VERSION },
  { name: 'pages --versionless', argv: ['pages', '--versionless'], confirm: VERSION },
  { name: 'tag', argv: ['tag'], confirm: VERSION },
  { name: 'announce', argv: ['announce'], confirm: VERSION },
  { name: 'rollback', argv: ['rollback', '--to', '0.0.9'], confirm: '0.0.9' },
];

const WITHOUT_THE_WORD: ReadonlyArray<{ readonly name: string; readonly flags: (confirm: string) => string[]; readonly code: number }> = [
  { name: 'without --confirm', flags: () => [], code: 2 },
  { name: 'with --dry-run', flags: () => ['--dry-run'], code: 0 },
  { name: 'with a --confirm that names another version', flags: () => ['--confirm', '9.9.9'], code: 2 },
  { name: 'with --dry-run and a --confirm that names another version', flags: () => ['--dry-run', '--confirm', '9.9.9'], code: 0 },
  { name: 'with --dry-run next to the right --confirm', flags: (confirm) => ['--dry-run', '--confirm', confirm], code: 0 },
];

describe('the confirmation latch: nothing leaves the machine without --confirm <version>', () => {
  for (const command of OUTWARD_COMMANDS) {
    it(`${command.name} only prints its plan — no request, no program that reaches out, nothing written`, async () => {
      // `sign` is asked while everything is ready for it; the rest — while a release is out and they could run for real.
      const h = command.name === 'sign' ? world() : await released();
      if (command.name === 'sign') expect(await h.run('preflight', '--online')).toBe(0);
      const before = [snapshot(h.path('.release')), snapshot(h.remoteDir), [...h.world.localTags.keys()], [...h.world.originTags]];

      for (const mode of WITHOUT_THE_WORD) {
        h.forget();
        const code = await h.run(...command.argv, ...mode.flags(command.confirm));
        const what = `${command.name} ${mode.name}`;
        expect(code, `${what}: ${h.err.join('\n')}`).toBe(mode.code);
        expect(h.out.join('\n'), what).toContain('[dry-run] 1/');
        expect(h.requests, what).toEqual([]);
        expect(h.posts, what).toEqual([]);
        expect(h.outward(), what).toEqual([]);
        expect(h.commands.filter((line) => !LOCAL_READ.test(line)), what).toEqual([]);
        if (mode.code === 2) expect(h.err.join('\n'), what).toMatch(/^release: not run: .*--confirm/);
        else expect(h.out.at(-1), what).toMatch(/^dry run: nothing was run\./);
        expect([snapshot(h.path('.release')), snapshot(h.remoteDir), [...h.world.localTags.keys()], [...h.world.originTags]], what).toEqual(before);
      }
    });
  }

  it('a secret never shows in a plan: the keys and the bot token are named, not printed', async () => {
    // Before anything is signed: every command still shows its whole plan.
    const h = world();
    for (const command of OUTWARD_COMMANDS) expect(await h.run(...command.argv, '--dry-run'), command.name).toBe(0);
    const printed = [...h.out, ...h.err].join('\n');
    expect(printed).not.toContain(BOT_TOKEN);
    expect(printed).not.toContain('synthetic-amo-secret');
    expect(printed).toContain('WEB_EXT_API_SECRET=<from the environment>');
    expect(printed).toContain('bot<TELEGRAM_BOT_TOKEN>');
  });
});

describe('a release from the gate to the announcement', () => {
  it('[UP-001] [UP-002] [UP-005] each step runs with the owner’s word and leaves what the next one needs', async () => {
    const h = world();
    expect(await h.run('preflight', '--online')).toBe(0);
    expect(h.out.at(-1)).toBe(`preflight: the gate passed for ${VERSION} at ${COMMIT_A.slice(0, 12)}. Next: pnpm release sign`);

    h.forget();
    expect(await h.run('sign', '--confirm', VERSION), h.err.join('\n')).toBe(0);
    expect(h.outward().filter((line) => line.startsWith('web-ext sign '))).toHaveLength(1);
    const signed = readFileSync(h.path(`.release/${VERSION}/chatgoose-chatspace-${VERSION}.xpi`));
    expect(signed.equals(h.signedXpi())).toBe(true);
    const record = JSON.parse(readFileSync(h.path(`.release/${VERSION}/chatgoose-chatspace-${VERSION}.json`), 'utf8')) as { commit: string; xpi: { sha256: string } };
    expect(record.commit).toBe(COMMIT_A);

    // A version is signed once.
    h.forget();
    expect(await h.run('sign', '--confirm', VERSION)).toBe(2);
    expect(h.err.join('\n')).toMatch(/already signed/);
    expect(h.outward()).toEqual([]);

    h.forget();
    expect(await h.run('publish', '--confirm', VERSION), h.err.join('\n')).toBe(0);
    expect(readFileSync(h.remote(`firefox/chatgoose-chatspace-${VERSION}.xpi`)).equals(signed)).toBe(true);
    expect(parseFeed(readFileSync(h.remote('firefox/updates.json'), 'utf8'), target.geckoId)).toMatchObject({ version: VERSION, sha256: record.xpi.sha256 });
    expect(readFileSync(h.remote('index.html'), 'utf8')).toBe(readFileSync(h.path('site/index.html'), 'utf8'));

    h.forget();
    expect(await h.run('tag', '--confirm', VERSION), h.err.join('\n')).toBe(0);
    expect(h.world.localTags.get(`v${VERSION}`)).toEqual({ commit: COMMIT_A, annotated: true });
    expect(h.world.originTags.has(`v${VERSION}`)).toBe(true);
    expect(h.commands.find((line) => line.startsWith('git tag -a '))).toContain(`xpi sha256:${record.xpi.sha256}`);

    h.forget();
    h.world.telegram.push({ status: 200, body: { ok: true, result: { message_id: 7 } } });
    expect(await h.run('announce', '--confirm', VERSION), h.err.join('\n')).toBe(0);
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]?.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendRichMessage`);
    expect(h.out.join('\n')).toContain('posted (message 7)');
    expect([...h.out, ...h.err].join('\n')).not.toContain(BOT_TOKEN);
  });

  it('with the right --confirm the other outward commands do reach out: the pages, the pages ahead of a release, a rollback', async () => {
    const h = await released();
    expect(await h.run('pages', '--confirm', VERSION), h.err.join('\n')).toBe(0);
    expect(h.outward().some((line) => line.startsWith('scp '))).toBe(true);

    h.forget();
    expect(await h.run('pages', '--versionless', '--confirm', VERSION), h.err.join('\n')).toBe(0);
    expect(h.outward().some((line) => line.startsWith('scp '))).toBe(true);

    // The confirmation of a rollback names the version the feed goes back to; there is no 0.0.9 on the server.
    h.forget();
    expect(await h.run('rollback', '--to', '0.0.9', '--confirm', '0.0.9')).toBe(1);
    expect(h.requests).toEqual([target.feedUrl, `${target.feedBase}chatgoose-chatspace-0.0.9.json`]);
    expect(h.err.join('\n')).toMatch(/chatgoose-chatspace-0\.0\.9\.json answered HTTP 404/);
  });
});
