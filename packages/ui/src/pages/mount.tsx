import { render } from 'preact';

import { PagePlaceholder, type PlaceholderProps } from './Placeholder';

export function mountPagePlaceholder(container: HTMLElement, props: PlaceholderProps): void {
  render(<PagePlaceholder {...props} />, container);
}
