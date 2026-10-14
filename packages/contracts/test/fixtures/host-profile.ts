// Fixtures of the site's profile for our interface (1.15.0, R20 F5): what fits the type and what does not. A
// profile is data the site's half of the adapter hands the mount — nothing crosses a boundary as `unknown` — so the
// invalid samples are refused by the compiler (`@ts-expect-error`), as the other view-model fixtures are.

import type * as C from '../../src/index';

const constant = <T,>(value: T): C.ValueSignal<T> => ({ value, subscribe: () => () => undefined });
const PHRASES: C.HostUiProfile['phrases'] = {
  ru: { site: 'ChatSpace', onSite: 'в ChatSpace', siteAccount: 'OnlyMonster', sitePlatform: 'OnlyFans' },
  en: { site: 'ChatSpace', onSite: 'in ChatSpace', siteAccount: 'OnlyMonster', sitePlatform: 'OnlyFans' },
};

export const HOST_PROFILE_SAMPLES: { readonly valid: readonly C.HostUiProfile[]; readonly invalid: readonly unknown[] } = {
  valid: [
    // ChatSpace: the page's own palette by inheritance, the shared rules alone.
    { dock: { variant: 'chatspace' }, phrases: PHRASES },
    // A second site: its palette translated from its page, its variant's sheet, its own phrases.
    {
      palette: constant<C.HostPalette>({ '--color-om-neutral-0': '255 255 255', '--color-om-brand-500': '10 128 114' }),
      dock: { variant: 'fansly' },
      sheet: { id: 'site-variant', css: ':host([data-dock-variant="fansly"]) .cg-root { --cg-r-pill: 4px; }' },
      phrases: {
        ru: { site: 'Fansly', onSite: 'на Fansly', siteAccount: 'Fansly', sitePlatform: 'Fansly' },
        en: { site: 'Fansly', onSite: 'on Fansly', siteAccount: 'Fansly', sitePlatform: 'Fansly' },
      },
    },
    // An empty palette: nothing of the page's scale is known yet.
    { palette: constant<C.HostPalette>({}), dock: { variant: 'fansly' }, phrases: PHRASES },
  ],
  invalid: [
    // @ts-expect-error a palette names the steps of the host's scale the kit reads (`--color-om-*`), not the page's own variables
    { palette: { value: { '--blue-1': '29 161 242' }, subscribe: () => () => undefined }, dock: { variant: 'fansly' }, phrases: PHRASES } satisfies C.HostUiProfile,
    // @ts-expect-error the dock's variants are a closed list
    { dock: { variant: 'onlyfans' }, phrases: PHRASES } satisfies C.HostUiProfile,
    // @ts-expect-error every site has a variant: there is no «no variant»
    { dock: {}, phrases: PHRASES } satisfies C.HostUiProfile,
    // @ts-expect-error a phrase in every language the texts have
    { dock: { variant: 'chatspace' }, phrases: { ru: PHRASES.ru } } satisfies C.HostUiProfile,
    // @ts-expect-error whole phrases: «на Fansly» is not built from a bare name
    { dock: { variant: 'fansly' }, phrases: { ru: { site: 'Fansly' }, en: { site: 'Fansly' } } } satisfies C.HostUiProfile,
    // @ts-expect-error 1.15.0 (R20 F9b): every phrase the shared texts take — the site's accounts and its platform too
    { dock: { variant: 'chatspace' }, phrases: { ru: { site: 'ChatSpace', onSite: 'в ChatSpace' }, en: { site: 'ChatSpace', onSite: 'in ChatSpace' } } } satisfies C.HostUiProfile,
    // @ts-expect-error a sheet is CSS under an id that keys the shared sheet
    { dock: { variant: 'fansly' }, sheet: ':host { }', phrases: PHRASES } satisfies C.HostUiProfile,
    // @ts-expect-error the client of the key scheme is the early half's (`HostAdapter.hotkeyClient`), not the profile's
    { dock: { variant: 'chatspace' }, phrases: PHRASES, hotkeyClient: 'extension' } satisfies C.HostUiProfile,
  ],
};
