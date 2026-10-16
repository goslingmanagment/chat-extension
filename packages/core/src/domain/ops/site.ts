// A site's operations plug into the one background scheduler. No site values
// or schemas enter its graph: the owning background chunk supplies these ports.
import type { OpFeature, SiteOpId } from '@cg/contracts/features';
import type { HostKind } from '@cg/contracts/hosts';
import type { OpTimeouts } from '@cg/contracts/limits';
import type { SiteOpResult, SiteOpView, SiteStartOp, StartOp } from '@cg/contracts/ops';
import type { CgCode } from '@cg/contracts/errors';
import type { BuildResult, ParseContext, StreamRequestContext } from './index';

/** Common lifecycle fields; the site's original start stays in memory only until settlement. */
export type ScheduledStart = Omit<StartOp, 'feature'> & {
  readonly feature: OpFeature;
  readonly site?: SiteStartOp;
  readonly parametersDigest?: string;
};

export interface SiteOpDriver {
  /** The manifest entry admitting generate (it can differ from the operation id). */
  readonly feature: string;
  readonly timeouts: OpTimeouts;
  prepare(start: SiteStartOp): ScheduledStart;
  build(start: ScheduledStart, ctx: StreamRequestContext): BuildResult;
  parse(text: string, ctx: ParseContext & { readonly start: ScheduledStart; readonly stopReason: string | null }): { readonly ok: true; readonly result: SiteOpResult } | { readonly ok: false; readonly code: CgCode };
}

export interface SiteOperations {
  readonly host: HostKind;
  readonly drivers: Partial<Record<SiteOpId, SiteOpDriver>>;
  /** The site's strict view schema, also used when restoring the shared journal. */
  readView(value: unknown): SiteOpView | null;
  /** Its own event registry; common op.done continues to carry common views only. */
  done(view: SiteOpView): void;
}
