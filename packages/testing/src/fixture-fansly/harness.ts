// Mounts the Fansly-like stand page (fixture-fansly) into happy-dom for its DOM
// tests: a fresh app per test, the backend answering on the next timer turn.
// Layout and trusted input are Firefox's: e2e/specs/fansly-stand.e2e.ts.

import { createStandApp, type StandApp } from '../../fixture-fansly/src/app';
import { installControl } from '../../fixture-fansly/src/control';
import { FANSLY_STAND_GLOBAL, type FanslyStandControl, type FanslyPageJournalEntry } from '../../fixture-fansly/src/protocol';

export interface MountedStand {
  readonly app: StandApp;
  readonly control: FanslyStandControl;
  unmount(): void;
}

/** A few timer turns: the backend's answers (latency 0) and what they start. */
export async function settle(turns = 4): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => setTimeout(resolve, 1));
}

export async function mountStand(path = '/messages'): Promise<MountedStand> {
  history.replaceState(null, '', path);
  document.body.replaceChildren();
  document.documentElement.className = '';
  const root = document.createElement('app-root');
  document.body.append(root);
  const app = createStandApp(root, { latency: 0 });
  installControl(app).markReady();
  app.router.start();
  await settle();
  const control = (window as unknown as Record<string, FanslyStandControl>)[FANSLY_STAND_GLOBAL];
  if (control === undefined) throw new Error('no stand control');
  return { app, control, unmount: () => app.destroy() };
}

/** The main chat's anchors: only under `app-messages-conversation-route` (fansly.md §4). */
export const ROUTE = 'app-messages-conversation-route';
export const route = (): HTMLElement | null => document.querySelector<HTMLElement>(ROUTE);
export const mainContainer = (): HTMLElement | null => document.querySelector<HTMLElement>(`${ROUTE} > app-group-message-container`);
export const mainComposer = (): HTMLElement | null => document.querySelector<HTMLElement>(`${ROUTE} > app-group-message-container > app-group-message-input`);
export const mainField = (): HTMLTextAreaElement | null => document.querySelector<HTMLTextAreaElement>(`${ROUTE} app-group-message-input textarea.message-input`);
export const mainSend = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`${ROUTE} app-group-message-input .send-button`);
export const headerRow = (): HTMLElement | null => document.querySelector<HTMLElement>(`${ROUTE} > div.message-content-header > .flex-col > .flex-row`);
export const contactBlock = (): HTMLElement | null => document.querySelector<HTMLElement>(`${ROUTE} > div.message-content-header .message-content-header-contact`);

/** Types like a person as far as the page can tell: the value, then an `input` event. */
export function type(field: HTMLTextAreaElement, text: string): void {
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

export function key(field: HTMLElement, kind: 'keydown' | 'keyup', name: string): KeyboardEvent {
  const event = new KeyboardEvent(kind, { key: name, bubbles: true, cancelable: true });
  field.dispatchEvent(event);
  return event;
}

export function apiCalls(entries: readonly FanslyPageJournalEntry[], method: string, path: RegExp): FanslyPageJournalEntry[] {
  return entries.filter((entry) => entry.type === 'api' && entry['method'] === method && path.test(String(entry['path'])));
}
