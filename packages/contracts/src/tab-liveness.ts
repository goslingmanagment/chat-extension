// The scaffold's liveness exchange on the `cg-tab` port (R00, spike M0): the
// tab says hello, the background answers with its status. It predates the
// §5.4 envelope and stays as is while the composition roots and the e2e use
// it; R07 moves the composition onto the envelope (`tab.register`). Kept in
// its own module so the early isolated bundle does not pull the protocol
// registry in with it.

import * as z from 'zod/mini';

export const TabHelloSchema = z.strictObject({ t: z.literal('hello'), v: z.literal(1) });
export type TabHello = z.infer<typeof TabHelloSchema>;

export const BackgroundStatusSchema = z.strictObject({
  t: z.literal('status'),
  v: z.literal(1),
  /** Whether the dynamic MAIN script (WS tap) is registered right now. */
  wsTapRegistered: z.boolean(),
  /** True only in a CG_TEST_HOSTS build. */
  testBuild: z.boolean(),
});
export type BackgroundStatus = z.infer<typeof BackgroundStatusSchema>;
