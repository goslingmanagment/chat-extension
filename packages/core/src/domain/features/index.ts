// core/domain/features — what each AI feature is and how it starts
// (architecture.md §5.5, §7, §8.4; RU-001, AI-001…AI-039): the policy table,
// the one-off tone, the client gates with their CG-GATE-* codes, the plan
// that turns a click into a StartOp, and the background's driver per
// feature (request and result). Pure.

export * from './drivers';
export * from './gates';
export * from './plan';
export * from './policy';
export * from './tone';
