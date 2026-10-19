// A function component drawn again only when `same` says its props changed — `memo` without preact/compat (D-05). A
// context it reads (the I18n) still reaches it: Preact tells context consumers themselves. For long lists whose rows
// would otherwise redraw with every keystroke elsewhere in the window.

import { Component, h, type ComponentChildren, type ComponentType, type FunctionComponent } from 'preact';

export function pure<P extends object>(view: FunctionComponent<P>, same: (a: Readonly<P>, b: Readonly<P>) => boolean): ComponentType<P> {
  return class Pure extends Component<P> {
    override shouldComponentUpdate(next: Readonly<P>): boolean {
      return !same(this.props, next);
    }
    override render(): ComponentChildren {
      return h(view, this.props);
    }
  };
}
