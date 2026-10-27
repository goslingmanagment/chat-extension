// «Регистрация» in Fansly's own chat header (R20 P11a, FS-REG-1): after «Last seen … | Gallery», in that row's size
// and colour (12 px, Fansly's `--dark-blue-1` — our muted ink on its profile), so the row keeps its 14 px height; only
// the hover and the focus ring are ours. One click reveals the date; the shown date is text, not a dead button.
// The kit's root is an inline-size container (kit/base.ts), which would leave the slot 0 px wide with the date spilling
// past it: here it is no container, so the slot is as wide as its words and «Заметки» before it never lies over it.
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { I18nKey } from '@cg/contracts/errors';
import { cgTitleKey } from '@cg/contracts/i18n/keys';
import type { RegistrationClient, RegistrationI18n } from '@cg/contracts/registration-fansly';
import { useI18n, useNowFn, type SurfaceDefinition } from '../../kit';

interface Copy { readonly label: string; readonly hint: string; readonly failed: string; readonly loading: string }

function CalendarIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 1.75v2M11 1.75v2M2.75 6.5h10.5M4 3h8a1.25 1.25 0 0 1 1.25 1.25v8A1.25 1.25 0 0 1 12 13.5H4a1.25 1.25 0 0 1-1.25-1.25v-8A1.25 1.25 0 0 1 4 3Z" />
    </svg>
  );
}

export function registrationSurface(client: RegistrationClient, texts: Readonly<Record<'ru' | 'en', Copy>>, format: RegistrationI18n): SurfaceDefinition {
  function Registration(): JSX.Element {
    const i18n = useI18n();
    const now = useNowFn();
    const copy = texts[i18n.language];
    const [view, setView] = useState(() => client.view());
    useEffect(() => {
      setView(client.view());
      return client.subscribe(setView);
    }, []);
    const at = view.registeredAt;
    const loading = view.state === 'loading';
    return (
      // Polite: the date (or why there is none) replaces the button, and a reader hears it.
      <span class="cg-reg" data-registration={view.state} aria-live="polite">
        <span aria-hidden="true" class="cg-reg__divider">|</span>
        {at === null ? (
          <button type="button" class="cg-reg__button" aria-disabled={loading ? 'true' : undefined} title={copy.hint} onClick={() => void client.reveal()}>
            <CalendarIcon />
            <span>{loading ? copy.loading : view.state === 'failed' ? copy.failed : copy.label}</span>
          </button>
        ) : (
          <span class="cg-reg__value" title={format.time(at, i18n.language)}>
            <CalendarIcon />
            <span>{format.date(at, i18n.language)}</span>
            <span>· {format.age(at, now(), i18n.language)}</span>
          </span>
        )}
        {view.error === null ? null : <span class="cg-reg__error">· {i18n.t(cgTitleKey(view.error.code) as I18nKey)}</span>}
      </span>
    );
  }
  return {
    view: Registration,
    styles: [
      {
        id: 'cg-registration',
        css: `
    :host { display: inline-flex; }
    .cg-root[data-cg-surface='header-slot'] { container-type: normal; }
    .cg-reg { display: inline-flex; align-items: center; gap: 4px; color: var(--cg-ink-muted); font-size: 12px; line-height: 14px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .cg-reg__divider { margin: 0 2px; }
    .cg-reg__value { display: inline-flex; align-items: center; gap: 4px; }
    .cg-reg__button { all: unset; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; border-radius: 6px; }
    .cg-reg__button[aria-disabled='true'] { cursor: progress; }
    .cg-reg__button:not([aria-disabled='true']):hover { color: var(--cg-accent); }
    .cg-reg__button:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
    .cg-reg svg { width: 13px; height: 13px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
  `,
      },
    ],
  };
}
