// The shape of a host registry entry (docs/project-unite/architecture.md §1.2).
// Build data: read by the manifest builder, the WXT config and the tools,
// never by code that ships (that reads the runtime table, ./runtime/index.ts).

import type { HostKind, Platform } from '@cg/contracts';

import type { RuntimeHostRow } from './runtime/index.ts';

/** One script of a site. */
export interface ScriptSpec {
  /** The WXT entry point (src/entrypoints/<entry>.ts, <entry>.content.ts). */
  readonly entry: string;
  /** The built file inside the extension. */
  readonly file: string;
  readonly world: 'MAIN' | 'ISOLATED';
  /**
   * `manifest` — a manifest content script; `dynamic` — the background registers it
   * (`scripting.registerContentScripts`); `execute` — the background injects it into open tabs
   * (`scripting.executeScript`).
   */
  readonly registration: 'manifest' | 'dynamic' | 'execute';
}

export interface HostScripts {
  /** The MAIN-world script at document_start; absent — the site runs in the isolated world only (Telegram). */
  readonly main?: ScriptSpec;
  /** The isolated script at document_start: the early bootstrap of the tab. */
  readonly isolated: ScriptSpec;
  /** A small isolated script the background injects into tabs opened before an update or a grant. */
  readonly notice?: ScriptSpec;
  readonly extra?: readonly ScriptSpec[];
}

/** An optional API permission a site asks for together with its origins. */
export type OptionalApi = 'webRequest';

export interface HostPermissions {
  /** The origins the site needs (its pages and, where the extension talks to it, its API). */
  readonly origins: readonly string[];
  /** true — asked for on the person's gesture (`optional_host_permissions`); false — granted at install. */
  readonly optional: boolean;
  /** Optional API permissions asked for together with the origins (`optional_permissions`). */
  readonly api?: readonly OptionalApi[];
}

/**
 * A site's own build of the lazy chunks (docs/project-unite/architecture.md §3.2): its entries, cut by its own plan of
 * layers, written under its own folder and exposed to its own pages only (a `web_accessible_resources` entry per
 * site). The sites share source, never a build: another site's entries never enter this one, so they never move a
 * byte of it; the price is the shared source twice in the XPI (apps/extension/lazy/vite.config.ts).
 */
export interface HostLazyBuild {
  /** The folder inside the extension: `<root>/<entry>.js`, the shared chunks in `<root>/chunks/`. The site's tab loads from it. */
  readonly root: string;
  /** Entry name → its source, relative to apps/extension/lazy. In the build's input order. */
  readonly entries: Readonly<Record<string, string>>;
  /**
   * The entries every tab of the site loads, in their order: each one layer of code, the first one the dock. [] — no layers: the bundler cuts the build by itself.
   */
  readonly layers: readonly string[];
  /** The layers that load before the dock or without it: what the dock shares with one of them is the kernel chunk. */
  readonly beforeTheDock: readonly string[];
}

/** A lazy build as the extension build makes it: a site's of the registry (./index.ts), with the pages that may load it. */
export interface LazySite {
  /** The site's kind: the chunk list and the size report name the build by it. */
  readonly site: string;
  readonly build: HostLazyBuild;
  /** The pages that may load its files (its `web_accessible_resources` entry): the site's pages, its stand in a test build. */
  readonly matches: readonly string[];
  /** R20 P9c: the site's relay page, web-accessible in the same entry (its pages frame it); absent — none. */
  readonly relayPage?: string;
}


/** `node tools/host-contract-check/index.ts --host <kind>`: the site's contract against a local copy of its bundles. */
export interface HostContractCheck {
  /** The module naming every string the site's adapter relies on (repo-relative). */
  readonly module: string;
  /** The environment variable naming the root of the local copies of the site's bundles: the path never enters the repository. */
  readonly bundlesRootEnv: string;
}

/** What of the site's own code must never ship (tools/archive-check). */
export interface HostArchiveMarkers {
  /** Its code: its bundles' chunk names, a research copy's folder, its framework's fingerprints in a saved page. */
  readonly code: readonly RegExp[];
  /**
   * Libraries only its app carries. Never in the XPI; in the sources archive only the testing package manifest and
   * the lockfile may name them (the site's stand imitates it with them).
   */
  readonly libraries: readonly RegExp[];
}

/** What a TEST build changes for the site (architecture.md §13). A release build carries none of it. */
export interface TestHostConfig {
  /**
   * Where the site's loopback stand is served: the site's scripts also run there, and its tabs are taken as the site's.
   * One loopback name per site — an address two sites claim is refused by the background. Granted the way the site's
   * own pages are: at install for a required site, on request for an optional one (build/manifest.ts).
   */
  readonly pageMatches: readonly string[];
}

/**
 * The site's background chunk (docs/project-unite/architecture.md §3.3): its services in the background, out of the
 * core — its own Vite build (apps/extension/bg/vite.config.ts), loaded by the core when the site needs it.
 */
export interface HostBackground {
  /** The chunk's module, relative to apps/extension (`bg/<site>.ts`); its default export is the site's module. */
  readonly source: string;
  /** The built file inside the extension (`bg/<site>.js`): the core loads it with `import(runtime.getURL(file))`. */
  readonly file: string;
}

export interface HostDescriptor extends RuntimeHostRow {
  readonly kind: HostKind;
  readonly platform: Platform;
  readonly scripts: HostScripts;
  /** The site's own build of the lazy chunks. */
  readonly lazy: HostLazyBuild;
  readonly permissions: HostPermissions;
  /** The site's background chunk; absent — everything the site needs in the background is the core's. */
  readonly background?: HostBackground;
  /**
   * R20 P9c: the site's relay page (`<page>.html` at the extension's base), framed by its tabs for «… через вкладку»
   * (architecture.md §8.5): web-accessible to the site's pages alone, the core's `cg-relay` port takes it. Absent — none.
   */
  readonly relayPage?: string;
  /** Folders whose modules run in the page's own world: every callback they hand the page goes through `guard` (tools/gates). */
  readonly mainWorldSources: readonly string[];
  readonly contractCheck: HostContractCheck;
  readonly archiveMarkers: HostArchiveMarkers;
  readonly test: TestHostConfig;
}
