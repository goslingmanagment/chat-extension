// The chatter's log as the tab writes it (2026-10-21, «Скачать лог»): the records the owner reads in the file —
//
// - `ui.action` — what the person pressed: the action, how (click, key, a page's command), through which surface,
//   about which chat, and what it came to (done, or refused with its code and the sentence the person saw);
// - `ui.decision` — a function of a surface went off, or came back, with why; the first look at a chat (or a
//   preview, a list) says at once what is off there;
// - `ui.toast` — a toast the person was shown, by its code;
// - `ui.config` — the configuration the tab works with, again whenever it changes.
//
// Everything is `info`: written whether debug is on or not. Nothing here holds a text of a conversation.

import { type LogLevel } from '@cg/contracts/logs';
import { type ActionReceipt, type UiAction } from '@cg/contracts/vm';

import { actionFacts, handleFacts, isQuietAction, receiptFacts } from './actions';
import { diffAvailability, type Availability, type AvailabilityMap } from './availability';
import { changedFields } from './config';

export const JOURNAL_SCOPES = {
  action: 'ui.action',
  decision: 'ui.decision',
  toast: 'ui.toast',
  config: 'ui.config',
} as const;

/** The logger's writing half (the tab's logger, a test's list). */
export interface JournalLog {
  write(level: LogLevel, scope: string, msg: string, options?: { readonly at?: number; readonly code?: string; readonly fields?: Readonly<Record<string, unknown>> }): unknown;
}

/** How the action came: a click, a key, a click on one of our pages brought to the tab, or none seen (a timer, a stage that loaded). */
export type ActionInput = 'click' | 'key' | 'command' | 'none';

export interface ActionContext {
  readonly input: ActionInput;
  /** The surface the click or the key came through (`dock`, `spenders`, `palette`, `page` — the site's own page). */
  readonly via: string;
}

/** A receipt this quick is said in the same record as its click; a slower one gets a record of its own. */
export const ACTION_JOIN_MS = 400;

export interface ActionJournal {
  /** The person's action, in the step of the click; the answer comes to `answered`. */
  pressed(action: UiAction, context: ActionContext): (receipt: ActionReceipt | null) => void;
}

export function createActionJournal(log: JournalLog, clock: { now(): number; setTimer(ms: number, fn: () => void): unknown; clearTimer(handle: unknown): void }): ActionJournal {
  return {
    pressed(action, context) {
      if (isQuietAction(action)) return () => undefined;
      const at = clock.now();
      const facts = { ...actionFacts(action), input: context.input, via: context.via };
      let said = false;
      const timer = clock.setTimer(ACTION_JOIN_MS, () => {
        said = true;
        log.write('info', JOURNAL_SCOPES.action, 'pressed', { at, fields: facts });
      });
      return (receipt) => {
        const ms = Math.max(0, clock.now() - at);
        const answer = receipt === null ? { ok: false, outcome: 'failed' } : receiptFacts(receipt);
        const code = receipt !== null && !receipt.ok ? receipt.code : undefined;
        if (said) {
          log.write('info', JOURNAL_SCOPES.action, 'answered', { ...(code === undefined ? {} : { code }), fields: { action: action.type, ...answer, ms } });
          return;
        }
        clock.clearTimer(timer);
        said = true;
        // Stamped with the click's own time: the file reads it before what the click set going.
        log.write('info', JOURNAL_SCOPES.action, 'pressed', { at, ...(code === undefined ? {} : { code }), fields: { ...facts, ...answer, ms } });
      };
    },
  };
}

/** `row@newcomers:11:5001` → the entry's feature and the ids of its fan. */
function entryFacts(key: string): Record<string, unknown> {
  const at = key.indexOf('@');
  return at < 0 ? { feature: key } : { feature: key.slice(0, at), ...handleFacts(key.slice(at + 1)) };
}

function stateFacts(state: Availability): Record<string, unknown> {
  return { why: state.why, code: state.code, ...(state.say === null ? {} : { say: state.say }) };
}

