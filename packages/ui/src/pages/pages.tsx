// The entry functions of the extension pages (architecture.md §9.9, §10.2;
// R16): `mountPopup`, `mountOptions`, `mountDebugPrompt` and
// `mountDebugJournal`. The composition root of a page calls one of them with
// an AppClient (core `createPagesClient`), the I18n port, the clipboard and
// the theme; everything else a surface needs on a page — its toasts, its
// confirmation dialog, the scheme resolved from `ui.theme` and the OS — is
// built here, on top of ui/kit's `mountKitPage`.

import { type FunctionComponent } from 'preact';

import { type UiTheme } from '@cg/contracts/settings';
import {
  JOURNAL_KINDS,
  type ActionCatalog,
  type AppClient,
  type ClipboardPort,
  type ColorScheme,
  type I18n,
  type JournalKind,
  type MountDeps,
  type MountSurfaceKind,
  type SurfaceGeometry,
  type Unmount,
  type ValueSignal,
} from '@cg/contracts/vm';

import { Hints, SettableSignal, capturePageErrors, mountKitPage, resolvedSchemeSignal, useValueSignal, type KitFailure } from '../kit';
import { DebugJournal } from './debug/Journal';
import { DebugPrompt } from './debug/DebugPrompt';
import { Options, type OptionsRoute } from './options/Options';
import { type OptionsSlots } from './options/slots';
import { SiteAccessProvider, type SiteAccessProps } from './SiteAccess';
import { Popup } from './Popup';
import { FONTS_SOURCE } from './brand/fonts';
import { PageServices, PageServicesProvider } from './shared';
import { PAGES_SOURCE } from './styles';

/** What a page's composition root hands over. */
export interface PageDeps {
  readonly siteAccess?: SiteAccessProps;
  /** core `createPagesClient(...)`, started by the composition root. */
  readonly client: AppClient;
  readonly i18n: I18n;
  readonly catalog: ActionCatalog;
  /** The page's own clipboard (platform `writeClipboardText`). */
  readonly clipboard: ClipboardPort;
  /** `ui.theme` (the pages client's `theme`); `host` means `system` on a page (ui-design §2.1). */
  readonly theme: ValueSignal<UiTheme>;
  /** `prefers-color-scheme` of the OS (ui/kit `mediaSchemeSignal`). */
  readonly systemScheme: ValueSignal<ColorScheme>;
  /** `ui.hints` (the pages client's `hints`); descriptions in tooltips, on by default. */
  readonly hints?: ValueSignal<boolean>;
  /** Render, dispatch, clipboard and page failures: the composition root logs them (class and code only). */
  readonly report?: (failure: KitFailure) => void;
  readonly now?: () => number;
}

export interface OptionsPageDeps extends PageDeps {
  /** Where the page is (the pages client's `location`): the section and the code of a deep link. */
  readonly location: ValueSignal<OptionsRoute>;
  /** The site page that helps with the sign-in (ST-050); https, or absent. */
  readonly helpUrl?: string | null;
  /** R20 P14b1: a site's own parts of the shared sections (ui/hosts/<site>/pages); absent — none. */
  readonly slots?: OptionsSlots;
}

const ALWAYS_ON: ValueSignal<boolean> = { value: true, subscribe: () => () => undefined };

function mountPage(container: HTMLElement, deps: PageDeps, surface: MountSurfaceKind, view: FunctionComponent): Unmount {
  const now = deps.now ?? Date.now;
  const view0 = container.ownerDocument.defaultView;
  const services = new PageServices(deps.i18n, now);
  const scheme = resolvedSchemeSignal(deps.theme, null, deps.systemScheme);
  const geometry = new SettableSignal<SurfaceGeometry>({ width: null, feedHeight: null, viewportHeight: view0?.innerHeight ?? 0, container: null });
  const mountDeps: MountDeps = {
    client: deps.client,
    i18n: deps.i18n,
    catalog: deps.catalog,
    toasts: services,
    clipboard: deps.clipboard,
    dialogs: services,
    scheme,
    geometry,
    // A page has no host to give focus back to and paints nothing a metric waits for.
    focus: { token: null, restore: () => false },
    marks: { resultShown: () => undefined, painted: () => undefined },
  };
  const hints = deps.hints ?? ALWAYS_ON;
  const View = view;
  const Root: FunctionComponent = () => {
    const on = useValueSignal(hints).value;
    return (
      <PageServicesProvider services={services}>
        <Hints value={on}>
          {/* The optional site's switch lives inside the page that has one (the popup's foot, X61), not above it. */}
          <SiteAccessProvider value={deps.siteAccess ?? null}>
            <View />
          </SiteAccessProvider>
        </Hints>
      </PageServicesProvider>
    );
  };
  const report = deps.report;
  const mount = mountKitPage(container, mountDeps, { view: Root, styles: [FONTS_SOURCE, PAGES_SOURCE] }, { surface, ...(deps.now === undefined ? {} : { now: deps.now }), ...(report === undefined ? {} : { report }) });
  // ER-021: an uncaught error of our own page is reported by its class, never its message.
  const stopCapture = view0 === null || report === undefined ? () => undefined : capturePageErrors(view0, report, surface);
  return () => {
    stopCapture();
    mount.unmount();
    scheme.dispose();
    services.dispose();
  };
}

/** popup.html: 360 px, the browser gives the frame. */
export function mountPopup(container: HTMLElement, deps: PageDeps): Unmount {
  return mountPage(container, deps, 'popup', Popup);
}

/** options.html: the settings with their hash routes; the sign-in screen while nobody is signed in. */
export function mountOptions(container: HTMLElement, deps: OptionsPageDeps): Unmount {
  return mountPage(container, deps, 'options', () => <Options location={deps.location} helpUrl={deps.helpUrl ?? null} {...(deps.slots === undefined ? {} : { slots: deps.slots })} />);
}

/** debug-prompt.html?t=…: `token` is the `t` parameter; it is never drawn and never logged. */
export function mountDebugPrompt(container: HTMLElement, deps: PageDeps & { readonly token: string }): Unmount {
  return mountPage(container, deps, 'debug-prompt', () => <DebugPrompt token={deps.token} />);
}

/** A journal name from the page's hash (`#hub-calls`); anything else is the operations journal. */
export function journalOfHash(hash: string): JournalKind {
  const name = hash.replace(/^#/, '');
  return JOURNAL_KINDS.find((kind) => kind === name) ?? 'operations';
}

/** debug-journal.html#<journal>. */
export function mountDebugJournal(container: HTMLElement, deps: PageDeps & { readonly journal?: JournalKind }): Unmount {
  return mountPage(container, deps, 'journal', () => <DebugJournal initial={deps.journal ?? 'operations'} />);
}
