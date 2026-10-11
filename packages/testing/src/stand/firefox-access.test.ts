// The question wdio.conf.ts asks before a native run — can the stock Firefox of
// a Mac start from this process — against a scripted file system: what counts
// as a refusal, what does not, and what the one message says.

import { describe, expect, it } from 'vitest';

import { firefoxStartRefusal, MAC_FIREFOX_BINARY, type FirefoxAccessWorld } from './firefox-access';

const HOME = '/Users/u';
const DATA = '/Users/u/Library/Application Support/Firefox';

function world(over: Partial<FirefoxAccessWorld> & { readonly denied?: string } = {}): FirefoxAccessWorld & { readonly asked: string[] } {
  const asked: string[] = [];
  const { denied, ...rest } = over;
  return {
    platform: 'darwin',
    home: HOME,
    canRead: (path) => {
      asked.push(path);
      if (denied !== undefined) throw Object.assign(new Error(`${denied}: access '${path}'`), { code: denied, syscall: 'access', path });
    },
    asked,
    ...rest,
  };
}

describe('firefoxStartRefusal', () => {
  it('a readable application-data folder is no refusal; only access(2) on the folder itself is asked', () => {
    const w = world();
    expect(firefoxStartRefusal(MAC_FIREFOX_BINARY, w)).toBeNull();
    expect(w.asked).toEqual([DATA]);
  });

  it('a folder this process is denied (EPERM from a sandbox, EACCES from the file system) is one: the message names the folder, the cause and the Docker run', () => {
    const refusal = firefoxStartRefusal(MAC_FIREFOX_BINARY, world({ denied: 'EPERM' }));
    expect(refusal).not.toBeNull();
    const lines = (refusal ?? '').split('\n');
    expect(lines[0]).toBe(`Firefox cannot start from this shell, so no spec can run: this process may not read "${DATA}" (EPERM).`);
    expect(refusal).toContain('«Could not find profile folder.»');
    expect(refusal).toContain('do not work around it');
    expect(refusal).toContain('tools/ci/e2e-docker-local.sh');
    expect(refusal).toContain('CG_E2E_VOLUME=');

    expect(firefoxStartRefusal(MAC_FIREFOX_BINARY, world({ denied: 'EACCES' }))).toContain(`"${DATA}" (EACCES)`);
  });

  it('a folder that is not there is not: Firefox makes it on its first start; nor is any other answer', () => {
    expect(firefoxStartRefusal(MAC_FIREFOX_BINARY, world({ denied: 'ENOENT' }))).toBeNull();
    expect(firefoxStartRefusal(MAC_FIREFOX_BINARY, world({ denied: 'ENOTDIR' }))).toBeNull();
    expect(firefoxStartRefusal(MAC_FIREFOX_BINARY, world({ denied: 'EIO' }))).toBeNull();
    expect(
      firefoxStartRefusal(MAC_FIREFOX_BINARY, {
        ...world(),
        canRead: () => {
          throw new Error('no code at all');
        },
      }),
    ).toBeNull();
  });

  it('only the stock binary on macOS is judged: another binary, none, or another system is not asked about at all', () => {
    for (const [binary, platform] of [
      ['/Applications/Firefox Nightly.app/Contents/MacOS/firefox', 'darwin'],
      ['/opt/firefox/firefox', 'darwin'],
      [undefined, 'darwin'],
      ['/usr/bin/firefox', 'linux'],
      [MAC_FIREFOX_BINARY, 'linux'],
      [undefined, 'linux'],
      [undefined, 'win32'],
    ] as const) {
      const w = world({ platform, denied: 'EPERM' });
      expect(firefoxStartRefusal(binary, w), `${binary ?? 'no binary'} on ${platform}`).toBeNull();
      expect(w.asked).toEqual([]);
    }
  });

  it('the folder is taken from the home directory it is given', () => {
    const w = world({ home: '/Volumes/Home/dmitriy', denied: 'EPERM' });
    expect(firefoxStartRefusal(MAC_FIREFOX_BINARY, w)).toContain('"/Volumes/Home/dmitriy/Library/Application Support/Firefox" (EPERM)');
    expect(w.asked).toEqual(['/Volumes/Home/dmitriy/Library/Application Support/Firefox']);
  });

  it('by default it asks the real file system and never throws', () => {
    // On a Mac with the stock Firefox the answer depends on the shell that runs the tests (an agent shell is
    // refused, a person's terminal is not); anywhere else it is null. Either way it is an answer.
    const answer = firefoxStartRefusal(MAC_FIREFOX_BINARY);
    expect(answer === null || answer.startsWith('Firefox cannot start from this shell')).toBe(true);
    if (process.platform !== 'darwin') expect(answer).toBeNull();
  });
});
