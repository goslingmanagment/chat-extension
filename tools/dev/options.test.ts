import { describe, expect, it } from 'vitest';

import { DEFAULT_DEBUGGER_PORT, devRunner, parseDebuggerPort, parseDevOptions } from './options.ts';

describe('devRunner', () => {
  it('never gives macOS a child Firefox', () => {
    expect(devRunner('darwin')).toBe('launch-services');
  });

  it('keeps web-ext run elsewhere', () => {
    expect(devRunner('linux')).toBe('web-ext');
    expect(devRunner('win32')).toBe('web-ext');
  });
});

describe('parseDevOptions', () => {
  it('defaults: watch on, the Firefox app, the default port, no page', () => {
    expect(parseDevOptions([], {})).toEqual({ watch: true, firefoxBinary: undefined, firefoxApp: 'Firefox', debuggerPort: DEFAULT_DEBUGGER_PORT, url: undefined });
  });

  it('reads the flags', () => {
    expect(parseDevOptions(['--no-watch', '--url', 'https://example.test/chat', '--debugger-port', '6222', '--firefox-app', '/Applications/Firefox Developer Edition.app', '--firefox', '/usr/bin/firefox'], {})).toEqual({
      watch: false,
      firefoxBinary: '/usr/bin/firefox',
      firefoxApp: '/Applications/Firefox Developer Edition.app',
      debuggerPort: 6222,
      url: 'https://example.test/chat',
    });
  });

  it('skips the `--` that `pnpm dev -- <flags>` hands over', () => {
    expect(parseDevOptions(['--', '--no-watch'], {}).watch).toBe(false);
  });

  it('takes the port from CG_DEV_DEBUGGER_PORT, and the flag over it', () => {
    expect(parseDevOptions([], { CG_DEV_DEBUGGER_PORT: ' 6333 ' }).debuggerPort).toBe(6333);
    expect(parseDevOptions(['--debugger-port', '6444'], { CG_DEV_DEBUGGER_PORT: '6333' }).debuggerPort).toBe(6444);
    expect(parseDevOptions([], { CG_DEV_DEBUGGER_PORT: '  ' }).debuggerPort).toBe(DEFAULT_DEBUGGER_PORT);
  });

  it('refuses what is not a port', () => {
    expect(() => parseDevOptions(['--debugger-port', 'abc'], {})).toThrow(/--debugger-port: "abc" is not a TCP port/);
    expect(() => parseDevOptions(['--debugger-port', '0'], {})).toThrow(/not a TCP port/);
    expect(() => parseDevOptions(['--debugger-port', '65536'], {})).toThrow(/not a TCP port/);
    expect(() => parseDevOptions([], { CG_DEV_DEBUGGER_PORT: '60.5' })).toThrow(/CG_DEV_DEBUGGER_PORT: "60\.5" is not a TCP port/);
    expect(parseDebuggerPort('65535', 'x')).toBe(65_535);
  });

  it('refuses a page that is not an absolute URL, an empty app and an unknown flag', () => {
    expect(() => parseDevOptions(['--url', 'example.test/chat'], {})).toThrow(/--url: "example\.test\/chat" is not an absolute URL/);
    expect(() => parseDevOptions(['--firefox-app', ' '], {})).toThrow(/--firefox-app/);
    expect(() => parseDevOptions(['--headless'], {})).toThrow(/--headless/);
    expect(parseDevOptions(['--url', 'about:blank'], {}).url).toBe('about:blank');
  });

  it('does not take FIREFOX_BIN for the flag', () => {
    expect(parseDevOptions([], { FIREFOX_BIN: '/opt/firefox/firefox' }).firefoxBinary).toBeUndefined();
  });
});
