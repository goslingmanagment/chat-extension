// Fixtures of the Coach view models added in 1.2.0 (types, no schema: wrong
// values are refused by the compiler): the Б2 question of a draft part of a
// Coach turn (AI-086) and the grouped ready questions of the empty dialog
// (AI-081). Both additions are optional — a view built before them is still
// valid. Synthetic ids only.

import type * as C from '../../src/index';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const OP = uuid(31);
const CONFIRMATION = uuid(33);

const ANSWERED_TURN: C.CoachTurnVM = {
  id: 'turn-1',
  opId: OP,
  question: 'Как вернуть его к покупкам?',
  askedAt: 1_000,
  state: 'done',
  phase: null,
  sentToCoach: false,
  streamText: null,
  attachedDraft: false,
  outsideMemory: false,
  answer: { prose: 'Сначала согрей.', blocks: null, drafts: [] },
  error: null,
  errorActions: [],
};

/** A Coach turn without a question, with `confirm: null`, and asking about the first part of its second draft. */
export const COACH_CONFIRM_SAMPLES: { readonly valid: readonly C.CoachTurnVM[]; readonly invalid: readonly unknown[] } = {
  valid: [
    ANSWERED_TURN,
    { ...ANSWERED_TURN, confirm: null },
    { ...ANSWERED_TURN, confirm: { confirmationId: CONFIRMATION, kind: 'human-draft', part: { variant: 1, index: 0 }, formatLoss: false } },
  ],
  invalid: [
    // @ts-expect-error the question is a ConfirmVM, not the bare id
    { ...ANSWERED_TURN, confirm: CONFIRMATION } satisfies C.CoachTurnVM,
    // @ts-expect-error a question names the part it is about
    { ...ANSWERED_TURN, confirm: { confirmationId: CONFIRMATION, kind: 'human-draft', formatLoss: false } } satisfies C.CoachTurnVM,
  ],
};

const SELL: C.CoachHintGroupVM = {
  label: { key: 'coach.group.sell' },
  questions: [
    { label: { key: 'coach.hint.sell.how' }, question: 'Не знаю, как продать — подскажи' },
    { label: { key: 'coach.hint.sell.price' }, question: 'Как подать цену, чтобы не спугнуть?' },
    { label: { key: 'coach.hint.sell.discount' }, question: 'Просит скидку — что ответить?' },
  ],
};

export const COACH_HINT_GROUP_SAMPLES: { readonly valid: readonly C.CoachHintGroupVM[]; readonly invalid: readonly unknown[] } = {
  valid: [SELL, { label: { key: 'coach.group.understand' }, questions: [] }],
  invalid: [
    // @ts-expect-error the heading is our own words (a Msg), not a bare string
    { ...SELL, label: 'Продать' } satisfies C.CoachHintGroupVM,
    // @ts-expect-error a ready question carries its text, not only its key
    { ...SELL, questions: [{ label: { key: 'coach.hint.sell.how' } }] } satisfies C.CoachHintGroupVM,
  ],
};
