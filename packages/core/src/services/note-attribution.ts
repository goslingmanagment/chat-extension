// Who wrote each Fansly note (hub `clientNoteAttributions`, capability
// `note-attribution-v1`). A person's write of «Заметки» that Fansly confirmed
// — a note created (its new id), edited or deleted, the custom name set or
// cleared — is told to the hub: this page, this fan, this note, what was done
// and where in the panel, and the questionnaire labels the write changed. The
// person is the hub's — the user of the token — never a field of ours. No
// text or title of a note is ever here.
//
// Every write is its own event (`eventId`, minted by the background): the hub
// records it once, and a repeat of a lost answer reads `duplicate`. What the
// hub has not answered is owed and journaled under the person signed in when
// the write was confirmed, exactly as who sent each message (owed-report.ts):
// delivered only under their sign-in, every answer final, a 4xx given up.

import {
  NOTE_ATTRIBUTION_LIMITS,
  NOTE_ATTRIBUTION_OUTCOMES,
  NOTE_ATTRIBUTION_SOURCES,
  NoteAttributionHubFactSchema,
  type HubFacade,
  type NoteAttributionAction,
  type NoteAttributionKind,
  type NoteAttributionOrigin,
  type NoteAttributionsRequest,
} from '@cg/contracts/hub';

import { LOCAL_KEYS } from '../domain/storage';
import { OwedReports } from './owed-report';
import { NO_LOG, type Clock, type KeyValueStore, type LogSink } from './ports';

/** storage.local: who-wrote facts the hub has not answered yet (ids, labels; never a text). */
export const NOTE_ATTRIBUTIONS_KEY = LOCAL_KEYS.noteAttributions;
/** Facts kept at most; beyond it the oldest go. */
export const NOTE_ATTRIBUTIONS_MAX = 1000;
/** A fact nobody could deliver for this long is given up. */
export const NOTE_ATTRIBUTION_KEEP_MS = 14 * 24 * 60 * 60_000;
/** How long a new fact waits for the next ones before its report goes. */
export const NOTE_ATTRIBUTION_BATCH_MS = 3_000;
/** A difference from the hub's clock above this corrects the times sent. */
export const NOTE_ATTRIBUTION_SKEW_MS = 60_000;

/** One confirmed write, as the background takes it: the page and client it is reported for, and the hub's own fact. */
export interface NoteAttributionInput {
  readonly pageLabel: string;
  readonly source: string;
  /** Minted for this write (a UUID). */
  readonly eventId: string;
  readonly fanRef: string;
  readonly noteRef: string;
  readonly noteKind: NoteAttributionKind;
  readonly action: NoteAttributionAction;
  readonly origin?: NoteAttributionOrigin;
  readonly fields?: readonly string[];
  /** When the write was confirmed (`toISOString`). */
  readonly observedAt: string;
}

export type NoteAttributionOutcome =
  /** Owed now: it goes to the hub under the person signed in. */
  | 'queued'
  /** The same event of the same page is owed or answered already. */
  | 'known'
  /** Not a fact the hub's schema takes: never owed. */
  | 'invalid'
  /** Nobody is signed in. */
  | 'signed-out';

export interface NoteAttributionDeps {
  readonly clock: Pick<Clock, 'setTimer' | 'clearTimer' | 'now'>;
  readonly hub: Pick<HubFacade, 'noteAttributions'>;
  /** Who is signed in — `hubOrigin|userId`; null — nobody. */
  readonly owner: () => string | null;
  /** storage.local; omitted — memory only. */
  readonly store?: KeyValueStore;
  readonly log?: LogSink;
}

type HubFact = NoteAttributionsRequest['facts'][number];

/** The hub's fact of a write: its fields only, an absent one left out (the hub's body is strict). */
function hubFactOf(input: Omit<NoteAttributionInput, 'pageLabel' | 'source'>): HubFact {
  const { eventId, fanRef, noteRef, noteKind, action, origin, fields, observedAt } = input;
  return { eventId, fanRef, noteRef, noteKind, action, ...(origin === undefined ? {} : { origin }), ...(fields === undefined ? {} : { fields: [...fields] }), observedAt };
}

/** What a journal entry may hold: the fact's own fields and the engine's marks — an entry with anything more (a text) goes. */
const OWED_KEYS: ReadonlySet<string> = new Set(['pageLabel', 'source', 'eventId', 'fanRef', 'noteRef', 'noteKind', 'action', 'origin', 'fields', 'observedAt', 'owner', 'at', 'ahead', 'holdUntil']);

