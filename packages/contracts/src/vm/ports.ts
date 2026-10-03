// Ports the composition root hands to the UI (architecture.md §10.2 п. 5–6):
// mounting into a shadow root that host-chatspace (or an extension page)
// created, toasts, the clipboard, confirmation dialogs, geometry, focus
// return and render marks. The UI never embeds itself into ChatSpace's DOM
// and never sends telemetry: it only marks what became visible or painted.

import { type CgCode } from '../errors';
import { type UiResultStyle } from '../settings';
import { type PerfMetric } from '../telemetry';
import { type Uuid } from '../primitives';
import { type AppClient } from './app-client';
import { type ActionCatalog } from './catalog';
import { type I18n, type Msg } from './i18n';
import { type MountSurfaceKind, type ToastId } from './selectors';
import { type ValueSignal } from './signal';
import { type SchemeSignal } from './theme';
import { type ToastKind } from './panels';

export type Unmount = () => void;

/**
 * Where a surface may draw. `feedHeight` is H of the result limit: the feed
 * window as if our sheet and its gap were absent (ui-design §3.2), measured
 * by the host side with a ResizeObserver. The mount also sets the scheme
 * attribute on the host element (SCHEME_ATTRIBUTE).
 */
export interface SurfaceGeometry {
  readonly width: number | null;
  readonly feedHeight: number | null;
  readonly viewportHeight: number;
  /** Side surfaces align to ChatSpace's fixed-width container when it is on. */
  readonly container: { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null;
}

export const RESULT_CAP = { maxPx: 360, viewportShare: 0.45, feedReservePx: 160, minPx: 112, sheetGapPx: 2 } as const;

/**
 * The sheet's outer height limit, written into `--cg-cap` (owner's ruling,
 * ui-design §3.2, §9.1): max(112, floor(min(360, 0.45 × innerHeight, H − 160 − g)))
 * with g = 2 px «на подложке», 0 «без подложки». Unknown H drops that term.
 */
export function resultCap(geometry: Pick<SurfaceGeometry, 'feedHeight' | 'viewportHeight'>, style: UiResultStyle): number {
  const gap = style === 'sheet' ? RESULT_CAP.sheetGapPx : 0;
  const byFeed = geometry.feedHeight === null ? Infinity : geometry.feedHeight - RESULT_CAP.feedReservePx - gap;
  const cap = Math.floor(Math.min(RESULT_CAP.maxPx, RESULT_CAP.viewportShare * geometry.viewportHeight, byFeed));
  return Math.max(RESULT_CAP.minPx, cap);
}
export type GeometrySignal = ValueSignal<SurfaceGeometry>;

/** The element that had focus before a dialog opened stays on the host side; the UI only asks to go back (§10.1). */
export interface FocusReturn {
  readonly token: string | null;
  /** True when focus went back to where it was. */
  restore(): boolean;
}

/** Metrics the UI marks; the start mark comes from the controller, the end is the UI's paint. */
export const UI_PAINT_METRICS = ['panelOpenMs', 'firstChunkPaintMs', 'boardOpenMs', 'searchMs', 'routeToDockMs'] as const satisfies readonly PerfMetric[];
export type UiPaintMetric = (typeof UI_PAINT_METRICS)[number];

export interface RenderMarks {
  /** A result is really visible (IntersectionObserver), not merely arrived: telemetry `shown` (§9.6). */
  resultShown(opId: Uuid): void;
  /** The interaction behind `mark` painted (after the next animation frame). */
  painted(metric: UiPaintMetric, mark: string): void;
}

/** A toast the UI raises itself, e.g. CG-UI-FAILED from a surface's error boundary (ER-020). */
export interface ToastRequest {
  readonly kind: ToastKind;
  readonly code: CgCode | null;
  /** Same code and scope replace each other on screen. */
  readonly scope: string;
  readonly title: Msg;
  readonly body: Msg | null;
}

export interface ToastPort {
  show(toast: ToastRequest): ToastId;
  dismiss(id: ToastId): void;
}

export type ClipboardResult = { readonly ok: true } | { readonly ok: false; readonly code: 'CG-CLIPBOARD' };

/** For texts the UI already holds (an error code, an id in the popup); artifacts go through the Copy action. */
export interface ClipboardPort {
  writeText(text: string): Promise<ClipboardResult>;
}

export interface ConfirmDialogRequest {
  readonly title: Msg;
  readonly body: Msg | null;
  readonly confirm: Msg;
  readonly cancel: Msg;
  readonly tone: 'normal' | 'destructive';
}

/** Modal confirmations («Очистить локальные данные», «Новый диалог»): focus is trapped and returned (§10.1). */
export interface DialogPort {
  confirm(request: ConfirmDialogRequest): Promise<'confirm' | 'cancel'>;
}

export interface MountDeps {
  readonly client: AppClient;
  readonly i18n: I18n;
  readonly catalog: ActionCatalog;
  readonly toasts: ToastPort;
  readonly clipboard: ClipboardPort;
  readonly dialogs: DialogPort;
  /** Also mirrored as `data-cg-scheme` on the host element by the mount. */
  readonly scheme: SchemeSignal;
  readonly geometry: GeometrySignal;
  readonly focus: FocusReturn;
  readonly marks: RenderMarks;
}

/**
 * The UI's mount entry (`mountSurface(kind, root, deps) => Unmount`). `Root`
 * is the closed ShadowRoot the host side created — a type parameter because
 * contracts compile without the DOM library; ui/ instantiates it with
 * ShadowRoot. Unmount releases everything the surface holds.
 */
export interface MountPort<Root> {
  mountSurface(kind: MountSurfaceKind, root: Root, deps: MountDeps): Unmount;
}
