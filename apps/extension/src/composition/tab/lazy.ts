// Loading a lazy chunk (architecture.md §11; EX-009): `import()` of our own
// `moz-extension://…/lazy/<name>.js`, and one more try when it fails. A module
// that failed to load stays failed under its own URL for the life of the
// document (the module map remembers the failure), so the second try asks
// for the same file under `?retry=1`. Nothing is tried a third time: the
// caller shows what does not work and asks again with the next composer.

/** Between the failed load and the retry. */
export const LAZY_RETRY_DELAY_MS = 500;

export type ModuleImporter = (url: string) => Promise<unknown>;

export async function importWithRetry<T>(
  url: string,
  importer: ModuleImporter,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  try {
    return (await importer(url)) as T;
  } catch {
    await wait(LAZY_RETRY_DELAY_MS);
    return (await importer(`${url}?retry=1`)) as T;
  }
}
