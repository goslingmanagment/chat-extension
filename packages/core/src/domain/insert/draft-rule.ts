// The draft rule Б2 (architecture.md §6.4 п. 2): an empty draft or our own
// unchanged insert is replaced directly («Вставить»); a draft typed by the
// person, or one whose origin is unknown, needs the person's one-time
// consent for exactly that revision. Since decision X45 the click on
// «Вставить» is that consent wherever the editor is observed (the insert
// service writes at once, the field's undo brings the text back); the
// question «Заменить / Добавить в конец / Отмена» is asked only without an
// observed editor — there is no full CAS then, anything in a non-empty field
// needs it, and an append rewrites the field through setText, which loses
// its formatting (the dialog says so).

import { type DraftSnapshot } from '@cg/contracts/ids';

export type ConfirmReason = 'human-draft' | 'draft-changed';

export type DraftDecision =
  | { readonly kind: 'direct'; readonly mode: 'replace' }
  | { readonly kind: 'confirm'; readonly reason: ConfirmReason; readonly formatLoss: boolean };

export interface DraftRuleOptions {
  /** The host observes the composer's editor transactions (capability `draftRead` on). */
  readonly editorObserved: boolean;
}

export function decideDraft(draft: DraftSnapshot, options: DraftRuleOptions): DraftDecision {
  const emptyText = draft.plainText.trim().length === 0;
  if (draft.provenance === 'empty' || (!options.editorObserved && emptyText)) return { kind: 'direct', mode: 'replace' };
  if (!options.editorObserved) return { kind: 'confirm', reason: 'human-draft', formatLoss: true };
  if (draft.provenance === 'our-insert') return { kind: 'direct', mode: 'replace' };
  return { kind: 'confirm', reason: 'human-draft', formatLoss: false };
}
