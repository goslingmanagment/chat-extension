import { describe, expect, it } from 'vitest';

import { mountDock } from './mount-placeholder-dock';

describe('the spike placeholder dock in a closed shadow root', () => {
  it('renders, adopts styles and keeps typed text', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    const handle = mountDock(root, { status: 'Каркас' });

    expect(host.shadowRoot).toBeNull();
    expect(root.querySelector('[data-cg-status]')?.textContent).toBe('Каркас');
    expect(['adopted', 'style-element']).toContain(handle.styleMode);

    handle.update({ status: 'Обновлено' });
    expect(root.querySelector('[data-cg-status]')?.textContent).toBe('Обновлено');

    handle.unmount();
    expect(root.querySelector('[data-cg-status]')).toBeNull();
    host.remove();
  });
});
