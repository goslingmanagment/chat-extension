// FBuddy's CSS on the page (S5 §2.5, §6.2 E; `content-scripts/main.js:45221-45460`):
// - `style#fb-fansly-style-fixes` in `<head>`, always for a creator — the rules
//   fansly-web.md once credited to Fansly: `contain: size` on
//   `.messages-wrapper`, and `.message-entry{flex:1 0 100%}`, which pushes the
//   composer's action row above the field (the two-row, 99-px composer of the
//   owner's measurement);
// - `style#fb-dynamic-tweaks-css`: `app-messages-route{max-width:1800px}`;
// - its widgets' own sheet — about 200 KB, shared by every shadow root as a
//   constructable sheet (a 16-entry cache), behind `:host{all:initial}`.
// The rules are ours, written from S5's list; none of FBuddy's CSS is copied.

/** `style#fb-fansly-style-fixes` (S5 §2.5: the rules it names, plus the composer's action-button reset). */
export const STYLE_FIXES = [
  'app-messages-route{overflow-x:hidden!important}',
  'app-messages-route .messages-wrapper{contain:size!important}',
  '.message-composer{flex-wrap:wrap-reverse!important}',
  '.message-entry{flex:1 0 100%!important}',
  '.message-composer .collapsable-actions button{min-width:0!important;padding:0 .25rem!important;background:none!important}',
].join('\n');

/** `style#fb-dynamic-tweaks-css` with the defaults (`b3 = 1800`, S5 §2.5). */
export const DYNAMIC_TWEAKS = 'app-messages-route{max-width:1800px!important}';

/** The host's own reset, first in every shadow root. */
export const HOST_RESET = ':host{all:initial}';

const SHEET_BYTES = 200 * 1024;

/** About 200 KB of widget rules, made once (FBuddy fetches its 208-KB `main.css` for every mount). */
let sheetText: string | null = null;
export function widgetSheetText(): string {
  if (sheetText !== null) return sheetText;
  const rules: string[] = [];
  let size = 0;
  for (let index = 0; size < SHEET_BYTES; index += 1) {
    const rule = `.fb-w-${index.toString(36)}{display:inline-flex;align-items:center;gap:${index % 7}px;padding:${index % 5}px ${index % 3}px;color:rgb(${index % 255},${(index * 7) % 255},${(index * 13) % 255})}`;
    rules.push(rule);
    size += rule.length + 1;
  }
  sheetText = rules.join('\n');
  return sheetText;
}
