// The host contract check of Fansly (R20 P7h) on a synthetic «bundle copy»:
// no Fansly code here — each string written the way the 2026-10-12 build of
// fansly.com writes it (a component's definition, a template's consts, an
// address, a number), names only. The real copies live outside the
// repository; the last test reads the 2026-10-12 one only on a machine that
// has it ($CG_FANSLY_BUNDLES, docs/research/fansly.md), and CI skips it.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FANSLY } from '../../apps/extension/src/hosts/fansly.ts';
import { FANSLY_NETWORK } from '../../apps/extension/src/hosts/runtime/fansly.ts';
import { FANSLY_ANCHOR_IDS, type FanslyAnchorId } from '../../packages/contracts/src/fansly.ts';
import { FANSLY_CONTRACT, FanslyContractReportSchema } from '../../packages/contracts/src/fansly-host.ts';
import { FANSLY_SELECTORS } from '../../packages/host-fansly/src/isolated/anchors.ts';
import { buildOf } from '../../packages/host-fansly/src/isolated/contract.ts';
import { groupIdOfPath } from '../../packages/host-fansly/src/isolated/route.ts';
import { readFrame } from '../../packages/host-fansly/src/main/frame-parse.ts';
import { classifyAddress, type ResponseKind } from '../../packages/host-fansly/src/main/responses.ts';
import {
  API_PATH,
  CHAT_ROUTE_PATH,
  FANSLY_SITE,
  FRAME_ENVELOPE,
  FRAME_SERVICES,
  RESPONSE_ADDRESSES,
  SOCKET_VERSION,
  checkFanslyCopy,
  fanslyAnchors,
  fanslyBuildOf,
  isAppScript,
} from './anchors-fansly.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { verdictOf, type BundleFile } from './check.ts';

const CHECKED_AT = 1_790_000_000_000;
const MAIN = 'main.0123456789abcdef.js';
const S = FANSLY_SELECTORS;

/**
 * A component as the prettified build writes it: its template functions above, then its definition in a module's
 * function — the consts on its first line, the template's body indented deeper — and the line that closes it.
 */
const component = (tag: string, consts: string, options: { readonly before?: readonly string[]; readonly template?: string } = {}): string[] => [
  ...(options.before ?? []).map((line) => `  ${line}`),
  '  let C = (() => {',
  `    return o.cmp = e.VBU({ type: o, selectors: [["${tag}"]], consts: [${consts}], template: function(t, n) {`,
  `      ${options.template ?? '1 & t && e.nrm(0, "div");'}`,
  '    } }), o;',
  '  })();',
];

/**
 * The page socket's module as the build writes it (main:27417-27593 of the 2026-10-12 copy): the socket's service with its
 * address and the protocol's version, and the event service with its decoder of the envelope `{t, d}` and its table of
 * service ids.
 */
const SOCKET_SERVICE: readonly string[] = [
  '}, 1779: (o, s, i) => {',
  '  let G = (() => {',
  '    class W {',
  '      constructor() {',
  '        this.websocketUri_ = g.c.websocketUrl + "?v=3", this.ready_ = false;',
  '      }',
  '    }',
  '    return W;',
  '  })();',
  '  let p = (() => {',
  '    var C;',
  '    class S {',
  '      handleText(m) {',
  '        var O = this.decodeMessage("EventWrapper", m);',
  '        const t = O.t;',
  '        if (0 === t) this.handleErrorEvent(this.decodeMessage("ErrorEvent", O.d));',
  '        else if (1e4 === t) this.handleServiceEvent(this.decodeMessage("ServiceEvent", O.d));',
  '        else if (10001 === t) {',
  '          let T = O.d || [];',
  '          for (let R = 0; R < T.length; ++R) this.handleText(T[R]);',
  '        }',
  '      }',
  '    }',
  '    return (C = S).ServiceIds = { INTERNAL: 1e3, PostService: 1, MediaService: 2, FollowerService: 3, GroupService: 4, MessageService: 5 }, S;',
  '  })();',
  '}, 1780: (o, s, i) => {',
];

/**
 * The app's main bundle with every string, as the prettified copy has them. The components stand in the build's
 * order, so «in <component>» reads as in the copy.
 */
