// Fansly's static tripwires (R20 P7h, architecture §7.12). The copy stays outside Git; this module knows only the
// adapter's selectors and public protocol names, never copied implementation. Presence is a signal for review,
// not proof of the DOM hierarchy, live traffic or the Firefox bridge. Those have the stand and pilot checks.

import { FANSLY_CONTRACT } from '../../packages/contracts/src/fansly-host.ts';
import type { FanslyAnchorId } from '../../packages/contracts/src/fansly.ts';
import { FANSLY_SELECTORS as selectors } from '../../packages/host-fansly/src/isolated/anchors.ts';
import type { Anchor, BundleFile } from './check.ts';

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const literal = (value: string): RegExp => new RegExp(`(["'\x60])${escape(value)}\\1`);
// Angular writes classes as individual literals or as space-separated class attributes. A CSS suffix, a longer
// class (message-input-container), or text outside quotes is not the class the adapter needs.
const classToken = (value: string): RegExp => new RegExp(`(["'\x60])(?:[\\w-]+\\s+)*${escape(value)}(?:\\s+[\\w-]+)*\\1`);
const cssClass = (selector: string): string => selector.slice(selector.lastIndexOf('.') + 1);
type Probe = readonly [name: string, pattern: RegExp];
const tag = (value: string): Probe => [value, literal(value)];
const cls = (value: string): Probe => [value, classToken(cssClass(value))];
// Application entry and numbered lazy chunks only: vendor assets, the service worker and CSS cannot stand in for
// the page's API/socket/DOM code (the snapshot carries chart and video libraries with their own requests/events).
const APPLICATION_FILE = /(?:^|\/)(?:main|\d+)\.[0-9a-f]{8,32}\.js$/;

/** Several tripwires may support one report anchor; all must be present, including the optional vault's. */
const PROBES = {
  conversationRoute: [tag(selectors.conversationRoute), cls(selectors.contentWrapper), cls(selectors.messagesWrapper)],
  container: [tag(selectors.container)],
  composer: [tag(selectors.composer), ...selectors.composerHidden.split('.').slice(1).map(cls)],
  textarea: [tag(selectors.textarea.split('.')[0] ?? ''), cls(selectors.textarea)],
  sendButton: [cls(selectors.sendButton)],
  fileInput: [cls(selectors.fileInput.split(' > ')[0] ?? ''), tag('input'), ['type=file', /(["'])type\1\s*,\s*(["'])file\2/]],
  headerContact: [cls(selectors.header), cls(selectors.headerContact)],
  headerSubRow: [cls(selectors.headerSubRow)],
  attachments: [cls(selectors.attachments)],
  noDmAllowed: [cls(selectors.noDmAllowed)],
  modalFlag: [cls(selectors.modalFlag)],
  themeClass: selectors.themeClasses.map(cls),
  vaultUpload: [tag(selectors.vaultUpload.split(' ')[0] ?? ''), tag('input'), ['type=file', /(["'])type\1\s*,\s*(["'])file\2/]],
  accountMe: [tag('/account/me')],
  socket: [tag('wss://wsv3.fansly.com'), tag('?v=3'), ['WebSocket constructor', /\bnew\s+WebSocket\s*\(/]],
  frames: [tag('EventWrapper'), tag('ServiceEvent'), ['JSON decoder', /\bJSON\.parse\s*\(/], ['serviceId', /\.serviceId\b/], ['event payload', /\.event\b/]],
  xhr: [['XMLHttpRequest constructor', /\bnew\s+XMLHttpRequest\s*\(/], tag('/message'), tag('/group')],
} satisfies Record<FanslyAnchorId, readonly Probe[]>;

/** Read the expected contract, never a subset supplied by the snapshot or report. */
export function fanslyAnchors(): Anchor[] {
  return FANSLY_CONTRACT.anchors.flatMap((group) => {
    const probes = PROBES[group as FanslyAnchorId];
    if (probes === undefined) throw new Error(`host-contract-check: no Fansly probes for ${group}`);
    return probes.map(([name, pattern]) => ({ id: `${group}: ${name}`, group, pattern, filePattern: APPLICATION_FILE }));
  });
}

/** Same main.<hash> fingerprint the adapter reports; ambiguous copies never pick an arbitrary build. */
export function fanslyBuildOf(files: readonly BundleFile[]): string | null {
  const builds = new Set(files.flatMap(({ name }) => /(?:^|\/)(main\.[0-9a-f]{8,32})\.js$/.exec(name)?.[1] ?? []));
  return builds.size === 1 ? [...builds][0] ?? null : null;
}
