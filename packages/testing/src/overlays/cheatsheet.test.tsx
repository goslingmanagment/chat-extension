// The cheatsheet «?» (ui-design §3.8, §4.21, §6.3; HK-034, CS-014): a modal
// dialog of the key scheme by groups, with labels for this OS.

import { afterEach, describe, expect, it } from 'vitest';

import { DISMISSIBLE_OPEN_ATTRIBUTE } from '@cg/ui/kit';
import { cheatsheetSurface } from '@cg/ui/overlays/cheatsheet';

import { cheatsheet, ctxOf, entry, scenarioById, views } from '../scenarios/app-client';
import { type MountedKit, flush, keydown, mountSurface, scenarioOf, text } from '../dock/harness';

let kit: MountedKit | null = null;
afterEach(() => {
  kit?.unmount();
  kit = null;
  document.body.replaceChildren();
});

const mount = (scenario = scenarioById('gallery-ready')): MountedKit => mountSurface(cheatsheetSurface.view, scenario, 'cheatsheet', cheatsheetSurface.styles ?? []);
const CLOSE = { type: 'Navigate', to: { kind: 'surface', surface: 'cheatsheet', open: false } } as const;

describe('the cheatsheet', () => {
  it('[HK-034] is a modal dialog «Клавиши ChatGoose» with the scheme by groups; our host is marked dismissible while it is open', () => {
    kit = mount();
    const dialog = kit.$('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Клавиши ChatGoose');
    expect(kit.host.hasAttribute(DISMISSIBLE_OPEN_ATTRIBUTE)).toBe(true);
    expect(kit.$('.cg-scrim')).not.toBeNull();
    expect(kit.$$('.cg-cs__grp h3').map(text)).toEqual(['AI в открытом чате', 'Окна']);
    const rows = kit.$$('[data-cg-group="ai"] .cg-cs__row');
    expect(rows.map((row) => [text(row.querySelector('span')), text(row.querySelector('kbd'))])).toEqual([
      ['Reply', '⌘E'],
      ['Fix', '⌘I'],
      ['Hi', '⌘G'],
      ['Ping', '⌘P'],
      ['Review', '⌘⇧B'],
      ['Recap', '⌘⇧S'],
      ['Coach', '⌘⇧C'],
    ]);
    expect(text(kit.$('.cg-cs__note'))).toContain('«Отправить» в превью клавиши не имеет');
  });

  it('[HK-034] [CS-014] labels follow the OS; a key the browser keeps shows its fallback; «Отправить» has no key, Help is «пока убран»', () => {
    const win = ctxOf({ lang: 'en', platform: 'win' });
    kit = mount(scenarioOf([entry({ of: 'cheatsheet' }, cheatsheet(win, views.partial({ kind: 'host-degraded', capabilities: [] })))], { lang: 'en', platform: 'win' }));
    const keyOf = (label: string): string | null => {
      const row = kit?.$$('.cg-cs__row').find((item) => text(item.querySelector('span')) === label);
      return row?.querySelector('kbd')?.textContent ?? null;
    };
    expect(keyOf('Reply')).toBe('Ctrl+E');
    // Ctrl+U is the browser's: never printed as working, its fallback is.
    expect(keyOf('Next unread chat')).toBe('Alt+U');
    expect(keyOf('Send')).toBeNull();
    const help = kit.$$('.cg-cs__row').find((item) => text(item.querySelector('span')) === 'Help') as HTMLElement;
    expect(text(help.querySelector('.cg-cs__note-of'))).toBe('Help is removed for now');
  });

  it('Esc, «Закрыть» and a press on the scrim close it; focus stays inside and goes back where it was', async () => {
    const before = document.createElement('button');
    document.body.append(before);
    let restored = 0;
    kit = mount();
    (kit.deps.focus as { restore: () => boolean }).restore = () => {
      restored += 1;
      return true;
    };
    const dialog = kit.$('[role="dialog"]') as HTMLElement;
    const close = dialog.querySelector('button') as HTMLElement;
    expect(kit.root.activeElement).toBe(close);
    // Tab from the last control comes round to the first.
    await flush(() => close.dispatchEvent(keydown('Tab')));
    expect(kit.root.activeElement).toBe(close);
    await flush(() => close.click());
    await flush(() => dialog.dispatchEvent(keydown('Escape')));
    await flush(() => (kit?.$('.cg-scrim') as HTMLElement).dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(kit.client.dispatched).toEqual([CLOSE, CLOSE, CLOSE]);
    // Closing is the composition root unmounting the surface: focus returns through the host side.
    kit.unmount();
    kit = null;
    expect(restored).toBe(1);
  });

  it('a scheme that failed to load is an error card inside the dialog, which still closes', () => {
    kit = mount(scenarioById('gallery-error'));
    expect(kit.$('[role="dialog"] .cg-card')).not.toBeNull();
    expect(kit.$('[role="dialog"] button')).not.toBeNull();
  });
});