function mainLines(): string[] {
  return [
    '  var env = { websocketUrl: "wss://wsv3.fansly.com", chatRoomWebsocketUrl: "wss://chat.example.test", apiBaseUrl: "https://apiv3.fansly.com/api/v1" };',
    '  this.con = new WebSocket(this.uri), this.con.onmessage = function(e) { x.text(e.data); };',
    ...SOCKET_SERVICE,
    '  handleServiceEvent(e) {',
    '    if (4 === e.serviceId) n = JSON.parse(e.event);',
    '    else if (5 === e.serviceId) {',
    '      if (1 == (n = JSON.parse(e.event)).type) this.messages([n.message]);',
    '    }',
    '  }',
    // The same numbers elsewhere: another socket's decoder (the chat rooms') and code that has nothing to do with frames.
    '  let n = function(r) {',
    '    var l = w.U.decodeMessage("EventWrapper", r);',
    '    const d = l.t;',
    '    if (1e4 === d) k = JSON.parse(w.U.decodeMessage("ServiceEvent", l.d).event);',
    '    else if (10001 === d) for (const f of l.d) n(f);',
    '  }, room = env.chatRoomWebsocketUrl + "?v=3";',
    '  e.Y8G("ngIf", 1 === i.type), e.R7$(), e.Y8G("ngIf", 10001 === i.type);',
    '  build() { return new XMLHttpRequest(); }',
    '  if (r.responseType) { const t = r.responseType.toLowerCase(); x.responseType = "json" !== t ? t : "text"; }',
    '  return b.success ? f(null, b.response) : f(b.error, null);',
    '  let q = new C.Kd("GET", this.base + "/account/me", { withCredentials: true });',
    '  U && (X += "&before=" + U), L && (X += "&limit=" + L);',
    '  let h = new C.Kd("GET", this.base + "/message?groupId=" + g + X, null);',
    '  let p = new C.Kd("POST", this.base + "/message", m);',
    '  let i = new C.Kd("GET", this.base + "/messages?ids=" + ids.join(","), null);',
    '  let u = new C.Kd("GET", this.base + "/message/unread", null);',
    '  let g = new C.Kd("GET", this.base + "/group/" + id + "/", null);',
    '  let l = new C.Kd("GET", this.base + "/messaging/groups?sortOrder=" + o, null);',
    '  let a = new C.Kd("GET", this.base + "/account?ids=" + ids.join(","), null);',
    '  let w = new C.Kd("GET", this.base + "/message/automated", null);',
    '  let v = new C.Kd("POST", this.base + "/vault/albums/media", { albumId: a, mediaIds: m });',
    '  this.renderer.addClass(document.body, "modal-opened");',
    '  "bright" === t ? (r.removeClass(document.body.parentElement, "dark-theme"), r.addClass(document.body.parentElement, "bright-theme")) : 0;',
    '  var nav = [["data-menu-item", "media-vault", "routerLink", "/creator/vault", 1, "nav-dropdown-item"]];',
    ...component('app-media-upload-input', '["fileInput", ""], ["multiple", "", "type", "file", 2, "display", "none"]', { template: '1 & t && e.j41(0, "input", 1, 0);' }),
    ...component('app-shell', '[1, "content-wrapper", 3, "ngClass"]'),
    ...component(
      'app-group-message-input',
      '[1, "message-attachments"], ["class", "no-dm-allowed dark-blue-1 flex-col", 4, "ngIf"], ["class", "message-composer flex-row", 3, "ngClass"], [1, "collapsable-actions"], ["multiple", "", "type", "file"], ["aria-label", "Message", 1, "message-input"], ["type", "button", 1, "send-button"]',
      { before: ['function Ti(o, s) { 1 & o && e.j41(0, "textarea", 5, 0); }', 'function Fi(o, s) { 1 & o && e.j41(0, "div", 6)(1, "input", 7, 1); }'] },
    ),
    ...component('app-group-message-container', '', { before: ['function Ci(o, s) { 1 & o && e.nrm(0, "app-group-message-input", 16); }'] }),
    ...component('app-messages-route', '[1, "messages-content-wrapper"]'),
    ...component('app-messages-conversation-route', '["class", "message-content-header border-color", 4, "ngIf"], [1, "message-content-header-contact"], [1, "content-header-sub-row"]', {
      template: '1 & t && e.DNE(0, aU, 12, 4, "div", 0)(1, YU, 1, 1, "app-group-message-container", 2);',
    }),
    ...component('app-messages-default-conversation-route', ''),
    '  var routes = [{ path: "messages", component: a, children: [{ path: "", component: b }, { path: ":groupId", component: c }] }];',
  ];
}

