import { describe, expect, it } from 'vitest';

import { devProfileDir } from './profile.ts';

describe('devProfileDir', () => {
  const repo = '/repo/chat-extension/';

  it('defaults to .dev-profile in the repo', () => {
    expect(devProfileDir(repo, {}, '/home/u')).toBe('/repo/chat-extension/.dev-profile');
    expect(devProfileDir(repo, { CG_DEV_PROFILE: '  ' }, '/home/u')).toBe('/repo/chat-extension/.dev-profile');
  });

  it('takes CG_DEV_PROFILE: absolute, under the home directory, or relative to the repo', () => {
    expect(devProfileDir(repo, { CG_DEV_PROFILE: '/var/profiles/cg' }, '/home/u')).toBe('/var/profiles/cg');
    expect(devProfileDir(repo, { CG_DEV_PROFILE: '~/Documents/ChatGoose/firefox-dev-profile' }, '/home/u')).toBe('/home/u/Documents/ChatGoose/firefox-dev-profile');
    expect(devProfileDir(repo, { CG_DEV_PROFILE: '~' }, '/home/u')).toBe('/home/u');
    expect(devProfileDir(repo, { CG_DEV_PROFILE: '../profiles/cg' }, '/home/u')).toBe('/repo/profiles/cg');
  });
});
