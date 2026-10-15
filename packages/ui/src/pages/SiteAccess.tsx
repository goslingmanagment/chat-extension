import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Button, ErrorCard, useI18n } from '../kit';
import type { SiteAccessControl } from '@cg/contracts/site-access';

export interface SiteAccessProps {
  readonly control: SiteAccessControl;
  readonly title: string;
}
export function SiteAccess(props: SiteAccessProps): JSX.Element {
  const i18n = useI18n();
  const [view, setView] = useState(props.control.value);
  useEffect(() => props.control.subscribe(() => setView(props.control.value)), [props.control]);
  const on = view.state?.enabled === true && view.state.granted;
  return <section class="pg-card pg-site-access" aria-label={props.title}>
    <b>{props.title}</b>
    <Button variant="plain" busy={view.busy} label={i18n.t(on ? 'siteAccess.disable' : 'siteAccess.enable', { site: props.title })} onClick={() => { void (on ? props.control.disable() : props.control.enable()); }} />
    {(view.state?.waitingReload ?? 0) > 0 && <>
      <span>{i18n.t('siteAccess.waiting', { count: view.state?.waitingReload ?? 0 })}</span>
      <Button busy={view.busy} label={i18n.t('siteAccess.reload')} onClick={() => { void props.control.reload(); }} />
    </>}
    {view.state?.reloaded !== undefined && <span role="status">{i18n.t('siteAccess.reloaded', { count: view.state.reloaded })}</span>}
    {view.error !== null && <ErrorCard tone="failure" inline error={{ code: 'CG-RUNTIME-UNREACHABLE', title: i18n.t('cg.runtimeUnreachable.title'), body: i18n.t('cg.runtimeUnreachable.body') }}>
      <Button busy={view.busy} label={i18n.t('common.retry')} onClick={() => { void props.control.refresh(); }} />
    </ErrorCard>}
  </section>;
}
