// The showcase world of `pnpm see … --showcase` (tools/see/README.md): the stand, the fake Fansly and the fake hub
// dressed as a working day of an invented agency — Mia Rose on OnlyFans, Sofia Lane on Fansly, fans with ordinary
// names writing in English, amounts and times of a real shift — for the pictures of the landing page and the posts to
// chatters. Every name, handle, text and number is made up; the ids are the synthetic world's own.
//
// The switch is the run's environment (CG_SEE_SHOWCASE=1), read once by every process of the run: the wdio launcher
// (the stand, the fake Fansly, the fake hub) and its worker (the scenario) see one world. Unset — the e2e, the unit
// tests, a plain `pnpm see` — everything stays the synthetic world it is. A browser bundle that imports this reads
// false: a page learns the world from its server (`data-stand-world` on the stand page's `<html>`).

/** The process's environment; nothing in a browser, and no Node types needed (core's tests compile this file too). */
const env = (name: string): string | undefined => (globalThis as { readonly process?: { readonly env?: Readonly<Record<string, string | undefined>> } }).process?.env?.[name];

export const SHOWCASE: boolean = env('CG_SEE_SHOWCASE') === '1';

/**
 * The showcase's «now», ms: the run's start as the CLI wrote it (CG_SEE_SHOWCASE_AT), so that the launcher's stand and
 * the worker's copy of the same world date — and so number — every message alike. Without it, this process's start.
 */
export const SHOWCASE_AT: number = ((): number => {
  const at = Number(env('CG_SEE_SHOWCASE_AT'));
  return Number.isFinite(at) && at > 0 ? at : Date.now();
})();
