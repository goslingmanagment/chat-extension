import { describe, expect, it, vi } from 'vitest';

import { createConsent, TECHNICAL_CONSENT } from './permissions';
import { createFakeBrowser, flush, pageSender } from './test-support/fake-browser';

describe('permissions (§3, §9.6)', () => {
  it('consent: technicalAndInteraction is checked through getAll().data_collection, revoked anywhere, and fails closed', async () => {
    const fake = createFakeBrowser();
    const background = fake.startBackground().api;
    const consent = createConsent(background);
    const seen: boolean[] = [];
    const off = consent.onChange((granted) => seen.push(granted));
    expect(await consent.granted()).toBe(false);
    expect(await createConsent(fake.context(pageSender(fake, 'options')).api).request()).toBe(true);
    expect(fake.permissions.data_collection.has(TECHNICAL_CONSENT)).toBe(true);
    expect(await consent.granted()).toBe(true);
    // The person revokes it in about:addons: the listener hears it at once.
    fake.revokeFromBrowserUi({ data_collection: [TECHNICAL_CONSENT] });
    await flush();
    expect(seen).toEqual([true, false]);
    expect(await consent.granted()).toBe(false);
    // Unrelated permission changes are not consent changes.
    fake.revokeFromBrowserUi({ origins: ['https://x.test/*'] });
    await flush();
    expect(seen).toEqual([true, false]);
    expect(await consent.request()).toBe(true);
    expect(await consent.revoke()).toBe(true);
    await flush();
    expect(seen).toEqual([true, false, true, false]);
    off();
    vi.spyOn(background.permissions, 'getAll').mockRejectedValueOnce(new Error('broken'));
    expect(await consent.granted()).toBe(false);
    // check() tells a failure (null) from a "no" (false): a failed check is not a revoke.
    expect(await consent.check()).toBe(false);
    vi.spyOn(background.permissions, 'getAll').mockRejectedValueOnce(new Error('broken'));
    expect(await consent.check()).toBeNull();
  });
});
