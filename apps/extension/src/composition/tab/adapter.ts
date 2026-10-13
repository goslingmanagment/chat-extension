// The host adapter (docs/project-unite/architecture.md §1.3): what a site
// gives the tab's composition, so that the tab works on the shared HostPort
// and never names a site. A site's entry point assembles its adapter from its
// host package's starter and hands it to `composeTab(env, adapter)`; every
// bundle carries exactly one adapter — the choice is made at build time, so
// the code of another site never reaches it.
//
// The adapter comes in two halves, by when the tab needs them (§1.3):
// - `HostAdapter`, the early half, in the site's isolated content script: the
//   start of its host at document_start (the bridge to MAIN, the mount layers,
//   the theme, the HostPort), the page side of the early key dispatcher, and
//   where the site's own lazy build lies;
// - `HostAppAdapter`, the application's half, in the site's `tab-app` chunk:
//   what only the application calls — the bootstrap's switches of the site's
//   host port (`configure`) and the site's slice of the feature manifest
//   (`features`, §1.4). Its code would weigh on every page at
//   document_start for nothing: ChatSpace's `liveConfigOf` brings the flag
//   rules of the bootstrap along, ≈ 2 KiB gzip, against the early bundle's
//   ≈ 0.55 KiB of headroom (§3.2).
//
// Types only. The mount layers, the shadow-root registry and the theme reader
// are the shared machinery of our closed hosts (host-kit, P5); the tab reads
// them through the structural types below, so it imports no site package.

import type { CgCode } from '@cg/contracts/errors';
import type { FeatureSlice } from '@cg/contracts/features/types';
import type { HostPort, HostTheme, MountPoints } from '@cg/contracts/host';
import type { HostKind } from '@cg/contracts/hosts';
import type { Bootstrap } from '@cg/contracts/hub';
import type { SendFuseState } from '@cg/contracts/send';
import type { KeyOwnership } from '@cg/core/application/hotkeys';
import type { RouteKind } from '@cg/core/domain/hotkeys';

import type { LazyEntryName } from '../../../lazy/entries/names';

/** What the browser gives a site's isolated content script. */
export interface TabEnv {
  readonly win: Window;
}

/** Spends one action token for one write (`token.redeem`, §14); false — not spent, nothing is written. */
export type TokenRedeemer = (request: { readonly kind: 'insert' | 'navigate'; readonly actionToken: string; readonly intentId: string }) => Promise<boolean>;

/** What a site's host tells the tab's log: events, codes and counts, never a text of a draft, message or prompt. */
export interface HostDiagnostic {
  readonly event: string;
  readonly code?: CgCode;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
  readonly count?: number;
}

/** What the tab hands a site's host as it starts it (synchronously, at document_start). */
export interface HostStartEnv extends TabEnv {
  readonly redeem: TokenRedeemer;
  /** A chunk of the site's own lazy build by its entry name, one retry (EX-009): the bridge's schemas, for one. */
  readonly lazy: <T>(entry: LazyEntryName) => Promise<T>;
  /** Bootstrap `limits.navInsertTimeoutSec` × 1000 once a bootstrap arrived; read at each «Открыть и вставить». */
  readonly navInsertTimeoutMs: () => number | undefined;
  readonly onDiagnostic: (diagnostic: HostDiagnostic) => void;
}

/** A layer of our overlay hosts (§6.3 «Слои»): side panels, windows, toasts. */
export type OverlayLayer = 'panel' | 'modal' | 'toast';

/** One of our hosts in the page and its closed shadow root. */
export interface ClosedHost {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
}

/** Our hosts and their closed roots (§9.1): how the keys and the gate learn that an event came from our UI. */
export interface ShadowRegistry {
  rootOf(host: Element): ShadowRoot | null;
  /** Our host the event passed through, or null. */
  hostOf(event: Event): Element | null;
  /** The element focused inside one of our roots, or null. */
  focusedInside(doc: Document): Element | null;
  hosts(): readonly Element[];
}

