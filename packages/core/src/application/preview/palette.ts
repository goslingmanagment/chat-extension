// Previews of the fans ChatSpace already shows online (CS-030): the palette
// lists them from the host's cached chat list — there is no polling of our
// own for who is online — and a preview opens by the handle minted here.
// Money and dates come from the Spenders board when it has the fan's row;
// otherwise they are unknown.

import { type HostEvent, type HostPort, type NavigationItem } from '@cg/contracts/host';
import { type TargetHandle } from '@cg/contracts/vm';

import { type SpenderRow } from '../../domain/spenders/rows';
import { type PageContextPort } from '../boards/context';
import { fanHandle, parseFanHandle } from '../boards/handles';
import { type PreviewDirectory } from '../boards/shared';

/** Rows of the cached chat list looked through for online fans. */
export const ONLINE_LIST_LIMIT = 200;

export interface OnlineFan {
  readonly handle: TargetHandle;
  readonly fanRef: string;
  readonly name: string;
  readonly username: string | null;
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

  const items = (): readonly NavigationItem[] => {
    const binding = context.current().binding;
    if (binding === null) return [];
    return host.listCachedChats(binding.hostAccountId, ONLINE_LIST_LIMIT).filter((item) => item.isOnline === true);
  };

  const fanOf = (item: NavigationItem, pageId: number): OnlineFan => {
    const username = text(item.username)?.replace(/^@/, '') ?? null;
    return { handle: fanHandle('palette', pageId, item.chat.platformFanId), fanRef: item.chat.platformFanId, name: text(item.displayName) ?? username ?? item.chat.platformFanId, username };
  };

  const online = (): OnlineFan[] => {
    const pageId = context.current().binding?.pageId ?? null;
    return pageId === null ? [] : items().map((item) => fanOf(item, pageId));
  };

  return {
    online,
    resolve(handle) {
      const parsed = parseFanHandle(handle);
      const pageId = context.current().binding?.pageId ?? null;
      if (parsed === null || parsed.source !== 'palette' || pageId === null || parsed.pageId !== pageId) return null;
      const item = items().find((candidate) => candidate.chat.platformFanId === parsed.fanRef);
      // Only a fan ChatSpace itself shows online gets a preview from here.
      if (item === undefined) return null;
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
      const order = online().map((fan) => fan.handle);
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
    },
  };
}
