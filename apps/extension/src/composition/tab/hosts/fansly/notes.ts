// «Заметки» on a Fansly tab, wired (R20 P11b; FS-NOTE-1…5; docs/project-unite/architecture.md §7.4, §8.9): Fansly's
// notes chunk (`lazy/fansly/notes.js`), loaded with «Регистрация» the first time the tab is on /messages and kept.
//
// - Only where the page's owner switched «Заметки» on and the header has its slot (the manifest's `notes`: the page's
//   flag `notes`, the host's capability `headerSlot`), in an open one-to-one chat: the button in the header slot after
//   «Регистрация» (order 20), the panel in our layer 900, ⌘⇧K — the early dispatcher's `notes` command — while it runs.
// - The controller (core application/hosts/fansly/notes) asks `fansly.notes.*` of the background; the page's boxes
//   are measured when asked (host-fansly notes-place.ts): on the route, the header, a resize — no observer of ours;
//   the panel over the chat stops above Fansly's composer (and our dock over it), never over them.
// - The view is `settings.ext`'s, one for every tab: read once, followed by the background's event.
// - «✨ Заполнить из чата» (R20 P11c, FS-NOTE-6): where the page's `notesFill` is on, the site operation `notes-fill` of
//   the open chat through the shared admission (`fansly.ops.start`, a click's token): the group as the conversation,
//   the fan apart, the questionnaire's labels only; the background's driver sets the depth (HF-6). Each press is a
//   fresh read of the chat (`force`); its end comes as `fansly.ops.done`, or with the read right after the admission.

import { AI_REQUEST_LIMITS } from '@cg/contracts/limits';
import type { SiteOpView } from '@cg/contracts/ops';
import type { FanslyNotesView } from '@cg/contracts/settings-ext';
import type { MountSurfaceKind } from '@cg/contracts/vm';
import { createPageContext } from '@cg/core/application/boards';
import { createNotesController, type NotesPort } from '@cg/core/application/hosts/fansly/notes';
import { admittedOn } from '@cg/core/domain/features';
import { NOTES_TEXTS } from '@cg/core/domain/hosts/fansly/i18n';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import { fanslyModalOpen, notesMeasure } from '@cg/host-fansly/isolated/notes-place';
import { NOTES_SURFACE, notesButtonSurface, notesPanelSurface } from '@cg/ui/hosts/fansly/notes';
import { mountKitSurface, type KitMount } from '@cg/ui/kit';

import type { SiteAppEnv } from '../../adapter';
import { overlayRoot } from '../../surfaces';
import { fanslyRequest } from './requests';

/** Above the background's own wait for Fansly (30 s, fansly-api) and for its module. */
export const NOTES_REQUEST_TIMEOUT_MS = 45_000;
/** The header's order of «Заметки»: after «Регистрация» (10). */
const NOTES_ORDER = 20;

type Wire = { readonly ok: false; readonly error: { readonly code: string } };

