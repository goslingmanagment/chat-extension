// The kit's environment for one mounted surface (architecture.md §10.2 п. 2–6):
// the AppClient and the ports from MountDeps, where our DOM lives (the closed
// shadow root and its host element), the clock, and the per-root services —
// the tooltip, the polite live region, the language and scheme signals.
// Components read it through hooks; nothing here reaches past our root.

import { signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo } from 'preact/hooks';

import { type CgCode, type I18nKey } from '@cg/contracts/errors';
import { type Locale } from '@cg/contracts/i18n/keys';
import {
  type ActionReceipt,
  type ColorScheme,
  type I18n,
  type I18nParams,
  type MountDeps,
  type MountSurfaceKind,
  type SurfaceGeometry,
  type UiAction,
  type ViewOf,
  type ViewSelector,
} from '@cg/contracts/vm';

import { holdAttribute } from './holds';
import { DISMISSIBLE_OPEN_ATTRIBUTE } from './layers';
import { useViewFrom } from './signals';
import { TooltipManager } from './tooltip-manager';

/**
 * What the kit reports to the composition root (which logs it, R18). Never
 * texts of conversations, drafts or model output: a kind, a code and the
 * error's class name only.
 */
export interface KitFailure {
  /** `page`: an uncaught error or rejection of one of our extension pages (ER-021). */
  readonly kind: 'render' | 'dispatch' | 'clipboard' | 'page';
  readonly surface: MountSurfaceKind | null;
  readonly code: CgCode;
  /** `TypeError`, `ContractViolation`… — the class, never the message. */
  readonly name: string;
}

export interface KitEnv {
  readonly deps: MountDeps;
  readonly root: ShadowRoot | Document;
  /** Our host element (gets data-cg-scheme, data-dismissible-open); null on a page rendered into the document. */
  readonly host: HTMLElement | null;
  readonly surface: MountSurfaceKind | null;
  readonly now: () => number;
  readonly report: (failure: KitFailure) => void;
  readonly language: ReadonlySignal<Locale>;
  readonly scheme: ReadonlySignal<ColorScheme>;
  readonly geometry: ReadonlySignal<SurfaceGeometry>;
  readonly tooltips: TooltipManager;
  /** `prefers-reduced-motion: reduce`, live (ui-design §2.9); CSS handles the rest. */
  readonly reducedMotion: ReadonlySignal<boolean>;
  readonly announcement: ReadonlySignal<{ readonly seq: number; readonly text: string }>;
  announce(text: string): void;
  /**
   * One holder of `data-dismissible-open` on our host while a window is open
   * (§6.3); the attribute goes when the last holder on that host lets go —
   * a nested confirmation closing leaves its window's mark. Idempotent release.
   */
  holdDismissible(): () => void;
  /** Ends the subscriptions and lets go of every hold this surface still has. */
  dispose(): void;
}

export interface KitEnvOptions {
  readonly deps: MountDeps;
  readonly root: ShadowRoot | Document;
  readonly host: HTMLElement | null;
  readonly surface?: MountSurfaceKind | null;
  readonly now?: () => number;
  readonly report?: (failure: KitFailure) => void;
}

/** The window a root lives in. */
export function windowOf(root: ShadowRoot | Document): Window | null {
  const document = 'ownerDocument' in root && root.ownerDocument !== null ? root.ownerDocument : root;
  return document.defaultView;
}

function motionQuery(root: ShadowRoot | Document): MediaQueryList | null {
  try {
    return windowOf(root)?.matchMedia('(prefers-reduced-motion: reduce)') ?? null;
  } catch {
    return null;
  }
}

export function createKitEnv(options: KitEnvOptions): KitEnv {
  const { deps } = options;
  const language: Signal<Locale> = signal(deps.i18n.language);
  const scheme: Signal<ColorScheme> = signal(deps.scheme.value);
  const geometry: Signal<SurfaceGeometry> = signal(deps.geometry.value);
  const announcement = signal({ seq: 0, text: '' });
  const offs = [
    deps.i18n.subscribe((next) => {
      language.value = next;
    }),
    deps.scheme.subscribe((next) => {
      scheme.value = next;
    }),
    deps.geometry.subscribe((next) => {
      geometry.value = next;
    }),
  ];
  const tooltips = new TooltipManager();
  const motion = motionQuery(options.root);
  const reducedMotion: Signal<boolean> = signal(motion?.matches ?? false);
  const onMotion = (): void => {
    reducedMotion.value = motion?.matches ?? false;
  };
  motion?.addEventListener('change', onMotion);
  const holds = new Set<() => void>();
  return {
    deps,
    root: options.root,
    host: options.host,
    surface: options.surface ?? null,
    now: options.now ?? Date.now,
    report: options.report ?? (() => undefined),
    language,
    scheme,
    geometry,
    tooltips,
    reducedMotion,
    announcement,
    announce(text) {
      if (text === '') return;
      announcement.value = { seq: announcement.value.seq + 1, text };
    },
    holdDismissible() {
      if (options.host === null) return () => undefined;
      const release = holdAttribute(options.host, DISMISSIBLE_OPEN_ATTRIBUTE);
      const once = (): void => {
        if (holds.delete(once)) release();
      };
      holds.add(once);
      return once;
    },
    dispose() {
      for (const off of offs) off();
      motion?.removeEventListener('change', onMotion);
      tooltips.dispose();
      for (const release of [...holds]) release();
    },
  };
}

