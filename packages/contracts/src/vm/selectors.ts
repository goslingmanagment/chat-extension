// What the UI can look at (architecture.md §10.2 п. 2): one selector per view
// model. Views that follow the open chat (dock, Recap, Coach, the fan panel)
// take no parameters: the controller knows the active chat, the UI
// never names a fan. Handles are opaque strings minted by the controller; the
// UI passes them back unchanged and cannot build a target out of ids.

import * as z from 'zod/mini';

import { SettingsSectionSchema } from '../errors';
import { boundedText } from '../primitives';

/** Opaque handles: the controller's names for a fan target, a copyable artifact, an account, a page, a prompt snapshot. */
export const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const HandleSchema = z.string().check(z.regex(HANDLE_PATTERN));
/** A fan as a target on one surface (dock, a preview, a «Новые» card, a palette row). */
export type TargetHandle = string;
/** Something «Копировать» can write: a part, a Recap, a Review (a turn of Coach), a Coach draft, a prompt. */
export type ArtifactHandle = string;
/** A host account (OnlyMonster) the person can switch to or label. */
export type AccountHandle = string;
/** A hub page (persona assignment). */
export type PageHandle = string;
/** A toast on screen. */
export type ToastId = string;

/**
 * Where a preview is open: the Spenders board, the «Новые» card, the palette's online fans (CS-030), the card of
 * «Рассылка» (1.63.0), the card of «Онлайн» (1.65.0), or the card of «Очереди» (2026-10-29).
 */
export const PREVIEW_SOURCES = ['spenders', 'newcomers', 'palette', 'outreach', 'online', 'queue'] as const;
export type PreviewSource = (typeof PREVIEW_SOURCES)[number];

/** Journals of the debug mode (§9.2, §9.3, NF-029), read by `journal.read`. */
export const JOURNAL_KINDS = ['operations', 'hub-calls', 'send-attempts', 'newcomers-check'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

/**
 * Where the UI is mounted (§10.1): the dock host above the composer, the
 * overlay host (one active window at layer 950, side panels at 900, toasts at
 * 960) and the extension pages. Recap renders inside the dock sheet (ui-design
 * §9.1 п. 3), Review inside Coach's dialog (1.51.0); `result-expanded` is the
 * «Развернуть ↗» dialog.
 * `preview` (1.9.0) is the preview's own window, for a fan the palette's
 * «Онлайн» lists (CS-030); a preview from Spenders or «Новые» is a part of
 * that window and mounts with it.
 */
export const MOUNT_SURFACES = [
  'dock',
  'result-expanded',
  'coach',
  'fan-panel',
  'spenders',
  'newcomers',
  /** 1.63.0: the window of «Рассылка»; its chip over the page while the window is folded. */
  'outreach',
  'outreach-chip',
  /** 1.65.0: the window of «Онлайн». */
  'online',
  /** 2026-10-29: the window of «Очереди». */
  'queues',
  'preview',
  'palette',
  'quick-jump',
  'cheatsheet',
  'toasts',
  'popup',
  'options',
  'debug-prompt',
  'journal',
] as const;
export type MountSurfaceKind = (typeof MOUNT_SURFACES)[number];

/** Overlays the person opens and closes (Navigate); a preview closes back to its list. */
export const OVERLAY_SURFACES = ['spenders', 'newcomers', 'outreach', 'online', 'queues', 'preview', 'fan-panel', 'coach', 'palette', 'quick-jump', 'cheatsheet'] as const;
export type OverlaySurface = (typeof OVERLAY_SURFACES)[number];

export const VIEW_NAMES = [
  'dock',
  'recap.picker',
  'recap.view',
  'coach',
  'spenders.board',
  'spenders.stats',
  'preview',
  'newcomers',
  'outreach',
  'online',
  'queues',
  'fan-panel',
  'palette',
  'quick-jump',
  'cheatsheet',
  'toasts',
  'popup',
  'options',
  'debug-prompt',
  'journal',
  'voice',
  'talking',
] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

const view = <N extends ViewName>(name: N) => z.literal(name);

export const ViewSelectorSchema = z.discriminatedUnion('of', [
  z.strictObject({ of: view('dock') }),
  z.strictObject({ of: view('recap.picker') }),
  z.strictObject({ of: view('recap.view') }),
  z.strictObject({ of: view('coach') }),
  z.strictObject({ of: view('spenders.board') }),
  z.strictObject({ of: view('spenders.stats') }),
  z.strictObject({ of: view('preview'), from: z.enum(PREVIEW_SOURCES) }),
  z.strictObject({ of: view('newcomers') }),
  /** 1.63.0: the window of «Рассылка». */
  z.strictObject({ of: view('outreach') }),
  /** 1.65.0: the window of «Онлайн». */
  z.strictObject({ of: view('online') }),
  /** 2026-10-29: the window of «Очереди». */
  z.strictObject({ of: view('queues') }),
  z.strictObject({ of: view('fan-panel') }),
  z.strictObject({ of: view('palette') }),
  z.strictObject({ of: view('quick-jump') }),
  z.strictObject({ of: view('cheatsheet') }),
  z.strictObject({ of: view('toasts') }),
  z.strictObject({ of: view('popup') }),
  z.strictObject({ of: view('options'), section: SettingsSectionSchema }),
  /** The opaque token from `debug-prompt.html?t=…` (DB-006, DB-007). */
  z.strictObject({ of: view('debug-prompt'), token: boundedText(128) }),
  z.strictObject({ of: view('journal'), journal: z.enum(JOURNAL_KINDS) }),
  /** 1.47.0: the voice studio of the open chat. */
  z.strictObject({ of: view('voice') }),
  /** Chat Memory week 1: «в разговоре» of every fan the tab may name. */
  z.strictObject({ of: view('talking') }),
]);
export type ViewSelector = z.infer<typeof ViewSelectorSchema>;

/** One stable string per selector: the key of a snapshot cache or a subscription. */
export function selectorKey(selector: ViewSelector): string {
  if (selector.of === 'preview') return `preview:${selector.from}`;
  if (selector.of === 'options') return `options:${selector.section}`;
  if (selector.of === 'debug-prompt') return `debug-prompt:${selector.token}`;
  if (selector.of === 'journal') return `journal:${selector.journal}`;
  return selector.of;
}
