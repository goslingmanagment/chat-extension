// Synthetic bundle text only. The real snapshot is local, outside Git and CI (research/fansly.md §2).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FANSLY_CONTRACT } from '../../packages/contracts/src/fansly-host.ts';
import { fanslyAnchors, fanslyBuildOf } from './anchors-fansly.ts';
import { checkAnchors, diffAnchorPresence, type AnchorResult, type BundleFile } from './check.ts';

// Independently written names and minimal expressions, not generated from the checker or copied from Fansly.
const TEXT = [
  'tags = ["app-messages-conversation-route", "app-group-message-container", "app-group-message-input", "textarea", "input", "app-media-upload-input"];',
  'classes = ["content-wrapper", "messages-content-wrapper", "message-composer", "hidden", "message-input", "send-button", "collapsable-actions"];',
  'header = ["message-content-header", "message-content-header-contact", "content-header-sub-row"];',
  'branches = ["message-attachments", "no-dm-allowed", "modal-opened", "bright-theme", "dark-theme"];',
  'attributes = ["type", "file"];',
  'paths = ["/account/me", "/message", "/group"];',
  'socket = new WebSocket("wss://wsv3.fansly.com" + "?v=3");',
  'types = ["EventWrapper", "ServiceEvent"]; payload = JSON.parse(frame.event); use(payload.serviceId);',
  'request = new XMLHttpRequest();',
].join('\n');
const copy = (text = TEXT, name = 'main.0123456789abcdef.js'): BundleFile[] => [{ name, text }];
const anchors = fanslyAnchors();
const missing = (text: string): string[] => checkAnchors(copy(text), anchors).filter((result) => !result.present).map((result) => result.group);
const dirs: string[] = [];
const directory = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'cg-contract-fansly-'));
  dirs.push(path);
  return path;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('[host:fansly] the bundle contract (R20 P7h)', () => {
  it('[DB-031] checks every expected anchor, including the switched vault, with file and line evidence', () => {
    expect([...new Set(anchors.map((anchor) => anchor.group))]).toEqual(FANSLY_CONTRACT.anchors);
    const results = checkAnchors(copy(), anchors);
    expect(results.every((result) => result.present && result.count > 0)).toBe(true);
    expect(results.find((result) => result.group === 'modalFlag')?.at).toEqual(['main.0123456789abcdef.js:4']);
    expect(checkAnchors([], anchors).every((result) => !result.present)).toBe(true);
  });

  it('[DB-031] one lost token in each of the 17 anchors is a failure; compound anchors need all their parts', () => {
    const tokens = ['app-messages-conversation-route', 'app-group-message-container', 'app-group-message-input', 'message-input', 'send-button', 'collapsable-actions', 'message-content-header-contact', 'content-header-sub-row', 'message-attachments', 'no-dm-allowed', 'modal-opened', 'bright-theme', 'app-media-upload-input', '/account/me', 'wss://wsv3.fansly.com', 'ServiceEvent', '/message'];
    expect(tokens.length).toBe(FANSLY_CONTRACT.anchors.length);
    tokens.forEach((token, i) => expect(missing(TEXT.replace(`"${token}"`, `"${token}-changed"`))).toContain(FANSLY_CONTRACT.anchors[i]));
    expect(missing(TEXT.replace('"file"', '"text"'))).toEqual(['fileInput', 'vaultUpload']);
    expect(missing(TEXT.replace('new WebSocket(', 'new OtherSocket('))).toEqual(['socket']);
    expect(missing(TEXT.replace('JSON.parse(', 'decode('))).toEqual(['frames']);
    expect(missing(TEXT.replace('new XMLHttpRequest(', 'new OtherRequest('))).toEqual(['xhr']);
  });

  it('longer class names, CSS references, an unquoted token and another API path cannot stand in for anchors', () => {
    for (const replacement of ['"message-input-container"', '"prefix-message-input"', 'message-input', '".message-input { color: red }"']) {
      expect(missing(TEXT.replace('"message-input"', replacement))).toEqual(['textarea']);
    }
    expect(missing(TEXT.replace('"/account/me"', '"/account/media"'))).toEqual(['accountMe']);
    expect(missing(TEXT.replace('"message-input"', '"wide message-input rounded"'))).toEqual([]);
    expect(missing(TEXT.replaceAll('"', "'"))).toEqual([]);
    for (const name of ['assets/js/player.js', 'external/library.js', 'ngsw-worker.js', 'styles.0123456789abcdef.css']) {
      expect(checkAnchors(copy(TEXT, name), anchors).every((result) => !result.present)).toBe(true);
    }
    expect(checkAnchors(copy(TEXT, '123.0123456789abcdef.js'), anchors).every((result) => result.present)).toBe(true);
  });

  it('[NEW-09] reports main.<hash>, not runtime or styles; an ambiguous snapshot has no build', () => {
    expect(fanslyBuildOf(copy())).toBe('main.0123456789abcdef');
    expect(fanslyBuildOf(copy('', 'nested/main.abcdef01.js'))).toBe('main.abcdef01');
    for (const name of ['runtime.0123456789abcdef.js', 'main.0123456789abcdef.js.map', 'main.not-a-hash.js']) expect(fanslyBuildOf(copy('', name))).toBeNull();
    expect(fanslyBuildOf([...copy(), ...copy('', 'main.abcdef01.js')])).toBeNull();
    const changed = copy(TEXT.replace('"message-input"', '"renamed"'));
    expect(diffAnchorPresence(copy(), changed, anchors)).toEqual([{ id: 'textarea: textarea.message-input', from: true, to: false }]);
    expect(diffAnchorPresence(copy(), copy(TEXT, 'main.abcdef01.js'), anchors)).toEqual([]);
  });

  const cli = (args: string[], env = process.env) => spawnSync(process.execPath, ['tools/host-contract-check/index.ts', ...args], { encoding: 'utf8', env, timeout: 15_000 });
  it('[DB-031] the real CLI accepts --host fansly, reads nested files and prints evidence without source or ChatSpace checks', () => {
    const dir = directory();
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'nested', 'main.0123456789abcdef.js'), TEXT);
    const result = cli(['--host', 'fansly', '--dir', dir, '--json']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { anchors: AnchorResult[] };
    expect(report).toMatchObject({ host: 'fansly-web', build: 'main.0123456789abcdef', missing: [] });
    expect(report.anchors.find((anchor) => anchor.id === 'textarea: textarea.message-input')).toMatchObject({ at: ['nested/main.0123456789abcdef.js:2'] });
    expect(result.stdout).not.toContain('receiptProfile');
    expect(result.stdout).not.toContain('telemetry');
    expect(result.stdout).not.toContain('tags =');
  });

  it('[DB-031] fansly-web is also accepted; a missing anchor fails the CLI and is named in --against', () => {
    const before = directory();
    const after = directory();
    writeFileSync(join(before, 'main.0123456789abcdef.js'), TEXT);
    writeFileSync(join(after, 'main.abcdef01.js'), TEXT.replace('"app-media-upload-input"', '"changed"'));
    const result = cli(['--host', 'fansly-web', '--dir', after, '--against', before, '--json']);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ missing: ['vaultUpload: app-media-upload-input'], diff: { build: { from: 'main.0123456789abcdef', to: 'main.abcdef01' }, anchors: [{ id: 'vaultUpload: app-media-upload-input', from: true, to: false }] } });
  });

  it('selects the newest dated pretty/ snapshot from CG_FANSLY_BUNDLES without a local path in the tool', () => {
    const root = directory();
    for (const date of ['2026-10-11', '2026-10-12']) {
      const dir = join(root, date, 'pretty');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'main.0123456789abcdef.js'), date.endsWith('12') ? TEXT : '');
    }
    const result = cli(['--host', 'fansly', '--json'], { ...process.env, CG_FANSLY_BUNDLES: root });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ dir: join(root, '2026-10-12', 'pretty'), missing: [] });
  });

  it('accepts one snapshot root through the variable and prints the human-readable verdict', () => {
    const root = directory();
    mkdirSync(join(root, 'pretty'));
    writeFileSync(join(root, 'pretty', 'main.0123456789abcdef.js'), TEXT);
    const result = cli(['--host', 'fansly'], { ...process.env, CG_FANSLY_BUNDLES: root });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('every anchor is present; static evidence only');
    expect(result.stdout).toContain('build main.0123456789abcdef');
  });

  it('an empty copy fails; the default remains ChatSpace with its own receipt and telemetry checks', () => {
    const dir = directory();
    const absent = cli(['--host', 'fansly', '--dir', dir, '--json']);
    expect(absent.status).toBe(1);
    expect(JSON.parse(absent.stdout)).toMatchObject({ build: null, missing: anchors.map((anchor) => anchor.id) });
    const legacy = cli(['--dir', dir, '--json']);
    expect(legacy.status).toBe(1);
    expect(JSON.parse(legacy.stdout)).toMatchObject({ receiptProfile: { id: 'chatspace-unknown' } });
    expect(JSON.parse(legacy.stdout)).toHaveProperty('telemetry');
  });
});
