// The boards gallery page:
//   ?state=11a&theme=light|dark&lang=ru|en        a gallery state (states.ts) or an AppClient scenario id
//   &surface=spenders|newcomers|fan-panel|palette|quick-jump|preview   (a scenario id needs it; a state knows its own)
//   &rows=1000                                    the live board over that many fans (search, filters, sort)
//   &step=N                                       apply the scenario's steps up to N
//   &host=chatspace|test                          the site's profile the surface is mounted with (kit/profiles.ts)
// It plays the host side — a closed shadow root on the overlay host, outside
// the page's own tree — and mounts the surface through the kit's mount
// helper, as the extension does. `window.__boards` gives the e2e what a closed
// root hides, and runs the two measurements of §11: opening the board from
// data already in memory, and a search over a thousand rows.

import { type ColorScheme, type Locale, type MountSurfaceKind, type UiAction } from '@cg/contracts';
import { fanPanelSurface } from '@cg/ui/fanpanel';
import { mountKitSurface, type KitFailure, type KitMount, type SurfaceDefinition } from '@cg/ui/kit';
import { newcomersSurface } from '@cg/ui/newcomers';
import { paletteSurface, quickJumpSurface } from '@cg/ui/palette';
import { previewWindowSurface } from '@cg/ui/preview';
import { spendersSurface } from '@cg/ui/spenders';

import { galleryHostOf } from '../../kit/profiles';
import { manyFans } from '../data';
import { LiveBoardClient } from '../live-client';
import { BOARD_STATES } from '../states';
import { boardWorld } from '../world';

const SURFACES: Partial<Record<MountSurfaceKind, SurfaceDefinition>> = {
  spenders: spendersSurface,
  newcomers: newcomersSurface,
  'fan-panel': fanPanelSurface,
  palette: paletteSurface,
  'quick-jump': quickJumpSurface,
  preview: previewWindowSurface,
};

export interface BoardsProbe {
  readonly failures: readonly KitFailure[];
  /** Actions the surface dispatched, by type, in order. */
  dispatched(): readonly UiAction['type'][];
  /** Fan rows of the board (or rows of «Новые») in the DOM. */
  rows(): number;
  /** Every element of the virtual list's rows in the DOM, the header and the sticky copy included. */
  listNodes(): number;
  /** Elements of ours that stick out of the viewport horizontally. */
  overflow(): readonly string[];
  /** Rows of ours whose content is wider than the row: columns squeezed into each other, a row running into the next pane. */
  squeezed(): readonly string[];
  /** Text of the first element matching `selector` inside our root. */
  text(selector: string): string | null;
  count(selector: string): number;
  /** The box and the computed `display` of the first element matching `selector` inside our root. */
  box(selector: string): { readonly left: number; readonly top: number; readonly width: number; readonly height: number; readonly display: string } | null;
  /** A computed style property of the first element matching `selector` inside our root. */
  style(selector: string, property: string): string | null;
  /** The scheme our host carries (`data-scheme`). */
  scheme(): string | null;
  /** Types into the board's search and resolves with the ms from the keystroke's dispatch to the paint of the answer. */
  search(query: string): Promise<{ readonly totalMs: number; readonly buildMs: number; readonly shown: number }>;
  /** Unmounts and mounts the board `times` times over the data in memory; ms from the mount call to the paint, each. */
  reopen(times: number): Promise<readonly number[]>;
  readonly paints: readonly { readonly metric: string; readonly mark: string }[];
  readonly styles: { readonly mode: string; readonly sheets: number };
}

declare global {
  interface Window {
    __boards?: BoardsProbe;
  }
}

const params = new URLSearchParams(location.search);
const scheme: ColorScheme = params.get('theme') === 'dark' ? 'dark' : 'light';
const language: Locale = params.get('lang') === 'en' ? 'en' : 'ru';
const stateId = params.get('state') ?? '11a';
const rowsParam = Number(params.get('rows') ?? '0');
const step = Number(params.get('step') ?? '-1');
const known = BOARD_STATES.find((item) => item.id === stateId);
const surfaceParam = params.get('surface') as MountSurfaceKind | null;
const kind: MountSurfaceKind = surfaceParam !== null && SURFACES[surfaceParam] !== undefined ? surfaceParam : (known?.surface ?? 'spenders');
const definition = SURFACES[kind] ?? spendersSurface;

const html = document.documentElement;
html.classList.toggle('dark', scheme === 'dark');
html.classList.toggle('light', scheme === 'light');
html.lang = language;

