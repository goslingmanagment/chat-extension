// Test and stand harness for ui/kit (architecture.md §10.2 п. 7–8): a
// FakeAppClient scenario, its MountDeps with the REAL I18n port of core (so
// texts, plurals and the money notation are the shipped ones), and a closed
// shadow root the kit mounts into, as host-chatspace would create it.

import { type FunctionComponent } from 'preact';
import { act } from 'preact/test-utils';

import { createI18n, type LiveI18n } from '@cg/core/domain/i18n';
import { type Locale, type MountSurfaceKind } from '@cg/contracts';
import { mountKitSurface, type KitFailure, type KitMount, type StyleSource } from '@cg/ui/kit';

import {
  FakeAppClient,
  createFakeMountDeps,
  ctxOf,
  fallbackView,
  scenarioById,
  type AppClientScenario,
  type FakeMountDeps,
  type ScenarioCtx,
} from '../scenarios/app-client';

export type KitDeps = Omit<FakeMountDeps, 'i18n'> & { readonly i18n: LiveI18n };

export interface KitWorld {
  readonly scenario: AppClientScenario;
  readonly ctx: ScenarioCtx;
  readonly client: FakeAppClient;
  readonly deps: KitDeps;
}

/** A scenario (by id or as given), its client and MountDeps with the real I18n in the scenario's language (UTC). */
export function kitWorld(scenario: string | AppClientScenario = 'gallery-ready', language?: Locale): KitWorld {
  const chosen = typeof scenario === 'string' ? scenarioById(scenario) : scenario;
  const lang = language ?? chosen.language;
  const ctx = ctxOf({ lang, platform: chosen.platform, debug: chosen.debug });
  const client = new FakeAppClient(chosen, (selector) => fallbackView(ctx, selector));
  const fake = createFakeMountDeps(client, ctx);
  const deps: KitDeps = { ...fake, i18n: createI18n({ language: lang, now: () => client.now(), timeZone: 'UTC' }) };
  return { scenario: chosen, ctx, client, deps };
}

export interface MountedKit extends KitWorld {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly mount: KitMount;
  readonly failures: KitFailure[];
  /** querySelector inside our closed root. */
  $(selector: string): HTMLElement | null;
  $$(selector: string): HTMLElement[];
  unmount(): void;
}

export interface MountKitOptions {
  readonly scenario?: string | AppClientScenario;
  readonly language?: Locale;
  readonly kind?: MountSurfaceKind;
  readonly styles?: readonly StyleSource[];
  /** Where the host element goes (default: document.body). */
  readonly parent?: HTMLElement;
  /** The surface's clock (default: the scenario's fake clock). */
  readonly now?: () => number;
}

/** Mounts `view` as a kit surface into a fresh closed shadow root. */
export function mountKit(view: FunctionComponent, options: MountKitOptions = {}): MountedKit {
  const world = kitWorld(options.scenario, options.language);
  const host = document.createElement('div');
  host.setAttribute('data-cg', options.kind ?? 'dock');
  (options.parent ?? document.body).append(host);
  const root = host.attachShadow({ mode: 'closed' });
  const failures: KitFailure[] = [];
  const mount = mountKitSurface(options.kind ?? 'dock', root, world.deps, { view, ...(options.styles === undefined ? {} : { styles: options.styles }) }, {
    report: (failure) => failures.push(failure),
    now: options.now ?? (() => world.client.now()),
  });
  return {
    ...world,
    host,
    root,
    mount,
    failures,
    $: (selector) => root.querySelector<HTMLElement>(selector),
    $$: (selector) => [...root.querySelectorAll<HTMLElement>(selector)],
    unmount: () => {
      mount.unmount();
      host.remove();
    },
  };
}

/** mountKit inside `act`: effects of the first render have run when it resolves. */
export async function mountKitSettled(view: FunctionComponent, options: MountKitOptions = {}): Promise<MountedKit> {
  let mounted: MountedKit | null = null;
  await act(() => {
    mounted = mountKit(view, options);
  });
  if (mounted === null) throw new Error('mountKit did not mount');
  return mounted;
}

/** `act` around a synchronous step whose result is ignored (a dispatchEvent, a click, a signal write). */
export async function flush(step: () => unknown = () => undefined): Promise<void> {
  await act(() => {
    step();
  });
}
