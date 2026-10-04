// What an insert receipt means for the person and the telemetry
// (architecture.md §6.4 п. 4–5): `applied` → telemetry `inserted` and the
// draft is ours (its fingerprint); a refusal that needs consent → the Б2
// question; an uncertain write is never repeated («Проверьте поле ввода»);
// CG-INSERT-MISPLACED is the P1 counter and comes only from exact evidence.

import { type CgCode } from '@cg/contracts/errors';
import { type InsertReceipt } from '@cg/contracts/host';

import { type ConfirmReason } from './draft-rule';

export type InsertOutcome =
  | { readonly kind: 'applied'; readonly telemetry: 'inserted'; readonly ours: { readonly revision: number; readonly digest: string }; readonly ms: number }
  | { readonly kind: 'needs-confirm'; readonly reason: ConfirmReason }
  /** Nothing was written; a new click may try again. */
  | { readonly kind: 'refused'; readonly code: CgCode }
  /** It may or may not have been written: never inserted again; only reread for reconciliation. */
  | { readonly kind: 'uncertain'; readonly code: CgCode; readonly p1: boolean };

export function interpretInsertReceipt(receipt: InsertReceipt): InsertOutcome {
  switch (receipt.state) {
    case 'applied':
      return { kind: 'applied', telemetry: 'inserted', ours: { revision: receipt.draftRevision, digest: receipt.draftDigest }, ms: receipt.ms };
    case 'rejected':
      if (receipt.needs === 'confirm-human-draft') return { kind: 'needs-confirm', reason: 'human-draft' };
      if (receipt.needs === 'confirm-changed-draft') return { kind: 'needs-confirm', reason: 'draft-changed' };
      return { kind: 'refused', code: receipt.code };
    case 'uncertain':
      return { kind: 'uncertain', code: receipt.code, p1: receipt.code === 'CG-INSERT-MISPLACED' };
  }
}
