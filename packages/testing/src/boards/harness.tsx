// Test harness for the board surfaces (architecture.md §10.2 п. 7–8): a
// surface of @cg/ui — Spenders, «Новые», the fan panel, the palette, the
// quick jump — mounted the way the extension mounts it (the kit's mount
// helper, a closed shadow root on the overlay host) over a FakeAppClient
// state, with the shipped I18n. Tests read what is drawn and what was
// dispatched; nothing here reaches past the surface's own root.

import { act } from 'preact/test-utils';

import { type AppClient, type Locale, type MountSurfaceKind, type UiAction } from '@cg/contracts';
import { fanPanelSurface } from '@cg/ui/fanpanel';
import { mountKitSurface, type KitFailure, type KitMount, type SurfaceDefinition } from '@cg/ui/kit';
import { newcomersSurface } from '@cg/ui/newcomers';
import { paletteSurface, quickJumpSurface } from '@cg/ui/palette';
import { spendersSurface } from '@cg/ui/spenders';

import { type AppClientScenario } from '../scenarios/app-client';
import { boardWorld, type BoardWorld } from './world';

export const BOARD_SURFACES = {
  spenders: spendersSurface,
  newcomers: newcomersSurface,
  'fan-panel': fanPanelSurface,
  palette: paletteSurface,
  'quick-jump': quickJumpSurface,
} as const satisfies Partial<Record<MountSurfaceKind, SurfaceDefinition>>;

export type BoardSurfaceKind = keyof typeof BOARD_SURFACES;

export interface MountedBoard extends BoardWorld {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly mount: KitMount;
  readonly failures: KitFailure[];
  $(selector: string): HTMLElement | null;
  $$(selector: string): HTMLElement[];
  /** Trimmed text of the first match; null when nothing matches. */
  text(selector: string): string | null;
  /** Every action the surface dispatched, in order. */
  actions(): readonly UiAction[];
  /** The actions of one type. */
  actionsOf<T extends UiAction['type']>(type: T): Extract<UiAction, { type: T }>[];
  unmount(): void;
}

export interface MountBoardOptions {
  readonly language?: Locale;
  /** Wraps the fake client (the live board of the performance tests). */
  readonly client?: (world: BoardWorld) => AppClient;
}

export function mountBoard(kind: BoardSurfaceKind, scenario: string | AppClientScenario, options: MountBoardOptions = {}): MountedBoard {
  const world = boardWorld(scenario, options.language ?? 'ru');
  const host = document.createElement('div');
  host.setAttribute('data-cg', 'overlay');
  document.documentElement.append(host);
  const root = host.attachShadow({ mode: 'closed' });
  const failures: KitFailure[] = [];
  const deps = options.client === undefined ? world.deps : { ...world.deps, client: options.client(world) };
  const mount = mountKitSurface(kind, root, deps, BOARD_SURFACES[kind], { report: (failure) => failures.push(failure), now: () => world.client.now() });
  return {
    ...world,
    host,
    root,
    mount,
    failures,
    $: (selector) => root.querySelector<HTMLElement>(selector),
    $$: (selector) => [...root.querySelectorAll<HTMLElement>(selector)],
    text: (selector) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    actions: () => world.client.dispatched,
    actionsOf: <T extends UiAction['type']>(type: T) => world.client.dispatched.filter((action): action is Extract<UiAction, { type: T }> => action.type === type),
    unmount: () => {
      mount.unmount();
      host.remove();
    },
  };
}

/** mountBoard inside `act`: the effects of the first render have run when it resolves. */
export async function mountBoardSettled(kind: BoardSurfaceKind, scenario: string | AppClientScenario, options: MountBoardOptions = {}): Promise<MountedBoard> {
  let mounted: MountedBoard | null = null;
  await act(() => {
    mounted = mountBoard(kind, scenario, options);
  });
  if (mounted === null) throw new Error('mountBoard did not mount');
  return mounted;
}

/** `act` around a synchronous step (a click, a key, a scenario step). */
export async function flush(step: () => unknown = () => undefined): Promise<void> {
  await act(() => {
    step();
  });
}

/**
 * Lets what a dispatch started finish: its promise, the render it caused and
 * that render's effects. A render that began outside `act` schedules its
 * effects after a frame, so this waits one out.
 */
export async function settle(): Promise<void> {
  await flush();
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  await flush();
}

export function keydown(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** Normalised text of an element: whitespace collapsed. */
export function textOf(element: Element | null | undefined): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}
