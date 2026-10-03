// Tab ↔ background protocol (architecture.md §5.4). R00 fixes only the port
// name and the scaffold's status exchange; R01 freezes the real messages.

import * as z from 'zod/mini';

/** `runtime.Port` name for the isolated content script ↔ background channel. */
export const TAB_PORT_NAME = 'cg-tab';

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
