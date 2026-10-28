// «Включить Fansly» in the popup (P9a, FS-IDN-4; X61): the optional site's switch a quiet word in the popup's foot,
// never above the persona; its tabs that wait for a reload are a problem on the popup's stage, with
// «Перезагрузить вкладку». The control is the composition root's (`site.access` from the page) and live: the click
// asks the browser for the rights in its own stack (P3b). The page shell names no site — the title is the root's.

import { createContext, type JSX } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';

import type { SiteAccessControl, SiteAccessView } from '@cg/contracts/site-access';

import { Button, ErrorCard, useI18n } from '../kit';

export interface SiteAccessProps {
  readonly control: SiteAccessControl;
  readonly title: string;
}

const SiteAccessContext = createContext<SiteAccessProps | null>(null);
export const SiteAccessProvider = SiteAccessContext.Provider;

/** The other optional sites' switches (Telegram spec §6.3): each its own control and title, said in the same foot. */
const MoreSitesContext = createContext<readonly SiteAccessProps[]>([]);
export const MoreSitesProvider = MoreSitesContext.Provider;

/** The optional site's control and its live state; null — this page has none. */
export function useSiteAccess(): { readonly props: SiteAccessProps; readonly view: SiteAccessView } | null {
  const props = useContext(SiteAccessContext);
  const [view, setView] = useState<SiteAccessView | null>(props?.control.value ?? null);
  useEffect(() => {
    if (props === null) return undefined;
    setView(props.control.value);
    return props.control.subscribe(() => setView(props.control.value));
  }, [props]);
  return props === null || view === null ? null : { props, view };
}

/** The site's tabs opened before it was switched on or before an update: how many wait for a reload (0 — none, or off). */
export function waitingReloadOf(view: SiteAccessView): number {
  const state = view.state;
  return state !== null && state.enabled && state.granted ? state.waitingReload : 0;
}

/**
 * «Выключить Fansly» / «Включить Fansly» — a quiet word in the foot's one line (X61): the word says the state. The
 * wrapper keeps the P9a hook `.pg-site-access button` the signed builds' spec presses.
 */
export function SiteSwitch(): JSX.Element | null {
  const i18n = useI18n();
  const access = useSiteAccess();
  // Not read yet: nothing rather than a switch that may say the opposite of the truth for a moment.
  if (access === null || access.view.state === null) return null;
  const { props, view } = access;
  const on = view.state?.enabled === true && view.state.granted;
  return (
    <span class="pg-popup__site pg-site-access">
      <Button
        variant="plain"
        size="sm"
        busy={view.busy}
        label={i18n.t(on ? 'siteAccess.disable' : 'siteAccess.enable', { site: props.title })}
        onClick={() => {
          void (on ? props.control.disable() : props.control.enable());
        }}
      />
    </span>
  );
}

/** The switch could not reach the background: said over the foot, with «Повторить». */
export function SiteSwitchError(): JSX.Element | null {
  const i18n = useI18n();
  const access = useSiteAccess();
  if (access === null || access.view.error === null) return null;
  const { props, view } = access;
  return (
    <div class="pg-popup__site-error">
      <ErrorCard tone="failure" inline error={{ code: 'CG-RUNTIME-UNREACHABLE', title: i18n.t('cg.runtimeUnreachable.title'), body: i18n.t('cg.runtimeUnreachable.body') }}>
        <Button busy={view.busy} label={i18n.t('common.retry')} onClick={() => void props.control.refresh()} />
      </ErrorCard>
    </div>
  );
}

/** The other optional sites' quiet words in the foot, each under its own control; a site not offered shows nothing. */
export function MoreSiteSwitches(): JSX.Element | null {
  const sites = useContext(MoreSitesContext);
  if (sites.length === 0) return null;
  return (
    <>
      {sites.map((site) => (
        <SiteAccessProvider key={site.title} value={site}>
          <SiteSwitch />
        </SiteAccessProvider>
      ))}
    </>
  );
}
