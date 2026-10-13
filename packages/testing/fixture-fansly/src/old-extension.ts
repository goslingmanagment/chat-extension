// The old ChatGoose Fansly extension's marks (fansly-chat 2.10.x): two
// `<style>` in `<head>` (`chatgoose-bootstrap-style`, `chatgoose-style`), the
// «Новые» launcher at the end of `<body>`, and its root right before the main
// composer, moved into every new container (its ConversationMountController
// inserts `#chatgoose-root` before `app-group-message-input`). The new
// extension must see them (coexistence, FS-CO-*); nothing of the old code runs.

import type { MessageContainer } from './container';
import { record } from './journal';

export class OldExtensionMarks {
  private on = false;
  private container: MessageContainer | null = null;
  private readonly bootstrapStyle = Object.assign(document.createElement('style'), { id: 'chatgoose-bootstrap-style', textContent: '#chatgoose-followers-launcher { position: fixed; right: 16px; bottom: 96px; }' });
  private readonly style = Object.assign(document.createElement('style'), { id: 'chatgoose-style', textContent: '#chatgoose-root { display: block; }' });
  private readonly launcher = Object.assign(document.createElement('button'), { id: 'chatgoose-followers-launcher', className: 'chatgoose-launcher', type: 'button', textContent: 'Новые', title: 'Новые фоловеры' });
  private readonly root = Object.assign(document.createElement('div'), { id: 'chatgoose-root' });

  set(on: boolean): void {
    if (this.on === on) return;
    this.on = on;
    if (on) {
      document.head.append(this.bootstrapStyle, this.style);
      document.body.append(this.launcher);
      this.place();
    } else {
      for (const node of [this.bootstrapStyle, this.style, this.launcher, this.root]) node.remove();
    }
    record('old-extension', { on });
  }

  /** The main chat's container changed: the root follows its composer. */
  follow(container: MessageContainer | null): void {
    this.container = container;
    if (this.on) this.place();
  }

  private place(): void {
    const composer = this.container?.composer?.host ?? null;
    if (composer === null) this.root.remove();
    else if (composer.previousSibling !== this.root) composer.before(this.root);
  }
}
