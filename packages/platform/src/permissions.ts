// permissions (architecture.md §3 «Манифест», §9.6 «Согласие»; EX-005):
// host access to the hub (and a custom hub address asked on a gesture), and
// Firefox's data-collection consent `technicalAndInteraction` — the only
// optional type, under which `ai_acceptance` and `client_health` may leave
// the browser. Every check fails closed: an error reads as "not granted".
// `request` works only inside a user gesture on an extension page.

import { defaultBrowser, type BrowserApi, type PermissionsSetApi } from './browser-api';

/** The optional data-collection type of the manifest (§3). */
export const TECHNICAL_CONSENT = 'technicalAndInteraction';

/** `https://host[:port]` → the match pattern the manifest uses for it. */
export function originPermission(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // Match patterns carry no port: the host's permission covers every port.
  return `${url.protocol}//${url.hostname}/*`;
}

export interface HostPermissionsPort {
  has(origin: string): Promise<boolean>;
  /** On a user gesture only (an options-page click). */
  request(origin: string): Promise<boolean>;
  remove(origin: string): Promise<boolean>;
  /** Origins added or removed by the person in the browser's own UI too. */
  onChange(listener: (change: { readonly added: readonly string[]; readonly removed: readonly string[] }) => void): () => void;
}

export interface ConsentPort {
  /** Whether `technicalAndInteraction` is granted now (permissions.getAll().data_collection). */
  granted(): Promise<boolean>;
  /** On a user gesture only. */
  request(): Promise<boolean>;
  revoke(): Promise<boolean>;
  /** Granted or revoked anywhere (our page, about:addons): the new state. */
  onChange(listener: (granted: boolean) => void): () => void;
}

async function quietly(task: () => Promise<boolean>): Promise<boolean> {
  try {
    return (await task()) === true;
  } catch {
    return false;
  }
}

export function createHostPermissions(api: BrowserApi = defaultBrowser()): HostPermissionsPort {
  const set = (origin: string): PermissionsSetApi | null => {
    const pattern = originPermission(origin);
    return pattern === null ? null : { origins: [pattern] };
  };
  return {
    has: (origin) => {
      const permissions = set(origin);
      return permissions === null ? Promise.resolve(false) : quietly(() => api.permissions.contains(permissions));
    },
    request: (origin) => {
      const permissions = set(origin);
      return permissions === null ? Promise.resolve(false) : quietly(() => api.permissions.request(permissions));
    },
    remove: (origin) => {
      const permissions = set(origin);
      return permissions === null ? Promise.resolve(false) : quietly(() => api.permissions.remove(permissions));
    },
    onChange(listener) {
      const added = (permissions: PermissionsSetApi): void => {
        if (permissions.origins?.length) listener({ added: [...permissions.origins], removed: [] });
      };
      const removed = (permissions: PermissionsSetApi): void => {
        if (permissions.origins?.length) listener({ added: [], removed: [...permissions.origins] });
      };
      api.permissions.onAdded.addListener(added);
      api.permissions.onRemoved.addListener(removed);
      return () => {
        api.permissions.onAdded.removeListener(added);
        api.permissions.onRemoved.removeListener(removed);
      };
    },
  };
}

export function createConsent(api: BrowserApi = defaultBrowser()): ConsentPort {
  return {
    granted: () => quietly(async () => (await api.permissions.getAll()).data_collection?.includes(TECHNICAL_CONSENT) === true),
    request: () => quietly(() => api.permissions.request({ data_collection: [TECHNICAL_CONSENT] })),
    revoke: () => quietly(() => api.permissions.remove({ data_collection: [TECHNICAL_CONSENT] })),
    onChange(listener) {
      const added = (permissions: PermissionsSetApi): void => {
        if (permissions.data_collection?.includes(TECHNICAL_CONSENT)) listener(true);
      };
      const removed = (permissions: PermissionsSetApi): void => {
        if (permissions.data_collection?.includes(TECHNICAL_CONSENT)) listener(false);
      };
      api.permissions.onAdded.addListener(added);
      api.permissions.onRemoved.addListener(removed);
      return () => {
        api.permissions.onAdded.removeListener(added);
        api.permissions.onRemoved.removeListener(removed);
      };
    },
  };
}
