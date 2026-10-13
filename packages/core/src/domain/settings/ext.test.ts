// `settings.ext` read and written field by field (1.15.0, R20 FS-SET-1; host:
// fansly-web): a default is never written down and never replaces a stored
// value, a field the patch does not name stays as stored — known or not —
// and a newer version is read-only.

import { DEFAULT_SETTINGS_EXT, SettingsExtSchema } from '@cg/contracts/settings-ext';
import { describe, expect, it } from 'vitest';

import { applySettingsExtPatch, loadStoredSettingsExt } from './index';

const FANSLY = 'fansly-web';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('[RB-012] [host:fansly] reading settings.ext (fansly-web)', () => {
  it('nothing stored: the defaults, fresh', () => {
    expect(loadStoredSettingsExt(undefined)).toEqual({ kind: 'fresh', ext: DEFAULT_SETTINGS_EXT });
  });

  it('only what the person set is stored; the rest reads as defaults without being named', () => {
    const outcome = loadStoredSettingsExt({ v: 1, hosts: { [FANSLY]: { enabled: true, sound: { subscribersTone: 'bell' } } } });
    expect(outcome).toEqual({
      kind: 'current',
      repaired: [],
      ext: { ...DEFAULT_SETTINGS_EXT, hosts: { [FANSLY]: { ...DEFAULT_SETTINGS_EXT.hosts[FANSLY], enabled: true, sound: { messagesTone: 'chime', subscribersTone: 'bell' } } } },
    });
    if (outcome.kind === 'current') expect(SettingsExtSchema.safeParse(outcome.ext).success).toBe(true);
  });

  it('a broken field reads as its default and is named by path; its neighbours keep their stored values', () => {
    const outcome = loadStoredSettingsExt({ v: 1, hosts: { [FANSLY]: { enabled: 'yes', viaTab: true, notesView: 'left', sound: 7 } }, windows: { deep: 2000 } });
    expect(outcome.kind).toBe('current');
    if (outcome.kind !== 'current') return;
    expect(outcome.repaired).toEqual([`hosts.${FANSLY}.sound`, `hosts.${FANSLY}.enabled`, `hosts.${FANSLY}.notesView`, 'windows.deep']);
    expect(outcome.ext.hosts[FANSLY]).toEqual({ ...DEFAULT_SETTINGS_EXT.hosts[FANSLY], viaTab: true });
    expect(outcome.ext.windows.deep).toBeNull();
  });

  it('not an object, or no version: this build’s version, defaults where nothing reads', () => {
    expect(loadStoredSettingsExt('garbage')).toEqual({ kind: 'current', ext: DEFAULT_SETTINGS_EXT, repaired: ['settings.ext'] });
    const outcome = loadStoredSettingsExt({ windows: { deep: 4000 } });
    expect(outcome).toMatchObject({ kind: 'current', repaired: ['v'], ext: { windows: { deep: 4000 } } });
  });

  it('[ST-016] a newer version: what reads, read-only', () => {
    expect(loadStoredSettingsExt({ v: 2, hosts: { [FANSLY]: { enabled: true } }, windows: { deep: 4500 }, later: { x: 1 } })).toEqual({
      kind: 'newer',
      storedVersion: 2,
      ext: { ...DEFAULT_SETTINGS_EXT, hosts: { [FANSLY]: { ...DEFAULT_SETTINGS_EXT.hosts[FANSLY], enabled: true } }, windows: { deep: 4500 } },
    });
  });
});

describe('[RB-011] [host:fansly] writing settings.ext (fansly-web): only what the patch names', () => {
  it('a fresh store gets the named fields and its version, never the defaults', () => {
    const outcome = applySettingsExtPatch(undefined, { hosts: { [FANSLY]: { enabled: true } } });
    expect(outcome).toMatchObject({ ok: true, changed: true, stored: { v: 1, hosts: { [FANSLY]: { enabled: true } } } });
    if (outcome.ok) expect(outcome.ext.hosts[FANSLY]).toEqual({ ...DEFAULT_SETTINGS_EXT.hosts[FANSLY], enabled: true });
    // Nothing named, nothing stored: nothing to write.
    expect(applySettingsExtPatch(undefined, {})).toMatchObject({ ok: true, changed: false });
  });

  it('keeps every other stored field as it is: unknown ones of a later build, broken ones, other sites', () => {
    const stored = {
      v: 1,
      hosts: { [FANSLY]: { enabled: true, notesView: 'left', later: 'x', sound: { messagesTone: 'drop', other: 1 } }, 'some-site': { a: 1 } },
      windows: { deep: 4000, ping: 'later' },
      later: [1, 2],
    };
    const before = clone(stored);
    const outcome = applySettingsExtPatch(stored, { hosts: { [FANSLY]: { viaTab: true, sound: { subscribersTone: 'knock' } } } });
    expect(stored).toEqual(before);
    expect(outcome).toEqual({
      ok: true,
      changed: true,
      stored: {
        v: 1,
        hosts: { [FANSLY]: { enabled: true, notesView: 'left', later: 'x', viaTab: true, sound: { messagesTone: 'drop', other: 1, subscribersTone: 'knock' } }, 'some-site': { a: 1 } },
        windows: { deep: 4000, ping: 'later' },
        later: [1, 2],
      },
      ext: {
        v: 1,
        hosts: { [FANSLY]: { enabled: true, viaTab: true, notesView: 'drawer', sound: { messagesTone: 'drop', subscribersTone: 'knock' } } },
        windows: { deep: 4000 },
      },
    });
  });

  it('the depth: set above 3000, removed with null; a value the key does not take is refused', () => {
    const set = applySettingsExtPatch({ v: 1 }, { windows: { deep: 5000 } });
    expect(set).toMatchObject({ ok: true, changed: true, stored: { v: 1, windows: { deep: 5000 } }, ext: { windows: { deep: 5000 } } });
    const removed = applySettingsExtPatch(set.ok ? set.stored : null, { windows: { deep: null } });
    expect(removed).toMatchObject({ ok: true, changed: true, stored: { v: 1, windows: {} }, ext: { windows: { deep: null } } });
    expect(applySettingsExtPatch({ v: 1 }, { windows: { deep: 3000 } })).toEqual({ ok: false, reason: 'invalid' });
    expect(applySettingsExtPatch({ v: 1 }, { windows: { deep: 5001 } })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('[ST-013] the same value again is no change (a resent patch after a lost confirmation)', () => {
    const stored = { v: 1, hosts: { [FANSLY]: { enabled: true } } };
    expect(applySettingsExtPatch(stored, { hosts: { [FANSLY]: { enabled: true } } })).toMatchObject({ ok: true, changed: false });
  });
});
