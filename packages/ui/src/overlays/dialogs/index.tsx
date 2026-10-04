// @cg/ui/overlays/dialogs — the modal confirmation behind DialogPort
// (architecture.md §10.2 п. 6; ui-design §6.3): «Новый диалог» of Coach and
// any other «are you sure» a surface asks through `deps.dialogs.confirm`.
// One question at a time: a second one cancels the first. The dialog traps
// the focus and gives it back where it was (the kit's Dialog); Esc and a
// press on the scrim are «Отмена».
//
// The host is the composition root's: it hands the same object to every
// surface as their DialogPort and mounts this view on the modal layer (950)
// while a question stands. It is not a surface of the contract's list — it
// has no view model and no controller — so it mounts by itself, with the
// kit's sheets, scheme and error boundary, like any surface does.

import { signal, type ReadonlySignal } from '@preact/signals';
import { render, type JSX } from 'preact';

import { SCHEME_ATTRIBUTE, type ConfirmDialogRequest, type DialogPort, type MountDeps } from '@cg/contracts/vm';

import { ConfirmDialog, KitRoot, LAYERS, OverlayLayer, ROOT_CLASS, bindScheme, createKitEnv, holdAttribute, retainKitStyles, type KitFailure, type StyleSource } from '../../kit';

export interface DialogHost extends DialogPort {
  /** The question on screen; null — none. */
  readonly pending: ReadonlySignal<ConfirmDialogRequest | null>;
  answer(answer: 'confirm' | 'cancel'): void;
  /** Cancels what is asked. */
  dispose(): void;
}

export function createDialogHost(): DialogHost {
  const pending = signal<ConfirmDialogRequest | null>(null);
  let resolve: ((answer: 'confirm' | 'cancel') => void) | null = null;
  const answer = (value: 'confirm' | 'cancel'): void => {
    const settle = resolve;
    resolve = null;
    pending.value = null;
    settle?.(value);
  };
  return {
    pending,
    confirm(request) {
      // One question at a time: the earlier one is «Отмена».
      answer('cancel');
      return new Promise((done) => {
        resolve = done;
        pending.value = request;
      });
    },
    answer,
    dispose: () => answer('cancel'),
  };
}

export function DialogsView({ host }: { readonly host: DialogHost }): JSX.Element {
  return (
    <OverlayLayer>
      <ConfirmDialog request={host.pending.value} onAnswer={(value) => host.answer(value)} />
    </OverlayLayer>
  );
}

/** The root's name in the DOM (`data-cg-surface`); not one of the contract's surfaces. */
export const DIALOGS_ROOT = 'dialogs';
export const DIALOGS_CSS = `.cg-root[data-cg-surface="${DIALOGS_ROOT}"] { position: fixed; inset: 0; z-index: ${LAYERS.window}; pointer-events: none; }\n`;
export const DIALOGS_STYLE: StyleSource = { id: 'cg-dialogs', css: DIALOGS_CSS };

export interface DialogsMount {
  /** Idempotent. */
  readonly unmount: () => void;
}

/** Mounts the confirmation into the overlay host's closed root. */
export function mountDialogs(root: ShadowRoot, deps: MountDeps, options: { readonly host: DialogHost; readonly report?: (failure: KitFailure) => void }): DialogsMount {
  const hostElement = root.host as HTMLElement;
  const styles = retainKitStyles(root, [DIALOGS_STYLE]);
  const releaseScheme = holdAttribute(hostElement, SCHEME_ATTRIBUTE, deps.scheme.value);
  const offScheme = bindScheme(hostElement, deps.scheme);
  const container = root.ownerDocument.createElement('div');
  container.className = ROOT_CLASS;
  container.setAttribute('data-cg-surface', DIALOGS_ROOT);
  root.append(container);
  const env = createKitEnv({ deps, root, host: hostElement, surface: null, ...(options.report === undefined ? {} : { report: options.report }) });
  render(
    <KitRoot env={env} surface={null}>
      <DialogsView host={options.host} />
    </KitRoot>,
    container,
  );
  let released = false;
  return {
    unmount() {
      if (released) return;
      released = true;
      render(null, container);
      container.remove();
      env.dispose();
      offScheme();
      releaseScheme();
      styles.release();
    },
  };
}
