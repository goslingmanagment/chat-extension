// Where the isolated side gets ChatSpace's schema module (validate.ts) from.
// The schemas are built on the first frame from MAIN, never at document_start
// (§11) — and whoever starts the host says where they come from
// (@cg/host-kit/isolated/validation.ts has the rule and the loader's type):
//
// - a bundle that can load a module of its own (tests, the e2e harness) takes
//   `loadValidation`: the module next to this one, by `import()`;
// - the extension's content script hands in a loader of its lazy chunk
//   `lazy/chatspace/bridge-validation.js` instead.
//
// A loader is asked on every frame and must answer the same module each time.

import type { ValidationLoader as LoaderOf } from '@cg/host-kit/isolated/validation';

import type * as ValidateModule from './validate';

/** ChatSpace's schema module: the three stages of its bridge registry and the checks of our own controllers' intents. */
export type Validation = typeof ValidateModule;
export type ValidationLoader = LoaderOf<Validation>;

let validation: Promise<Validation> | null = null;

/** The schema module next to this one, loaded once on first use. */
export const loadValidation: ValidationLoader = () => (validation ??= import('./validate'));
