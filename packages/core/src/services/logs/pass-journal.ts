// Internal port of the pass's metadata journal (R20 P10b3, NF-029, FS-NEW-5).
// No wire contract and no texts. The background's logging owner owns persistence.

export interface PassJournalRun {
  readonly passId: string;
  readonly hostAccountId: string;
  readonly startedAt: number;
  readonly windowHours: number;
}

export type PassJournalEvent =
  | 'pass.start' | 'pass.end' | 'pass.phase' | 'pass.stop' | 'pass.close'
  | 'queue.start' | 'queue.pause' | 'queue.resume' | 'queue.prioritize'
  | 'call.start' | 'call.end' | 'call.failed' | 'call.wait'
  | 'http.start' | 'http.end' | 'http.failed'
  | 'welcome.refresh' | 'followers.page' | 'inbox.page' | 'profiles.batch'
  | 'chat.reuse' | 'history.page' | 'history.cache' | 'message.classify' | 'row.verdict';

/** Only ids, enums, counters and timing facts; never request/response objects or error messages. */
export interface PassJournalFields {
  readonly fanRef?: string;
  readonly groupId?: string | undefined;
  readonly messageId?: string;
  readonly route?: string;
  readonly state?: string;
  readonly phase?: string;
  readonly status?: string;
  readonly reason?: string;
  readonly kind?: string;
  readonly code?: string | undefined;
  readonly classification?: string;
  readonly page?: number;
  readonly count?: number;
  readonly total?: number;
  readonly attempt?: number;
  readonly httpStatus?: number | undefined;
  readonly durationMs?: number;
  readonly waitMs?: number;
  readonly retryAt?: number | undefined;
  readonly complete?: boolean;
  readonly sent?: boolean;
}

export type PassJournalSink = (event: PassJournalEvent, fields?: PassJournalFields) => void;

export interface PassJournal {
  /** Debug selection is frozen here, at scan start. A disabled scan gets no sink. */
  start(run: PassJournalRun): PassJournalSink | undefined;
}
