// The gallery page of the dock and the overlays (architecture.md §10.2 п. 8;
// ui-design §11): `?state=3a` one state, `?group=results` a group, no
// parameter — every dock state; `&w=853|693|489|360` the composer width,
// `&theme=light|dark`, `&lang=ru|en`, `&style=bare|sheet`, `&feed=574&vh=900`
// the height of the feed window and of the browser window the host reports
// (the result's height limit, ui-design §3.2), `&host=chatspace|fansly|test`
// the site's profile the surfaces are mounted with (kit/profiles.ts;
// ChatSpace's by default; with Fansly's the page plays fansly.com in the
// theme asked for, and `__dock.setHostTheme` switches it as the person would).
// The page plays the host side: a closed shadow root on a host element above a fake composer
// (or the overlay host over the whole window), and the surfaces are mounted
// exactly as the extension mounts them. `window.__dock` tells the e2e what a
// closed root hides: failures the surfaces reported, overflow, overlaps and
// heights.

import { type ColorScheme, type Locale, type MountSurfaceKind, type SurfaceGeometry, type UiResultStyle } from '@cg/contracts';
import { dockSurface, preloadPart, DEFAULT_PARTS } from '@cg/ui/dock';
import { mountKitSurface, type KitFailure, type KitMount, type SurfaceDefinition } from '@cg/ui/kit';
import { lazyOverlays, toastsSurface } from '@cg/ui/overlays';

import { setFanslyTheme } from '../../kit/fansly-page';
import { galleryHostOf } from '../../kit/profiles';
import { entry } from '../../scenarios/app-client';
import { kitWorld, type KitWorld } from '../../kit/world';
import { GALLERY_STATES, STATE_GROUPS, galleryState, scenarioOfState, type GalleryState } from './states';

export interface DockProbe {
  readonly failures: readonly KitFailure[];
  /** Ids of the mounted states. */
  readonly states: readonly string[];
  /** What is wrong on screen now: overflow, overlap, heights (empty when fine). */
  check(): readonly string[];
  /** Sets the composer width of every stage (the 360…900 px sweep). */
  setWidth(px: number): void;
  measure(id: string): { readonly strip: number; readonly sheet: number; readonly cap: number; readonly draftVisible: boolean | null; readonly buttons: readonly string[] } | null;
  /** The key caps of the chips a width left on screen, in order: a cap shows on hover and on keyboard focus (UI-006). */
  caps(id: string): readonly string[];
  /** Texts of the visible elements matching `selector` in the surfaces of a state (a closed root hides them from the page). */
  shown(id: string, selector: string): readonly string[];
  /** The box of the first visible match, in viewport pixels. */
  box(id: string, selector: string): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly width: number; readonly height: number } | null;
  /** Resolves once every entry animation inside the surfaces has run to its end (spinners and the caret never end). */
  settle(): Promise<void>;
  /** Places of the accent dot on screen (`data-accent-use`), for the closed list of ui-design §1 п. 4. */
  accents(): readonly string[];
  /** The class of what holds focus inside the dock of a state (a closed root hides it from the page); null — nothing of ours. */
  focused(id: string): string | null;
  /** Types of the actions the surfaces of a state dispatched, in order (what a real click did). */
  dispatched(id: string): readonly string[];
  /** What the dock of a state is drawn in: the bar's card and ink, a chip after Reply's (Fix), Reply's capsule and the font, as computed; its host's scheme. */
  colours(id: string): { readonly raised: string; readonly ink: string; readonly chip: string; readonly groove: string; readonly font: string; readonly scheme: string | null } | null;
  /** The site's theme switched on the page as the person would (Fansly: its class on <html>); our surfaces follow as the tab does («как на сайте»). */
  setHostTheme(scheme: ColorScheme): void;
  /** Surfaces mounted since the page loaded: a theme switch remounts nothing. */
  readonly mounts: number;
  readonly styles: { readonly mode: string };
}

declare global {
  interface Window {
    __dock?: DockProbe;
  }
}

