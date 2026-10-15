import { describe, expect, it, vi } from 'vitest';
import type { RegistrationTarget } from '@cg/contracts/registration-fansly';
import { createRegistration } from './registration';

const fanId = ((BigInt(Date.parse('2024-01-01T00:00:00Z') - 1561494360000)) << 22n).toString();
const a: RegistrationTarget = { accountId: '123', loginEpoch: '1', groupId: '456', fanId };
function world() {
  let target: RegistrationTarget | null = a;
  let session: string | null = '123|1';
  const read = vi.fn(() => Promise.resolve({ ok: true as const, fanId }));
  const client = createRegistration({ session: () => session, target: () => target, read });
  return { client, read, target(value: RegistrationTarget | null) { target = value; client.sync(); }, session(value: string | null) { session = value; client.sync(); } };
}

describe('Fansly registration, a click only', () => {
  it('[FS-REG-2] decodes the fan, not the group, and performs no request with a known fan', async () => {
    const w = world();
    expect(w.client.view().state).toBe('idle');
    await w.client.reveal();
    expect(w.client.view().registeredAt).toBe(Date.parse('2024-01-01T00:00:00Z'));
    expect(w.read).not.toHaveBeenCalled();
  });
  it('[FS-REG-2] coalesces clicks while the one read is pending; no automatic repeats after a failure', async () => {
    const w = world(); w.target({ ...a, fanId: null });
    let reject!: (error: Error) => void;
    w.read.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    const pending = w.client.reveal();
    await w.client.reveal();
    expect(w.read).toHaveBeenCalledTimes(1);
    reject(new Error('offline')); await pending;
    w.client.sync(); w.target(null); w.target({ ...a, fanId: null });
    expect(w.read).toHaveBeenCalledTimes(1);
    expect(w.client.view().state).toBe('failed');
    await w.client.reveal(); // A new explicit click may try once again.
    expect(w.read).toHaveBeenCalledTimes(2);
  });
  it('[FS-REG-3] keeps answers through chats, gallery/inbox and back, but clears them on account/login change', async () => {
    const w = world(); await w.client.reveal();
    w.target({ ...a, groupId: '789' }); expect(w.client.view().state).toBe('idle');
    w.target(null); w.target(a); expect(w.client.view().state).toBe('shown');
    w.session('123|2'); expect(w.client.view().state).toBe('idle');
    w.session(null); expect(w.client.view().state).toBe('idle');
  });
  it('[FS-REG-3] a late answer never paints another group or survives an account switch/disposal', async () => {
    const w = world(); w.target({ ...a, fanId: null });
    let resolve!: (value: { ok: true; fanId: string }) => void;
    w.read.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    const pending = w.client.reveal();
    w.target({ ...a, groupId: '789' }); resolve({ ok: true, fanId }); await pending;
    expect(w.client.view().state).toBe('idle');
    w.target(a); expect(w.client.view().state).toBe('shown');
    w.session('456|2'); w.target({ ...a, fanId: null });
    w.read.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    const late = w.client.reveal(); w.session('789|3'); resolve({ ok: true, fanId }); await late;
    expect(w.client.view().state).toBe('idle');
    w.client.dispose(); await w.client.reveal(); expect(w.read).toHaveBeenCalledTimes(2);
  });
});
