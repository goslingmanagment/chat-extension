// Who sent each message (decision X48; hub `clientSendAttributions`): the
// page and the client a send is recorded for, as the background takes it —
// from a tab, a human send of the composer whose own response named the
// message (`attribution.report`), or from a site's module, a send of a
// preview the person clicked (`kit.attributions`). The reporter of the core
// (services/send-attribution.ts) owes it to the hub under the person signed
// in; this rule only says whether there is anything to owe:
// - somebody is signed in (a bootstrap of their sign-in is known);
// - the site names itself as an observer of sends
//   (HOST_SEND_ATTRIBUTION_SOURCE; both sites since Chat Memory week 1);
// - the send's account is bound to a page this bootstrap grants;
// - that page admits the feature `send-attribution` of the site's slice: the
//   hub serves `send-attribution-v1` and — on ChatSpace, where the receipt
//   pairs with the tap's echo — the page's own `wsTap` is usable.
// And how its text was written: the button of a draft of ours, learned from
// `op.reportSent` of the same message (ComposedWithMemory).

import type { FeatureSlice } from '@cg/contracts/features/types';
import { HOST_NOTE_ATTRIBUTION_SOURCE, HOST_SEND_ATTRIBUTION_SOURCE } from '@cg/contracts/hosts';
import { FAN_NOTE_ATTRIBUTIONS_MAX_NOTES, type Bootstrap, type FanNoteAttributions, type FanNoteAttributionWho, type SendAttributionComposedWith } from '@cg/contracts/hub';
import type { HostKind } from '@cg/contracts/ids';
import { NATIVE_ID_PATTERN } from '@cg/contracts/primitives';
import type { NotesAuthors } from '@cg/contracts/tab-messages';
import { admission, onPage } from '@cg/core/domain/features';
import type { Clock } from '@cg/core/services';

export type AttributionTarget =
  | { readonly ok: true; readonly pageLabel: string; readonly source: string }
  | { readonly ok: false; readonly reason: 'signed_out' | 'site' | 'unbound' | 'not_admitted' };

/** `pageId` — the page the send's account is bound to; null — none can be told (not reported, two pages, no creator id yet). */
export function attributionTarget(host: HostKind, pageId: number | null, bootstrap: Bootstrap | null, features: (host: HostKind) => FeatureSlice | null): AttributionTarget {
  if (bootstrap === null) return { ok: false, reason: 'signed_out' };
  const source = HOST_SEND_ATTRIBUTION_SOURCE[host];
  if (source === null) return { ok: false, reason: 'site' };
  const page = pageId === null ? undefined : bootstrap.pages.find((candidate) => candidate.pageId === pageId);
  if (page === undefined) return { ok: false, reason: 'unbound' };
  if (admission(features(host), 'send-attribution', null, onPage(bootstrap, page)).state !== 'on') return { ok: false, reason: 'not_admitted' };
  return { ok: true, pageLabel: page.pageLabel, source };
}

/**
 * Who wrote a note (hub `clientNoteAttributions`): the page and client a confirmed write of «Заметки» is recorded for —
 * somebody is signed in, the site reports notes (HOST_NOTE_ATTRIBUTION_SOURCE), the page is this bootstrap's and admits
 * the site's feature `note-attribution` (the hub serves `note-attribution-v1`). 2026-10-29: `note-authors` — the same
 * page read back (`clientFanNoteAttributions`).
 */
export function noteAttributionTarget(host: HostKind, pageId: number, bootstrap: Bootstrap | null, features: (host: HostKind) => FeatureSlice | null, feature: 'note-attribution' | 'note-authors' = 'note-attribution'): AttributionTarget {
  if (bootstrap === null) return { ok: false, reason: 'signed_out' };
  const source = HOST_NOTE_ATTRIBUTION_SOURCE[host];
  if (source === null) return { ok: false, reason: 'site' };
  const page = bootstrap.pages.find((candidate) => candidate.pageId === pageId);
  if (page === undefined) return { ok: false, reason: 'unbound' };
  if (admission(features(host), feature, null, onPage(bootstrap, page)).state !== 'on') return { ok: false, reason: 'not_admitted' };
  return { ok: true, pageLabel: page.pageLabel, source };
}

/**
 * The OnlyFans feed (hub #953, `clientOnlyfansFeed`): the page an account's records are reported for — somebody is
 * signed in, the account is bound to a page this bootstrap grants, and that page admits ChatSpace's `onlyfans-feed`
 * (the page's own `wsTap` and `ofFeed`, and the hub takes it: `onlyfans-feed-v1`).
 */
