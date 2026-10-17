import { describe, expect, it, vi } from 'vitest';

import { UI_THEMES, type UiTextSize, type UiTheme } from '@cg/contracts/settings';
import { SCHEME_ATTRIBUTE, TEXT_SIZE_ATTRIBUTE, type ColorScheme } from '@cg/contracts/vm';

import { SettableSignal, bindScheme, bindTextSize, mediaSchemeSignal, resolveScheme, resolvedSchemeSignal, type MediaQuerySource } from './scheme';

class FakeQuery implements MediaQuerySource {
  private readonly listeners = new Set<() => void>();
  constructor(public matches: boolean) {}
  addEventListener(_type: 'change', listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'change', listener: () => void): void {
    this.listeners.delete(listener);
  }
  flip(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) listener();
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
}

describe('[I18-005] theme host / system / light / dark (ui-design §2.1)', () => {
  it('resolves every setting inside ChatSpace and on extension pages', () => {
    const table: Record<UiTheme, [ColorScheme, ColorScheme]> = {
      // [inside ChatSpace (host dark, OS light), on a page (no host, OS light)]
      host: ['dark', 'light'],
      system: ['light', 'light'],
      light: ['light', 'light'],
      dark: ['dark', 'dark'],
    };
    for (const theme of UI_THEMES) {
      const [inChatSpace, onPage] = table[theme];
      expect(resolveScheme(theme, { host: 'dark', system: 'light' }), theme).toBe(inChatSpace);
      expect(resolveScheme(theme, { host: null, system: 'light' }), theme).toBe(onPage);
    }
  });

  it('switches live when the setting, ChatSpace’s class or the OS changes, without a reload', () => {
    const theme = new SettableSignal<UiTheme>('host');
    const host = new SettableSignal<ColorScheme>('light');
    const system = new SettableSignal<ColorScheme>('light');
    const scheme = resolvedSchemeSignal(theme, host, system);
    const seen: ColorScheme[] = [];
    scheme.subscribe((value) => seen.push(value));

    host.set('dark');
    expect(scheme.value).toBe('dark');
    theme.set('system');
    expect(scheme.value).toBe('light');
    system.set('dark');
    theme.set('light');
    expect(scheme.value).toBe('light');
    expect(seen).toEqual(['dark', 'light', 'dark', 'light']);

    scheme.dispose();
    theme.set('dark');
    expect(scheme.value).toBe('light');
  });

  it('extension pages pass no host signal: `host` follows the OS', () => {
    const scheme = resolvedSchemeSignal(new SettableSignal<UiTheme>('host'), null, new SettableSignal<ColorScheme>('dark'));
    expect(scheme.value).toBe('dark');
    scheme.dispose();
  });

  it('reads prefers-color-scheme and lets go of the query on dispose', () => {
    const query = new FakeQuery(false);
    const system = mediaSchemeSignal(query);
    const listener = vi.fn();
    system.subscribe(listener);
    expect(system.value).toBe('light');
    query.flip(true);
    expect(system.value).toBe('dark');
    expect(listener).toHaveBeenCalledWith('dark');
    system.dispose();
    expect(query.listenerCount).toBe(0);
  });

  it('mirrors the scheme on our host element as data-scheme, now and on change, until released', () => {
    const attributes = new Map<string, string>();
    const element = { setAttribute: (name: string, value: string) => attributes.set(name, value) } as unknown as Element;
    const scheme = new SettableSignal<ColorScheme>('light');
    const release = bindScheme(element, scheme);
    expect(attributes.get(SCHEME_ATTRIBUTE)).toBe('light');
    scheme.set('dark');
    expect(attributes.get(SCHEME_ATTRIBUTE)).toBe('dark');
    release();
    scheme.set('light');
    expect(attributes.get(SCHEME_ATTRIBUTE)).toBe('dark');
  });

  it('[X55] mirrors «Размер текста» as data-text-size on the surface root, now and on every change, until the surface leaves; no signal sets nothing', () => {
    const attributes = new Map<string, string>();
    const element = { setAttribute: (name: string, value: string) => attributes.set(name, value), removeAttribute: (name: string) => attributes.delete(name) } as unknown as Element;
    const size = new SettableSignal<UiTextSize>('normal');
    const off = bindTextSize(element, size);
    expect(attributes.get(TEXT_SIZE_ATTRIBUTE)).toBe('normal');
    size.set('large');
    expect(attributes.get(TEXT_SIZE_ATTRIBUTE)).toBe('large');
    off();
    size.set('normal');
    expect(attributes.get(TEXT_SIZE_ATTRIBUTE)).toBe('large');
    const bare = new Map<string, string>();
    bindTextSize({ setAttribute: (name: string, value: string) => bare.set(name, value) } as unknown as Element, undefined)();
    expect(bare.size).toBe(0);
  });

  it('a settable signal skips equal values and survives a listener leaving mid-notification', () => {
    const value = new SettableSignal(1);
    const calls: number[] = [];
    const offA = value.subscribe((next) => {
      calls.push(next);
      offA();
    });
    value.subscribe((next) => calls.push(next * 10));
    value.set(1);
    value.set(2);
    value.set(3);
    expect(calls).toEqual([2, 20, 30]);
  });
});