export function startFanslyNotes(env: SiteAppEnv<FanslyPort>): () => void {
  const { host, rpc, win } = env;
  const context = createPageContext({ rpc, host });
  const measure = notesMeasure(win.document, env.mounts.dock.host);
  const allowed = (): boolean => {
    const ctx = context.current();
    const report = host.probe();
    return ctx.phase === 'ready' && admittedOn(env.features, 'notes', null, ctx.bootstrap, ctx.page, { ...report.capabilities, ...report.extensions['fansly-web'].capabilities }).usable;
  };
  const fillAllowed = (): boolean => {
    const ctx = context.current();
    const report = host.probe();
    return ctx.phase === 'ready' && admittedOn(env.features, 'notes-fill', 'generate', ctx.bootstrap, ctx.page, { ...report.capabilities, ...report.extensions['fansly-web'].capabilities }).usable;
  };
  const pageId = (): number | undefined => context.current().page?.pageId;
  const refused = { ok: false, error: { code: 'CG-BINDING-NOT-GRANTED' } } as const;
  const ask = async <T extends Parameters<typeof fanslyRequest>[1]>(type: T, payload: Parameters<typeof fanslyRequest<T>>[2]) => {
    const answer = await fanslyRequest(rpc, type, payload, NOTES_REQUEST_TIMEOUT_MS);
    return answer.ok ? answer.payload : ({ ok: false, error: answer.error } as Wire);
  };
  const target = (accountId: string, fanId: string) => {
    const id = pageId();
    return id === undefined ? null : { pageId: id, hostAccountId: accountId, fanRef: fanId };
  };

  const port: NotesPort = {
    session() {
      const id = host.identity();
      return id === null ? null : `${id.hostAccountId}|${id.hostLoginEpoch}`;
    },
    target() {
      const { route, identity } = host.current();
      // The address is read again: the port's route may lag a switch the person just made.
      if (!allowed() || !host.header.available() || identity === null || route.name !== 'chat' || route.conversationRef === undefined || route.conversationKind === 'group' || win.location.pathname !== `/messages/${route.conversationRef}`) return null;
      const fan = route.chat === null ? null : host.fan(route.chat);
      return {
        accountId: identity.hostAccountId,
        groupId: route.conversationRef,
        fanId: route.chat?.platformFanId ?? null,
        fan: fan === null ? null : { name: fan.displayName ?? fan.username, handle: fan.username },
      };
    },
    async read(t, force) {
      const id = pageId();
      if (id === undefined) return refused;
      return (await ask('fansly.notes.read', { pageId: id, hostAccountId: t.accountId, fanRef: t.fanId, groupId: t.groupId, ...(force ? { force: true } : {}) })) as Awaited<ReturnType<NotesPort['read']>>;
    },
    async create(who, title, text) {
      const to = target(who.accountId, who.fanId);
      return to === null ? refused : ((await ask('fansly.notes.create', { ...to, title, text })) as Awaited<ReturnType<NotesPort['create']>>);
    },
    async edit(who, noteId, title, text, current) {
      const to = target(who.accountId, who.fanId);
      return to === null ? refused : ((await ask('fansly.notes.edit', { ...to, noteId, title, text, current })) as Awaited<ReturnType<NotesPort['edit']>>);
    },
    async remove(who, note) {
      const to = target(who.accountId, who.fanId);
      return to === null ? refused : ((await ask('fansly.notes.delete', { ...to, noteId: note.noteId, title: note.title, text: note.text })) as Awaited<ReturnType<NotesPort['remove']>>);
    },
    async name(who, name, current) {
      const to = target(who.accountId, who.fanId);
      return to === null ? refused : ((await ask('fansly.notes.name', { ...to, name, current })) as Awaited<ReturnType<NotesPort['name']>>);
    },
    fillAllowed,
    async fill(t, fanId, fields) {
      const { route, accounts, identity } = host.current();
      const chat = route.chat;
      const account = accounts.find((entry) => entry.hostAccountId === identity?.hostAccountId);
      // The chat the person pressed in, still open: the operation is that group's, for that fan.
      if (!fillAllowed() || chat === null || account === undefined || route.conversationRef !== t.groupId || chat.platformFanId !== fanId) return { ok: false, error: { code: 'CG-CONTEXT-CHANGED' } };
      const binding = await rpc.request('binding.resolve', { account });
      if (!binding.ok) return binding;
      const token = await rpc.request('token.issue', { kind: 'generate', surface: 'dock' });
      if (!token.ok) return token;
      const started = await fanslyRequest(rpc, 'fansly.ops.start', {
        feature: 'notes-fill',
        target: { binding: binding.payload.binding, chat, fanRef: fanId, conversationRef: t.groupId },
        cause: { kind: 'click', actionToken: token.payload.actionToken },
        window: AI_REQUEST_LIMITS.messageCountMax,
        fields: [...fields],
        force: true,
      }, NOTES_REQUEST_TIMEOUT_MS);
      if (!started.ok) return started;
      if (!started.payload.ok) return { ok: false, error: { code: started.payload.code } };
      const { opId } = started.payload;
      const read = await fanslyRequest(rpc, 'fansly.ops.read', { opId }, NOTES_REQUEST_TIMEOUT_MS);
      return { ok: true, opId, view: read.ok ? read.payload.view : null };
    },
    stopFill(opId) {
      void fanslyRequest(rpc, 'fansly.ops.cancel', { opId }, NOTES_REQUEST_TIMEOUT_MS);
    },
    setView(view) {
      void fanslyRequest(rpc, 'fansly.notes.setView', { view }, NOTES_REQUEST_TIMEOUT_MS).then((answer) => {
        if (answer.ok) controller.applyView(answer.payload.view);
      });
    },
    fits: () => measure.fits(),
    place: () => measure.place(),
    setTimer: (ms, run) => win.setTimeout(run, ms),
    clearTimer: (handle) => win.clearTimeout(handle as number),
  };
  const controller = createNotesController(port);

  let slot: ReturnType<FanslyPort['header']['mount']> | null = null;
  let button: KitMount | null = null;
  let panel: KitMount | null = null;
  const report = (): void => {
    if (env.probe === null) return;
    const { shown, view, place, body, notes, editor, name } = controller.panel();
    // Test builds: what the e2e reads — states and ids, never a note's text.
    env.probe.set('notes', { shown, view, place: place?.kind ?? null, body, notes: notes.map((note) => ({ id: note.noteId, foreign: note.foreign })), editor: editor === null ? null : { noteId: editor.noteId, saving: editor.saving, blocked: editor.blocked, problem: editor.problem?.kind ?? null }, name: name.status, count: controller.trigger().count });
  };
  const sync = (): void => {
    if (env.life.aborted) return;
    const on = allowed();
    if (on && slot === null) {
      slot = host.header.mount(NOTES_ORDER);
      button = mountKitSurface('header-slot' as MountSurfaceKind, slot.root, env.deps, notesButtonSurface(controller, NOTES_TEXTS), { report: env.report });
    } else if (!on && slot !== null) {
      button?.unmount();
      button = null;
      slot.remove();
      slot = null;
    }
    if (on && panel === null) panel = mountKitSurface(NOTES_SURFACE, overlayRoot(env.mounts, 'panel'), env.deps, notesPanelSurface(controller, NOTES_TEXTS), { report: env.report });
    else if (!on && panel !== null) {
      panel.unmount();
      panel = null;
    }
    controller.sync();
  };
  const onResize = (): void => controller.layout();
  // Esc with the focus on the page itself puts the panel away, as in the Fansly extension; a key in our UI goes to its
  // own element (the early dispatcher), where the panel and its button take it. A field of Fansly's keeps its Esc
  // unless the panel is the centred window, a modal of Fansly's keeps it always, and «Всегда справа» in its free
  // column is not put away by a key.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !event.isTrusted) return;
    const vm = controller.panel();
    if (!vm.shown || (vm.view === 'docked' && !vm.narrow) || fanslyModalOpen(win.document)) return;
    const active = win.document.activeElement as HTMLElement | null;
    const field = active !== null && (active.isContentEditable || ['input', 'textarea', 'select'].includes(active.localName));
    if (field && vm.view !== 'center') return;
    event.preventDefault();
    controller.dispatch({ type: 'close' });
  };
  const onView = (payload: unknown): void => {
    const view = (payload as { readonly view?: FanslyNotesView } | null)?.view;
    if (view !== undefined) controller.applyView(view);
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
    (rpc.onEvent as unknown as (type: string, listener: (payload: unknown) => void) => () => void)('fansly.notes.viewChanged', onView),
    (rpc.onEvent as unknown as (type: string, listener: (payload: unknown) => void) => () => void)('fansly.ops.done', (payload) => {
      const view = (payload as { readonly view?: SiteOpView } | null)?.view;
      if (view !== undefined) controller.fillDone(view);
    }),
    env.keys.handle('notes', () => {
      controller.toggle();
    }),
    () => win.removeEventListener('resize', onResize),
    () => win.document.removeEventListener('keydown', onKey),
  ];
  void fanslyRequest(rpc, 'fansly.notes.view', {}, NOTES_REQUEST_TIMEOUT_MS).then((answer) => {
    if (answer.ok && !env.life.aborted) controller.applyView(answer.payload.view);
  });
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
