// The dock above ChatSpace's composer (architecture.md §10.2 DockVM, §6.3;
// ui-design.md §3.1–§3.3, §4.1, §4.10, §8.1): one 34 px strip, a result sheet
// above it, status banners. The strip is drawn in every view state; `status`
// says which banner and which reasons apply, `view` classifies it.

import { type CgErrorView } from '../errors';
import { type Tone } from '../features';
import { type IsoTimestamp } from '../primitives';
import { type ReasonVM, type HotkeyLabel } from './catalog';
import { type RefusalVM, type ResultVM } from './result';
import { type TargetHandle } from './selectors';
import { type RunningOpVM, type VmView } from './view';

/** The seven strip buttons, in UI-002 order. */
export const DOCK_ACTION_IDS = ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'coach'] as const;
export type DockActionId = (typeof DOCK_ACTION_IDS)[number];

/**
 * Dock status → banner (ui-design §4.10). `ready` has no banner; the rest map
 * to their code in `statusError`: CG-AUTH-REQUIRED, CG-BINDING-MISSING (or
 * -NOT-GRANTED), CG-PERSONA-UNASSIGNED, CG-HUB-UNAVAILABLE,
 * CG-GATE-FAN-BLOCKED, CG-RUNTIME-RELOADED (a card, not a banner).
 * `host-degraded` covers both «cannot insert» cases and the code picks the
 * banner: CG-HOST-CONTRACT (ChatSpace's contract broke) or
 * CG-HOST-COMPOSER-MISSING (the visible composer has no bridge), both with
 * `mode: 'copy-only'`. `loading-chat` shows only the «Чат загружается…» words.
 */
export const DOCK_STATUSES = [
  'ready',
  'loading-chat',
  'not-signed-in',
  'no-binding',
  'no-persona',
  'host-degraded',
  'hub-down',
  'blocked-fan',
  'reload-needed',
] as const;
export type DockStatus = (typeof DOCK_STATUSES)[number];

export interface DockActionVM {
  readonly enabled: boolean;
  /** Its generation runs: the running underline (UI-007). */
  readonly busy: boolean;
  /** Its result is open: the static underline. */
  readonly active: boolean;
  /** Why it is off: the tooltip «X недоступен: …» and the HK-026 toast of its key. */
  readonly reason: ReasonVM | null;
  /** Printed on the button only when enabled and the strip is ≥ 690 px wide (ui-design §3.3). */
  readonly hotkey: HotkeyLabel | null;
  /** The «Recap готов» dot (UI-010); moves to «Ещё» on a narrow strip. */
  readonly badge: 'recap-ready' | null;
}

export interface DockVM {
  readonly view: VmView;
  /** Only in an open chat (UI-012). */
  readonly visible: boolean;
  /** `copy-only`: «Копировать» instead of «Вставить» in every part (UI-027). */
  readonly mode: 'insert' | 'copy-only';
  readonly status: DockStatus;
  /** Code, title, body and technical line of the banner or the card. */
  readonly statusError: CgErrorView | null;
  /** The open chat as a target; null while no chat is open or it is not ready. */
  readonly targetHandle: TargetHandle | null;
  /**
   * «Лора · VIP» and the page name of the tooltip «Персона для LoraVie VIP»; null — no label
   * (no binding or no persona; without sign-in the UI writes «вход не выполнен»).
   */
  readonly persona: { readonly label: string; readonly pageName: string } | null;
  /** The goose mark is faint when everything is off (no sign-in, hub down, chat loading, reload needed, quota 0). */
  readonly mark: 'normal' | 'faint';
  /**
   * Shown only when low or zero (UI-031): `low` — «AI: осталось N», `remaining === 0` —
   * «Квота AI: 0» and every AI button dimmed with the quota reason; null — nothing.
   * `resetsAt` gives «Обновится в 03:00» and the CG-QUOTA-DAILY countdown; null — unknown.
   */
  readonly quota: { readonly remaining: number | null; readonly low: boolean; readonly resetsAt: IsoTimestamp | null } | null;
  readonly options: {
    /** The one-off tone of the next Reply (Б1); null — «Тон». */
    readonly tone: Tone | null;
    /** Tones of the menu in order — the parity set Casual, Flirt, Sell, Spice (AI-002); the last item «Без тона» is the UI's. */
    readonly tones: readonly Tone[];
    readonly split: boolean;
    /** Tone and Split are locked while a generation runs (AI-009). */
    readonly locked: boolean;
    readonly toneReason: ReasonVM | null;
    readonly splitReason: ReasonVM | null;
    readonly toneHotkey: HotkeyLabel | null;
    readonly splitHotkey: HotkeyLabel | null;
  };
  readonly actions: Readonly<Record<DockActionId, DockActionVM>>;
  /** The draft result sheet (Reply, Fix, Hi, Ping); null — collapsed strip. */
  readonly result: ResultVM | null;
  /** Recap or Review open in the sheet; their content is the `recap.*` / `review` views (ui-design §9.1 п. 3). */
  readonly analysis: 'recap' | 'review' | null;
  /** A refused start in place of a result (CG-OP-TAB-LIMIT with «Идут сейчас», CG-OP-CHAT-BUSY). */
  readonly refusal: RefusalVM | null;
  /** Generations of this tab in other chats; the palette lists them too. */
  readonly runningElsewhere: readonly RunningOpVM[];
  /** «Чат загружается…» words left of the quota. */
  readonly statusWords: boolean;
  /** `ui.hints`: descriptions in tooltips; reasons show regardless. */
  readonly hints: boolean;
  /** The keys footer under the next result: first five results until dismissed (ui-design §4.3). */
  readonly keysFooter: boolean;
  /** «Вид ответа»: printed on the feed or on a sheet (ui-design §7). */
  readonly resultStyle: 'bare' | 'sheet';
  /** «⌘K» hint at the right end of the strip. */
  readonly paletteHotkey: HotkeyLabel | null;
  /** Debug mode: what the expanded result may show. Never in a collapsed dock (DB-020). */
  readonly debug: { readonly renderTrace: boolean; readonly contract: string | null } | null;
}