/** A copy as its `pretty/` folder has it: the app's main bundle and a lazy chunk, and files the check does not read. */
function fullCopy(main: readonly string[] = mainLines()): BundleFile[] {
  return [
    { name: MAIN, text: main.join('\n') },
    { name: '189.f0f0f0f0f0f0f0f0.js', text: 'var lazy = 1;' },
    { name: 'scripts.0a0a0a0a0a0a0a0a.js', text: 'var lib = new XMLHttpRequest(); lib.responseType = "text";' },
    { name: 'polyfills.0b0b0b0b0b0b0b0b.js', text: '' },
    { name: 'runtime.0c0c0c0c0c0c0c0c.js', text: '' },
    { name: 'styles.0d0d0d0d0d0d0d0d.css', text: '.send-button { color: blue; }' },
  ];
}

/** The copy with `edit` applied to the main bundle's text. */
const edited = (edit: (text: string) => string): BundleFile[] => fullCopy().map((file) => (file.name === MAIN ? { ...file, text: edit(file.text) } : file));
const missingOf = (files: readonly BundleFile[]): FanslyAnchorId[] => checkFanslyCopy(files, CHECKED_AT).anchors.filter((item) => item.state !== 'ok').map((item) => item.anchor);

/** Every kind of MAIN's response table (responses.ts): a kind the set has no address of fails to compile here. */
const RESPONSE_KINDS: Readonly<Record<ResponseKind, true>> = {
  history: true,
  older: true,
  receipt: true,
  byIds: true,
  unread: true,
  group: true,
  groups: true,
  me: true,
  accounts: true,
  automated: true,
  vault: true,
};

