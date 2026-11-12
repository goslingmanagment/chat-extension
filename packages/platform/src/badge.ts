// The toolbar icon's number (2026-11-12, hub #1232: «Ждут вас», core/services/waiting.ts): the badge of our own
// `action`, which needs no permission. Only its text and its colours change: no icon, no title, no notification,
// no sound. The colours are the brand's gosling yellow with the ink (ui pages/styles.ts `--pg-down`, `--pg-on-down`):
// they read on a light and a dark toolbar alike. Never throws: a browser that refuses leaves the icon as it was.

import { defaultBrowser, type BrowserApi } from './browser-api';

export const BADGE_COLORS = { background: '#f4c845', text: '#1c1b17' } as const;

export interface ActionBadgePort {
  /** The icon's text: '' — no number. Rejects when the browser refused (the caller sets it again later). */
  show(text: string): Promise<void>;
}

export function createActionBadge(api: BrowserApi = defaultBrowser()): ActionBadgePort {
  let painted = false;
  return {
    async show(text) {
      const action = api.action;
      if (action === undefined) throw new Error('no action');
      if (!painted && text !== '') {
        await action.setBadgeBackgroundColor({ color: BADGE_COLORS.background });
        await action.setBadgeTextColor?.({ color: BADGE_COLORS.text });
        painted = true;
      }
      await action.setBadgeText({ text });
    },
  };
}
