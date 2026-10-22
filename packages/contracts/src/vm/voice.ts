// The voice studio (1.47.0): the dock's sheet of the Voice chip on both
// sites. One view of the open chat — its script, its takes, what the person
// can do next — built by the voice controller over the background's session
// (voice.ts). The studio plays a take's audio itself (the bytes are in the
// view once fetched and checked) and hands everything else to the controller.

import { type CgErrorView } from '../errors';
import { type VoiceTone } from '../voice';
import type { UiAction } from './actions';
import { type ReasonVM } from './catalog';
import type { Msg } from './i18n';
import { type TargetHandle } from './selectors';
import { type ActionButtonVM, type VmView } from './view';

/** A take as the studio lists it («Вариант 2»). */
export interface VoiceTakeVM {
  readonly takeId: string;
  /** Its number in the session, from 1, in the order the person asked for them. */
  readonly n: number;
  /**
   * `working` — the hub renders it; `ready` — its audio is here (or on its way); `failed` — the render failed;
   * `uncertain` — the create got no clear answer, characters may have been spent; `refused` — the hub refused it,
   * nothing spent; `expired` — the hub no longer keeps it.
   */
  readonly state: 'working' | 'ready' | 'failed' | 'uncertain' | 'refused' | 'expired';
  /** Epoch ms of the click: «озвучиваю 0:04». */
  readonly startedAt: number;
  /** It took longer than usual: the studio says so, the take keeps waiting. */
  readonly slow: boolean;
  /** It voices another text than the script now in the editor (the person edited it or wrote a new one since). */
  readonly stale: boolean;
  /**
   * The checked MP3 once fetched; `sha256` names it (a view compares by it). null — not ready, or still on its way
   * (`loading`).
   */
  readonly audio: { readonly sha256: string; readonly bytes: ArrayBuffer } | null;
  readonly loading: boolean;
  /** The person put it into the chat's field: seen there, or handed over and not seen. */
  readonly attached: 'attached' | 'unknown' | null;
  /** Why it failed, was refused or is uncertain (the dot and the code line of ui-design §4.8). */
  readonly error: CgErrorView | null;
  /** Characters spent: true, false, null — not known. */
  readonly charged: boolean | null;
  /** «Проверить» — a free read of what became of it; null — nothing to check. */
  readonly check: UiAction | null;
}

/** The handover of a take into the chat's field, while it runs and after. */
export interface VoiceAttachVM {
  readonly takeId: string;
  readonly n: number;
  /**
   * `handing` — the file goes to the site; `waiting` — the site's own upload window is open (Fansly: the person chooses
   * Free/PPV and presses «Upload»; ChatSpace: its upload runs); `attached` — in the field, ready for the person's Send;
   * `unknown` — handed over, not seen; `failed` — not attached (with the error and «Скачать MP3»).
   */
  readonly state: 'handing' | 'waiting' | 'attached' | 'unknown' | 'failed';
  readonly error: CgErrorView | null;
  /**
   * After an attach the chat's field still holds the text the script was made from: it goes to the fan with the
   * voice unless the person removes it («Убрать текст»); once removed, «Вернуть текст» puts it back while the field
   * stays empty. null — the field holds nothing of it.
   */
  readonly leftover: { readonly cleared: boolean; readonly action: UiAction | null } | null;
}

/** A question in the studio itself (no dialog): the person's answer goes on, the other button leaves it. */
export interface VoiceConfirmVM {
  /** What the person is warned about («Вариант 2 не прикреплён»). */
  readonly lead: Msg;
  readonly question: Msg;
  readonly confirm: ActionButtonVM;
  readonly cancel: UiAction;
}

export interface VoiceVM {
  readonly view: VmView;
  /** The studio is the dock's sheet now (the chip pressed, or the studio left open). */
  readonly open: boolean;
  readonly targetHandle: TargetHandle | null;
  /** «для Tomasz»: the fan's name as the site shows it. */
  readonly fanName: string | null;
  /**
   * `empty` — nothing written yet (the field's draft is what a script would be made from); `writing` — the script is
   * being written; `ready` — a script to edit and voice; `failed` — the script could not be written (`error`).
   */
  readonly stage: 'empty' | 'writing' | 'ready' | 'failed';
  /** The draft the script is (or would be) made from, as one line; null — the field is empty. */
  readonly source: string | null;
  /** The preset of the script; the one a new script is asked in. */
  readonly tone: VoiceTone;
  readonly tones: readonly VoiceTone[];
  /** Why a preset or «Переписать» does nothing now (a script is being written, the field is empty); null — they work. */
  readonly toneReason: ReasonVM | null;
  readonly script: {
    /** The AI's script, or the person's text of it. */
    readonly text: string;
    /** The script is still being written: the text grows, the editor waits. */
    readonly streaming: boolean;
    /** The person changed the AI's text («Вернуть текст AI»). */
    readonly edited: boolean;
    /** Characters as the hub counts them, against `max`. */
    readonly chars: number;
    readonly max: number;
    /** «≈ 9 с»: a guess from the length. */
    readonly seconds: number;
    /** What the hub would refuse (an unknown tag, too long): said before the paid click; null — nothing. */
    readonly issue: Msg | null;
  } | null;
  readonly takes: readonly VoiceTakeVM[];
  /** The take «Прикрепить» puts into the field; null — none ready. */
  readonly selected: string | null;
  /** The studio's own failure: the script that could not be written, a take the hub refused. */
  readonly error: CgErrorView | null;
  /** The main button: «Озвучить · 120 симв.», or «Прикрепить для Tomasz» once a take of this text is ready. */
  readonly primary: ActionButtonVM | null;
  /** The second one: «Ещё вариант · 120 симв.» beside «Прикрепить». */
  readonly secondary: ActionButtonVM | null;
  /** «Новый войс» from the field's draft now; null — nothing to start over from. */
  readonly restart: ActionButtonVM | null;
  /** «Прикрепить ещё раз» once the chosen take was handed over (it asks first): a quiet button, never the main one. */
  readonly again: ActionButtonVM | null;
  readonly confirm: VoiceConfirmVM | null;
  readonly attach: VoiceAttachVM | null;
}

/** What the dock's chip shows of the chat's voice: a take renders (busy), a take got ready while the studio was closed (the dot). */
export interface VoiceChipVM {
  readonly busy: boolean;
  readonly ready: boolean;
}
