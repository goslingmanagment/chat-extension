// The dock above ChatSpace's composer (architecture.md §10.2 DockVM, §6.3;
// ui-design.md §3.1–§3.3, §4.1, §4.10, §8.1): one 34 px strip, a result sheet
// above it, status banners. The strip is drawn in every view state; `status`
// says which banner and which reasons apply, `view` classifies it.

import { type CgErrorView } from '../errors';
import { type FeatureId, type Tone } from '../features';
import { type UiResultStyle } from '../settings';
import { type IsoTimestamp, type Uuid } from '../primitives';
// `import type` (as below for `Msg`): the chips' types add no run-time edge to this module — it is in the early isolated bundle's graph.
import type { UiAction } from './actions';
import { type ReasonVM, type HotkeyLabel } from './catalog';
import type { Msg } from './i18n';
import { type RefusalVM, type ResultVM } from './result';
import { type TargetHandle } from './selectors';
import { type RunningOpVM, type VmView } from './view';

/**
 * The seven AI actions of the open chat, in UI-002 order: the bar's buttons, their keys, the palette's rows. 1.51.0:
 * Review has no button of its own in the bar — it is a turn of Coach's dialog; its state here is what its key and the
 * palette's row say, and Coach's «Review» chip says the same.
 */
export const DOCK_ACTION_IDS = ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'coach'] as const satisfies readonly FeatureId[];
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
  /** The «Recap готов» dot (UI-010); moves to «Ещё» on a narrow strip. 1.47.0: «Войс готов» — a take got ready while the studio was closed. */
  readonly badge: 'recap-ready' | 'voice-ready' | null;
}

/**
 * 1.15.0 (R20 F4). The groups of the bar's chips, in the bar's order (ui-design §3.1): Reply with the capsule of
 * its options │ the draft's tools │ the openers │ what is known about the fan — and, at the right end, the windows.
 * A seam stands before the first chip of a group. How a group is laid out is `ui/kit`'s; its test holds every
 * value here to a row there. 1.51.0: Voice, a group of its own between the openers and the analysis (the owner,
 * 2026-10-23: «справа от Ping через перегородку»).
 */
export const DOCK_CHIP_GROUPS = ['reply', 'draft', 'openers', 'voice', 'analysis', 'windows'] as const;
export type DockChipGroup = (typeof DOCK_CHIP_GROUPS)[number];

/** 1.15.0 (R20 F4). The icons a chip may show on a narrow bar instead of its word; `ui/kit` draws each (its test holds the list to the kit's icon set). */
export const DOCK_ICON_IDS = ['gauge', 'dossier', 'bulb', 'coin', 'userNew', 'mic', 'online'] as const;
export type DockIconId = (typeof DOCK_ICON_IDS)[number];

/**
 * 1.15.0 (R20 F4). A chip of the bar as data: a feature of the site's manifest that has a chip there
 * (`contracts/src/features`), with what the bar shows of it and what a click asks for. The state fields are the
 * ones of `DockActionVM`; for one of the seven frozen actions they repeat `actions[id]`.
 */
export interface ChipVM extends DockActionVM {
  /** The feature's key in the site's manifest: `reply`, `spenders`… */
  readonly id: string;
  readonly group: DockChipGroup;
  /** Shown instead of the word on a narrow bar; null — the word stays at every width. */
  readonly icon: DockIconId | null;
  readonly label: Msg;
  /** One sentence under the name in the hint (UI-004). */
  readonly hint: Msg;
  /** What a click asks for; null — nothing can be asked now (no chat to act on). */
  readonly action: UiAction | null;
  /** 1.65.0: a number beside the chip — «Онлайн»: the fans worth a message now. Absent or null — none shown. */
  readonly count?: number | null;
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
  /**
   * 1.3.0. One status line of a dock that is otherwise `ready`: nothing of ours
   * runs on the page of the open chat. The owner switched ChatGoose off — the hub's
   * master switch is ONE for every page, and every feature of the page reads
   * `disabled`: «ChatGoose выключен владельцем». Or this build is too old for the
   * hub (`client_outdated`, `minVersion`): the line is that error's own. The strip
   * stays, every AI action is dimmed with the same reason, parts can only be copied;
   * nothing is offered that the hub would refuse after the click. Absent or null —
   * no line. A dock whose `status` has a banner of its own never carries it.
   */
  readonly notice?: CgErrorView | null;
  /** The open chat as a target; null while no chat is open or it is not ready. */
  readonly targetHandle: TargetHandle | null;
  /**
   * «Лора · VIP» and the page name of the tooltip «Персона «Лора · VIP» для LoraVie VIP»; null — no label
   * (no binding or no persona; without sign-in the UI writes «вход не выполнен»).
   */
  readonly persona: { readonly label: string; readonly pageName: string } | null;
  /**
   * 2026-10-22 (as the old Fansly extension, which picked the persona right in the chat): what the «Нет персоны» banner
   * offers in its own menu — the active personas of the catalog, each with the settings page's `ChoosePersona` for the
   * open chat's page. Absent or empty — no menu: a persona is set, the catalog is not read, or nothing is active.
   */
  readonly personaChoices?: readonly { readonly key: string; readonly label: string; readonly choose: UiAction }[];
  /**
   * 2026-10-22: the owner's `insertion` switch of the page is off, so parts are copy-only — the line that says so over a
   * result (a state, the ring), in the switch's own words. Absent or null — inserting is allowed, or a banner of the
   * dock's status already says why not.
   */
  readonly insertOff?: CgErrorView | null;
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
  /**
   * 1.15.0 (R20 F4). The bar's chips in the order they stand: by group (`DOCK_CHIP_GROUPS`), then by the
   * manifest's priority. Built from the site's slice of the feature manifest and its admission: a feature the
   * site does not have gives no chip. The bar draws these and nothing else; a model without the field draws no
   * chip (every producer of this version sets it).
   */
  readonly chips?: readonly ChipVM[];
  /** The draft result sheet (Reply, Fix, Hi, Ping); null — collapsed strip. */
  readonly result: ResultVM | null;
  /**
   * 1.17.0 (decision X44; ui-design §6.3). The part of `result` the dock may hand the focus to now, so the person's
   * own Enter on it inserts it (UI-023) — the old extension's ⌘E → Enter → Enter. Set only for a finished answer of
   * the dock's own (Reply, Ping, a Hi of one variant; never Fix, three Hi variants or a board's result) in `insert`
   * mode, with no Б2 question open, while the composer of the open chat is ready and EMPTY (and was when the answer
   * was first seen finished); after a part was inserted — only once the composer has held that part unchanged and is
   * empty again (the person sent it); a part they changed, or their own text, offers nothing more. The UI moves the focus at most once per part and only from the composer, the page's body
   * or the dock itself (`FocusReturn.where`). Absent or null — nothing to focus; nothing is ever inserted by itself.
   */
  readonly focusPart?: { readonly opId: Uuid; readonly part: number } | null;
  /** Recap open in the sheet; its content is the `recap.*` views (ui-design §9.1 п. 3). 1.51.0: Review is Coach's, never here. */
  readonly analysis: 'recap' | null;
  /** 1.47.0: the voice studio is the sheet; its content is the `voice` view. Absent or false — not shown. */
  readonly voice?: boolean;
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
  readonly resultStyle: UiResultStyle;
  /** «⌘K» hint at the right end of the strip. */
  readonly paletteHotkey: HotkeyLabel | null;
  /** Debug mode: what the expanded result may show. Never in a collapsed dock (DB-020). */
  readonly debug: { readonly renderTrace: boolean; readonly contract: string | null } | null;
}
