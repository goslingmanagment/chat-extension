import { describe, expect, it } from 'vitest';

import { DEV_PORT_COUNT, DEV_PORT_FIRST, PROFILE_MARKER_PREF, checkRunningProfile, devDebuggerPort, devProfileDir, devProfileRefusal, profileMarker } from './profile.ts';

const HOME = '/home/u';

describe('devProfileDir', () => {
  const repo = '/repo/chat-extension/';

  it('defaults to .dev-profile in the repo', () => {
    expect(devProfileDir(repo, {}, HOME)).toBe('/repo/chat-extension/.dev-profile');
    expect(devProfileDir(repo, { CG_DEV_PROFILE: '  ' }, HOME)).toBe('/repo/chat-extension/.dev-profile');
  });

  it('takes CG_DEV_PROFILE: absolute, under the home directory, or relative to the repo', () => {
    expect(devProfileDir(repo, { CG_DEV_PROFILE: '/var/profiles/cg' }, HOME)).toBe('/var/profiles/cg');
    expect(devProfileDir(repo, { CG_DEV_PROFILE: '~/Documents/ChatGoose/firefox-dev-profile' }, HOME)).toBe('/home/u/Documents/ChatGoose/firefox-dev-profile');
    expect(devProfileDir(repo, { CG_DEV_PROFILE: '../profiles/cg' }, HOME)).toBe('/repo/profiles/cg');
    expect(devProfileDir(repo, { CG_DEV_PROFILE: '/var/profiles/../profiles/cg/' }, HOME)).toBe('/var/profiles/cg');
  });

  it('refuses the home directory: `~` is not a profile, and neither is anything above it', () => {
    expect(() => devProfileDir(repo, { CG_DEV_PROFILE: '~' }, HOME)).toThrow(/CG_DEV_PROFILE: "\/home\/u" is the home directory \(or above it\), not a Firefox profile/);
    expect(() => devProfileDir(repo, { CG_DEV_PROFILE: '~/' }, HOME)).toThrow(/is the home directory/);
    expect(() => devProfileDir(repo, { CG_DEV_PROFILE: '/home/u/' }, HOME)).toThrow(/is the home directory/);
    expect(() => devProfileDir(repo, { CG_DEV_PROFILE: '/home' }, HOME)).toThrow(/is the home directory \(or above it\)/);
    expect(() => devProfileDir(repo, { CG_DEV_PROFILE: '/' }, HOME)).toThrow(/is the home directory \(or above it\)/);
  });

  it('refuses Firefox’s own profiles — the directory, a profile in it, anything below, in any letter case', () => {
    const own = /inside Firefox's own profiles \(\/home\/u\/Library\/Application Support\/Firefox\) — a dev profile must be a separate directory/;
    expect(() => devProfileDir(repo, { CG_DEV_PROFILE: '~/Library/Application Support/Firefox' }, HOME)).toThrow(own);
    expect(() => devProfileDir(repo, { CG_DEV_PROFILE: '~/Library/Application Support/Firefox/Profiles/abcd1234.default-release' }, HOME)).toThrow(own);
    expect(() => devProfileDir(repo, { CG_DEV_PROFILE: '/home/u/library/application support/firefox/Profiles/x' }, HOME)).toThrow(own);
    expect(() => devProfileDir(repo, { CG_DEV_PROFILE: '~/.mozilla/firefox/abcd.default' }, HOME)).toThrow(/inside Firefox's own profiles/);
    // The default location is checked like a named one: a repo that lives there gets no profile either.
    expect(() => devProfileDir('/home/u/Library/Application Support/Firefox/Profiles/x/repo', {}, HOME)).toThrow(/the dev profile: .*inside Firefox's own profiles/);
  });

  it('a directory next to them is fine: only the home directory itself and Firefox’s own tree are refused', () => {
    expect(devProfileRefusal('/home/u/Library/Application Support/FirefoxDev/profile', HOME)).toBeNull();
    expect(devProfileRefusal('/home/u/Documents/ChatGoose/firefox-dev-profile', HOME)).toBeNull();
    expect(devProfileRefusal('/home/u2', HOME)).toBeNull();
    expect(devProfileRefusal('/repo/.dev-profile', HOME)).toBeNull();
  });
});

describe('devDebuggerPort', () => {
  it('is stable for a profile, lies in the private range, and differs between profiles: two worktrees, a worktree and the durable profile', () => {
    const paths = ['/repo/a/.dev-profile', '/repo/b/.dev-profile', '/home/u/Documents/ChatGoose/firefox-dev-profile', '/home/u/orca/workspaces/chat-extension/live-fix-1/.dev-profile'];
    const ports = paths.map((path) => devDebuggerPort(path));
    expect(new Set(ports).size).toBe(paths.length);
    for (const [index, path] of paths.entries()) {
      expect(devDebuggerPort(path)).toBe(ports[index]);
      expect(ports[index]).toBeGreaterThanOrEqual(DEV_PORT_FIRST);
      expect(ports[index]).toBeLessThan(DEV_PORT_FIRST + DEV_PORT_COUNT);
    }
    expect([DEV_PORT_FIRST, DEV_PORT_FIRST + DEV_PORT_COUNT - 1]).toEqual([49_152, 65_535]);
    // The same directory, spelled differently, is the same port; never the old shared 6111.
    expect(devDebuggerPort('/repo/a/x/../.dev-profile/')).toBe(ports[0]);
    expect(ports).not.toContain(6111);
  });

  it('spreads over the range: a thousand worktrees take hundreds of different ports', () => {
    const ports = new Set(Array.from({ length: 1000 }, (_unused, n) => devDebuggerPort(`/repo/worktree-${n}/.dev-profile`)));
    expect(ports.size).toBeGreaterThan(950);
  });
});

describe('the profile of a running Firefox', () => {
  const dir = '/Users/u/Профили dev/cg (1)';

  it('the marker is the absolute path, percent-encoded: pure ASCII whatever the path, and no quote or backslash', () => {
    expect(profileMarker('/repo/.dev-profile')).toBe('/repo/.dev-profile');
    expect(profileMarker(dir)).toMatch(/^[\x21-\x7e]+$/);
    expect(profileMarker(dir)).not.toMatch(/["\\ ]/);
    expect(decodeURI(profileMarker(dir))).toBe(dir);
    expect(profileMarker('/repo/x/../.dev-profile/')).toBe('/repo/.dev-profile');
    expect(PROFILE_MARKER_PREF).toBe('chatgoose.dev.profile');
  });

  it('a marker decides exactly: the same path is the same profile, any other path is another — whatever the directory is called', () => {
    expect(checkRunningProfile({ marker: profileMarker(dir), name: 'anything' }, dir)).toEqual({ same: true, exact: true });
    // Two worktrees: the same directory name, different profiles.
    expect(checkRunningProfile({ marker: profileMarker('/repo/b/.dev-profile'), name: '.dev-profile' }, '/repo/a/.dev-profile')).toEqual({ same: false, running: '/repo/b/.dev-profile' });
    expect(checkRunningProfile({ marker: profileMarker(dir), name: null }, '/repo/a/.dev-profile')).toEqual({ same: false, running: dir });
    // A marker that is not ours to decode is shown as it is.
    expect(checkRunningProfile({ marker: '%E0%A4%A', name: null }, '/repo/a/.dev-profile')).toEqual({ same: false, running: '%E0%A4%A' });
  });

  it('without a marker the name of the profile directory is all there is: the same name is taken (not exact), another one or none is another profile', () => {
    expect(checkRunningProfile({ marker: null, name: 'firefox-dev-profile' }, '/home/u/Documents/ChatGoose/firefox-dev-profile')).toEqual({ same: true, exact: false });
    expect(checkRunningProfile({ marker: '', name: 'firefox-dev-profile' }, '/home/u/Documents/ChatGoose/firefox-dev-profile/')).toEqual({ same: true, exact: false });
    expect(checkRunningProfile({ marker: null, name: 'default-release' }, '/repo/a/.dev-profile')).toEqual({ same: false, running: 'a profile named "default-release"' });
    expect(checkRunningProfile({ marker: null, name: null }, '/repo/a/.dev-profile')).toEqual({ same: false, running: 'a profile it does not name' });
    expect(checkRunningProfile({ marker: null, name: '' }, '/repo/a/.dev-profile')).toEqual({ same: false, running: 'a profile it does not name' });
  });
});
