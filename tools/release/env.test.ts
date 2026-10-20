import { describe, expect, it } from 'vitest';

import { DEFAULT_REMOTE_DIR, DEFAULT_SSH, ENV } from './config.ts';
import { loadReleaseEnv, parseEnvFile } from './env.ts';

const FILES: Record<string, string> = {
  '/home/.config/agency/secrets.env': '# agency\nexport WEB_EXT_API_KEY="user:1:2"\nTELEGRAM_BOT_TOKEN=\n',
  '/home/code/1-platform/fansly-chat/.env.deploy': "WEB_EXT_API_KEY=user:old\nWEB_EXT_API_SECRET='s3cret'\nTELEGRAM_BOT_TOKEN=bot\nAGENCY_HUB_BASE_URL=https://x\n",
};
const read = (path: string): string | null => FILES[path] ?? null;
const files = Object.keys(FILES);

describe('the keys of a release', () => {
  it('reads KEY=value and export KEY=value, quoted or not; skips the rest', () => {
    expect([...parseEnvFile('# c\nexport A="1"\nB=\'2\'\nC=3 \nnot a line\n')]).toEqual([
      ['A', '1'],
      ['B', '2'],
      ['C', '3'],
    ]);
  });

  it('takes each missing variable from the first file that has a value; the environment wins; names only are reported', () => {
    const { env, loaded } = loadReleaseEnv({ [ENV.telegramChannel]: '-100', PATH: '/bin' }, files, read);
    expect(env[ENV.amoKey]).toBe('user:1:2');
    expect(env[ENV.amoSecret]).toBe('s3cret');
    expect(env[ENV.telegramToken]).toBe('bot');
    expect(env[ENV.telegramChannel]).toBe('-100');
    expect(env['AGENCY_HUB_BASE_URL']).toBeUndefined();
    expect(loaded).toEqual([
      { name: ENV.amoKey, file: files[0] },
      { name: ENV.amoSecret, file: files[1] },
      { name: ENV.telegramToken, file: files[1] },
    ]);
    expect(JSON.stringify(loaded)).not.toContain('s3cret');
  });

  it('the server has defaults; an environment value or a file value replaces them', () => {
    expect(loadReleaseEnv({}, [], read).env).toMatchObject({ [ENV.ssh]: DEFAULT_SSH, [ENV.remoteDir]: DEFAULT_REMOTE_DIR });
    expect(loadReleaseEnv({ [ENV.ssh]: 'deploy@elsewhere' }, [], read).env[ENV.ssh]).toBe('deploy@elsewhere');
  });
});
