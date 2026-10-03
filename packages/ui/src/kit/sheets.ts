// The kit's stylesheets as shared constructable sheets (architecture.md §6.3,
// EX-012): the tokens, the base and every component's CSS, adopted in this
// order into each of our roots. One CSSStyleSheet per source and document is
// shared by all roots (`sharedSheet`), so a second, third, tenth root costs
// no parse. Surfaces add their own sources after these.

import { BASE_CSS } from './base';
import { BOUNDARY_CSS } from './components/Boundary';
import { BUTTON_CSS } from './components/Button';
import { CHOICE_CSS } from './components/Choice';
import { DIALOG_CSS } from './components/Dialog';
import { ERROR_CSS } from './components/ErrorCard';
import { FIELD_CSS } from './components/Field';
import { ICON_CSS } from './components/Icon';
import { INDICATORS_CSS } from './components/Indicators';
import { KEYS_FOOTER_CSS } from './components/KeysFooter';
import { MENU_CSS } from './components/Menu';
import { PART_CSS } from './components/PartRow';
import { STAGE_CSS } from './components/StageLine';
import { TOAST_CSS } from './components/Toast';
import { TOOLTIP_CSS } from './components/Tooltip';
import { VALUES_CSS } from './components/Values';
import { VIEW_STATE_CSS } from './components/ViewState';
import { VIRTUAL_LIST_CSS } from './components/VirtualList';
import { MARKDOWN_CSS } from './markdown/Markdown';
import { adoptSheets, type StyleMode, type StyleSource } from './styles';
import { THEME_CSS } from './tokens';

/** The token values: light on `:host` / `:root`, dark under `data-cg-scheme="dark"`. */
export const TOKENS_SOURCE: StyleSource = { id: 'cg-kit-tokens', css: THEME_CSS };
export const BASE_SOURCE: StyleSource = { id: 'cg-kit-base', css: BASE_CSS };
/** Every kit component; order matters only where a later rule refines an earlier one (parts over buttons). */
export const COMPONENTS_SOURCE: StyleSource = {
  id: 'cg-kit-components',
  css: [
    ICON_CSS,
    INDICATORS_CSS,
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