const KitContext = createContext<KitEnv | null>(null);
/** `ui.hints` (ST-125): descriptions in tooltips; reasons of unavailability show regardless. */
const HintsContext = createContext<boolean>(true);

export interface KitProviderProps {
  readonly env: KitEnv;
  readonly children?: ComponentChildren;
}

/** Provides an environment the caller built (and disposes); see `KitRoot` for the usual wiring. */
export function KitProvider({ env, children }: KitProviderProps) {
  return <KitContext.Provider value={env}>{children}</KitContext.Provider>;
}

export function Hints({ value, children }: { readonly value: boolean; readonly children?: ComponentChildren }) {
  return <HintsContext.Provider value={value}>{children}</HintsContext.Provider>;
}

export function useKit(): KitEnv {
  const env = useContext(KitContext);
  if (env === null) throw new Error('ui/kit: a kit component rendered outside KitProvider');
  return env;
}

export function useHints(): boolean {
  return useContext(HintsContext);
}

/** The I18n port; reading it subscribes the component to language switches (I18-001). */
export function useI18n(): I18n {
  const env = useKit();
  void env.language.value;
  return env.deps.i18n;
}

/** `t(key, params)` of the current language. */
export function useT(): (key: I18nKey, params?: I18nParams) => string {
  const i18n = useI18n();
  return useCallback((key: I18nKey, params?: I18nParams) => i18n.t(key, params), [i18n, i18n.language]);
}

/** The resolved scheme as a signal. */
export function useScheme(): ReadonlySignal<ColorScheme> {
  return useKit().scheme;
}

export function useGeometry(): ReadonlySignal<SurfaceGeometry> {
  return useKit().geometry;
}

/** `useView(selector)` of §10.2: the view model as a signal, live. */
export function useView<S extends ViewSelector>(selector: S): ReadonlySignal<Readonly<ViewOf<S>>> {
  return useViewFrom(useKit().deps.client, selector);
}

/**
 * Dispatches a UiAction. A rejected dispatch (a broken contract, a dead
 * background) is reported, never thrown into a click handler; the receipt is
 * null then.
 */
export function useDispatch(): (action: UiAction) => Promise<ActionReceipt | null> {
  const env = useKit();
  return useCallback(
    (action: UiAction) =>
      env.deps.client.dispatch(action).catch((error: unknown) => {
        env.report({ kind: 'dispatch', surface: env.surface, code: 'CG-UI-FAILED', name: error instanceof Error ? error.name : typeof error });
        return null;
      }),
    [env],
  );
}

/** Announces through the root's one polite live region (ui-design §6.2). */
export function useAnnounce(): (text: string) => void {
  const env = useKit();
  return useCallback((text: string) => env.announce(text), [env]);
}

/** `prefers-reduced-motion: reduce` of this window, live. */
export function useReducedMotion(): boolean {
  return useKit().reducedMotion.value;
}

/** The surface's clock (the fake clock in the stand). */
export function useNowFn(): () => number {
  return useKit().now;
}

/**
 * While `open`, our host carries `data-dismissible-open` (§6.3: ChatSpace's
 * Esc leaves its tab alone). Counted per host: an inner dialog closing keeps
 * the mark of the window still open under it. Set before paint, dropped at
 * once on close.
 */
export function useDismissibleOpen(open: boolean): void {
  const env = useKit();
  useLayoutEffect(() => (open ? env.holdDismissible() : undefined), [open, env]);
}

/** A stable environment for a component tree; disposed with it. */
export function useKitEnv(options: KitEnvOptions): KitEnv {
  const env = useMemo(() => createKitEnv(options), [options.deps, options.root, options.host]);
  useEffect(() => () => env.dispose(), [env]);
  return env;
}
