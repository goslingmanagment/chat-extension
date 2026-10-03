import { render } from 'preact';

import { BASE_TOKENS_CSS } from '../kit/tokens';
import { adoptStyles, type StyleMode } from '../kit/styles';
import { DOCK_CSS, Dock, type DockModel } from './Dock';

export interface DockHandle {
  readonly styleMode: StyleMode;
  /** Wall time of the first synchronous render, ms. */
  readonly renderMs: number;
  update(model: DockModel): void;
  unmount(): void;
}

/** Renders the dock into a (closed) shadow root owned by the host adapter. */
export function mountDock(root: ShadowRoot, model: DockModel): DockHandle {
  const styleMode = adoptStyles(root, BASE_TOKENS_CSS + DOCK_CSS);
  const container = root.ownerDocument.createElement('div');
  root.append(container);
  const started = performance.now();
  render(<Dock model={model} />, container);
  const renderMs = performance.now() - started;
  return {
    styleMode,
    renderMs,
    update: (next) => render(<Dock model={next} />, container),
    unmount: () => {
      render(null, container);
      container.remove();
    },
  };
}
