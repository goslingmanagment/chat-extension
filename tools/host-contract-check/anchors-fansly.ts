// Fansly's anchor set for the host contract check (docs/project-unite/
// architecture.md §7.12; FS-CTR-1, FS-CTR-3; R20 P7h): for every anchor of
// Fansly's contract report (`FANSLY_ANCHOR_IDS`), the strings a copy of
// fansly.com's bundle must show for the adapter to find that anchor on a page.
// They are the adapter's own: the selectors of its isolated side
// (`FANSLY_SELECTORS`), the socket host and API origin its MAIN watches
// (`FANSLY_NETWORK`), the addresses of MAIN's response table and the numbers
// of the socket envelope MAIN reads — the last two written here and pinned to
// `classifyAddress` and `readFrame` by anchors-fansly.test.ts. Fansly is an
// Angular app (spec §5.6): the set leans on `app-*` tags and the classes of
// templates, the relations of nodes, API paths and fields and the envelope's
// numbers — never on minified names, `ng.*` or the fields of services.
//
// A string, in the prettified copy (`pretty/`: lines matter):
// - a component — its Angular definition, `selectors: [["app-…"]]`;
// - a class — a word of a string literal of a template (`[1, "send-button"]`,
//   `"class", "no-dm-allowed …"`), never a part of a longer class;
// - «in <component>» — found in that component's part of the file only: after
//   the end of the definition of the component before it, up to the end of
//   its own (its template functions stand above its definition; its consts
//   and its template are in it). That is how «the composer is in the
//   container» and «the send button is the composer's» are read without a
//   single minified name;
// - an address or a number — as the page's code writes it.
//
// Only the app's own code is read: `main.<hash>.js` and its lazy chunks
// (`<n>.<hash>.js`). The global scripts (third-party libraries), the
// polyfills, the runtime, the service worker and the styles are left out: a
// library's `new XMLHttpRequest()` says nothing of the app.
//
// The check's report is the adapter's own (`buildFanslyReport`), made as for a
// page of this build in which every anchor is what the copy shows; check.ts
// `verdictOf` reads it by Fansly's expected set (`FANSLY_CONTRACT`, the reader
// of the tab's log: `contractFactsOf`) and by the strict branch of its report.
// An anchor this set has no string for is `missing` there, never «nothing to
// check».
//
// It prints names, lines and hashes — never Fansly's code. Local only: the
// copies of Fansly's bundles stay outside the repository (docs/research/
// fansly.md says where they are); CI checks a synthetic copy instead.

import { FANSLY_NETWORK } from '../../apps/extension/src/hosts/runtime/fansly.ts';
import { FANSLY_ANCHOR_IDS, type FanslyAnchorId } from '../../packages/contracts/src/fansly.ts';
import { FANSLY_CONTRACT, FanslyContractReportSchema, type FanslyContractReport } from '../../packages/contracts/src/fansly-host.ts';
import { DOM_ANCHORS, FANSLY_SELECTORS, type DomAnchorStates } from '../../packages/host-fansly/src/isolated/anchors.ts';
import { FANSLY_ADAPTER_VERSION, buildFanslyReport, buildOf } from '../../packages/host-fansly/src/isolated/contract.ts';
import type { ResponseKind } from '../../packages/host-fansly/src/main/responses.ts';
import { anchorStates, checkAnchors, escape, literal, verdictOf, type Anchor, type AnchorResult, type BundleFile, type ContractVerdict, type SiteContract } from './check.ts';

/** What Fansly's report is read by (check.ts `verdictOf`). */
export const FANSLY_SITE: SiteContract = { kind: 'fansly-web', shape: FANSLY_CONTRACT, strict: FanslyContractReportSchema };

/** The app's own scripts: `main.<hash>.js` and its lazy chunks `<n>.<hash>.js`. */
const APP_SCRIPT = /^(?:main|\d+)\.[0-9a-f]{8,32}\.js$/;

/** Whether a file of the copy is the app's own code (the rest is not read). */
export function isAppScript(name: string): boolean {
  return APP_SCRIPT.test(name);
}

