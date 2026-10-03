// The slice of the WebExtension API the platform uses, as plain structural
// types (architecture.md §4, D-01). Every platform factory takes this object
// as a parameter that defaults to the real `browser` namespace, so the
// composition roots get the real thing and tests a fake with the same shape.
// Firefox-only parts are named as Firefox has them: `runtime.getBrowserInfo`,
// the `data_collection` permission type (Firefox 140+), MAIN-world and
// persistent dynamic content scripts (EX-018).

import { browser } from '@wxt-dev/browser';

export interface EventApi<L extends (...args: never[]) => unknown> {
  addListener(listener: L): void;
  removeListener(listener: L): void;
}

export interface TabApi {
  readonly id?: number;
  readonly url?: string;
}

/** Who sent a runtime message or opened a port. */
export interface MessageSenderApi {
  readonly id?: string;
  readonly url?: string;
  readonly origin?: string;
  /** 0 for a top frame; set only when the sender is in a tab. */
  readonly frameId?: number;
  readonly tab?: TabApi;
}

export interface PortApi {
  readonly name: string;
  readonly sender?: MessageSenderApi | undefined;
  readonly error?: { readonly message?: string } | null;
  postMessage(message: unknown): void;
  disconnect(): void;
  readonly onMessage: EventApi<(message: unknown, port: PortApi) => void>;
  readonly onDisconnect: EventApi<(port: PortApi) => void>;
}

export interface BrowserInfoApi {
  readonly name: string;
  readonly version: string;
}

export interface PlatformInfoApi {
  readonly os: string;
  readonly arch?: string;
}

export type RuntimeMessageListener = (message: unknown, sender: MessageSenderApi, sendResponse: (response: unknown) => void) => unknown;

export interface RuntimeApi {
  readonly id: string;
  getURL(path: string): string;
  getManifest(): { readonly version: string };
  /** Firefox only. */
  getBrowserInfo?(): Promise<BrowserInfoApi>;
  getPlatformInfo(): Promise<PlatformInfoApi>;
  connect(connectInfo: { name: string }): PortApi;
  sendMessage(message: unknown): Promise<unknown>;
  readonly onConnect: EventApi<(port: PortApi) => void>;
  readonly onMessage: EventApi<RuntimeMessageListener>;
}

export interface StorageChangeApi {
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

export interface StorageAreaApi {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface StorageApi {
  readonly local: StorageAreaApi;
  readonly session: StorageAreaApi;
  readonly onChanged: EventApi<(changes: Record<string, StorageChangeApi>, areaName: string) => void>;
}

export interface AlarmApi {
  readonly name: string;
  readonly scheduledTime: number;
  readonly periodInMinutes?: number;
}

export interface AlarmCreateInfoApi {
  when?: number;
  delayInMinutes?: number;
  periodInMinutes?: number;
}

export interface AlarmsApi {
  create(name: string, info: AlarmCreateInfoApi): void | Promise<void>;
  clear(name: string): Promise<boolean>;
  get(name: string): Promise<AlarmApi | undefined>;
  readonly onAlarm: EventApi<(alarm: AlarmApi) => void>;
}

/** `permissions.Permissions` with Firefox's data-collection consent (Firefox 140+). */
export interface PermissionsSetApi {
  permissions?: string[];
  origins?: string[];
  data_collection?: string[];
}

export interface PermissionsApi {
  contains(permissions: PermissionsSetApi): Promise<boolean>;
  getAll(): Promise<PermissionsSetApi>;
  request(permissions: PermissionsSetApi): Promise<boolean>;
  remove(permissions: PermissionsSetApi): Promise<boolean>;
  readonly onAdded: EventApi<(permissions: PermissionsSetApi) => void>;
  readonly onRemoved: EventApi<(permissions: PermissionsSetApi) => void>;
}

export interface RegisteredContentScriptApi {
  id: string;
  js?: string[];
  matches?: string[];
  world?: 'ISOLATED' | 'MAIN';
  runAt?: 'document_start' | 'document_end' | 'document_idle';
  allFrames?: boolean;
  persistAcrossSessions?: boolean;
}

export interface ScriptingApi {
  getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<RegisteredContentScriptApi[]>;
  registerContentScripts(scripts: RegisteredContentScriptApi[]): Promise<void>;
  unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
}

export interface BrowserApi {
  readonly runtime: RuntimeApi;
  readonly storage: StorageApi;
  readonly alarms: AlarmsApi;
  readonly permissions: PermissionsApi;
  readonly scripting: ScriptingApi;
}

/** The real `browser` namespace, read when a factory is called (never at import). */
export function defaultBrowser(): BrowserApi {
  return browser as unknown as BrowserApi;
}
