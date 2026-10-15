import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../kit';
import type { SiteAccessControl } from '@cg/contracts/site-access';

export interface SiteAccessProps {
  readonly control: SiteAccessControl;
  readonly title: string;
  readonly enable: string;
  readonly disable: string;
  readonly reload: string;
  readonly waiting: (count: number) => string;
}
export function SiteAccess(props: SiteAccessProps): JSX.Element {
  const [view, setView] = useState(props.control.value);
  useEffect(() => props.control.subscribe(() => setView(props.control.value)), [props.control]);
  const on = view.state?.enabled === true && view.state.granted;
  return <section class="pg-card" aria-label={props.title} style="max-width:336px;box-sizing:border-box;margin:12px;padding:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
    <b>{props.title}</b>
    <Button variant="plain" busy={view.busy} label={on ? props.disable : props.enable} onClick={() => { void (on ? props.control.disable() : props.control.enable()); }} />
    {(view.state?.waitingReload ?? 0) > 0 && <>
      <span>{props.waiting(view.state?.waitingReload ?? 0)}</span>
      <Button busy={view.busy} label={props.reload} onClick={() => { void props.control.reload(); }} />
    </>}
    {view.error !== null && <span role="alert">{view.error}</span>}
  </section>;
}
