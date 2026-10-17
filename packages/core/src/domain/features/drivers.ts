// The background's driver of each feature (architecture.md §8.4 table, §7
// «Разбор и Split»): how its StartOp becomes the hub's stream request and
// how its finished answer becomes a result. The scheduler (core/services)
// takes them as `drivers`; a request the hub would answer 400 to is refused
// here and never leaves the background.
//
// | our feature | hub feature     | its fields                                              |
// | reply       | fast-reply      | replyTone, replyMode                                    |
// | fix         | improve-draft   | draftText, replyMode                                    |
// | hi          | hi-greeting     | variantCount (3, «Новые» 1), replyMode (H-10)           |
// | ping        | ping            | replyMode (H-10)                                        |
// | review      | chat-review     | —                                                       |
// | recap       | fan-summary     | —                                                       |
// | recap-short | fan-summary     | summaryMode: 'short'                                    |
// | coach       | coach-chat      | chatterQuestion, coachHistory, preset, draftText, replyMode (H-10) |

import { FEATURE_IDS, type FeatureId } from '@cg/contracts/features';
import { HUB_FEATURE_MAP } from '@cg/contracts/hub';
import { type StartOp } from '@cg/contracts/ops';

import { buildStreamRequest, type BuildResult, type StreamRequestContext } from '../ops/request';
import { type ParseContext, type ParseOutcome } from '../ops/result';
import { parseOutput } from '../output/parse';
import { hiVariantCount } from './plan';
import { policyOf } from './policy';

/** The scheduler's `OpDriver` shape (core/services), named here so the domain does not import a service. */
export interface FeatureDriver {
  build(start: StartOp, ctx: StreamRequestContext): BuildResult;
  parse(text: string, ctx: ParseContext & { readonly feature: FeatureId }): ParseOutcome;
}

const refuse = (issues: string): BuildResult => ({ ok: false, issues });

/** What the feature's policy forbids in a start, before the request is built. */
function startIssue(feature: FeatureId, start: StartOp): string | null {
  if (start.feature !== feature) return `a ${start.feature} start given to the ${feature} driver`;
  const rule = policyOf(feature);
  if (!rule.tone && start.tone !== null) return 'a tone belongs to Reply only';
  if (!rule.split && start.split) return 'Recap and Review are not messages to the fan: no Split';
  if (rule.requiresDraft && (start.draft === undefined || start.draft.text.trim().length === 0)) return 'Fix needs the draft';
  if (!rule.freshText && start.fresh !== undefined) return 'fresh page text only for Reply, Fix, Hi, Ping, Review and Coach';
  if (feature === 'coach' && (start.coach === undefined || (start.coach.question === undefined && start.coach.preset === undefined))) return 'Coach needs a question or a preset';
  return null;
}

function build(feature: FeatureId, start: StartOp, ctx: StreamRequestContext): BuildResult {
  const issue = startIssue(feature, start);
  if (issue !== null) return refuse(issue);
  return buildStreamRequest(feature === 'hi' && start.variantCount === undefined ? { ...start, variantCount: hiVariantCount(start.surface) } : start, ctx);
}

/** §8.4: the hub feature a driver streams. */
export function hubFeatureOf(feature: FeatureId): (typeof HUB_FEATURE_MAP)[FeatureId]['hub'] {
  return HUB_FEATURE_MAP[feature].hub;
}

export function featureDriver(feature: FeatureId): FeatureDriver {
  return {
    build: (start, ctx) => build(feature, start, ctx),
    parse: (text, ctx) => parseOutput(feature, text, ctx),
  };
}

/** One driver per feature, for `OpSchedulerDeps.drivers`. */
export const AI_FEATURE_DRIVERS: Readonly<Record<FeatureId, FeatureDriver>> = Object.fromEntries(FEATURE_IDS.map((feature) => [feature, featureDriver(feature)])) as Record<FeatureId, FeatureDriver>;
