// Fansly on the extension pages of the stand (R20 P14b1): Fansly's part of the background scripted in memory —
// `site.access` («Включить Fansly», the tabs that wait), Fansly's part of `settings.ext` and what the background knows
// of its sessions and tabs (`fansly.settings.*`, `fansly.accounts.*`) — under the REAL controllers (core's
// `createSiteAccessControl` and `createFanslyPages`) and the real surface (ui/hosts/fansly/pages). Every Fansly
// request and answer goes through Fansly's own registry (`mayRequestFansly`, `parseFanslyTabPayload`): a page that
// sends what the protocol does not have fails here. Test-only; synthetic 18-digit ids.

import type { CgCode, CgErrorWire, ExtensionPage, HostAccount, SettingsV1, TabRequestPayload, ToneId } from '@cg/contracts';
import { SETTINGS_EXT_VERSION, type SettingsExtState } from '@cg/contracts/settings-ext';
import type { SiteAccessState } from '@cg/contracts/site-access';
import { isFanslyTabRequestType, mayRequestFansly, parseFanslyTabPayload, type FanslyAccountsView, type FanslyTabRequestPayload, type FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { createFanslyPages, type FanslyPageRequestType, type FanslyPages } from '@cg/core/application/hosts/fansly/pages';
import { createSiteAccessControl, type PageAnswer, type PageRpc } from '@cg/core/application/pages';
import { applySettingsExtPatch } from '@cg/core/domain';

import { ContractBreach, type BackgroundState } from './background';

/** The model's creator (`/account/me`), its session's legacy id, another model's creator. */
export const FANSLY_CREATOR = '700000000000000001';
export const FANSLY_LEGACY = '700000000000000101';
export const FANSLY_OTHER = '700000000000000002';
/** The hub's Fansly page of the creator. */
export const FANSLY_PAGE_ID = 15;

/** What Fansly's part of the scripted background holds; a test changes it and the next request sees the change. */
export interface FanslyFixture {
  /** What `site.access` answers; null — it is not reached (CG-RUNTIME-UNREACHABLE). */
  access: SiteAccessState | null;
  /** The person allows the browser's prompt. */
  grant: boolean;
  /** Tabs open when Fansly is switched on: they wait for a reload. */
  openTabs: number;
  ext: SettingsExtState;
  accounts: FanslyAccountsView;
  /** Account ids with an open tab «к вкладке» can bring forward. */
  tabs: string[];
}

const ext = (enabled: boolean): SettingsExtState => ({
  ext: { v: SETTINGS_EXT_VERSION, hosts: { 'fansly-web': { enabled, viaTab: false, notesView: 'drawer', inboxMark: 'dot', sound: { messagesTone: 'chime', subscribersTone: 'double' } }, 'telegram-web': { enabled: false } }, windows: { deep: null } },
  revision: 1,
  readOnly: false,
});

/** Fansly on: granted, its scripts registered, a tab waiting for a reload; a session of the creator, one of a model no tab of ours named, a tab of no account. */
export function fanslyOnFixture(now: number): FanslyFixture {
  return {
    access: { host: 'fansly-web', enabled: true, granted: true, registered: true, waitingReload: 1 },
    grant: true,
    openTabs: 3,
    ext: ext(true),
    accounts: {
      sessions: [
        { legacyId: FANSLY_LEGACY, canonicalId: FANSLY_CREATOR, tabs: 1, observedAt: now - 60_000 },
        { legacyId: FANSLY_OTHER, canonicalId: null, tabs: 1, observedAt: now - 5 * 60_000 },
      ],
      openTabs: 3,
      unattributedTabs: 1,
    },
    tabs: [FANSLY_CREATOR, FANSLY_OTHER],
  };
}

/** Fansly not switched on yet: nothing granted, nothing registered. */
export function fanslyOffFixture(): FanslyFixture {
  return {
    access: { host: 'fansly-web', enabled: false, granted: false, registered: false, waitingReload: 0 },
    grant: true,
    openTabs: 2,
    ext: ext(false),
    accounts: { sessions: [], openTabs: null, unattributedTabs: null },
    tabs: [],
  };
}

/** The creator as its Fansly tab reports it: the host's account and the platform's are the same creator. */
export const fanslyAccount = (id: string = FANSLY_CREATOR): HostAccount => ({ host: 'fansly-web', hostAccountId: id, platform: 'fansly', platformAccountId: id, username: null, displayName: null });

/**
 * A shift with a Fansly model besides the ChatSpace ones: the hub's Fansly page of the creator with its persona, and
 * (`seen`) the creator as this browser's Fansly tab reported it (open in one tab now).
 */
export function withFanslyModel(state: BackgroundState, now: number, seen = true): BackgroundState {
  const first = state.bootstrap.pages[0];
  const features = first?.features ?? {};
  const page = { pageId: FANSLY_PAGE_ID, pageLabel: 'lora-fansly', title: 'Lora Fansly', platform: 'fansly', platformAccountId: FANSLY_CREATOR, bindingRevision: 2, features };
  // Its persona is chosen under the sign-in's scope; signed out, nothing is chosen.
  const settings: SettingsV1 =
    state.settings.personas.scope === null
      ? state.settings
      : { ...state.settings, personas: { ...state.settings.personas, byPageId: { ...state.settings.personas.byPageId, [String(FANSLY_PAGE_ID)]: { key: 'lora-vip', definitionId: 'persona-definition-lora-vip-0001' } } } };
  return {
    ...state,
    settings,
    bootstrap: { ...state.bootstrap, pages: [...state.bootstrap.pages, page] },
    accounts: seen ? [{ account: fanslyAccount(), lastSeenAt: new Date(now - 60_000).toISOString(), openTabs: 1, routeTabs: 1 }, ...state.accounts] : state.accounts,
  };
}

const refuse = (code: CgCode, detail?: string): { ok: false; error: CgErrorWire } => ({ ok: false, error: detail === undefined ? { code } : { code, detail } });

/** Fansly's part of the scripted background, and the page's controllers over it. */
export class FanslyPagesBackground {
  /** Every Fansly request the page sent, `site.access` included, in order. */
  readonly calls: { readonly type: string; readonly payload: unknown }[] = [];
  /** How many times the browser's prompt was asked. */
  prompts = 0;
  readonly focused: string[] = [];

  constructor(
    readonly fixture: FanslyFixture,
    readonly page: ExtensionPage,
  ) {}

  /** `site.access` as the page's RPC sends it (the real `createSiteAccessControl` speaks to this). */
  readonly accessRpc = {
    request: (type: string, payload: unknown): Promise<PageAnswer<SiteAccessState>> => {
      if (type !== 'site.access') throw new ContractBreach(`the access control sent «${type}»`);
      this.calls.push({ type, payload });
      return Promise.resolve(this.siteAccess(payload as TabRequestPayload<'site.access'>));
    },
  } as unknown as PageRpc;

  /** The browser's prompt of «Включить Fansly»: what the person answers is granted at once. */
  readonly permissions = {
    request: (): Promise<boolean> => {
      this.prompts += 1;
      const access = this.fixture.access;
      if (this.fixture.grant && access !== null) this.fixture.access = { ...access, granted: true };
      return Promise.resolve(this.fixture.grant);
    },
  };

  private siteAccess(payload: TabRequestPayload<'site.access'>): PageAnswer<SiteAccessState> {
    const access = this.fixture.access;
    if (access === null) return refuse('CG-RUNTIME-UNREACHABLE');
    let next: SiteAccessState = { host: access.host, enabled: access.enabled, granted: access.granted, registered: access.registered, waitingReload: access.waitingReload };
    if (payload.enabled === true) {
      const fresh = !(access.enabled && access.granted) && access.granted;
      next = { ...next, enabled: true, registered: access.granted, waitingReload: fresh ? this.fixture.openTabs : access.waitingReload };
      this.fixture.ext = { ...this.fixture.ext, ext: { ...this.fixture.ext.ext, hosts: { ...this.fixture.ext.ext.hosts, 'fansly-web': { ...this.fixture.ext.ext.hosts['fansly-web'], enabled: true } } } };
    }
    if (payload.enabled === false) {
      next = { ...next, enabled: false, registered: false, waitingReload: 0 };
      this.fixture.ext = { ...this.fixture.ext, ext: { ...this.fixture.ext.ext, hosts: { ...this.fixture.ext.ext.hosts, 'fansly-web': { ...this.fixture.ext.ext.hosts['fansly-web'], enabled: false } } } };
    }
    this.fixture.access = next;
    if (payload.reload === true) {
      const reloaded = next.waitingReload;
      this.fixture.access = { ...next, waitingReload: 0 };
      return { ok: true, payload: { ...this.fixture.access, reloaded } };
    }
    return { ok: true, payload: { ...next } };
  }

  /** A request of Fansly's registry from the page: its sender rules and schemas, both ways. */
  request<T extends FanslyPageRequestType>(type: T, payload: FanslyTabRequestPayload<T>): Promise<PageAnswer<FanslyTabResponsePayload<T>>> {
    if (!isFanslyTabRequestType(type) || !mayRequestFansly(type, 'page', this.page, null)) throw new ContractBreach(`«${type}» may not be sent from the ${this.page} page`);
    const request = parseFanslyTabPayload('req', type, payload);
    if (!request.ok) throw new ContractBreach(`«${type}» was sent with a payload its schema refuses`);
    this.calls.push({ type, payload });
    const answer = this.answer(type, request.payload);
    if (answer.ok && !parseFanslyTabPayload('res', type, answer.payload).ok) throw new ContractBreach(`the scripted background answered «${type}» with a payload its schema refuses`);
    return Promise.resolve(answer as PageAnswer<FanslyTabResponsePayload<T>>);
  }

  private answer(type: FanslyPageRequestType, payload: unknown): PageAnswer<unknown> {
    const { fixture } = this;
    // The core routes a page's Fansly request only while Fansly is on (platform rpc-background `pageSite`).
    if (fixture.access === null || !fixture.access.enabled || !fixture.access.granted) return refuse('CG-RUNTIME-UNREACHABLE', 'site off');
    switch (type) {
      case 'fansly.settings.read':
        return { ok: true, payload: structuredClone(fixture.ext) };
      case 'fansly.settings.write': {
        if (fixture.ext.readOnly) return refuse('CG-STORAGE-VERSION');
        const outcome = applySettingsExtPatch(fixture.ext.ext, (payload as FanslyTabRequestPayload<'fansly.settings.write'>).patch);
        if (!outcome.ok) return refuse('CG-STORAGE-WRITE', 'invalid');
        fixture.ext = { ext: outcome.ext, revision: fixture.ext.revision + (outcome.changed ? 1 : 0), readOnly: false };
        return { ok: true, payload: structuredClone(fixture.ext) };
      }
      case 'fansly.accounts.read':
        return { ok: true, payload: structuredClone(fixture.accounts) };
      case 'fansly.accounts.focus': {
        const { hostAccountId } = payload as FanslyTabRequestPayload<'fansly.accounts.focus'>;
        const focused = fixture.tabs.includes(hostAccountId);
        if (focused) this.focused.push(hostAccountId);
        return { ok: true, payload: { focused } };
      }
    }
  }

  /** The page's controllers over this background: the real access control and Fansly's controller. */
  pages(preview: (tone: ToneId, volume: number) => Promise<PageAnswer<{ readonly played: boolean; readonly code?: CgCode | undefined }>>): FanslyPages {
    const access = createSiteAccessControl('fansly-web', this.accessRpc, this.permissions);
    return createFanslyPages({ access, request: (type, payload) => this.request(type, payload), preview: (tone, volume) => preview(tone, volume) });
  }
}
