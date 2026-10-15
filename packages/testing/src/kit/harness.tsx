// Test and stand harness for ui/kit (architecture.md §10.2 п. 7–8): a
// FakeAppClient scenario, its MountDeps with the REAL I18n port of core (so
// texts, plurals and the money notation are the shipped ones), and a closed
// shadow root the kit mounts into, as host-chatspace would create it.

import { type FunctionComponent } from 'preact';
import { act } from 'preact/test-utils';

import { type Locale, type MountSurfaceKind } from '@cg/contracts';
import { type SitePhrases } from '@cg/core/domain/i18n';
import { mountKitSurface, type KitFailure, type KitMount, type StyleSource } from '@cg/ui/kit';

import { type AppClientScenario, type SiteTexts } from '../scenarios/app-client';
import { kitWorld, type KitWorld } from './world';

export { kitWorld, type KitDeps, type KitWorld } from './world';

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
  /** The site the surface speaks for (its phrases and its own catalog entries, as its tab has them); default: ChatSpace's. */
  readonly site?: { readonly phrases: SitePhrases; readonly texts?: SiteTexts };
}

/** Mounts `view` as a kit surface into a fresh closed shadow root. */
export function mountKit(view: FunctionComponent, options: MountKitOptions = {}): MountedKit {
  const world = kitWorld(options.scenario, options.language, options.site?.phrases, options.site?.texts);
  const host = document.createElement('div');
  host.setAttribute('data-host', options.kind ?? 'dock');
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
