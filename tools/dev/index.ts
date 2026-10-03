// `pnpm dev`: TEST build (CG_TEST_HOSTS=1) + `web-ext run` in a dedicated,
// persistent Firefox profile under .dev-profile/ (gitignored). The owner signs
// in to ChatSpace in that profile once (X9); live checks only in the test chat.
//
// Flags: --no-watch (build once), --firefox <path> (default FIREFOX_BIN or the
// macOS app). With watch on, a change under packages/ or apps/extension/
// rebuilds and web-ext reloads the add-on.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, watch } from 'node:fs';
import { parseArgs } from 'node:util';

import { EXTENSION_ROOT, REPO_ROOT, TEST_DIR } from '../lib/paths.ts';

const { values } = parseArgs({
  options: {
    watch: { type: 'boolean', default: true },
    'no-watch': { type: 'boolean', default: false },
    firefox: { type: 'string' },
  },
});

const macFirefox = '/Applications/Firefox.app/Contents/MacOS/firefox';
const firefox = values.firefox ?? process.env['FIREFOX_BIN'] ?? (existsSync(macFirefox) ? macFirefox : 'firefox');
const profileDir = `${REPO_ROOT}.dev-profile`;
const wxt = `${EXTENSION_ROOT}node_modules/.bin/wxt`;
const webExt = `${REPO_ROOT}node_modules/.bin/web-ext`;

function buildTest(): boolean {
  const result = spawnSync(wxt, ['build', '-b', 'firefox', '--mv3'], {
    cwd: EXTENSION_ROOT,
    env: { ...process.env, CG_TEST_HOSTS: '1' },
    stdio: 'inherit',
  });
  return result.status === 0;
}

if (!buildTest()) process.exit(1);
mkdirSync(profileDir, { recursive: true });

const runner = spawn(
  webExt,
  ['run', '--target', 'firefox-desktop', '--source-dir', TEST_DIR, '--firefox', firefox, '--firefox-profile', profileDir, '--profile-create-if-missing', '--keep-profile-changes'],
  { cwd: REPO_ROOT, stdio: 'inherit' },
);
runner.on('exit', (code) => process.exit(code ?? 0));

if (values.watch && !values['no-watch']) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ignored = /(^|\/)(node_modules|\.output|\.wxt|\.tsbuild)(\/|$)|\.test\.tsx?$/;
  const onChange = (_event: string, file: string | null): void => {
    if (file && ignored.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`dev: change in ${file ?? '?'} → rebuilding the test build`);
      buildTest();
    }, 300);
  };
  watch(`${REPO_ROOT}packages`, { recursive: true }, onChange);
  for (const dir of ['src', 'lazy', 'build', 'public']) watch(`${EXTENSION_ROOT}${dir}`, { recursive: true }, onChange);
}
