// 2026-11 audit: Web A keeps only a window of a long chat. Scrolled far up (or on a quoted old message), the newest fan
// rows left the DOM and the remembered head moved back with them; coming down again told an old message as new, and a
// Reply already made showed «the fan wrote» with nothing new.

import type { HostEvent } from '@cg/contracts/host';
import { afterEach, describe, expect, it } from 'vitest';

import { createTelegramHostPort, type TelegramPort } from './host-port';
import { createTelegramMounts, type TelegramMounts } from './mount';
import { createTelegramTheme, type TelegramTheme } from './theme';

const ACCOUNT = '7770001001';
const FAN = '5550001001';

/** The open chat with the fan's messages `from..to` rendered, as Web A's window of it. */
function render(from: number, to: number): void {
  const rows = Array.from({ length: to - from + 1 }, (_, index) => `<div class="Message message-list-item" data-message-id="${from + index}"></div>`);
  document.body.innerHTML = `
    <div class="messages-layout">
      <div class="MiddleHeader"><div class="Transition"><div class="Transition_slide Transition_slide-active"><div class="ChatInfo"><div class="Avatar" data-peer-id="${FAN}"></div><div class="info"><h3 class="fullName">Jamie</h3></div></div></div></div></div>
      <div class="Transition"><div class="Transition_slide Transition_slide-active"><div class="MessageList"><div class="messages-container">${rows.join('')}</div></div></div></div>
    </div>`;
}

let port: TelegramPort | null = null;
let mounts: TelegramMounts | null = null;
let theme: TelegramTheme | null = null;

afterEach(() => {
  port?.dispose();
  mounts?.dispose();
  theme?.dispose();
  port = mounts = theme = null;
  document.body.innerHTML = '';
});

describe('the incoming facts of the open Telegram chat', () => {
  it('keeps the newest fan message seen when the window scrolls back, and tells only a newer one', async () => {
    window.history.replaceState(null, '', `#${FAN}`);
    render(1, 100);
    mounts = createTelegramMounts(document);
    theme = createTelegramTheme(document);
    port = createTelegramHostPort({ win: window, mounts, theme, session: (key) => (key === 'account1' ? JSON.stringify({ userId: ACCOUNT }) : null), redeem: () => Promise.resolve(false) });
    const incoming: string[] = [];
    port.subscribe((event: HostEvent) => {
      if (event.type === 'incoming') incoming.push(event.fact.platformMessageId);
    });
    await port.recheck();
    expect(port.current().route.chat?.platformFanId).toBe(FAN);

    render(1, 50);
    await port.recheck();
    render(1, 100);
    await port.recheck();
    expect(incoming).toEqual([]);

    render(1, 101);
    await port.recheck();
    expect(incoming).toEqual(['101']);
  });
});