const isSource = (source: unknown): boolean => (NOTE_ATTRIBUTION_SOURCES as readonly unknown[]).includes(source);

export class NoteAttributionReporter {
  private readonly reports: OwedReports<NoteAttributionInput, HubFact>;
  private readonly log: LogSink;

  constructor(private readonly deps: NoteAttributionDeps) {
    this.log = deps.log ?? NO_LOG;
    this.reports = new OwedReports<NoteAttributionInput, HubFact>(
      {
        storageKey: NOTE_ATTRIBUTIONS_KEY,
        noun: 'note attribution',
        scope: 'bg.note-attribution',
        max: NOTE_ATTRIBUTIONS_MAX,
        keepMs: NOTE_ATTRIBUTION_KEEP_MS,
        batchMs: NOTE_ATTRIBUTION_BATCH_MS,
        skewMs: NOTE_ATTRIBUTION_SKEW_MS,
        maxFacts: NOTE_ATTRIBUTION_LIMITS.maxFacts,
        outcomes: NOTE_ATTRIBUTION_OUTCOMES,
        idOf: (fact) => fact.eventId,
        isFact: (item) => Object.keys(item).every((key) => OWED_KEYS.has(key)) && isSource(item['source']) && (item['fields'] === undefined || Array.isArray(item['fields'])) && NoteAttributionHubFactSchema.safeParse(hubFactOf(item as unknown as NoteAttributionInput)).success,
        hubFactOf,
        call: (pageLabel, source, facts) => deps.hub.noteAttributions({ pageLabel, source: source as NoteAttributionsRequest['source'], facts }),
      },
      { clock: deps.clock, owner: deps.owner, ...(deps.store === undefined ? {} : { store: deps.store }), log: this.log },
    );
  }

  /** After the event page woke up: what the previous instance still owed goes under its writer's sign-in. */
  restore(): Promise<number> {
    return this.reports.restore();
  }

  /** One confirmed write of the person signed in now; the report goes after a short quiet, with the writes around it. */
  report(input: NoteAttributionInput): NoteAttributionOutcome {
    const owner = this.deps.owner();
    if (owner === null) return 'signed-out';
    if (!isSource(input.source) || !NoteAttributionHubFactSchema.safeParse(hubFactOf(input)).success) {
      this.log.write({ level: 'warn', scope: 'bg.note-attribution', msg: 'note attribution not taken: not a fact the hub takes' });
      return 'invalid';
    }
    const { pageLabel, source, eventId, fanRef, noteRef, noteKind, action, origin, fields, observedAt } = input;
    // Only the fact's own fields are journaled.
    return this.reports.take(owner, { pageLabel, source, eventId, fanRef, noteRef, noteKind, action, ...(origin === undefined ? {} : { origin }), ...(fields === undefined ? {} : { fields: [...fields] }), observedAt });
  }

  /** The hub was heard again, the same person signed in, the event page woke: what that person owes goes now. */
  resume(): number {
    return this.reports.resume();
  }

  /** Facts the hub has not answered (diagnostics, tests). */
  get pending(): number {
    return this.reports.pending;
  }

  /** Resolves when every delivery started so far and every journal write settled (tests). */
  idle(): Promise<void> {
    return this.reports.idle();
  }
}

/**
 * The tab's word on where a write came from and which questionnaire labels it changed, as the hub takes it: an origin
 * the hub does not name is dropped, a label empty or too long is dropped, beyond NOTE_ATTRIBUTION_LIMITS.maxFields the
 * rest go. Never a reason to refuse the write itself.
 */
export function noteWriteOrigin(origin: unknown, fields: unknown): { readonly origin?: NoteAttributionOrigin; readonly fields?: readonly string[] } {
  const known = NoteAttributionHubFactSchema.shape.origin.safeParse(origin);
  const labels = Array.isArray(fields)
    ? [...new Set(fields.filter((label): label is string => typeof label === 'string' && label.length > 0 && label.length <= NOTE_ATTRIBUTION_LIMITS.fieldLabelMaxChars))].slice(0, NOTE_ATTRIBUTION_LIMITS.maxFields)
    : [];
  return { ...(known.success && known.data !== undefined ? { origin: known.data } : {}), ...(labels.length > 0 ? { fields: labels } : {}) };
}
