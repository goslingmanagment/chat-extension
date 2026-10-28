// «Заметки» on a ChatSpace tab, wired (2026-10-28, the owner: Fansly's notes on ChatSpace, kept in OnlyMonster's own fan
// notes; asked by a chatter). ChatSpace's notes chunk (`lazy/chatspace/notes.js`), loaded the first time a chat is open
// and kept. One panel for both sites (core application/notes, ui/notes); this is ChatSpace's adapter of it.
//
// - Only where the page's owner switched «Заметки» on and ChatSpace's chat header has our slot (the manifest's `notes`),
//   in an open chat: «Заметки N» in the header's row of actions, before ChatSpace's own search; the panel in our layer
//   900; ⌘⇧K — the early dispatcher's `notes` command — while it runs.
// - The notes are OnlyMonster's (core application/hosts/chatspace/notes.ts, host-chatspace om-api.ts): the very notes
//   ChatSpace's side panel shows, read when the panel opens and by «Обновить», written only by the chatter's click and
//   only for the fan of the chat on the route; one write at a time, a reread before an edit, a colleague's change never
//   overwritten. The quick note is signed with the chatter's hub login as its title, as on Fansly.
// - Right of the chat ChatSpace keeps its own column (its side panel and the rail that opens it): the panel stands over
//   it edge to edge, as on Fansly it stands in the free column right of the chat, and the conversation stays whole.
//   Without that column it stands over the chat's right edge, under the header and above the composer and our dock,
//   and «Всегда справа» opens by the button there (host-chatspace notes-place.ts). A change of the chat's width (the
//   side panel opened or closed) moves an open panel.
// - «✨ Заполнить из чата»: where the page's `notesFill` is on, the shared operation `notes-fill` of the open chat
//   (`notes.fill.start`, a click's token; the background adds the operation, background/notes.ts): the chat is the fan,
//   the questionnaire's labels and values ride in the hub's request body only. Its stage comes as `op.update`, its end as
//   `notes.fill.done`, or with the read right after the admission.
// - OnlyMonster's socket says when the notes change (`user-notes`): an open panel reads them again (with the tap on).
// - 2026-10-29: each write OnlyMonster took is told to the hub's record of who wrote each note (`notes.written`; ids,
//   the action, where in the panel, never a text), and the questionnaire says who created it and who changed it last
//   (`notes.authors`), as on Fansly.
// - The page's switch is read from the hub's context; its last answer holds while the context is read again or the
//   background is out of reach, as on Fansly. A context that says no takes the button, the key and the panel away.

import { AI_REQUEST_LIMITS } from '@cg/contracts/limits';
import { chatKeyOf, type ChatRef } from '@cg/contracts/ids';
import type { NoteAttributionAction } from '@cg/contracts/hub';
import type { NotesAction, NotesClient } from '@cg/contracts/notes';
import { NATIVE_ID_PATTERN } from '@cg/contracts/primitives';
import type { MountSurfaceKind } from '@cg/contracts/vm';
import { createPageContext, failureClass, type PageContextState } from '@cg/core/application/boards';
import { createOmNotesStore } from '@cg/core/application/hosts/chatspace/notes';
import { createNotesController, notesActionFacts, notesAvailability, type NoteWriteHow, type NotesPort } from '@cg/core/application/notes';
import { admittedOn } from '@cg/core/domain/features';
import { omNoteText, omNoteWrite } from '@cg/core/domain/hosts/chatspace/notes-html';
import { CHATSPACE_NOTES_TEXTS } from '@cg/core/domain/hosts/chatspace/i18n/notes';
import type { ChatSpaceHostPort } from '@cg/host-chatspace/isolated';
import { notesMeasure } from '@cg/host-chatspace/isolated/notes-place';
import { NOTES_SURFACE, notesButtonSurface, notesPanelSurface } from '@cg/ui/notes';
import { mountKitSurface, type KitMount } from '@cg/ui/kit';

import type { SiteAppEnv } from '../../adapter';
import { overlayRoot } from '../../surfaces';

/** Above OnlyMonster's own wait (the host port's) and the background's. */
export const NOTES_REQUEST_TIMEOUT_MS = 45_000;
/** The header slot's order: ours is the only one on ChatSpace. */
const NOTES_ORDER = 10;
/** The panel's typing: never a line of the chatter's log. */
const TYPING: ReadonlySet<NotesAction['type']> = new Set(['input', 'field-input', 'quick-input', 'name-input']);
/** OnlyMonster's socket may tell one change several times: an open panel reads again at most this often. */
const SOCKET_REREAD_MS = 2_000;