/** The first segment of a conversation's address (route.ts, FS-RTE-1: `/messages/<groupId>`). */
export const CHAT_ROUTE_PATH = 'messages';

/** Where the API's paths begin after its origin (MAIN's response table, responses.ts). */
export const API_PATH = '/api/v1';

/**
 * The addresses of MAIN's response table (responses.ts) as the page's code writes them: the start of the string it
 * builds the address from (`base + "/message?groupId=" + id`), or the whole string (`exact`). `sample` — an address of
 * that kind after the API path, which `classifyAddress` must give that kind (the test pins it). `me` is the creator's,
 * the anchor `accountMe`; the rest are the anchor `xhr`.
 */
export const RESPONSE_ADDRESSES: ReadonlyArray<{ readonly kind: ResponseKind; readonly written: string; readonly exact: boolean; readonly sample: string }> = [
  { kind: 'history', written: '/message?groupId=', exact: false, sample: '/message?groupId=7&limit=25' },
  { kind: 'older', written: '&before=', exact: false, sample: '/message?groupId=7&before=9&limit=25' },
  { kind: 'receipt', written: '/message', exact: true, sample: '/message' },
  { kind: 'byIds', written: '/messages?ids=', exact: false, sample: '/messages?ids=7' },
  { kind: 'unread', written: '/message/unread', exact: false, sample: '/message/unread' },
  { kind: 'group', written: '/group/', exact: true, sample: '/group/7/' },
  { kind: 'groups', written: '/messaging/groups', exact: false, sample: '/messaging/groups?sortOrder=1' },
  { kind: 'me', written: '/account/me', exact: true, sample: '/account/me' },
  { kind: 'accounts', written: '/account?ids=', exact: false, sample: '/account?ids=7' },
  { kind: 'automated', written: '/message/automated', exact: false, sample: '/message/automated' },
  { kind: 'vault', written: '/vault/albums/media', exact: true, sample: '/vault/albums/media' },
];

/** The socket envelope `{t, d}` MAIN reads (frame-parse.ts; the test pins the numbers to `readFrame`). */
export const FRAME_ENVELOPE = { service: 10_000, package: 10_001 } as const;
/** The services of `t:10000` MAIN reads, by the names of the page's own table of service ids. */
export const FRAME_SERVICES = { MessageService: 5, GroupService: 4, FollowerService: 3 } as const;
/** The version of the socket's protocol the page asks for: another one may bring other frames. */
export const SOCKET_VERSION = '?v=3';

// ── How a string is looked for ─────────────────────────────────────────────

