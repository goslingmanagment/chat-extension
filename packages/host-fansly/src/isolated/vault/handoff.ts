// A file handed to one of Fansly's own `<input type=file>` with one `change`, as the person's file picker would
// (docs/project-unite/architecture.md §7.10, §7.11; S6 Q7). Two paths, the old extension's (fansly-chat
// `src/content/native-file-handoff.ts`, proven live for the voice, E52, and the vault, 2026-09-09):
// - `data-transfer`: a DataTransfer of the isolated world, its FileList on the input, `change` dispatched here;
// - `clone-into`: Firefox's Xray may refuse a FileList of the isolated world on the page's input — then the page's
//   own DataTransfer gets a copy of the file made for the page (`wrappedJSObject` + `cloneInto`), and the page's own
//   `change` goes on the one input the page's selector names.
// Nothing leaves the extension: what the page does with the file is the page's own upload. Which path worked is
// said back (client_health counts them). Not a vault rule: the voice's attachment (P12c) takes the same two paths.

import type { FanslyHandoffPath } from '@cg/contracts/fansly';

export type HandoffResult = FanslyHandoffPath | 'unavailable';

/** The assignment took and the dispatch did not settle: the page may or may not have seen the file — never retried. */
export class HandoffIndeterminateError extends Error {
  constructor(options?: ErrorOptions) {
    super('the file handoff’s outcome is not known', options);
    this.name = 'HandoffIndeterminateError';
  }
}

type PageWindow = Window & { readonly wrappedJSObject?: Window & typeof globalThis };
type CloneInto = <T>(value: T, scope: object) => T;

function handInPage(win: PageWindow, file: File, selector: string): boolean {
  const page = win.wrappedJSObject;
  const cloneInto = (globalThis as { readonly cloneInto?: CloneInto }).cloneInto;
  if (page === undefined || cloneInto === undefined) return false;
  const inputs = page.document.querySelectorAll(selector);
  const input = inputs.length === 1 ? inputs.item(0) : null;
  if (!(input instanceof page.HTMLInputElement)) return false;
  const transfer = new page.DataTransfer();
  transfer.items.add(cloneInto(file, page));
  input.files = transfer.files;
  input.dispatchEvent(new page.Event('change', cloneInto({ bubbles: true }, page)));
  return true;
}

/**
 * Hands `file` to `input` and dispatches one `change`. `selector` names the same input on the page's own document
 * (the second path): it must match exactly one, or that path declines. `unavailable` — nothing was handed over (the
 * input is gone, both paths refused); throws HandoffIndeterminateError once a dispatch may have reached the page.
 */
export function handFile(win: Window, input: HTMLInputElement, file: File, selector: string): HandoffResult {
  if (!input.isConnected) return 'unavailable';
  try {
    const transfer = new (win as Window & typeof globalThis).DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
  } catch {
    try {
      return handInPage(win, file, selector) ? 'clone-into' : 'unavailable';
    } catch (error) {
      // The page's path assigns and dispatches in one go: a throw there cannot be told from «the page saw it».
      throw new HandoffIndeterminateError({ cause: error });
    }
  }
  // Once the dispatch starts, a throw is indeterminate: a second path now could give the page a second `change`.
  try {
    input.dispatchEvent(new (win as Window & typeof globalThis).Event('change', { bubbles: true }));
  } catch (error) {
    throw new HandoffIndeterminateError({ cause: error });
  }
  return 'data-transfer';
}
