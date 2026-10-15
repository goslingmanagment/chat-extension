// 1.15.0: optional host activation, owned by the background core (§4).
// Counts and switches only; session material never crosses the page protocol.
import * as z from 'zod/mini';
import { HostKindSchema } from './ids';
import { CountSchema } from './primitives';

export const SiteAccessRequestSchema = z.strictObject({
  host: HostKindSchema,
  enabled: z.optional(z.boolean()),
  reload: z.optional(z.boolean()),
});
export const SiteAccessStateSchema = z.strictObject({
  host: HostKindSchema,
  enabled: z.boolean(),
  granted: z.boolean(),
  registered: z.boolean(),
  waitingReload: CountSchema,
  /** Present only in the reply to a reload action: successful browser reloads. */
  reloaded: z.optional(CountSchema),
});
export type SiteAccessState = z.infer<typeof SiteAccessStateSchema>;

/** The page controller's small activation surface; no site code in the common page shell. */
export interface SiteAccessView {
  readonly state: SiteAccessState | null;
  readonly busy: boolean;
  readonly error: string | null;
}
export interface SiteAccessControl {
  readonly value: SiteAccessView;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  reload(): Promise<void>;
}
