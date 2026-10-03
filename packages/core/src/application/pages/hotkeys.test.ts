// The hotkey reference of the options page (architecture.md §9.1; ST-120, ST-121).

import { describe, expect, it } from 'vitest';

import { CATALOG_ACTION_IDS } from '@cg/contracts';

import { normalizeHubOrigin } from './client';
import { SCHEME_ACTIONS, hotkeyOf, hotkeyRows, inScheme, outsideSchemeHotkey, schemeHotkey } from './hotkeys';

describe('the hotkey reference', () => {
  it('[ST-120] the scheme rows come from the vendored table, per platform', () => {
    expect(SCHEME_ACTIONS).toContain('reply');
    expect(schemeHotkey('reply', 'mac')).toMatchObject({ display: '⌘E', delivery: 'delivered', fallback: null });
    expect(schemeHotkey('reply', 'win').display).toBe('Ctrl+E');
    expect(inScheme('reply')).toBe(true);
    expect(inScheme('chat-next')).toBe(false);
  });

  it('[ST-121] every catalog command has a row; the ones outside the scheme are marked', () => {
    for (const platform of ['mac', 'win'] as const) {
      const rows = hotkeyRows(platform);
      expect(rows.map((row) => row.id)).toEqual([...CATALOG_ACTION_IDS]);
      for (const row of rows) expect(row.outsideScheme).toBe(!inScheme(row.id));
    }
  });

  it('a combination the browser may keep is never shown as working', () => {
    expect(outsideSchemeHotkey('next-unread', 'mac')).toMatchObject({ display: '⌘U', delivery: 'unverified', fallback: { display: '⌥U' } });
    expect(outsideSchemeHotkey('quick-jump', 'win')).toMatchObject({ display: 'Ctrl+1–9', delivery: 'unverified', fallback: { display: 'Alt+1–9' } });
    expect(outsideSchemeHotkey('settings', 'mac')).toMatchObject({ delivery: 'reserved' });
    expect(outsideSchemeHotkey('settings', 'win')).toBeNull();
    // Sending has no key at all, by design.
    expect(hotkeyOf('send', 'mac')).toBeNull();
  });
});

describe('normalizeHubOrigin (ST-041)', () => {
  it('makes an origin of what a person types', () => {
    expect(normalizeHubOrigin('  hub.example.test ')).toBe('https://hub.example.test');
    expect(normalizeHubOrigin('HTTPS://Hub.Example.Test/some/path?x=1#y')).toBe('https://hub.example.test');
    expect(normalizeHubOrigin('https://hub.example.test:8443/')).toBe('https://hub.example.test:8443');
  });

  it('refuses what is no hub address', () => {
    for (const junk of ['', '   ', 'not an address', 'ftp://hub.example.test', 'https://user:pass@hub.example.test', 'https://', 'javascript:alert(1)']) expect(normalizeHubOrigin(junk), junk).toBeNull();
  });
});