export function startChatSpaceNotes(env: SiteAppEnv<ChatSpaceHostPort>): () => void {
  const { host, rpc, win } = env;
  const context = createPageContext({ rpc, host });
  const measure = notesMeasure(win.document, env.mounts.dock.host);
  const fanNotes = host.fanNotes;
  const store = fanNotes === undefined ? null : createOmNotesStore({ host: fanNotes, text: omNoteText, write: omNoteWrite });
  /** The switch as the context last answered it, for the identity (epoch) it answered under. */
  let admitted: { readonly epoch: number; readonly on: boolean } | null = null;
  const unsettled = (ctx: PageContextState): boolean => ctx.phase === 'loading' || (ctx.phase === 'blocked' && ctx.blocker !== null && failureClass(ctx.blocker.code) === 'offline');
  const allowed = (): boolean => {
    if (store === null) return false;
    const ctx = context.current();
    const { capabilities } = host.probe();
    if (ctx.phase === 'ready') {
      admitted = { epoch: ctx.epoch, on: admittedOn(env.features, 'notes', null, ctx.bootstrap, ctx.page, capabilities).usable };
      return admitted.on;
    }
    if (!unsettled(ctx) || admitted === null || admitted.epoch !== ctx.epoch || !admitted.on) return false;
    return ctx.bootstrap === null || ctx.page === null || admittedOn(env.features, 'notes', null, ctx.bootstrap, ctx.page, capabilities).usable;
  };
  const fillAllowed = (): boolean => {
    const ctx = context.current();
    return ctx.phase === 'ready' && admittedOn(env.features, 'notes-fill', 'generate', ctx.bootstrap, ctx.page, host.probe().capabilities).usable;
  };
  /** The chat on the route, if it is this fan's of this account. */
  const openChat = (accountId: string, fanId: string): ChatRef | null => {
    const chat = host.current().route.chat;
    return chat !== null && chat.hostAccountId === accountId && chat.platformFanId === fanId ? chat : null;
  };
  const gone = { ok: false, error: { code: 'CG-CONTEXT-CHANGED' } } as const;
  /** The hub page this tab works, as the context last read it. */
  const pageIdOf = (): number | undefined => context.current().page?.pageId;
  /** A write OnlyMonster took, told to the hub's record of who wrote each note (the background admits and owes it). */
  const told = (fanRef: string, noteRef: string, action: NoteAttributionAction, how: NoteWriteHow | undefined): void => {
    const pageId = pageIdOf();
    if (pageId === undefined || !NATIVE_ID_PATTERN.test(noteRef)) return;
    const origin = how === undefined ? {} : { origin: how.origin, ...(how.fields === undefined ? {} : { fields: [...how.fields] }) };
    void rpc.request('notes.written', { pageId, fanRef, noteRef, action, ...origin }, { timeoutMs: NOTES_REQUEST_TIMEOUT_MS }).catch(() => undefined);
  };

  const port: NotesPort = {
    session() {
      const id = host.identity();
      return id === null ? null : `${id.hostAccountId}|${id.hostLoginEpoch}`;
    },
    target() {
      const { route, identity } = host.current();
      const chat = route.chat;
      if (!allowed() || !host.header.available() || identity === null || route.name !== 'chat' || chat === null || chat.hostAccountId !== identity.hostAccountId) return null;
      const fan = host.fan(chat);
      // On OnlyFans the chat is the fan.
      return {
        accountId: chat.hostAccountId,
        groupId: chat.platformFanId,
        fanId: chat.platformFanId,
        fan: fan === null ? null : { name: fan.displayName ?? fan.username, handle: fan.username },
      };
    },
    async read(t) {
      const chat = t.fanId === null ? null : openChat(t.accountId, t.fanId);
      if (store === null || chat === null) return gone;
      const read = await store.read(chat);
      return read.ok ? { ok: true, fanRef: chat.platformFanId, notes: read.notes, customName: null } : read;
    },
    async create(who, title, text, how) {
      const chat = openChat(who.accountId, who.fanId);
      if (store === null || chat === null) return gone;
      const made = await store.create(chat, title, text);
      if (made.ok) told(who.fanId, made.note.noteId, 'created', how);
      return made;
    },
    async edit(who, noteId, title, text, current, how) {
      const chat = openChat(who.accountId, who.fanId);
      if (store === null || chat === null) return gone;
      const changed = await store.edit(chat, noteId, title, text, current);
      if (changed.ok) told(who.fanId, noteId, 'edited', how);
      return changed;
    },
    async remove(who, note, how) {
      const chat = openChat(who.accountId, who.fanId);
      if (store === null || chat === null) return gone;
      const removed = await store.remove(chat, note.noteId);
      if (removed.ok) told(who.fanId, note.noteId, 'deleted', how);
      return removed;
    },
    async authors(_t, fanId) {
      const pageId = pageIdOf();
      if (pageId === undefined) return null;
      const answer = await rpc.request('notes.authors', { pageId, fanRef: fanId }, { timeoutMs: NOTES_REQUEST_TIMEOUT_MS }).catch(() => null);
      return answer === null || !answer.ok || !answer.payload.ok ? null : new Map(answer.payload.notes.map((note) => [note.noteId, { created: note.created, edited: note.edited }]));
    },
    // No «Имя для себя» on ChatSpace: the panel shows the fan's own name (`name` absent).
    fillAllowed,
    async fill(t, fanId, fields, values) {
      const { route, accounts, identity } = host.current();
      const chat = route.chat;
      const account = accounts.find((entry) => entry.hostAccountId === identity?.hostAccountId);
      // The chat the person pressed in, still open: the fill is that fan's.
      if (!fillAllowed() || chat === null || account === undefined || chat.hostAccountId !== t.accountId || chat.platformFanId !== fanId) return gone;
      const binding = await rpc.request('binding.resolve', { account });
      if (!binding.ok) return binding;
      const token = await rpc.request('token.issue', { kind: 'generate', surface: 'dock' });
      if (!token.ok) return token;
      if (openChat(t.accountId, fanId) === null) return gone;
      const started = await rpc.request(
        'notes.fill.start',
        {
          feature: 'notes-fill',
          target: { binding: binding.payload.binding, chat, fanRef: fanId, conversationRef: fanId },
          cause: { kind: 'click', actionToken: token.payload.actionToken },
          window: AI_REQUEST_LIMITS.messageCountMax,
          fields: [...fields],
          // The owner's ruling of 2026-10-17 (X43): the questionnaire's values go to the hub's merge mode, in its body only.
          values: [...values],
          force: true,
        },
        { timeoutMs: NOTES_REQUEST_TIMEOUT_MS },
      );
      if (!started.ok) return started;
      if (!started.payload.ok) return { ok: false, error: { code: started.payload.code } };
      const { opId } = started.payload;
      const read = await rpc.request('notes.fill.read', { opId }, { timeoutMs: NOTES_REQUEST_TIMEOUT_MS });
      return { ok: true, opId, view: read.ok ? read.payload.view : null };
    },
    stopFill(opId) {
      void rpc.request('notes.fill.cancel', { opId }, { timeoutMs: NOTES_REQUEST_TIMEOUT_MS }).catch(() => undefined);
    },
    setView(view) {
      void rpc.request('notes.setView', { view }, { timeoutMs: NOTES_REQUEST_TIMEOUT_MS }).then(
        (answer) => {
          if (answer.ok) controller.applyView(answer.payload.view);
        },
        () => undefined,
      );
    },
    fits: () => measure.fits(),
    place: () => measure.place(),
    setTimer: (ms, run) => win.setTimeout(run, ms),
    clearTimer: (handle) => win.clearTimeout(handle as number),
    author: () => context.current().session?.login ?? null,
  };
  const controller = createNotesController(port);
  // The chatter's log (2026-10-21): the surfaces dispatch through this, so every click is written, never its text.
  const client: NotesClient = {
    panel: () => controller.panel(),
    trigger: () => controller.trigger(),
    subscribe: (listener) => controller.subscribe(listener),
    dispatch(action) {
      if (!TYPING.has(action.type)) env.journal?.action('notes', `notes.${action.type}`, notesActionFacts(action));
      controller.dispatch(action);
    },
  };
  const decisions = env.journal?.watch('notes') ?? null;
  const decide = (): void => {
    if (decisions === null) return;
    const chat = host.current().route.chat;
    try {
      decisions.see(chat === null ? 'notes' : chatKeyOf(chat), notesAvailability(controller.trigger(), controller.panel()));
    } catch {
      // The log never breaks the panel.
    }
  };

  let slot: ReturnType<ChatSpaceHostPort['header']['mount']> | null = null;
  let button: KitMount | null = null;
  let panel: KitMount | null = null;
  const report = (): void => {
    if (env.probe === null) return;
    const { shown, view, place, body, form, items, editor } = controller.panel();
    // Test builds: what the e2e reads — states and ids, never a note's text.
    env.probe.set('notes', {
      shown,
      view,
      place: place?.kind ?? null,
      body,
      form: form === null ? null : { id: form.noteId, field: form.field?.saving === true ? 'saving' : form.field === null ? null : 'open', fill: form.fill?.status ?? null },
      notes: items.map((note) => ({ id: note.noteId, foreign: note.foreign, ...(note.cut ? { cut: true } : {}), ...(note.color === undefined || note.color === null ? {} : { color: note.color }) })),
      editor: editor === null ? null : { noteId: editor.noteId, saving: editor.saving, blocked: editor.blocked, problem: editor.problem?.kind ?? null },
      name: null,
      count: controller.trigger().count,
    });
  };
  const sync = (): void => {
    if (env.life.aborted) return;
    const on = allowed() && host.header.available();
    if (on && slot === null) {
      slot = host.header.mount(NOTES_ORDER);
      button = mountKitSurface('header-slot' as MountSurfaceKind, slot.root, env.deps, notesButtonSurface(client, CHATSPACE_NOTES_TEXTS, 'pill'), { report: env.report });
    } else if (!on && slot !== null) {
      button?.unmount();
      button = null;
      slot.remove();
      slot = null;
    }
    const allowedNow = allowed();
    if (allowedNow && panel === null) panel = mountKitSurface(NOTES_SURFACE, overlayRoot(env.mounts, 'panel'), env.deps, notesPanelSurface(client, CHATSPACE_NOTES_TEXTS), { report: env.report });
    else if (!allowedNow && panel !== null) {
      panel.unmount();
      panel = null;
    }
    controller.sync();
  };
  const onResize = (): void => controller.layout();
  // Esc with the focus on the page itself puts the panel away; a key in our UI goes to its own element (the early
  // dispatcher). A field of ChatSpace's keeps its Esc unless the panel is the centred window, and «Всегда справа» in
  // ChatSpace's own column is not put away by a key, as on Fansly.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !event.isTrusted) return;
    const vm = controller.panel();
    if (!vm.shown || (vm.view === 'docked' && !vm.narrow)) return;
    const active = win.document.activeElement as HTMLElement | null;
    const field = active !== null && (active.isContentEditable || ['input', 'textarea', 'select'].includes(active.localName));
    if (field && vm.view !== 'center') return;
    event.preventDefault();
    controller.dispatch({ type: 'close' });
  };
  // OnlyMonster's socket: the notes changed (ours, a colleague's, Monster's own tab). An open panel reads them again.
  let lastReread = 0;
  const onNotesChanged = (change: { readonly hostAccountId?: string | null; readonly platformFanId?: string | null } | null): void => {
    const vm = controller.panel();
    const chat = host.current().route.chat;
    if (!vm.shown || chat === null || vm.writing) return;
    if (change?.hostAccountId !== undefined && change.hostAccountId !== null && change.hostAccountId !== chat.hostAccountId) return;
    if (change?.platformFanId !== undefined && change.platformFanId !== null && change.platformFanId !== chat.platformFanId) return;
    const now = Date.now();
    if (now - lastReread < SOCKET_REREAD_MS) return;
    lastReread = now;
    controller.dispatch({ type: 'refresh' });
  };
  win.addEventListener('resize', onResize);
  win.document.addEventListener('keydown', onKey);
  const offs = [
    host.subscribe((event) => {
      if (event.type === 'route' || event.type === 'accounts') sync();
    }),
    host.onContract(sync),
    host.header.onChange(sync),
    context.subscribe(sync),
    controller.subscribe(report),
    controller.subscribe(decide),
    fanNotes?.onChanged?.(onNotesChanged) ?? (() => undefined),
    rpc.onEvent('notes.viewChanged', ({ view }) => controller.applyView(view)),
    rpc.onEvent('notes.fill.done', ({ view }) => controller.fillDone(view)),
    rpc.onEvent('op.update', (update) => controller.fillUpdate(update)),
    env.keys.handle('notes', () => {
      env.journal?.action('notes', 'notes.toggle', { input: 'key' });
      controller.toggle();
    }),
    measure.onChange(onResize),
    () => win.removeEventListener('resize', onResize),
    () => win.document.removeEventListener('keydown', onKey),
  ];
  void rpc.request('notes.view', {}, { timeoutMs: NOTES_REQUEST_TIMEOUT_MS }).then(
    (answer) => {
      if (answer.ok && !env.life.aborted) controller.applyView(answer.payload.view);
    },
    () => undefined,
  );
  sync();
  return () => {
    for (const off of offs.splice(0)) off();
    controller.dispose();
    context.dispose();
    button?.unmount();
    panel?.unmount();
    slot?.remove();
    button = null;
    panel = null;
    slot = null;
  };
}
