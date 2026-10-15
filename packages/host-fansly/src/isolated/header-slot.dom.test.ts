import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWorld, settle, type World } from '../testing/port-world';

let world: World | null = null;
afterEach(() => { world?.dispose(); world = null; history.replaceState({}, '', '/'); });
const A = '700000000000000021', B = '700000000000000022';

describe('Fansly ordered header slots', () => {
  it('[FS-REG-1] [FS-REG-4] the same roots follow route and contact replacement without changing the address', async () => {
    world = await startWorld('/messages', { fans: { [A]: '700000000000000011', [B]: '700000000000000012' } });
    world.page.openChat(A); await settle();
    const registration = world.port.header.mount(10);
    const later = world.port.header.mount(20);
    const row = () => document.querySelector('.content-header-sub-row');
    expect([...row()!.children].at(-2)).toBe(registration.host);
    expect([...row()!.children].at(-1)).toBe(later.host);
    expect(registration.host.shadowRoot).toBeNull();
    const old = row();
    const changed = vi.fn();
    const off = world.port.header.onChange(changed);
    world.page.setPartners(1); await settle();
    expect(row()).not.toBe(old);
    expect(changed).toHaveBeenCalledTimes(1);
    off();
    expect(registration.host.parentElement).toBe(row());
    expect(location.pathname).toBe(`/messages/${A}`);
    world.page.openChat(B); await settle();
    expect(registration.host.parentElement).toBe(row());
    world.page.setPartners(2); await settle();
    expect(registration.host.isConnected).toBe(false);
    world.page.setPartners(1); await settle();
    expect(registration.host.isConnected).toBe(true);
    registration.remove(); later.remove();
  });
  it('[FS-REG-4] neighbour nodes and typing cause no observer loop or moves', async () => {
    world = await startWorld('/messages', { fans: { [A]: '700000000000000011' } });
    world.page.openChat(A); await settle();
    const slot = world.port.header.mount(10); await settle();
    const row = slot.host.parentElement;
    const neighbour = document.createElement('div');
    document.querySelector('.message-content-header')?.append(neighbour);
    const before = await world.port.health();
    neighbour.append(document.createElement('span')); world.page.typing(true); await settle();
    expect(slot.host.parentElement).toBe(row);
    expect((await world.port.health()).isolated.anchors).toEqual(before.isolated.anchors);
    slot.remove();
  });
});
