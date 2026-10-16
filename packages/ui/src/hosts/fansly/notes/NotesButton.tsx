// «Заметки» in Fansly's own chat header (R20 P11b, FS-NOTE-1, FX-004): after «Регистрация», in that row's size and
// colour; the open chat's number of notes once they are read. A click — or ⌘⇧K — opens and closes the panel.
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import type { NotesClient, NotesCopy } from '@cg/contracts/notes-fansly';

import { hotkeyText, useI18n, useKit } from '../../../kit';

/** Both catalogs: the tab's language picks one at each render. */
export type NotesTexts = Readonly<Record<'ru' | 'en', NotesCopy>>;

function NoteIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.25 2.75h9.5v6.5l-3.5 4h-6Z M9.25 13.25v-4h3.5" />
    </svg>
  );
}

/** Re-renders on every change of the client — and once as it subscribes: a change between the first render and the effect is not lost. */
export function useNotesTick(client: NotesClient): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const off = client.subscribe(() => setTick((n) => n + 1));
    setTick((n) => n + 1);
    return off;
  }, [client]);
}

export function NotesButton({ client, texts }: { readonly client: NotesClient; readonly texts: NotesTexts }): JSX.Element | null {
  useNotesTick(client);
  const { deps } = useKit();
  const copy = texts[useI18n().language];
  const view = client.trigger();
  if (!view.shown) return null;
  const key = hotkeyText(deps.catalog.entry('notes').hotkey);
  return (
    <span class="cg-nb" data-notes-count={view.count ?? ''} data-notes-open={view.open ? 'true' : 'false'}>
      <span aria-hidden="true" class="cg-nb__divider">
        |
      </span>
      <button
        type="button"
        class="cg-nb__button"
        aria-pressed={view.open ? 'true' : 'false'}
        title={key === null ? copy.title : `${copy.title} (${key.display})`}
        {...(key === null || key.aria === '' ? {} : { 'aria-keyshortcuts': key.aria })}
        onClick={() => client.dispatch({ type: 'toggle' })}
        onKeyDown={(event) => {
          // Esc on the button puts away the panel it opened, as Esc in the panel does (where the panel may close).
          if (event.key !== 'Escape' || event.defaultPrevented || !view.open) return;
          const panel = client.panel();
          if (panel.view === 'docked' && !panel.narrow) return;
          event.preventDefault();
          client.dispatch({ type: 'close' });
        }}
      >
        <NoteIcon />
        <span>{copy.button}</span>
        {view.count !== null && view.count > 0 ? <span class="cg-nb__count">{view.count}</span> : null}
      </button>
    </span>
  );
}
