import { describe, expect, it, vi } from 'vitest';
import type { FanslyClient } from '@cg/fansly-api';
import { FanslyApiError } from '@cg/fansly-api';
import type { BackgroundKit, HostSiteSender } from '../src/composition/background/host-module';
import { readRegistration, registrationFanId } from '../bg/fansly/registration';

const request = { pageId: 7, hostAccountId: '123', groupId: '456' };
const sender: HostSiteSender = { kind: 'tab', host: 'fansly-web', tabId: 1, tabSessionId: 'tab', url: 'https://fansly.com/messages/456' };
const group = { id: '456', type: 1, users: [{ userId: '123' }, { userId: '789' }] };
function world() {
  let enabled = true;
  const kit = { hub: {
    session: () => ({ hubOrigin: 'test', userId: 1 }),
    page: () => Promise.resolve({ ok: true }),
    bootstrap: () => ({ pages: [{ pageId: 7, platform: 'fansly', platformAccountId: '123', features: { registration: { available: enabled } } }] }),
  }, router: { tabs: () => ['tab'] } } as unknown as BackgroundKit;
  const start = vi.fn(() => Promise.resolve({ response: group, status: 200 }));
  const cancel = vi.fn();
  const prepare = vi.fn(() => Promise.resolve({ start, cancel }));
  const client = { prepare } as unknown as FanslyClient;
  return { kit, client, prepare, start, cancel, disable: () => { enabled = false; } };
}

describe('Fansly registration background', () => {
  it('[FS-REG-2] [FS-REG-3] accepts only the two-member group containing this creator, never its group id or createdBy', () => {
    expect(registrationFanId({ ...group, createdBy: '456' }, '456', '123')).toBe('789');
    for (const bad of [{ ...group, id: '789' }, { ...group, type: 3 }, { ...group, users: [...group.users, { userId: '999' }] }, { ...group, users: [{ userId: '123' }, { userId: '123' }] }, { ...group, users: [{ userId: '456' }, { userId: '789' }] }, { ...group, users: [{ userId: '123' }, { userId: 789 }] }]) expect(registrationFanId(bad, '456', '123')).toBeNull();
  });
  it('[FS-REG-2] one prepare/start with registration admission, no account/history request', async () => {
    const w = world();
    expect(await readRegistration(w.kit, w.client, request, sender)).toEqual({ ok: true, fanId: '789' });
    expect(w.prepare).toHaveBeenCalledExactlyOnceWith({ account: '123', purpose: 'registration', route: 'group.detail', path: { group: '456' } });
    expect(w.start).toHaveBeenCalledTimes(1);
  });
  it('[FS-REG-2] cooling refuses before start; sent failures are never retried', async () => {
    const w = world(); w.prepare.mockRejectedValueOnce(new FanslyApiError('cooling', { sent: false, retryAt: 999 }));
    expect(await readRegistration(w.kit, w.client, request, sender)).toMatchObject({ ok: false, error: { code: 'CG-FAN-RATE-LIMIT' } });
    expect(w.start).not.toHaveBeenCalled();
    w.start.mockRejectedValueOnce(new FanslyApiError('http', { sent: true, httpStatus: 500 }));
    expect(await readRegistration(w.kit, w.client, request, sender)).toMatchObject({ ok: false });
    expect(w.start).toHaveBeenCalledTimes(1);
  });
  it('owner flag/account mismatch refuses before network, and a flag lost during preparation cancels the pass', async () => {
    const w = world();
    expect(await readRegistration(w.kit, w.client, { ...request, hostAccountId: '789' }, sender)).toMatchObject({ ok: false });
    expect(w.prepare).not.toHaveBeenCalled();
    w.prepare.mockImplementationOnce(() => { w.disable(); return Promise.resolve({ start: w.start, cancel: w.cancel }); });
    expect(await readRegistration(w.kit, w.client, request, sender)).toMatchObject({ ok: false });
    expect(w.start).not.toHaveBeenCalled(); expect(w.cancel).toHaveBeenCalledTimes(1);
  });
});