export interface DecisionWatch {
  /**
   * The surface's map now, for what it shows (`subject`: the chat, the preview's fan, the list): a new subject is a
   * first look — one record of what is off there; the same subject — a record per change. null — nothing is decided
   * now (still loading): nothing is written and nothing is forgotten.
   */
  see(subject: string, map: AvailabilityMap | null): void;
  /** The surface closed: the next look is a first one. */
  reset(): void;
}

/** More changes at once than this are one record (a list read again, a whole strip that went off). */
export const DECISIONS_PER_RECORD = 8;
const ITEMS_MAX = 40;

export function createDecisionWatch(log: JournalLog, surface: string): DecisionWatch {
  let subject: string | null = null;
  let kept: AvailabilityMap = new Map();
  return {
    see(next, map) {
      if (map === null) return;
      if (next !== subject) {
        subject = next;
        kept = map;
        const offs = [...map].filter(([, state]) => !state.on);
        const counts: Record<string, number> = {};
        for (const [, state] of offs) counts[state.why ?? 'unknown'] = (counts[state.why ?? 'unknown'] ?? 0) + 1;
        log.write('info', JOURNAL_SCOPES.decision, 'state', {
          fields: {
            surface,
            ...handleFacts(next),
            onCount: map.size - offs.length,
            offCount: offs.length,
            ...(offs.length > ITEMS_MAX ? { counts } : {}),
            items: offs.slice(0, ITEMS_MAX).map(([key, state]) => ({ ...entryFacts(key), ...stateFacts(state) })),
          },
        });
        return;
      }
      const diff = diffAvailability(kept, map);
      kept = diff.kept;
      if (diff.changes.length === 0) return;
      if (diff.changes.length > DECISIONS_PER_RECORD) {
        log.write('info', JOURNAL_SCOPES.decision, 'changed', {
          fields: {
            surface,
            changedCount: diff.changes.length,
            items: diff.changes.slice(0, ITEMS_MAX).map((change) => ({ ...entryFacts(change.key), on: change.after.on, ...stateFacts(change.after) })),
          },
        });
        return;
      }
      for (const change of diff.changes) {
        const facts = { surface, ...entryFacts(change.key), ...stateFacts(change.after), ...(change.before === null || change.before.on ? {} : { wasReason: change.before.why }) };
        if (change.after.on) log.write('info', JOURNAL_SCOPES.decision, 'available', { fields: facts });
        else log.write('info', JOURNAL_SCOPES.decision, 'unavailable', { ...(typeof change.after.code === 'string' && change.after.code.startsWith('CG-') ? { code: change.after.code } : {}), fields: facts });
      }
    },
    reset() {
      subject = null;
      kept = new Map();
    },
  };
}

export interface ToastFacts {
  readonly kind: string;
  readonly code: string | null;
  readonly scope: string;
  /** The toast's title as the person read it. */
  readonly say: string | null;
}

/** A toast the person was shown; `extra` — machine facts of its source (a background toast's operation, its fan). */
export function logToast(log: JournalLog, toast: ToastFacts, extra: Readonly<Record<string, unknown>> = {}): void {
  log.write('info', JOURNAL_SCOPES.toast, extra['shown'] === false ? 'kept by the dock' : 'shown', {
    fields: { kind: toast.kind, scope: toast.scope, ...(toast.code === null ? {} : { toastCode: toast.code }), ...(toast.say === null ? {} : { say: toast.say }), ...extra },
  });
}

export interface ConfigWatch {
  /** The configuration now; written when it differs from the last one written. */
  see(facts: Readonly<Record<string, unknown>>, why: string): void;
}

export function createConfigWatch(log: JournalLog): ConfigWatch {
  let last: Readonly<Record<string, unknown>> | null = null;
  let lastJson = '';
  return {
    see(facts, why) {
      const json = JSON.stringify(facts);
      if (json === lastJson) return;
      const changed = changedFields(last, facts);
      last = facts;
      lastJson = json;
      log.write('info', JOURNAL_SCOPES.config, 'configuration', { fields: { trigger: why, ...(changed.length === 0 ? {} : { changed }), ...facts } });
    },
  };
}
