import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { cgFanslyEntry, isCgFanslyCode } from '@cg/contracts/errors-fansly';
import type { I18nKey } from '@cg/contracts/errors';
import type { RegistrationClient, RegistrationI18n } from '@cg/contracts/registration-fansly';
import { useI18n, useNowFn, type SurfaceDefinition } from '../../kit';

interface Copy { readonly label: string; readonly hint: string; readonly failed: string; readonly loading: string }

export function registrationSurface(client: RegistrationClient, texts: Readonly<Record<'ru' | 'en', Copy>>, format: RegistrationI18n): SurfaceDefinition {
  function Registration(): JSX.Element {
    const i18n = useI18n();
    const now = useNowFn();
    const copy = texts[i18n.language];
    const [view, setView] = useState(() => client.view());
    useEffect(() => { setView(client.view()); return client.subscribe(setView); }, []);
    const at = view.registeredAt;
    const label = at === null ? view.state === 'loading' ? copy.loading : view.state === 'failed' ? copy.failed : copy.label
      : format.date(at, i18n.language);
    return <span class="cg-reg" data-registration={view.state}>
      <span aria-hidden="true" class="cg-reg__divider">|</span>
      <button type="button" class="cg-reg__button" disabled={view.state === 'loading' || view.state === 'shown'} title={at === null ? copy.hint : format.time(at, i18n.language)} onClick={() => void client.reveal()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1.75v2M11 1.75v2M2.75 6.5h10.5M4 3h8a1.25 1.25 0 0 1 1.25 1.25v8A1.25 1.25 0 0 1 12 13.5H4a1.25 1.25 0 0 1-1.25-1.25v-8A1.25 1.25 0 0 1 4 3Z" /></svg>
        <span>{label}</span>
      </button>
      {at === null ? null : <span class="cg-reg__age">· {format.age(at, now(), i18n.language)}</span>}
      {view.error === null ? null : <span class="cg-reg__error" role="status">{isCgFanslyCode(view.error.code) ? i18n.t(cgFanslyEntry(view.error.code).title as I18nKey) : copy.failed}</span>}
    </span>;
  }
  return { view: Registration, styles: [{ id: 'cg-registration', css: `
    :host { display: inline-flex; }
    .cg-reg { display:inline-flex; align-items:center; gap:6px; color:var(--cg-ink-2); font-size:12px; line-height:20px; white-space:nowrap; }
    .cg-reg__divider { opacity:.55; margin:0 2px; }
    .cg-reg__button { all:unset; display:inline-flex; align-items:center; gap:4px; color:var(--cg-ink-2); cursor:pointer; }
    .cg-reg__button:disabled { cursor:default; }
    .cg-reg__button:not(:disabled):hover { color:var(--cg-accent); }
    .cg-reg__button:focus-visible { outline:2px solid var(--cg-accent); outline-offset:2px; border-radius:3px; }
    .cg-reg svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:1.3; }
    .cg-reg__age { color:var(--cg-ink-muted); }
    .cg-reg__error { font-size:10px; color:var(--cg-ink-muted); }
  ` }] };
}
