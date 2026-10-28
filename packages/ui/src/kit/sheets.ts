// The kit's stylesheets as shared constructable sheets (architecture.md §6.3,
// EX-012): the tokens, the base and every component's CSS, adopted in this
// order into each of our roots. One CSSStyleSheet per source and document is
// shared by all roots (`sharedSheet`), so a second, third, tenth root costs
// no parse. Surfaces add their own sources after these. A mounted surface
// retains its sources; they leave a root with the last surface using them.

import { BASE_CSS } from './base';
import { BOUNDARY_CSS } from './components/Boundary';
import { BUTTON_CSS } from './components/Button';
import { CHOICE_CSS } from './components/choice.css';
import { DIALOG_CSS } from './components/dialog.css';
import { ERROR_CSS } from './components/ErrorCard';
import { FAN_BADGE_CSS } from './components/FanBadge';
import { FIELD_CSS } from './components/field.css';
import { ICON_CSS } from './components/Icon';
import { INDICATORS_CSS } from './components/Indicators';
import { KEYS_FOOTER_CSS } from './components/KeysFooter';
import { MENU_CSS } from './components/Menu';
import { PART_CSS } from './components/PartRow';
import { STAGE_CSS } from './components/StageLine';
import { TALKING_CSS } from './components/Talking';
import { TOAST_CSS } from './components/Toast';
import { TOOLTIP_CSS } from './components/Tooltip';
import { VALUES_CSS } from './components/Values';
import { VIEW_STATE_CSS } from './components/ViewState';
import { VIRTUAL_LIST_CSS } from './components/VirtualList';
import { MARKDOWN_CSS } from './markdown/markdown.css';
import { adoptSheets, dropSheets, type StyleMode, type StyleSource } from './styles';
import { THEME_CSS } from './tokens';

/** The token values: light on `:host` / `:root`, dark under `data-scheme="dark"`. */
export const TOKENS_SOURCE: StyleSource = { id: 'cg-kit-tokens', css: THEME_CSS };
export const BASE_SOURCE: StyleSource = { id: 'cg-kit-base', css: BASE_CSS };
/** Every kit component; order matters only where a later rule refines an earlier one (parts over buttons). */
export const COMPONENTS_SOURCE: StyleSource = {
  id: 'cg-kit-components',
  css: [
    ICON_CSS,
    INDICATORS_CSS,
    TALKING_CSS,
    FAN_BADGE_CSS,
    VALUES_CSS,
    BUTTON_CSS,
    TOOLTIP_CSS,
    CHOICE_CSS,
    FIELD_CSS,
    MENU_CSS,
    ERROR_CSS,
    STAGE_CSS,
    PART_CSS,
    KEYS_FOOTER_CSS,
    TOAST_CSS,
    DIALOG_CSS,
    VIEW_STATE_CSS,
    BOUNDARY_CSS,
    VIRTUAL_LIST_CSS,
    MARKDOWN_CSS,
  ].join('\n'),
};

export const KIT_STYLE_SOURCES: readonly StyleSource[] = [TOKENS_SOURCE, BASE_SOURCE, COMPONENTS_SOURCE];

/** Adopts the kit's sheets and then `extra` (a surface's own CSS) into `root`. */
export function adoptKitStyles(root: ShadowRoot | Document, extra: readonly StyleSource[] = []): StyleMode {
  return adoptSheets(root, [...KIT_STYLE_SOURCES, ...extra]);
}

/** Which surfaces of a root use which sources: a source leaves the root with its last user. */
const users = new WeakMap<ShadowRoot | Document, Map<string, number>>();

export interface RetainedStyles {
  readonly mode: StyleMode;
  /** Idempotent: takes out of the root the sources no other surface there still uses. */
  readonly release: () => void;
}

/** adoptKitStyles for one surface, with its release (MountPort: Unmount releases everything the surface holds). */
export function retainKitStyles(root: ShadowRoot | Document, extra: readonly StyleSource[] = []): RetainedStyles {
  const ids = [...new Set([...KIT_STYLE_SOURCES, ...extra].map((source) => source.id))];
  const mode = adoptKitStyles(root, extra);
  let counts = users.get(root);
  if (counts === undefined) {
    counts = new Map();
    users.set(root, counts);
  }
  const byId = counts;
  for (const id of ids) byId.set(id, (byId.get(id) ?? 0) + 1);
  let released = false;
  return {
    mode,
    release: () => {
      if (released) return;
      released = true;
      const unused = ids.filter((id) => {
        const left = (byId.get(id) ?? 1) - 1;
        if (left > 0) byId.set(id, left);
        else byId.delete(id);
        return left <= 0;
      });
      dropSheets(root, unused);
    },
  };
}
