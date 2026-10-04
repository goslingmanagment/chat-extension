// Where the isolated side gets its schema module (validate.ts) from. The
// schemas are built on the first frame from MAIN, never at document_start
// (§11) — and whoever starts the host says where they come from:
//
// - a bundle that can load a module of its own (tests, the e2e harness) takes
//   `loadValidation`: the module next to this one, by `import()`;
// - the extension's content script is ONE classic file — a dynamic import
//   inside it is inlined, and the schemas of the whole bridge (with zod's
//   share of them, about 6 KiB gzip) would sit in the early isolated bundle,
//   which has 30 KiB for everything (§11). Its composition root hands in a
//   loader of a lazy chunk of the extension instead.
//
// A loader is asked on every frame and must answer the same module each time.

import type * as ValidateModule from './validate';

export type Validation = typeof ValidateModule;
export type ValidationLoader = () => Promise<Validation>;

let validation: Promise<Validation> | null = null;

/** The schema module next to this one, loaded once on first use. */
export const loadValidation: ValidationLoader = () => (validation ??= import('./validate'));
