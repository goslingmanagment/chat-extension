// Opaque handles of fans on the boards (architecture.md §10.2: the UI holds
// handles, never a target). A handle names the list it came from, the hub
// page and the fan; the controller that minted it resolves it back and
// checks that it still belongs to the page on screen before anything is
// generated, inserted or sent.

import { type PreviewSource, type TargetHandle } from '@cg/contracts/vm';

const SOURCES = ['spenders', 'newcomers', 'palette', 'outreach', 'online', 'queue'] as const satisfies readonly PreviewSource[];

export interface FanHandle {
  readonly source: PreviewSource;
  readonly pageId: number;
  readonly fanRef: string;
}

/** `spenders:11:5001`. Exported for the palette's online fans (CS-030): a handle minted with it opens a preview. */
export function fanHandle(source: PreviewSource, pageId: number, fanRef: string): TargetHandle {
  return `${source}:${pageId}:${fanRef}`;
}

const HANDLE = /^(spenders|newcomers|palette|outreach|online|queue):([1-9]\d{0,15}):([1-9]\d{0,29})$/;

export function parseFanHandle(handle: string): FanHandle | null {
  const match = HANDLE.exec(handle);
  if (match === null) return null;
  const source = SOURCES.find((s) => s === match[1]);
  if (source === undefined) return null;
  return { source, pageId: Number(match[2]), fanRef: match[3] as string };
}

/** A copyable part of a result: `part:<opId>:<variant>:<index>`. */
export function partHandle(opId: string, variant: number | null, index: number): string {
  return `part:${opId}:${variant ?? 0}:${index}`;
}

const PART = /^part:([0-9a-fA-F-]{36}):(\d):(\d)$/;

export function parsePartHandle(handle: string): { readonly opId: string; readonly variant: number; readonly index: number } | null {
  const match = PART.exec(handle);
  if (match === null) return null;
  return { opId: match[1] as string, variant: Number(match[2]), index: Number(match[3]) };
}
