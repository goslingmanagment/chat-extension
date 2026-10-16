import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LongRunActions } from '../../e2e/long/actions';
import type { FanslyShift } from '../../e2e/support/fansly-shift';
import type { FakeHubControlClient } from '../fake-hub/control-client';
import { WORLD } from '../scenarios/hub';

const h = vi.hoisted(() => ({
  opened: false, generated: false, sent: false, fan: '', text: '',
  url: vi.fn(), keys: vi.fn(), waitUntil: vi.fn(), pageRpc: vi.fn(), command: vi.fn(), status: vi.fn(),
  press: vi.fn(), read: vi.fn(), write: vi.fn(), toFansly: vi.fn(), toPages: vi.fn(),
}));
vi.mock('@wdio/globals', async () => ({
  expect: (await import('vitest')).expect,
  browser: { url: h.url, keys: h.keys, waitUntil: h.waitUntil, $: () => ({ getText: () => Promise.resolve(h.text) }) },
}));
vi.mock('../../e2e/support/extension', () => ({ pageRpc: h.pageRpc, readLocalStorage: vi.fn(), writeLocalStorage: h.write, waitForReport: vi.fn() }));
vi.mock('../../e2e/support/fake-hub', () => ({ testBuildPage: (path = 'quiet.html') => `moz-extension://test/${path}` }));
vi.mock('../../e2e/support/shift', () => ({ dockIs: vi.fn() }));
vi.mock('../../e2e/support/fansly-stand', () => ({
  FANSLY_MAIN: { list: '.messages' }, fakeFansly: () => ({ command: h.command }), callFansly: vi.fn(), openFanslyStand: vi.fn(),
}));
vi.mock('../../e2e/support/ours', () => ({
  ours: () => ({ click: vi.fn() }), pressOurs: h.press, readOurs: h.read, waitOursByText: vi.fn(),
  oursExists: (_where: string, selector: string) => Promise.resolve(selector === '.cg-fnw' ? h.opened : selector.includes('.cg-fnc__ai') ? h.generated : true),
}));

function actions() {
  const count = vi.fn();
  const expectSend = vi.fn();
  const shift: FanslyShift = { fanslyTab: 'fansly', pagesTab: 'pages', toFansly: h.toFansly, toPages: h.toPages, rpc: vi.fn() };
  const hub = { command: h.command, status: h.status } as unknown as FakeHubControlClient;
  return { work: new LongRunActions(shift, hub, '.', count, vi.fn(), expectSend), count, expectSend };
}

beforeEach(() => {
  vi.resetAllMocks();
  h.opened = false; h.generated = false; h.sent = false; h.fan = ''; h.text = '';
  h.waitUntil.mockImplementation(async (probe: () => Promise<boolean>, options: { timeoutMsg?: string }) => {
    if (!await probe()) throw new Error(options.timeoutMsg ?? 'condition not reached');
  });
  h.keys.mockImplementation(() => { h.opened = false; return Promise.resolve(); });
  h.pageRpc.mockImplementation((type: string) => {
    if (type === 'site.access') return Promise.resolve({ ok: true, payload: { enabled: true, granted: true, registered: true } });
    h.opened = true;
    return Promise.resolve({ ok: true, payload: { delivered: true } });
  });
  h.command.mockImplementation((input: { op: string; followerId?: string; patch?: { aiTexts: Record<string, string> } }) => {
    if (input.followerId !== undefined) h.fan = input.followerId;
    if (input.patch?.aiTexts !== undefined) h.text = input.patch.aiTexts['hi-greeting'] ?? '';
    return Promise.resolve({ ok: true, groupId: '980000000000000001' });
  });
  h.press.mockImplementation((_where: string, _selector: string, text: string | RegExp) => {
    if (text === 'Сгенерировать') h.generated = true;
    if (text === 'Отправить →') h.sent = true;
    return Promise.resolve();
  });
  h.read.mockImplementation((_where: string, selector: string) => Promise.resolve(selector.includes('textarea') ? h.text : h.sent ? 'greeted' : 'ready'));
  h.status.mockImplementation(() => Promise.resolve({ claims: h.sent ? [{ pageLabel: WORLD.pages.fansly.pageLabel, fanRef: h.fan, greeting: 'confirmed', attempts: [{ state: 'sent' }] }] : [] }));
});

describe('P16b stand actions without a browser', () => {
  it('opens Fansly newcomers through the popup, checks access, pauses/resumes and closes; no palette key', async () => {
    const { work, count } = actions();
    await work.newcomers();
    expect(h.pageRpc.mock.calls).toEqual([
      ['site.access', { host: 'fansly-web' }],
      ['tab.command', { command: { kind: 'surface', surface: 'newcomers' } }],
    ]);
    expect(h.toFansly.mock.invocationCallOrder[0]).toBeLessThan(h.toPages.mock.invocationCallOrder[0]!);
    expect(h.press.mock.calls.map((call) => String(call[2]))).toEqual(['Пауза', '/^Проверить оставшихся/']);
    expect(h.keys.mock.calls).toEqual([[['Escape']]]);
    expect(count).toHaveBeenCalledExactlyOnceWith('newcomers');
  });

  it('stops at the permissions gate and restores the quiet page without launching the pass', async () => {
    h.pageRpc.mockResolvedValue({ ok: true, payload: { enabled: false, granted: true, registered: false } });
    const { work, count } = actions();
    await expect(work.newcomers()).rejects.toThrow();
    expect(h.pageRpc).toHaveBeenCalledTimes(1);
    expect(h.url).toHaveBeenLastCalledWith('moz-extension://test/quiet.html');
    expect(count).not.toHaveBeenCalled();
  });

  it('generates and clicks send in the P10c card, then requires durable custody and the native chat text', async () => {
    const { work, count, expectSend } = actions();
    await work.greeting();
    expect(h.press.mock.calls.map((call) => String(call[2]))).toEqual(['/^Все \\d+$/', 'Сгенерировать', 'Отправить →']);
    expect(expectSend).toHaveBeenCalledTimes(1);
    expect(h.write).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledExactlyOnceWith('greeting');
  });

  it('does not count a greeting whose click has no confirmed receipt', async () => {
    h.status.mockResolvedValue({ claims: [] });
    const { work, count, expectSend } = actions();
    await expect(work.greeting()).rejects.toThrow('greeting custody did not confirm exactly one send');
    expect(expectSend).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
  });
});
