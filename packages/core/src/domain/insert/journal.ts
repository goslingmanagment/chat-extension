// The route and insert journal (LG-017, architecture.md §9.2): what a P1
// «вставка в чужой чат» investigation needs — route changes, every insert
// intent with what it expected, every receipt, every refusal before the
// host — and never the text itself: only its length and fingerprint (D-21).
// The entries are log records without `ts`/`seq`, which the logger adds.

import { type CgCode } from '@cg/contracts/errors';
import { type InsertIntent, type InsertReceipt, type InsertWire, type RouteState } from '@cg/contracts/host';
import { chatKeyOf } from '@cg/contracts/ids';
import { type LogRecord } from '@cg/contracts/logs';

import { digestHex } from '../ops/digest';

export type JournalEntry = Omit<LogRecord, 'ts' | 'seq'>;

const ROUTE_SCOPE = 'tab.route';
const INSERT_SCOPE = 'tab.insert';

export function routeChangeEntry(route: RouteState, tabSessionId?: string): JournalEntry {
  return {
    level: 'info',
    scope: ROUTE_SCOPE,
    msg: 'route changed',
    fields: { name: route.name, hostAccountId: route.account?.hostAccountId ?? null },
    ctx: {
      routeEpoch: route.epoch,
      ...(route.chat === null ? {} : { chatKey: chatKeyOf(route.chat) }),
      ...(tabSessionId === undefined ? {} : { tabSessionId }),
    },
  };
}

/** An intent about to go to the host: what it expects, never what it writes. */
export function insertIntentEntry(intent: InsertIntent | InsertWire): JournalEntry {
  const expected = intent.expected;
  return {
    level: 'info',
    scope: INSERT_SCOPE,
    msg: 'insert intent',
    fields: {
      intentId: intent.intentId,
      part: intent.part.index,
      variant: intent.part.variant ?? 0,
      mode: intent.mode,
      textLength: intent.text.length,
      textDigest: digestHex(intent.text),
      expected: expected.kind,
      draftRevision: expected.kind === 'open' ? expected.draftRevision : null,
      composerInstanceId: expected.kind === 'open' ? expected.composerInstanceId : null,
      consent: intent.confirmationId !== null,
      expiresInMs: intent.expiresAt - intent.createdAt,
    },
    ctx: {
      opId: intent.operationId,
      chatKey: chatKeyOf(intent.target),
      documentEpoch: expected.documentEpoch,
      ...(expected.kind === 'open' ? { routeEpoch: expected.routeEpoch } : {}),
    },
  };
}

export function insertReceiptEntry(intent: InsertIntent | InsertWire, receipt: InsertReceipt): JournalEntry {
  const base = { scope: INSERT_SCOPE, ctx: { opId: intent.operationId, chatKey: chatKeyOf(intent.target) } };
  switch (receipt.state) {
    case 'applied':
      return { ...base, level: 'info', msg: 'insert applied', fields: { intentId: intent.intentId, draftRevision: receipt.draftRevision, ms: receipt.ms } };
    case 'rejected':
      return { ...base, level: 'warn', msg: 'insert rejected', code: receipt.code, fields: { intentId: intent.intentId, needs: receipt.needs ?? null } };
    case 'uncertain':
      return { ...base, level: receipt.code === 'CG-INSERT-MISPLACED' ? 'error' : 'warn', msg: 'insert uncertain', code: receipt.code, fields: { intentId: intent.intentId } };
  }
}

/** A refusal on the isolated side, before anything reached the host (§6.4 п. 1). */
export function insertGuardEntry(opId: string, code: CgCode, routeEpoch: number | null): JournalEntry {
  return {
    level: 'warn',
    scope: INSERT_SCOPE,
    msg: 'insert prevented',
    code,
    ctx: { opId, ...(routeEpoch === null ? {} : { routeEpoch }) },
  };
}
