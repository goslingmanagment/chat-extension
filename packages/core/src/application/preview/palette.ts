// Previews of the fans ChatSpace already shows online (CS-030): the palette
// lists them from the host's cached chat list — there is no polling of our
// own for who is online — and a preview opens by the handle minted here, in
// a window of its own (decision X24). Money and dates come from the Spenders
// board when it has the fan's row; otherwise they are unknown.
//
// The palette's choice carries the list it showed: «Онлайн» as the person saw
// it, filtered by the query and cut to the group's length. The preview's
// previous and next walk exactly that list, in that order, so J and K never
// reach a fan the person was not shown. A fan of that list keeps their
// preview when ChatSpace stops showing them online meanwhile; any other fan
// gets a preview from here only while ChatSpace shows them online.

import { type CgCode } from '@cg/contracts/errors';
import { type HostEvent, type HostPort, type NavigationItem } from '@cg/contracts/host';
import { type ActionReceipt, type I18n, type TargetHandle } from '@cg/contracts/vm';

import { type SpenderRow } from '../../domain/spenders/rows';
import { type PageContextPort } from '../boards/context';
import { fanHandle, parseFanHandle } from '../boards/handles';
import { type PreviewDirectory } from '../boards/shared';
import { refused, type SurfaceController } from '../boards/surface';
import { localError } from '../boards/views';

/** Rows of the cached chat list looked through for online fans. */
export const ONLINE_LIST_LIMIT = 200;

export interface OnlineFan {
  readonly handle: TargetHandle;
  readonly fanRef: string;
  readonly name: string;
  readonly username: string | null;
}

/** A chat as the palette names it: the OnlyMonster account and the OnlyFans fan. */
export interface OnlineChat {
  readonly hostAccountId: string;
  readonly platformFanId: string;
}

export interface PaletteDirectoryDeps {
  readonly host: HostPort;
  readonly context: PageContextPort;
  readonly rowOf: (pageId: number, fanRef: string) => SpenderRow | null;
  /** The board's rows changed: a preview's money and dates follow. */
  readonly rowsChanged?: (listener: () => void) => () => void;
}

export interface PaletteDirectory extends PreviewDirectory {
  /** The online fans of the bound account, in the order ChatSpace lists them (the palette's «online» group). */
  online(): readonly OnlineFan[];
  /**
   * The person chose `chat` in the palette's «Онлайн», which showed `shown` (in its order): the handle of the
   * fan's preview on the bound page, with `shown` kept as the list the preview's neighbours walk. Refused — the
   * reason: nobody is signed in or the account is bound to no page (the context's own code), the chat is of
   * another account than the one the boards are bound to, or ChatSpace does not show the fan online.
   */
  choose(chat: OnlineChat, shown: readonly OnlineChat[]): { readonly ok: true; readonly handle: TargetHandle } | { readonly ok: false; readonly code: CgCode };
  dispose(): void;
}

const text = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

