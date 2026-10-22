// The part the dock may hand the focus to (decision X44; ui-design §6.3,
// §6.4; UI-023): the old extension's ⌘E → Enter → Enter. Nothing here
// inserts — the person's own Enter on the focused part does (UI-023), and the
// runner still has no key that inserts (`NEVER_BY_KEY`). This only says WHICH
// part, and WHEN the person is not typing in the composer:
//
// - a finished answer of the dock's own that `Parts` draws: Reply, Ping, a Hi
//   of one variant, a Split Fix of several parts (the old extension focused its
//   first «Insert» too) — never a one-part Fix (its «Заменить мой черновик» is a
//   choice of its own), three Hi variants (which one is the person's pick) or a
//   board's result the dock shows (its card is where it was made);
// - `insert` mode, a parsed answer, no Б2 question open, the result not
//   expanded into its window, the part itself insertable (not blocked, no
//   insert on its way);
// - the composer of the result's chat is there, ready and shown, and holds
//   what it held at the click (2026-10-22: the person waited for the answer
//   over their draft — the old extension offered every new Reply's first part)
//   or nothing — and did so when the answer was first seen finished: text the
//   person typed meanwhile offers nothing (they were writing, not waiting);
// - after a part of the answer was inserted, the next one only once the
//   composer has been seen holding that part unchanged and then empty: the
//   person sent it (or cleared it as it was). A part the person changed
//   first, or their own text, offers nothing more: they are writing. An
//   insert's receipt and the composer's state come by two ways and in no
//   fixed order; without this the next part could be offered while the
//   inserted one still waits to reach the field, and the focus the host gives
//   the composer after an insert (UI-019) would then take it back for good.
//
// Where the focus is now and «at most once per part» are the UI's: only it
// knows when it moved the focus (Parts, `FocusReturn.where`).

import { type ComposerState } from '@cg/contracts/host';
import { type DockVM, type ResultVM } from '@cg/contracts/vm';

export type FocusPart = NonNullable<DockVM['focusPart']>;

/** What one operation's parts went through since the dock first saw it finished. */
interface Watch {
  /** Parts inserted when last seen. */
  inserted: number;
  /** The next part may be offered while the composer is empty. */
  armed: boolean;
  /** After the last insert, the composer has been seen holding our part unchanged. */
  filled: boolean;
}

/** Operations remembered at once: the results of the chats the person goes between. */
const WATCHED = 16;

/** The composer at the click that started an operation: its instance and its draft's revision. */
interface AtClick {
  readonly instanceId: string;
  readonly revision: number;
}

export interface PartFocus {
  /** The composer as the person's click or key found it, for the operation that click started. */
  started(opId: string, composer: ComposerState | null): void;
  /**
   * The part to offer now; null — none. Called with every build of the dock's view: it also records what the
   * composer held, so a send between two builds is seen as «held our part, then empty».
   */
  next(result: ResultVM | null, mode: DockVM['mode'], composer: ComposerState | null, sameChat: boolean): FocusPart | null;
}

/** A finished answer of the dock's own drawn as a list of parts — the shapes whose next part is offered. */
function offered(result: ResultVM, mode: DockVM['mode']): boolean {
  return (
    result.state === 'done' &&
    result.surface === 'dock' &&
    // A Fix is drawn as parts only when it came in several (Split); one part is the Fix block with its own choice.
    (result.feature !== 'fix' || (result.parts?.length ?? 0) > 1) &&
    result.variants === null &&
    result.parts !== null &&
    !result.unparsed &&
    !result.expanded &&
    result.confirm === null &&
    mode === 'insert'
  );
}

export function createPartFocus(): PartFocus {
  const watches = new Map<string, Watch>();
  const clicks = new Map<string, AtClick>();

  return {
    started(opId, composer) {
      if (composer === null) return;
      clicks.set(opId, { instanceId: composer.instanceId, revision: composer.draft.revision });
      if (clicks.size > WATCHED) clicks.delete(clicks.keys().next().value as string);
    },
    next(result, mode, composer, sameChat) {
      if (result === null || !offered(result, mode) || result.parts === null) return null;
      const parts = result.parts;
      const inserted = parts.filter((part) => part.insert === 'done').length;
      const field = sameChat && composer !== null && composer.ready && !composer.hidden ? composer.draft.provenance : null;
      const click = clicks.get(result.opId);
      // The field holds just what it held at the click: the person waited over their draft, they did not write on.
      const asAtClick = field !== null && composer !== null && click !== undefined && composer.instanceId === click.instanceId && composer.draft.revision === click.revision;
      let watch = watches.get(result.opId);
      if (watch === undefined) {
        // Not judged before the composer of this chat can be read.
        if (field === null) return null;
        // First seen finished: the answer the person waited for — over an empty composer, or over the draft the click
        // found there — is armed; one they were typing over, or one with parts in already, waits for the composer to
        // hold an insert and be emptied.
        watch = { inserted, armed: inserted === 0 && (field === 'empty' || asAtClick), filled: false };
        watches.set(result.opId, watch);
        if (watches.size > WATCHED) watches.delete(watches.keys().next().value as string);
      }
      if (inserted > watch.inserted) {
        watch.inserted = inserted;
        watch.armed = false;
        watch.filled = false;
      }
      if (field === 'our-insert') {
        // Our part stands in the field as it was written (the composer's report may come before the receipt).
        if (watch.inserted > 0) watch.filled = true;
      } else if (field === 'human-or-unknown' && !(watch.inserted === 0 && asAtClick)) {
        // The person writes: their own text, or our part they changed. Whatever leaves the field after that is
        // theirs to follow up — nothing is offered until our next insert goes out unchanged.
        watch.filled = false;
        watch.armed = false;
      } else if (field === 'empty' && watch.filled) {
        watch.armed = true;
        watch.filled = false;
      }
      if (!watch.armed || (field !== 'empty' && !(watch.inserted === 0 && asAtClick))) return null;
      const next = parts.find((part) => part.next);
      if (next === undefined || next.insertBlocked !== null || next.insert === 'pending' || next.collapsed) return null;
      return { opId: result.opId, part: next.index };
    },
  };
}
