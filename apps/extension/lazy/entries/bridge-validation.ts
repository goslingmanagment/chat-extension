// The schemas of the MAIN ↔ isolated bridge (R09, `validate.ts`): every frame
// from MAIN passes them, and so does every write of our own controllers. The
// isolated content script is one classic file and cannot split itself, so
// this module — the bridge's message schemas with zod's share of them — is
// the one lazy chunk every ChatSpace page loads, right after document_start,
// with the first frame from MAIN; the early bundle carries none of it (§11).

export * from '@cg/host-chatspace/isolated/validation';