export function createPaletteDirectory(deps: PaletteDirectoryDeps): PaletteDirectory {
  const { host, context } = deps;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const offHost = host.subscribe((event: HostEvent) => {
    if (event.type !== 'chatCache' && event.type !== 'accounts' && event.type !== 'route') return;
    notify();
  });
  const offRows = deps.rowsChanged?.(notify) ?? null;
  /** The list the palette showed at the person's last choice: its page and its fans, in its order. */
  let walk: { readonly pageId: number; readonly fanRefs: readonly string[] } | null = null;

  const rows = (): readonly NavigationItem[] => {
    const binding = context.current().binding;
    return binding === null ? [] : host.listCachedChats(binding.hostAccountId, ONLINE_LIST_LIMIT);
  };
  const items = (): readonly NavigationItem[] => rows().filter((item) => item.isOnline === true);
  const walked = (pageId: number): readonly string[] => (walk !== null && walk.pageId === pageId ? walk.fanRefs : []);

  const fanOf = (item: NavigationItem, pageId: number): OnlineFan => {
    const username = text(item.username)?.replace(/^@/, '') ?? null;
    return { handle: fanHandle('palette', pageId, item.chat.platformFanId), fanRef: item.chat.platformFanId, name: text(item.displayName) ?? username ?? item.chat.platformFanId, username };
  };

  const online = (): OnlineFan[] => {
    const pageId = context.current().binding?.pageId ?? null;
    return pageId === null ? [] : items().map((item) => fanOf(item, pageId));
  };

  /** The fan's row of ChatSpace's list when a preview from here may show them: online now, or on the list the palette showed. */
  const rowOfFan = (pageId: number, fanRef: string): NavigationItem | null =>
    rows().find((candidate) => candidate.chat.platformFanId === fanRef && (candidate.isOnline === true || walked(pageId).includes(fanRef))) ?? null;

  return {
    online,
    choose(chat, shown) {
      const ctx = context.current();
      const binding = ctx.binding;
      if (binding === null) return { ok: false, code: ctx.blocker?.code ?? 'CG-BINDING-MISSING' };
      if (chat.hostAccountId !== binding.hostAccountId) return { ok: false, code: 'CG-CONTEXT-CHANGED' };
      const fanRefs = shown.filter((other) => other.hostAccountId === binding.hostAccountId).map((other) => other.platformFanId);
      if (!fanRefs.includes(chat.platformFanId)) fanRefs.unshift(chat.platformFanId);
      // Only a fan ChatSpace itself shows online at the click gets a preview from here.
      if (!items().some((item) => item.chat.platformFanId === chat.platformFanId)) return { ok: false, code: 'CG-GATE-FAN-UNKNOWN' };
      walk = { pageId: binding.pageId, fanRefs: [...new Set(fanRefs)] };
      notify();
      return { ok: true, handle: fanHandle('palette', binding.pageId, chat.platformFanId) };
    },
    resolve(handle) {
      const parsed = parseFanHandle(handle);
      const pageId = context.current().binding?.pageId ?? null;
      if (parsed === null || parsed.source !== 'palette' || pageId === null || parsed.pageId !== pageId) return null;
      const item = rowOfFan(pageId, parsed.fanRef);
      if (item === null) return null;
      const fan = fanOf(item, pageId);
      const row = deps.rowOf(pageId, parsed.fanRef);
      return {
        handle,
        source: 'palette',
        pageId,
        fanRef: parsed.fanRef,
        name: row?.name ?? fan.name,
        username: row?.username ?? fan.username,
        lifetime: row?.lifetime ?? null,
        period30: null,
        weWroteAt: row?.weWroteAt ?? null,
        fanWroteAt: row?.fanWroteAt ?? null,
        newcomer: null,
      };
    },
    neighbours(handle) {
      const parsed = parseFanHandle(handle);
      if (parsed === null || parsed.source !== 'palette') return { previous: null, next: null };
      // The list the palette showed, when this fan is on it; else ChatSpace's online fans as they are now.
      const shown = walked(parsed.pageId);
      const order = shown.includes(parsed.fanRef) ? shown.map((fanRef) => fanHandle('palette', parsed.pageId, fanRef)) : online().map((fan) => fan.handle);
      const at = order.indexOf(handle);
      if (at < 0) return { previous: null, next: null };
      return { previous: order[at - 1] ?? null, next: order[at + 1] ?? null };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      offHost();
      offRows?.();
      listeners.clear();
      walk = null;
    },
  };
}

/**
 * Opens OUR preview of a fan the palette's «Онлайн» showed (CS-030, X24): the directory names the fan's handle
 * and keeps the shown list for the neighbours, the preview controller opens it — nothing is read from ChatSpace
 * and no chat opens. A refusal is the receipt of `OpenPreview` with the reason.
 */
export async function openOnlinePreview(
  directory: Pick<PaletteDirectory, 'choose'>,
  preview: Pick<SurfaceController, 'dispatch'>,
  i18n: I18n,
  chat: OnlineChat,
  shown: readonly OnlineChat[],
): Promise<ActionReceipt> {
  const chosen = directory.choose(chat, shown);
  if (!chosen.ok) return refused('OpenPreview', localError(chosen.code, i18n));
  return (await preview.dispatch({ type: 'OpenPreview', targetHandle: chosen.handle })) ?? refused('OpenPreview', localError('CG-GATE-FAN-UNKNOWN', i18n));
}
