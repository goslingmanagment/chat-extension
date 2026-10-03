// X8 preview send port (architecture.md §6.7). This is the ONLY file in the
// MAIN bridge allowed to reference ChatSpace's send queue; tools/gates fails
// the build if the queue method name appears anywhere else in our code.
//
// Part A (R09, this wave) only checks the queue store's shape for the host
// contract (§6.2 anchor `pendingMessages`). previewSendPreflight /
// previewSendCommit, the receipt observer and the human-send observation
// (§6.6–§6.8) land in part B; until then the bridge answers their requests
// with the typed «not yet» (protocol.ts NOT_YET), before execution.

/** §6.2 anchor `pendingMessages`: the queue action and its per-account state, nothing called. */
export function queueShape(store: Record<string, unknown>): 'ok' | 'shape' {
  return typeof store['enqueue'] === 'function' && typeof store['messagesByAccountId'] === 'object' && store['messagesByAccountId'] !== null ? 'ok' : 'shape';
}
