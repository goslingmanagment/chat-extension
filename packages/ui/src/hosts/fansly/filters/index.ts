// The filters above Fansly's chats (2026-11-13; contracts fansly-filters.ts): the strip in the list's inbox slot — «Две
// полки» or «Четыре группы», as the controller says, swapped live — and «Четыре группы»' refresh in the search row, over
// the tab controller's client (core application/hosts/fansly/filters.ts). Fansly's `pins` chunk only.
import { h, type JSX } from 'preact';

import type { FanslyFiltersClient, FanslyFiltersCopy } from '@cg/contracts/fansly-filters';

import { useI18n, type SurfaceDefinition } from '../../../kit';
import { useFiltersView } from './common';
import { GROUPS_CSS, Groups, GroupsRefresh, UNPIN_CONFIRM as GROUPS_UNPIN_CONFIRM } from './Groups';
import { SHELVES_CSS, Shelves, UNPIN_CONFIRM as SHELVES_UNPIN_CONFIRM } from './Shelves';

export { GROUPS_UNPIN_CONFIRM, SHELVES_UNPIN_CONFIRM };

const HOST_CSS = `
:host { display: block; }
.cg-root[data-cg-surface='inbox-slot'], .cg-root[data-cg-surface='search-slot'] { container-type: normal; }
.cg-root[data-cg-surface='search-slot'] { display: flex; align-items: center; }
`;

export function filtersSurface(client: FanslyFiltersClient, texts: Readonly<Record<'ru' | 'en', FanslyFiltersCopy>>): SurfaceDefinition {
  function FanslyFilters(): JSX.Element | null {
    const i18n = useI18n();
    const copy = texts[i18n.language];
    const view = useFiltersView(client);
    if (view.mode === 'shelves') return h(Shelves, { client, copy });
    if (view.mode === 'groups') return h(Groups, { client, copy });
    return null;
  }
  return { view: FanslyFilters, styles: [{ id: 'cg-fansly-filters', css: HOST_CSS + SHELVES_CSS + GROUPS_CSS }] };
}

export function filtersRefreshSurface(client: FanslyFiltersClient, texts: Readonly<Record<'ru' | 'en', FanslyFiltersCopy>>): SurfaceDefinition {
  function FanslyFiltersRefresh(): JSX.Element | null {
    const i18n = useI18n();
    return h(GroupsRefresh, { client, copy: texts[i18n.language] });
  }
  return { view: FanslyFiltersRefresh, styles: [{ id: 'cg-fansly-filters-refresh', css: HOST_CSS + GROUPS_CSS }] };
}