const QUOTE = '["\'`]';
/** An Angular component's definition: `selectors: [["<tag>"]]`; group 1 — the tag. */
const DEFINITION = /selectors:\s*\[\[\s*["'`]([^"'`]+)["'`]/;
const definition = (tag: string): RegExp => new RegExp(`selectors:\\s*\\[\\[\\s*${QUOTE}${escape(tag)}${QUOTE}`);
/** A class of a template: a word of a string literal (`"message-input"`, `"class", "a message-input b"`). */
const templateClass = (name: string): RegExp => new RegExp(`${QUOTE}(?:[^"'\`]*\\s)?${escape(name)}(?:\\s[^"'\`]*)?${QUOTE}`);
/** The start of a string literal: the address the page builds from it. */
const startOf = (value: string): RegExp => new RegExp(`${QUOTE}${escape(value)}`);
/** Its written forms: `10000` the minifier writes `1e4`. */
const numberForms = (value: number): string => [...new Set([String(value), value.toExponential().replace('e+', 'e')])].map(escape).join('|');
/** A number the code compares with: `1e4 === t`, `t === 10001`, `case 5:`. */
const compared = (value: number): RegExp => new RegExp(`(?:[=!]==?|\\bcase)\\s*(?:${numberForms(value)})(?![\\w$.])|(?<![\\w$.])(?:${numberForms(value)})\\s*[=!]==?`);
/** A key of an object literal with its number: `MessageService: 5`. */
const keyed = (key: string, value: number): RegExp => new RegExp(`(?<![\\w$])${escape(key)}\\s*:\\s*(?:${numberForms(value)})(?![\\w$.])`);
/** A class the code puts on a node of the document: the node and the class on one line. */
const classOn = (node: RegExp, name: string): RegExp => new RegExp(`${node.source}.*${QUOTE}${escape(name)}${QUOTE}`);

/** A component's definition in a file: its tag, the line it begins on and the last line of it. */
interface Definition {
  readonly tag: string;
  readonly line: number;
  readonly end: number;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * Every component definition of a file (a cache per file of one `checkAnchors`). A definition goes on, in the
 * prettified copy, over the lines indented as deep as its first one or deeper — its view queries, its consts, its
 * template — up to the line that closes it, and never into the next definition.
 */
const definitions = new WeakMap<readonly string[], readonly Definition[]>();
function definitionsOf(lines: readonly string[]): readonly Definition[] {
  let found = definitions.get(lines);
  if (found === undefined) {
    const list: Definition[] = [];
    lines.forEach((line, index) => {
      const tag = DEFINITION.exec(line)?.[1];
      if (tag === undefined) return;
      const indent = indentOf(line);
      let end = index;
      for (let next = lines[end + 1]; next !== undefined && !DEFINITION.test(next) && (next.trim() === '' || indentOf(next) >= indent); next = lines[end + 1]) end += 1;
      list.push({ tag, line: index, end });
    });
    definitions.set(lines, (found = list));
  }
  return found;
}

/**
 * A line counts only in the component `tag`'s part of the same file: after the end of the definition before it, up
 * to the end of its own — its template functions above it, its definition with its consts and its template.
 */
const within =
  (tag: string) =>
  (lines: readonly string[], index: number): boolean => {
    const list = definitionsOf(lines);
    return list.some((item, at) => item.tag === tag && index > (list[at - 1]?.end ?? -1) && index <= item.end);
  };

/** The classes a selector names: `div.message-composer.hidden` → message-composer, hidden. */
const classesIn = (selector: string): string[] => [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1] ?? '');
/** The one class a selector of the adapter names (the first): the anchor's own. */
const classIn = (selector: string): string => classesIn(selector)[0] ?? selector;
/** The tag a selector names first: `app-media-upload-input input[type=file]` → app-media-upload-input. */
const tagIn = (selector: string): string => /^[a-z][\w-]*/.exec(selector.trim())?.[0] ?? selector;
/** The tag of a selector's last part: `.collapsable-actions > input[type=file]` → input. */
const lastTagIn = (selector: string): string => /(?:^|[\s>])([a-z][\w-]*)(?=[^\s>]*$)/.exec(selector.trim())?.[1] ?? selector;

// ── The set ────────────────────────────────────────────────────────────────

const S = FANSLY_SELECTORS;
const route = S.conversationRoute;
const container = S.container;
const composer = S.composer;

const component = (group: FanslyAnchorId, tag: string): Anchor => ({ id: `component ${tag}`, group, pattern: definition(tag) });
/** A tag that stands in the template of a component: `childIn(…, composer, container)` — the composer is in the container. */
const childIn = (group: FanslyAnchorId, tag: string, parent: string): Anchor => ({ id: `${tag} in ${parent}`, group, pattern: literal(tag), confirm: within(parent) });
const classOf = (group: FanslyAnchorId, name: string, parent?: string): Anchor => ({
  id: parent === undefined ? `class ${name}` : `class ${name} in ${parent}`,
  group,
  pattern: templateClass(name),
  ...(parent === undefined ? {} : { confirm: within(parent) }),
});
/** `input[type=file]` of a component's template (the selector's last part): the tag and the attribute pair of its consts. */
const fileInputIn = (group: FanslyAnchorId, selector: string, parent: string): Anchor[] => [
  childIn(group, lastTagIn(selector), parent),
  { id: `type=file in ${parent}`, group, pattern: new RegExp(`${QUOTE}type${QUOTE}\\s*,\\s*${QUOTE}file${QUOTE}`), confirm: within(parent) },
];
const address = (group: FanslyAnchorId, entry: (typeof RESPONSE_ADDRESSES)[number]): Anchor => ({
  id: `api ${entry.written}${entry.exact ? '' : '…'} (${entry.kind})`,
  group,
  pattern: entry.exact ? literal(entry.written) : startOf(entry.written),
});

/**
 * Fansly's anchor set: every string with the contract anchor it proves (`group`). An anchor is present in the copy
 * when every one of its strings is.
 */
export function fanslyAnchors(): Anchor[] {
  return [
    // The conversation's route, the way the isolated side finds it: content-wrapper > messages-content-wrapper > route.
    component('conversationRoute', route),
    { id: `route path ${CHAT_ROUTE_PATH}`, group: 'conversationRoute', pattern: new RegExp(`path:\\s*${QUOTE}${CHAT_ROUTE_PATH}${QUOTE}`) },
    classOf('conversationRoute', S.contentWrapper),
    classOf('conversationRoute', S.messagesWrapper),
    // The chain of the field: route > container > composer > textarea.message-input.
    component('container', container),
    childIn('container', container, route),
    component('composer', composer),
    childIn('composer', composer, container),
    childIn('textarea', tagIn(S.textarea), composer),
    classOf('textarea', classIn(S.textarea), composer),
    classOf('sendButton', classIn(S.sendButton), composer),
    classOf('fileInput', classIn(S.fileInput), composer),
    ...fileInputIn('fileInput', S.fileInput, composer),
    // The header of the route and its contact block.
    classOf('headerContact', classIn(S.header), route),
    classOf('headerContact', classIn(S.headerContact), route),
    classOf('headerSubRow', classIn(S.headerSubRow), route),
    classOf('attachments', classIn(S.attachments), composer),
    // The DM rules unmet: the composer's branch, and the field's branch it hides.
    classOf('noDmAllowed', classIn(S.noDmAllowed), composer),
    classOf('noDmAllowed', classIn(S.composerHidden), composer),
    // The page's flags: the modal's on <body>, the theme on <html>.
    { id: `class ${S.modalFlag} on <body>`, group: 'modalFlag', pattern: classOn(/document\.body\b/, S.modalFlag) },
    ...S.themeClasses.map((name): Anchor => ({ id: `class ${name} on <html>`, group: 'themeClass', pattern: classOn(/document\.(?:documentElement|body\.parentElement)\b/, name) })),
    // The vault's upload: its component with its file input, and the vault page's address.
    component('vaultUpload', tagIn(S.vaultUpload)),
    ...fileInputIn('vaultUpload', S.vaultUpload, tagIn(S.vaultUpload)),
    { id: `route link ${S.vaultPath}`, group: 'vaultUpload', pattern: literal(S.vaultPath) },
    // The network, MAIN's: the creator's address, the page's socket and its frames, the API by XHR.
    ...RESPONSE_ADDRESSES.filter((entry) => entry.kind === 'me').map((entry) => address('accountMe', entry)),
    ...FANSLY_NETWORK.socketHosts.map((host): Anchor => ({ id: `socket url wss://${host}`, group: 'socket', pattern: startOf(`wss://${host}`) })),
    { id: 'new WebSocket() — the global, taken at construction', group: 'socket', pattern: /(?<![\w$.])new\s+WebSocket\s*\(/ },
    { id: `envelope t ${FRAME_ENVELOPE.service} (a service event)`, group: 'frames', pattern: compared(FRAME_ENVELOPE.service) },
    { id: `envelope t ${FRAME_ENVELOPE.package} (a package of frames)`, group: 'frames', pattern: compared(FRAME_ENVELOPE.package) },
    ...Object.entries(FRAME_SERVICES).map(([name, id]): Anchor => ({ id: `service ${name} = ${id}`, group: 'frames', pattern: keyed(name, id) })),
    { id: 'the service event is one more JSON string: JSON.parse(….event)', group: 'frames', pattern: /JSON\.parse\(\s*[\w$.]+\.event\s*\)/ },
    { id: `socket protocol ${SOCKET_VERSION}`, group: 'frames', pattern: startOf(SOCKET_VERSION) },
    { id: 'new XMLHttpRequest() — the HTTP client', group: 'xhr', pattern: /(?<![\w$.])new\s+XMLHttpRequest\s*\(/ },
    { id: 'JSON answers read as text: responseType "text"', group: 'xhr', pattern: new RegExp(`\\.responseType\\s*=.*${QUOTE}text${QUOTE}`) },
    { id: 'the envelope {success, response}', group: 'xhr', pattern: /\.success\s*\?.*\.response(?![\w$])/ },
    ...FANSLY_NETWORK.apiOrigins.map((origin): Anchor => ({ id: `api base ${origin}${API_PATH}`, group: 'xhr', pattern: startOf(`${origin}${API_PATH}`) })),
    ...RESPONSE_ADDRESSES.filter((entry) => entry.kind !== 'me').map((entry) => address('xhr', entry)),
  ];
}

// ── The copy's build and its report ────────────────────────────────────────

/**
 * Fansly's build of a copy by the adapter's own rule (`buildOf`, FS-CTR-3: the hashed name of its `main` bundle, the
 * `build` of its report and of `client_health`): the copy's scripts stand for the page's `<script src>`.
 */
export function fanslyBuildOf(fileNames: readonly string[]): string | null {
  const scripts = fileNames.map((name) => ({ src: `https://copy.invalid/${name}` }));
  return buildOf({ scripts } as unknown as Parameters<typeof buildOf>[0]);
}

/**
 * The adapter's report for a page of this build (`buildFanslyReport`): MAIN there and observing, every anchor as the
 * copy shows it — the anchors the strings name; one they do not name is `missing`.
 */
export function fanslyReportOf(results: readonly AnchorResult[], build: string | null, checkedAt: number): FanslyContractReport {
  const named = anchorStates(results);
  const state = (anchor: FanslyAnchorId): 'ok' | 'missing' => named[anchor] ?? 'missing';
  const dom = Object.fromEntries(DOM_ANCHORS.map((anchor) => [anchor, state(anchor)])) as DomAnchorStates;
  return buildFanslyReport({
    bridge: true,
    wire: { anchors: { accountMe: state('accountMe'), socket: state('socket'), frames: state('frames'), xhr: state('xhr') }, tap: 'ok' },
    creator: state('accountMe') === 'ok',
    observation: 'ready',
    dom,
    build,
    adapterVersion: FANSLY_ADAPTER_VERSION,
    checkedAt,
  });
}

export interface FanslyCheck {
  readonly build: string | null;
  /** Every string of the set, in its order: present or missing, with its first places. */
  readonly strings: readonly AnchorResult[];
  /** Every anchor of Fansly's expected set, in its order: `ok` or `missing`. */
  readonly anchors: ReadonlyArray<{ readonly anchor: FanslyAnchorId; readonly state: 'ok' | 'missing' }>;
  readonly report: FanslyContractReport;
  readonly verdict: ContractVerdict;
}

/** The check of a copy: its app's scripts against the set, the report the adapter would make, its verdict. */
export function checkFanslyCopy(files: readonly BundleFile[], checkedAt: number, anchors: readonly Anchor[] = fanslyAnchors()): FanslyCheck {
  const build = fanslyBuildOf(files.map((file) => file.name));
  const strings = checkAnchors(
    files.filter((file) => isAppScript(file.name)),
    anchors,
  );
  const named = anchorStates(strings);
  const report = fanslyReportOf(strings, build, checkedAt);
  return { build, strings, anchors: FANSLY_ANCHOR_IDS.map((anchor) => ({ anchor, state: named[anchor] ?? 'missing' })), report, verdict: verdictOf(report, FANSLY_SITE) };
}
