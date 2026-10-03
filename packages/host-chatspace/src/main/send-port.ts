// X8 preview send port (architecture.md §6.7). This is the ONLY file in the
// MAIN bridge allowed to reference ChatSpace's send queue; tools/gates fails
// the build if the queue method name appears anywhere else in our code.
//
// R09 implements previewSendPreflight / previewSendCommit here, behind the
// bootstrap flag and the hub dispatch custody. Until then MAIN has no send path.

/** Marker so the file exists in the bundle graph before R09 lands. */
export const PREVIEW_SEND_PORT_STATUS = 'not-implemented' as const;
