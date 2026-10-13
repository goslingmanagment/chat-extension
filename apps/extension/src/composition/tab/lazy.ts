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

/** A lazy ESM chunk by its entry name (lazy/vite.config.ts, LAZY_ENTRIES), as a path inside the extension: `root` is the site's build (HostLazyPlan). */
export const lazyPath = (root: string, entry: string): string => `${root}/${entry}.js`;

/**
 * The chunks of a site's lazy build by their entry names, one retry each. The light entry of the platform comes
 * with the first chunk asked for, not at document_start: it reads the extension API as it loads.
 */
export const lazyLoader =
  (root: string) =>
  <T>(entry: string): Promise<T> =>
    import('@cg/platform/runtime').then(({ extensionUrl }) => importWithRetry<T>(extensionUrl(lazyPath(root, entry)), (url) => import(/* @vite-ignore */ url)));
