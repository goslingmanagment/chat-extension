// The schemas of ChatSpace's MAIN ↔ isolated bridge (R09, `validate.ts`): the
// registry the shared bridge client of the page (@cg/host-kit, R20 P5) checks
// every frame from MAIN against, and the checks of every write of our own
// controllers. A site has its own module in its own lazy build. The
// isolated content script is one classic file and cannot split itself, so
// this module — the bridge's message schemas with zod's share of them — is
// the one lazy chunk every ChatSpace page loads, right after document_start,
// with the first frame from MAIN; the early bundle carries none of it (§11).

export * from '@cg/host-chatspace/isolated/validation';
