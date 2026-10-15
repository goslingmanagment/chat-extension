// Test harness of the dock and the overlays (R14): the real surfaces of
// `@cg/ui/dock` and `@cg/ui/overlays` mounted into a closed shadow root over
// a FakeAppClient scenario, with the shipped I18n. Scenarios are either the
// contract's own (by id) or built on the spot from its view-model builders.

import { type FunctionComponent } from 'preact';
import { act } from 'preact/test-utils';

import { type DockVM, type Locale, type MountSurfaceKind, type ViewSelector } from '@cg/contracts';
import { DOCK_STYLE, DockView, type DockParts } from '@cg/ui/dock';
import { type StyleSource } from '@cg/ui/kit';

import { type MountKitOptions, type MountedKit, mountKit } from '../kit/harness';
import { NOW, ctxOf, dock, entry, type AppClientScenario, type DockOptions, type ScenarioCtx, type ScenarioStep, type ScenarioViewEntry } from '../scenarios/app-client';

export { flush, kitWorld, mountKit, mountKitSettled, type MountedKit } from '../kit/harness';

export const DOCK: ViewSelector = { of: 'dock' };

export interface AdHoc {
  readonly lang?: Locale;
  readonly platform?: ScenarioCtx['platform'];
  readonly debug?: boolean;
  readonly scheme?: AppClientScenario['scheme'];
  readonly steps?: readonly ScenarioStep[];
  readonly reactions?: AppClientScenario['reactions'];
}

/** A scenario made of the given views (everything else falls back to the fake's defaults). */
export function scenarioOf(views: readonly ScenarioViewEntry[], options: AdHoc = {}): AppClientScenario {
  const lang = options.lang ?? 'ru';
  return {
    id: 'ad-hoc',
    title: 'ad hoc',
    covers: [],
    language: lang,
    platform: options.platform ?? 'mac',
    scheme: options.scheme ?? 'light',
    theme: 'host',
    debug: options.debug ?? false,
    now: NOW,
    views,
    ...(options.steps === undefined ? {} : { steps: options.steps }),
    ...(options.reactions === undefined ? {} : { reactions: options.reactions }),
  };
}

export const ctx = ctxOf({ lang: 'ru', platform: 'mac' });

/** A scenario whose dock is `dock(ctx, status, patch)`. */
export function dockScenario(vm: DockVM, options: AdHoc = {}, more: readonly ScenarioViewEntry[] = []): AppClientScenario {
  return scenarioOf([entry({ of: 'dock' }, vm), ...more], options);
}

export const dockVm = (status: DockVM['status'] = 'ready', options: DockOptions = {}, context: ScenarioCtx = ctx): DockVM => dock(context, status, options);

export interface MountDockOptions {
  readonly language?: Locale;
  readonly parts?: Partial<DockParts>;
  readonly now?: () => number;
  readonly parent?: HTMLElement;
  /** The site the dock speaks for (mountKit's `site`); default: ChatSpace's. */
  readonly site?: MountKitOptions['site'];
}

/** The real dock over a scenario, in a closed shadow root. */
export function mountDock(scenario: string | AppClientScenario, options: MountDockOptions = {}): MountedKit {
  const parts = options.parts;
  return mountSurface(() => <DockView {...(parts === undefined ? {} : { parts })} />, scenario, 'dock', [DOCK_STYLE], options);
}

export function mountSurface(view: FunctionComponent, scenario: string | AppClientScenario, kind: MountSurfaceKind, styles: readonly StyleSource[], options: MountDockOptions = {}): MountedKit {
  return mountKit(view, {
    scenario,
    kind,
    styles,
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.parent === undefined ? {} : { parent: options.parent }),
    ...(options.site === undefined ? {} : { site: options.site }),
  });
}

/** mountDock inside `act`: the first render's effects have run when it resolves (needed under fake timers). */
export async function mountDockSettled(scenario: string | AppClientScenario, options: MountDockOptions = {}): Promise<MountedKit> {
  let mounted: MountedKit | null = null;
  await act(() => {
    mounted = mountDock(scenario, options);
  });
  if (mounted === null) throw new Error('mountDock did not mount');
  return mounted;
}

/** Lets effects, resolved dispatches and lazy parts settle. */
export async function settle(rounds = 3): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

export const keydown = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...init });

export const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
