// Drive the real CLI entry point, stubbing only HTTP and the browser process. No live session is started.
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const world = vi.hoisted(() => ({ root: '', spawn: vi.fn() }));
vi.mock('../lib/paths.ts', () => ({ get REPO_ROOT() { return world.root; }, fail: (message: string): never => { throw new Error(message); } }));
vi.mock('node:child_process', () => ({ spawn: world.spawn, spawnSync: vi.fn(() => { throw new Error('unexpected build'); }) }));

const TOKEN = 'ab'.repeat(32);
const fetchMock = vi.fn<typeof fetch>();
const savedArgv = process.argv;
const savedExitCode = process.exitCode;
let sessionFile: string;
let signalListeners: { int: ((signal: 'SIGINT') => void)[]; term: ((signal: 'SIGTERM') => void)[] };

function record(overrides: Record<string, unknown> = {}): void {
  writeFileSync(sessionFile, JSON.stringify({ pid: process.pid, port: 47811, site: 'fansly', out: '/see', token: TOKEN, ...overrides }), { mode: 0o600 });
}

async function cli(...args: string[]): Promise<void> {
  vi.resetModules();
  process.argv = ['node', 'tools/see/index.ts', ...args];
  await import('./index.ts');
}

const paths = (): string[] => fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
const ok = (): Response => Response.json({ ok: true, result: 1, seconds: 0 });

beforeEach(() => {
  world.root = mkdtempSync(join(tmpdir(), 'see-session-test-'));
  mkdirSync(join(world.root, '.cache/see'), { recursive: true });
  sessionFile = join(world.root, '.cache/see/session.json');
  fetchMock.mockReset().mockImplementation(async () => ok());
  world.spawn.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  signalListeners = { int: process.listeners('SIGINT'), term: process.listeners('SIGTERM') };
});

afterEach(() => {
  process.argv = savedArgv;
  process.exitCode = savedExitCode;
  for (const listener of process.listeners('SIGINT')) if (!signalListeners.int.includes(listener)) process.off('SIGINT', listener);
  for (const listener of process.listeners('SIGTERM')) if (!signalListeners.term.includes(listener)) process.off('SIGTERM', listener);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(world.root, { recursive: true, force: true });
});

describe('see:do single submission', () => {
  it('retries only readiness, then submits the script once with its credential', async () => {
    record();
    fetchMock.mockRejectedValueOnce(new TypeError('not listening yet'));
    await cli('do', 'return 1', '--no-shot');
    expect(paths()).toEqual(['/ready', '/ready', '/run']);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('x-cg-see-token')).toBe(TOKEN);
      expect(init?.redirect).toBe('error');
    }
    expect(fetchMock.mock.calls.slice(0, 2).every(([, init]) => init?.body === undefined && (init?.method ?? 'GET') === 'GET')).toBe(true);
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({ method: 'POST', body: 'return 1' });
    expect(new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get('content-type')).toBe('application/javascript; charset=utf-8');
  });

  it('reports an unknown outcome after execution loses its response, without a second POST', async () => {
    record();
    let executions = 0;
    fetchMock.mockImplementation(async (url) => {
      if (new URL(String(url)).pathname === '/run') {
        executions += 1;
        if (executions === 1) throw new TypeError('connection reset after Send');
      }
      return ok();
    });
    await expect(cli('do', 'await s.site.click("Send")')).rejects.toThrow(/outcome unknown.*not retried/);
    expect(executions).toBe(1);
    expect(paths()).toEqual(['/ready', '/run']);
  });

  it.each(['lost', 'invalid'])('reports an unknown outcome when the response body is %s', async (failure) => {
    record();
    const response = ok();
    vi.spyOn(response, 'json').mockRejectedValue(failure === 'lost' ? new TypeError('socket closed') : new SyntaxError('truncated JSON'));
    fetchMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(response);
    await expect(cli('do', 'return 1')).rejects.toThrow(/outcome unknown.*not retried/);
    expect(paths()).toEqual(['/ready', '/run']);
  });

  it('does not contact a guessed port without this worktree\'s session', async () => {
    await expect(cli('do', 'return 1')).rejects.toThrow(/no session/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not contact a legacy session without a credential', async () => {
    record({ token: undefined });
    await expect(cli('do', 'return 1')).rejects.toThrow(/credential/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never submits when readiness rejects the session token', async () => {
    record();
    fetchMock.mockResolvedValue(Response.json({ ok: false }, { status: 401 }));
    await expect(cli('do', 'return 1')).rejects.toThrow(/readiness rejected/);
    expect(paths()).toEqual(['/ready']);
  });

  it('does not switch to a replacement session while waiting for readiness', async () => {
    record();
    fetchMock.mockImplementationOnce(async () => { record({ token: 'cd'.repeat(32) }); throw new TypeError('closed'); });
    await expect(cli('do', 'return 1')).rejects.toThrow(/session ended or changed/);
    expect(paths()).toEqual(['/ready']);
  });

  it.each([['--stop', '/stop', 'POST'], ['--status', '/status', 'GET'], ['--shot', '/shot', 'GET']])('authenticates %s too', async (flag, path, method) => {
    record();
    await cli('do', flag, ...(flag === '--shot' ? ['picture'] : []));
    expect(paths()).toEqual(['/ready', path]);
    const init = fetchMock.mock.calls.at(-1)?.[1];
    expect(init?.method ?? 'GET').toBe(method);
    expect(new Headers(init?.headers).get('x-cg-see-token')).toBe(TOKEN);
  });
});

describe('see:session credential lifecycle', () => {
  it('creates fresh private credentials, including over an old 0644 file, and authenticates shutdown', async () => {
    const tokens: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      // An invalid old record, left by a pre-token launcher, must not keep its old permissions.
      writeFileSync(sessionFile, '{}');
      chmodSync(sessionFile, 0o644);
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      world.spawn.mockReturnValue(child);
      const running = cli('session', 'fansly', '--no-build');
      try {
        await vi.waitFor(() => expect(world.spawn).toHaveBeenCalledTimes(run + 1));
        const info = JSON.parse(readFileSync(sessionFile, 'utf8')) as { token: string };
        expect(info.token).toMatch(/^[a-f0-9]{64}$/);
        expect(statSync(sessionFile).mode & 0o777).toBe(0o600);
        const options = world.spawn.mock.calls.at(-1)?.[2] as { env: Record<string, string> };
        expect(options.env['CG_SEE_TOKEN']).toBe(info.token);
        expect(options.env['CG_SEE_LIVE']).toBeUndefined();
        tokens.push(info.token);
        const stop = process.listeners('SIGINT').at(-1);
        stop?.('SIGINT');
        expect(new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get('x-cg-see-token')).toBe(info.token);
        expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining(info.token));
      } finally {
        child.stdout.end();
        child.stderr.end();
        child.emit('close', 0);
        await running;
      }
      expect(existsSync(sessionFile)).toBe(false);
    }
    expect(tokens[0]).not.toBe(tokens[1]);
  });
});