const params = new URLSearchParams(location.search);
const scheme: ColorScheme = params.get('theme') === 'dark' ? 'dark' : 'light';
const language: Locale = params.get('lang') === 'en' ? 'en' : 'ru';
const style: UiResultStyle = params.get('style') === 'sheet' ? 'sheet' : 'bare';
let width = Math.max(240, Number(params.get('w') ?? '853') || 853);
const feedHeight = Number(params.get('feed') ?? '574') || 574;
const viewportHeight = Number(params.get('vh') ?? '900') || 900;
/** `os=win`: the key labels of Windows and Linux («Ctrl+Alt+B»), four times as wide as the Mac's. */
const keys: 'mac' | 'win' = params.get('os') === 'win' ? 'win' : 'mac';
const site = galleryHostOf(params);
const stateParam = params.get('state');
const groupParam = params.get('group');
const single = stateParam === null ? null : galleryState(stateParam);
const selected: readonly GalleryState[] =
  single !== null
    ? [single]
    : GALLERY_STATES.filter(
        (item) =>
          item.surface === 'dock' &&
          // A state only some sites give is drawn in their galleries alone (R20 P8b2: Fansly's marks).
          (item.sites === undefined || item.sites.includes(site.host)) &&
          (groupParam === null || !STATE_GROUPS.some((group) => group === groupParam) || item.group === groupParam),
      )
        // Group by group: a picture of one group is one unbroken piece of the page.
        .map((item, index) => ({ item, index }))
        .sort((a, b) => STATE_GROUPS.indexOf(a.item.group) - STATE_GROUPS.indexOf(b.item.group) || a.index - b.index)
        .map(({ item }) => item);

const html = document.documentElement;
html.classList.toggle('dark', scheme === 'dark');
html.classList.toggle('light', scheme === 'light');
html.lang = language;
site.play(scheme);
html.style.setProperty('--gal-w', `${width}px`);
if (single !== null) html.setAttribute('data-gal-single', single.id);
// A menu opens upwards, over the feed: a page of one such state gives it room.
if (single?.open !== undefined) html.style.setProperty('--gal-feed', '260px');
const config = document.querySelector('[data-gal-config]');
if (config !== null) config.textContent = `${scheme} · ${language} · ${width} px · ${style}${groupParam === null ? '' : ` · ${groupParam}`}${site.host === 'chatspace' ? '' : ` · ${site.host}`}`;

const gallery = document.getElementById('gallery') as HTMLElement;
const failures: KitFailure[] = [];
interface Mounted {
  readonly state: GalleryState;
  readonly world: KitWorld;
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly mount: KitMount;
}
const mounted: Mounted[] = [];

const geometryOf = (item: GalleryState): SurfaceGeometry =>
  item.surface === 'dock'
    ? { width, feedHeight, viewportHeight, container: null }
    : { width: null, feedHeight: null, viewportHeight: window.innerHeight, container: { left: 64, top: 44, width: window.innerWidth - 64, height: window.innerHeight - 44 } };

function worldOf(item: GalleryState): KitWorld {
  const scenario = scenarioOfState(item, language, scheme, keys, site.profile.phrases, site.texts);
  // «Вид ответа» comes from the URL, as the setting would.
  const views = scenario.views.map((view) => (view.selector.of === 'dock' ? entry({ of: 'dock' }, { ...(view.vm as Parameters<typeof entry<{ of: 'dock' }>>[1]), resultStyle: style }) : view));
  const world = kitWorld({ ...scenario, views }, language, site.profile.phrases, site.texts);
  world.deps.scheme.set(scheme);
  world.deps.geometry.set(geometryOf(item));
  return world;
}

function mountInto(item: GalleryState, world: KitWorld, host: HTMLElement, kind: MountSurfaceKind, definition: SurfaceDefinition): Mounted {
  const root = host.attachShadow({ mode: 'closed' });
  // As the site's tab mounts it: with the site's profile (its palette, the dock's variant and sheet).
  const mount = mountKitSurface(kind, root, { ...world.deps, profile: site.profile }, definition, { now: () => world.client.now(), report: (failure) => failures.push(failure) });
  const entryOf: Mounted = { state: item, world, host, root, mount };
  mounted.push(entryOf);
  return entryOf;
}

function stage(item: GalleryState, parent: HTMLElement, world: KitWorld): Mounted {
  const section = document.createElement('section');
  section.className = 'gal-stage';
  section.setAttribute('data-gal-state', item.id);
  section.setAttribute('data-gal-group', item.group);
  const caption = document.createElement('h2');
  caption.className = 'gal-cap';
  caption.textContent = `${item.id} · ${item.title}`;
  const feed = document.createElement('div');
  feed.className = 'gal-feed';
  const bubble = document.createElement('div');
  bubble.className = 'gal-bubble';
  bubble.textContent = 'are you awake? 😇';
  feed.append(bubble);
  const composerRoot = document.createElement('div');
  composerRoot.className = 'gal-composer-root';
  const host = document.createElement('div');
  host.setAttribute('data-host', 'dock');
  composerRoot.append(host);
  if (item.noComposer !== true) {
    const composer = document.createElement('div');
    composer.className = 'gal-composer';
    if (site.host === 'fansly') {
      // Fansly's composer row: its message pill inside (kit/fansly-page.ts).
      const pill = document.createElement('div');
      pill.className = 'gal-pill';
      pill.textContent = 'Type a message';
      composer.append(pill);
    } else composer.textContent = 'Type a message';
    composerRoot.append(composer);
  }
  section.append(caption, feed, composerRoot);
  parent.append(section);
  return mountInto(item, world, host, 'dock', dockSurface);
}

