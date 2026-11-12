// The open chat's pin in Fansly's own chat header (2026-11-12): the first of our marks there, after «Gallery», in that
// row's size and colour as «Заметки» and «Регистрация» beside it. One glyph, the same width pinned or not (its head
// filled when pinned), `aria-pressed`; a click pins or unpins the open chat, and the focus stays where it was. Until
// the person's switch is known it keeps its place unseen: someone who switched pins off never sees it flash.
import type { JSX } from 'preact';

import type { FanslyPinsClient, FanslyPinsCopy } from '@cg/contracts/fansly-pins';

import { useI18n, type SurfaceDefinition } from '../../../kit';
import { PinGlyph, useClientView } from './PinStrip';

export function pinHeaderSurface(client: FanslyPinsClient, texts: Readonly<Record<'ru' | 'en', FanslyPinsCopy>>): SurfaceDefinition {
  function PinHeaderButton(): JSX.Element | null {
    const i18n = useI18n();
    const copy = texts[i18n.language];
    const view = useClientView(client);
    const pinned = view.header?.pinned === true;
    const label = pinned ? copy.unpin : copy.pin;
    return (
      // Unseen, its width kept, until the switch is known: nothing of the header moves when it shows.
      <span class="cg-ph" data-pinned={pinned ? 'true' : 'false'} data-settled={view.header?.settled === true ? 'true' : 'false'} hidden={view.header === null}>
        <span aria-hidden="true" class="cg-ph__divider">
          |
        </span>
        <button
          type="button"
          class="cg-ph__button"
          title={label}
          aria-label={label}
          aria-pressed={pinned ? 'true' : 'false'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => client.toggleOpen()}
        >
          <PinGlyph size={13} filled={pinned} stroke={1.9} />
        </button>
      </span>
    );
  }
  return {
    view: PinHeaderButton,
    styles: [
      {
        id: 'cg-pin-header',
        css: `
    :host { display: inline-flex; }
    .cg-root[data-cg-surface='header-slot'] { container-type: normal; }
    .cg-ph { display: inline-flex; align-items: center; gap: 4px; color: var(--cg-ink-muted); font-size: 12px; line-height: 14px; white-space: nowrap; }
    .cg-ph[hidden] { display: none; }
    .cg-ph[data-settled='false'] { visibility: hidden; }
    .cg-ph__divider { margin: 0 2px; }
    .cg-ph__button { all: unset; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; cursor: pointer; border-radius: 4px; transition: color 100ms ease; }
    .cg-ph__button:hover { color: var(--cg-accent); }
    .cg-ph[data-pinned='true'] .cg-ph__button { color: var(--blue-1, var(--cg-accent)); }
    .cg-ph__button:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
  `,
      },
    ],
  };
}
