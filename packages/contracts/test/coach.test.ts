// The Coach additions of 1.2.0: the Б2 question of a draft part on a turn
// (AI-086), the grouped ready questions of the empty dialog (AI-081), and
// the composite turn with auto-recap as one admission (AI-096, §7).

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as C from '../src/index';
import { COACH_CONFIRM_SAMPLES, COACH_HINT_GROUP_SAMPLES } from './fixtures/coach';
import { cause, opView, target } from './fixtures/samples';

describe('Coach (1.2.0)', () => {
  it('[AI-086] a Coach turn may carry the Б2 question of one of its draft parts: the id AnswerConfirm takes', () => {
    expectTypeOf<C.CoachTurnVM['confirm']>().toEqualTypeOf<C.ConfirmVM | null | undefined>();
    const [plain, none, asking] = COACH_CONFIRM_SAMPLES.valid;
    expect(plain?.confirm).toBeUndefined();
    expect(none?.confirm).toBeNull();
    const confirmationId = asking?.confirm?.confirmationId;
    expect(C.UiActionSchema.safeParse({ type: 'AnswerConfirm', confirmationId, choice: 'append' }).success).toBe(true);
    // The part of the question names the draft by `variant`, as its PartVM and InsertPart do.
    expect(asking?.confirm?.part).toEqual({ variant: 1, index: 0 });
    expect(C.PartRefSchema.safeParse(asking?.confirm?.part).success).toBe(true);
    expect(COACH_CONFIRM_SAMPLES.invalid).toHaveLength(2);
  });

  it('[AI-081] the empty dialog may carry three headings of ready questions that fill the input; the catalog has the words', () => {
    expectTypeOf<C.CoachVM['hints']>().toEqualTypeOf<readonly C.CoachHintGroupVM[] | undefined>();
    const groups = ['coach.group.sell', 'coach.group.return', 'coach.group.understand'] as const;
    const hints = [
      'coach.hint.sell.how', 'coach.hint.sell.price', 'coach.hint.sell.discount',
      'coach.hint.return.revive', 'coach.hint.return.seen', 'coach.hint.return.afterPrice',
      'coach.hint.understand.likes', 'coach.hint.understand.person', 'coach.hint.understand.topics',
    ] as const;
    for (const key of [...groups, ...hints]) expect(C.UI_TEXT_KEYS, key).toContain(key);
    // Three questions under each of the three headings.
    for (const group of groups) expect(hints.filter((key) => key.startsWith(group.replace('group', 'hint')))).toHaveLength(3);
    const [sell, empty] = COACH_HINT_GROUP_SAMPLES.valid;
    expect(sell?.questions.map((question) => question.label.key)).toEqual(hints.slice(0, 3));
    expect(empty?.questions).toEqual([]);
    expect(COACH_HINT_GROUP_SAMPLES.invalid).toHaveLength(2);
  });

  it('[AI-096] a Coach start may ask for its auto-recap first: one start, and the recap step names the answer step that follows', () => {
    const base = { feature: 'coach', surface: 'coach', target, cause, tone: null, split: false, window: 100 };
    const composite = { ...base, coach: { question: 'What next?', history: [], autoRecap: { length: 'full', window: 3000 } } };
    const parsed = C.StartOpSchema.safeParse(composite);
    expect(parsed.success).toBe(true);
    expectTypeOf<NonNullable<C.StartOp['coach']>['autoRecap']>().toEqualTypeOf<{ length: 'short' | 'full'; window: number } | undefined>();
    // The recap of a turn is not a feature of its own start: it belongs to a Coach start only.
    expect(C.StartOpSchema.safeParse({ ...base, feature: 'reply', surface: 'dock', coach: composite.coach }).success).toBe(false);
    expect(C.StartOpSchema.safeParse({ ...base, coach: { ...composite.coach, autoRecap: { length: 'full', window: 3001 } } }).success).toBe(false);
    // The answer step is named on the terminal view of the recap step.
    expectTypeOf<C.OpView['continuedBy']>().toEqualTypeOf<string | undefined>();
    expect(C.OpViewSchema.safeParse({ ...opView, continuedBy: '00000000-0000-4000-8000-000000000007' }).success).toBe(true);
    expect(C.OpViewSchema.safeParse({ ...opView, continuedBy: null }).success).toBe(false);
  });
});
