// Text-free socket facts for the background's one sound arbiter (1.15.0,
// R20 P14a). A batch retains the order of one MAIN delivery. No history,
// retries, message text or site-specific types cross this boundary.
import * as z from 'zod/mini';

import { HostKindSchema } from './ids';
import { IsoTimestampSchema, NativeIdSchema } from './primitives';

export const SoundStreamEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('message'), id: NativeIdSchema, conversationRef: NativeIdSchema,
    senderId: NativeIdSchema, fromFan: z.boolean(), automatic: z.boolean(), tip: z.boolean(),
    sentAt: z.nullable(IsoTimestampSchema),
  }),
  z.strictObject({ kind: z.literal('subscriber'), id: NativeIdSchema, accountId: NativeIdSchema, followerId: NativeIdSchema }),
]);
export type SoundStreamEvent = z.infer<typeof SoundStreamEventSchema>;

export const SoundBatchSchema = z.strictObject({
  host: HostKindSchema,
  hostAccountId: NativeIdSchema,
  events: z.array(SoundStreamEventSchema).check(z.minLength(1), z.maxLength(512)),
});
export type SoundBatch = z.infer<typeof SoundBatchSchema>;
