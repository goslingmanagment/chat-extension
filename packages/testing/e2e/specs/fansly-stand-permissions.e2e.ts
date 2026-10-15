// The TEST build and the Fansly stand's permissions (R20 P6a;
// docs/project-unite/architecture.md §4, §13): the test build declares the
// stand's origins and `webRequest` as OPTIONAL, as Fansly's own will be, and
// grants nothing of them at install; the e2e grants and revokes them with no
// prompt and no person — through Firefox's own permission store (the add-on
// manager's switch) and through a trusted click's `permissions.request` with
// Firefox's question answered. ChatSpace's scripts and stand stay on
// `127.0.0.1` and never reach the Fansly stand on `localhost`.

import { browser, expect } from '@wdio/globals';

import { setOptionalPermissionPrompts } from '../support/background';
import { installTestBuild } from '../support/extension';
import { testBuildPage } from '../support/fake-hub';
import { fanslyStandOrigin, fanslyStandServer, fanslyStandUrl, waitForFanslyStandReady } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';
import { grantedState, grantOptional, revokeOptional } from '../support/permissions';
import { standOrigin } from '../support/stand';

interface PageApi {
  readonly permissions: {
    contains(wanted: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
    getAll(): Promise<{ origins: string[]; permissions: string[] }>;
    request(wanted: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
    remove(wanted: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
    onAdded: { addListener(listener: (change: { origins: string[]; permissions: string[] }) => void): void };
    onRemoved: { addListener(listener: (change: { origins: string[]; permissions: string[] }) => void): void };
  };
  readonly runtime: { getManifest(): Record<string, unknown> };
  readonly tabs: { query(filter: { url: string }): Promise<Array<{ id: number; url?: string }>> };
  readonly scripting: { executeScript(options: { target: { tabId: number }; func: () => unknown }): Promise<Array<{ result: unknown }>> };
  readonly webRequest?: unknown;
}

interface Access {
  readonly contains: boolean;
  readonly webRequest: boolean;
  readonly tabs: readonly string[];
  readonly script: string;
}

describe('the Fansly stand’s permissions in the test build: optional, granted and revoked with no person', () => {
  useNetworkTrap();
  let pagesTab = '';
  let standTab = '';
  let stand = '';
  let journalStart = 0;

  /** What the extension can do on the stand right now, asked from its own page. */
  const access = async (): Promise<Access> => {
    await browser.switchToWindow(pagesTab);
    return browser.execute(async (pattern: string) => {
      const api = (globalThis as unknown as { browser: PageApi }).browser;
      const contains = await api.permissions.contains({ origins: [pattern] });
      const webRequest = await api.permissions.contains({ permissions: ['webRequest'] });
      const tabs = await api.tabs.query({ url: pattern });
      let script = 'no tab';
      const tab = tabs[0];
      if (tab !== undefined) {
        try {
          // An arrow no name is inferred for: the runner's keepNames would wrap a named one in `__name`, which the
          // stand's page does not have.
          const probe = [() => document.documentElement.getAttribute('data-stand-ready')][0] as () => unknown;
          const [result] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: probe });
          script = `ran: ${String(result?.result)}`;
        } catch (error) {
          script = `refused: ${String(error)}`;
        }
      }
      return { contains, webRequest, tabs: tabs.map((item) => item.url ?? '?'), script };
    }, 'http://localhost/*');
  };

  /** The permission events the extension page heard since it started listening. */
  const heard = async (): Promise<string[]> => {
    await browser.switchToWindow(pagesTab);
    return browser.execute(() => [...((window as unknown as { __cgHeard?: string[] }).__cgHeard ?? [])]);
  };

  before(async () => {
    journalStart = await fanslyStandServer.mark();
    await installTestBuild();
    stand = `${fanslyStandOrigin()}/*`.replace(/:\d+\/\*$/, '/*');
    await browser.url(testBuildPage());
    pagesTab = await browser.getWindowHandle();
    await browser.execute(() => {
      const api = (globalThis as unknown as { browser: PageApi }).browser;
      const heardList: string[] = [];
      (window as unknown as { __cgHeard: string[] }).__cgHeard = heardList;
      api.permissions.onAdded.addListener((change) => heardList.push(`added ${[...change.origins, ...change.permissions].join(' ')}`));
      api.permissions.onRemoved.addListener((change) => heardList.push(`removed ${[...change.origins, ...change.permissions].join(' ')}`));
    });
    standTab = (await browser.newWindow(fanslyStandUrl('/messages'))).handle;
    await waitForFanslyStandReady();
  });

  after(async () => {
    await setOptionalPermissionPrompts(null);
    // Nothing of the extension asked the Fansly stand for anything: only the page's own loads.
    const entries = await fanslyStandServer.journal(journalStart);
    expect(entries.filter((entry) => entry.origin !== 'asset')).toEqual([]);
  });

  it('declares the stand optional, with webRequest; grants nothing of it at install; ChatSpace’s stand is granted', async () => {
    expect(stand).toBe('http://localhost/*');
    await browser.switchToWindow(pagesTab);
    const manifest = await browser.execute(() => (globalThis as unknown as { browser: PageApi }).browser.runtime.getManifest());
    // Fansly's own origins (R20 P7a0), then its stand: all optional, none granted.
    expect(manifest['optional_host_permissions']).toEqual(['https://*/*', 'https://fansly.com/*', 'https://apiv3.fansly.com/*', 'http://localhost/*']);
    expect(manifest['optional_permissions']).toEqual(['webRequest']);
    expect(manifest['host_permissions']).toEqual(expect.arrayContaining(['http://127.0.0.1/*']));
    expect(manifest['host_permissions']).not.toEqual(expect.arrayContaining(['http://localhost/*']));
    expect(await access()).toEqual({ contains: false, webRequest: false, tabs: [], script: 'no tab' });
    expect(await grantedState(fanslyStandUrl('/messages'))).toMatchObject({ reaches: false });
    expect((await grantedState(`${standOrigin()}/`)).reaches).toBe(true);
    expect((await grantedState(fanslyStandUrl('/messages'))).permissions).not.toContain('webRequest');
  });

  it('ChatSpace’s scripts do not run on the Fansly stand (its probe never writes there)', async () => {
    await browser.switchToWindow(standTab);
    await browser.refresh();
    await waitForFanslyStandReady();
    await browser.pause(1000);
    expect(await browser.execute(() => document.documentElement.hasAttribute('data-cg-spike'))).toBe(false);
  });

  it('a grant through Firefox’s own permission store: the add-on reaches the stand at once, hears onAdded, has webRequest', async () => {
    await grantOptional({ origins: [stand], permissions: ['webRequest'] });
    expect(await grantedState(fanslyStandUrl('/messages'))).toMatchObject({ reaches: true, permissions: expect.arrayContaining(['webRequest']) });
    const now = await access();
    expect(now).toMatchObject({ contains: true, webRequest: true, script: 'ran: 1' });
    expect(now.tabs).toEqual([fanslyStandUrl('/messages')]);
    await browser.waitUntil(async () => (await heard()).length > 0, { timeout: 3000, timeoutMsg: 'no permissions.onAdded' });
    expect(await heard()).toEqual(['added http://localhost/* webRequest']);
    // An extension page loaded after the grant has the webRequest API.
    await browser.switchToWindow(pagesTab);
    await browser.url(testBuildPage());
    expect(await browser.execute(() => typeof (globalThis as unknown as { browser: PageApi }).browser.webRequest)).toBe('object');
  });

  it('a revoke the same way: the add-on loses the stand at once and hears onRemoved', async () => {
    await browser.switchToWindow(pagesTab);
    await browser.url(testBuildPage());
    await browser.execute(() => {
      const api = (globalThis as unknown as { browser: PageApi }).browser;
      const heardList: string[] = [];
      (window as unknown as { __cgHeard: string[] }).__cgHeard = heardList;
      api.permissions.onRemoved.addListener((change) => heardList.push(`removed ${[...change.origins, ...change.permissions].join(' ')}`));
    });
    await revokeOptional({ origins: [stand], permissions: ['webRequest'] });
    expect(await grantedState(fanslyStandUrl('/messages'))).toMatchObject({ reaches: false });
    const now = await access();
    expect(now).toMatchObject({ contains: false, webRequest: false, tabs: [] });
    await browser.waitUntil(async () => (await heard()).length > 0, { timeout: 3000, timeoutMsg: 'no permissions.onRemoved' });
    expect(await heard()).toEqual(['removed http://localhost/* webRequest']);
  });

  it('a person’s way, answered with no question: `permissions.request` in a trusted click grants, `permissions.remove` revokes', async () => {
    await setOptionalPermissionPrompts(false);
    await browser.switchToWindow(pagesTab);
    // Outside a user gesture the request is refused even with the question answered.
    const outside = await browser.execute(async (pattern: string) => {
      try {
        return String(await (globalThis as unknown as { browser: PageApi }).browser.permissions.request({ origins: [pattern], permissions: ['webRequest'] }));
      } catch (error) {
        return `refused: ${String(error)}`;
      }
    }, stand);
    expect(outside).toMatch(/^refused: .*user input handler/);
    await browser.execute((pattern: string) => {
      const button = document.createElement('button');
      button.id = 'cg-e2e-enable-fansly';
      button.textContent = 'Включить Fansly (e2e)';
      button.addEventListener('click', () => {
        void (globalThis as unknown as { browser: PageApi }).browser.permissions.request({ origins: [pattern], permissions: ['webRequest'] }).then(
          (granted) => button.setAttribute('data-granted', String(granted)),
          (error: unknown) => button.setAttribute('data-granted', `error: ${String(error)}`),
        );
      });
      document.body.append(button);
    }, stand);
    await $('#cg-e2e-enable-fansly').click();
    await browser.waitUntil(async () => (await $('#cg-e2e-enable-fansly').getAttribute('data-granted')) !== null, { timeout: 5000, timeoutMsg: 'the request did not answer' });
    expect(await $('#cg-e2e-enable-fansly').getAttribute('data-granted')).toBe('true');
    expect(await access()).toMatchObject({ contains: true, webRequest: true, script: 'ran: 1' });
    await browser.switchToWindow(pagesTab);
    const removed = await browser.execute(async (pattern: string) => (globalThis as unknown as { browser: PageApi }).browser.permissions.remove({ origins: [pattern], permissions: ['webRequest'] }), stand);
    expect(removed).toBe(true);
    expect(await access()).toMatchObject({ contains: false, webRequest: false, tabs: [] });
  });
});
