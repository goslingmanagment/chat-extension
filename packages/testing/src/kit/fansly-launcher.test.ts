// The floating launcher's tooltip names the key of the shared scheme (decision X46; host-fansly launcher-view.ts): its
// chunk carries no scheme, so this holds its two labels to the vendored table's `spenders` row.

import { detectHotkeyPlatform, hotkeyLabel } from '@chatgoose/hotkeys';
import { describe, expect, it } from 'vitest';

import { createActionCatalog } from '@cg/core/domain/hotkeys';
import { newcomersKeyLabel, spendersKeyLabel } from '@cg/host-fansly/isolated/launcher-view';

describe('[host:fansly] the launcher’s key label', () => {
  it('[SP-001] is the scheme’s Spenders combination on a Mac and elsewhere', () => {
    expect(spendersKeyLabel('MacIntel')).toBe(hotkeyLabel('spenders', 'mac'));
    expect(spendersKeyLabel('Win32')).toBe(hotkeyLabel('spenders', 'win'));
    for (const platform of ['MacIntel', 'iPad', 'Win32', 'Linux x86_64', '']) expect(spendersKeyLabel(platform)).toBe(hotkeyLabel('spenders', detectHotkeyPlatform(platform)));
  });

  it('[NF-001] [X55] «Новые» names the tab catalog’s own key of the window on a Mac and elsewhere', () => {
    for (const platform of ['MacIntel', 'iPad', 'Win32', 'Linux x86_64', '']) expect(newcomersKeyLabel(platform)).toBe(createActionCatalog(detectHotkeyPlatform(platform)).entry('newcomers').hotkey?.display);
  });
});