/** The dock host and the overlay layers, as the tab mounts into them (§6.3). */
export interface HostMounts {
  /** The one dock host; it moves between composers and keeps its root. */
  readonly dock: ClosedHost;
  /** The overlay host of a layer, created on first use. */
  overlay(layer: OverlayLayer): ClosedHost;
  points(): MountPoints;
  onChange(listener: (points: MountPoints) => void): () => void;
  /** `data-dismissible-open` on a host while any owner keeps one of our windows open there (§6.3, §9.1). */
  setDismissibleOpen(target: 'dock' | OverlayLayer, owner: string, open: boolean): void;
  readonly registry: ShadowRegistry;
  dispose(): void;
}

/** The site's theme as its page shows it. */
export interface HostThemeSource {
  current(): HostTheme;
  onChange(listener: (theme: HostTheme) => void): () => void;
  dispose(): void;
}

/** The bridge to the site's MAIN world, as far as the tab's lifecycle and its e2e report need it. */
export interface HostBridge {
  probe(): Promise<unknown>;
  close(): void;
}

/** A site's host as `start` brought it up: at once the mount layers and the theme, later the bridge and the port. */
export interface StartedHost<P extends HostPort = HostPort> {
  /** Our hosts of a dead instance (an update, a reinstall) the start took out of the page (UP-009). */
  readonly staleHosts: number;
  readonly mounts: HostMounts;
  readonly theme: HostThemeSource;
  /** The bridge once MAIN answered; null without MAIN. */
  readonly bridge: Promise<HostBridge | null>;
  /** The HostPort once the bridge is up (or known to be missing) and its first snapshot was taken. */
  readonly host: Promise<P>;
}

/** The route by the address alone (§9.1): `epoch` is the path, so a kept key runs only where it was pressed. */
export interface RouteKey {
  readonly kind: RouteKind;
  readonly epoch: string;
}

/**
 * The site's own lazy build (§3.2) and what the tab loads of it. Every chunk is `<root>/<entry>.js`: the host's
 * start loads `bridge-validation` with MAIN's first frame; the early bundle loads `tab-protocol` and `tab-app` —
 * the site's application with its half of the adapter — with the first place for the dock, the first key of ours
 * or the first page command (EX-011, HK-024); the application loads the rest by name. The entries of every site's
 * build carry the same names.
 */
export interface HostLazyPlan {
  readonly root: string;
}

/** The early half of a site's adapter: in the site's isolated content script, used from document_start. */
export interface HostAdapter<P extends HostPort = HostPort> {
  readonly kind: HostKind;
  /** Brings the site's host up: the mount layers and the theme at once, the bridge to MAIN and the HostPort behind them. */
  start(env: HostStartEnv): StartedHost<P>;
  /** Whose field has the focus and whether a window of the site itself is open: the early key dispatcher's port (§9.1). */
  keyProbe(doc: Document, roots: ShadowRegistry): KeyOwnership;
  /** Marks the dock host while a key of ours waits for the lazy part (HK-024): the one sign of it that early. */
  keyPending(dock: Element): (waiting: boolean) => void;
  /** The route by the address, for a key pressed before the host reported one. */
  routeOfLocation(location: Pick<Location, 'pathname'>): RouteKey;
  readonly lazy: HostLazyPlan;
}

/**
 * The application's half of a site's adapter: in the site's `tab-app` chunk, loaded with the application. `C` is
 * what the site's host port takes from the bootstrap (ChatSpace: `ChatSpaceLiveConfig`, its part B).
 */
export interface HostAppAdapter<P extends HostPort = HostPort, C = unknown> {
  /**
   * What the bootstrap and the browser's X8 fuse (decision X25; null — not read yet) switch in the site's host port.
   * `bootstrap` null — nobody is signed in: the owner's switches went with the sign-in.
   */
  liveConfigOf(bootstrap: Bootstrap | null, fuse: SendFuseState | null): C;
  /** Applies it to the port; the tab applies only a value that differs from the last one. */
  configure(host: P, config: C): Promise<unknown>;
  /**
   * The site's slice of the feature manifest (§1.4): which features exist on this site and what each needs —
   * the dock's chips, the cheatsheet's rows and every admission of the tab read it.
   */
  readonly features: FeatureSlice;
}
