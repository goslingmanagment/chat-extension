// The server side of a release (architecture.md §13 п. 5): how files get to
// the folder the site is served from and how they are put in place. Every
// file is uploaded under a temporary name and then renamed (`mv` on one
// filesystem is atomic), so a visitor or a browser never reads half a file. A
// versioned XPI is immutable: a second file under a published name is refused.
// Scripts are plain POSIX sh, fed to `sh -s` over ssh; in tests the same
// scripts run on this machine against a folder. No I/O here: this builds
// command lines and scripts.

import type { CommandSpec } from './exec.ts';

export interface Transport {
  /** For messages: where things go. */
  readonly label: string;
  /** Copies a local file to an absolute path on the server. */
  upload(localPath: string, remotePath: string): CommandSpec;
  /** Runs a POSIX sh script on the server. */
  shell(script: string): CommandSpec;
}

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'] as const;

/** `destination` as ssh takes it: user@host or a Host of ~/.ssh/config. */
export function sshTransport(destination: string): Transport {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(destination)) throw new Error(`"${destination}" is not an SSH destination (user@host or a Host name).`);
  return {
    label: `ssh ${destination}`,
    upload: (localPath, remotePath) => ({ program: 'scp', args: ['-q', ...SSH_OPTIONS, localPath, `${destination}:${remotePath}`] }),
    shell: (script) => ({ program: 'ssh', args: [...SSH_OPTIONS, destination, 'sh', '-s'], stdin: script }),
  };
}

/** The "server" is a folder of this machine: for the tool's own tests only. */
export function localTransport(): Transport {
  return {
    label: 'this machine',
    upload: (localPath, remotePath) => ({ program: 'cp', args: [localPath, remotePath] }),
    shell: (script) => ({ program: 'sh', args: ['-s'], stdin: script }),
  };
}

/** The folder on the server served as the site folder: absolute, plain characters, no `..`. */
export function checkRemoteDir(dir: string): string {
  const clean = dir.replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9._/-]+$/.test(clean) || clean.split('/').includes('..') || clean.split('/').includes('.')) {
    throw new Error(`"${dir}" is not a usable server folder: an absolute path of letters, digits, dots, dashes and slashes is expected.`);
  }
  return clean;
}

const q = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

/** A name unique to this run, for temporary uploads. */
export const uploadName = (name: string, nonce: string): string => `.${name}.upload-${nonce}`;

const SUM = `sum() { if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }`;

export function mkdirScript(dirs: readonly string[]): string {
  return ['set -eu', 'umask 022', `mkdir -p ${dirs.map(q).join(' ')}`, ''].join('\n');
}

/**
 * Puts an uploaded file under its final name unless a file is already there.
 * The same bytes already there — nothing to do (a repeated run after a lost
 * answer); other bytes — refusal, exit 4: a published version is never
 * replaced. A damaged upload — exit 3.
 */
export function placeImmutableScript(file: { readonly tmp: string; readonly final: string; readonly sha256: string }): string {
  return [
    'set -eu',
    'umask 022',
    SUM,
    `tmp=${q(file.tmp)}`,
    `final=${q(file.final)}`,
    `want=${q(file.sha256)}`,
    'got=$(sum "$tmp")',
    'if [ "$got" != "$want" ]; then rm -f "$tmp"; echo "upload damaged: sha256 $got, expected $want" >&2; exit 3; fi',
    'if [ -e "$final" ]; then',
    '  have=$(sum "$final")',
    '  rm -f "$tmp"',
    '  if [ "$have" != "$want" ]; then echo "refusing: $final is already published with other bytes (sha256 $have)" >&2; exit 4; fi',
    '  echo "already in place: $final"',
    'else',
    '  chmod 644 "$tmp"',
    '  mv "$tmp" "$final"',
    '  echo "placed: $final"',
    'fi',
    '',
  ].join('\n');
}

/**
 * Replaces files by rename, in the given order. With `keepPrevious`, the file
 * being replaced is first copied to that name (the feed keeps the one before).
 */
export function replaceScript(files: ReadonlyArray<{ readonly tmp: string; readonly final: string; readonly sha256: string; readonly keepPrevious?: string }>): string {
  return [
    'set -eu',
    'umask 022',
    SUM,
    // Everything is checked before anything is renamed.
    ...files.map((file) => `[ "$(sum ${q(file.tmp)})" = ${q(file.sha256)} ] || { echo "upload damaged: ${file.final}" >&2; exit 3; }`),
    ...files.flatMap((file) => [
      ...(file.keepPrevious === undefined ? [] : [`if [ -f ${q(file.final)} ]; then cp -p ${q(file.final)} ${q(file.keepPrevious)}; fi`]),
      `chmod 644 ${q(file.tmp)}`,
      `mv -f ${q(file.tmp)} ${q(file.final)}`,
      `echo "replaced: ${file.final}"`,
    ]),
    '',
  ].join('\n');
}

/** Removes leftovers of an interrupted run: our temporary uploads only. */
export function cleanupScript(paths: readonly string[]): string {
  return ['set -eu', `rm -f ${paths.map(q).join(' ')}`, ''].join('\n');
}