function page(): HTMLElement {
  const frame = document.createElement('div');
  frame.className = 'gal-page';
  for (const name of ['gal-page__bar', 'gal-page__rail', 'gal-page__main', 'gal-page__rail gal-page__rail--right']) {
    const box = document.createElement('div');
    box.className = name;
    frame.append(box);
  }
  gallery.append(frame);
  return frame.querySelector('.gal-page__main') as HTMLElement;
}

async function show(): Promise<void> {
  // The lazy parts are warm, as after their first use: a picture never catches the one-frame placeholder.
  await Promise.all([preloadPart(DEFAULT_PARTS.analysis), preloadPart(DEFAULT_PARTS.debug)]);
  for (const item of selected) {
    const world = worldOf(item);
    if (item.surface === 'dock') {
      const entryOf = stage(item, gallery, world);
      if (item.open !== undefined) {
        // Opened as a person would: a click on the strip button.
        const trigger = entryOf.root.querySelector<HTMLElement>('.cg-slot--more .cg-act');
        requestAnimationFrame(() => trigger?.click());
      }
      continue;
    }
    // An overlay: the dock of the same scenario under it, the overlay host over the whole window.
    const main = page();
    stage({ ...item, surface: 'dock' }, main, world);
    const overlay = document.createElement('div');
    overlay.setAttribute('data-host', 'overlay');
    document.documentElement.append(overlay);
    const definition = item.surface === 'toasts' ? toastsSurface : await lazyOverlays[item.surface]();
    mountInto(item, world, overlay, item.surface, definition);
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  html.setAttribute('data-gal-ready', '1');
}

const rect = (element: Element | null): DOMRect | null => element?.getBoundingClientRect() ?? null;
const isShown = (element: Element): boolean => {
  if (element.getClientRects().length === 0) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.opacity !== '0';
};
const matches = (id: string, selector: string): Element[] => mounted.filter((item) => item.state.id === id).flatMap((item) => [...item.root.querySelectorAll(selector)].filter(isShown));
const docks = (): Mounted[] => mounted.filter((item) => item.mount.container.getAttribute('data-cg-surface') === 'dock');

window.__dock = {
  failures,
  get states() {
    return mounted.map((item) => item.state.id);
  },
  check: () => {
    const problems: string[] = [];
    for (const item of docks()) {
      const { root, host, state } = item;
      const box = host.getBoundingClientRect();
      const say = (text: string): number => problems.push(`${state.id} @${Math.round(box.width)}: ${text}`);
      // Nothing of ours sticks out of the composer's width (menus included).
      for (const element of root.querySelectorAll<HTMLElement>('.cg-dock *')) {
        const own = element.getBoundingClientRect();
        if (own.width === 0 && own.height === 0) continue;
        if (own.right > box.right + 0.5 || own.left < box.left - 0.5) {
          say(`overflow ${element.tagName.toLowerCase()}.${element.className.toString().split(' ').join('.')} ${Math.round(own.left - box.left)}…${Math.round(own.right - box.left)}`);
          break;
        }
      }
      const strip = rect(root.querySelector('.cg-strip'));
      if (strip !== null && Math.abs(strip.height - 40) > 0.01) say(`strip is ${strip.height} px, not 40`);
      const acts = rect(root.querySelector('.cg-strip__acts'));
      // Below 820 px the right block has nothing left to show and is not laid out: only one that is on screen can overlap.
      const right = root.querySelector('.cg-strip__opts');
      const opts = right !== null && right.getClientRects().length > 0 ? rect(right) : null;
      if (acts !== null && opts !== null && acts.right > opts.left + 0.5) say(`the right block overlaps the buttons by ${Math.round(acts.right - opts.left)} px`);
      const draft = root.querySelector<HTMLElement>('.cg-head__draft');
      const headActs = rect(root.querySelector('.cg-head__acts'));
      if (draft !== null) {
        const own = draft.getBoundingClientRect();
        if (draft.scrollWidth > draft.clientWidth + 0.5) say('«черновик · не отправлено» is cut');
        if (headActs !== null && own.right > headActs.left + 0.5) say(`«черновик · не отправлено» runs under the head buttons by ${Math.round(own.right - headActs.left)} px`);
      }
      const sheet = rect(root.querySelector('.cg-sheet'));
      const cap = Number.parseFloat(getComputedStyle(root.querySelector('.cg-dock') ?? host).getPropertyValue('--cg-cap'));
      if (sheet !== null && Number.isFinite(cap) && sheet.height > cap + 0.5) say(`the sheet is ${sheet.height} px, above its limit ${cap}`);
    }
    return problems;
  },
  setWidth: (px) => {
    width = px;
    html.style.setProperty('--gal-w', `${px}px`);
    for (const item of docks()) item.world.deps.geometry.set(geometryOf({ ...item.state, surface: 'dock' }));
  },
  measure: (id) => {
    const item = docks().find((candidate) => candidate.state.id === id);
    if (item === undefined) return null;
    const { root } = item;
    const draft = root.querySelector<HTMLElement>('.cg-head__draft');
    const shown = (element: HTMLElement): boolean => element.getClientRects().length > 0;
    return {
      strip: rect(root.querySelector('.cg-strip'))?.height ?? 0,
      sheet: rect(root.querySelector('.cg-sheet'))?.height ?? 0,
      cap: Number.parseFloat(getComputedStyle(root.querySelector('.cg-dock') ?? item.host).getPropertyValue('--cg-cap')),
      draftVisible: draft === null ? null : shown(draft) && draft.scrollWidth <= draft.clientWidth + 0.5,
      // A key is a cap at the chip's corner, shown on hover and on keyboard focus (UI-006): «+key» says the chip carries one.
      buttons: [...root.querySelectorAll<HTMLElement>('.cg-strip .cg-act')].filter(shown).map((button) => `${button.querySelector('.cg-act__t')?.textContent ?? ''}${button.querySelector('kbd') !== null && shown(button.querySelector('kbd') as HTMLElement) ? '+key' : ''}`),
    };
  },
  caps: (id) =>
    [...(docks().find((candidate) => candidate.state.id === id)?.root.querySelectorAll<HTMLElement>('.cg-strip .cg-act kbd') ?? [])]
      .filter((cap) => cap.getClientRects().length > 0)
      .map((cap) => cap.textContent ?? ''),
  shown: (id, selector) => matches(id, selector).map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim()),
  box: (id, selector) => {
    const own = rect(matches(id, selector)[0] ?? null);
    return own === null ? null : { left: own.left, top: own.top, right: own.right, bottom: own.bottom, width: own.width, height: own.height };
  },
  settle: async () => {
    // A closed root's animations are not in document.getAnimations(): each root is asked for its own.
    const finite = mounted.flatMap((item) => item.root.getAnimations()).filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime ?? Number.POSITIVE_INFINITY)));
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  },
  accents: () => mounted.flatMap((item) => [...item.root.querySelectorAll('.cg-dot--accent, .cg-badge')].filter(isShown).map((dot) => `${item.state.id}:${dot.getAttribute('data-accent-use') ?? 'unnamed'}`)),
  focused: (id) => {
    const active = docks().find((item) => item.state.id === id)?.root.activeElement;
    return active instanceof HTMLElement ? active.className : null;
  },
  dispatched: (id) => [...new Set(mounted.filter((item) => item.state.id === id).map((item) => item.world.client))].flatMap((client) => client.dispatched.map((action) => action.type)),
  colours: (id) => {
    const item = docks().find((candidate) => candidate.state.id === id);
    if (item === undefined) return null;
    const style = (selector: string): CSSStyleDeclaration | null => {
      const element = item.root.querySelector(selector);
      return element === null ? null : getComputedStyle(element);
    };
    return {
      raised: style('.cg-strip')?.backgroundColor ?? '',
      ink: style('.cg-dock')?.color ?? '',
      chip: style('.cg-strip .cg-slot:not(.cg-slot--reply) .cg-act')?.backgroundColor ?? '',
      groove: style('.cg-strip .cg-tones')?.backgroundColor ?? '',
      font: style('.cg-dock')?.fontFamily ?? '',
      scheme: item.host.getAttribute('data-scheme'),
    };
  },
  setHostTheme: (next) => {
    if (site.host === 'fansly') setFanslyTheme(document, next);
    html.classList.toggle('dark', next === 'dark');
    html.classList.toggle('light', next === 'light');
    for (const item of mounted) item.world.deps.scheme.set(next);
  },
  get mounts() {
    return mounted.length;
  },
  styles: {
    get mode() {
      return mounted[0]?.mount.styleMode ?? 'none';
    },
  },
};

void show();