export function onlyfansFeedTarget(
  pageId: number | null,
  bootstrap: Bootstrap | null,
  features: (host: HostKind) => FeatureSlice | null,
): { readonly ok: true; readonly pageLabel: string } | { readonly ok: false; readonly reason: 'signed_out' | 'unbound' | 'not_admitted' } {
  if (bootstrap === null) return { ok: false, reason: 'signed_out' };
  const page = pageId === null ? undefined : bootstrap.pages.find((candidate) => candidate.pageId === pageId);
  if (page === undefined) return { ok: false, reason: 'unbound' };
  if (admission(features('chatspace'), 'onlyfans-feed', null, onPage(bootstrap, page)).state !== 'on') return { ok: false, reason: 'not_admitted' };
  return { ok: true, pageLabel: page.pageLabel };
}

/** At most `max` UTF-16 units, never half of a pair. */
const cut = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max));

/**
 * The hub's answer (`clientFanNoteAttributions`) as a tab takes it (`notes.authors`): per note, the login that created it
 * and the one that changed it last, with when; an id or a time the tab cannot read is left out.
 */
export function notesAuthorsOf(answer: FanNoteAttributions): NotesAuthors {
  const who = (entry: FanNoteAttributionWho | null) => {
    const atMs = entry === null ? NaN : Date.parse(entry.at);
    return entry === null || !Number.isFinite(atMs) || atMs <= 0 || entry.name.trim() === '' ? null : { name: cut(entry.name.trim(), 120), me: entry.isMe, atMs };
  };
  const notes = answer.notes
    .filter((note) => NATIVE_ID_PATTERN.test(note.noteRef))
    .slice(0, FAN_NOTE_ATTRIBUTIONS_MAX_NOTES)
    .map((note) => ({ noteId: note.noteRef, created: who(note.created), edited: who(note.edited) }));
  return { ok: true, notes };
}

/** How long a draft of ours waits for its button (`op.reportSent` of the same message) before it is `unknown`. */
export const COMPOSED_WAIT_MS = 2_000;
/** Messages whose button is remembered; the oldest go. */
const COMPOSED_KEPT = 256;

export interface ComposedEntry {
  readonly composedWith: SendAttributionComposedWith;
  readonly edited: boolean;
}

/**
 * Chat Memory week 1: the button behind a message, as `op.reportSent` of that message says it (the operation's
 * feature), for the who-sent fact of the same send — the tab says both at once, in no fixed order, so the fact of a
 * draft of ours waits for it a moment. Memory only: a message the event page did not hear of is `unknown`.
 */
export class ComposedWithMemory {
  private readonly known = new Map<string, ComposedEntry>();
  private readonly waiting = new Map<string, Array<(entry: ComposedEntry | null) => void>>();

  constructor(private readonly clock: Pick<Clock, 'setTimer' | 'clearTimer'>, private readonly waitMs = COMPOSED_WAIT_MS) {}

  learn(platformMessageId: string, entry: ComposedEntry): void {
    this.known.delete(platformMessageId);
    this.known.set(platformMessageId, entry);
    while (this.known.size > COMPOSED_KEPT) this.known.delete(this.known.keys().next().value ?? '');
    const waiters = this.waiting.get(platformMessageId) ?? [];
    this.waiting.delete(platformMessageId);
    for (const resolve of waiters) resolve(entry);
  }

  /** The button of the message: at once if heard, else when heard, else null after COMPOSED_WAIT_MS. */
  wait(platformMessageId: string): Promise<ComposedEntry | null> {
    const known = this.known.get(platformMessageId);
    if (known !== undefined) return Promise.resolve(known);
    return new Promise((resolve) => {
      const timer = this.clock.setTimer(this.waitMs, () => {
        const list = this.waiting.get(platformMessageId)?.filter((waiter) => waiter !== done) ?? [];
        if (list.length === 0) this.waiting.delete(platformMessageId);
        else this.waiting.set(platformMessageId, list);
        resolve(null);
      });
      const done = (entry: ComposedEntry | null): void => {
        this.clock.clearTimer(timer);
        resolve(entry);
      };
      this.waiting.set(platformMessageId, [...(this.waiting.get(platformMessageId) ?? []), done]);
    });
  }
}
