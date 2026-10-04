// A ChatSpace tab and a signed-in person for the wiring tests of the
// background (test/support/world.ts): the tab is registered and has said
// what it shows, the person is signed in to the fake hub and the page has its
// persona — what every request of a working tab assumes.

import { type HubBinding, type OpView, type StartOp } from '@cg/contracts';
import { account, chat } from '@cg/contracts/fixtures';
import { type TabRpcClient } from '@cg/platform';
import { WORLD } from '@cg/testing/hub';

import { PASSWORD, until, type World } from './world.ts';

export interface WorkingTab {
  readonly client: TabRpcClient;
  readonly tabSessionId: () => string;
}

/** Signs the person in from the options page and gives the hub page its persona. */
export async function signInWithPersona(w: World, user: { readonly username: string; readonly password: string } = { username: WORLD.user.username, password: PASSWORD }): Promise<void> {
  const page = w.page();
  const signedIn = await page.request('session.signIn', { login: user.username, password: user.password });
  if (!signedIn.ok) throw new Error(`session.signIn: ${signedIn.error.code}`);
  const saved = await page.request('persona.set', { pageId: WORLD.pages.one.pageId, key: WORLD.persona.key, definitionId: WORLD.persona.definitionId });
  if (!saved.ok) throw new Error(`persona.set: ${saved.error.code}`);
}

/** A ChatSpace tab that registered and reported its chat, its focus and its accounts. */
export async function workingTab(w: World, tabId = 7, presence: { readonly focused?: boolean; readonly visible?: boolean; readonly fan?: string | null } = {}): Promise<WorkingTab> {
  const { client } = w.tabClient(tabId);
  await until(() => client.state() === 'ready', `tab ${tabId} registered`);
  const fan = presence.fan === undefined ? chat.platformFanId : presence.fan;
  const reported = await client.request('tab.presence', {
    chat: fan === null ? null : { ...chat, platformFanId: fan },
    routeEpoch: 1,
    visible: presence.visible ?? true,
    focused: presence.focused ?? true,
    accounts: [account],
  });
  if (!reported.ok) throw new Error(`tab.presence: ${reported.error.code}`);
  return { client, tabSessionId: () => client.tabSessionId() ?? '' };
}

/** The binding of the fixture account to its hub page, as the background resolves it for the tab. */
export async function bindingOf(tab: WorkingTab): Promise<HubBinding> {
  const answer = await tab.client.request('binding.resolve', { account });
  if (!answer.ok) throw new Error(`binding.resolve: ${answer.error.code}`);
  return answer.payload.binding;
}

/** A Reply for `fan`, started the way a click on the strip starts it: an action token of the gate, then `op.start`. */
export async function startReply(tab: WorkingTab, binding: HubBinding, fan: string = chat.platformFanId, over: Partial<StartOp> = {}) {
  const token = await tab.client.request('token.issue', { kind: 'generate', surface: 'dock' });
  if (!token.ok) throw new Error(`token.issue: ${token.error.code}`);
  const start: StartOp = {
    feature: 'reply',
    surface: 'dock',
    target: { binding, chat: { ...chat, platformFanId: fan }, fanRef: fan, conversationRef: fan },
    cause: { kind: 'click', actionToken: token.payload.actionToken },
    tone: null,
    split: false,
    window: 100,
    ...over,
  };
  return tab.client.request('op.start', start);
}

/** The opId of an admitted start. */
export function admitted(answer: Awaited<ReturnType<typeof startReply>>): string {
  if (!answer.ok || !answer.payload.ok) throw new Error(`not admitted: ${JSON.stringify(answer)}`);
  return answer.payload.opId;
}

/** The operations the background knows, as the tab lists them. */
export async function opsOf(tab: WorkingTab): Promise<readonly OpView[]> {
  const listed = await tab.client.request('op.list', { scope: 'all' });
  return listed.ok ? listed.payload.ops : [];
}
