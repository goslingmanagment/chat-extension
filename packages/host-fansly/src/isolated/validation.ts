// Where the isolated side gets Fansly's schema module (validate.ts) from.
// The schemas are built on the first frame from MAIN, never at document_start
// (docs/project-unite/architecture.md §3.1) — and whoever starts the host says
// where they come from (@cg/host-kit/isolated/validation.ts has the rule and
// the loader's type):
//
// - a bundle that can load a module of its own (tests) takes `loadValidation`:
//   the module next to this one, by `import()`;
// - the extension's content script hands in a loader of the lazy chunk
//   `lazy/fansly/bridge-validation.js` of Fansly's own build instead.
//
// A loader is asked on every frame and must answer the same module each time.

import type { ValidationLoader as LoaderOf } from '@cg/host-kit/isolated/validation';

import type * as ValidateModule from './validate';

/** Fansly's schema module: the three stages of its bridge registry. */
export type Validation = typeof ValidateModule;
export type ValidationLoader = LoaderOf<Validation>;

let validation: Promise<Validation> | null = null;

/** The schema module next to this one, loaded once on first use. */
export const loadValidation: ValidationLoader = () => (validation ??= import('./validate'));
