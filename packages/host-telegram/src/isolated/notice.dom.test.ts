// 2026-10-29 review: after an update the previous realm's dock stayed in Web A's composer with its key hold dead, and
// Enter on it reached Telegram's send listener. The notice script takes our dead hosts off; Telegram's own nodes stay.

import { HOST_ATTRIBUTE } from '@cg/host-kit/isolated/hosts';
import { describe, expect, it } from 'vitest';

import { createTelegramMounts } from './mount';
import { removeDeadHosts } from './notice';

describe('the Telegram notice after an install or update', () => {
  it('takes the dead dock and overlay off the page and leaves the composer and its field', () => {
    document.body.innerHTML = '<div class="Composer"><div id="editable-message-text" contenteditable="true">draft</div></div>';
    // What the previous realm left: our closed hosts, empty in the light DOM, the dock inside the composer.
    const mounts = createTelegramMounts(document);
    document.querySelector('.Composer')!.append(mounts.dock.host);
    mounts.overlay('panel');
    expect(document.querySelectorAll(`div[${HOST_ATTRIBUTE}]`)).toHaveLength(2);

    expect(removeDeadHosts(document)).toBe(2);
    expect(document.querySelectorAll(`div[${HOST_ATTRIBUTE}]`)).toHaveLength(0);
    expect(document.querySelector('.Composer #editable-message-text')?.textContent).toBe('draft');
  });
});
