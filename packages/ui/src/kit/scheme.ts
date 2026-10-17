// Which scheme our surfaces draw in (ui-design §2.1, ST-122, I18-005):
// `ui.theme` host | system | light | dark, resolved against ChatSpace's
// class on <html> (inside ChatSpace) or the OS (on extension pages, where
// `host` means `system`). The result is a value signal; the mount mirrors it
// to `data-scheme` on our host element, which the dark token values key on.

import { type UiTextSize, type UiTheme } from '@cg/contracts/settings';
import { SCHEME_ATTRIBUTE, TEXT_SIZE_ATTRIBUTE, type ColorScheme, type ValueSignal } from '@cg/contracts/vm';

export interface SchemeInputs {
  /** ChatSpace's scheme from its <html> class; null on extension pages (no host). */
  readonly host: ColorScheme | null;
  /** `prefers-color-scheme` of the OS. */
  readonly system: ColorScheme;
}

export function resolveScheme(theme: UiTheme, inputs: SchemeInputs): ColorScheme {
  switch (theme) {
    case 'light':
    case 'dark':
      return theme;
    case 'system':
      return inputs.system;
    case 'host':
      return inputs.host ?? inputs.system;
  }
}

/** A value signal the caller owns and must dispose. */
export interface OwnedSignal<T> extends ValueSignal<T> {
  dispose(): void;
}

/** A plain settable value signal (pages, tests, the gallery). */
export class SettableSignal<T> implements ValueSignal<T> {
  private readonly listeners = new Set<(value: T) => void>();
  constructor(private current: T) {}
  get value(): T {
    return this.current;
  }
  set(next: T): void {
    if (Object.is(next, this.current)) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** The part of MediaQueryList the OS scheme needs. */
export interface MediaQuerySource {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

/** The OS scheme from `matchMedia('(prefers-color-scheme: dark)')`. */
export function mediaSchemeSignal(darkQuery: MediaQuerySource): OwnedSignal<ColorScheme> {
  const signal = new SettableSignal<ColorScheme>(darkQuery.matches ? 'dark' : 'light');
  const onChange = (): void => signal.set(darkQuery.matches ? 'dark' : 'light');
  darkQuery.addEventListener('change', onChange);
  return {
    get value() {
      return signal.value;
    },
    subscribe: (listener) => signal.subscribe(listener),
    dispose: () => darkQuery.removeEventListener('change', onChange),
  };
}

/** `ui.theme` × host × OS → the resolved scheme, live (I18-005: switches without a reload). */
export function resolvedSchemeSignal(
  theme: ValueSignal<UiTheme>,
  host: ValueSignal<ColorScheme> | null,
  system: ValueSignal<ColorScheme>,
): OwnedSignal<ColorScheme> {
  const compute = (): ColorScheme => resolveScheme(theme.value, { host: host?.value ?? null, system: system.value });
  const signal = new SettableSignal<ColorScheme>(compute());
  const update = (): void => signal.set(compute());
  const offs = [theme.subscribe(update), system.subscribe(update), ...(host === null ? [] : [host.subscribe(update)])];
  return {
    get value() {
      return signal.value;
    },
    subscribe: (listener) => signal.subscribe(listener),
    dispose: () => {
      for (const off of offs) off();
    },
  };
}

/**
 * «Размер текста» as `data-text-size` on a surface's own root (`.cg-root`, inside the closed shadow root), now and on
 * every change (decision X55): the type tokens key the larger scale on it. Never on the host element — the page sees
 * nothing of ours there but neutral attributes (X22). No signal (an extension page, a test): nothing is set, the scale
 * is the normal one. Returns the unsubscribe; the root leaves with its surface.
 */
export function bindTextSize(surfaceRoot: Element, textSize: ValueSignal<UiTextSize> | undefined): () => void {
  if (textSize === undefined) return () => undefined;
  surfaceRoot.setAttribute(TEXT_SIZE_ATTRIBUTE, textSize.value);
  return textSize.subscribe((value) => surfaceRoot.setAttribute(TEXT_SIZE_ATTRIBUTE, value));
}

/** Mirrors the scheme on our host element (or <html> of a page) as `data-scheme`, now and on every change. */
export function bindScheme(target: Element, scheme: ValueSignal<ColorScheme>): () => void {
  target.setAttribute(SCHEME_ATTRIBUTE, scheme.value);
  return scheme.subscribe((value) => target.setAttribute(SCHEME_ATTRIBUTE, value));
}