const world = boardWorld(stateId, language);
world.deps.scheme.set(scheme);
if (step >= 0) world.client.goTo(step);
// The side panel stands at the right edge of ChatSpace's container, inside its 1 px frame, left of its rail (ui-design §3.7).
if (kind === 'fan-panel') {
  world.deps.geometry.set({ width: 853, feedHeight: 574, viewportHeight: innerHeight, container: { left: 64, top: 45, width: innerWidth - 64 - 73, height: innerHeight - 45 - 9 } });
}

// A thousand rows: the live client answers searches, filters and the sort like a controller would.
const fans = rowsParam > 0 ? manyFans(rowsParam) : null;
const live = fans === null ? null : new LiveBoardClient(world.client, world.ctx, fans);
if (fans !== null) world.client.goTo(-1);
// As the site's tab mounts it: with the site's profile (its palette, the dock's variant and sheet).
const { profile } = galleryHostOf(params);
const deps = { ...world.deps, ...(live === null ? {} : { client: live }), profile };

const host = document.createElement('div');
host.setAttribute('data-host', 'overlay');
document.documentElement.append(host);
const root = host.attachShadow({ mode: 'closed' });
const failures: KitFailure[] = [];
const options = { now: () => world.client.now(), report: (failure: KitFailure) => failures.push(failure) };
let mount: KitMount = mountKitSurface(kind, root, deps, definition, options);

const frames = (count: number): Promise<void> =>
  new Promise((resolve) => {
    const next = (left: number): void => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => next(left - 1));
    };
    next(count);
  });

/** Resolves after the browser has painted the frame that follows the current task. */
const painted = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(() => setTimeout(() => resolve(performance.now()), 0)));

window.__boards = {
  failures,
  dispatched: () => world.client.dispatched.map((action) => action.type),
  rows: () => root.querySelectorAll('.cg-vlist__inner [data-cg-fan]').length,
  listNodes: () => root.querySelectorAll('.cg-vlist__row, .cg-vlist__head, .cg-vlist__sticky').length,
  overflow: () =>
    [...root.querySelectorAll<HTMLElement>('*')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && (box.right > document.documentElement.clientWidth + 0.5 || box.left < -0.5) && element.closest('.cg-sr') === null;
      })
      .map((element) => `${element.tagName.toLowerCase()}.${element.className.toString().split(' ').join('.')}`)
      .slice(0, 20),
  squeezed: () =>
    [...root.querySelectorAll<HTMLElement>('.cg-sp__top, .cg-sp__tools, .cg-bd__colhead, .cg-bd__row, .cg-bd__shelfrow, .cg-nc__colhead, .cg-nc__row, .cg-pv__head, .cg-pvb, .cg-st__head')]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
      .map((element) => `${element.className.toString().split(' ').join('.')} ${element.scrollWidth} > ${element.clientWidth}`)
      .slice(0, 20),
  text: (selector) => root.querySelector(selector)?.textContent ?? null,
  count: (selector) => root.querySelectorAll(selector).length,
  box: (selector) => {
    const element = root.querySelector(selector);
    if (element === null) return null;
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height, display: getComputedStyle(element).display };
  },
  style: (selector, property) => {
    const element = root.querySelector(selector);
    return element === null ? null : getComputedStyle(element).getPropertyValue(property);
  },
  scheme: () => host.getAttribute('data-scheme'),
  async search(query) {
    if (live === null) throw new Error('search needs ?rows=N');
    const input = root.querySelector<HTMLInputElement>('.cg-sp__search input');
    if (input === null) throw new Error('no search field');
    await frames(2);
    // The measure starts when the settled query is dispatched (after the field's own 150 ms debounce): Enter sends at once.
    input.focus();
    input.value = query;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: query, inputType: 'insertText' }));
    const started = performance.now();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    const done = await painted();
    const shownText = root.querySelector('.cg-sp__foot span')?.textContent ?? '';
    return { totalMs: done - started, buildMs: live.lastBuildMs, shown: Number(/(\d+)\D*$/.exec(shownText)?.[1] ?? '0') };
  },
  async reopen(times) {
    const samples: number[] = [];
    for (let run = 0; run < times; run += 1) {
      mount.unmount();
      await frames(2);
      const started = performance.now();
      mount = mountKitSurface(kind, root, deps, definition, options);
      samples.push((await painted()) - started);
      await frames(1);
    }
    return samples;
  },
  paints: world.deps.marks.paints,
  styles: { mode: mount.styleMode, sheets: root.adoptedStyleSheets.length },
};

// Ready after the first effects ran, two frames painted and the entrance animations ended (spinners never end: they are left out).
async function settled(): Promise<void> {
  await frames(2);
  const entrances = root.getAnimations().filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
  await Promise.all(entrances.map((animation) => animation.finished.catch(() => undefined)));
  await frames(1);
}
void settled().then(() => html.setAttribute('data-boards-ready', '1'));
