// «Заметки» in the background for a site whose tab reads and writes the notes itself (2026-10-28: ChatSpace, whose
// notes are OnlyMonster's own fan notes, written through the page's own session on the chatter's click):
//
// - the panel's view, stored in `settings.ext` for every tab of every site (FS-NOTE-2), and told to every tab when it
//   changes;
// - «✨ Заполнить из чата» as an operation of the shared scheduler (`notes-fill`, notes-fill.ts): added to a site that
//   has no driver of its own, as the voice script is to every site. Fansly brings its own with its module and keeps
//   `fansly.ops.*`; nothing here changes it.
//
// - 2026-10-29: who created each of the open fan's notes and who changed it last (`notes.authors`, every site's tab:
//   the hub's record of our writes), and a write the tab made itself told to that record (`notes.written`, ChatSpace).
//
// A note's text never comes here: the tab writes the notes itself. Only the fill's labels and values ride in its start,
// to the hub's request body and nowhere else (FS-NOTE-5).

import type { CgCode } from '@cg/contracts/errors';
import { type HostKind } from '@cg/contracts/hosts';
import type { NotesView } from '@cg/contracts/notes';
import type { NotesFillOpView } from '@cg/contracts/notes-fill';
import type { OpState, SiteOpView } from '@cg/contracts/ops';
import { type SiteOperations, type StartOutcome } from '@cg/core/services';
import { NOTES_FILL_DRIVER, readNotesFillOpView } from '@cg/core/services/notes';
import type { NotesAuthors } from '@cg/contracts/tab-messages';
import type { RpcResult, TabRequestHandler } from '@cg/platform';

import { type KitSender } from './host-module';

export interface BackgroundNotesDeps {
  /** The page the start names, when the tab is bound to it and the hub grants it. */
  readonly page: (pageId: number, sender: KitSender) => Promise<{ readonly ok: true } | { readonly ok: false; readonly code: CgCode }>;
  readonly scheduler: {
    start(tabSessionId: string, start: Parameters<TabRequestHandler<'notes.fill.start'>>[0]): Promise<StartOutcome>;
    siteView(opId: string, host: HostKind): SiteOpView | null;
    cancel(opId: string): OpState | null;
  };
  readonly hostOfTab: (tabSessionId: string) => HostKind | null;
  /** Whether the tab's site may act now (its switch in the popup): a fill of a switched-off site is refused. */
  readonly siteActive: (tabSessionId: string) => boolean;
  /** The stored view; null — `settings.ext` could not be read or written. */
  readonly view: { read(): Promise<NotesView | null>; write(view: NotesView): Promise<NotesView | null> };
  /** A fill ended: to the tab that started it (null — not known here: every tab). */
  readonly done: (view: NotesFillOpView, tabSessionId: string | null) => void;
  /** Who created and last changed each of the fan's notes, for a page bound to the tab (`note-authors` admitted). */
  readonly authors: (host: HostKind, pageId: number, fanRef: string, sender: KitSender) => Promise<NotesAuthors>;
  /** A write the tab made itself, told to the hub's record; false — not owed (nobody signed in, the page does not take it). */
  readonly written: (host: HostKind, fact: Parameters<TabRequestHandler<'notes.written'>>[0], sender: KitSender) => Promise<boolean>;
}

const refused = (code: CgCode, detail?: string): RpcResult<never> => ({ ok: false, error: { code, ...(detail === undefined ? {} : { detail }) } });

export function createBackgroundNotes(deps: BackgroundNotesDeps) {
  /** The tab each running fill was started from, so its end goes back there. Memory only: a fill is the tab's. */
  const owners = new Map<string, string>();

  /** A site's operations with the shared fill added, unless the site brings its own. */
  function withNotesFill(host: HostKind, own: SiteOperations | null): SiteOperations | null {
    if (own?.drivers['notes-fill'] !== undefined) return own;
    return {
      host,
      drivers: { ...(own?.drivers ?? {}), 'notes-fill': NOTES_FILL_DRIVER },
      readView: (value) => readNotesFillOpView(value) ?? own?.readView(value) ?? null,
      done(view) {
        const fill = view.feature === 'notes-fill' ? readNotesFillOpView(view) : null;
        if (fill === null) {
          own?.done(view);
          return;
        }
        const tab = owners.get(fill.opId) ?? null;
        owners.delete(fill.opId);
        deps.done(fill, tab);
      },
    };
  }

  const ok = <T>(payload: T): RpcResult<T> => ({ ok: true, payload });
  const tabOf = (sender: KitSender): string | null => (sender.kind === 'tab' ? sender.tabSessionId : null);

  const handlers: {
    readonly 'notes.view': TabRequestHandler<'notes.view'>;
    readonly 'notes.setView': TabRequestHandler<'notes.setView'>;
    readonly 'notes.fill.start': TabRequestHandler<'notes.fill.start'>;
    readonly 'notes.fill.read': TabRequestHandler<'notes.fill.read'>;
    readonly 'notes.fill.cancel': TabRequestHandler<'notes.fill.cancel'>;
    readonly 'notes.authors': TabRequestHandler<'notes.authors'>;
    readonly 'notes.written': TabRequestHandler<'notes.written'>;
  } = {
    'notes.view': async () => {
      const view = await deps.view.read();
      return view === null ? refused('CG-STORAGE-READ') : ok({ view });
    },
    'notes.setView': async ({ view }) => {
      const stored = await deps.view.write(view);
      return stored === null ? refused('CG-STORAGE-WRITE') : ok({ view: stored });
    },
    'notes.fill.start': async (start, sender) => {
      const tab = tabOf(sender);
      if (tab === null) return refused('CG-UI-FAILED', 'tab only');
      if (!deps.siteActive(tab)) return refused('CG-SITE-OFF');
      // The fill is the open chat's: a chat of another site than the tab's is no start of this tab.
      if (deps.hostOfTab(tab) !== start.target.chat.host) return refused('CG-CONTEXT-CHANGED');
      const page = await deps.page(start.target.binding.pageId, sender);
      if (!page.ok) return refused(page.code);
      const outcome = await deps.scheduler.start(tab, start);
      if (outcome.kind !== 'admission') return refused(outcome.code);
      if (outcome.admission.ok) owners.set(outcome.admission.opId, tab);
      return ok(outcome.admission);
    },
    'notes.fill.read': ({ opId }, sender) => {
      const tab = tabOf(sender);
      const host = tab === null ? null : deps.hostOfTab(tab);
      return ok({ view: host === null ? null : readNotesFillOpView(deps.scheduler.siteView(opId, host)) });
    },
    'notes.fill.cancel': ({ opId }, sender) => {
      const tab = tabOf(sender);
      const host = tab === null ? null : deps.hostOfTab(tab);
      if (host === null || readNotesFillOpView(deps.scheduler.siteView(opId, host)) === null) return ok({ state: null });
      return ok({ state: deps.scheduler.cancel(opId) });
    },
    'notes.authors': async ({ pageId, fanRef }, sender) => {
      const tab = tabOf(sender);
      const host = tab === null ? null : deps.hostOfTab(tab);
      if (host === null) return ok({ ok: false, code: 'CG-UI-FAILED' });
      return ok(await deps.authors(host, pageId, fanRef, sender));
    },
    'notes.written': async (fact, sender) => {
      const tab = tabOf(sender);
      const host = tab === null ? null : deps.hostOfTab(tab);
      return ok({ queued: host !== null && (await deps.written(host, fact, sender)) });
    },
  };

  return { withNotesFill, handlers };
}