describe('[host:fansly] host-contract-check --host fansly (R20 P7h; FS-CTR-1, FS-CTR-3)', () => {
  it('[DB-031] the set covers Fansly’s expected set: strings for every anchor of FANSLY_CONTRACT, in its order, and for none other', () => {
    const groups = [...new Set(fanslyAnchors().map((anchor) => anchor.group))];
    expect(groups).toEqual([...FANSLY_ANCHOR_IDS]);
    expect([...FANSLY_CONTRACT.anchors]).toEqual([...FANSLY_ANCHOR_IDS]);
    expect(new Set(fanslyAnchors().map((anchor) => anchor.id)).size).toBe(fanslyAnchors().length);
    // The registry names this module as Fansly's contract check.
    expect(FANSLY.contractCheck.module).toBe('tools/host-contract-check/anchors-fansly.ts');
    expect(existsSync(new URL(`../../${FANSLY.contractCheck.module}`, import.meta.url))).toBe(true);
  });

  it('[DB-031] a copy written the way the 2026-10-12 build writes them: every anchor ok, the adapter’s report of it green', () => {
    const check = checkFanslyCopy(fullCopy(), CHECKED_AT);
    expect(check.strings.filter((result) => !result.present).map((result) => result.id)).toEqual([]);
    expect(check.strings.every((result) => result.at.every((place) => place.startsWith(`${MAIN}:`)))).toBe(true);
    expect(check.anchors).toEqual(FANSLY_ANCHOR_IDS.map((anchor) => ({ anchor, state: 'ok' })));
    expect(check.verdict).toMatchObject({ green: true, facts: { build: 'main.0123456789abcdef', ok: true, missing: [] }, problems: [] });
    // The report is the adapter's, of Fansly's own shape: every anchor named and `ok`.
    expect(FanslyContractReportSchema.safeParse(check.report).success).toBe(true);
    expect(Object.values(check.report.extensions['fansly-web'].anchors).every((state) => state === 'ok')).toBe(true);
    expect(check.report.checkedAt).toBe(CHECKED_AT);
  });

  it('[DB-031] the strings are the adapter’s own: its selectors and route, its socket host and API origin, MAIN’s response table and frame numbers', () => {
    const ids = fanslyAnchors()
      .map((anchor) => anchor.id)
      .join('\n');
    for (const name of [S.conversationRoute, S.container, S.composer, S.contentWrapper, S.messagesWrapper, 'message-content-header', 'message-content-header-contact', 'content-header-sub-row', 'message-input', 'send-button', 'collapsable-actions', 'message-attachments', 'no-dm-allowed', 'message-composer', S.modalFlag, ...S.themeClasses, 'app-media-upload-input', S.vaultPath]) {
      expect(ids).toContain(name);
    }
    // The class of each selector of a DOM anchor; `hidden` of the hidden field's branch is a state, not its anchor.
    for (const selector of [S.textarea, S.sendButton, S.fileInput, S.attachments, S.noDmAllowed, S.composerHidden, S.header, S.headerContact, S.headerSubRow]) {
      for (const name of selector.match(/\.[\w-]+/g) ?? []) if (name !== '.hidden') expect(ids).toContain(` ${name.slice(1)} `);
    }
    // The conversation's address.
    expect(groupIdOfPath(`/${CHAT_ROUTE_PATH}/7`)).toBe('7');
    // The socket and the API MAIN watches.
    for (const host of FANSLY_NETWORK.socketHosts) expect(ids).toContain(`wss://${host}`);
    for (const origin of FANSLY_NETWORK.apiOrigins) expect(ids).toContain(`${origin}${API_PATH}`);
    // Every address is of the kind MAIN's table gives it, and every kind of the table has its address.
    const origin = FANSLY_NETWORK.apiOrigins[0] ?? '';
    for (const entry of RESPONSE_ADDRESSES) expect([entry.kind, classifyAddress(`${origin}${API_PATH}${entry.sample}`, [origin])?.kind]).toEqual([entry.kind, entry.kind]);
    expect(new Set(RESPONSE_ADDRESSES.map((entry) => entry.kind))).toEqual(new Set(Object.keys(RESPONSE_KINDS)));
    for (const entry of RESPONSE_ADDRESSES) expect(entry.sample.startsWith(entry.written) || entry.sample.includes(entry.written)).toBe(true);
    // The numbers of the envelope are the ones MAIN reads: a service event, a package of them, the three services.
    const message = { id: '11', groupId: '22', senderId: '33', type: 1, createdAt: 1_790_000_000, content: '' };
    const service = (serviceId: number, event: object): string => JSON.stringify({ t: FRAME_ENVELOPE.service, d: JSON.stringify({ serviceId, event: JSON.stringify(event) }) });
    expect(readFrame(service(FRAME_SERVICES.MessageService, { type: 1, message }), JSON.parse).items.map((item) => item.k)).toEqual(['message']);
    expect(readFrame(service(FRAME_SERVICES.GroupService, { type: 6, groupUser: { groupId: '22', userId: '33' } }), JSON.parse).items.map((item) => item.k)).toEqual(['members']);
    expect(readFrame(service(FRAME_SERVICES.FollowerService, { type: 2, follow: { id: '44', accountId: '55', followerId: '66' } }), JSON.parse).items.map((item) => item.k)).toEqual(['follow']);
    const pack = JSON.stringify({ t: FRAME_ENVELOPE.package, d: [service(FRAME_SERVICES.MessageService, { type: 1, message })] });
    expect(readFrame(pack, JSON.parse).items.map((item) => item.k)).toEqual(['message']);
    // Another number is no frame MAIN reads.
    expect(readFrame(JSON.stringify({ t: FRAME_ENVELOPE.service + 2, d: '{}' }), JSON.parse).known).toBe(false);
    expect(ids).toContain(SOCKET_VERSION);
  });

  it('[DB-031] what a new build lost is named — a renamed class, a string outside its component, an address, a number — and nothing else', () => {
    expect(missingOf(edited((text) => text.replace('"send-button"', '"send-btn"')))).toEqual(['sendButton']);
    // A class that is only a part of a longer one is not the class.
    expect(missingOf(edited((text) => text.replace('"message-input"', '"message-input-container"')))).toEqual(['textarea']);
    // The textarea's template function moved below the composer's definition: it is the container's now, not the composer's.
    const lines = mainLines();
    const textarea = lines.findIndex((line) => line.includes('"textarea"'));
    const moved = lines.filter((_, index) => index !== textarea);
    moved.splice(moved.findIndex((line) => line.includes('function Ci(')), 0, lines[textarea] ?? '');
    expect(missingOf(fullCopy(moved))).toEqual(['textarea']);
    // In the definition's own lines (its template), a string is the component's; below them it is not.
    expect(missingOf(edited((text) => text.replace('(1, YU, 1, 1, "app-group-message-container", 2)', '(1, YU, 1, 1, "div", 2)')))).toEqual(['container']);
    // The composer is no longer in the container's template.
    expect(missingOf(edited((text) => text.replace('e.nrm(0, "app-group-message-input", 16)', 'e.nrm(0, "app-group-message-editor", 16)')))).toEqual(['composer']);
    // A component the build no longer defines: what is «in» it is gone with it.
    expect(missingOf(edited((text) => text.replace('[["app-group-message-container"]]', '[["app-group-message-box"]]')))).toEqual(['container', 'composer']);
    expect(missingOf(edited((text) => text.replace('"/account/me"', '"/account/self"')))).toEqual(['accountMe']);
    expect(missingOf(edited((text) => text.replace('10001 === t', '10002 === t')))).toEqual(['frames']);

    expect(missingOf(edited((text) => text.replace('wss://wsv3.fansly.com', 'wss://wsv4.fansly.com')))).toEqual(['socket']);
    expect(missingOf(edited((text) => text.replace('"/creator/vault"', '"/creator/media"')))).toEqual(['vaultUpload']);
    // A library's XHR is not the app's: without its own the HTTP client is gone.
    expect(missingOf(edited((text) => text.replace('return new XMLHttpRequest();', 'return fetch;')))).toEqual(['xhr']);
    const lost = checkFanslyCopy(
      edited((text) => text.replace('"send-button"', '"send-btn"')),
      CHECKED_AT,
    );
    expect(lost.strings.filter((result) => !result.present).map((result) => result.id)).toEqual(['class send-button in app-group-message-input']);
    expect(lost.verdict.green).toBe(false);
    expect(lost.verdict.facts?.missing).toEqual(['sendButton']);
    expect(lost.verdict.problems).toEqual(['anchor sendButton: not ok']);
  });

  it('[DB-031] a frame number found elsewhere does not stand for the page socket’s decoder: another socket’s decoder and unrelated code do not count', () => {
    // The same numbers are in the copy outside the decoder: an unscoped search would still find each of them.
    const text = mainLines().join('\n');
    for (const written of ['10001 ===', '1e4 ===', '"EventWrapper"', '"?v=3"']) expect(text.split(written).length - 1).toBeGreaterThan(1);
    expect(missingOf(fullCopy())).toEqual([]);
    // Only the page socket's decoder changed: its package, its service event, its decoding of the envelope.
    expect(missingOf(edited((text) => text.replace('else if (10001 === t) {', 'else if (10002 === t) {')))).toEqual(['frames']);
    expect(missingOf(edited((text) => text.replace('else if (1e4 === t)', 'else if (10002 === t)')))).toEqual(['frames']);
    expect(missingOf(edited((text) => text.replace('this.decodeMessage("EventWrapper", m)', 'this.decodeMessage("EventEnvelope", m)')))).toEqual(['frames']);
    // The page socket's address without the protocol's version: the chat rooms' socket keeps its own, in another module.
    expect(missingOf(edited((text) => text.replace('g.c.websocketUrl + "?v=3"', 'g.c.websocketUrl + "?v=4"')))).toEqual(['frames']);
    // The decoder outside the service that holds the table of service ids is not the page socket's.
    const lines = mainLines();
    const outside = lines.filter((line) => !SOCKET_SERVICE.includes(line) || line.includes('ServiceIds'));
    expect(missingOf(fullCopy(outside))).toEqual(['frames']);
    // A message service's event read anywhere but beside its service id: JSON.parse of the event alone is no proof.
    expect(missingOf(edited((text) => text.replace('else if (5 === e.serviceId) {', 'else if (6 === e.serviceId) {')))).toEqual(['frames']);
    const strings = checkFanslyCopy(
      edited((text) => text.replace('else if (10001 === t) {', 'else if (10002 === t) {')),
      CHECKED_AT,
    ).strings.filter((result) => !result.present);
    expect(strings.map((result) => result.id)).toEqual([`envelope t ${FRAME_ENVELOPE.package} (a package of frames) in the page socket's decoder`]);
  });

  it('[DB-031] a report without Fansly’s block, or without one anchor, is not green; nor is a check whose set forgot an anchor', () => {
    const report = checkFanslyCopy(fullCopy(), CHECKED_AT).report;
    expect(verdictOf(report, FANSLY_SITE).green).toBe(true);
    // Without the block: no report of Fansly the hub accepts.
    const { extensions: _block, ...bare } = report;
    for (const without of [bare, { ...report, extensions: {} }]) {
      const verdict = verdictOf(without, FANSLY_SITE);
      expect(verdict.green).toBe(false);
      expect(verdict.facts).toBeNull();
      expect(verdict.problems[0]).toMatch(/^no host contract report the hub accepts/);
    }
    // Without one anchor: the expected set reads it `missing`, and the strict branch refuses the block.
    const { container: _container, ...anchors } = report.extensions['fansly-web'].anchors;
    const lacking = verdictOf({ ...report, extensions: { 'fansly-web': { ...report.extensions['fansly-web'], anchors } } }, FANSLY_SITE);
    expect(lacking.green).toBe(false);
    expect(lacking.facts?.missing).toEqual(['container']);
    expect(lacking.problems[0]).toBe('anchor container: not ok');
    expect(lacking.problems[1]).toMatch(/^not a report of fansly-web's own shape: extensions\.fansly-web\.anchors/);
    // An anchor a page shows later (`notYet`), or one behind the owner's switch: the log's `ok`, but a copy has all the code.
    const notYet = verdictOf({ ...report, extensions: { 'fansly-web': { ...report.extensions['fansly-web'], anchors: { ...report.extensions['fansly-web'].anchors, noDmAllowed: 'notYet' } } } }, FANSLY_SITE);
    expect([notYet.green, notYet.facts?.ok, notYet.problems]).toEqual([false, true, ['anchor noDmAllowed: not yet']]);
    const vault = checkFanslyCopy(
      edited((text) => text.replace('"/creator/vault"', '"/creator/media"')),
      CHECKED_AT,
    ).verdict;
    expect([vault.green, vault.facts?.ok, vault.facts?.missing]).toEqual([false, true, ['vaultUpload']]);
    // A report of another site is no report of Fansly.
    expect(verdictOf({ ...report, host: 'chatspace' }, FANSLY_SITE).green).toBe(false);
    // A set that forgot an anchor: its report names it `missing`, and the check is not green.
    const forgot = checkFanslyCopy(
      fullCopy(),
      CHECKED_AT,
      fanslyAnchors().filter((anchor) => anchor.group !== 'headerSubRow'),
    );
    expect(forgot.anchors.filter((item) => item.state !== 'ok')).toEqual([{ anchor: 'headerSubRow', state: 'missing' }]);
    expect([forgot.verdict.green, forgot.verdict.facts?.missing]).toEqual([false, ['headerSubRow']]);
  });

  it('[NEW-09] the build of a copy is the adapter’s fingerprint: `main.<hash>` by its own rule, in the report and the facts', () => {
    const names = fullCopy().map((file) => file.name);
    expect(fanslyBuildOf(names)).toBe('main.0123456789abcdef');
    // The adapter's own rule, as it reads the page's scripts.
    expect(buildOf({ scripts: [{ src: `https://fansly.com/${MAIN}` }] } as unknown as Parameters<typeof buildOf>[0])).toBe(fanslyBuildOf(names));
    expect(fanslyBuildOf(names.filter((name) => name !== MAIN))).toBeNull();
    const check = checkFanslyCopy(fullCopy(), CHECKED_AT);
    expect([check.build, check.report.build, check.verdict.facts?.build]).toEqual(['main.0123456789abcdef', 'main.0123456789abcdef', 'main.0123456789abcdef']);
    // Only the app's own scripts are read.
    expect(names.filter(isAppScript)).toEqual([MAIN, '189.f0f0f0f0f0f0f0f0.js']);
  });

  it('`--host fansly` on the command line: the newest dated copy under $CG_FANSLY_BUNDLES, exit 0 when green and 1 when not', () => {
    const root = mkdtempSync(join(tmpdir(), 'cg-contract-cli-'));
    const copy = (name: string, files: readonly BundleFile[]): string => {
      const dir = join(root, name, 'pretty');
      mkdirSync(dir, { recursive: true });
      for (const file of files) writeFileSync(join(dir, file.name), file.text);
      return dir;
    };
    const cli = (args: readonly string[]): { readonly status: number | null; readonly out: string; readonly err: string } => {
      const run = spawnSync(process.execPath, ['tools/host-contract-check/index.ts', ...args], { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, CG_FANSLY_BUNDLES: root } });
      return { status: run.status, out: run.stdout, err: run.stderr };
    };
    try {
      // An older copy that lost the send button, a newer one that is whole: the newer is the one checked.
      const red = copy('copy-2026-10-11', edited((text) => text.replace('"send-button"', '"send-btn"')));
      const green = copy('copy-2026-10-12', fullCopy());
      const newest = cli(['--host', 'fansly']);
      expect([newest.status, newest.out.split('\n')[0]]).toEqual([0, `host-contract-check --host fansly: ${green}`]);
      expect(newest.out).toContain('build main.0123456789abcdef; 2 script(s) of the app read, 4 other file(s) not');
      expect(newest.out.trimEnd().split('\n').at(-1)).toBe('green: every one of the 17 anchors is ok.');
      // The kind names the site as well as the platform does.
      expect(cli(['--host', 'fansly-web', '--dir', green]).status).toBe(0);
      const broken = cli(['--host', 'fansly', '--dir', red]);
      expect(broken.status).toBe(1);
      expect(broken.out).toContain('[sendButton] MISSING');
      expect(broken.out).toContain('  anchor sendButton: not ok');
      expect(broken.out.trimEnd().split('\n').at(-1)).toBe('NOT green: 1 anchor(s) missing.');
      const json = cli(['--host', 'fansly', '--dir', red, '--json']);
      expect(json.status).toBe(1);
      expect(JSON.parse(json.out)).toMatchObject({ dir: red, build: 'main.0123456789abcdef', verdict: { green: false, problems: ['anchor sendButton: not ok'] } });
      // `--against` is ChatSpace's.
      const against = cli(['--host', 'fansly', '--dir', green, '--against', red]);
      expect([against.status, against.out]).toEqual([1, '']);
      expect(against.err).toContain('--against compares the send path and the telemetry of two ChatSpace copies');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** The 2026-10-12 copy (docs/research/fansly.md), under $CG_FANSLY_BUNDLES: its folder is named by its date. */
  const SNAPSHOT_DATE = '2026-10-12';
  const snapshot = ((): string | null => {
    const root = process.env['CG_FANSLY_BUNDLES'];
    if (root === undefined || root === '' || !existsSync(root)) return null;
    const name = readdirSync(root).find((item) => item.endsWith(SNAPSHOT_DATE) && existsSync(join(root, item, 'pretty')));
    return name === undefined ? null : join(root, name, 'pretty');
  })();

  it.runIf(snapshot !== null)(`[DB-031] the ${SNAPSHOT_DATE} copy of fansly.com, where this machine has it: every anchor present, green, its build`, () => {
    const dir = snapshot ?? '';
    const files = readdirSync(dir)
      .filter(isAppScript)
      .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
    const check = checkFanslyCopy(files, CHECKED_AT);
    expect(check.strings.filter((result) => !result.present).map((result) => result.id)).toEqual([]);
    expect(check.verdict).toMatchObject({ green: true, problems: [] });
    expect(check.build).toBe('main.2e6b96097a4bb73b');
    // The places docs/project-unite/fansly-web.md cites: `/account/me` (main:24685), `new WebSocket` (main:37815).
    expect(check.strings.find((result) => result.group === 'accountMe')?.at).toEqual(['main.2e6b96097a4bb73b.js:24685']);
    expect(check.strings.find((result) => result.id.startsWith('new WebSocket'))?.at).toEqual(['main.2e6b96097a4bb73b.js:37815']);
  });
});
